import Anthropic from "@anthropic-ai/sdk";
import type { Read } from "@/types";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled } from "./mockLlm";

export class DeltaError extends Error {}

/**
 * FLAG-46: one calm sentence on what CHANGED between the user's last read and
 * this one about the same person (a re-sent, continued conversation). Compares
 * the two scrubbed Read objects — never the conversation. Supplements the read;
 * it does not replace it.
 */
const SYSTEM = [
  "You compare TWO behaviour reads about the SAME person — the user's PREVIOUS read and their NEW one (same conversation, continued) — and say in ONE calm sentence what CHANGED.",
  "",
  "Rules:",
  "- ONE plain-language observation about what MOVED between the two reads. No lists, no preamble, no markdown.",
  "- Anchor to BEHAVIOUR that changed, not intent or feelings: 'last time plans kept slipping; this time they named an actual day' / 'the warmth held but replies went from same-day to two-day gaps'. Never mind-read.",
  "- Only call out a MEANINGFUL change. If nothing meaningful moved, say exactly that in one calm sentence (e.g. 'This is largely the same as last time — same warmth, same vague plans.'). NEVER manufacture a difference to seem useful.",
  "- Calm, not alarmist (it's 'here's what moved', never 'concerning development'). Point toward clarity.",
  "- No self-blame: describe THEIR behaviour changing, never frame it as something the user did wrong.",
  "- Evidence, not identity: no named places, employers, schools, or identifying particulars — generalize them. The other person is only the nickname.",
  "- Voice: a sharp, plain-spoken friend who's openly a tool — warm, direct, honest over comforting. No therapy-speak, no folksy quips.",
  "- ~1 sentence, max ~30 words.",
].join("\n");

function summarize(r: Read): string {
  const bars = r.bars.map((b) => `${b.label} ${b.level}/100 (${b.tag})`).join(", ");
  const cards = r.cards.map((c) => `${c.kind}: ${c.title}`).join("; ");
  return `${r.headline} [${r.status_tag}]. ${bars}. ${cards}.`;
}

/** One sentence on what changed, or "" on failure (never blocks the read). */
export async function describeDelta(prev: Read, next: Read, nickname: string): Promise<string> {
  if (mockLlmEnabled()) return "(mock) Since last time, the plans went from vague to an actual named day.";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new DeltaError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "them";

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("delta"),
      max_tokens: 200,
      system: cachedSystem(SYSTEM),
      messages: [
        {
          role: "user",
          content: `Same person, "${name}".\n\nPREVIOUS read:\n${summarize(prev)}\n\nNEW read:\n${summarize(next)}\n\nIn one calm sentence, what changed?`,
        },
      ],
    });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    throw new DeltaError(err instanceof Error ? err.message : "Delta request failed");
  }

  return text.replace(/^["']|["']$/g, "").trim();
}
