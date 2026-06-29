import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";
import { guardRead } from "@/lib/analyze";
import { describeDelta, DeltaError } from "@/lib/delta";

export const runtime = "nodejs";

/**
 * FLAG-46: one calm "what changed since last time" sentence for a re-sent
 * (continued) conversation. The PREVIOUS read is loaded from Postgres
 * (ownership-checked, scrubbed); the NEW read is sent in the body. Never the
 * conversation. Returns { delta: null } for anything that should just be a normal
 * read — never an error the client must handle.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ delta: null });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ delta: null });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const personId = typeof b.personId === "string" ? b.personId : "";
  const nickname = typeof b.nickname === "string" ? b.nickname : "them";
  if (!personId || typeof b.read !== "object" || b.read === null) {
    return NextResponse.json({ delta: null });
  }

  try {
    const next = guardRead(b.read);
    // Ownership-checked, newest-first. The most recent PRIOR report is the one
    // this continuation builds on.
    const reports = await listReports(userId, personId);
    if (reports.length === 0) return NextResponse.json({ delta: null });
    const delta = await describeDelta(reports[0].result, next, nickname);
    return NextResponse.json({ delta: delta || null });
  } catch (err) {
    if (err instanceof DeltaError && err.message === "Missing ANTHROPIC_API_KEY") {
      return NextResponse.json({ delta: null }, { status: 500 });
    }
    console.error("delta failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ delta: null }, { status: 502 });
  }
}
