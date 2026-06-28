import Anthropic from "@anthropic-ai/sdk";
import type {
  BarTone,
  CardKind,
  Intake,
  Read,
  ReadBar,
  ReadCard,
} from "@/types";
import { SYSTEM_PROMPT, buildUserMessage, type Clarification } from "@/lib/prompt";
import { modelFor, cachedSystem } from "./models";

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
      system: cachedSystem(SYSTEM_PROMPT),
      messages: [{ role: "user", content: buildUserMessage(intake, clarifications) }],
    });
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
  };
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
