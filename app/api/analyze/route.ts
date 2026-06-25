import { NextResponse } from "next/server";
import type { Intake } from "@/types";
import { analyze, AnalyzeError } from "@/lib/analyze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const intake = coerceIntake(body);
  if (!intake.conversation.trim()) {
    return NextResponse.json(
      { error: "Please paste at least a few lines of the conversation." },
      { status: 400 },
    );
  }

  try {
    const read = await analyze(intake);
    return NextResponse.json(read);
  } catch (err) {
    if (err instanceof AnalyzeError && err.message === "Missing ANTHROPIC_API_KEY") {
      console.error("ANTHROPIC_API_KEY is not configured");
      return NextResponse.json(
        { error: "The reading service isn't configured yet." },
        { status: 500 },
      );
    }
    console.error("analyze failed:", err);
    return NextResponse.json(
      { error: "I couldn't generate a read just now. Please try again." },
      { status: 502 },
    );
  }
}

function coerceIntake(body: unknown): Intake {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: str(b.name),
    origin: str(b.origin),
    situation: str(b.situation),
    issue: str(b.issue),
    conversation: str(b.conversation),
    met: str(b.met),
    plans: str(b.plans),
    feeling: str(b.feeling),
  };
}
