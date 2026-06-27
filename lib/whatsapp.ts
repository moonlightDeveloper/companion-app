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
