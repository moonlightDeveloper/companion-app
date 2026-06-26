import { NextResponse } from "next/server";
import { extractTranscript, ExtractError, type InputImage } from "@/lib/extract";

export const runtime = "nodejs";

const MAX_IMAGES = 6;
const ALLOWED: InputImage["media_type"][] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const nickname = typeof b.nickname === "string" ? b.nickname : "";

  const rawImages = Array.isArray(b.images) ? b.images : [];
  if (rawImages.length === 0) {
    return NextResponse.json({ error: "Add at least one screenshot." }, { status: 400 });
  }
  if (rawImages.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Please use ${MAX_IMAGES} screenshots or fewer.` },
      { status: 400 },
    );
  }

  const images: InputImage[] = [];
  for (const raw of rawImages) {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    const media_type = r.media_type as InputImage["media_type"];
    const data = typeof r.data === "string" ? r.data : "";
    if (!ALLOWED.includes(media_type) || !data) {
      return NextResponse.json(
        { error: "Only image files are supported." },
        { status: 400 },
      );
    }
    images.push({ media_type, data });
  }

  try {
    // Images and the resulting transcript are used here only and never stored
    // or logged — the image data above is deliberately never written anywhere.
    const transcript = await extractTranscript(images, nickname);
    if (transcript.messages.length === 0) {
      return NextResponse.json(
        {
          error:
            "Couldn't read those clearly — try clearer screenshots or paste the text instead.",
        },
        { status: 422 },
      );
    }

    // needsCheck (FLAG-20): show the check screen ONLY when extraction is
    // clearly unreliable. Biased to let reads through — the after-read backstop
    // covers the messy middle. Model self-report + two structural heuristics.
    const msgs = transcript.messages;
    const conf = transcript.confidence ?? { level: "high", issues: [] };
    const distinctSpeakers = new Set(msgs.map((m) => (m.speaker === "You" ? "You" : "them"))).size;
    const attributionFail = msgs.length >= 3 && distinctSpeakers <= 1;
    const tooThin = images.length >= 2 && msgs.length <= 1;
    const needsCheck =
      (conf.level === "low" && conf.issues.length >= 1) || attributionFail || tooThin;

    return NextResponse.json({ ...transcript, needsCheck });
  } catch (err) {
    if (err instanceof ExtractError && err.message === "Missing ANTHROPIC_API_KEY") {
      console.error("ANTHROPIC_API_KEY is not configured");
      return NextResponse.json(
        { error: "The reading service isn't configured yet." },
        { status: 500 },
      );
    }
    console.error("extract failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      {
        error:
          "Couldn't read those clearly — try clearer screenshots or paste the text instead.",
      },
      { status: 502 },
    );
  }
}
