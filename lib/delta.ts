import Anthropic from "@anthropic-ai/sdk";
import type { Read, DeltaChange } from "@/types";
import { modelFor, cachedSystem } from "./models";
import { mockLlmEnabled } from "./mockLlm";

export class DeltaError extends Error {}

/**
 * FLAG-46: what CHANGED between the user's prior read and this one about the SAME
 * person (a re-sent, continued conversation). Returns CONCRETE before → now pairs
 * — never the conversation, never a vague "he changed". Compares the two scrubbed
 * Read objects. Empty array = nothing specific changed (caller shows the
 * "nothing meaningful changed" state; never a manufactured difference).
 *
 * The quality bar (the whole point of the feature): each change names a SPECIFIC
 * observable behaviour in BOTH states — "named an actual day" → "back to 'soon'
 * with no date" — so the user sees "then X, now Y" and draws their own
 * conclusion. A vague before/after is worse than none (it manufactures false
 * significance), so concrete-on-both-sides is mandatory and the model is told to
 * return nothing rather than pad.
 */
const SYSTEM = [
  "You compare TWO behaviour reads about the SAME person — the user's PREVIOUS read and their NEW one (the same conversation, continued) — and list what CHANGED as concrete BEFORE → NOW pairs.",
  "",
  "THE BAR (non-negotiable): every change names a SPECIFIC, OBSERVABLE behaviour in the BEFORE state AND a SPECIFIC, OBSERVABLE behaviour in the NOW state. Concrete on BOTH sides, anchored to what actually happened. The user reads 'then he did X, now he does Y' and draws their own conclusion.",
  "",
  "GOOD (do this):",
  '- before: "named an actual day to meet"  now: "plans went back to \'soon\' with no date"',
  '- before: "replied within the hour"  now: "two-day gaps before replying"',
  '- before: "no boundary-pushing"  now: "asked for a photo after you said you wanted to go slow"',
  "",
  "BANNED (never output): vague, interpretive, non-specific change statements — 'he changed a bit', 'things shifted', 'the warmth is different', 'he's been less reliable', 'seems off'. If you cannot name a specific behaviour on BOTH sides, it is NOT a change to report.",
  "",
  "RULES:",
  "- Behaviour, not intent (never mind-read): cite what they DID, not why.",
  "- Only REAL, specific changes. If nothing concrete changed, return an EMPTY list. NEVER manufacture a change to seem useful — a vague before/after is worse than none.",
  "- No self-blame: a change is about THEIR behaviour, never 'you did X'.",
  "- Evidence, not identity: no named places, employers, schools, or identifying particulars — generalize them. The other person is only the nickname.",
  "- Plain, calm, specific. At most 3 changes — the most significant.",
  "",
  'Output ONLY minified JSON, no prose or code fences: {"changes":[{"before":"specific old behaviour","now":"specific new behaviour"}]}',
  "Empty when nothing specific changed: {\"changes\":[]}",
].join("\n");

function summarize(r: Read): string {
  const bars = r.bars.map((b) => `${b.label} ${b.level}/100 (${b.tag}) — ${b.caption}`).join("; ");
  const cards = r.cards.map((c) => `${c.kind}: ${c.title} — ${c.body}`).join("; ");
  return `${r.headline} [${r.status_tag}]. Bars: ${bars}. Cards: ${cards}. Where this leaves you: ${r.where_this_leaves_you}`;
}

/** Concrete before → now changes, or [] when nothing specific changed. Never throws to the caller for content reasons — only for missing config. */
export async function describeDelta(prev: Read, next: Read, nickname: string): Promise<DeltaChange[]> {
  if (mockLlmEnabled()) {
    return [{ before: "(mock) named an actual day to meet", now: "(mock) plans went back to 'soon' with no date" }];
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new DeltaError("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const name = nickname.trim() || "them";

  let text: string;
  try {
    const response = await client.messages.create({
      model: modelFor("delta"),
      max_tokens: 400,
      system: cachedSystem(SYSTEM),
      messages: [
        {
          role: "user",
          content: `Same person, "${name}".\n\nPREVIOUS read:\n${summarize(prev)}\n\nNEW read:\n${summarize(next)}\n\nList the concrete before → now changes as JSON.`,
        },
      ],
    });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    throw new DeltaError(err instanceof Error ? err.message : "Delta request failed");
  }

  return shapeGuard(parseJson(text));
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
    return { changes: [] }; // never manufacture; a parse failure means "no change shown"
  }
}

function shapeGuard(raw: unknown): DeltaChange[] {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.changes) ? obj.changes : [];
  return list
    .map((c): DeltaChange | null => {
      const r = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};
      const before = typeof r.before === "string" ? r.before.trim() : "";
      const now = typeof r.now === "string" ? r.now.trim() : "";
      // Concrete on BOTH sides or it's dropped — no half-pairs, no vague filler.
      return before && now ? { before, now } : null;
    })
    .filter((c): c is DeltaChange => c !== null)
    .slice(0, 3);
}
