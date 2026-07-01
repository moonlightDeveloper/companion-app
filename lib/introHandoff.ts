import type { Intake } from "@/types";

/**
 * The intro (/start) → /story handoff contract — the SINGLE place the producer
 * (app/start/StartScreen) and consumer (app/story/page.tsx) agree. The intro collects
 * a few answers; this maps them to structured intake fields and carries them in one
 * compact, versionable URL param — never a human display sentence (which /story would
 * have to re-parse back into intake, lossily). Change the intro's questions → change
 * INTRO_STEP_TO_FIELD here, and both ends stay in sync.
 *
 * FLAG-58b.
 */

/**
 * Intro hook step index → the Intake field it answers.
 *   step 0 · "So — what's going on?"  → issue ("What's making you unsure right now?")
 *   step 1 · "How long's this been living in your head?" → (no intake field today —
 *            intentionally UNMAPPED, so it's carried nowhere and re-asked nowhere.)
 * A step with no entry here is dropped from the handoff.
 */
export const INTRO_STEP_TO_FIELD: Partial<Record<number, keyof Intake>> = {
  0: "issue",
};

/** The param carrying the encoded handoff. */
export const HANDOFF_PARAM = "intake";

/** Only these Intake fields may cross the handoff — never `conversation` (that's the
 *  on-device transcript, §2.1) and never anything unknown. */
const HANDOFF_FIELDS: (keyof Intake)[] = [
  "name",
  "origin",
  "situation",
  "issue",
  "met",
  "plans",
  "feeling",
];

// UTF-8-safe base64url (the "own words" answer can hold arbitrary text/emoji).
function b64urlEncode(s: string): string {
  const bytes = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  let pct = "";
  for (let i = 0; i < bin.length; i++) pct += `%${`00${bin.charCodeAt(i).toString(16)}`.slice(-2)}`;
  return decodeURIComponent(pct);
}

/** Producer: build the /story href from the mapped intake values. Empty → plain /story. */
export function buildStoryHref(values: Partial<Intake>): string {
  const clean: Record<string, string> = {};
  for (const f of HANDOFF_FIELDS) {
    const v = values[f];
    if (typeof v === "string" && v.trim()) clean[f] = v.trim();
  }
  if (Object.keys(clean).length === 0) return "/story";
  return `/story?${HANDOFF_PARAM}=${b64urlEncode(JSON.stringify(clean))}`;
}

/** Consumer: decode the param → a validated partial intake. Malformed/partial/unknown
 *  → {} (or only the valid fields). Never throws. */
export function decodeStoryHandoff(raw: string | null | undefined): Partial<Intake> {
  if (!raw) return {};
  try {
    const obj: unknown = JSON.parse(b64urlDecode(raw));
    if (typeof obj !== "object" || obj === null) return {};
    const rec = obj as Record<string, unknown>;
    const out: Partial<Intake> = {};
    for (const f of HANDOFF_FIELDS) {
      const v = rec[f];
      if (typeof v === "string" && v.trim()) out[f] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}
