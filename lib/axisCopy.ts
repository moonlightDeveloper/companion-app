import type { CanonicalAxis } from "@/types";
import type { CardBehaviorRow } from "@/lib/cardModel";
import type { AxisVerdict } from "@/lib/recurrence";

/**
 * FLAG-56: display copy for the recurrence-gated behavior rows. One small, tunable map
 * next to the card renderer so real splits are easy to reword. Mixed rows name the
 * INCONSISTENCY itself as the read (inconsistency is the finding) and take the amber dot.
 */
const AXIS_LABEL: Record<CanonicalAxis, string> = {
  effort_balance: "Effort balance",
  plan_clarity: "Plan clarity",
  reply_consistency: "Reply consistency",
};

/** Confident reads by axis, keyed on the tone (green healthy / amber leaning / clay off). */
const CONFIDENT_COPY: Record<CanonicalAxis, Record<"green" | "amber" | "clay", string>> = {
  effort_balance: { green: "balanced", amber: "leaning your way", clay: "mostly on you" },
  plan_clarity: { green: "clear plans", amber: "getting clearer", clay: "still vague" },
  reply_consistency: { green: "steady", amber: "slow to reply", clay: "off and on" },
};

/** Split reads — name the inconsistency, not a flat "Mixed". */
const MIXED_COPY: Record<CanonicalAxis, string> = {
  effort_balance: "runs hot and cold",
  plan_clarity: "plans, then nothing",
  reply_consistency: "depends on the day",
};
const MIXED_FALLBACK = "goes back and forth";

/** Render a gated verdict → a card behavior row: mixed → the per-axis split copy
 *  (amber dot), else the confident copy for its tone. */
export function axisRow(v: AxisVerdict): CardBehaviorRow {
  const value = v.mixed
    ? MIXED_COPY[v.axis] ?? MIXED_FALLBACK
    : CONFIDENT_COPY[v.axis][v.tone];
  return { label: AXIS_LABEL[v.axis], value, tone: v.tone };
}
