import { NextResponse } from "next/server";
import { hashCode } from "@/lib/auth";
import { setLoginCode, userExistsByEmail } from "@/lib/db";
import { sendLoginCode } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Request a one-time sign-in code by email. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).email === "string"
      ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
      : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  try {
    // FLAG-47: only send a code to a REGISTERED email — but the response is
    // IDENTICAL whether or not the email exists (no account enumeration). The
    // existence check + send happen entirely behind the scenes.
    if (await userExistsByEmail(email)) {
      const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
      await setLoginCode(email, hashCode(email, code), new Date(Date.now() + 10 * 60 * 1000));
      await sendLoginCode({ to: email, code });
    }
  } catch (err) {
    // Swallow ALL failures into the neutral response. Surfacing an error only
    // when the email exists (the send/config path runs only for existing emails)
    // would itself leak existence. Logged loudly for ops; never shown to the
    // client. Trade-off: a genuinely misconfigured environment fails silently —
    // acceptable for a no-enumeration guarantee, and the log makes it visible.
    console.error("otp request failed:", err instanceof Error ? err.message : "unknown");
  }
  // Neutral, always — identical whether or not the email is registered.
  return NextResponse.json({ ok: true });
}
