"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const TYPED_LINES = [
  "You’ve reread it for the tenth time.",
  "Typed a reply. Deleted it. Typed it again.",
  "Screenshotted it to three different friends.",
  "Still watching for the three dots.",
  "It’s late and you’re still decoding it.",
];

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [count, setCount] = useState(0);

  // Reveal-on-scroll + animated bar fills.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const fillBars = (scope: ParentNode) => {
      scope
        .querySelectorAll<HTMLElement>(`.${styles.fill}`)
        .forEach((f) => {
          const pct = f.dataset.pct;
          if (pct) f.style.width = `${pct}%`;
        });
    };

    if (reduce) {
      root.querySelectorAll(`.${styles.reveal}`).forEach((el) => {
        el.classList.add(styles.in);
      });
      fillBars(root);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.in);
            fillBars(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    root
      .querySelectorAll(`.${styles.reveal}`)
      .forEach((el) => io.observe(el));

    // Hero bars animate in shortly after load even before scroll.
    const t = window.setTimeout(() => {
      const heroCard = root.querySelector(`.${styles.heroCard}`);
      if (heroCard) fillBars(heroCard);
    }, 350);

    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  // Typewriter in the hero eyebrow line.
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTyped(TYPED_LINES[0]);
      return;
    }
    let li = 0;
    let ci = 0;
    let del = false;
    let timer: number;
    const tick = () => {
      const full = TYPED_LINES[li];
      if (!del) {
        ci += 1;
        setTyped(full.slice(0, ci));
        if (ci === full.length) {
          del = true;
          timer = window.setTimeout(tick, 1500);
          return;
        }
      } else {
        ci -= 1;
        setTyped(full.slice(0, ci));
        if (ci === 0) {
          del = false;
          li = (li + 1) % TYPED_LINES.length;
        }
      }
      timer = window.setTimeout(tick, del ? 26 : 54);
    };
    timer = window.setTimeout(tick, 54);
    return () => window.clearTimeout(timer);
  }, []);

  // Count-up for the "conversations read" stat.
  const countStarted = useRef(false);
  const countRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = countRef.current;
    if (!el) return;
    const target = 3128;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !countStarted.current) {
            countStarted.current = true;
            const t0 = performance.now();
            const dur = 1400;
            const step = (now: number) => {
              const p = Math.min((now - t0) / dur, 1);
              setCount(Math.round((1 - Math.pow(1 - p, 3)) * target));
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        });
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef}>
      <div className={styles.nav}>
        <div className={styles.navIn}>
          <div className={styles.logo}>
            <div className={styles.logoMark}>&#9788;</div> Companion
          </div>
          <div className={styles.navRight}>
            <div className={styles.navNote}>
              A second opinion on every confusing conversation
            </div>
            <Link
              className={`${styles.btn} ${styles.btnAccent}`}
              style={{ padding: "11px 18px", fontSize: 14 }}
              href="/story"
            >
              Start free
            </Link>
          </div>
        </div>
      </div>

      <header className={styles.hero}>
        <div className={styles.heroIn}>
          <div>
            <span className={styles.eyebrow}>
              &#9788; Green flag or red flag? Read it clearly.
            </span>
            <p className={styles.tw}>
              <span>{typed}</span>
              <span className={styles.cur} />
            </p>
            <h1 className={styles.h1}>
              Red flag &mdash; or are you overthinking it?
              <em>Stop spiraling. Read what they actually did.</em>
            </h1>
            <p className={styles.lead}>
              Paste the part that&rsquo;s been living in your head. I&rsquo;ll
              show you what their <b>behavior</b> is really saying &mdash; green
              flags and red &mdash; and what to do next. No drama, no made-up
              score. <b>One question at a time.</b>
            </p>
            <div className={styles.heroActions}>
              <Link
                className={`${styles.btn} ${styles.btnPrimary}`}
                href="/story"
              >
                Understand what&rsquo;s happening &#8594;
              </Link>
              <a
                className={`${styles.btn} ${styles.btnGhost}`}
                href="#sample"
              >
                See a sample read
              </a>
            </div>
            <div className={styles.trust}>
              <span>
                <b>&#10003;</b> First read free
              </span>
              <span>
                <b>&#10003;</b> Nickname only
              </span>
              <span>
                <b>&#10003;</b> No account to start
              </span>
            </div>
          </div>
          <div className={`${styles.heroCard} ${styles.reveal}`}>
            <div className={styles.heroPhoto}>
              <Image
                src="/images/hero.jpg"
                alt="Looking at a phone, deciding what a confusing message really means"
                fill
                priority
                sizes="(max-width: 880px) 100vw, 480px"
                style={{ objectFit: "cover" }}
              />
            </div>
            <div className={styles.mock}>
              <div className={styles.lbl}>
                &#9788; Your read &middot; behavior, not feelings
              </div>
              <Bar
                label="Effort balance"
                tag="leaning your way"
                pct={72}
                color="var(--amber)"
                cap="You open most threads and suggest most plans."
              />
              <Bar
                label="Plan clarity"
                tag="stays vague"
                pct={28}
                color="var(--warn)"
                cap="&ldquo;Maybe Friday,&rdquo; &ldquo;I&rsquo;ll let you know&rdquo; &mdash; nothing lands."
              />
              <Bar
                label="Reply consistency"
                tag="steady"
                pct={80}
                color="var(--green)"
                cap="They do reply, warmly, within a day."
                last
              />
            </div>
          </div>
        </div>
      </header>

      <div className={styles.strip}>
        <div className={styles.stripIn}>
          <div className={styles.stripItem}>
            <b>Behavior read</b>
            <span>What they did, not a guess at how they feel</span>
          </div>
          <div className={styles.stripItem}>
            <b>The timeline</b>
            <span>Watch how the situation actually moves</span>
          </div>
          <div className={styles.stripItem}>
            <b>What to say</b>
            <span>One calm, clear thing to send next</span>
          </div>
        </div>
      </div>

      <section className={styles.recog}>
        <div className={styles.inner}>
          <p className={`${styles.recogLine} ${styles.reveal}`}>
            The exhausting part was never them. It&rsquo;s the{" "}
            <b>not-knowing</b> &mdash; the rereading, the half-typed replies, the
            asking everyone but yourself.
          </p>
          <p className={`${styles.recogSub} ${styles.reveal}`}>
            That&rsquo;s the part this ends. Not with a verdict on them &mdash;
            with one calm read of what&rsquo;s actually happening, so you can
            stop refreshing and get your head back.
          </p>
        </div>
      </section>

      <section className={styles.sec}>
        <div className={styles.inner}>
          <div className={`${styles.costHead} ${styles.reveal}`}>
            <h2>Every week you stay confused costs you something real.</h2>
            <p>
              Clarity isn&rsquo;t a luxury. It&rsquo;s time, energy, and
              emotional investment you don&rsquo;t get back.
            </p>
          </div>
          <div className={styles.costGrid}>
            <div className={`${styles.costItem} ${styles.reveal}`}>
              <div className={styles.costIc}>&#9203;</div>
              <h3>Weeks reading into silences</h3>
              <p>
                Hours a week spent overanalyzing a situationship that ends the
                same way anyway.
              </p>
            </div>
            <div className={`${styles.costItem} ${styles.reveal}`}>
              <div className={styles.costIc}>&#128150;</div>
              <h3>Energy spent on the wrong person</h3>
              <p>
                Every month on someone inconsistent is a month not spent on
                someone who actually shows up.
              </p>
            </div>
            <div className={`${styles.costItem} ${styles.reveal}`}>
              <div className={styles.costIc}>&#129504;</div>
              <h3>Decisions on gut feeling alone</h3>
              <p>
                Your gut is right more often than you think. Sometimes you just
                need one calm outside read to confirm it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.sec} ${styles.secAlt}`}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            The problem
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            The hardest part isn&rsquo;t the message. It&rsquo;s the doubt after
            it.
          </h2>
          <p className={`${styles.secSub} ${styles.reveal}`}>
            When you&rsquo;re emotionally involved, mixed signals feel
            impossible to read clearly. Companion turns the conversation into a
            calm, structured read &mdash; so you see the pattern instead of
            spiraling.
          </p>
          <div className={styles.grid2}>
            <div>
              <Pain
                icon="&#127917;"
                title="They say one thing, do another"
                body="&ldquo;I really like you,&rdquo; then days of silence. The gap between words and behavior is where the truth lives."
              />
              <Pain
                icon="&#9203;"
                title="They reply, but never commit"
                body="Attention, but no clear plan and no follow-through. Warm enough to keep you hoping, vague enough to stay unaccountable."
              />
              <Pain
                icon="&#127754;"
                title="Intense, then suddenly distant"
                body="The hot-then-cold swing is much easier to see from the outside than from inside it."
              />
              <Pain
                icon="&#129489;"
                title="You keep asking friends"
                body="Ten opinions, none based on the actual messages. One calm read of the behavior beats the group chat."
              />
            </div>
            <div className={`${styles.imgbox} ${styles.reveal}`}>
              <Image
                src="/images/problem.jpg"
                alt="Person looking at their phone, unsure how to read a reply"
                fill
                sizes="(max-width: 880px) 100vw, 420px"
                style={{ objectFit: "cover" }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.sec}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            How it works
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            From a confusing chat to a clear read &mdash; like talking, not
            filling a form.
          </h2>
          <div className={styles.steps}>
            <Step
              n="1"
              title="Tell me what's happening"
              body="A few taps: how it started, what's making you unsure, how you feel. One question at a time."
            />
            <Step
              n="2"
              title="Paste the part that matters"
              body="Just the lines that count. A nickname stands in — their real name never leaves your head."
            />
            <Step
              n="3"
              title="Get the behavior read"
              body="What they actually did, what to watch, and one clear thing to say next — quoted from the conversation."
            />
            <Step
              n="4"
              title="Decide calmly"
              body="Continue, ask directly, set a boundary, or step back — with more clarity and less second-guessing."
            />
          </div>
        </div>
      </section>

      <section className={`${styles.sec} ${styles.secAlt}`} id="sample">
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            A sample read
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            Not just &ldquo;they&rsquo;re into you&rdquo; or &ldquo;run.&rdquo;
            It shows you why.
          </h2>
          <p className={`${styles.secSub} ${styles.reveal}`}>
            A good read never hands you a vague verdict or a made-up percentage.
            It names the pattern, points to the behavior, and tells you what to
            do. The whole first read is free.
          </p>

          <div className={`${styles.readCard} ${styles.reveal}`}>
            <div className={styles.readTop}>
              <div className={styles.readAv}>C</div>
              <div>
                <div className={styles.t}>Coffee guy &mdash; your first read</div>
                <div className={styles.s}>based only on what you shared</div>
              </div>
            </div>
            <div className={styles.readBody}>
              <Bar
                label="Effort balance"
                tag="leaning your way"
                pct={72}
                color="var(--amber)"
                cap="You open most threads and suggest most of the plans."
              />
              <Bar
                label="Plan clarity"
                tag="stays vague"
                pct={28}
                color="var(--warn)"
                cap="No concrete time has ever actually landed."
              />
              <Bar
                label="Reply consistency"
                tag="steady"
                pct={80}
                color="var(--green)"
                cap="Warm replies, usually within a day."
                last
              />
              <div className={styles.leaves}>
                <div className={styles.k}>
                  What I&rsquo;d watch &middot; where this leaves you
                </div>
                <p>
                  Their move, not your chase. One clear, low-pressure invite
                  tells you almost everything &mdash; then let their answer
                  decide it. Nothing here says panic; you can put the phone
                  down.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.sec}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            Private by design
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            You&rsquo;re sharing something personal. Here&rsquo;s exactly how
            it&rsquo;s handled.
          </h2>
          <p className={`${styles.secSub} ${styles.reveal}`}>
            Telling someone about a confusing situation takes trust. These are
            the rules built around it.
          </p>
          <div className={styles.trustGrid}>
            <div className={`${styles.tcard} ${styles.reveal}`}>
              <h3>&#127995; Nickname only</h3>
              <p>
                A nickname stands in for them. The read works on behavior and
                language &mdash; not on who they are.
              </p>
            </div>
            <div className={`${styles.tcard} ${styles.reveal}`}>
              <h3>&#129535; No one reads your story</h3>
              <p>
                Reads are generated automatically. Your conversation isn&rsquo;t
                reviewed or accessed by anyone on the team.
              </p>
            </div>
            <div className={`${styles.tcard} ${styles.reveal}`}>
              <h3>&#128465; Yours to keep or delete</h3>
              <p>
                It&rsquo;s a read on your own dating decisions &mdash; not a
                file you build on someone else. Delete it anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.sec} ${styles.secAlt}`}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            Early results
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            What people said after their first read.
          </h2>
          <div className={`${styles.count} ${styles.reveal}`}>
            <span className={styles.num} ref={countRef}>
              {count.toLocaleString()}
            </span>
            <span>confusing conversations read this month</span>
          </div>
          <div className={styles.tgrid}>
            <div className={`${styles.tq} ${styles.reveal}`}>
              <div className={styles.stars}>
                &#9733;&#9733;&#9733;&#9733;&#9733;
              </div>
              <p>
                &ldquo;It just showed me they reply warm but never plan &mdash;
                so I stopped chasing. I&rsquo;d been re-reading one text all
                evening.&rdquo;
              </p>
              <div className={styles.who}>&mdash; early tester</div>
            </div>
            <div className={`${styles.tq} ${styles.reveal}`}>
              <div className={styles.stars}>
                &#9733;&#9733;&#9733;&#9733;&#9733;
              </div>
              <p>
                &ldquo;The timeline was the thing. &lsquo;Warm, still no
                plan&rsquo; three weeks running told me what one message
                couldn&rsquo;t.&rdquo;
              </p>
              <div className={styles.who}>&mdash; early tester</div>
            </div>
            <div className={`${styles.tq} ${styles.reveal}`}>
              <div className={styles.stars}>
                &#9733;&#9733;&#9733;&#9733;&#9734;
              </div>
              <p>
                &ldquo;Comparing two people showed me I keep picking the same
                dynamic. That hit harder than any advice about them.&rdquo;
              </p>
              <div className={styles.who}>&mdash; early tester</div>
            </div>
          </div>
          <span className={styles.note}>
            Placeholder quotes &mdash; swap for real testers before launch.
            Don&rsquo;t ship invented testimonials.
          </span>
        </div>
      </section>

      <section className={styles.sec}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            Common situations
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            These are harder to see when you&rsquo;re inside them.
          </h2>
          <p className={`${styles.secSub} ${styles.reveal}`}>
            Each one is a pattern a read can help explain &mdash; not a final
            verdict, but a calm second opinion you can stand on.
          </p>
          <div className={styles.pgrid}>
            <Pattern
              img="/images/pattern-effort.jpg"
              title="Mismatched effort"
              body="One person invests; the other keeps it minimal or inconsistent."
            />
            <Pattern
              img="/images/pattern-shifting.jpg"
              title="The story keeps shifting"
              body="Details change, answers stay vague, the timeline doesn't match last week."
            />
            <Pattern
              img="/images/problem.jpg"
              title="Available until they're not"
              body="Warmth without real availability — vague excuses, interrupted plans."
            />
            <Pattern
              img="/images/pattern-saysdoes.jpg"
              title="Says one thing, does another"
              body="When their words, behavior, and plans all point different directions."
            />
          </div>
        </div>
      </section>

      <section className={`${styles.sec} ${styles.secAlt}`}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>
            What you get
          </div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            Built for clarity. Not drama.
          </h2>
          <div className={styles.feat}>
            <Feat
              icon="&#128270;"
              title="Behavior read"
              body="Your conversation turned into a calm read, pointing to what they actually did — not a guess at their feelings."
            />
            <Feat
              icon="&#9878;"
              title="Balanced, not a witch-hunt"
              body="It names what's working as readily as what isn't — a read that only hunts for problems isn't trustworthy."
            />
            <Feat
              icon="&#128172;"
              title="What to say next"
              body="A calm, direct message for when you want clarity or need to set a boundary — without the drama."
            />
            <Feat
              icon="&#128200;"
              title="The timeline"
              body="Add updates as things change and watch how the situation really moves — the part one screenshot can't show."
            />
            <Feat
              icon="&#129504;"
              title="Spot your own patterns"
              body="Compare situations and see if you keep choosing the same dynamic — the insight that's about you, not just them."
            />
            <Feat
              icon="&#128274;"
              title="Private, nickname only"
              body="Each story is yours, under a nickname. No account needed to get your first read."
            />
          </div>
        </div>
      </section>

      <section className={`${styles.sec} ${styles.secAlt}`} id="pricing">
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>Pricing</div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            Start free. The value grows every week.
          </h2>
          <p className={`${styles.secSub} ${styles.reveal}`}>
            No price wall in your face when you&rsquo;re anxious. Your read is
            free &mdash; you only pay for the part that follows the story over
            time.
          </p>
          <div className={styles.plans}>
            <div className={`${styles.plan} ${styles.reveal}`}>
              <h3>Free read</h3>
              <div className={styles.price}>
                <b>&euro;0</b>
              </div>
              <div className={styles.per}>your first read, always free</div>
              <ul>
                <li>
                  <i>&#10003;</i> Your full first read &mdash; behavior &amp;
                  patterns
                </li>
                <li>
                  <i>&#10003;</i> One clear next move
                </li>
                <li>
                  <i>&#10003;</i> Explain their last message
                </li>
                <li>
                  <i>&#10003;</i> Nickname-only privacy, no account
                </li>
              </ul>
              <Link
                className={`${styles.btn} ${styles.btnGhost}`}
                href="/story"
              >
                Start free &#8594;
              </Link>
            </div>
            <div
              className={`${styles.plan} ${styles.planFeat} ${styles.reveal}`}
            >
              <span className={styles.badge}>Follows the story</span>
              <h3>Companion</h3>
              <div className={styles.price}>
                <b>&euro;4.90</b>
                <span>/ month</span>
              </div>
              <div className={styles.per}>cancel anytime</div>
              <ul>
                <li>
                  <i>&#10003;</i> Save every story &amp; track it over weeks
                </li>
                <li>
                  <i>&#10003;</i> The timeline &mdash; see how it really moves
                </li>
                <li>
                  <i>&#10003;</i> Compare people &mdash; spot your own patterns
                </li>
                <li>
                  <i>&#10003;</i> Deeper reads + reply help by tone
                </li>
              </ul>
              <Link
                className={`${styles.btn} ${styles.btnAccent}`}
                href="/story"
              >
                Start with a free read &#8594;
              </Link>
              <p className={styles.planNote}>
                The timeline is the product. One read is a snapshot. A month of
                reads is a story.
              </p>
            </div>
          </div>
          <p className={styles.payHonest}>
            If you add your email, the read is actually sent to you &mdash;
            it&rsquo;s there so your story is waiting when they reply, not to
            chase you with offers.
          </p>
        </div>
      </section>

      <section className={styles.sec}>
        <div className={styles.inner}>
          <div className={`${styles.secLabel} ${styles.reveal}`}>FAQ</div>
          <h2 className={`${styles.secTitle} ${styles.reveal}`}>
            Questions people ask before they start.
          </h2>
          <div className={styles.faq}>
            <Faq
              q="Can it tell if someone is lying to me?"
              a="Not directly — and it won't pretend to. It reads behavior: gaps between what someone says and does, shifts in tone, plans that never land. It can't read minds, but it can read patterns, and it shows you the ones it sees so you decide."
            />
            <Faq
              q="Does it score how much they like me?"
              a="No. There's no made-up &ldquo;interest percentage&rdquo; — no one can measure another person's feelings, and a fake number just spikes your anxiety. It reads what you can actually point to: effort, consistency, whether plans get real."
            />
            <Faq
              q="What should I share?"
              a="The part around the moment that confused you — usually a handful of messages is enough for a first read. You don't need the whole history."
            />
            <Faq
              q="Is this only for women?"
              a="No — anyone can use it, any gender, orientation, or relationship type. The language reflects a common experience, but the read works for any dynamic."
            />
            <Faq
              q="Will it just keep me hooked and anxious?"
              a="That's the opposite of the point. When you've got your answer, it tells you to put the phone down. It's built to make you better at reading your own situations — not dependent on checking it."
            />
            <Faq
              q="Is this therapy?"
              a="No. Companion reads communication patterns. It doesn't diagnose anyone and doesn't replace therapy, coaching, or support. If you feel unsafe or at risk, please reach out to trusted people or local support services right away."
            />
          </div>
        </div>
      </section>

      <section className={styles.final}>
        <div className={styles.inner} style={{ maxWidth: 680 }}>
          <h2 className={styles.reveal}>
            You already know how it feels.
            <em>You just need someone to read it with you.</em>
          </h2>
          <p className={styles.reveal}>
            Paste the part that&rsquo;s been living in your head. See what their
            behavior is actually saying. Stop refreshing, decide with less doubt
            &mdash; free, private, and yours to keep.
          </p>
          <Link
            className={`${styles.btn} ${styles.btnAccent} ${styles.reveal}`}
            href="/story"
            style={{ margin: "0 auto" }}
          >
            Start a story &#8594;
          </Link>
          <div className={`${styles.disclaimer} ${styles.reveal}`}>
            Companion reads communication patterns to help you think. It does
            not diagnose people and does not replace professional help. If you
            feel unsafe, threatened, controlled, or at risk, contact trusted
            people or local support services immediately.
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footIn}>
          <div className={styles.logo} style={{ fontSize: 14 }}>
            <div
              className={styles.logoMark}
              style={{ width: 24, height: 24, fontSize: 13 }}
            >
              &#9788;
            </div>{" "}
            Companion
          </div>
          <div>
            Private by design &middot; nickname only &middot; reads behavior,
            not minds &middot; not a substitute for professional support
          </div>
        </div>
      </footer>
    </div>
  );
}

