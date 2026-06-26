import { NextResponse } from "next/server";
import {
  verifyMagicToken,
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { upsertUser } from "@/lib/db";

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
    const res = NextResponse.redirect(`${base}/story`);
    res.cookies.set(SESSION_COOKIE, createSessionValue(userId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error("auth verify failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(`${base}/signin?error=server`);
  }
}
