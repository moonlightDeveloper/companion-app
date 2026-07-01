import type { Person } from "@/lib/db";

/**
 * Presentation view-model for the returning-screen saved-read card. It is DERIVED
 * from a real roster `Person` (lib/db) — the API type stays the source of truth; this
 * is view-only and never persisted (no PII in localStorage).
 *
 * The roster (§2.7, GET /api/persons) is intentionally lightweight — nickname +
 * created_at only — so only the card HEAD is derivable here. The behavior rows,
 * pattern dots, and pattern line aren't in the roster; they're left `undefined` and
 * the card hides them (they'd need /api/persons/[id]/reports + /pattern — see the
 * MISSING note where this is wired).
 */
export type CardTone = "green" | "amber" | "clay";

export interface CardBehaviorRow {
  label: string;
  value: string;
  tone: CardTone;
}

export interface CardModel {
  id: string;
  monogram: string;
  /** Nickname (+ the non-PII differentiator if the user set one). */
  name: string;
  /** Whole days since the first read (person creation); null when unknown. */
  firstReadDaysAgo: number | null;
  /** Weeks since the first read — set (and shown) only once ≥ 1 week in. */
  weeksIn?: number;
  /** Not in the roster → undefined here; the card hides these until enriched. */
  behavior?: CardBehaviorRow[];
  patternDots?: CardTone[];
  patternLine?: string;
}

function wholeDaysSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Map a real roster `Person` → the card's view-model. Roster-only: derives the head
 * (monogram, name, first-read age, weeks-in) and leaves the report-derived fields
 * undefined so the card hides them gracefully.
 */
export function toCardModel(p: Person): CardModel {
  const name = p.differentiator ? `${p.nickname} – ${p.differentiator}` : p.nickname;
  const days = wholeDaysSince(p.created_at);
  const weeks = days == null ? null : Math.floor(days / 7);
  return {
    id: p.id,
    monogram: (p.nickname.trim().charAt(0) || "?").toUpperCase(),
    name,
    firstReadDaysAgo: days,
    ...(weeks && weeks >= 1 ? { weeksIn: weeks } : {}),
  };
}

/** "First read · today | yesterday | N days ago" — null (hidden) when the date is unknown. */
export function firstReadLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 0) return "First read · today";
  if (days === 1) return "First read · yesterday";
  return `First read · ${days} days ago`;
}
