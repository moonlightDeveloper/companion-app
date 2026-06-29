/**
 * FLAG-46 gate-1 harness — self-serve continuation-detection check.
 *
 *   npx tsx scripts/check-continuation.mts <prior> <candidate> [<candidate> ...]
 *
 * Compares the PRIOR conversation against each candidate and prints the
 * detectContinuation scores, so you can validate on REAL data without a round
 * trip: a genuine continuation (incl. mixed-capture: screenshots-then-export)
 * should MATCH; a different conversation with the same person (shared small talk)
 * should NOT.
 *
 * Each arg is a file path. Accepts:
 *   .txt / .json / no-ext → read as raw conversation text
 *   .zip                  → WhatsApp export; the chat .txt is pulled out (FLAG-37)
 * For a screenshot-captured side, paste the extracted transcript into a .txt and
 * pass that (extraction itself needs the app's vision call).
 *
 * No network, no API key — pure local check of lib/continuation.ts.
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { detectContinuation } from "../lib/continuation.ts";

async function loadText(file: string): Promise<string> {
  const buf = fs.readFileSync(file);
  if (/\.zip$/i.test(file)) {
    const zip = await JSZip.loadAsync(buf);
    const txts = Object.values(zip.files).filter((f) => {
      const base = f.name.split("/").pop() ?? f.name;
      return !f.dir && /\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX/") && !base.startsWith("._");
    });
    if (txts.length === 0) throw new Error(`no chat .txt inside ${file}`);
    const chat =
      txts.find((f) => /(^|\/)_chat\.txt$/i.test(f.name)) ??
      txts.find((f) => /whatsapp chat with/i.test(f.name)) ??
      txts[0];
    return chat.async("string");
  }
  return buf.toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("usage: npx tsx scripts/check-continuation.mts <prior> <candidate> [<candidate> ...]");
    process.exit(1);
  }
  const [priorPath, ...candidates] = args;
  const prior = await loadText(priorPath);
  console.log(`PRIOR: ${path.basename(priorPath)}\n`);

  for (const c of candidates) {
    let r;
    try {
      r = detectContinuation(prior, await loadText(c));
    } catch (e) {
      console.log(`${path.basename(c)}: ERROR — ${e instanceof Error ? e.message : e}\n`);
      continue;
    }
    const ratio = r.priorLen ? (r.matched / r.priorLen) : 0;
    const verdict = r.identical
      ? "IDENTICAL re-send (no new tail)"
      : r.isContinuation
        ? "CONTINUATION → delta fires, FLAG-34 question suppressed"
        : "no match → normal read + normal FLAG-34 question";
    console.log(`${path.basename(c)}:`);
    console.log(`  longest ordered run: ${r.matched} / ${r.priorLen} prior msgs  (${(ratio * 100).toFixed(0)}%)`);
    console.log(`  isContinuation=${r.isContinuation}  identical=${r.identical}`);
    console.log(`  → ${verdict}\n`);
  }
  console.log("Reminder: a real continuation (incl. mixed-capture) should MATCH; a different");
  console.log("chat with the same person (shared greetings) should NOT. Thresholds: run >=8 AND >=85% of prior.");
}

main();
