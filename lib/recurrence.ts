import type { AxisInstance, AxisLean, CanonicalAxis } from "@/types";
import type { CardTone } from "@/lib/cardModel";

/**
 * RECURRENCE GATE for the returning-card behavior axes (replaces a volume/count gate).
 *
 * An axis surfaces only when it RECURS across the person's report history — measured
 * in distinct supporting EVIDENCE (separate exchanges/moments), NOT report count. So
 * one long report showing the same signal 2–3× qualifies, while several sparse, non-
 * repeating reports don't. Volume (the count) is just a floor; recurrence is the gate.
 *
 * Instances (`AxisInstance`) are produced server-side by the analyze pass (canonical
 * axis + lean + a verbatim-hash `ref`) and persisted with each report; the /summary
 * route aggregates them across the person's reports and this gate reads them. The gate
 * NEVER invents instances. Behavior rows (in-history recurrence = "a pattern WITH this
 * person") stay SEPARATE from the pattern line's cross-timepoint "same story over
 * weeks" claim, which the route gates behind `laterTimepoint`.
 */

/** Distinct supporting instances required for an axis to surface. Recurrence, not
 *  report count. Tunable — 2 (raise to 3 to be stricter). */
export const RECURRENCE_MIN = 2;

/** The pattern-line's over-time claim only fires when supporting reads span at least
 *  this real interval — so two reports filed the same afternoon can't fake a timeline. */
export const LATER_TIMEPOINT_MIN_INTERVAL = 4 * 24 * 60 * 60 * 1000; // 4 days (ms)

/** A gated axis ready for the card. `mixed` = it recurs but the instances disagree —
 *  an honest read, never a false-confident dot. */
export interface AxisVerdict {
  axis: CanonicalAxis;
  tone: CardTone;
  mixed: boolean;
  /** Distinct supporting moments that cleared the gate (≥ min). */
  instances: number;
}

const TONE_OF: Record<"healthy" | "leaning" | "off", CardTone> = {
  healthy: "green",
  leaning: "amber",
  off: "clay",
};

/**
 * THE audited normalization for `ref` — pinned in one place. The verbatim content hash
 * is taken over this, so the same exchange always hashes to the same ref (reliable
 * global dedup) while trivial casing/whitespace differences don't split one moment into
 * two. Do NOT strip punctuation/emoji — those are part of the verbatim exchange.
 */
export function normalizeForRef(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Verbatim content hash → the stable `ref` for an anchoring exchange. FNV-1a (pure JS,
 *  isomorphic — no crypto dep), base36. Stamped server-side; read-only on the client. */
export function axisRef(exchangeText: string): string {
  const s = normalizeForRef(exchangeText);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Distinct moments: dedupe by `ref` — GLOBALLY across the aggregated instances (a ref
 *  is report-independent, so the same exchange seen in two reports counts once). */
function distinctMoments(list: AxisInstance[]): AxisInstance[] {
  const seen = new Set<string>();
  const out: AxisInstance[] = [];
  for (const inst of list) {
    if (seen.has(inst.ref)) continue;
    seen.add(inst.ref);
    out.push(inst);
  }
  return out;
}

/**
 * The gate. Group tagged instances by axis, count DISTINCT supporting moments, and
 * surface an axis only when that count ≥ `min` (volume is just this floor). Tone comes
 * from whether the recurring instances AGREE: a strict majority sharing ONE definite
 * lean → that confident tone; a genuine split, or "uncertain" carrying the plurality →
 * an honest "mixed" read (amber, `mixed: true`).
 *
 * Recurrence supersedes tone-hysteresis (agreement-across-all-instances is itself the
 * anti-flip mechanism — a lone new instance can't flip a settled axis). The only
 * residual hysteresis: a confident read needs a strict majority, else it's mixed.
 */
export function deriveAxisVerdicts(
  instances: AxisInstance[],
  min: number = RECURRENCE_MIN,
): AxisVerdict[] {
  const byAxis = new Map<CanonicalAxis, AxisInstance[]>();
  for (const inst of instances) {
    const arr = byAxis.get(inst.axis);
    if (arr) arr.push(inst);
    else byAxis.set(inst.axis, [inst]);
  }

  const verdicts: AxisVerdict[] = [];
  for (const [axis, list] of byAxis) {
    const distinct = distinctMoments(list);
    if (distinct.length < min) continue; // recurrence floor — sparse one-offs don't show

    const counts: Record<AxisLean, number> = { healthy: 0, leaning: 0, off: 0, uncertain: 0 };
    for (const d of distinct) counts[d.lean]++;

    const total = distinct.length;
    const top = (Object.keys(counts) as AxisLean[]).sort((a, b) => counts[b] - counts[a])[0];
    // Confident only when a DEFINITE lean holds a strict majority; "uncertain" or a
    // split → the honest mixed read.
    const confident = top !== "uncertain" && counts[top] > total / 2;

    verdicts.push(
      confident
        ? { axis, tone: TONE_OF[top as "healthy" | "leaning" | "off"], mixed: false, instances: total }
        : { axis, tone: "amber", mixed: true, instances: total },
    );
  }
  return verdicts;
}

/** One report's tone for an axis — the majority of that report's instance leans, or
 *  null if the report has no instance for the axis. leaning/uncertain → amber. */
function reportAxisTone(instances: AxisInstance[], axis: CanonicalAxis): CardTone | null {
  const counts: Record<AxisLean, number> = { healthy: 0, leaning: 0, off: 0, uncertain: 0 };
  let n = 0;
  for (const i of instances) if (i.axis === axis) { counts[i.lean]++; n++; }
  if (n === 0) return null;
  const top = (Object.keys(counts) as AxisLean[]).sort((a, b) => counts[b] - counts[a])[0];
  return top === "healthy" ? "green" : top === "off" ? "clay" : "amber";
}

/**
 * Card behavior verdicts across a person's reports (FLAG-58, "sharpened B"). Starts from
 * the recurrence gate (pooled), then applies the CROSS-REPORT CONFLICT rule: when the
 * reports DISAGREE on an axis — one report warm, another off, OR an "off" in a past report
 * the latest read no longer shows — the card must NOT collapse to a pooled-majority tone
 * OR the single latest value. It shows the axis as MIXED (amber), keeping the concerning
 * history visible under a later warm read (e.g. a past boundary crossing stays "has crossed
 * your line before", never erased by a later stable read, never silently the worst).
 *
 * Stable portrait preserved: a single report — or reports that agree — passes through
 * unchanged. The latest report (by createdAt) anchors "still true now?" vs "before".
 */
export function deriveCardVerdicts(
  reports: { createdAt: number; instances: AxisInstance[] }[],
  min: number = RECURRENCE_MIN,
): AxisVerdict[] {
  const base = deriveAxisVerdicts(reports.flatMap((r) => r.instances), min);
  if (reports.length < 2) return base; // one report → no cross-report conflict possible

  const latest = [...reports].sort((a, b) => b.createdAt - a.createdAt)[0];
  return base.map((v) => {
    if (v.mixed) return v; // already the honest read
    const tones = reports
      .map((r) => reportAxisTone(r.instances, v.axis))
      .filter((t): t is CardTone => t !== null);
    const hasClay = tones.includes("clay");
    const hasGreen = tones.includes("green");
    const latestTone = reportAxisTone(latest.instances, v.axis);
    // Conflict: reports disagree good-vs-bad, OR a past "off" the latest read no longer shows.
    const conflict = (hasClay && hasGreen) || (hasClay && latestTone !== "clay");
    return conflict ? { ...v, tone: "amber", mixed: true } : v;
  });
}
