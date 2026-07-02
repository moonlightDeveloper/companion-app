import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";
import { LATER_TIMEPOINT_MIN_INTERVAL, deriveCardVerdicts } from "@/lib/recurrence";
import { computePatternLine, type ReportLite } from "@/lib/patternLine";
import type { AxisInstance } from "@/types";

export const runtime = "nodejs";

// Defensive re-check of the closed enum at the boundary — a prompt/storage regression
// can't leak junk rows onto the card even if a bad axis slipped past generation.
const AXES = new Set<string>([
  "effort_balance",
  "plan_clarity",
  "reply_consistency",
  "boundary_response",
]);

/**
 * FLAG-56: the per-person recurrence-gate input. Aggregates the axis instances stored
 * on the person's reports (GLOBAL across reports — dedup is by ref in the gate, not
 * here) + whether a genuine later timepoint exists to gate the pattern line off its
 * teaser. Ownership-checked. The card runs deriveAxisVerdicts(instances) — the gate is
 * NOT reimplemented here (reuse lib/recurrence.ts).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json(EMPTY);
  const { id } = await params;
  const nickname = new URL(req.url).searchParams.get("nickname") || "them";
  try {
    const reports = await listReports(userId, id); // ownership-checked, newest first
    const instances: AxisInstance[] = [];
    const timesWithInstances: number[] = [];
    const lites: ReportLite[] = [];
    for (const r of reports) {
      const tagged = (r.result.axisInstances ?? []).filter((a) => AXES.has(a.axis) && !!a.ref);
      const at = new Date(r.created_at).getTime();
      if (tagged.length > 0) timesWithInstances.push(at);
      instances.push(...tagged);
      lites.push({ createdAt: at, instances: tagged, timing: r.result.timing ?? null }); // FLAG-60
    }
    // A real interval — not just "≥2 reports": two reports filed the same afternoon
    // must NOT let the over-time pattern line fire.
    const laterTimepoint =
      timesWithInstances.length >= 2 &&
      Math.max(...timesWithInstances) - Math.min(...timesWithInstances) >=
        LATER_TIMEPOINT_MIN_INTERVAL;
    // FLAG-57: the pattern line — DETERMINISTIC (no model call), computed from the
    // persisted per-report verdicts + timestamps. null below the evidence bar → teaser.
    const pattern = computePatternLine(lites, nickname);
    // FLAG-58: conflict-aware card verdicts — cross-report disagreement (a past boundary
    // crossing under a later warm read; hot/cold effort) surfaces as MIXED, never a
    // pooled-majority or single-latest tone. Deterministic; no model call.
    const verdicts = deriveCardVerdicts(lites);
    return NextResponse.json({
      instances,
      verdicts,
      laterTimepoint,
      patternLine: pattern.line,
      patternSafety: pattern.safetyRaise,
      // FLAG-68: verdict tone for the pattern ring's colour (good/caution/low).
      patternTone: pattern.tone,
      // FLAG-58: the newest report's id (reports are DESC) → the card's "Open the full
      // read" deep-links to the read-only saved-report view for it.
      latestReportId: reports[0]?.id ?? null,
    });
  } catch (err) {
    console.error("summary failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(EMPTY);
  }
}

const EMPTY = {
  instances: [],
  verdicts: [],
  laterTimepoint: false,
  patternLine: null,
  patternSafety: false,
  patternTone: "amber",
  latestReportId: null,
};
