import { NextResponse } from "next/server";
import type { Intake } from "@/types";
import { analyze, AnalyzeError } from "@/lib/analyze";
import { saveRead, getOrCreatePerson, createReport } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { sendReadEmail } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Gate: a valid email + ticked consent is required before we read anything.
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }
  if (b.consent !== true) {
    return NextResponse.json(
      { error: "Please tick consent so we can email and save your read." },
      { status: 400 },
    );
  }

  const intake = coerceIntake(b);
  if (!intake.conversation.trim()) {
    return NextResponse.json(
      { error: "Please paste at least a few lines of the conversation." },
      { status: 400 },
    );
  }

  let read;
  try {
    read = await analyze(intake);
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

  // Persist the read (result only — never the conversation). Signed-in users
  // get a report under a person (the create-order seam FLAG-10 needs); anon
  // users keep today's email-keyed save. Either way it's non-blocking.
  const nickname = intake.name || "this person";
  let personId: string | undefined;
  let reportId: string | undefined;
  const userId = await getUserId();
  if (userId) {
    try {
      personId = await getOrCreatePerson({ userId, nickname });
      reportId = await createReport({ personId, result: read });
    } catch (err) {
      console.error("save report failed:", err);
    }
  } else {
    try {
      await saveRead({ nickname, email, result: read });
    } catch (err) {
      console.error("saveRead failed:", err);
    }
  }

  // Email is non-blocking: a mail failure must never look like a read failure.
  let emailed = false;
  try {
    await sendReadEmail({ to: email, nickname, read });
    emailed = true;
  } catch (err) {
    console.error("sendReadEmail failed:", err);
  }

  return NextResponse.json({ ...read, emailed, personId, reportId });
}

function coerceIntake(b: Record<string, unknown>): Intake {
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
