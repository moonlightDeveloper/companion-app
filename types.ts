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
