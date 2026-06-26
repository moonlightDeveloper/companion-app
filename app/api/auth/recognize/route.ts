import { NextResponse } from "next/server";
import {
  getSoftUserId,
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { getUserEmail } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Soft recognition (FLAG-22): unlock the roster only when BOTH hold —
 *  1. a soft token is present (the device's soft-user), AND
 *  2. the submitted email matches that soft-user's stored email.
 * Token alone never recognizes; email alone never recognizes. On match we issue
 * the working session for this visit.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ recognized: false });
  }
  const email =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).email === "string"
      ? ((body as Record<string, unknown>).email as string).trim()
      : "";

  const softUserId = await getSoftUserId();
  if (!softUserId || !email) return NextResponse.json({ recognized: false });

  let stored: string | null = null;
  try {
    stored = await getUserEmail(softUserId);
  } catch {
    return NextResponse.json({ recognized: false });
  }
  // Second factor: emails must match (case-insensitive). No match → no roster.
  if (!stored || stored.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ recognized: false });
  }

  const res = NextResponse.json({ recognized: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(softUserId, stored), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
