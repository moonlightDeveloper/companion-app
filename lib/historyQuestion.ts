import Anthropic from "@anthropic-ai/sdk";
import type { Read } from "@/types";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled, MOCK_HISTORY_Q } from "./mockLlm";

export class HistoryQuestionError extends Error {}

/**
 * FLAG-34: one personal pre-read question for a returning user, grounded in the
 * SINGLE most-recent prior read they already saw.
 *
 * The line that keeps this FREE (vs the paid cross-report pattern insight, §2.5):
 * this ASKS about one read the user already has; it never SYNTHESIZES across
 * reads, counts occurrences, or names an overall pattern. Feeding only one read
 * makes the paid synthesis structurally impossible to produce here.
 */
const SYSTEM = [
  "You write ONE short, personal question to ask the user RIGHT BEFORE a new behaviour read — based ONLY on the single most recent read they already got about this same person.",
  "",
  "Purpose: name one concrete behaviour from that last read the user already saw, and ask whether the SAME thing is showing up in the new conversation or has shifted. It personalises the moment and helps sharpen the new read.",
  "",
  "Rules:",
  "- Reference ONLY that one prior read. Do NOT synthesize across multiple reads, do NOT count occurrences (\"third time\"), do NOT state a cross-read conclusion or name an overall \"pattern\". You are asking about ONE remembered thing, not delivering an insight.",
  "- Anchor to a concrete OBSERVED behaviour from that read (effort, plans, tone, follow-through) — never intent or mind-reading, never the user's feelings.",
  "- Ask a real comparison: is that same thing happening again here, or did it shift? Phrase so \"not sure / skip\" is clearly fine. Neutral — never lead toward the comforting reading.",
  "- Voice (§2.10): a sharp, plain-spoken friend who's openly a tool — warm, direct, takes a position. Honest over comforting. No therapy-speak, no folksy or cute quips, no performed feelings.",
  "- Point toward clarity, never toward re-checking or coming back (§2.3).",
  "- Evidence, not identity: no named places, employers, schools, or identifying particulars; the other person is only the nickname.",
  "- ONE sentence, max ~30 words. Output ONLY the question text — no preamble, no quotes, no JSON.",
].join("\n");

/** One question grounded in a single prior read, or "" if none can be formed. */
export async function historyQuestion(read: Read, nickname: string): Promise<string> {
  if (mockLlmEnabled()) return MOCK_HISTORY_Q;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new HistoryQuestionError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "them";

  // Only the read summary (which quotes its own evidence and is already scrubbed,
  // §2.2) — never a conversation.
  const bars = read.bars.map((b) => `${b.label} ${b.level}/100 (${b.tag})`).join(", ");
  const cards = read.cards.map((c) => `${c.kind}: ${c.title} — ${c.body}`).join("; ");
  const summary = `${read.headline} [${read.status_tag}]. ${bars}. ${cards}.`;

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("history"),
      max_tokens: 150,
      system: cachedSystem(SYSTEM),
      messages: [
        {
          role: "user",
          content: `The most recent read about "${name}":\n${summary}\n\nWrite the one question.`,
        },
      ],
    });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    throw new HistoryQuestionError(
      err instanceof Error ? err.message : "History question request failed",
    );
  }

  return text.replace(/^["']|["']$/g, "").trim();
}
