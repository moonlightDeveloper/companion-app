import Anthropic from "@anthropic-ai/sdk";
import type {
  BarTone,
  CardKind,
  DeltaChange,
  Intake,
  Read,
  ReadBar,
  ReadCard,
} from "@/types";
import { SYSTEM_PROMPT, buildUserMessage, type Clarification } from "@/lib/prompt";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled, MOCK_READ } from "./mockLlm";

/** Thrown when the model call or JSON parsing fails. */
export class AnalyzeError extends Error {}

/**
 * Calls the model, parses its JSON, and shape-guards the result so a stray or
 * missing field can never crash the UI.
 */
export async function analyze(
  intake: Intake,
  clarifications: Clarification[] = [],
): Promise<Read> {
  if (mockLlmEnabled()) return MOCK_READ;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnalyzeError("Missing ANTHROPIC_API_KEY");
  }

  const client = new Anthropic({ apiKey });

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("analyze"),
      max_tokens: 2000,
      // FLAG-44: 0.3, not the default 1.0. The verdict is stable either way, but
      // 1.0 jitters the surface wording run-to-run (reads "unreliable"); 0.3 keeps
      // the read consistent without going fully deterministic.
      temperature: 0.3,
      system: cachedSystem(SYSTEM_PROMPT),
      messages: [{ role: "user", content: buildUserMessage(intake, clarifications) }],
    });
    // FLAG-42: cache tripwire. HIT (read>0) is the steady state after the first
    // read in the 5-min TTL. Persistent MISS with write>0 = the cached system
    // prefix stopped being byte-identical (a prompt tweak / dynamic value crept
    // in) and we're silently paying full input price — caching broke, fix it.
    const u = response.usage;
    console.info(
      `[analyze] cache ${(u.cache_read_input_tokens ?? 0) > 0 ? "HIT" : "MISS"} ` +
        `read=${u.cache_read_input_tokens ?? 0} write=${u.cache_creation_input_tokens ?? 0}`,
    );
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (err) {
    throw new AnalyzeError(
      err instanceof Error ? err.message : "Model request failed",
    );
  }

  const parsed = parseJson(text);
  return shapeGuard(parsed);
}

/** Pulls a JSON object out of the model's text, tolerating stray fences. */
function parseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the first {...} span in case the model added prose.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AnalyzeError("Model returned invalid JSON");
  }
}

/** Sanitize any object into a valid Read (used to persist a previewed read). */
export function guardRead(raw: unknown): Read {
  return shapeGuard(raw);
}

function shapeGuard(raw: unknown): Read {
  const obj = isRecord(raw) ? raw : {};

  const safetyRaw = isRecord(obj.safety) ? obj.safety : {};
  const safetyFlag = safetyRaw.flag === true;

  const bars = Array.isArray(obj.bars)
    ? obj.bars.map(guardBar).slice(0, 4)
    : [];
  const cards = Array.isArray(obj.cards)
    ? obj.cards.map(guardCard).slice(0, 3)
    : [];

  // FLAG-46: the model never emits `delta` — it's attached at save time on a
  // continuation (the persisted "Since last time"). Preserve it through the guard
  // so a recalled report shows the same before/after; absent/invalid → omitted.
  const delta = Array.isArray(obj.delta)
    ? obj.delta.map(guardDelta).filter((d): d is DeltaChange => d !== null)
    : [];

  return {
    headline: asString(obj.headline, "Here's what I'm noticing"),
    status_tag: asString(obj.status_tag, "Your read"),
    bars,
    cards,
    suggested_move: asString(obj.suggested_move, ""),
    where_this_leaves_you: asString(obj.where_this_leaves_you, ""),
    safety: {
      flag: safetyFlag,
      note: typeof safetyRaw.note === "string" ? safetyRaw.note : null,
    },
    ...(delta.length > 0 ? { delta } : {}),
  };
}

/** One persisted before/after change; null if it's missing required fields or an
 *  invalid direction (dropped — never a half-rendered comparison). */
function guardDelta(raw: unknown): DeltaChange | null {
  const d = isRecord(raw) ? raw : {};
  const dir = d.direction;
  if (dir !== "weakened" && dir !== "improved" && dir !== "held") return null;
  if (typeof d.dimension !== "string" || typeof d.before !== "string" || typeof d.now !== "string")
    return null;
  return { dimension: d.dimension, direction: dir, before: d.before, now: d.now };
}

function guardBar(raw: unknown): ReadBar {
  const b = isRecord(raw) ? raw : {};
  const level = clamp(typeof b.level === "number" ? b.level : 0, 0, 100);
  return {
    label: asString(b.label, "Behaviour"),
    tag: asString(b.tag, ""),
    level,
    tone: asTone(b.tone),
    caption: asString(b.caption, ""),
  };
}

function guardCard(raw: unknown): ReadCard {
  const c = isRecord(raw) ? raw : {};
  return {
    kind: asKind(c.kind),
    title: asString(c.title, ""),
    body: asString(c.body, ""),
  };
}

function asTone(value: unknown): BarTone {
  return value === "good" || value === "caution" || value === "low"
    ? value
    : "caution";
}

function asKind(value: unknown): CardKind {
  return value === "Pattern" || value === "What I'd watch"
    ? value
    : "Pattern";
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
