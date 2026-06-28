/**
 * FLAG-43: bound what's SENT to the model — never what's stored.
 *
 * The full conversation always stays complete in IndexedDB (storage is free and
 * the paid pattern-over-time tier + reply + FLAG-46 continuation detection need
 * it). This caps ONLY what each API call sends: keep the most recent ~15k tokens,
 * drop whole OLDEST messages first, never cut mid-message, recent end kept.
 *
 * Token-only cap (gate-1 finding: real WhatsApp messages run ~12 tok/msg, and the
 * old ~500-message proxy disagreed with the token cost — dropped). chars/4 is the
 * estimate (gate-1 confirmed ~4 chars/token for this content). Pure + deterministic
 * so every send site produces the SAME window — no per-path divergence.
 */
const MAX_TOKENS = 15000;
const MAX_CHARS = MAX_TOKENS * 4;

export function windowForApi(conversation: string): { text: string; trimmed: boolean } {
  if (conversation.length <= MAX_CHARS) return { text: conversation, trimmed: false };

  // Keep the most recent whole lines (messages) that fit under the ceiling.
  const lines = conversation.split("\n");
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].length + 1; // + newline
    // Stop once adding an older line would overflow — but always keep at least
    // the most recent message, even if it alone exceeds the ceiling (never empty).
    if (total + len > MAX_CHARS && kept.length > 0) break;
    kept.push(lines[i]);
    total += len;
  }
  kept.reverse();
  return { text: kept.join("\n"), trimmed: true };
}
