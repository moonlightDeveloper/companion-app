import type { Read, Transcript, ReplyDraft } from "@/types";

/**
 * FLAG-39: dev/test-only mocks for the Claude calls, so plumbing / flow / UI
 * tests — and a full click-through of the story flow — don't fire real Sonnet
 * calls. Enable with MOCK_LLM=1.
 *
 * Guarded so it can NEVER fire in production: even if the flag leaked into a prod
 * env, NODE_ENV gates it off, so a real user is never served a canned read. Real
 * model-OUTPUT verification (read quality, extraction parity, history wording)
 * runs with the flag OFF — those are the only tests that need live calls.
 */
export function mockLlmEnabled(): boolean {
  return process.env.MOCK_LLM === "1" && process.env.NODE_ENV !== "production";
}

export const MOCK_READ: Read = {
  headline: "[mock] Warm but vague on plans",
  status_tag: "Mock read",
  bars: [
    { label: "Plan follow-through", tag: "vague", level: 25, tone: "low", caption: "(mock) plans floated, never a day named" },
    { label: "Effort balance", tag: "one-sided", level: 30, tone: "caution", caption: "(mock) you opened the last few exchanges" },
  ],
  cards: [
    { kind: "Pattern", title: "(mock) Soft yes, no action", body: "Mock read — MOCK_LLM is on, so no real model call was made." },
    { kind: "What I'd watch", title: "(mock) Whether they follow up", body: "Canned content for plumbing / flow testing." },
  ],
  suggested_move: "(mock) Stub response — turn off MOCK_LLM for a real read.",
  where_this_leaves_you: "(mock) Flow/plumbing path verified without a real Claude call.",
  safety: { flag: false, level: null, note: null },
};

export function mockTranscript(nickname: string): Transcript {
  const name = nickname.trim() || "Them";
  return {
    messages: [
      { speaker: name, text: "(mock) hey, sounds good" },
      { speaker: "You", text: "(mock) want to grab a drink this week?" },
      { speaker: name, text: "(mock) maybe! i'll let you know" },
    ],
    confidence: { level: "high", issues: [] },
    notAChat: false,
  };
}

/** None → the flow goes straight to the read (the fastest plumbing path). */
export const MOCK_CLARIFY: string[] = [];

export const MOCK_REPLY: ReplyDraft[] = [
  { tone: "Direct", text: "(mock) Want to pick an actual day this week?" },
  { tone: "Warm", text: "(mock) I'd love to see you — what works for you?" },
];

export const MOCK_PATTERN = "(mock) Across your reads, the plans keep slipping after they're floated.";

export const MOCK_HISTORY_Q = "(mock) Last time the plans kept slipping — same here, or did this one land?";
