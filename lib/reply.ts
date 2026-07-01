import Anthropic from "@anthropic-ai/sdk";
import type { ReplyDraft } from "@/types";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled, MOCK_REPLY } from "./mockLlm";

/** Thrown when the model call or JSON parsing fails. */
export class ReplyError extends Error {}

function systemPrompt(nickname: string, safety: boolean): string {
  const lines = [
    "You help the user write their next message in a dating/messaging conversation.",
    "",
    `You are given the conversation so far (the other person is "${nickname}") and what the user wants to get across. Write 2–3 short reply options the USER could send, each in a clearly different tone (e.g. warm, direct, light/playful).`,
    "",
    "Rules:",
    "- Each draft is something the user sends — first person, natural, texting-length (1–3 sentences).",
    "- Honour the user's stated intent; don't invent facts or commitments.",
    "- No real names; refer to the other person naturally if needed.",
    "- No preamble, no coaching — just the messages.",
  ];
  if (safety) {
    // FLAG-59: this conversation flagged for boundary-override / coercion. The user is
    // free to reply, but the drafts must HOLD THE LINE, never help them appease.
    lines.push(
      "",
      "IMPORTANT — this conversation shows the other person overriding a stated limit or pushing past a 'no'. Bias EVERY draft toward clear, firm, boundary-holding language, or a clean disengagement. The tones here are variations of firmness (e.g. Clear, Firm, Done) — never warm/playful/rapport-building. Do NOT smooth it over, soften or walk back the boundary, apologise for having a limit, over-explain, justify, or negotiate. The user owes them nothing — a reply can simply restate the limit once, or end the conversation. Honour the user's stated intent, but keep it firm.",
    );
  }
  lines.push(
    "",
    "Output ONLY JSON of this exact shape, no prose, no code fences:",
    '{ "drafts": [ { "tone": "Warm", "text": "..." } ] }',
  );
  return lines.join("\n");
}

export async function draftReplies(params: {
  conversation: string;
  intent: string;
  nickname: string;
  safety?: boolean;
}): Promise<ReplyDraft[]> {
  if (mockLlmEnabled()) return MOCK_REPLY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ReplyError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = params.nickname.trim() || "them";

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("reply"),
      max_tokens: 1024,
      system: cachedSystem(systemPrompt(name, params.safety === true)),
      messages: [
        {
          role: "user",
          content: `Conversation so far:\n${params.conversation}\n\nWhat I want to get across: ${params.intent}`,
        },
      ],
    });
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (err) {
    throw new ReplyError(err instanceof Error ? err.message : "Reply request failed");
  }

  return shapeGuard(parseJson(text));
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ReplyError("Model returned invalid JSON");
  }
}

function shapeGuard(raw: unknown): ReplyDraft[] {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.drafts) ? obj.drafts : [];
  return list
    .map((d): ReplyDraft => {
      const r = typeof d === "object" && d !== null ? (d as Record<string, unknown>) : {};
      return {
        tone: typeof r.tone === "string" && r.tone.trim() ? r.tone.trim() : "Option",
        text: typeof r.text === "string" ? r.text.trim() : "",
      };
    })
    .filter((d) => d.text.length > 0)
    .slice(0, 3);
}
