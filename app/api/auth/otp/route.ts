import { NextResponse } from "next/server";
import { hashCode, AuthError } from "@/lib/auth";
import { setLoginCode, DbError } from "@/lib/db";
import { sendLoginCode, EmailError } from "@/lib/email";

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
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    await setLoginCode(email, hashCode(email, code), new Date(Date.now() + 10 * 60 * 1000));
    await sendLoginCode({ to: email, code });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const missing =
      (err instanceof AuthError || err instanceof EmailError || err instanceof DbError) &&
      /^Missing /.test(err.message);
    if (missing) {
      console.error("sign-in not configured:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: "Sign-in isn't configured yet." }, { status: 500 });
    }
    console.error("otp request failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Couldn't send a code just now. Please try again." },
      { status: 502 },
    );
  }
}
