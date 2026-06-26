import { NextResponse } from "next/server";
import { clarifyQuestions, ClarifyError } from "@/lib/clarify";

export const runtime = "nodejs";

/** Pre-read pass: 0–2 clarifying questions about the conversation, or none. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ questions: [] });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const conversation = typeof b.conversation === "string" ? b.conversation : "";
  const nickname = typeof b.nickname === "string" ? b.nickname : "";

  // No conversation, or not configured → no questions. Clarify must never block.
  if (!conversation.trim()) return NextResponse.json({ questions: [] });

  try {
    const questions = await clarifyQuestions(conversation, nickname);
    return NextResponse.json({ questions });
  } catch (err) {
    // Any failure (incl. missing key) degrades to zero questions — the read
    // path stays reachable; clarify is only ever a sharpener, never a gate.
    if (!(err instanceof ClarifyError)) {
      console.error("clarify failed:", err instanceof Error ? err.message : "unknown");
    }
    return NextResponse.json({ questions: [] });
  }
}