function Bar({
  label,
  tag,
  pct,
  color,
  cap,
  last,
}: {
  label: string;
  tag: string;
  pct: number;
  color: string;
  cap: string;
  last?: boolean;
}) {
  return (
    <div
      className={styles.barrow}
      style={last ? { marginBottom: 0 } : undefined}
    >
      <div className={styles.barhead}>
        <b>{label}</b>
        <span dangerouslySetInnerHTML={{ __html: tag }} />
      </div>
      <div className={styles.track}>
        <div
          className={styles.fill}
          data-pct={pct}
          style={{ background: color }}
        />
      </div>
      <p className={styles.barcap} dangerouslySetInnerHTML={{ __html: cap }} />
    </div>
  );
}

function Pain({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className={`${styles.pain} ${styles.reveal}`}>
      <div
        className={styles.painIc}
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className={`${styles.step} ${styles.reveal}`}>
      <div className={styles.stepN}>{n}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Pattern({
  img,
  title,
  body,
}: {
  img: string;
  title: string;
  body: string;
}) {
  return (
    <div className={`${styles.pcard} ${styles.reveal}`}>
      <div className={styles.pcardImg}>
        <Image
          src={img}
          alt={title}
          fill
          sizes="(max-width: 880px) 100vw, 260px"
          style={{ objectFit: "cover" }}
        />
      </div>
      <div className={styles.pcap}>
        <span className={styles.tag}>Common pattern</span>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function Feat({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className={`${styles.frow} ${styles.reveal}`}>
      <div className={styles.ic} dangerouslySetInnerHTML={{ __html: icon }} />
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className={styles.reveal}>
      <summary>{q}</summary>
      <p dangerouslySetInnerHTML={{ __html: a }} />
    </details>
  );
}
