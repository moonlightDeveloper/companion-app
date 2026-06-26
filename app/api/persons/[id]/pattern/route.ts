import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";
import { synthesizePattern, PatternError } from "@/lib/pattern";

export const runtime = "nodejs";

/** One calm cross-report pattern line — only when the person has 2+ reports. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ insight: null });
  const { id } = await params;
  const nickname = new URL(req.url).searchParams.get("nickname") || "them";

  try {
    const reports = await listReports(userId, id);
    if (reports.length < 2) return NextResponse.json({ insight: null, count: reports.length });
    const insight = await synthesizePattern(
      reports.map((r) => r.result),
      nickname,
    );
    return NextResponse.json({ insight, count: reports.length });
  } catch (err) {
    if (err instanceof PatternError && err.message === "Missing ANTHROPIC_API_KEY") {
      return NextResponse.json({ insight: null }, { status: 500 });
    }
    console.error("pattern failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ insight: null }, { status: 502 });
  }
}
