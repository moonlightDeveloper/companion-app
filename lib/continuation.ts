/**
 * FLAG-46: detect a re-sent conversation (same chat, continued) so the read can
 * show a "what changed since last time" delta instead of re-reading from scratch.
 *
 * Pure + client-side. Matches on normalized message CONTENT, not formatting, so a
 * continuation is caught even across capture methods (screenshot-extraction vs
 * WhatsApp export of the same chat produce different timestamps / sender-label
 * style / placeholders but the same messages).
 *
 * False-positive guard (content matching is forgiving, so this is the load-bearing
 * part): require a long CONTIGUOUS RUN of identical messages in order — not
 * bag-of-words overlap. A real continuation contains the prior conversation as one
 * ordered block. Two DIFFERENT conversations with the same person share scattered
 * short phrases ("haha", "ok", "you up?") but never a long ordered run of the same
 * messages. So we measure the longest common contiguous message run and require it
 * to cover most of the prior AND clear an absolute floor.
 *
 * Thresholds are PROVISIONAL (0.85 / >=8) pending gate-1 validation on REAL mixed
 * pairs + negatives. Biased to MISS, never false-positive.
 */
const MIN_PRIOR = 8;
const MIN_RUN = 8;
const RUN_RATIO = 0.85;

export interface ContinuationResult {
  /** Genuine continuation: the prior is (most of) a prefix of the new upload AND
   *  there are new messages beyond it. This is what fires the before/after. */
  isContinuation: boolean;
  /** Nothing new to diff: the new upload is identical to, OR a subset/earlier
   *  version of, the stored prior — it contains nothing beyond what's stored.
   *  Routes to the calm "nothing new" gate (no before/after, no fresh-read question). */
  nothingNew: boolean;
  /** True when new is exactly the same messages as prior. (A special case of nothingNew.) */
  identical: boolean;
  /** Longest contiguous run of identical messages found. */
  matched: number;
  priorLen: number;
}

/** Strip a line to its bare message content — capture-method-agnostic. */
function toContent(line: string): string {
  let s = line;
  // Leading timestamp: "[15/01/2024, 14:23:01]" (iOS) or "15/01/2024, 14:23 -" (Android).
  s = s.replace(/^\s*\[[^\]]*\]\s*/, "");
  s = s.replace(
    /^\s*\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*-\s*/i,
    "",
  );
  // Leading sender label ("You: ", "Alex: ") — short, colon-free name.
  s = s.replace(/^\s*[^:\n]{1,40}:\s+/, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  // Media/voice placeholders carry no content to match on.
  if (/^\[(media|voice message|image|photo|video|sticker|gif|audio)\]$/.test(s)) return "";
  return s;
}

/** Exposed for the gate-1 diagnostic harness only — the normalized message-content
 *  array detection compares on (timestamps/labels/placeholders stripped). */
export function debugMessageContents(conversation: string): string[] {
  return messageContents(conversation);
}

function messageContents(conversation: string): string[] {
  return conversation.split("\n").map(toContent).filter((l) => l.length > 0);
}

/** Longest contiguous run where a[i..] equals b[j..] (longest common substring over messages). */
function longestRun(a: string[], b: string[]): number {
  let best = 0;
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      if (a[i - 1] === b[j - 1]) {
        row[j] = diag + 1;
        if (row[j] > best) best = row[j];
      } else {
        row[j] = 0;
      }
      diag = tmp;
    }
  }
  return best;
}

export function detectContinuation(prior: string, next: string): ContinuationResult {
  const a = messageContents(prior); // stored prior
  const b = messageContents(next); // new upload
  const none: ContinuationResult = {
    isContinuation: false,
    nothingNew: false,
    identical: false,
    matched: 0,
    priorLen: a.length,
  };

  if (a.length < MIN_PRIOR) return none;

  const run = longestRun(a, b);
  // A long ordered run is what unrelated-but-similar chats can't fake. Below the
  // absolute floor it's not the same conversation either way → fresh read.
  if (run < MIN_RUN) return { ...none, matched: run };

  const hasNewTail = b.length > run; // new messages beyond the shared block
  const coversPrior = run >= Math.ceil(a.length * RUN_RATIO); // most of the PRIOR is in the run
  const coversNew = run >= Math.ceil(b.length * RUN_RATIO); // most of the NEW upload is in the run
  const identical = run === a.length && b.length === a.length;

  // Genuine continuation: the prior is (most of) a prefix of the new upload, plus a
  // real new tail. This is the only case that fires the before/after.
  const isContinuation = coversPrior && hasNewTail;
  // Nothing new: identical re-send, OR a subset/earlier export — the new upload is
  // contained in the prior (covered by the run) with no messages beyond it. The
  // TAIL is the distinguisher: tail = continuation; no tail + covered = nothing new.
  const subset = !hasNewTail && coversNew && b.length <= a.length;
  const nothingNew = identical || subset;

  return { isContinuation, nothingNew, identical, matched: run, priorLen: a.length };
}
