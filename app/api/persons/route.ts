import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listPersons } from "@/lib/db";

export const runtime = "nodejs";

/** The signed-in user's roster of saved persons (CLAUDE.md §2.7). */
export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    // Not signed in: no roster. The flow just falls back to "someone new".
    return NextResponse.json({ persons: [] });
  }
  try {
    const persons = await listPersons(userId);
    return NextResponse.json({ persons });
  } catch (err) {
    console.error("listPersons failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ persons: [] });
  }
}
