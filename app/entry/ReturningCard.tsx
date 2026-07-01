"use client";

import Link from "next/link";
import type { CardModel, CardTone } from "@/lib/cardModel";
import { firstReadLabel } from "@/lib/cardModel";
import styles from "./ReturningCard.module.css";

const dotClass: Record<CardTone, string> = {
  green: styles.dotG,
  amber: styles.dotA,
  clay: styles.dotR,
};

/**
 * The returning-screen saved-read card (ported from companion-return.html), fed by a
 * real roster Person via toCardModel. Report-derived sections (behavior rows, pattern)
 * render only when present — the card hides them gracefully when the roster can't
 * supply them, rather than showing placeholders.
 */
export function ReturningCard({
  model,
  onDelete,
}: {
  model: CardModel;
  onDelete?: () => void;
}) {
  const meta = firstReadLabel(model.firstReadDaysAgo);
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.mono}>{model.monogram}</div>
        <div className={styles.who}>
          <div className={styles.name}>{model.name}</div>
          {meta && <div className={styles.meta}>{meta}</div>}
        </div>
        {model.weeksIn != null && (
          <div className={styles.since}>{model.weeksIn} weeks in</div>
        )}
        {onDelete && (
          <button className={styles.trash} aria-label={`Delete ${model.name}`} onClick={onDelete}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>

      {/* behavior rows — hidden unless enriched (not in the roster). */}
      {model.behavior && model.behavior.length > 0 && (
        <div className={styles.reads}>
          {model.behavior.map((r, i) => (
            <div key={i} className={styles.read}>
              <span className={`${styles.dot} ${dotClass[r.tone]}`} />
              <span className={styles.k}>{r.label}</span>
              <span className={styles.v}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* pattern — hidden unless enriched (not in the roster). */}
      {((model.patternDots && model.patternDots.length > 0) || model.patternLine) && (
        <div className={styles.pattern}>
          {model.patternDots && model.patternDots.length > 0 && (
            <div className={styles.weeks} aria-label="pattern by week">
              {model.patternDots.map((t, i) => (
                <i key={i} className={dotClass[t]} />
              ))}
            </div>
          )}
          {model.patternLine && <div className={styles.say}>{model.patternLine}</div>}
        </div>
      )}

      <div className={styles.cardActions}>
        <Link href={`/story?person=${encodeURIComponent(model.id)}`} className={`${styles.btn} ${styles.primary}`}>
          Add what&rsquo;s new <span className={styles.arrow}>→</span>
        </Link>
        <Link href={`/story?person=${encodeURIComponent(model.id)}`} className={`${styles.btn} ${styles.ghost}`}>
          Open the full read
        </Link>
      </div>
    </div>
  );
}
