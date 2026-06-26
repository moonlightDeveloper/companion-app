import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/** Lightweight session check for the flow: am I signed in, and as whom. */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    signedIn: !!session,
    email: session?.email ?? null,
  });
}
