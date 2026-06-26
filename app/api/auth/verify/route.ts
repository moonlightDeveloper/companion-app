import { NextResponse } from "next/server";
import {
  verifyMagicToken,
  createSessionValue,
  createSoftValue,
  SESSION_COOKIE,
  SOFT_COOKIE,
  SESSION_MAX_AGE,
  SOFT_MAX_AGE,
} from "@/lib/auth";
import { upsertUser, markVerified } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const base = origin.replace(/\/$/, "");
  const token = new URL(request.url).searchParams.get("token") || "";

  const email = verifyMagicToken(token);
  if (!email) {
    return NextResponse.redirect(`${base}/signin?error=expired`);
  }

  try {
    const userId = await upsertUser(email);
    await markVerified(userId); // magic-link = the verified cross-device upgrade (§2.8)
    const res = NextResponse.redirect(`${base}/story`);
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    };
    res.cookies.set(SESSION_COOKIE, createSessionValue(userId, email), {
      ...opts,
      maxAge: SESSION_MAX_AGE,
    });
    // Also recognize this device going forward.
    res.cookies.set(SOFT_COOKIE, createSoftValue(userId), { ...opts, maxAge: SOFT_MAX_AGE });
    return res;
  } catch (err) {
    console.error("auth verify failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(`${base}/signin?error=server`);
  }
}
