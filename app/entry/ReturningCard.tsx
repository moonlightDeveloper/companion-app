"use client";

import { useState } from "react";
import Link from "next/link";
import type { CardModel, CardTone } from "@/lib/cardModel";
import { firstReadLabel } from "@/lib/cardModel";
import styles from "./ReturningCard.module.css";

const dotClass: Record<CardTone, string> = {
  green: styles.dotG,
  amber: styles.dotA,
  clay: styles.dotR,
};

// FLAG-68: the pulse ring is ONE shape, recoloured by the verdict tone (good/caution/low).
const ringTone: Record<CardTone, string> = {
  green: styles.ringGood,
  amber: styles.ringNeutral,
  clay: styles.ringConcern,
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
  const [confirming, setConfirming] = useState(false);
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
        {onDelete && !confirming && (
          <button className={styles.trash} aria-label={`Delete ${model.name}`} onClick={() => setConfirming(true)}>
            <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>

      {/* The card BODY (behavior rows + pattern + actions). On delete-confirm it dims to
          non-interactive and a centered overlay veils it edge-to-edge; the header above
          stays fully clear. The body content keeps its own padding (cardBody) while the
          veil reaches the card edges (overlay inset:0 over the padding-less bodyWrap). */}
      <div className={styles.bodyWrap}>
        <div className={`${styles.cardBody} ${confirming ? styles.bodyDim : ""}`}>
          {/* behavior rows — hidden unless enriched (not in the roster). Ranked + capped to
              3 by the caller (topRows); slice here is a defensive backstop so the card can
              never grow past 3. */}
          {model.behavior && model.behavior.length > 0 && (
            <div className={styles.reads}>
              {model.behavior.slice(0, 3).map((r, i) => (
                <div key={i} className={styles.read}>
                  <span className={`${styles.dot} ${dotClass[r.tone]}`} />
                  <span className={styles.k}>{r.label}</span>
                  <span className={styles.v}>{r.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* FLAG-57/68: the retention hook — shown ONLY when the evidence bar is met
              (patternLine present = ≥2 reads over a real gap; never a single read). FLAG-67:
              the below-the-bar teaser lives once at the top of the screen, not per-card. */}
          {model.patternLine &&
            (model.patternSafety ? (
              // FLAG-68 safety carve-out: escalation / safety → the CALM treatment (a muted
              // supportive lane + marker), NOT the playful pulse ring.
              <div className={styles.patternSafe}>
                <svg
                  className={styles.safeMark}
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <p className={styles.say}>{model.patternLine}</p>
              </div>
            ) : (
              // FLAG-68: one pulse ring, recoloured by verdict tone; the composed line
              // beside it; the accuracy note beneath (multi-read patterns only).
              <div className={styles.patternBlock}>
                <div className={styles.patternMain}>
                  <span className={`${styles.ring} ${ringTone[model.patternTone ?? "amber"]}`} aria-hidden="true">
                    <span className={styles.ringCore} />
                    <span className={styles.ringPing} />
                  </span>
                  <p className={styles.say}>{model.patternLine}</p>
                </div>
                <p className={styles.accuracy}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  I can only see what you&rsquo;ve brought me &mdash; if there&rsquo;s more between these,
                  this might read a little differently.
                </p>
              </div>
            ))}

          <div className={styles.cardActions}>
            <Link href={`/story?person=${encodeURIComponent(model.id)}`} className={`${styles.btn} ${styles.primary}`}>
              Add what&rsquo;s new <span className={styles.arrow}>→</span>
            </Link>
            {/* FLAG-58: opens THIS person's MOST RECENT saved report (a specific dated
                read), read-only, via /story?report=<id> — never the intake picker. Labeled
                honestly: the card describes the person over time and the pattern line the
                movement; this link is one dated report, not the card's summary. Shown only
                once /summary supplies the report id. */}
            {model.latestReportId && (
              <Link
                href={`/story?report=${encodeURIComponent(model.latestReportId)}`}
                className={`${styles.btn} ${styles.ghost}`}
              >
                Open your most recent read
              </Link>
            )}
          </div>
        </div>

        {confirming && (
          <div className={styles.confirmOverlay}>
            <div className={styles.ctext}>
              Delete <b>{model.name}</b>? The read and its timeline go with it &mdash; this
              can&rsquo;t be undone.
            </div>
            <div className={styles.confirmRow}>
              <button className={`${styles.cbtn} ${styles.cbtnKeep}`} onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button className={`${styles.cbtn} ${styles.cbtnDelete}`} onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
