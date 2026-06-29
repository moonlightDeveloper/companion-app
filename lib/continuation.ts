/**
 * FLAG-46: detect a re-sent conversation (same chat, continued) so the read can
 * show a "what changed since last time" delta instead of re-reading from scratch.
 *
 * Pure + client-side. A WhatsApp re-export is chronological and append-only, so a
 * genuine continuation IS the prior conversation as an ordered PREFIX of the new
 * one, plus a new tail. That structural fact — not a fuzzy overlap % — is the
 * false-positive guard: two different conversations with the same person share
 * scattered greetings but diverge early; they can't reproduce most of the old
 * conversation as an ordered run from message 0.
 *
 * Thresholds are PROVISIONAL (0.85 / >=8) pending real-data validation. Biased to
 * MISS, never false-positive: a missed re-send -> normal read (harmless); a false
 * continuation -> a nonsense delta (bad).
 */
const MIN_PRIOR = 8;
const PREFIX_RATIO = 0.85;

export interface ContinuationResult {
  isContinuation: boolean;
  /** True when new == prior exactly (re-sent with no new messages). */
  identical: boolean;
  matched: number;
  priorLen: number;
}

/** Normalize to comparable message lines (same shape both sides). */
function lines(conversation: string): string[] {
  return conversation
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((l) => l.length > 0 && l !== "[media]" && l !== "[voice message]");
}

export function detectContinuation(prior: string, next: string): ContinuationResult {
  const a = lines(prior);
  const b = lines(next);
  const none: ContinuationResult = { isContinuation: false, identical: false, matched: 0, priorLen: a.length };

  if (a.length < MIN_PRIOR) return none;

  // Longest ordered prefix shared from message 0.
  let matched = 0;
  const max = Math.min(a.length, b.length);
  while (matched < max && a[matched] === b[matched]) matched++;

  const enough = matched >= MIN_PRIOR && matched >= Math.ceil(a.length * PREFIX_RATIO);
  if (!enough) return { ...none, matched };

  const identical = matched === a.length && b.length === a.length;
  const hasTail = b.length > matched;
  // A continuation needs a genuine new tail; identical re-send is flagged separately.
  return {
    isContinuation: hasTail || identical,
    identical,
    matched,
    priorLen: a.length,
  };
}
