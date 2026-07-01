import { NextResponse } from "next/server";
import { draftReplies, ReplyError } from "@/lib/reply";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const conversation = typeof b.conversation === "string" ? b.conversation : "";
  const intent = typeof b.intent === "string" ? b.intent.trim() : "";
  const nickname = typeof b.nickname === "string" ? b.nickname : "";
  const safety = b.safety === true; // FLAG-59: bias drafts firm/boundary-holding

  // Reply help only exists when the conversation is present right now. If it
  // isn't, the option shouldn't have been offered — never re-solicit it here.
  if (!conversation.trim()) {
    return NextResponse.json({ error: "No conversation available." }, { status: 400 });
  }
  if (!intent) {
    return NextResponse.json(
      { error: "Tell me what you want to get across." },
      { status: 400 },
    );
  }

  try {
    // The conversation is used here only to draft a reply — never stored or logged.
    const drafts = await draftReplies({ conversation, intent, nickname, safety });
    if (drafts.length === 0) {
      return NextResponse.json(
        { error: "I couldn't draft a reply just now. Please try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ drafts });
  } catch (err) {
    if (err instanceof ReplyError && err.message === "Missing ANTHROPIC_API_KEY") {
      console.error("ANTHROPIC_API_KEY is not configured");
      return NextResponse.json(
        { error: "The reply service isn't configured yet." },
        { status: 500 },
      );
    }
    console.error("reply failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "I couldn't draft a reply just now. Please try again." },
      { status: 502 },
    );
  }
}
