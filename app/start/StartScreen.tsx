"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { INTRO_STEP_TO_FIELD, buildStoryHref } from "@/lib/introHandoff";
import type { Intake } from "@/types";
import styles from "./StartScreen.module.css";

/**
 * The new-visitor intro cinematic + interactive hook, ported faithfully from
 * companion-start.html (FLAG-58 step 1). Mounted at the temp route /start for
 * verification; the `/` router (separate ticket) wires it into new-vs-returning.
 *
 * - The intro is driven imperatively into a stage ref (typing, wipes, drifting thoughts),
 *   matching the source's timing/motion; the hook flow below is React state.
 * - prefers-reduced-motion → the .intro is display:none (CSS) and the cinematic is
 *   skipped (JS) — land straight on the hook.
 * - Intro-once gate: localStorage["companion.introSeen"] (the ONLY localStorage use; no
 *   app data), SSR-guarded, set on complete OR skip.
 */

const INTRO_SEEN_KEY = "companion.introSeen";
function hasSeen(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* private mode / disabled — non-fatal */
  }
}

interface Step {
  hook?: boolean;
  eyebrow: string;
  lead: string;
  accent: string;
  support?: string;
  prompt?: string;
  chips: string[];
  own?: string;
}

const STEPS: Step[] = [
  {
    hook: true,
    eyebrow: "No score. No group chat. Just what they did.",
    lead: "You're not overthinking it — ",
    accent: "you're just too close to see it.",
    support:
      "Paste the part that's been living in your head. I'll show you what they actually <b>did</b> — the green flags and the red — and the one clear thing to do next. One question at a time.",
    prompt: "So — what's going on?",
    chips: ["They went quiet", "Hot, then cold", "Mixed signals", "Can't read their last text"],
    own: "or tell me in your own words…",
  },
  {
    eyebrow: "One quick thing, so I read it right",
    lead: "How long's this been ",
    accent: "living in your head?",
    chips: ["A few hours", "A few days", "Weeks now", "Longer than I'd admit"],
  },
];

type Phase = "intro" | "leaving" | "gone" | "removed";

