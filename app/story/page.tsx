"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Intake, Read, ReplyDraft, TranscriptMessage } from "@/types";
import { saveConversation, evictExpired, getConversation } from "@/lib/localConversations";
import styles from "./story.module.css";

type Screen =
  | "cover"
  | "welcome"
  | "pick"
  | "person"
  | "history"
  | "report"
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
  | "clarify"
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
type ExtractStatus = "idle" | "running" | "done" | "failed";

type RosterPerson = { id: string; nickname: string; differentiator: string | null };
type ClientReport = { id: string; result: Read; created_at: string };

/** Mirrors the server's normalizeNickname for collision checks (CLAUDE.md §2.7). */
const normalizeNickname = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

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
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [personId, setPersonId] = useState<string | undefined>(undefined);
  const [signedIn, setSignedIn] = useState(false);
  const [clarifyQs, setClarifyQs] = useState<string[]>([]);
  const [clarifyAns, setClarifyAns] = useState<string[]>([]);
  const [clarifyLoading, setClarifyLoading] = useState(false);
  const bgReadRef = useRef<{ conv: string; promise: Promise<Read> } | null>(null);
  const savedRef = useRef<{ personId?: string; reportId?: string }>({});
  const [regenCount, setRegenCount] = useState(0);
  const [personReports, setPersonReports] = useState<ClientReport[]>([]);
  const [pattern, setPattern] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ClientReport | null>(null);
  const [fromPerson, setFromPerson] = useState(false);
  // FLAG-23: background upload+extraction. extractStatus drives the calm beat and
  // the failure override; reviewMessages holds a needsCheck verification until the
  // transcript is actually consumed (at clarify).
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>("idle");
  const [extractError, setExtractError] = useState("");
  const [reviewMessages, setReviewMessages] = useState<TranscriptMessage[] | null>(null);
  const [pasteTextMode, setPasteTextMode] = useState(false);
  const extractAbortRef = useRef<AbortController | null>(null);
  const resumeToRef = useRef<Screen | null>(null);

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

  // Safe-B-lite: as soon as the conversation is in hand (after paste), start
  // generating the read in the background (preview = no auth/save/email) so the
  // wait overlaps the remaining questions. Capped so it never hangs.
  const startBgRead = useCallback((conversation: string, intake: Intake) => {
    const promise = (async () => {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...intake, conversation, preview: true }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "preview failed");
        return data.read as Read;
      } finally {
        window.clearTimeout(t);
      }
    })();
    promise.catch(() => {}); // produceRead handles failures; avoid unhandled rejection
    bgReadRef.current = { conv: conversation, promise };
  }, []);

  // FLAG-23: extract the screenshots in the BACKGROUND, while the user answers
  // intake. Mirrors the FLAG-21 follow-up (25s abort + specific copy) but sets
  // state instead of advancing — the flow has already moved on. On success it
  // chains the Safe-B-lite background read; needsCheck is held for clarify-time
  // (a verification, not a failure); hard failures flip status to "failed" so the
  // global override surfaces them wherever the user is.
  const startBgExtract = useCallback(
    (images: ShotImage[], nickname: string, intake: Intake) => {
      extractAbortRef.current?.abort();
      const ctrl = new AbortController();
      extractAbortRef.current = ctrl;
      setExtractStatus("running");
      setExtractError("");
      setReviewMessages(null);
      const t = window.setTimeout(() => ctrl.abort(), 25000);
      (async () => {
        try {
          const res = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nickname,
              images: images.map((i) => ({ media_type: i.media_type, data: i.data })),
            }),
            signal: ctrl.signal,
          });
          const data = await res.json();
          // A newer upload superseded this one — drop the stale result.
          if (extractAbortRef.current !== ctrl) return;
          if (!res.ok) throw new Error(data?.error || "Couldn't read those.");
          const msgs = data.messages as TranscriptMessage[];
          if (data.needsCheck) {
            // Verification waits until the transcript is consumed (clarify).
            setReviewMessages(msgs);
            setExtractStatus("done");
          } else {
            const text = msgs.map((m) => `${m.speaker}: ${m.text}`).join("\n");
            setAnswers((a) => ({ ...a, conversation: text }));
            startBgRead(text, { ...intake, conversation: text });
            setExtractStatus("done");
          }
        } catch (err) {
          if (extractAbortRef.current !== ctrl) return;
          const msg =
            err instanceof DOMException && err.name === "AbortError"
              ? "That took too long — try again, or paste the text instead."
              : err instanceof Error
                ? err.message
                : "Couldn't read those — try again, or paste the text instead.";
          setExtractError(msg);
          setExtractStatus("failed");
        } finally {
          window.clearTimeout(t);
        }
      })();
    },
    [startBgRead],
  );

  const produceRead = useCallback(async () => {
    setStatus("loading");
    setError("");
    const clarifications = clarifyQs.map((q, i) => ({ q, a: clarifyAns[i] ?? "" }));

    const freshPreview = async (): Promise<Read> => {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...answers, preview: true, clarifications }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Something went wrong.");
        return data.read as Read;
      } finally {
        window.clearTimeout(t);
      }
    };

    try {
      let read: Read;
      const bg = bgReadRef.current;
      // Use the background read ONLY when there are no clarifications to fold in
      // and it was started for this exact conversation. Otherwise generate fresh
      // (full context + the clarify answers). Background failure → fresh.
      if (clarifications.length === 0 && bg && bg.conv === answers.conversation) {
        try {
          read = await bg.promise;
        } catch {
          read = await freshPreview();
        }
      } else {
        read = await freshPreview();
      }
      bgReadRef.current = null;
      setRead(read);
      setStatus("done");

      // Persist (non-blocking) — only the final read is stored; conversation is
      // never re-sent. Then drop the conversation on-device tagged with the ids.
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          read,
          name: answers.name,
          email,
          consent,
          // Update the same report on a backstop regen; create on first save.
          personId: savedRef.current.personId ?? personId,
          reportId: savedRef.current.reportId,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          setEmailed(data?.emailed !== false);
          if (data?.personId && data?.reportId) {
            // The mint set a soft identity + session — recognized from now on.
            setSignedIn(true);
            savedRef.current = { personId: data.personId, reportId: data.reportId };
            saveConversation({
              personId: data.personId,
              reportId: data.reportId,
              text: answers.conversation,
            }).catch(() => {});
          }
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, [answers, email, consent, personId, clarifyQs, clarifyAns]);

  // Kick off the read when we land on the read screen.
  useEffect(() => {
    if (screen === "read" && status === "idle") {
      produceRead();
    }
  }, [screen, status, produceRead]);

  // Lazy eviction of expired on-device conversations on app-open (§2.1).
  useEffect(() => {
    evictExpired();
  }, []);

  // Pre-read clarification (FLAG-18): fetch 0–2 questions; none → straight to
  // the read. Never blocks — any failure degrades to going to the read.
  useEffect(() => {
    if (screen !== "clarify") return;
    // Wait for a ready transcript: extraction must be done (or never ran, for the
    // paste-text path), no pending verification, and a conversation in hand.
    if (extractStatus === "running" || extractStatus === "failed") return;
    if (reviewMessages) return;
    if (!answers.conversation) return;
    let cancelled = false;
    setClarifyLoading(true);
    setClarifyQs([]);
    fetch("/api/clarify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation: answers.conversation, nickname: name }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const qs = Array.isArray(d?.questions) ? d.questions.slice(0, 2) : [];
        setClarifyLoading(false);
        if (qs.length === 0) {
          go("read");
        } else {
          setClarifyQs(qs);
          setClarifyAns(qs.map(() => ""));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setClarifyLoading(false);
        go("read");
      });
    return () => {
      cancelled = true;
    };
  }, [screen, answers.conversation, name, go, extractStatus, reviewMessages]);

  // Load the signed-in user's roster (empty if not signed in) for pick-or-create.
  useEffect(() => {
    fetch("/api/persons")
      .then((r) => r.json())
      .then((d) => setRoster(Array.isArray(d?.persons) ? d.persons : []))
      .catch(() => {});
  }, []);

  // Entry routing (FLAG-22): a recognized session jumps straight to the roster;
  // a known device (soft token, no session) gets the welcome/recognition step;
  // a true first-timer stays on the cover.
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.signedIn) {
          setSignedIn(true);
          if (typeof d.email === "string") setEmail(d.email);
          setScreen("pick");
        } else if (d?.hasSoftToken) {
          setScreen("welcome");
        }
      })
      .catch(() => {});
  }, []);

  // On the person overview, load their past reports + the cross-report pattern.
  useEffect(() => {
    if (screen !== "person" || !personId) return;
    setPersonReports([]);
    setPattern(null);
    fetch(`/api/persons/${personId}/reports`)
      .then((r) => r.json())
      .then((d) => setPersonReports(Array.isArray(d?.reports) ? d.reports : []))
      .catch(() => {});
    fetch(`/api/persons/${personId}/pattern?nickname=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => setPattern(typeof d?.insight === "string" ? d.insight : null))
      .catch(() => {});
  }, [screen, personId, name]);

  const idx = FLOW.indexOf(screen);
  const progress = (["cover", "pick", "person", "history", "report"] as Screen[]).includes(
    screen,
  )
    ? 0
    : idx < 0
      ? 100
      : Math.round((idx / (FLOW.length - 1)) * 100);

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
          {/* FLAG-23: a background extraction failure interrupts the flow wherever
              the user is — including clarify / the "putting it together" beat. */}
          {extractStatus === "failed" ? (
            <ExtractFailure
              error={extractError}
              onReupload={() => {
                resumeToRef.current = screen; // resume where they were
                setExtractStatus("idle");
                setExtractError("");
                setPasteTextMode(false);
                go("paste");
              }}
              onPaste={() => {
                resumeToRef.current = screen;
                setExtractStatus("idle");
                setExtractError("");
                setPasteTextMode(true);
                go("paste");
              }}
            />
          ) : (
          <>
          {screen === "cover" && (
            <Cover onStart={() => go(roster.length ? "pick" : "name")} />
          )}

          {screen === "pick" && (
            <PickScreen
              roster={roster}
              onPick={(p) => {
                setPersonId(p.id);
                setAnswers((a) => ({ ...a, name: p.nickname }));
                go("person");
              }}
              onNew={() => {
                setPersonId(undefined);
                go("name");
              }}
            />
          )}

          {screen === "person" && (
            <PersonScreen
              nickname={name}
              reports={personReports}
              pattern={pattern}
              onNewReport={() => {
                setFromPerson(true);
                setStatus("idle");
                setRead(null);
                setAnswers((a) => ({ ...a, conversation: "" }));
                go("paste");
              }}
              onSeePast={() => go("history")}
            />
          )}

          {screen === "history" && (
            <HistoryScreen
              nickname={name}
              reports={personReports}
              onOpen={(r) => {
                setSelectedReport(r);
                go("report");
              }}
            />
          )}

          {screen === "report" && selectedReport && (
            <ReportScreen
              nickname={name}
              report={selectedReport}
              canReply={personReports.slice(0, 3).some((r) => r.id === selectedReport.id)}
            />
          )}

          {screen === "name" && (
            <NameScreen
              value={answers.name}
              roster={roster}
              onContinue={(v) => {
                setPersonId(undefined);
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
                // Signed-in users skip the in-flow email/code step.
                go(screen === "feeling" && signedIn ? "clarify" : nextOf(screen));
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
              initialMode={pasteTextMode ? "text" : undefined}
              onText={(v) => {
                // New read → fresh save (don't update a previous report) + reset regens.
                savedRef.current = {};
                setRegenCount(0);
                setExtractStatus("idle"); // paste-text: no extraction to wait on
                setReviewMessages(null);
                setAnswers((a) => ({ ...a, conversation: v }));
                // Safe-B-lite: start generating the read now, in the background.
                startBgRead(v, { ...answers, conversation: v });
                const target = resumeToRef.current ?? (fromPerson ? "clarify" : "met");
                resumeToRef.current = null;
                setPasteTextMode(false);
                go(target);
              }}
              onImages={(imgs) => {
                savedRef.current = {};
                setRegenCount(0);
                // Conversation is empty until extraction lands; clear any stale text.
                setAnswers((a) => ({ ...a, conversation: "" }));
                // FLAG-23: extract in the background and move into the questions now.
                startBgExtract(imgs, name, { ...answers, conversation: "" });
                const target = resumeToRef.current ?? (fromPerson ? "clarify" : "met");
                resumeToRef.current = null;
                setPasteTextMode(false);
                go(target);
              }}
            />
          )}

          {screen === "welcome" && (
            <WelcomeScreen
              onRecognized={(em) => {
                setSignedIn(true);
                setEmail(em);
                setScreen("pick");
              }}
              onFresh={() => setScreen("cover")}
            />
          )}

          {screen === "email" && (
            <EmailScreen
              name={name}
              email={email}
              consent={consent}
              setEmail={setEmail}
              setConsent={setConsent}
              onUnlock={() => go("clarify")}
            />
          )}

          {screen === "clarify" &&
            (extractStatus === "running" ? (
              // Background extraction is still finishing — the calm Safe-B-lite beat.
              <section className={styles.screen}>
                <div className={styles.stepHead}>
                  <TypingDots />
                </div>
                <p className={styles.subtext}>Putting it together&hellip;</p>
              </section>
            ) : reviewMessages ? (
              // FLAG-20 verification, surfaced now that the transcript is consumed.
              <section className={styles.screen}>
                <TranscriptReview
                  name={name}
                  messages={reviewMessages}
                  setMessages={(m) => setReviewMessages(m)}
                  onRedo={() => {
                    resumeToRef.current = "clarify";
                    setReviewMessages(null);
                    setExtractStatus("idle");
                    setPasteTextMode(false);
                    go("paste");
                  }}
                  onConfirm={() => {
                    const text = reviewMessages
                      .map((m) => `${m.speaker}: ${m.text}`)
                      .join("\n");
                    setAnswers((a) => ({ ...a, conversation: text }));
                    startBgRead(text, { ...answers, conversation: text });
                    setReviewMessages(null); // clears the gate → clarify fetch runs
                  }}
                />
              </section>
            ) : clarifyLoading ? (
              <section className={styles.screen}>
                <div className={styles.stepHead}>
                  <TypingDots />
                </div>
                <p className={styles.subtext}>
                  Reading the chat once more before your read&hellip;
                </p>
              </section>
            ) : clarifyQs.length > 0 ? (
              <ClarifyScreen
                questions={clarifyQs}
                onDone={(ans) => {
                  setClarifyAns(ans);
                  go("read");
                }}
              />
            ) : null)}

          {screen === "read" && (
            <ReadScreen
              name={name}
              status={status}
              read={read}
              error={error}
              emailed={emailed}
              conversation={answers.conversation}
              canFix={regenCount < 2}
              onFix={(text) => {
                setAnswers((a) => ({ ...a, conversation: text }));
                setRegenCount((n) => n + 1);
                bgReadRef.current = null;
                setStatus("idle"); // re-trigger produceRead → updates the same report
              }}
              onRetry={produceRead}
            />
          )}
          </>
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

function PickScreen({
  roster,
  onPick,
  onNew,
}: {
  roster: RosterPerson[];
  onPick: (p: RosterPerson) => void;
  onNew: () => void;
}) {
  const { display, done } = useTypewriter("Who is this about?");
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Pick someone you&rsquo;ve added before, or start with someone new.
          </p>
        )}
      </div>
      {done && (
        <div className={styles.options}>
          {roster.map((p) => (
            <button key={p.id} className={styles.option} onClick={() => onPick(p)}>
              <span>
                {p.nickname}
                {p.differentiator ? ` – ${p.differentiator}` : ""}
              </span>
            </button>
          ))}
          <button className={styles.option} onClick={onNew}>
            <span>+ Someone new</span>
          </button>
        </div>
      )}
    </section>
  );
}

function NameScreen({
  value,
  roster,
  onContinue,
}: {
  value: string;
  roster: RosterPerson[];
  onContinue: (v: string) => void;
}) {
  const { display, done } = useTypewriter(QUESTION.name!);
  const [v, setV] = useState(value);
  const collision = roster.some(
    (p) => p.nickname && normalizeNickname(p.nickname) === normalizeNickname(v),
  );
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
        {collision && (
          <p className={styles.subtext} style={{ marginTop: 8 }}>
            You already have a &ldquo;{v.trim()}&rdquo;. Add something to tell them
            apart &mdash; like &ldquo;{v.trim()} – Hinge&rdquo; &mdash; or keep it
            to add to that same person.
          </p>
        )}
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

/**
 * FLAG-23: a background extraction failed mid-flow. Surfaced wherever the user
 * is (intake question, clarify, the beat) with the same specific FLAG-21 copy,
 * §2.10 voice, and the retry/paste fallback — paste routes around a hung vision
 * call. Intake answers are untouched, so recovery resumes intact.
 */
function ExtractFailure({
  error,
  onReupload,
  onPaste,
}: {
  error: string;
  onReupload: () => void;
  onPaste: () => void;
}) {
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>That didn&rsquo;t go through.</h2>
        </div>
      </div>
      <div className={styles.uploadError} role="alert">
        <span aria-hidden="true">⚠️</span>
        <span>{error}</span>
      </div>
      <div className={styles.footerActions}>
        <button className={styles.primary} onClick={onReupload}>
          Re-upload screenshots
        </button>
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 8 }}
          onClick={onPaste}
        >
          Paste the text instead
        </button>
      </div>
    </section>
  );
}

type Mode = "choose" | "text" | "shots";

function Paste({
  name,
  value,
  initialMode,
  onText,
  onImages,
}: {
  name: string;
  value: string;
  initialMode?: Mode;
  onText: (v: string) => void;
  onImages: (images: ShotImage[]) => void;
}) {
  const { display, done } = useTypewriter("Show me the conversation.");
  const [mode, setMode] = useState<Mode>(
    initialMode ?? (value.trim() ? "text" : "choose"),
  );

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.stepCount}>5 / 9</div>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            {mode === "choose"
              ? "Paste the part that matters, or upload screenshots. Names stay private."
              : "Names stay private — only “You” and the nickname are kept."}
          </p>
        )}
      </div>

      {mode === "choose" && (
        <div className={styles.options}>
          <button className={styles.option} onClick={() => setMode("text")}>
            <span>✍️ Paste the text</span>
          </button>
          <button className={styles.option} onClick={() => setMode("shots")}>
            <span>🖼️ Upload screenshots</span>
          </button>
        </div>
      )}

      {mode === "text" && (
        <PasteText name={name} value={value} onContinue={onText} />
      )}

      {mode === "shots" && (
        <PasteShots onBack={() => setMode("choose")} onConfirm={onImages} />
      )}
    </section>
  );
}

function PasteText({
  name,
  value,
  onContinue,
}: {
  name: string;
  value: string;
  onContinue: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <>
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
    </>
  );
}

type ShotImage = { id: string; dataUrl: string; media_type: string; data: string };
const MAX_IMAGES = 6;

function PasteShots({
  onBack,
  onConfirm,
}: {
  onBack: () => void;
  onConfirm: (images: ShotImage[]) => void;
}) {
  const [images, setImages] = useState<ShotImage[]>([]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Pointer + touch + keyboard reordering. A small activation distance lets the
  // remove button still register taps without starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    setError("");
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    // Stage 1 (FLAG-21): validate format + size + decodability BEFORE any vision
    // call. Specific, actionable message — never a generic "unsupported file".
    const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const MAX_BYTES = 20 * 1024 * 1024; // 20 MB original-file guard
    // FLAG-23 cut: validate + downscale concurrently (was a sequential for-await),
    // preserving order. Per-file validation/errors are unchanged.
    const results = await Promise.all(
      picked.map(async (f): Promise<{ img?: ShotImage; err?: string }> => {
        const type = (f.type || "").toLowerCase();
        if (!ACCEPTED.includes(type)) {
          return {
            err: /heic|heif/i.test(type + " " + f.name)
              ? "HEIC isn't supported — export it as JPG and try again."
              : "That's not an image we can read — use a PNG or JPG screenshot.",
          };
        }
        if (f.size > MAX_BYTES) {
          return { err: "That file's too large — keep the original under 20 MB." };
        }
        const img = await downscaleToBase64(f);
        if (!img) return { err: "Couldn't read that file — try another screenshot." };
        return { img };
      }),
    );
    const out = results.map((r) => r.img).filter((x): x is ShotImage => !!x);
    const err = results.find((r) => r.err)?.err ?? "";
    if (err) setError(err);
    if (out.length) setImages((prev) => [...prev, ...out]);
  }, [images.length]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setImages((prev) => {
      const from = prev.findIndex((x) => x.id === active.id);
      const to = prev.findIndex((x) => x.id === over.id);
      return from === -1 || to === -1 ? prev : arrayMove(prev, from, to);
    });
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />

      {images.length === 0 ? (
        <button className={styles.dropzone} onClick={() => fileRef.current?.click()}>
          <b>Add screenshots</b>
          <span>Up to {MAX_IMAGES} images · earliest first</span>
        </button>
      ) : (
        <>
          {images.length > 1 && (
            <p className={styles.subtext} style={{ marginBottom: 8 }}>
              Drag to put them in order — earliest conversation first.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={images.map((i) => i.id)}
              strategy={rectSortingStrategy}
            >
              <div className={styles.thumbs}>
                {images.map((img, i) => (
                  <SortableThumb
                    key={img.id}
                    img={img}
                    index={i}
                    canReorder={images.length > 1}
                    onRemove={() =>
                      setImages((p) => p.filter((x) => x.id !== img.id))
                    }
                  />
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    className={styles.thumbAdd}
                    onClick={() => fileRef.current?.click()}
                  >
                    +
                  </button>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {error && (
        <div className={styles.uploadError} role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className={styles.footerActions}>
        <button
          className={styles.primary}
          disabled={images.length === 0}
          onClick={() => onConfirm(images)}
        >
          Continue
        </button>
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 8 }}
          onClick={onBack}
        >
          Paste text instead
        </button>
      </div>
    </>
  );
}

function SortableThumb({
  img,
  index,
  canReorder,
  onRemove,
}: {
  img: ShotImage;
  index: number;
  canReorder: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: img.id });

  return (
    <div
      ref={setNodeRef}
      className={styles.thumb}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: canReorder ? "grab" : "default",
        touchAction: "none",
      }}
      {...attributes}
      {...(canReorder ? listeners : {})}
    >
      <span className={styles.thumbBadge}>{index + 1}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.dataUrl} alt={`Screenshot ${index + 1}`} draggable={false} />
      <div className={styles.thumbCtl}>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label="Remove"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function TranscriptReview({
  name,
  messages,
  setMessages,
  onRedo,
  onConfirm,
}: {
  name: string;
  messages: TranscriptMessage[];
  setMessages: (m: TranscriptMessage[]) => void;
  onRedo: () => void;
  onConfirm: () => void;
}) {
  const update = (i: number, patch: Partial<TranscriptMessage>) =>
    setMessages(messages.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => setMessages(messages.filter((_, j) => j !== i));

  return (
    <>
      <p className={styles.subtext} style={{ marginBottom: 10 }}>
        Quick check — fix any wrong speaker or wording, then continue.
      </p>
      <div className={styles.reviewList}>
        {messages.map((m, i) => (
          <div key={i} className={styles.reviewLine}>
            <button
              className={styles.speakerToggle}
              onClick={() => update(i, { speaker: m.speaker === "You" ? name : "You" })}
            >
              {m.speaker === "You" ? "You" : name}
            </button>
            <input
              className={styles.reviewInput}
              value={m.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />
            <button className={styles.reviewDel} aria-label="Delete line" onClick={() => remove(i)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className={styles.footerActions}>
        <button
          className={styles.primary}
          disabled={messages.length === 0}
          onClick={onConfirm}
        >
          Use this conversation
        </button>
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 8 }}
          onClick={onRedo}
        >
          Re-do the screenshots
        </button>
      </div>
    </>
  );
}

/** Read a file, downscale it, and return base64 JPEG. Images only. */
async function downscaleToBase64(file: File): Promise<ShotImage | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = dataUrl;
    });
    const max = 1600;
    let { width, height } = img;
    if (Math.max(width, height) > max) {
      const s = max / Math.max(width, height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      dataUrl: out,
      media_type: "image/jpeg",
      data: out.split(",")[1] ?? "",
    };
  } catch {
    return null;
  }
}

function ClarifyScreen({
  questions,
  onDone,
}: {
  questions: string[];
  onDone: (answers: string[]) => void;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [v, setV] = useState("");
  const { display, done } = useTypewriter(questions[i]);

  const advance = (answer: string) => {
    const next = [...answers];
    next[i] = answer;
    setAnswers(next);
    setV("");
    if (i + 1 < questions.length) setI(i + 1);
    else onDone(next);
  };

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        {questions.length > 1 && (
          <div className={styles.stepCount}>
            {i + 1} / {questions.length}
          </div>
        )}
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Quick check on the chat &mdash; answer or skip, your call.
          </p>
        )}
      </div>
      <div className={styles.spacer} />
      <div className={styles.footerActions}>
        <input
          className={styles.input}
          placeholder="A quick answer&hellip;"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <button
          className={styles.primary}
          style={{ marginTop: 12 }}
          disabled={!v.trim()}
          onClick={() => advance(v.trim())}
        >
          Continue
        </button>
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 8 }}
          onClick={() => advance("")}
        >
          Not sure / skip
        </button>
      </div>
    </section>
  );
}

function WelcomeScreen({
  onRecognized,
  onFresh,
}: {
  onRecognized: (email: string) => void;
  onFresh: () => void;
}) {
  const { display, done } = useTypewriter("Welcome back.");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (data?.recognized) onRecognized(email.trim());
      else setError("That email doesn’t match this device — you can start fresh below.");
    } catch {
      setError("Something went wrong — you can start fresh below.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {done && (
          <p className={styles.subtext}>
            Enter your email to pick up your saved reads on this device.
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
        />
        <button
          className={styles.primary}
          style={{ marginTop: 12 }}
          disabled={!valid || busy}
          onClick={submit}
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 8 }}
          onClick={onFresh}
        >
          Start fresh instead
        </button>
        {error && (
          <p className={styles.subtext} style={{ color: "var(--red)", marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function XDeviceOffer() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("companion_xdevice_offered")) setShow(true);
    } catch {}
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem("companion_xdevice_offered", "1");
    } catch {}
    setShow(false);
  };
  return (
    <p className={styles.subtext} style={{ marginTop: 12, textAlign: "center" }}>
      <Link href="/signin" onClick={dismiss} style={{ color: "var(--accent)" }}>
        Want your reads on any device? Verify your email &rarr;
      </Link>{" "}
      <button
        className={styles.ghost}
        style={{ padding: "0 6px" }}
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </p>
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
            Free &mdash; add your email to get {name}&rsquo;s read. You&rsquo;ll see it
            here either way; we&rsquo;ll also email a copy and save it under your nickname.
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
        />
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Email me my read and save it under my nickname. The conversation I pasted is
            never stored.
          </span>
        </label>
        <p className={styles.subtext} style={{ marginTop: 8, fontSize: 12 }}>
          We&rsquo;ll remember you on this device so you can come back to your reads &mdash;
          clear your browser to undo.
        </p>
        <button
          className={styles.primary}
          style={{ marginTop: 12 }}
          disabled={!ready}
          onClick={onUnlock}
        >
          See my read
        </button>
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function PersonScreen({
  nickname,
  reports,
  pattern,
  onNewReport,
  onSeePast,
}: {
  nickname: string;
  reports: ClientReport[];
  pattern: string | null;
  onNewReport: () => void;
  onSeePast: () => void;
}) {
  const count = reports.length;
  const { display } = useTypewriter(`Your reads about ${nickname}`);
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>{display}</h2>
        </div>
        {count > 0 && (
          <p className={styles.subtext}>
            You&rsquo;ve read {nickname} {count} time{count === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      {count >= 2 && (
        <div className={`${styles.insight} ${styles.relax}`}>
          <div className={styles.k}>What keeps happening</div>
          <p style={{ fontSize: 14 }}>{pattern ?? "Looking across your reads…"}</p>
        </div>
      )}

      <div className={styles.spacer} />
      <div className={styles.footerActions}>
        <button className={styles.primary} onClick={onNewReport}>
          New report
        </button>
        {count > 0 && (
          <button
            className={styles.ghost}
            style={{ display: "block", width: "100%", marginTop: 8 }}
            onClick={onSeePast}
          >
            See past reads
          </button>
        )}
      </div>
    </section>
  );
}

function HistoryScreen({
  nickname,
  reports,
  onOpen,
}: {
  nickname: string;
  reports: ClientReport[];
  onOpen: (r: ClientReport) => void;
}) {
  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>Your reads about {nickname}</h2>
        </div>
        <p className={styles.subtext}>Newest first &mdash; something you read and close.</p>
      </div>
      <div className={styles.options}>
        {reports.map((r) => (
          <button key={r.id} className={styles.option} onClick={() => onOpen(r)}>
            <span>
              <b>{r.result.headline}</b>
              <br />
              <span style={{ fontSize: 12, color: "var(--muted, #7a6b66)" }}>
                {formatDate(r.created_at)} &middot; {r.result.status_tag}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReportScreen({
  nickname,
  report,
  canReply,
}: {
  nickname: string;
  report: ClientReport;
  canReply: boolean;
}) {
  const read = report.result;
  const [conversation, setConversation] = useState<string | null>(null);
  useEffect(() => {
    if (canReply && !read.safety.flag) {
      getConversation(report.id).then(setConversation).catch(() => {});
    }
  }, [canReply, report.id, read.safety.flag]);

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap} style={{ minHeight: 60 }}>
          <h2 className={styles.question}>{read.headline}</h2>
        </div>
        <p className={styles.subtext}>
          {formatDate(report.created_at)} &middot; your read on {nickname}
        </p>
      </div>

      {read.safety.flag ? (
        <div className={`${styles.insight} ${styles.relax}`}>
          <div className={styles.k}>You matter here</div>
          <p style={{ fontSize: 14 }}>
            {read.safety.note ||
              "Some of what you shared worries me for your safety. Please reach out to people you trust."}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.status}>
            <span className={styles.pill}>{read.status_tag}</span>
          </div>
          <ReadBody read={read} />
          {canReply && conversation && conversation.trim() && (
            <ReplyHelper name={nickname} conversation={conversation} />
          )}
        </>
      )}
    </section>
  );
}

function ReadScreen({
  name,
  status,
  read,
  error,
  emailed,
  conversation,
  canFix,
  onFix,
  onRetry,
}: {
  name: string;
  status: Status;
  read: Read | null;
  error: string;
  emailed: boolean;
  conversation: string;
  canFix: boolean;
  onFix: (text: string) => void;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "idle") {
    return (
      <section className={styles.screen}>
        <div className={styles.stepHead}>
          <div className={styles.questionWrap} style={{ minHeight: 60 }}>
            <h2 className={styles.question}>Putting it together&hellip;</h2>
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

      <ReadBody read={read} />

      {/* Reply help only exists while the conversation is in hand right now. */}
      {conversation.trim() && <ReplyHelper name={name} conversation={conversation} />}

      {/* Backstop: catch a confident misread (wrong-side attribution) or enrich
          voice-message gaps. */}
      {canFix && conversation.trim() && (
        <FixBackstop
          conversation={conversation}
          voice={conversation.includes("[voice message]")}
          onFix={onFix}
        />
      )}

      {/* Cross-device upgrade — offered once, after value, never a wall. */}
      <XDeviceOffer />

      <div className={styles.footerActions}>
        <Link href="/" className={styles.secondary} style={{ display: "block", textAlign: "center" }}>
          Done for now
        </Link>
      </div>
    </section>
  );
}

/** The shared body of a read (bars, cards, move, grounding) — used by the live
 * read screen and by opened past reports. */
function ReadBody({ read }: { read: Read }) {
  const toneColor = (tone: string) =>
    tone === "good" ? "var(--green)" : tone === "low" ? "var(--red)" : "var(--amber)";
  return (
    <>
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
    </>
  );
}

function FixBackstop({
  conversation,
  voice,
  onFix,
}: {
  conversation: string;
  voice: boolean;
  onFix: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(conversation);

  if (!open) {
    return (
      <button
        className={styles.secondary}
        style={{ display: "block", width: "100%", marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        {voice
          ? "Want to add what the voice notes were about? It'll sharpen this."
          : "Something look off, or is anyone’s message on the wrong side?"}
      </button>
    );
  }
  return (
    <div className={styles.insight} style={{ marginTop: 12 }}>
      <div className={styles.k}>{voice ? "Add what the voice notes were about" : "Fix the messages"}</div>
      <p className={styles.subtext} style={{ marginTop: 0 }}>
        {voice
          ? "Replace the “[voice message]” lines with what was actually said — just the facts. Then I’ll read it again."
          : "Edit the wording, or move a line to the right speaker (“You:” vs the nickname) — then I’ll read it again."}
      </p>
      <textarea
        className={styles.textarea}
        style={{ minHeight: 120 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className={styles.primary}
        style={{ marginTop: 10 }}
        disabled={!text.trim()}
        onClick={() => onFix(text.trim())}
      >
        Read it again
      </button>
    </div>
  );
}

function ReplyHelper({ name, conversation }: { name: string; conversation: string }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);

  const generate = async () => {
    if (!intent.trim()) return;
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation, intent, nickname: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't draft a reply.");
      setDrafts(data.drafts as ReplyDraft[]);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft a reply.");
      setStatus("error");
    }
  };

  if (!open) {
    return (
      <button
        className={styles.secondary}
        style={{ display: "block", width: "100%", marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        Want me to draft what you&rsquo;d send?
      </button>
    );
  }

  return (
    <div className={styles.insight} style={{ marginTop: 12 }}>
      <div className={styles.k}>Help me reply</div>
      <p className={styles.subtext} style={{ marginTop: 0 }}>
        Tell me what you want to land &mdash; I&rsquo;ll draft a few ways to say it.
      </p>
      <input
        className={styles.input}
        placeholder="e.g. I'm keen but want a real plan, not a maybe"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
      />
      <button
        className={styles.primary}
        style={{ marginTop: 10 }}
        disabled={status === "loading" || !intent.trim()}
        onClick={generate}
      >
        {status === "loading" ? "Drafting…" : drafts.length ? "Try again" : "Draft replies"}
      </button>
      {status === "error" && (
        <p className={styles.subtext} style={{ color: "var(--red)" }}>{error}</p>
      )}
      {drafts.map((d, i) => (
        <DraftCard key={i} draft={d} />
      ))}
    </div>
  );
}

function DraftCard({ draft }: { draft: ReplyDraft }) {
  const [text, setText] = useState(draft.text);
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div className={styles.barhead}>
        <b>{draft.tone}</b>
        <button
          className={styles.ghost}
          onClick={() => {
            navigator.clipboard?.writeText(text).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea
        className={styles.textarea}
        style={{ minHeight: 72 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
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
