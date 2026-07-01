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
  boundary_response: "Boundary response",
};

/** Confident reads by axis, keyed on the tone (green healthy / amber leaning / clay off). */
const CONFIDENT_COPY: Record<CanonicalAxis, Record<"green" | "amber" | "clay", string>> = {
  effort_balance: { green: "balanced", amber: "leaning your way", clay: "mostly on you" },
  plan_clarity: { green: "clear plans", amber: "getting clearer", clay: "still vague" },
  reply_consistency: { green: "steady", amber: "slow to reply", clay: "off and on" },
  boundary_response: { green: "respected your no", amber: "tested the line", clay: "pushed past your no" },
};

/** Split reads — name the inconsistency, not a flat "Mixed". */
const MIXED_COPY: Record<CanonicalAxis, string> = {
  effort_balance: "runs hot and cold",
  plan_clarity: "plans, then nothing",
  reply_consistency: "depends on the day",
  boundary_response: "depends how you push back",
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

/**
 * The card can now surface up to 4 axes, but stays scannable at 3 rows. Rank by
 * SIGNIFICANCE and take the top 3: boundary findings and off/low-tone (clay) reads
 * outrank neutral (green) ones — so a "pushed past your no" or "still vague" is never
 * dropped in favour of a "steady". Score = boundary bonus + tone weight (clay > amber >
 * green); ties keep the gate's order. Presentation only — the gate is untouched.
 */
const TONE_WEIGHT: Record<CardBehaviorRow["tone"], number> = { clay: 30, amber: 20, green: 10 };
export function topRows(verdicts: AxisVerdict[]): CardBehaviorRow[] {
  return [...verdicts]
    .sort(
      (a, b) =>
        (b.axis === "boundary_response" ? 100 : 0) + TONE_WEIGHT[b.tone] -
        ((a.axis === "boundary_response" ? 100 : 0) + TONE_WEIGHT[a.tone]),
    )
    .slice(0, 3)
    .map(axisRow);
}
