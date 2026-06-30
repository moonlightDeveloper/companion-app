/**
 * FLAG-46 gate-1 deep diagnostic — why did a real pair (NOT) detect as a continuation?
 *
 *   npx tsx scripts/diagnose-continuation.mts <prior.(txt|zip)> <continuation.(txt|zip)>
 *
 * Mirrors the app's exact pipeline: parse each WhatsApp export → flatten to
 * "speaker: text" (as stored) → run detectContinuation. Then prints the REAL
 * numbers: normalized message counts, the longest contiguous run, the run ratio vs
 * the 0.85 threshold and the 8-message floor, identical/continuation verdict — AND
 * the point where the prior STOPS matching the new (with the surrounding normalized
 * lines from each), so a normalization mismatch (same messages parsing differently)
 * is visible vs a threshold-too-strict miss. No network.
 */
import fs from "fs";
import JSZip from "jszip";
import { parseWhatsAppExport } from "../lib/whatsapp";
import { detectContinuation, debugMessageContents } from "../lib/continuation";

async function loadText(file: string): Promise<string> {
  const buf = fs.readFileSync(file);
  if (/\.zip$/i.test(file)) {
    const zip = await JSZip.loadAsync(buf);
    const txts = Object.values(zip.files).filter((f) => {
      const base = f.name.split("/").pop() ?? f.name;
      return !f.dir && /\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX/") && !base.startsWith("._");
    });
    if (txts.length === 0) throw new Error(`no chat .txt in ${file}`);
    const chat =
      txts.find((f) => /(^|\/)_chat\.txt$/i.test(f.name)) ??
      txts.find((f) => /whatsapp chat with/i.test(f.name)) ??
      txts[0];
    return chat.async("string");
  }
  return buf.toString("utf8");
}

/** App pipeline: WhatsApp parse → flatten "speaker: text" (what gets stored / detected). */
function asStored(raw: string): string {
  const { messages } = parseWhatsAppExport(raw);
  if (messages.length === 0) return raw; // not a WhatsApp export — use as-is
  return messages.map((m) => `${m.sender}: ${m.text}`).join("\n");
}

async function main() {
  const [pf, nf] = process.argv.slice(2);
  if (!pf || !nf) {
    console.error("usage: npx tsx scripts/diagnose-continuation.mts <prior> <continuation>");
    process.exit(1);
  }
  const prior = asStored(await loadText(pf));
  const next = asStored(await loadText(nf));
  const a = debugMessageContents(prior);
  const b = debugMessageContents(next);
  const r = detectContinuation(prior, next);

  const MIN_PRIOR = 8, MIN_RUN = 8, RATIO = 0.85;
  const need = Math.ceil(a.length * RATIO);
  // True overlap, independent of the floors: longest ordered prefix that aligns.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  console.log("=== normalized message counts (after stripping timestamps/labels/media) ===");
  console.log(`prior: ${a.length}   continuation: ${b.length}`);
  console.log("\n=== thresholds ===");
  console.log(`prior >= MIN_PRIOR(8)?     ${a.length} → ${a.length >= MIN_PRIOR ? "ok" : "BELOW FLOOR — detection bails here"}`);
  console.log(`longest contiguous run     : ${r.matched}  (run floor: >= ${MIN_RUN})`);
  console.log(`ratio run/prior            : ${(a.length ? r.matched / a.length : 0).toFixed(2)}  (need >= ${RATIO} → ${need} msgs)`);
  console.log(`isContinuation=${r.isContinuation}  nothingNew=${r.nothingNew}  identical=${r.identical}`);

  console.log(`\n=== true overlap (ignores floors) ===`);
  console.log(`ordered opening prefix that aligns: ${prefix} of ${a.length} prior messages`);
  if (prefix < a.length) {
    console.log(`first DIVERGENCE at index ${prefix}:`);
    console.log(`  prior[${prefix}]:        ${JSON.stringify(a[prefix] ?? "(end)")}`);
    console.log(`  continuation[${prefix}]: ${JSON.stringify(b[prefix] ?? "(end)")}`);
  }

  console.log("\n=== verdict ===");
  const aligns = prefix >= a.length - 1 && b.length > a.length; // prior ~fully inside new, with a tail
  if (r.isContinuation) console.log("WOULD DETECT — before/after delta fires.");
  else if (r.nothingNew)
    console.log(`NOTHING NEW (${r.identical ? "identical re-send" : "subset / earlier upload"}) — shows the calm "nothing new since then" note, no before/after, no fresh-read question.`);
  else if (a.length < MIN_PRIOR)
    console.log(`MISS (FLOOR): prior normalized to ${a.length} msgs (< ${MIN_PRIOR}). Media/short messages shrink the count under the floor even on a real continuation. → lower MIN_PRIOR / MIN_RUN, or count pre-normalization.`);
  else if (aligns)
    console.log(`MISS (THRESHOLD): the prior aligns as a ${prefix}/${a.length} prefix with a tail — a REAL continuation — but run ${r.matched} < 85% (${need}). Lower the ratio / use floor-only.`);
  else if (prefix < a.length / 2)
    console.log(`MISS (NORMALIZATION): the prior diverges from the continuation early (prefix ${prefix}/${a.length}) — the same messages are normalizing differently between the two captures. Fix normalization (compare the divergent lines above).`);
  else
    console.log(`MISS: run ${r.matched} below 85% (${need}) and floor — inspect the divergence above.`);
}

main();
