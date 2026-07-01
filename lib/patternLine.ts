import type { AxisInstance, AxisLean, CanonicalAxis } from "@/types";
import { LATER_TIMEPOINT_MIN_INTERVAL } from "./recurrence";

/**
 * FLAG-57 pattern engine (the returning card's pattern line). ONE composed sentence:
 * one trajectory (spine, exactly one of 3) + an optional single flavour → one line.
 * Never two badges. Deterministic + cheap (no model call), computed over data already
 * persisted on the reports — so /summary serves it with ZERO model calls on screen load.
 *
 * Evidence bars are non-negotiable: a pattern you can't prove is worse than none. Below
 * the bar → line=null (the card shows the free teaser). A single report → no line at all.
 *
 * Scope here (server-computable from persisted verdicts + report timestamps):
 *   trajectory (stuck/warming/cooling), escalation (→ safety), one-sided.
 * Cadence flavours (ghosting/slow-fade/breadcrumbing/hot-cold) need MESSAGE-level
 * timestamps, which are client-only (IndexedDB) — NOT computed here (see FLAG-57 note).
 */

/** Net per-axis health shift (on the −1..+1 lean scale, averaged over shared axes)
 *  needed to call a trajectory a real move; below this it's "stuck". Named + tunable. */
export const MEANINGFUL_SHIFT = 0.5;

/** effort_balance sitting this far toward the user (off-ish) across reports = one-sided. */
const ONE_SIDED_MAX = -0.5;

export type Trajectory = "stuck" | "warming" | "cooling";
export type PatternFlavour = "escalation" | "one_sided" | null;

export interface PatternResult {
  /** The composed sentence, or null when below the evidence bar (→ teaser). */
  line: string | null;
  trajectory: Trajectory | null;
  flavour: PatternFlavour;
  /** Escalation → raise the safety concern over time (FLAG-59 tie-in). */
  safetyRaise: boolean;
}

/** The minimal per-report input — what /summary already has on each stored report. */
export interface ReportLite {
  createdAt: number; // ms epoch
  instances: AxisInstance[];
}

const LEAN_SCORE: Record<AxisLean, number> = { healthy: 1, leaning: 0, off: -1, uncertain: 0 };

/** Per-axis health score for one report: mean of its instance leans on −1..+1. */
function axisScores(instances: AxisInstance[]): Map<CanonicalAxis, number> {
  const acc = new Map<CanonicalAxis, { sum: number; n: number }>();
  for (const i of instances) {
    const a = acc.get(i.axis) ?? { sum: 0, n: 0 };
    a.sum += LEAN_SCORE[i.lean];
    a.n += 1;
    acc.set(i.axis, a);
  }
  const out = new Map<CanonicalAxis, number>();
  for (const [k, v] of acc) out.set(k, v.sum / v.n);
  return out;
}

const NONE: PatternResult = { line: null, trajectory: null, flavour: null, safetyRaise: false };

/**
 * Compute the pattern line. `reports` are the person's reports (any order). Returns
 * line=null below the evidence bar. A reviewer can explain any verdict from the two
 * endpoint reports: net shift healthier → warming, worse → cooling, flat → stuck.
 */
export function computePatternLine(reports: ReportLite[], nickname: string): PatternResult {
  if (reports.length < 2) return NONE; // n=1 honesty gate — no pattern from one report
  const sorted = [...reports].sort((a, b) => a.createdAt - b.createdAt); // oldest → newest
  const span = sorted[sorted.length - 1].createdAt - sorted[0].createdAt;
  if (span < LATER_TIMEPOINT_MIN_INTERVAL) return NONE; // gap bar — same-afternoon ≠ a timeline

  const first = axisScores(sorted[0].instances);
  const last = axisScores(sorted[sorted.length - 1].instances);
  const shared = [...last.keys()].filter((a) => first.has(a));
  if (shared.length === 0) return NONE; // nothing comparable across the endpoints

  // Trajectory: mean net shift across shared axes, earliest → latest.
  const netDelta = shared.reduce((s, a) => s + (last.get(a)! - first.get(a)!), 0) / shared.length;
  const trajectory: Trajectory =
    netDelta >= MEANINGFUL_SHIFT ? "warming" : netDelta <= -MEANINGFUL_SHIFT ? "cooling" : "stuck";

  // Flavours (single strongest-supported; escalation is highest-stakes → wins).
  const brSeries = sorted
    .map((r) => axisScores(r.instances).get("boundary_response"))
    .filter((x): x is number => x !== undefined);
  const escalation =
    brSeries.length >= 2 && brSeries[brSeries.length - 1] < brSeries[0] && brSeries[brSeries.length - 1] < 0;

  const efSeries = sorted
    .map((r) => axisScores(r.instances).get("effort_balance"))
    .filter((x): x is number => x !== undefined);
  const oneSided = efSeries.length >= 2 && efSeries.every((v) => v <= ONE_SIDED_MAX);

  const flavour: PatternFlavour = escalation ? "escalation" : oneSided ? "one_sided" : null;
  const safetyRaise = flavour === "escalation";

  return {
    line: compose(trajectory, flavour, span, nickname),
    trajectory,
    flavour,
    safetyRaise,
  };
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Compose the single sentence in the taxonomy voice. Escalation uses the calm,
 *  supportive safety voice — never the "same story lol" register. */
function compose(t: Trajectory, f: PatternFlavour, span: number, nickname: string): string {
  if (f === "escalation") {
    // High-stakes, calm, direct — matches the safety voice.
    return `This is escalating — ${nickname} keeps pushing further past your limits, read after read. That's worth taking seriously, not explaining away.`;
  }
  const weeks = Math.max(2, Math.round(span / WEEK));
  if (t === "warming") {
    return f === "one_sided"
      ? "It's moving your way — though it's still mostly you carrying it."
      : "It's actually moving — things are landing better than they were.";
  }
  if (t === "cooling") {
    return f === "one_sided"
      ? "It's cooling — and the effort's been mostly on you."
      : "It's cooling — the effort's been dropping off, read to read.";
  }
  // stuck
  return f === "one_sided"
    ? `${weeks} weeks in — same read every time, and still mostly on you to keep it going.`
    : `${weeks} weeks in — same read every time. Nothing's really moved.`;
}
