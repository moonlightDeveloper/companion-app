import { NextResponse } from "next/server";
import { deleteReadsByEmail } from "@/lib/db";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).email === "string"
      ? ((body as Record<string, unknown>).email as string).trim()
      : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  try {
    const removed = await deleteReadsByEmail(email);
    return NextResponse.json({ removed });
  } catch (err) {
    console.error("deleteReadsByEmail failed:", err);
    return NextResponse.json(
      { error: "We couldn't delete your data just now. Please try again." },
      { status: 502 },
    );
  }
}
