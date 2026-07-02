import Anthropic from "@anthropic-ai/sdk";
import type {
  AxisInstance,
  AxisLean,
  BarTone,
  CanonicalAxis,
  CardKind,
  DeltaChange,
  Intake,
  MovementNode,
  Read,
  ReadBar,
  ReadCard,
  ReadMoment,
  ReadReceiptMsg,
  SafetyLevel,
  TimingFeatures,
} from "@/types";
import { SYSTEM_PROMPT, buildUserMessage, type Clarification } from "@/lib/prompt";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled, MOCK_READ } from "./mockLlm";
import { axisRef } from "./recurrence";

const AXES = new Set<string>([
  "effort_balance",
  "plan_clarity",
  "reply_consistency",
  "boundary_response",
]);
const LEANS = new Set<string>(["healthy", "leaning", "off", "uncertain"]);

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
      max_tokens: 4000, // FLAG-54/56: headroom for receipts + inline quotes + axis instances
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
  // FLAG-54: enforce verbatim — validate every receipt bubble + inline «quote»
  // against the REAL conversation; non-matches are dropped / de-quoted. Forged
  // receipts are structurally impossible. Generation-time only (we have the
  // conversation here); save-mode guardRead just preserves what was validated.
  const read = verbatimize(shapeGuard(parsed), intake.conversation || "");
  // FLAG-56: tag the axis instances additively — verbatim-anchored + hashed to a
  // stable ref, off-enum dropped. (shapeGuard dropped the raw quote-form instances;
  // this produces the final ref-form. Save-mode reads keep their already-ref'd ones.)
  const tagged = tagInstances(parsed, intake.conversation || "");
  return tagged.length > 0 ? { ...read, axisInstances: tagged } : read;
}

/**
 * FLAG-56: turn the model's raw axis-instance tags ({ axis, lean, quote }) into stored
 * instances ({ axis, lean, ref }). Each is verbatim-anchored (snapToReal) and the ref
 * is a content hash of the REAL exchange, so distinct moments dedupe reliably. Off-enum
 * axes / invalid leans / untraceable quotes are dropped; per-report dedupe on (axis,ref)
 * so one moment tagged twice for one axis counts once (global dedupe is the gate's job).
 */
