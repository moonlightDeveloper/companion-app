/**
 * FLAG-46 mixed-capture diagnosis — why a continuation across capture formats
 * (WhatsApp-export PRIOR vs screenshot-extracted NEW) doesn't detect.
 *
 *   npx tsx scripts/diagnose-mixed.mts calibration/mixed-prior.txt calibration/mixed-new.txt
 *
 * Inputs are the ALREADY-STORED conversation text (the "Speaker: text" form from
 * IndexedDB) — NOT raw exports. We run the REAL detector, then re-test under
 * progressively stronger normalization to ATTRIBUTE the miss:
 *   L0 current   : split on \n + toContent (exact match)            ← what runs today
 *   L1 +content  : same segmentation, strip punctuation/emoji/accents ← isolates CONTENT drift
 *   L2 +resegment: merge continuation lines into their message, then L1 ← isolates SEGMENTATION drift
 * If the longest run jumps at L1, it's transcription drift; if only at L2, it's
 * multi-line/bubble segmentation. The fix follows whichever layer recovers the run.
 */
import fs from "fs";
import { detectContinuation, debugMessageContents } from "../lib/continuation";

const RATIO = 0.85, MIN_PRIOR = 8, MIN_RUN = 8;

/** Longest contiguous run where a[i..] === b[j..] (same as lib/continuation). */
function longestRun(a: string[], b: string[]): { len: number; ai: number; bi: number } {
  let best = 0, ai = -1, bi = -1;
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      if (a[i - 1] === b[j - 1]) {
        row[j] = diag + 1;
        if (row[j] > best) { best = row[j]; ai = i - 1; bi = j - 1; }
      } else row[j] = 0;
      diag = tmp;
    }
  }
  return { len: best, ai, bi };
}

const isPrefixLine = (l: string) => /^\s*[^:\n]{1,40}:\s+\S/.test(l);

/** Re-segment: a message STARTS at a "Speaker:" line; lines without a prefix are
 *  continuation lines of the message above (multi-line message / wrapped bubble). */
function resegment(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    if (isPrefixLine(raw) || out.length === 0) out.push(raw);
    else out[out.length - 1] += " " + raw.trim();
  }
  return out;
}

/** Aggressive content normalize: drop label, lowercase, strip punctuation/emoji/
 *  symbols (keep letters+numbers+spaces), collapse whitespace. */
function aggressive(line: string): string {
  let s = line.replace(/^\s*[^:\n]{1,40}:\s+/, "").toLowerCase().normalize("NFKD");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, "");
  return s.replace(/\s+/g, " ").trim();
}

function l1(text: string): string[] {
  return text.split("\n").map(aggressive).filter((l) => l.length > 0);
}
function l2(text: string): string[] {
  return resegment(text).map(aggressive).filter((l) => l.length > 0);
}

function report(name: string, a: string[], b: string[]) {
  const { len, ai, bi } = longestRun(a, b);
  const need = Math.ceil(a.length * RATIO);
  const floorOk = a.length >= MIN_PRIOR && len >= MIN_RUN;
  const covers = len >= need;
  console.log(
    `${name.padEnd(12)} prior=${String(a.length).padStart(3)} new=${String(b.length).padStart(3)} ` +
      `run=${String(len).padStart(3)} ratio=${(a.length ? len / a.length : 0).toFixed(2)} ` +
      `need>=${need}  ${floorOk && covers ? "WOULD DETECT ✅" : "no ❌"}`,
  );
  return { len, ai, bi };
}

function main() {
  const [pf, nf] = process.argv.slice(2);
  if (!pf || !nf) { console.error("usage: diagnose-mixed.mts <prior> <new>"); process.exit(1); }
  const prior = fs.readFileSync(pf, "utf8");
  const next = fs.readFileSync(nf, "utf8");

  // L0 — exactly what the app runs today.
  const a0 = debugMessageContents(prior), b0 = debugMessageContents(next);
  const r = detectContinuation(prior, next);
  console.log("=== L0 current (the app's real result) ===");
  report("L0 current", a0, b0);
  console.log(`detectContinuation -> isContinuation=${r.isContinuation} nothingNew=${r.nothingNew} matched=${r.matched}\n`);

  console.log("=== stronger normalization (attribution) ===");
  report("L1 +content", l1(prior), l1(next));
  const r2a = l2(prior), r2b = l2(next);
  const r2 = report("L2 +reseg", r2a, r2b);

  // Show where L2 (best case) breaks — the lines right after the longest run end.
  console.log("\n=== L2 divergence (first mismatch after the longest run) ===");
  const pa = r2.ai + r2.len, pb = r2.bi + r2.len;
  for (let k = -2; k < 3; k++) {
    const i = pa + k, j = pb + k;
    const mark = k < 0 ? "  ok " : k === 0 ? " >>> " : "     ";
    console.log(`${mark}prior[${i}]: ${JSON.stringify(r2a[i] ?? "(end)")}`);
    console.log(`${mark} new [${j}]: ${JSON.stringify(r2b[j] ?? "(end)")}`);
  }

  // Segmentation probe: how many prior entries are continuation lines (no prefix)?
  const contLines = prior.split("\n").filter((l) => l.trim() && !isPrefixLine(l)).length;
  console.log(`\nprior continuation (no-prefix) lines: ${contLines}  (these fragment messages on the \\n split)`);
}

main();
