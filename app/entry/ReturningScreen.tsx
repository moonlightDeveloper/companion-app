"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReturningCard } from "./ReturningCard";
import { toCardModel, type CardModel } from "@/lib/cardModel";
import { deriveAxisVerdicts } from "@/lib/recurrence";
import { axisRow } from "@/lib/axisCopy";
import type { Person } from "@/lib/db";
import type { AxisInstance } from "@/types";
import styles from "./ReturningScreen.module.css";

// TODO(entry-router): point at the FLAG-47 email-code recovery flow when the `/` router
// lands; for now "recover / start fresh" just enters the story.
const RECOVER_HREF = "/story";

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The returning-visitor screen (ported from companion-return.html). Paints base cards
 * from the roster immediately, then fills behavior rows progressively from the cheap
 * /summary endpoint (parallel across the roster). Empty roster → clean-slate. Delete is
 * optimistic against the real DELETE /api/persons/[id], with rollback on failure.
 *
 * Not persisted to localStorage (no-PII invariant). The pattern LINE (§2.5) is deferred
 * — it's a per-person model call, so it can't be fetched eagerly across the roster.
 */
export function ReturningScreen() {
  const [cards, setCards] = useState<CardModel[] | null>(null); // null = roster loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persons: Person[] = await fetch("/api/persons")
        .then((r) => r.json())
        .then((d) => (Array.isArray(d?.persons) ? d.persons : []))
        .catch(() => []);
      if (cancelled) return;
      setCards(persons.map(toCardModel)); // base cards immediately

      // Progressive behavior fill — parallelised across the roster (Promise.all), cheap
      // /summary only (aggregates stored instances; no model call).
      await Promise.all(
        persons.map(async (p) => {
          const summary = await fetch(`/api/persons/${p.id}/summary`)
            .then((r) => r.json())
            .catch(() => ({ instances: [] }));
          if (cancelled) return;
          const behavior = deriveAxisVerdicts((summary.instances ?? []) as AxisInstance[]).map(axisRow);
          if (behavior.length === 0) return;
          setCards((cur) => (cur ? cur.map((c) => (c.id === p.id ? { ...c, behavior } : c)) : cur));
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id: string) {
    const prev = cards;
    setCards((cur) => (cur ? cur.filter((c) => c.id !== id) : cur)); // optimistic
    const ok = await fetch(`/api/persons/${id}`, { method: "DELETE" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.ok === true)
      .catch(() => false);
    if (!ok) setCards(prev ?? null); // rollback — the server is source of truth
  }

  return (
    <main className={styles.frame}>
      <header className={styles.brand}>
        <div className={styles.mark}>
          <span className={styles.sun}>☼</span> Companion
        </div>
        <div className={styles.tag}>welcome back</div>
      </header>

      <section className={styles.stage}>
        {cards === null ? (
          <div className={styles.loading} aria-hidden />
        ) : cards.length === 0 ? (
          <div className={styles.reveal}>
            <div className={styles.eyebrow}>
              <span className={styles.s}>☼</span>A clean slate
            </div>
            <h1 className={styles.headline}>
              That read&rsquo;s cleared. <span className={styles.accent}>Start fresh whenever.</span>
            </h1>
            <p className={styles.support}>
              Nothing&rsquo;s saved here now &mdash; yours to keep or delete, always.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.reveal}>
              <div className={styles.eyebrow}>
                <span className={styles.s}>☼</span>Your story so far
              </div>
              <h1 className={styles.headline}>
                Welcome back. Did anything change &mdash;{" "}
                <span className={styles.accent}>or is it the same story?</span>
              </h1>
              <p className={styles.support}>
                You last read <b>{cards[0].name}</b>
                {cards[0].firstReadDaysAgo != null ? ` ${ago(cards[0].firstReadDaysAgo)}` : ""}. Add
                what&rsquo;s happened since and I&rsquo;ll show you how it&rsquo;s really moving &mdash;
                not just this moment, the pattern.
              </p>
            </div>
            {cards.map((c) => (
              <ReturningCard key={c.id} model={c} onDelete={() => handleDelete(c.id)} />
            ))}
          </>
        )}

        <div className={styles.newcap}>Someone new on your mind?</div>
        <Link href="/story" className={styles.startbig}>
          <svg className={styles.ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          Start a new story <span className={styles.arrow}>→</span>
        </Link>
      </section>

      <footer className={styles.foot}>
        <Link href={RECOVER_HREF} className={styles.recover}>
          Not your reads? Start fresh
        </Link>
      </footer>
    </main>
  );
}