function tagInstances(raw: unknown, conversation: string): AxisInstance[] {
  const obj = isRecord(raw) ? raw : {};
  if (!Array.isArray(obj.axisInstances)) return [];
  const messages = conversationMessages(conversation);
  if (messages.length === 0) return []; // nothing to verify against → tag nothing
  const out: AxisInstance[] = [];
  const seen = new Set<string>();
  for (const rawInst of obj.axisInstances) {
    const m = isRecord(rawInst) ? rawInst : {};
    if (typeof m.axis !== "string" || !AXES.has(m.axis)) continue; // off-enum dropped
    if (typeof m.lean !== "string" || !LEANS.has(m.lean)) continue;
    if (typeof m.quote !== "string") continue;
    const snap = snapToReal(m.quote, messages); // verbatim anchor
    if (!snap) continue; // untraceable → can't prove distinct → drop
    const ref = axisRef(snap.text);
    const key = `${m.axis}#${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ axis: m.axis as CanonicalAxis, lean: m.lean as AxisLean, ref });
  }
  return out;
}

/** Normalize for the verbatim substring match: lowercase + collapse whitespace +
 *  trim. NO punctuation/emoji stripping — those stay significant, so a typo-fix or
 *  reworded phrase fails while a case/spacing slip on a real message still passes. */
function vnorm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The real conversation as messages: each line is "Speaker: text" — strip the
 *  label to the bare text, and derive the side from the label ("You" → you). */
function conversationMessages(conversation: string): { text: string; speaker: "you" | "them" }[] {
  return conversation
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*([^:\n]{1,40}):\s+(.*)$/);
      if (!m) return null;
      const speaker: "you" | "them" = /^you$/i.test(m[1].trim()) ? "you" : "them";
      const text = m[2].trim();
      return text ? { text, speaker } : null;
    })
    .filter((m): m is { text: string; speaker: "you" | "them" } => m !== null);
}

/** Find the real message that CONTAINS this candidate verbatim (normalized substring
 *  of a single message). Returns the FULL real message + real side, or null. */
function snapToReal(
  candidate: string,
  messages: { text: string; speaker: "you" | "them" }[],
): { text: string; speaker: "you" | "them" } | null {
  const nc = vnorm(candidate);
  if (!nc) return null;
  for (const m of messages) {
    if (vnorm(m.text).includes(nc)) return m;
  }
  return null;
}

/** Replace «quotes» that aren't a verbatim substring of any real message with their
 *  bare inner text (so a non-verbatim quote renders as plain prose, never a fake
 *  quote). Valid «quotes» are kept for the renderer to style. */
function validateQuotes(
  text: string,
  messages: { text: string; speaker: "you" | "them" }[],
): string {
  return text.replace(/«([^«»]*)»/g, (_full, inner: string) =>
    snapToReal(inner, messages) ? `«${inner}»` : inner,
  );
}

/** Drop forged receipts/quotes against the real conversation (see analyze). */
function verbatimize(read: Read, conversation: string): Read {
  const messages = conversationMessages(conversation);
  if (messages.length === 0) {
    // No conversation to validate against → strip ALL quote marks + drop receipts,
    // rather than show unverifiable evidence.
    return { ...read, receipts: [], ...stripAllQuotes(read) };
  }

  const receipts = (read.receipts ?? [])
    .map((moment) => {
      const snapped = moment.messages
        .map((msg) => snapToReal(msg.text, messages))
        .filter((m): m is { text: string; speaker: "you" | "them" } => m !== null);
      return { ...moment, messages: snapped };
    })
    .filter((moment) => moment.messages.length > 0);

  const bars = read.bars.map((b) => ({ ...b, caption: validateQuotes(b.caption, messages) }));
  const cards = read.cards.map((c) => ({ ...c, body: validateQuotes(c.body, messages) }));

  return {
    ...read,
    bars,
    cards,
    where_this_leaves_you: validateQuotes(read.where_this_leaves_you, messages),
    suggested_move: validateQuotes(read.suggested_move, messages),
    receipts,
  };
}

/** When there's no conversation to validate against, strip every «» to plain text. */
function stripAllQuotes(read: Read): Partial<Read> {
  const strip = (s: string) => s.replace(/«([^«»]*)»/g, "$1");
  return {
    bars: read.bars.map((b) => ({ ...b, caption: strip(b.caption) })),
    cards: read.cards.map((c) => ({ ...c, body: strip(c.body) })),
    where_this_leaves_you: strip(read.where_this_leaves_you),
    suggested_move: strip(read.suggested_move),
  };
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
  // FLAG-69: fail SAFE. A flagged read whose `level` is missing/invalid defaults to
  // "serious" — never soften a concern the model already raised because a field dropped.
  const safetyLevel: SafetyLevel | null = safetyFlag
    ? safetyRaw.level === "notice" || safetyRaw.level === "caution" || safetyRaw.level === "serious"
      ? safetyRaw.level
      : "serious"
    : null;

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

  // FLAG-53: same for the persisted movement-over-time timeline (a different-
  // conversation re-read). Attached at save time; preserved here for faithful recall.
  const movement = Array.isArray(obj.movement)
    ? obj.movement.map(guardMovement).filter((m): m is MovementNode => m !== null)
    : [];

  // FLAG-54: receipts — shape-guarded here; the verbatim VALIDATION (drop forged
  // bubbles, snap to the real message) happens in verbatimize() at generation, and
  // on recall they're already-validated rows preserved as-is. Cap at 3.
  const receipts = Array.isArray(obj.receipts)
    ? obj.receipts.map(guardMoment).filter((m): m is ReadMoment => m !== null).slice(0, 3)
    : [];

  // FLAG-56: preserve already-validated axis instances (final ref form) — the SAVE
  // path. At generation the raw quote-form instances carry no ref, so they're dropped
  // here and re-produced by tagInstances(); on save they're kept as-is.
  const axisInstances = Array.isArray(obj.axisInstances)
    ? obj.axisInstances.map(guardAxisInstance).filter((a): a is AxisInstance => a !== null)
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
      level: safetyLevel,
      note: typeof safetyRaw.note === "string" ? safetyRaw.note : null,
    },
    ...(delta.length > 0 ? { delta } : {}),
    ...(movement.length > 0 ? { movement } : {}),
    ...(receipts.length > 0 ? { receipts } : {}),
    ...(axisInstances.length > 0 ? { axisInstances } : {}),
    ...(guardTiming(obj.timing) ? { timing: guardTiming(obj.timing)! } : {}),
  };
}

/** FLAG-60: preserve the client-derived, content-free timing summary through the save
 *  guard — only when all four fields are finite, non-negative numbers (no content ever). */
function guardTiming(raw: unknown): TimingFeatures | null {
  const m = isRecord(raw) ? raw : {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const messages = num(m.messages);
  const spanMs = num(m.spanMs);
  const medianGapMs = num(m.medianGapMs);
  const longestGapMs = num(m.longestGapMs);
  if (messages === null || spanMs === null || medianGapMs === null || longestGapMs === null) return null;
  return { messages, spanMs, medianGapMs, longestGapMs };
}

/** One stored axis instance (final ref form) — null unless it has a valid enum axis,
 *  a valid lean, and a non-empty ref. Off-enum / unref'd tags are dropped defensively. */
function guardAxisInstance(raw: unknown): AxisInstance | null {
  const m = isRecord(raw) ? raw : {};
  if (typeof m.axis !== "string" || !AXES.has(m.axis)) return null;
  if (typeof m.lean !== "string" || !LEANS.has(m.lean)) return null;
  if (typeof m.ref !== "string" || !m.ref) return null;
  return { axis: m.axis as CanonicalAxis, lean: m.lean as AxisLean, ref: m.ref };
}

/** One receipt moment; null if it has no tag or no messages (dropped). The bubble
 *  text is verbatim-validated separately in verbatimize(). */
function guardMoment(raw: unknown): ReadMoment | null {
  const m = isRecord(raw) ? raw : {};
  if (typeof m.tag !== "string" || !m.tag.trim()) return null;
  const messages = Array.isArray(m.messages)
    ? m.messages.map(guardReceiptMsg).filter((x): x is ReadReceiptMsg => x !== null)
    : [];
  if (messages.length === 0) return null;
  return {
    tag: m.tag.trim(),
    tone: m.tone === "neutral" ? "neutral" : "flag",
    messages,
    reads_as: asString(m.reads_as, ""),
  };
}

function guardReceiptMsg(raw: unknown): ReadReceiptMsg | null {
  const m = isRecord(raw) ? raw : {};
  if (typeof m.text !== "string" || !m.text.trim()) return null;
  return { speaker: m.speaker === "you" ? "you" : "them", text: m.text };
}

/** One persisted movement node; null if it's missing required fields (dropped). */
function guardMovement(raw: unknown): MovementNode | null {
  const m = isRecord(raw) ? raw : {};
  if (typeof m.headline !== "string" || typeof m.take !== "string" || typeof m.when !== "string")
    return null;
  return { headline: m.headline, take: m.take, when: m.when, isNow: m.isNow === true };
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
