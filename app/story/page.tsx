"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Intake, Read } from "@/types";
import styles from "./story.module.css";

type Screen =
  | "cover"
  | "name"
  | "origin"
  | "situation"
  | "issue"
  | "reflection"
  | "paste"
  | "met"
  | "plans"
  | "feeling"
  | "email"
  | "read";

const FLOW: Screen[] = [
  "cover",
  "name",
  "origin",
  "situation",
  "issue",
  "reflection",
  "paste",
  "met",
  "plans",
  "feeling",
  "email",
  "read",
];

const EYEBROW: Partial<Record<Screen, string>> = {
  cover: "Private story",
  read: "What I'm noticing",
};

type Option = { v: string; label: string };

const OPTIONS: Record<string, Option[]> = {
  origin: [
    { v: "Dating app", label: "Dating app" },
    { v: "Instagram / DMs", label: "Instagram / DMs" },
    { v: "Through friends", label: "Through friends" },
    { v: "Work or school", label: "Work or school" },
    { v: "An ex, reconnecting", label: "An ex, reconnecting" },
    { v: "Other", label: "Other" },
  ],
  situation: [
    { v: "Early dating", label: "Early dating" },
    { v: "Situationship", label: "Situationship" },
    { v: "In a relationship", label: "In a relationship" },
    { v: "After a fight", label: "After a fight" },
    { v: "Long distance", label: "Long distance" },
  ],
  issue: [
    { v: "They send mixed signals", label: "They send mixed signals" },
    { v: "They reply slowly", label: "They reply slowly" },
    { v: "They avoid making real plans", label: "They avoid making real plans" },
    { v: "I can't tell if they like me", label: "I can't tell if they like me" },
    { v: "I feel anxious and want to calm down", label: "I feel anxious and want to calm down" },
    { v: "I want help replying", label: "I want help replying" },
  ],
  met: [
    { v: "Yes, we've met", label: "Yes, we've met" },
    { v: "Not yet", label: "Not yet" },
    { v: "We had plans, it didn't happen", label: "We had plans, it didn't happen" },
    { v: "Rather not say", label: "Rather not say" },
  ],
  plans: [
    { v: "They agree clearly", label: "They agree clearly" },
    { v: "They dodge it", label: "They dodge it" },
    { v: "They say “maybe”", label: "They say “maybe”" },
    { v: "I haven't suggested one", label: "I haven't suggested one" },
  ],
  feeling: [
    { v: "Calm", label: "Calm" },
    { v: "Excited", label: "Excited" },
    { v: "Confused", label: "Confused" },
    { v: "Anxious", label: "Anxious" },
    { v: "Drained", label: "Drained" },
  ],
};

const QUESTION: Partial<Record<Screen, string>> = {
  name: "Who are we trying to understand?",
  origin: "How did this story start?",
  situation: "What kind of situation is this?",
  issue: "What’s making you unsure right now?",
  met: "Have you two actually met in person?",
  plans: "When plans come up, what usually happens?",
  feeling: "After you talk to them, how do you usually feel?",
};

const emptyIntake: Intake = {
  name: "",
  origin: "",
  situation: "",
  issue: "",
  conversation: "",
  met: "",
  plans: "",
  feeling: "",
};

type Status = "idle" | "loading" | "error" | "done";

