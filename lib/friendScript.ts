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
  | { t: "type"; cls: "big" | "accent" | "small"; text: string }
  | { t: "pop"; cls: "small" | "soft"; text: string }
  | { t: "bar"; bar: ReadBar }
  | { t: "card"; card: ReadCard }
  | { t: "nothingNew" }
  | { t: "move"; text: string };

const DISCLAIMER =
  "Going off what you shared — I'm reading what they do, not guessing how they feel.";

/** FLAG-54: drop «verbatim» marks for TYPED lines (the typewriter shouldn't type
 *  guillemets). Inline quotes survive in the popped/revealed prose, styled there. */
function stripQ(s: string): string {
  return s.replace(/«([^«»]*)»/g, "$1");
}

/** Split into [first sentence, the rest] so a short punch types and the rest pops. */
function firstSentence(s: string): [string, string] {
  const m = s.trim().match(/^(.*?[.!?])\s+([\s\S]*)$/);
  return m ? [m[1].trim(), m[2].trim()] : [s.trim(), ""];
}

export function toScript(
  read: Read,
  opts?: { trimmed?: boolean; nothingNew?: boolean },
): FriendItem[] {
  const items: FriendItem[] = [];

  // The opening beat (headline + this "someone's talking to you" line) both TYPE
  // letter-by-letter — the deliberate "someone is writing this to you" gesture.
  // Everything after reveals plainly (fade/rise on scroll), no typing — see
  // FriendRead. These two are the only typed turns at the top (index 0, 1).
  items.push({ t: "type", cls: "big", text: stripQ(read.headline) });
  items.push({ t: "type", cls: "small", text: DISCLAIMER });
  // FLAG-46 Bug 2: an identical re-send (same chat, no new messages) shows the
  // "nothing new" note here in the auto-reveal. The directional "Since last time"
  // section for a genuine continuation is NOT a script item — it renders below the
  // read and reveals on SCROLL (DeltaSection), a clean handoff from the auto-reveal.
  if (opts?.nothingNew) {
    items.push({ t: "nothingNew" });
  }
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
      items.push({ t: "type", cls: "big", text: stripQ(c.title) });
      if (c.body) items.push({ t: "pop", cls: "soft", text: c.body });
    } else {
      items.push({ t: "card", card: c });
    }
  });

  const [punch, rest] = firstSentence(read.where_this_leaves_you);
  if (punch) items.push({ t: "type", cls: "accent", text: stripQ(punch) });
  if (rest) items.push({ t: "pop", cls: "soft", text: rest });

  if (read.suggested_move) items.push({ t: "move", text: read.suggested_move });
  // The action buttons (Help me reply / Read another / over time) are NOT a script
  // turn — they render as a sticky footer in FriendRead (FLAG-48 sticky-actions),
  // reachable while scrolling, shown once the unfold finishes.

  return items;
}
