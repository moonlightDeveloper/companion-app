import type { TimingFeatures } from "@/types";

/**
 * FLAG-60 cadence: content-free timing.
 *
 * `computeTimingFeatures` runs ON-DEVICE over message TIMESTAMPS (not text) and returns a
 * tiny derived summary — counts + relative durations, never content, names, or absolute
 * clock times. `deriveCadence` runs in /summary over the per-report summaries to name the
 * single cadence flavour, deterministically (no model call). Both are pure functions.
 *
 * Cadence is only knowable where per-message timestamps exist — WhatsApp exports. Absent
 * there (screenshots/paste), features are null and no cadence flavour ever fires.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A conversation needs at least this many messages for its gaps to mean anything. */
export const MIN_MSGS_FOR_TIMING = 4;
/** Ghosting: a trailing silence at least this long (a real go-quiet, not a slow evening). */
const GHOST_ABS_MS = 3 * DAY;
/** Ghosting/fade: the latest median gap must be this many × the earliest to count. */
const GHOST_FACTOR = 2;
const FADE_FACTOR = 1.6;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Derive the content-free timing summary from a conversation's message timestamps (ms,
 * chronological). Returns null when there aren't enough messages/gaps to be meaningful —
 * so thin data never fabricates a cadence.
 */
export function computeTimingFeatures(timestampsMs: number[]): TimingFeatures | null {
  const ts = timestampsMs.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ts.length < MIN_MSGS_FOR_TIMING) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i] - ts[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (gaps.length < MIN_MSGS_FOR_TIMING - 1) return null;
  return {
    messages: ts.length,
    spanMs: ts[ts.length - 1] - ts[0],
    medianGapMs: Math.round(median(gaps)),
    longestGapMs: Math.max(...gaps),
  };
}

export type CadenceFlavour = "ghosting" | "slow_fade" | "breadcrumbing" | "hot_cold" | null;

/** Mostly-rising: more up-steps than down-steps, and the last exceeds the first. */
function isMostlyRising(xs: number[]): boolean {
  let up = 0;
  let down = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] > xs[i - 1] * 1.15) up++;
    else if (xs[i] < xs[i - 1] * 0.85) down++;
  }
  return up > down && xs[xs.length - 1] > xs[0];
}

/** Oscillates: the sign of the step direction flips at least twice (up→down→up …). */
function oscillates(xs: number[]): boolean {
  let flips = 0;
  let prevDir = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] > xs[i - 1] * 1.15 ? 1 : xs[i] < xs[i - 1] * 0.85 ? -1 : 0;
    if (d !== 0 && prevDir !== 0 && d !== prevDir) flips++;
    if (d !== 0) prevDir = d;
  }
  return flips >= 2;
}

/** The low-gap "revive" timepoints carry below-median message counts → low-effort. */
function lowEffortRevives(t: TimingFeatures[]): boolean {
  const medCount = median(t.map((x) => x.messages));
  const gapMed = median(t.map((x) => x.medianGapMs));
  const revives = t.filter((x) => x.medianGapMs < gapMed); // the "warm" (low-gap) timepoints
  return revives.length > 0 && revives.every((x) => x.messages <= medCount);
}

/**
 * The single strongest-supported cadence flavour across the person's reports (ordered
 * oldest→newest), or null below the evidence bar (≥2 timepoints with genuine gaps; ≥3 for
 * the oscillating flavours). Never fabricates "gone quiet" from thin data.
 */
export function deriveCadence(series: (TimingFeatures | null | undefined)[]): CadenceFlavour {
  const t = series.filter(
    (x): x is TimingFeatures => !!x && x.messages >= MIN_MSGS_FOR_TIMING && x.spanMs > 0,
  );
  if (t.length < 2) return null; // evidence bar
  const gaps = t.map((x) => x.medianGapMs);
  const first = t[0];
  const last = t[t.length - 1];

  // Ghosting: the latest conversation collapsed to silence — a long trailing gap, well
  // beyond the earlier rhythm. Strongest cadence signal → checked first.
  if (last.longestGapMs >= GHOST_ABS_MS && last.medianGapMs >= GHOST_FACTOR * first.medianGapMs) {
    return "ghosting";
  }
  // Slow fade: median gaps lengthening report-over-report, not yet silence.
  if (isMostlyRising(gaps) && last.medianGapMs >= FADE_FACTOR * first.medianGapMs) {
    return "slow_fade";
  }
  // Oscillating flavours need ≥3 timepoints to be a rhythm, not a blip.
  if (t.length >= 3 && oscillates(gaps)) {
    return lowEffortRevives(t) ? "breadcrumbing" : "hot_cold";
  }
  return null;
}
