/**
 * WhatsApp parse harness — diagnose why a .txt/.zip export parses the way it does.
 *
 *   npx tsx scripts/check-whatsapp.mts <file.txt | file.zip>
 *
 * Prints the parsed message count, the distinct senders, how many lines became
 * media/voice gaps, and the FIRST raw lines (so an unrecognised date/sender format
 * is visible). Media lines are NORMAL — they become [media]/[voice message] gaps,
 * never a rejection. A real failure is messages=0 (format not recognised) or
 * senders<2 (only one side present). No network; pure check of lib/whatsapp.ts.
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { parseWhatsAppExport } from "../lib/whatsapp";

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
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/check-whatsapp.mts <file.txt | file.zip>");
    process.exit(1);
  }
  const raw = await loadText(file);
  const rawLines = raw.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const { messages, senders } = parseWhatsAppExport(raw);
  const media = messages.filter((m) => m.text === "[media]" || m.text === "[voice message]").length;

  console.log(`FILE: ${path.basename(file)}`);
  console.log(`raw non-empty lines: ${rawLines.length}`);
  console.log(`parsed messages:     ${messages.length}`);
  console.log(`distinct senders:    ${JSON.stringify(senders)}  (need >= 2)`);
  console.log(`media/voice gaps:    ${media}  (normal — not a problem)`);
  const ok = messages.length > 0 && senders.length >= 2;
  console.log(`\n${ok ? "PASS — this would import fine." : "FAIL — " + (messages.length === 0 ? "no messages parsed (date/sender format not recognised)." : "only one side parsed (the other sender's lines didn't parse).")}`);

  if (!ok) {
    console.log("\nFirst 8 raw lines (so the format is visible — sanitize before sharing):");
    rawLines.slice(0, 8).forEach((l, i) => console.log(`  ${i + 1}| ${JSON.stringify(l)}`));
  }
}

main();