export default function Story() {
  const [screen, setScreen] = useState<Screen>("cover");
  const [history, setHistory] = useState<Screen[]>([]);
  const [answers, setAnswers] = useState<Intake>(emptyIntake);
  const [status, setStatus] = useState<Status>("idle");
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [emailed, setEmailed] = useState(true);

  const name = answers.name.trim() || "this person";

  const go = useCallback((next: Screen) => {
    setScreen((cur) => {
      if (cur !== next) setHistory((h) => [...h, cur]);
      return next;
    });
  }, []);

  const back = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setScreen(prev);
      return h.slice(0, -1);
    });
  }, []);

  const runAnalyze = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...answers, email, consent }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }
      const { emailed: sent, ...rest } = data as Read & { emailed?: boolean };
      setEmailed(sent !== false);
      setRead(rest as Read);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, [answers, email, consent]);

  // Kick off the live read when we land on the read screen.
  useEffect(() => {
    if (screen === "read" && status === "idle") {
      runAnalyze();
    }
  }, [screen, status, runAnalyze]);

  const idx = FLOW.indexOf(screen);
  const progress =
    screen === "cover" ? 0 : idx < 0 ? 100 : Math.round((idx / (FLOW.length - 1)) * 100);

  return (
    <div className={`${styles.stage} storyTheme`}>
      <div className={styles.phone}>
        <div className={styles.topbar}>
          {history.length > 0 && (
            <button className={styles.back} aria-label="Back" onClick={back}>
              &#8249;
            </button>
          )}
          <div className={styles.brand}>
            <div className={styles.eyebrow}>
              {EYEBROW[screen] || "Private story"}
            </div>
            <div className={styles.title}>
              {screen === "cover" ? "Companion" : `${name}’s story`}
            </div>
          </div>
          <div className={styles.chipTop}>private</div>
        </div>
        <div className={styles.progress}>
          <div className={styles.bar} style={{ width: `${progress}%` }} />
        </div>
        <main className={styles.main}>
          {screen === "cover" && <Cover onStart={() => go("name")} />}

          {screen === "name" && (
            <NameScreen
              value={answers.name}
              onContinue={(v) => {
                setAnswers((a) => ({ ...a, name: v.trim() || "Alex" }));
                go("origin");
              }}
            />
          )}

          {(["origin", "situation", "issue", "met", "plans", "feeling"] as Screen[]).includes(
            screen,
          ) && (
            <QuestionScreen
              key={screen}
              stepLabel={`${Math.max(1, idx)} / 9`}
              question={QUESTION[screen]!}
              options={OPTIONS[screen]}
              onPick={(v) => {
                setAnswers((a) => ({ ...a, [screen]: v }));
                go(nextOf(screen));
              }}
            />
          )}

          {screen === "reflection" && (
            <Reflection name={name} onNext={() => go("paste")} />
          )}

          {screen === "paste" && (
            <Paste
              name={name}
              value={answers.conversation}
              onContinue={(v) => {
                setAnswers((a) => ({ ...a, conversation: v }));
                go("met");
              }}
            />
          )}

          {screen === "email" && (
            <EmailScreen
              name={name}
              email={email}
              consent={consent}
              setEmail={setEmail}
              setConsent={setConsent}
              onUnlock={() => go("read")}
            />
          )}

          {screen === "read" && (
            <ReadScreen
              name={name}
              status={status}
              read={read}
              error={error}
              emailed={emailed}
              onRetry={runAnalyze}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function nextOf(screen: Screen): Screen {
  switch (screen) {
    case "origin":
      return "situation";
    case "situation":
      return "issue";
    case "issue":
      return "reflection";
    case "met":
      return "plans";
    case "plans":
      return "feeling";
    case "feeling":
      return "email";
    default:
      return "read";
  }
}

/* ---------- typewriter ---------- */
function useTypewriter(text: string) {
  const [display, setDisplay] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(text);
      setDone(true);
      return;
    }
    setDisplay("");
    setDone(false);
    let i = 0;
    const start = window.setTimeout(function tick() {
      i += 1;
      setDisplay(text.slice(0, i));
      if (i >= text.length) {
        setDone(true);
        return;
      }
      window.setTimeout(tick, 16);
    }, 320);
    return () => window.clearTimeout(start);
  }, [text]);
  return { display, done };
}

