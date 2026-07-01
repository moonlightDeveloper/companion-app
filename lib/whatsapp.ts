/**
 * WhatsApp chat-export (.txt) parser — FLAG-32. Pure, client-side, no network.
 *
 * The raw export carries real names; this only structures it. The caller maps
 * the chosen sender to "You" and the other to the nickname BEFORE anything
 * leaves the device, so no real name is ever sent or stored (privacy invariant).
 *
 * Handles both export dialects (iOS bracketed, Android dashed), multi-line
 * messages (continuation lines have no timestamp → appended), and skips system
 * notices (timestamped lines with no "Name: " body, e.g. the encryption notice).
 */

export interface ParsedMessage {
  /** The original sender label from the export (a real name or phone number). */
  sender: string;
  text: string;
}

export interface ParsedChat {
  messages: ParsedMessage[];
  /** Distinct senders, in first-seen order. */
  senders: string[];
}

// Bidi/format marks WhatsApp sprinkles around names and attachment lines.
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

// A header line starts a new message. We only need to recognise the prefix and
// hand back the remainder ("Name: message" or a system notice) — the date
// itself is irrelevant, so the date matcher stays deliberately loose.
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AaPp]\.?[Mm]\.?)?`;
const DATE = String.raw`\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}`;
// iOS:   [15/01/2024, 14:23:01] Name: message
const IOS = new RegExp(String.raw`^\[\s*${DATE},?\s+${TIME}\s*\]\s*(.*)$`);
// Android: 15/01/2024, 14:23 - Name: message
const ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s+-\s+(.*)$`);

// FLAG-60: capturing variants — pull the date + time out of the header so cadence timing
// can be derived on-device (times only; never content). Any line NOT matching these is a
// continuation (inherits no new timestamp).
const IOS_TS = new RegExp(String.raw`^\[\s*(${DATE}),?\s+(${TIME})\s*\]`);
const ANDROID_TS = new RegExp(String.raw`^(${DATE}),?\s+(${TIME})\s+-\s+`);

function parseClock(s: string): { hh: number; mm: number; ss: number } | null {
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?/);
  if (!m) return null;
  let hh = +m[1];
  const ap = m[4]?.toLowerCase();
  if (ap === "p" && hh < 12) hh += 12;
  if (ap === "a" && hh === 12) hh = 0;
  return { hh, mm: +m[2], ss: m[3] ? +m[3] : 0 };
}

/**
 * FLAG-60: per-message epoch-ms timestamps from a WhatsApp export — TIMES ONLY, no content
 * or names. Day/month order is locale-ambiguous, so it's auto-detected by monotonicity
 * (exports are chronological → the correct order yields a non-decreasing sequence). Returns
 * [] when nothing parses (→ no cadence). All on-device; only derived gaps ever leave.
 */
export function whatsappTimestamps(raw: string): number[] {
  const rows: { a: number; b: number; y: number; hh: number; mm: number; ss: number }[] = [];
  for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(BIDI, "");
    const h = line.match(IOS_TS) ?? line.match(ANDROID_TS);
    if (!h) continue;
    const p = h[1].split(/[/.\-]/).map(Number);
    const t = parseClock(h[2]);
    if (p.length !== 3 || p.some((n) => !Number.isFinite(n)) || !t) continue;
    // ISO-ish (Y first, 4-digit) vs day/month-first (year last).
    const isoFirst = p[0] > 31;
    const y = isoFirst ? p[0] : p[2] < 100 ? 2000 + p[2] : p[2];
    const a = isoFirst ? p[1] : p[0]; // ambiguous day/month #1
    const b = isoFirst ? p[2] : p[1]; // ambiguous day/month #2
    rows.push({ a, b, y, ...t });
  }
  if (rows.length === 0) return [];
  const build = (dayFirst: boolean) =>
    rows.map((r) =>
      Date.UTC(r.y, (dayFirst ? r.b : r.a) - 1, dayFirst ? r.a : r.b, r.hh, r.mm, r.ss),
    );
  const violations = (xs: number[]) => xs.reduce((n, v, i) => n + (i > 0 && v < xs[i - 1] ? 1 : 0), 0);
  const dayFirst = build(true);
  const monthFirst = build(false);
  return violations(dayFirst) <= violations(monthFirst) ? dayFirst : monthFirst;
}

/** Split a header remainder into sender + text, or null for a system notice. */
function splitSender(rest: string): ParsedMessage | null {
  // Non-greedy name up to the first ": " — a name is short and colon-free; a
  // system notice ("Messages and calls are end-to-end encrypted...") has no
  // early "X: " and falls through to null.
  const m = rest.match(/^([^:\n]{1,60}?):\s(.*)$/);
  if (!m) return null;
  const sender = m[1].trim();
  if (!sender) return null;
  return { sender, text: m[2] };
}

/** Collapse WhatsApp media/attachment lines to neutral placeholders. */
function normalizeMedia(text: string): string {
  const t = text.trim();
  // Voice notes matter to the read (calibrated partial, §2.10) — keep them
  // distinct; everything else collapses to a generic [media].
  if (/^audio omitted$/i.test(t) || /\bPTT-.*\.opus\b/i.test(t) || /\.opus\b.*\(file attached\)/i.test(t)) {
    return "[voice message]";
  }
  if (
    /^<attached:.*>$/i.test(t) ||
    /^<media omitted>$/i.test(t) ||
    /^(image|video|sticker|GIF|document|Contact card|media) omitted$/i.test(t) ||
    /\(file attached\)$/i.test(t)
  ) {
    return "[media]";
  }
  return text;
}

export function parseWhatsAppExport(raw: string): ParsedChat {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const messages: ParsedMessage[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(BIDI, "");
    const header = line.match(IOS) ?? line.match(ANDROID);
    if (header) {
      const msg = splitSender(header[1]);
      // A timestamped line with no "Name: " body is a system notice — skip it.
      if (msg) messages.push(msg);
      continue;
    }
    // No timestamp prefix → continuation of the previous message (or stray
    // preamble before the first message, which we drop).
    const last = messages[messages.length - 1];
    if (last && rawLine.trim()) last.text += "\n" + line;
  }

  for (const m of messages) {
    // One message = one line in the flattened transcript: collapse internal
    // newlines/whitespace, then normalise any media placeholder.
    m.text = normalizeMedia(m.text.replace(/\s+/g, " ").trim());
  }

  const cleaned = messages.filter((m) => m.text.length > 0);
  const senders: string[] = [];
  for (const m of cleaned) if (!senders.includes(m.sender)) senders.push(m.sender);

  return { messages: cleaned, senders };
}
