/**
 * FLAG-62 gate-1 harness: cadence-timing accuracy against LABELLED ground truth.
 * Run: `npx tsx scripts/timing-fixtures.mts`. Privacy is settled (FLAG-60); this proves
 * accuracy + the conservative-null bias. Threshold calibration is forward-only (real
 * multi-report data) and NOT covered here.
 */
import { timingFromText, timingFromMessageTimes } from "../lib/timing";
import { whatsappTimestamps } from "../lib/whatsapp";
import { computeTimingFeatures, deriveCadence } from "../lib/timing";
import type { TimingFeatures } from "../types";

const MIN = 60_000;
const HOUR = 60 * MIN;
let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// Accuracy: extracted features within tol of the known-true gaps (minutes).
function checkAccuracy(name: string, f: TimingFeatures | null, truthMin: { span: number; median: number; longest: number }, tol = 0.02) {
  if (!f) return ok(name, false, "expected features, got null");
  const got = { span: f.spanMs / MIN, median: f.medianGapMs / MIN, longest: f.longestGapMs / MIN };
  const err = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / b);
  const e = Math.max(err(got.span, truthMin.span), err(got.median, truthMin.median), err(got.longest, truthMin.longest));
  ok(name, e <= tol, `err=${(e * 100).toFixed(1)}% got=${JSON.stringify({ span: got.span, median: got.median, longest: got.longest })} truth=${JSON.stringify(truthMin)}`);
}

console.log("\n── PASTE (inline clock labels) ──");
// P1 single-day: 10:00,10:05,10:35,11:35,12:00 → gaps 5,30,60,25 → median 27.5, longest 60, span 120
checkAccuracy("P1 single-day", timingFromText("You: a 10:00\nThem: b 10:05\nYou: c 10:35\nThem: d 11:35\nYou: e 12:00"), { span: 120, median: 27.5, longest: 60 });
// P2 overnight rollover: 23:00→08:00 (+1d),08:30,09:00 → gaps 540,30,30 → median 30, longest 540, span 600
checkAccuracy("P2 overnight rollover", timingFromText("Them: n 23:00\nYou: r 08:00\nThem: b 08:30\nYou: c 09:00"), { span: 600, median: 30, longest: 540 });
// P3 12-hour clock: 10:00a,10:30a,2:00p,2:15p → gaps 30,210,15 → median 30, longest 210, span 255
checkAccuracy("P3 12-hour clock", timingFromText("You: a 10:00 AM\nThem: b 10:30 AM\nYou: c 2:00 PM\nThem: d 2:15 PM"), { span: 255, median: 30, longest: 210 });
// P4 day-marker: Yesterday 22:00,22:10 / Today 09:00,09:05 → gaps 10, ~10.83h, 5
checkAccuracy("P4 day-marker", timingFromText("Yesterday\nThem: a 22:00\nYou: b 22:10\nToday\nThem: c 09:00\nYou: d 09:05"), { span: 665, median: 10, longest: 650 });

console.log("\n── PASTE conservative-null (uncertain → no timing) ──");
ok("P5 no times → null", timingFromText("You: hey\nThem: hi\nYou: sup\nThem: nm") === null);
ok("P6 low coverage → null", timingFromText("You: a 10:00\nThem: b\nYou: c\nThem: d\nYou: e\nThem: f 10:30") === null);
ok("P7 scrambled order → null", timingFromText("You: a 10:00\nThem: b 09:00\nYou: c 11:00\nThem: d 08:00\nYou: e 12:00\nThem: f 07:00") === null);

console.log("\n── SCREENSHOT (extracted per-message times) ──");
// S1 full: 10:42,10:45,11:30,12:00,13:15 → gaps 3,45,30,75 → median 37.5, longest 75, span 153
checkAccuracy("S1 full labels", timingFromMessageTimes(["10:42", "10:45", "11:30", "12:00", "1:15 PM"]), { span: 153, median: 37.5, longest: 75 });
ok("S2 partial coverage → null", timingFromMessageTimes(["10:42", undefined, undefined, undefined, "11:30"]) === null);
ok("S3 relative labels ('2 min ago') → null", timingFromMessageTimes(["2 min ago", "5 min ago", "just now", "1 hr ago"]) === null);

console.log("\n── WHATSAPP locale (day/month disambiguation) ──");
const waGap = (raw: string) => { const t = whatsappTimestamps(raw); return t.length >= 2 ? (t[t.length - 1] - t[0]) / HOUR : NaN; };
// DD/MM (13 = day): 13 Jan 10:00 → 14 Jan 09:00 = 23h
ok("WA DD/MM (day 13)", Math.abs(waGap("[13/01/2024, 10:00:00] You: a\n[13/01/2024, 10:30:00] Them: b\n[14/01/2024, 09:00:00] You: c") - 23) < 0.01, `${waGap("[13/01/2024, 10:00:00] You: a\n[14/01/2024, 09:00:00] Them: b").toFixed(1)}h span check`);
// MM/DD (US, day 13 in 2nd slot → month-first forced): 01/13 10:00 → 01/14 09:00 = 23h
ok("WA MM/DD (US, day 13)", Math.abs(waGap("[01/13/2024, 10:00:00] You: a\n[01/13/2024, 10:30:00] Them: b\n[01/14/2024, 09:00:00] You: c") - 23) < 0.01);

console.log("\n── EVIDENCE BAR (applies to all inputs) ──");
const f = computeTimingFeatures([0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR]);
ok("one report → no cadence", deriveCadence([f]) === null);
ok("null timing can't clear the bar", deriveCadence([null, null]) === null);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
