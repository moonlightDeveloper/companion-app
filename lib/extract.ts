import Anthropic from "@anthropic-ai/sdk";
import type { Transcript, TranscriptMessage } from "@/types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Thrown when the vision call or JSON parsing fails. */
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
    "Output ONLY JSON of this exact shape, no prose, no code fences:",
    '{ "messages": [ { "speaker": "You" | "' + nickname + '", "text": "..." } ], "notes": "optional short note or empty" }',
  ].join("\n");
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

  let text: string;
  try {
    const response = await client.messages.create({
      model: process.env.MODEL || DEFAULT_MODEL,
      max_tokens: 2000,
      system: systemPrompt(name),
      messages: [{ role: "user", content }],
    });
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (err) {
    throw new ExtractError(
      err instanceof Error ? err.message : "Vision request failed",
    );
  }

  return shapeGuard(parseJson(text), name);
}

function parseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
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
    throw new ExtractError("Model returned invalid JSON");
  }
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

  return {
    messages,
    notes: typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined,
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