export function StartScreen() {
  const router = useRouter();

  // Hook-flow state.
  const [answers, setAnswers] = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownValue, setOwnValue] = useState("");
  const [hookStarted, setHookStarted] = useState(false);

  // Intro-overlay state.
  const [phase, setPhase] = useState<Phase>("intro");
  const stageRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<() => void>(() => {});
  const ownInputRef = useRef<HTMLInputElement>(null);

  const isFinal = stepIndex >= STEPS.length;
  const step = isFinal ? null : STEPS[stepIndex];
  const fillPct = isFinal ? 100 : Math.min(100, (answers.length / (STEPS.length + 1)) * 100);

  // Focus the own-words input when it opens.
  useEffect(() => {
    if (ownOpen) ownInputRef.current?.focus();
  }, [ownOpen]);

  // ── the intro cinematic (imperative, mirrors companion-start.html run()) ──
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion OR already seen → skip the cinematic, land on the hook.
    if (reduce || hasSeen()) {
      markSeen();
      setPhase("removed");
      setHookStarted(true);
      return;
    }

    const st = { done: false, timers: [] as ReturnType<typeof setTimeout>[] };
    stage.innerHTML = ""; // fresh (also covers React strict-mode double-invoke)

    const wait = (ms: number) =>
      new Promise<void>((res) => st.timers.push(setTimeout(res, ms)));
    const type = (el: HTMLElement, text: string, speed = 42) =>
      new Promise<void>((resolve) => {
        const span = document.createElement("span");
        el.appendChild(span);
        const caret = document.createElement("span");
        caret.className = styles.caret;
        el.appendChild(caret);
        let i = 0;
        const stepChar = () => {
          if (st.done) return;
          if (i < text.length) {
            span.textContent += text.charAt(i++);
            st.timers.push(setTimeout(stepChar, speed));
          } else {
            caret.remove();
            resolve();
          }
        };
        stepChar();
      });
    const bubble = (cls: "them" | "you") => {
      const b = document.createElement("div");
      b.className = `${styles.bubble} ${styles[cls]}`;
      stage.appendChild(b);
      return b;
    };
    const typingIndicator = () => {
      const t = document.createElement("div");
      t.className = styles.typing;
      t.innerHTML = "<i></i><i></i><i></i>";
      stage.appendChild(t);
      return t;
    };
    const clearStage = () =>
      new Promise<void>((resolve) => {
        Array.prototype.forEach.call(stage.children, (c: Element) => c.classList.add(styles.wipe));
        st.timers.push(
          setTimeout(() => {
            if (!st.done) stage.innerHTML = "";
            resolve();
          }, 600),
        );
      });
    const thought = (text: string, pos: { top: number; left: number }) => {
      const el = document.createElement("div");
      el.className = styles.thought;
      el.innerHTML = `<span class="${styles.q}">“</span>${text}<span class="${styles.q}">”</span>`;
      el.style.top = `${pos.top}%`;
      el.style.left = `${pos.left}%`;
      stage.appendChild(el);
      void el.offsetWidth; // reflow so the transition runs
      el.classList.add(styles.show);
      return el;
    };
    const fade = (el: HTMLElement | null) => {
      if (!el) return;
      el.classList.remove(styles.show);
      el.classList.add(styles.hide);
      st.timers.push(setTimeout(() => el.parentNode && el.remove(), 1600));
    };

    const finish = () => {
      if (st.done) return;
      st.done = true;
      st.timers.forEach(clearTimeout);
      markSeen();
      setPhase("leaving"); // fog lifts
      setHookStarted(true); // hook rises underneath, in sync
      setTimeout(() => setPhase("gone"), 360);
      setTimeout(() => setPhase("removed"), 1150);
    };
    finishRef.current = finish;

    const run = async () => {
      // ── movement 1 · the ache ──
      const b1 = bubble("them"); await type(b1, "we should def hang soon!!"); await wait(470);
      const b2 = bubble("them"); await type(b2, "i'll text you 😅"); await wait(420);
      const b3 = bubble("you"); await type(b3, "yes!! whenever works"); await wait(370);
      const typ = typingIndicator(); await wait(1000); typ.remove();
      const stamp = document.createElement("div");
      stamp.className = styles.stamp;
      stamp.innerHTML = `<span class="${styles.seen}">seen</span> · <b>3 days ago</b>`;
      stage.appendChild(stamp);
      await wait(1750); // let "seen" hold its tension pulse
      await clearStage();
      await wait(260);

      // ── movement 2 · quoted thoughts drift in, never overlapping in space ──
      const phrases = [
        "you're not imagining it.",
        "you're not too much.",
        "your gut's been right this whole time.",
        "you just need it read back — clearly.",
      ];
      const bands = [
        { top: 15, left: 6 },
        { top: 43, left: 22 },
        { top: 69, left: 9 },
      ];
      let last = -1;
      let prev: HTMLElement | null = null;
      for (let k = 0; k < phrases.length; k++) {
        let z: number;
        do {
          z = Math.floor(Math.random() * bands.length);
        } while (z === last);
        last = z;
        const pos = { top: bands[z].top, left: bands[z].left + (Math.random() * 4 - 2) };
        if (prev) fade(prev);
        prev = thought(phrases[k], pos);
        await wait(1650);
      }
      fade(prev);
      await wait(1300);
      await clearStage();
      await wait(220);
      finish();
    };

    run();

    return () => {
      st.done = true;
      st.timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(v: string) {
    if (exiting) return;
    setExiting(true); // the current step fades up (.out) before the next
    setTimeout(() => {
      setAnswers((a) => [...a, v]);
      setStepIndex((i) => i + 1);
      setOwnOpen(false);
      setOwnValue("");
      setExiting(false);
    }, 170);
  }
  function goBack(idx: number) {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => {
      setAnswers((a) => a.slice(0, idx));
      setStepIndex(idx);
      setOwnOpen(false);
      setOwnValue("");
      setExiting(false);
    }, 170);
  }
  function submitOwn() {
    const v = ownValue.trim();
    if (v) choose(v.length > 42 ? `${v.slice(0, 42)}…` : v);
  }
  function goToStory() {
    // FLAG-58b: map the hook answers to structured intake fields (the shared contract),
    // so /story pre-fills and skips them — never re-parses a display sentence.
    const values: Partial<Intake> = {};
    answers.forEach((a, idx) => {
      const field = INTRO_STEP_TO_FIELD[idx];
      if (field) values[field] = a;
    });
    router.push(buildStoryHref(values));
  }

  return (
    <div className={styles.root}>
      <main className={styles.frame}>
        <header className={styles.brand}>
          <div className={styles.mark}>
            <span className={styles.sun}>☼</span> Companion
          </div>
          <div className={styles.tag}>private story</div>
        </header>

        <section className={styles.stage}>
          <div className={styles.trace} aria-label="your answers so far">
            {answers.map((a, idx) => (
              <button
                key={idx}
                className={styles.crumb}
                title="go back to this"
                onClick={() => goBack(idx)}
              >
                <span className={styles.dot} />
                {a}
              </button>
            ))}
          </div>

          <div>
            {hookStarted &&
              (isFinal ? (
                <div className={styles.ctaBlock} key="final">
                  <div className={styles.eyebrow}>
                    <span className={styles.s}>☼</span>That&rsquo;s all I need.
                  </div>
                  <h1 className={styles.question}>
                    Okay — let&rsquo;s <span className={styles.accent}>read it clearly.</span>
                  </h1>
                  <button className={styles.start} onClick={goToStory}>
                    Get my read <span className={styles.arrow}>→</span>
                  </button>
                  <div className={styles.reassure}>
                    <span>
                      <span className={styles.tick}>✓</span> Nickname only
                    </span>
                    <span>
                      <span className={styles.tick}>✓</span> No account
                    </span>
                    <span>
                      <span className={styles.tick}>✓</span> First read free
                    </span>
                  </div>
                </div>
              ) : (
                step && (
                  <div className={`${styles.ask} ${exiting ? styles.out : ""}`} key={stepIndex}>
                    <div className={styles.eyebrow}>
                      {step.hook && <span className={styles.s}>☼</span>}
                      {step.eyebrow}
                    </div>
                    <h1 className={styles.question}>
                      {step.lead}
                      <span className={styles.accent}>{step.accent}</span>
                    </h1>
                    {step.support && (
                      <p
                        className={styles.support}
                        dangerouslySetInnerHTML={{ __html: step.support }}
                      />
                    )}
                    {step.prompt && <div className={styles.prompt}>{step.prompt}</div>}
                    <div className={styles.chips}>
                      {step.chips.map((c) => (
                        <button key={c} className={styles.chip} onClick={() => choose(c)}>
                          {c}
                        </button>
                      ))}
                      {step.own && (
                        <button
                          className={`${styles.chip} ${styles.ghost}`}
                          onClick={() => setOwnOpen(true)}
                        >
                          {step.own}
                        </button>
                      )}
                    </div>
                    {step.own && ownOpen && (
                      <div className={styles.own}>
                        <input
                          ref={ownInputRef}
                          type="text"
                          placeholder="Type what happened…"
                          aria-label="describe what happened"
                          value={ownValue}
                          onChange={(e) => setOwnValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitOwn();
                          }}
                        />
                        <button onClick={submitOwn}>Go</button>
                      </div>
                    )}
                  </div>
                )
              ))}
          </div>

          <div className={styles.thread}>
            <div className={styles.fill} style={{ width: `${fillPct}%` }} />
          </div>
        </section>

        <footer className={styles.foot}>
          {/* FLAG-58: launches the cross-device recover flow (re-parented off the deleted
              /story cover) — the tier-3 email-code recovery entry. */}
          <a className={styles.recover} href="/story?recover=1">
            Returning? Recover your people
          </a>
        </footer>
      </main>

      {phase !== "removed" && (
        <div
          className={`${styles.intro} ${
            phase === "leaving" || phase === "gone" ? styles.leaving : ""
          } ${phase === "gone" ? styles.gone : ""}`}
          onClick={() => finishRef.current?.()}
        >
          <div className={styles.introTop}>
            <div className={styles.mark}>
              <span className={styles.sun}>☼</span> Companion
            </div>
            <button
              className={styles.skip}
              onClick={(e) => {
                e.stopPropagation();
                finishRef.current?.();
              }}
            >
              Skip intro →
            </button>
          </div>
          <div className={styles.introStage} ref={stageRef} />
        </div>
      )}
    </div>
  );
}
