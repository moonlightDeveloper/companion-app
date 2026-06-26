import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { listReports } from "@/lib/db";

export const runtime = "nodejs";

/** A person's past reports, newest first (signed-in + ownership-checked). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ reports: [] });
  const { id } = await params;
  try {
    const reports = await listReports(userId, id);
    return NextResponse.json({ reports });
  } catch (err) {
    console.error("listReports failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ reports: [] });
  }
}
