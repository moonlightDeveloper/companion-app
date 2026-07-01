import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getReportById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * A single saved report by id, for the read-only saved-report view (returning card →
 * "Open the full read"). Ownership-checked: only the owner's report is returned; anyone
 * else — or a missing id — gets 404 (never leak another user's read).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    const row = await getReportById(id, userId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      report: { id: row.id, result: row.result, created_at: row.created_at },
      nickname: row.nickname,
    });
  } catch (err) {
    console.error("getReportById failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
