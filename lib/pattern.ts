import Anthropic from "@anthropic-ai/sdk";
import type { Read } from "@/types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class PatternError extends Error {}

const SYSTEM = [
  "You look across several behaviour reads the user has gotten about ONE person over time, and name the pattern in a single calm sentence.",
  "",
  "Rules:",
  "- ONE plain-language observation. No lists, no preamble, no markdown.",
  "- It's about the USER's recurring experience (\"this keeps happening to you\"), never a profile of the other person and never a real name.",
  "- Point toward clarity/resolution (\"here's what keeps happening\"), NEVER toward re-checking or coming back (\"watch for changes\", \"check again\").",
  "- Reference what actually recurs across the reads (effort, plans, tone shifts). If the reads don't share a clear pattern, say so plainly in one sentence.",
  "- Evidence, not identity: no named places, neighbourhoods, cities, venues, employers, schools, or identifying particulars — generalize them (a city, their work). The other person is only the nickname.",
  "- Calm and kind, ~1 sentence, max ~30 words.",
].join("\n");

/** One quiet cross-report observation. Caller ensures there are 2+ reads. */
export async function synthesizePattern(reads: Read[], nickname: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new PatternError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "them";

  // Feed only the read summaries (which quote their own evidence, §2.2) — no conversation.
  const summary = reads
    .map((r, i) => {
      const bars = r.bars.map((b) => `${b.label} ${b.level}/100 (${b.tag})`).join(", ");
      const points = r.cards.map((c) => `${c.kind}: ${c.title}`).join("; ");
      return `Read ${i + 1}: ${r.headline} [${r.status_tag}]. ${bars}. ${points}.`;
    })
    .join("\n");

  let text: string;
  try {
    const response = await client.messages.create({
      model: process.env.MODEL || DEFAULT_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `These are ${reads.length} reads about "${name}", newest first:\n\n${summary}\n\nName the pattern in one calm sentence.`,
        },
      ],
    });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    throw new PatternError(err instanceof Error ? err.message : "Pattern request failed");
  }

  return text.replace(/^["']|["']$/g, "").trim();
}
