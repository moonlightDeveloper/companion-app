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
