import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";
import { LATER_TIMEPOINT_MIN_INTERVAL } from "@/lib/recurrence";
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ instances: [], laterTimepoint: false });
  const { id } = await params;
  try {
    const reports = await listReports(userId, id); // ownership-checked, newest first
    const instances: AxisInstance[] = [];
    const timesWithInstances: number[] = [];
    for (const r of reports) {
      const tagged = (r.result.axisInstances ?? []).filter((a) => AXES.has(a.axis) && !!a.ref);
      if (tagged.length > 0) timesWithInstances.push(new Date(r.created_at).getTime());
      instances.push(...tagged);
    }
    // A real interval — not just "≥2 reports": two reports filed the same afternoon
    // must NOT let the over-time pattern line fire.
    const laterTimepoint =
      timesWithInstances.length >= 2 &&
      Math.max(...timesWithInstances) - Math.min(...timesWithInstances) >=
        LATER_TIMEPOINT_MIN_INTERVAL;
    return NextResponse.json({ instances, laterTimepoint });
  } catch (err) {
    console.error("summary failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ instances: [], laterTimepoint: false });
  }
}
