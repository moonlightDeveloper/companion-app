import { NextResponse } from "next/server";
import { createMagicToken, AuthError } from "@/lib/auth";
import { sendMagicLink, EmailError } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).email === "string"
      ? ((body as Record<string, unknown>).email as string).trim()
      : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  try {
    const token = createMagicToken(email);
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const url = `${base.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLink({ to: email, url });
  } catch (err) {
    const missing =
      (err instanceof AuthError || err instanceof EmailError) && /^Missing /.test(err.message);
    if (missing) {
      console.error("sign-in not configured:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: "Sign-in isn't configured yet." }, { status: 500 });
    }
    // Don't reveal whether the address exists or why it failed.
    console.error("auth request failed:", err instanceof Error ? err.message : "unknown");
  }

  // Always ok so we never leak which emails are registered.
  return NextResponse.json({ ok: true });
}