function TypingDots() {
  return (
    <div className={styles.typingRow}>
      <span>typing</span>
      <span className={styles.dots}>
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/* ---------- screens ---------- */
function Cover({ onStart }: { onStart: () => void }) {
  return (
    <section className={styles.screen}>
      <div className={styles.hero}>
        <span className={styles.caseLabel}>
          No avatar &middot; no dashboard &middot; just the story
        </span>
        <p className={styles.punch} style={{ marginTop: 18 }}>
          You&rsquo;re not their person yet. Right now{" "}
          <span>you&rsquo;re their option</span> &mdash; let&rsquo;s see which
          way it&rsquo;s actually moving.
        </p>
        <h1>Just had a confusing conversation?</h1>
        <p>
          Tell me what&rsquo;s happening, paste the part that matters, and
          I&rsquo;ll show you what their <b>behavior</b> is really saying &mdash;
          one question at a time.
        </p>
        <button className={styles.primary} onClick={onStart}>
          Start a story
        </button>
        <div className={styles.noteCard}>
          <h3>This isn&rsquo;t a chatbot</h3>
          <p>
            It asks like a friend who&rsquo;s paying attention, remembers the
            context, and helps you decide what to do &mdash; then gets out of
            your way when you&rsquo;ve got your answer.
          </p>
        </div>
      </div>
    </section>
  );
}

function NameScreen({
  value,
  onContinue,
}: {
  value: string;
  onContinue: (v: string) => void;
}) {
  const { display, done } = useTypewriter(QUESTION.name!);
  const [v, setV] = useState(value);
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.stepCount}>1 / 9</div>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Use a nickname only you&rsquo;d recognise &mdash; never their real
            name. &ldquo;Bumble guy&rdquo; works.
          </p>
        )}
      </div>
      <div className={styles.spacer} />
      <div className={styles.footerActions}>
        <input
          className={styles.input}
          placeholder="e.g. Coffee guy"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <button
          className={styles.primary}
          style={{ marginTop: 12 }}
          onClick={() => onContinue(v)}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function QuestionScreen({
  stepLabel,
  question,
  options,
  onPick,
}: {
  stepLabel: string;
  question: string;
  options: Option[];
  onPick: (v: string) => void;
}) {
  const { display, done } = useTypewriter(question);
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.stepCount}>{stepLabel}</div>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done ? (
          <p className={styles.subtext}>
            Pick what feels closest. You can go back anytime.
          </p>
        ) : (
          <TypingDots />
        )}
      </div>
      {done && (
        <div className={styles.options}>
          {options.map((o) => (
            <button
              key={o.v}
              className={styles.option}
              onClick={() => onPick(o.v)}
            >
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Reflection({ name, onNext }: { name: string; onNext: () => void }) {
  const { display, done } = useTypewriter(
    `Okay — I’ll look at ${name} through what you’ve told me, not in a vacuum.`,
  );
  return (
    <section className={`${styles.screen} ${styles.reflection}`}>
      <p className={styles.bigNote}>{display}</p>
      {done && (
        <>
          <p className={styles.softNote}>
            I&rsquo;ve got the shape of it. Now I need the actual conversation
            &mdash; just the part that matters, even a few lines.
          </p>
          <div className={styles.footerActions}>
            <button className={styles.primary} onClick={onNext}>
              Show me the conversation
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Paste({
  name,
  value,
  onContinue,
}: {
  name: string;
  value: string;
  onContinue: (v: string) => void;
}) {
  const { display, done } = useTypewriter("Show me the conversation.");
  const [v, setV] = useState(value);
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.stepCount}>5 / 9</div>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Paste only what matters. Screenshots can come later. Names stay
            private.
          </p>
        )}
      </div>
      <textarea
        className={styles.textarea}
        placeholder={
          "Paste a few lines…\n\nCoffee guy: haha maybe Friday\nYou: sounds good, what time?\nCoffee guy: i’ll let you know"
        }
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <div className={styles.footerActions}>
        <button className={styles.primary} onClick={() => onContinue(v)}>
          Continue {name}&rsquo;s story
        </button>
      </div>
    </section>
  );
}

function EmailScreen({
  name,
  email,
  consent,
  setEmail,
  setConsent,
  onUnlock,
}: {
  name: string;
  email: string;
  consent: boolean;
  setEmail: (v: string) => void;
  setConsent: (v: boolean) => void;
  onUnlock: () => void;
}) {
  const { display, done } = useTypewriter("Where should I send your read?");
  const [touched, setTouched] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = valid && consent;

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Free &mdash; add your email to unlock {name}&rsquo;s read. You&rsquo;ll
            see it here and get a copy in your inbox.
          </p>
        )}
      </div>
      <div className={styles.spacer} />
      <div className={styles.footerActions}>
        <input
          className={styles.input}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {touched && !valid && (
          <p className={styles.subtext} style={{ color: "var(--red)", marginTop: 8 }}>
            That doesn&rsquo;t look like a valid email.
          </p>
        )}
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Email me my read and save it under my nickname. The conversation I
            pasted is never stored.
          </span>
        </label>
        <button
          className={styles.primary}
          style={{ marginTop: 12 }}
          disabled={!ready}
          onClick={onUnlock}
        >
          Unlock my read
        </button>
      </div>
    </section>
  );
}

function ReadScreen({
  name,
  status,
  read,
  error,
  emailed,
  onRetry,
}: {
  name: string;
  status: Status;
  read: Read | null;
  error: string;
  emailed: boolean;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "idle") {
    return (
      <section className={styles.screen}>
        <div className={styles.stepHead}>
          <div className={styles.questionWrap} style={{ minHeight: 60 }}>
            <h2 className={styles.question}>
              Reading {name}&rsquo;s behavior&hellip;
            </h2>
          </div>
          <TypingDots />
        </div>
        <p className={styles.subtext}>
          Based only on what you shared. I read behavior &mdash; I won&rsquo;t
          pretend to know their feelings.
        </p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className={styles.screen}>
        <div className={styles.stepHead}>
          <div className={styles.questionWrap} style={{ minHeight: 60 }}>
            <h2 className={styles.question}>That didn&rsquo;t go through.</h2>
          </div>
        </div>
        <div className={styles.errorCard}>
          <h3>I couldn&rsquo;t finish the read</h3>
          <p>{error || "Please try again in a moment."}</p>
          <button className={styles.primary} onClick={onRetry}>
            Try again
          </button>
        </div>
        <div className={styles.footerActions}>
          <Link href="/" className={styles.ghost} style={{ display: "block", textAlign: "center" }}>
            Back to home
          </Link>
        </div>
      </section>
    );
  }

  if (!read) return null;

  // Safety case: show only the supportive note.
  if (read.safety.flag) {
    return (
      <section className={styles.screen}>
        <div className={styles.stepHead}>
          <div className={styles.questionWrap} style={{ minHeight: 60 }}>
            <h2 className={styles.question}>Let&rsquo;s slow down for a moment.</h2>
          </div>
        </div>
        <div className={`${styles.insight} ${styles.relax}`}>
          <div className={styles.k}>You matter here</div>
          <p style={{ fontSize: 14 }}>
            {read.safety.note ||
              "Some of what you shared worries me for your safety. Please reach out to people you trust, or your local support services. You don’t have to handle this alone."}
          </p>
        </div>
        <div className={styles.footerActions}>
          <Link href="/" className={styles.secondary} style={{ display: "block", textAlign: "center" }}>
            Back to home
          </Link>
        </div>
      </section>
    );
  }

  const toneColor = (tone: string) =>
    tone === "good" ? "var(--green)" : tone === "low" ? "var(--red)" : "var(--amber)";

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap} style={{ minHeight: 60 }}>
          <h2 className={styles.question}>{read.headline}</h2>
        </div>
        <p className={styles.subtext}>
          Based only on what you shared. I read behavior &mdash; I won&rsquo;t
          pretend to know their feelings.
        </p>
      </div>

      <div className={styles.status}>
        <span className={styles.pill}>{read.status_tag}</span>
        <span className={styles.pill}>Free read</span>
      </div>

      <p className={styles.subtext} style={{ marginTop: -4 }}>
        {emailed
          ? "Saved, and a copy is on its way to your inbox."
          : "Saved. We couldn’t email it just now, but it’s here for you."}
      </p>

      <div className={styles.bars}>
        {read.bars.map((b, i) => (
          <BarRow key={i} bar={b} color={toneColor(b.tone)} />
        ))}
      </div>

      <div>
        {read.cards.map((c, i) => (
          <div key={i} className={styles.insight}>
            <div className={styles.k}>{c.kind}</div>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}

        {read.suggested_move && (
          <div className={`${styles.insight} ${styles.move}`}>
            <div className={styles.k}>Suggested move</div>
            <p style={{ fontSize: 14 }}>{read.suggested_move}</p>
          </div>
        )}

        {read.where_this_leaves_you && (
          <div className={`${styles.insight} ${styles.relax}`}>
            <div className={styles.k}>Where this leaves you</div>
            <p style={{ fontSize: 14 }}>{read.where_this_leaves_you}</p>
          </div>
        )}
      </div>

      <div className={styles.footerActions}>
        <Link href="/" className={styles.secondary} style={{ display: "block", textAlign: "center" }}>
          Done for now
        </Link>
      </div>
    </section>
  );
}

function BarRow({ bar, color }: { bar: Read["bars"][number]; color: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setWidth(bar.level), 120);
    return () => window.clearTimeout(t);
  }, [bar.level]);
  return (
    <div>
      <div className={styles.barhead}>
        <b>{bar.label}</b>
        <span>{bar.tag}</span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{ background: color, width: `${width}%` }}
        />
      </div>
      <p className={styles.barcap}>{bar.caption}</p>
    </div>
  );
}
