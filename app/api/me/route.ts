import { NextResponse } from "next/server";
import { getSession, getSoftUserId } from "@/lib/auth";

export const runtime = "nodejs";

/** Lightweight check for the flow/landing: am I signed in, and is this a known device. */
export async function GET() {
  const session = await getSession();
  const softUserId = await getSoftUserId();
  return NextResponse.json({
    signedIn: !!session,
    email: session?.email ?? null,
    // Presence only — never expose the soft-user's email (that's the 2nd factor).
    hasSoftToken: !!softUserId,
  });
}
