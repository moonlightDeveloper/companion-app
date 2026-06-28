import Anthropic from "@anthropic-ai/sdk";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled, MOCK_CLARIFY } from "./mockLlm";

export class ClarifyError extends Error {}

const SYSTEM = `You are the pre-read clarification pass for Companion, a tool that reads the BEHAVIOUR in a confusing dating conversation. BEFORE the read is generated, you inspect the conversation and decide whether any genuine ambiguity would CHANGE the read. Return 0, 1, or at most 2 questions.

THRESHOLD — bias hard toward asking NOTHING:
- The user has ALREADY answered intake questions about their situation. Don't stack another interview. The bar is: would ONE more question actually fork the verdict?
- Return ZERO questions whenever the read is already mostly clear. Zero is the normal, correct outcome. A question whose answer wouldn't move the verdict must not be asked. Do not invent ambiguity to seem thorough.
- HARD CAP: 2. No follow-ups, no "one more thing".

WHAT TO ASK ABOUT:
- The CONVERSATION'S MEANING or missing context only: the tone of a specific line (easygoing vs brush-off), whether a vague plan ever got a real time, or context you can't see (sorted in person/elsewhere).
- NEVER the user's feelings or state. Forbidden: "how did that make you feel", "what's worrying you", anything about the user. The subject is always the texts.

HOW TO ASK (voice):
- Plain, short, specific — a sharp friend pointing at one line. Quote the line. One sentence.
- Neutral. Never lead toward the comforting reading. Phrase so "not sure / skip" is fine.

EXAMPLES (conversation → output):
- "You: dinner tuesday 7:30? / Match: yes booked it, see you there" -> {"questions":[]}
- "You: how was your weekend / Match: good / You: drinks sometime? / Match: yeah maybe / You: this week? / Match: swamped, we'll see" -> {"questions":[{"q":"After 'we'll see' — did Match ever follow up, or has it gone quiet?","why":"genuine busy vs soft no"}]}
- "You: are we actually doing this / Match: lol sure / You: when works / Match: idk we'll figure it out lol" -> {"questions":[{"q":"That 'lol sure' — was a real plan already on the table, or is this the first mention of meeting?","why":"stalling on something real vs vague from the start"}]}

Output ONLY minified JSON, no prose or code fences:
{"questions":[{"q":"the question","why":"which way the read changes"}]}
0–2 items; empty array if the conversation is clear.`;

/** 0–2 plain clarifying questions about the conversation, or [] if it's clear. */
export async function clarifyQuestions(
  conversation: string,
  nickname: string,
): Promise<string[]> {
  if (mockLlmEnabled()) return MOCK_CLARIFY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClarifyError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "them";

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("clarify"),
      max_tokens: 500,
      system: cachedSystem(SYSTEM),
      messages: [
        {
          role: "user",
          content: `The conversation (the other person is "${name}"):\n${conversation}\n\nReturn the clarification questions JSON.`,
        },
      ],
    });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    throw new ClarifyError(err instanceof Error ? err.message : "Clarify request failed");
  }

  return shapeGuard(parseJson(text));
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
    return { questions: [] }; // never block the read on a parse failure
  }
}

function shapeGuard(raw: unknown): string[] {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.questions) ? obj.questions : [];
  return list
    .map((q) => {
      if (typeof q === "string") return q.trim();
      const r = typeof q === "object" && q !== null ? (q as Record<string, unknown>) : {};
      return typeof r.q === "string" ? r.q.trim() : "";
    })
    .filter((q) => q.length > 0)
    .slice(0, 2); // hard cap
}
