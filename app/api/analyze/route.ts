import { NextResponse } from "next/server";
import type { Intake } from "@/types";
import { analyze, guardRead, AnalyzeError } from "@/lib/analyze";
import { saveRead, getOrCreatePerson, createReport, personOwnedBy } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sendReadEmail } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Three modes:
 * - preview (Safe-B-lite, FLAG-19): generate the read only — no auth, no save,
 *   no email — so it can run in the background before the user signs in.
 * - save: persist an already-generated (previewed) read; the read is re-guarded
 *   and the conversation is never re-sent.
 * - legacy: generate + save + email in one call (the original path).
 */
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

  // ---- preview: generate only ------------------------------------------------
  if (b.preview === true) {
    const intake = coerceIntake(b);
    if (!intake.conversation.trim()) {
      return NextResponse.json(
        { error: "Please paste at least a few lines of the conversation." },
        { status: 400 },
      );
    }
    try {
      const read = await analyze(intake, coerceClarifications(b));
      return NextResponse.json({ read });
    } catch (err) {
      return analyzeErrorResponse(err);
    }
  }

  // ---- save / legacy: gate, then persist + email -----------------------------
  const session = await getSession();
  const email = session?.email || (typeof b.email === "string" ? b.email.trim() : "");
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!session && b.consent !== true) {
    return NextResponse.json(
      { error: "Please tick consent so we can email and save your read." },
      { status: 400 },
    );
  }

  const intake = coerceIntake(b);
  const hasPrecomputed = typeof b.read === "object" && b.read !== null;
  if (!hasPrecomputed && !intake.conversation.trim()) {
    return NextResponse.json(
      { error: "Please paste at least a few lines of the conversation." },
      { status: 400 },
    );
  }

  let read;
  if (hasPrecomputed) {
    read = guardRead(b.read); // save mode: persist the previewed read
  } else {
    try {
      read = await analyze(intake, coerceClarifications(b));
    } catch (err) {
      return analyzeErrorResponse(err);
    }
  }

  // Persist (result only — never the conversation). Signed-in → report under a
  // person; anon → email-keyed save. Non-blocking.
  const nickname = intake.name || "this person";
  let personId: string | undefined;
  let reportId: string | undefined;
  const userId = session?.userId ?? null;
  if (userId) {
    try {
      const picked = typeof b.personId === "string" ? b.personId : "";
      personId =
        picked && (await personOwnedBy(userId, picked))
          ? picked
          : await getOrCreatePerson({ userId, nickname });
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

  let emailed = false;
  try {
    await sendReadEmail({ to: email, nickname, read });
    emailed = true;
  } catch (err) {
    console.error("sendReadEmail failed:", err);
  }

  return NextResponse.json({ ...read, emailed, personId, reportId });
}

function analyzeErrorResponse(err: unknown) {
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

function coerceClarifications(b: Record<string, unknown>) {
  return Array.isArray(b.clarifications)
    ? b.clarifications
        .map((c) => {
          const r = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
          return { q: typeof r.q === "string" ? r.q : "", a: typeof r.a === "string" ? r.a : "" };
        })
        .filter((c) => c.q)
        .slice(0, 2)
    : [];
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
