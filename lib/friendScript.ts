import type { Read, ReadBar, ReadCard } from "@/types";

/**
 * FLAG-48: maps an existing analyze Read → the "friend talking it through"
 * delivery script. Pure (no React) so the mapping is unit-testable. DELIVERY
 * ONLY — it never changes the analysis or what the read concludes; it only
 * sequences existing fields.
 *
 * Option A (no schema change): the lines that TYPE are existing fields —
 *  - headline → verdict (typed, big)
 *  - where_this_leaves_you first sentence → reassurance (typed, accent)
 *  - lead Pattern card title → mid emphasis (typed, big) ONLY on RICH reads (ii)
 * Thin reads stay at 2 typed lines — no manufactured 3rd emphasis. Everything
 * else (bars, remaining cards, suggested_move, CTA) → reveal asides; connective
 * bits → pop.
 */
export type FriendItem =
  | { t: "type"; cls: "big" | "accent"; text: string }
  | { t: "pop"; cls: "small" | "soft"; text: string }
  | { t: "bar"; bar: ReadBar }
  | { t: "card"; card: ReadCard }
  | { t: "move"; text: string }
  | { t: "cta" };

const DISCLAIMER =
  "Going off what you shared — I'm reading what they do, not guessing how they feel.";

/** Split into [first sentence, the rest] so a short punch types and the rest pops. */
function firstSentence(s: string): [string, string] {
  const m = s.trim().match(/^(.*?[.!?])\s+([\s\S]*)$/);
  return m ? [m[1].trim(), m[2].trim()] : [s.trim(), ""];
}

export function toScript(read: Read, opts?: { trimmed?: boolean }): FriendItem[] {
  const items: FriendItem[] = [];

  items.push({ t: "type", cls: "big", text: read.headline });
  items.push({ t: "pop", cls: "small", text: DISCLAIMER });
  // FLAG-43: only when the conversation was windowed for the API call. The full
  // conversation is still stored on-device; this just tells the user the read
  // focused on the recent stretch.
  if (opts?.trimmed) {
    items.push({ t: "pop", cls: "small", text: "This chat is long, so I focused on the most recent part." });
  }

  for (const b of read.bars) items.push({ t: "bar", bar: b });

  // (ii) mid-read emphasis only on RICH reads: type the lead Pattern card's
  // title, pop its body. Thin reads render every card as a plain aside.
  // Threshold is >=4 bars (the prompt allows 2-4): a model emits the full 4 only
  // when there's substantial behaviour to break down, and FLAG-45 keeps thin
  // chats sparse — so a 4-line chat that happens to get 3 bars is NOT promoted
  // (no manufactured 3rd typed line on a thin read).
  const rich = read.bars.length >= 4;
  const leadIdx = read.cards.findIndex((c) => c.kind === "Pattern");
  read.cards.forEach((c, i) => {
    if (rich && i === leadIdx) {
      items.push({ t: "type", cls: "big", text: c.title });
      if (c.body) items.push({ t: "pop", cls: "soft", text: c.body });
    } else {
      items.push({ t: "card", card: c });
    }
  });

  const [punch, rest] = firstSentence(read.where_this_leaves_you);
  if (punch) items.push({ t: "type", cls: "accent", text: punch });
  if (rest) items.push({ t: "pop", cls: "soft", text: rest });

  if (read.suggested_move) items.push({ t: "move", text: read.suggested_move });
  items.push({ t: "cta" });

  return items;
}
