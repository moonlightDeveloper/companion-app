import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";
import { historyQuestion, HistoryQuestionError } from "@/lib/historyQuestion";

export const runtime = "nodejs";

/**
 * FLAG-34: one personal pre-read question grounded in the person's most recent
 * prior read. Returns { question: null } for anything that should just fall back
 * to the generic clarify pass — never an error the client must handle.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ question: null });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ question: null });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const personId = typeof b.personId === "string" ? b.personId : "";
  const nickname = typeof b.nickname === "string" ? b.nickname : "them";
  if (!personId) return NextResponse.json({ question: null });

  try {
    // listReports is ownership-checked and newest-first — take the latest read.
    const reports = await listReports(userId, personId);
    if (reports.length === 0) return NextResponse.json({ question: null });
    const question = await historyQuestion(reports[0].result, nickname);
    return NextResponse.json({ question: question || null });
  } catch (err) {
    if (err instanceof HistoryQuestionError && err.message === "Missing ANTHROPIC_API_KEY") {
      return NextResponse.json({ question: null }, { status: 500 });
    }
    console.error("history-question failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ question: null }, { status: 502 });
  }
}
