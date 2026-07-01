/** Shared types for the behaviour read returned by /api/analyze. */

export type BarTone = "good" | "caution" | "low";

export interface ReadBar {
  /** Behaviour dimension, e.g. "Effort balance". */
  label: string;
  /** Short qualifier shown next to the label. */
  tag: string;
  /** Strength/clarity of this behavioural dimension, 0–100. NOT romantic interest. */
  level: number;
  /** Drives the bar colour: good = green, caution = amber, low = red. */
  tone: BarTone;
  /** One observable detail drawn from the conversation. */
  caption: string;
}

export type CardKind = "Pattern" | "What I'd watch";

export interface ReadCard {
  kind: CardKind;
  title: string;
  /** 1–2 sentences. */
  body: string;
}

export interface ReadSafety {
  flag: boolean;
  note: string | null;
}

/** The full behaviour read — the JSON contract the model returns. */
export interface Read {
  /** Short phrase naming the pattern. */
  headline: string;
  /** 2–4 word pill. */
  status_tag: string;
  bars: ReadBar[];
  cards: ReadCard[];
  /** One calm, concrete next step. */
  suggested_move: string;
  /** Grounding note; if healthy, says they can relax. */
  where_this_leaves_you: string;
  safety: ReadSafety;
  /** FLAG-46: the "Since last time" before/after, PERSISTED with the report when it
   *  was created on a continuation, so recalling the report shows the same comparison
   *  it had originally. Absent on first reads / fresh reads (nothing to compare). Not
   *  emitted by the model — attached at save time from the /api/delta result. */
  delta?: DeltaChange[];
  /** FLAG-53: the movement-over-time timeline (up to 3 reads), PERSISTED with the
   *  report when it was created on a different-conversation re-read, so recall shows
   *  the same snapshot. Frozen as-shown (incl. the "when" labels). Not model-emitted —
   *  attached at save time. */
  movement?: MovementNode[];
  /** FLAG-56: instance-level evidence tags for the recurrence gate — each a distinct
   *  supporting exchange, canonical-axis + lean, anchored to a verbatim content-hash
   *  ref (see lib/recurrence.ts). Emitted additively by the analyze pass, verbatim-
   *  validated at generation, persisted with the report. Aggregated across the person's
   *  reports by /api/persons/[id]/summary. Forward-only; absent on pre-FLAG-56 reports. */
  axisInstances?: AxisInstance[];
  /** FLAG-54: the "Key moments · receipts" — 2-3 telling exchanges shown as chat
   *  bubbles. Model-SELECTED but every message is VALIDATED verbatim against the real
   *  conversation at generation (non-matches dropped, empty moments dropped) and the
   *  bubbles snapped to the full real message + real side. Persisted with the report
   *  (like delta/movement) so recall shows the same receipts. */
  receipts?: ReadMoment[];
  /** FLAG-60: content-free timing metadata for the cadence flavours. Derived ON-DEVICE
   *  from message TIMESTAMPS ONLY (WhatsApp exports — the only source with real per-message
   *  times; screenshots/paste have none, so this is absent there). NO message text, NO
   *  names, NO absolute clock times leave the device — only relative durations + a count.
   *  Persisted with the report like axisInstances; /summary aggregates it across the
   *  person's reports to compose the cadence flavour. Forward-only. */
  timing?: TimingFeatures;
}

/** FLAG-60: the on-device-derived, content-free timing summary for one conversation. */
export interface TimingFeatures {
  /** Message count in the captured conversation. */
  messages: number;
  /** First→last message span (ms). */
  spanMs: number;
  /** Median inter-message gap (ms). */
  medianGapMs: number;
  /** Longest inter-message gap (ms) — a trailing silence surfaces here. */
  longestGapMs: number;
}

/** FLAG-56: the CLOSED canonical behavior-axis vocabulary. Server-pinned so the model
 *  can't invent axis names and rebuild the comparability mush; anything off-enum is
 *  never emitted (and the route drops it defensively). Extend deliberately, keep small. */
