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
  "You compare TWO behaviour reads about the SAME person — the user's PREVIOUS read and their NEW one (the same conversation, continued) — and list what CHANGED: per change, a short dimension name, a DIRECTION, and a concrete BEFORE → NOW behavioural pair.",
  "",
  "THE BAR (non-negotiable): every change names a SPECIFIC, OBSERVABLE behaviour in the BEFORE state AND a SPECIFIC, OBSERVABLE behaviour in the NOW state. Concrete on BOTH sides, anchored to what actually happened. The user reads 'then he did X, now he does Y' and draws their own conclusion.",
  "",
  "DIRECTION (not a score — never output numbers): each change moved one of three ways —",
  "- \"weakened\": the behaviour got worse / more concerning (e.g. respect for a limit dropped).",
  "- \"improved\": the behaviour got better / healthier (e.g. the user named their boundary more clearly).",
  "- \"held\": the behaviour persisted unchanged but is worth flagging (same pattern, still there).",
  "Direction is about which WAY the behaviour moved, judged from the before→now pair. NEVER include a precise magnitude or score number anywhere.",
  "",
  "GOOD (do this):",
  '- dimension "Respect for your limits", direction "weakened": before "showed up and asked you to ditch your guests"  now "you said \'do not push me\' and he answered \'don\'t you want to be pushed a bit?\'"',
  '- dimension "How clearly you named it", direction "improved": before "said you didn\'t want a one-night stand — a general line"  now "moved to a direct \'do not push me\' — a named boundary on the record"',
  '- dimension "Plan follow-through", direction "weakened": before "named an actual day"  now "back to \'soon\' with no date"',
  "",
  "BANNED (never output): vague, interpretive, non-specific change statements — 'he changed a bit', 'things shifted', 'the warmth is different', 'he's been less reliable', 'seems off'. If you cannot name a specific behaviour on BOTH sides, it is NOT a change to report.",
  "",
  "RULES:",
  "- Behaviour, not intent (never mind-read): cite what they DID, not why.",
  "- Only REAL, specific changes. If nothing concrete changed, return an EMPTY list. NEVER manufacture a change to seem useful — a vague before/after is worse than none.",
  "- No self-blame: a change is about THEIR behaviour (or the user's own observable wording), never blame the user.",
  "- Evidence, not identity: no named places, employers, schools, or identifying particulars — generalize them. The other person is only the nickname.",
  "- Plain, calm, specific. At most 3 changes — the most significant.",
  "",
  'Output ONLY minified JSON, no prose or code fences: {"changes":[{"dimension":"short name","direction":"weakened|improved|held","before":"specific old behaviour","now":"specific new behaviour"}]}',
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
    return [
      { dimension: "(mock) Plan follow-through", direction: "weakened", before: "(mock) named an actual day to meet", now: "(mock) plans went back to 'soon' with no date" },
      { dimension: "(mock) How clearly you named it", direction: "improved", before: "(mock) a general 'maybe later'", now: "(mock) a direct 'I want a real plan'" },
    ];
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
      const dimension = typeof r.dimension === "string" ? r.dimension.trim() : "";
      const before = typeof r.before === "string" ? r.before.trim() : "";
      const now = typeof r.now === "string" ? r.now.trim() : "";
      const dir = typeof r.direction === "string" ? r.direction.trim().toLowerCase() : "";
      const direction =
        dir === "weakened" || dir === "improved" || dir === "held" ? (dir as DeltaChange["direction"]) : null;
      // Concrete on BOTH sides + a real dimension + a valid direction, or dropped —
      // no half-pairs, no vague filler, no invented magnitude.
      return dimension && before && now && direction ? { dimension, direction, before, now } : null;
    })
    .filter((c): c is DeltaChange => c !== null)
    .slice(0, 3);
}
