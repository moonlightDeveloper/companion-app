import { NextResponse } from "next/server";
import {
  hashCode,
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { verifyLoginCode, upsertUser } from "@/lib/db";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Verify a one-time code and start a session. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const code = typeof b.code === "string" ? b.code.trim() : "";

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code we emailed you." }, { status: 400 });
  }

  try {
    const ok = await verifyLoginCode(email, hashCode(email, code));
    if (!ok) {
      return NextResponse.json(
        { error: "That code is invalid or expired. Request a new one." },
        { status: 400 },
      );
    }
    const userId = await upsertUser(email);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, createSessionValue(userId, email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error("otp verify failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Couldn't sign you in just now. Please try again." },
      { status: 502 },
    );
  }
}
