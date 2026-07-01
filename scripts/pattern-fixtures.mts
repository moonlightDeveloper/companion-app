import { computePatternLine, type ReportLite } from "../lib/patternLine";
import type { AxisInstance, AxisLean, CanonicalAxis } from "../types";
const DAY = 86_400_000;
// build a report N days ago with given per-axis lean (1 instance each is enough for the mean)
function rep(daysAgo:number, axes: Partial<Record<CanonicalAxis,AxisLean>>): ReportLite {
  const instances: AxisInstance[] = Object.entries(axes).map(([axis,lean],i)=>({axis:axis as CanonicalAxis, lean:lean as AxisLean, ref:`${daysAgo}-${i}`}));
  return { createdAt: Date.now()-daysAgo*DAY, instances };
}
function show(name:string, reports:ReportLite[]) {
  const r = computePatternLine(reports, "Alex");
  console.log(`\n[${name}]`);
  console.log(`  trajectory=${r.trajectory} flavour=${r.flavour} safetyRaise=${r.safetyRaise}`);
  console.log(`  line: ${r.line === null ? "(null → teaser)" : JSON.stringify(r.line)}`);
}
// STUCK: same read x3 across 3 weeks
show("STUCK", [rep(14,{plan_clarity:"off",reply_consistency:"leaning"}), rep(7,{plan_clarity:"off",reply_consistency:"leaning"}), rep(0,{plan_clarity:"off",reply_consistency:"leaning"})]);
// WARMING: axes trend healthier
show("WARMING", [rep(14,{plan_clarity:"off",effort_balance:"off"}), rep(7,{plan_clarity:"leaning",effort_balance:"leaning"}), rep(0,{plan_clarity:"healthy",effort_balance:"healthy"})]);
// COOLING: axes trend worse
show("COOLING", [rep(14,{plan_clarity:"healthy",effort_balance:"healthy"}), rep(7,{plan_clarity:"leaning",effort_balance:"leaning"}), rep(0,{plan_clarity:"off",effort_balance:"off"})]);
// ESCALATION: boundary_response worsens
show("ESCALATION", [rep(14,{boundary_response:"leaning",plan_clarity:"off"}), rep(7,{boundary_response:"off",plan_clarity:"off"}), rep(0,{boundary_response:"off",plan_clarity:"off"})]);
// ONE-SIDED: effort_balance persistently off, no trajectory move
show("ONE-SIDED", [rep(14,{effort_balance:"off",reply_consistency:"leaning"}), rep(0,{effort_balance:"off",reply_consistency:"leaning"})]);
// n=1: single report → no line
show("N=1", [rep(0,{plan_clarity:"off"})]);
// SAME-AFTERNOON: two reports < 4d apart → no trajectory
show("SAME-AFTERNOON", [rep(1,{plan_clarity:"off"}), rep(0,{plan_clarity:"healthy"})]);
