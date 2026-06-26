import Anthropic from "@anthropic-ai/sdk";
import type { Transcript, TranscriptMessage } from "@/types";
import { modelFor } from "./models";

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
    "VOICE MESSAGES: a voice-message bubble (a waveform/play button with a duration and NO text) is content you can't hear. Represent each one as a message whose text is exactly \"[voice message]\", attributed to the correct side. Do NOT guess what it said.",
    "",
    "NOT A CHAT: set notAChat to true ONLY when the image clearly isn't a messaging conversation at all — a settings screen, a photo, an incoming-call screen, a document. A sparse, thin, or one-sided REAL chat is still a chat: notAChat MUST be false for it. When in doubt, false.",
    "",
    "CONFIDENCE: also report how reliable this extraction is. confidence.level is \"low\" ONLY when extraction is clearly unreliable: unreadable/blurry/cropped text, you genuinely can't tell which side sent messages, the image isn't a chat at all, or the conversation is visibly cut off / structure dropped. Otherwise \"high\". Default to \"high\"; do NOT cry low for minor wording doubt. confidence.issues: a short list of concrete problems (empty array when high).",
    "",
    "Output ONLY JSON of this exact shape, no prose, no code fences:",
    '{ "messages": [ { "speaker": "You" | "' + nickname + '", "text": "..." } ], "notes": "optional short note or empty", "notAChat": false, "confidence": { "level": "high" | "low", "issues": [] } }',
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
      model: modelFor("extract"),
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
