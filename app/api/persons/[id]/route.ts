import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { deletePerson } from "@/lib/db";

export const runtime = "nodejs";

/** Delete a person and all their reports (cascade) — signed-in + ownership-checked. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await params;
  try {
    const deleted = await deletePerson(userId, id);
    return NextResponse.json({ ok: deleted });
  } catch (err) {
    console.error("deletePerson failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
