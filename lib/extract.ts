import Anthropic from "@anthropic-ai/sdk";
import type { Transcript, TranscriptMessage } from "@/types";
import { modelFor } from "./models";

/** Thrown when the vision call fails or returns no transcript. */
export class ExtractError extends Error {}

export interface InputImage {
  media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64 image data, no data: prefix. */
  data: string;
}

function systemPrompt(nickname: string): string {
  return [
    "You convert dating-app/messaging screenshots into a clean, ordered transcript.",
    "",
    "ORDER: The images are given in the exact order the user arranged them — earliest first. Do NOT re-sort the images. Read each image top-to-bottom and concatenate across images in the given order. If visible timestamps clearly contradict that order, keep the given order; you may mention it in notes, but never silently reorder.",
    "",
    "SPEAKER: Infer from bubble side/colour. Right-aligned bubbles are the user — label them \"You\". Left-aligned bubbles are the other person — label them exactly with the nickname provided. Use only these two speakers.",
    "",
    `NICKNAME: The other person's nickname is "${nickname}". ALWAYS use it for their lines.`,
    "",
    "PRIVACY (critical): Ignore and strip any real name, @handle, phone number, or contact name visible in the screenshots (headers, contact rows, signatures). Never put a real name in the output — the other person is only ever the nickname. Never echo timestamps as speakers.",
    "",
    "Transcribe message text faithfully (keep emoji and wording). Skip UI chrome, reactions, read receipts, and typing indicators.",
    "",
    "VOICE MESSAGES: a voice-message bubble (a waveform/play button with a duration and NO text) is content you can't hear. Represent each one as a message whose text is exactly \"[voice message]\", attributed to the correct side. Do NOT guess what it said.",
    "",
    "NOT A CHAT: set notAChat to true ONLY when the image clearly isn't a messaging conversation at all — a settings screen, a photo, an incoming-call screen, a document. A sparse, thin, or one-sided REAL chat is still a chat: notAChat MUST be false for it. When in doubt, false.",
    "",
    "CONFIDENCE: also report how reliable this extraction is. confidence.level is \"low\" ONLY when extraction is clearly unreliable: unreadable/blurry/cropped text, you genuinely can't tell which side sent messages, the image isn't a chat at all, or the conversation is visibly cut off / structure dropped. Otherwise \"high\". Default to \"high\"; do NOT cry low for minor wording doubt. confidence.issues: a short list of concrete problems (empty array when high).",
    "",
    "Return the result by calling the emit_transcript tool — messages (each { speaker, text }), notAChat, and confidence { level, issues }. Do NOT write any prose, reasoning, or code fences; just call the tool.",
  ].join("\n");
}

/**
 * Forced tool-use (FLAG-26): the transcript comes back as schema-validated tool
 * input, never free-text JSON. Dense real chats made the model prepend reasoning
 * prose before the JSON, which the old text parser couldn't reliably recover
 * (~50% failure in prod). speaker stays a plain string — shapeGuard normalises
 * anything that isn't exactly "You" to the nickname.
 */
function transcriptTool(nickname: string): Anthropic.Tool {
  return {
    name: "emit_transcript",
    description: "Return the ordered chat transcript extracted from the screenshots.",
    input_schema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              speaker: { type: "string", description: `"You" or "${nickname}"` },
              text: { type: "string" },
            },
            required: ["speaker", "text"],
          },
        },
        notes: { type: "string", description: "Optional short note, or omitted." },
        notAChat: { type: "boolean" },
        confidence: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["high", "low"] },
            issues: { type: "array", items: { type: "string" } },
          },
          required: ["level", "issues"],
        },
      },
      required: ["messages", "notAChat", "confidence"],
    },
  };
}

export async function extractTranscript(
  images: InputImage[],
  nickname: string,
): Promise<Transcript> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "Them";

  const content: Anthropic.MessageParam["content"] = [
    ...images.map((img, i) => [
      { type: "text" as const, text: `Image ${i + 1} of ${images.length}:` },
      {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: img.media_type,
          data: img.data,
        },
      },
    ]).flat(),
    {
      type: "text" as const,
      text: `Produce the ordered transcript now. The other person is "${name}".`,
    },
  ];

  let input: unknown;
  try {
    const response = await client.messages.create({
      model: modelFor("extract"),
      // Headroom (FLAG-26 secondary guard): a dense multi-image transcript can run
      // ~2k+ output tokens; 2000 was a real ceiling. We only pay for tokens
      // actually generated, so the headroom is ~free.
      max_tokens: 8000,
      system: systemPrompt(name),
      messages: [{ role: "user", content }],
      tools: [transcriptTool(name)],
      tool_choice: { type: "tool", name: "emit_transcript" },
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new ExtractError("Model did not return a transcript");
    }
    input = toolUse.input;
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(
      err instanceof Error ? err.message : "Vision request failed",
    );
  }

  return shapeGuard(input, name);
}

function shapeGuard(raw: unknown, nickname: string): Transcript {
  const obj = isRecord(raw) ? raw : {};
  const rawMessages = Array.isArray(obj.messages) ? obj.messages : [];
  const messages: TranscriptMessage[] = rawMessages
    .map((m): TranscriptMessage => {
      const r = isRecord(m) ? m : {};
      const text = typeof r.text === "string" ? r.text.trim() : "";
      // Anything that isn't exactly "You" is normalised to the nickname so a
      // stray real name can never leak through.
      const speaker = r.speaker === "You" ? "You" : nickname;
      return { speaker, text };
    })
    .filter((m) => m.text.length > 0);

  const c = isRecord(obj.confidence) ? obj.confidence : {};
  const confidence = {
    level: c.level === "low" ? ("low" as const) : ("high" as const),
    issues: Array.isArray(c.issues)
      ? c.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      : [],
  };

  return {
    messages,
    notes: typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined,
    confidence,
    notAChat: obj.notAChat === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flatten a confirmed transcript to the same text shape pasted text uses. */
export function transcriptToText(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => `${m.speaker}: ${m.text}`)
    .join("\n");
}