export type CanonicalAxis =
  | "effort_balance"
  | "plan_clarity"
  | "reply_consistency"
  | "boundary_response";

/** Which way one instance leans. "uncertain" = the behavior recurs but its DIRECTION is
 *  ambiguous — it still counts toward recurrence and feeds the honest "mixed" read. */
export type AxisLean = "healthy" | "leaning" | "off" | "uncertain";

/** One tagged supporting exchange for an axis — a distinct moment, NOT a report (a
 *  single report can carry several). `ref` is a verbatim content hash of the anchoring
 *  exchange (lib/recurrence.ts axisRef); it's how distinct moments are counted and
 *  deduped GLOBALLY across the person's reports. */
export interface AxisInstance {
  axis: CanonicalAxis;
  lean: AxisLean;
  ref: string;
}

/** FLAG-54: one receipt bubble — an EXACT real message + which side said it. */
export interface ReadReceiptMsg {
  speaker: "you" | "them";
  text: string;
}

/** FLAG-54: one "key moment" receipt — a tag (what it shows), the verbatim exchange
 *  as bubbles, and a short "reads as" line tying it to the read. */
export interface ReadMoment {
  tag: string;
  /** flag = concerning (terracotta pill); neutral = grey. */
  tone: "flag" | "neutral";
  messages: ReadReceiptMsg[];
  reads_as: string;
}

/** FLAG-53: one node on the movement-over-time timeline — a saved read replayed as a
 *  point on the flowing timeline (headline + one-line takeaway + a frozen "when"). */
export interface MovementNode {
  headline: string;
  take: string;
  /** Frozen relative label as shown at creation, e.g. "3 days ago", "Now · this read". */
  when: string;
  /** True for the read this report IS (the newest / "now" node). */
  isNow: boolean;
}

/** One attributed line of a conversation extracted from screenshots. */
export interface TranscriptMessage {
  /** "You" for the user, or the chosen nickname for the other person. */
  speaker: string;
  text: string;
  /** FLAG-60: the visible message timestamp string if the screenshot showed one (e.g.
   *  "10:42", "Yesterday 3:15 PM"). Used ONLY on-device to derive content-free cadence
   *  gaps, then discarded — never stored (transcriptToText drops it; only relative timing
   *  features persist). Absent when no timestamp was visible. */
  time?: string;
}

/** Extraction confidence — drives the conditional check screen (FLAG-20). */
export interface ExtractConfidence {
  level: "high" | "low";
  issues: string[];
}

/** The ordered transcript returned by /api/extract. */
export interface Transcript {
  messages: TranscriptMessage[];
  notes?: string;
  confidence?: ExtractConfidence;
  /** True only when the image clearly isn't a messaging conversation (FLAG-21). */
  notAChat?: boolean;
}

/** FLAG-46: one concrete behavioural change, paired before → now, with a DIRECTION
 *  (never a precise score — sub-scores are unstable, FLAG-49). Both text sides are
 *  specific observable behaviours (never a vague "he changed"). */
export interface DeltaChange {
  /** Short behaviour-dimension name, e.g. "Respect for your limits". */
  dimension: string;
  /** Which way it moved. weakened = terracotta ↓, improved = sage ↑, held = grey →. */
  direction: "weakened" | "improved" | "held";
  /** The specific observable behaviour in the PRIOR read. */
  before: string;
  /** The specific observable behaviour NOW. */
  now: string;
}

/** One editable reply draft in a given tone (from /api/reply). */
export interface ReplyDraft {
  tone: string;
  text: string;
}

/** The intake answers collected by the guided story flow. */
export interface Intake {
  name: string;
  origin: string;
  situation: string;
  issue: string;
  conversation: string;
  met: string;
  plans: string;
  feeling: string;
}
