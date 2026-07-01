"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import type { Intake, Read, ReplyDraft, TranscriptMessage, DeltaChange, MovementNode, ReadMoment } from "@/types";
import { saveConversation, evictExpired, getConversation, getRecentConversations, deletePersonConversations, pruneOrphanConversations } from "@/lib/localConversations";
import { detectContinuation } from "@/lib/continuation";
import { MAX_IMAGES } from "@/lib/cap";
import { parseWhatsAppExport, type ParsedChat } from "@/lib/whatsapp";
import { toScript, type FriendItem } from "@/lib/friendScript";
import { windowForApi } from "@/lib/window";
import styles from "./story.module.css";

type Screen =
  | "boot"
  | "cover"
  | "recover"
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
  | "read"
  | "reply";

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
  boot: "Private story",
  cover: "Private story",
  recover: "Welcome back",
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
  const [screen, setScreen] = useState<Screen>("boot");
  const [history, setHistory] = useState<Screen[]>([]);
  const [answers, setAnswers] = useState<Intake>(emptyIntake);
  const [status, setStatus] = useState<Status>("idle");
  const [read, setRead] = useState<Read | null>(null);
  const [readTrimmed, setReadTrimmed] = useState(false); // FLAG-43 transparency
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  // Email-delivery flag still tracked from the save response; no longer surfaced
  // on the read screen (the closing line is the cross-device verify offer).
  const [, setEmailed] = useState(true);
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
  // FLAG-34: the backgrounded history question (from-person only), resolved to
  // the question string ("" if none). Kicked at "New report", consumed at clarify.
  const historyQRef = useRef<Promise<string> | null>(null);
  // FLAG-46: set when this read is a detected continuation of a prior one — drives
  // suppressing the FLAG-34 question and fetching the what-changed delta.
  const continuationRef = useRef(false);
  // FLAG-46: identical re-send OR a subset/earlier upload — nothing new to diff (chat-keyed).
  const nothingNewRef = useRef(false);
  const [delta, setDelta] = useState<DeltaChange[] | null>(null);
  const [nothingNew, setNothingNew] = useState(false);
  // Movement-over-time: a different conversation with a person who has prior read(s).
  const [movement, setMovement] = useState<MovementNode[] | null>(null);
  // FLAG-36: mirror of fromPerson, readable inside the []-dep startBgRead.
  const fromPersonRef = useRef(false);
  useEffect(() => {
    fromPersonRef.current = fromPerson;
  }, [fromPerson]);

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
    // FLAG-36: a from-person read always carries the FLAG-34 history
    // clarification, which forces a fresh foreground generate — so a background
    // read here would always be discarded. Skip it; don't spend the Claude call.
    // Latency is unchanged (that read was already regenerated foreground).
    if (fromPersonRef.current) {
      bgReadRef.current = null;
      return;
    }
    const promise = (async () => {
      const ctrl = new AbortController();
      // FLAG-35: 40s (was 25s). Reads land ~15s; 40s is headroom for a transient
      // API slow-window so a slow-but-completing read lands, not a false abort.
      const t = window.setTimeout(() => ctrl.abort(), 40000);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // FLAG-43: cap what's SENT (full stays in answers/IndexedDB).
          body: JSON.stringify({ ...intake, conversation: windowForApi(conversation).text, preview: true }),
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
      // FLAG-25: 60s, not 25s — extraction is backgrounded behind the intake
      // questions, so a longer cap costs no foreground wait, and dense real
      // multi-image chats (output-token bound) legitimately exceed 25s. The
      // paste-text fallback still catches anything genuinely hung.
      const t = window.setTimeout(() => ctrl.abort(), 60000);
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
      // FLAG-35: 40s (was 25s). Post-FLAG-34 every returning read regenerates on
      // this foreground path; 40s covers a transient ~2.7x stall without a false
      // "couldn't finish". The retry below still catches transient errors.
      const t = window.setTimeout(() => ctrl.abort(), 40000);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...answers,
            conversation: windowForApi(answers.conversation).text, // FLAG-43
            preview: true,
            clarifications,
          }),
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
      const acquire = async (): Promise<Read> => {
        if (clarifications.length === 0 && bg && bg.conv === answers.conversation) {
          try {
            return await bg.promise;
          } catch {
            return await freshPreview();
          }
        }
        return await freshPreview();
      };
      try {
        read = await acquire();
      } catch {
        // One automatic retry: a transient first-attempt failure (a tail-latency
        // abort or an API hiccup) on the load-bearing anonymous first read (§2.8)
        // should self-heal, not dump the user on the error screen. The retry is
        // always a fresh generate — the background promise is already spent.
        read = await freshPreview();
      }
      bgReadRef.current = null;

      // FLAG-46: on a detected continuation, fetch the "what changed since last
      // time" delta BEFORE the save below (so /api/delta reads the PRIOR report as
      // newest, not this one) and before reveal (so it's in the initial script).
      // Never blocks: any failure → no delta, just a normal read.
      let deltaChanges: DeltaChange[] = [];
      // FLAG-46: only a GENUINE continuation (new tail beyond the stored prior)
      // fetches the delta. An identical re-send OR a subset/earlier upload
      // (nothingNew) shows NO before/after — keyed on the conversation, so read/
      // sub-score variance can't manufacture a fake change. isContinuation and
      // nothingNew are mutually exclusive by construction (tail vs no-tail).
      if (continuationRef.current && personId) {
        try {
          const d = await fetch("/api/delta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ read, personId, nickname: answers.name }),
          }).then((r) => r.json());
          deltaChanges = Array.isArray(d?.changes) ? (d.changes as DeltaChange[]) : [];
        } catch {
          /* no delta → normal read */
        }
      }
      // Only a REAL set of concrete changes; empty → no before/after shown.
      setDelta(deltaChanges.length > 0 ? deltaChanges : null);
      setNothingNew(nothingNewRef.current);
      // Movement over time: a DIFFERENT conversation with the same person who has
      // prior read(s) — NOT a continuation, NOT a re-send. Replays the saved reads as
      // a timeline. Mutually exclusive with the directional delta / nothing-new.
      const showMovement =
        fromPersonRef.current &&
        !continuationRef.current &&
        !nothingNewRef.current &&
        personReports.length > 0;
      const movementNodes = showMovement ? buildMovement(read, personReports) : null;
      setMovement(movementNodes);

      setRead(read);
      // FLAG-43: was the read generated from a windowed (capped) conversation?
      // Drives the transparency line; the stored conversation is still full.
      setReadTrimmed(windowForApi(answers.conversation).trimmed);
      setStatus("done");

      // Persist (non-blocking) — only the final read is stored; conversation is
      // never re-sent. Then drop the conversation on-device tagged with the ids.
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // FLAG-46/FLAG-53: persist the high-slot comparison WITH the report so
          // recall shows the same snapshot it had at creation — the directional
          // before/after on a continuation, OR the movement timeline on a different-
          // conversation re-read (mutually exclusive). Absent on a plain first read.
          read: {
            ...read,
            ...(deltaChanges.length > 0 ? { delta: deltaChanges } : {}),
            ...(movementNodes && movementNodes.length >= 2 ? { movement: movementNodes } : {}),
          },
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
  }, [answers, email, consent, personId, clarifyQs, clarifyAns, personReports]);

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

    (async () => {
      // FLAG-46 DETECT-FIRST: before deciding the question, check whether this is
      // a re-send of the same conversation (continuation). Detection GATES the
      // FLAG-34 question — on a continuation the question is suppressed and the
      // what-changed delta carries the "since last time" thread instead, so the
      // two never both reference the prior behaviour. Runs here, before any
      // question is built, so it can't fire after the question already showed.
      continuationRef.current = false;
      nothingNewRef.current = false;
      if (fromPerson && personId) {
        try {
          const prior = await getRecentConversations(personId, 1);
          if (prior[0]) {
            const c = detectContinuation(prior[0].text, answers.conversation);
            continuationRef.current = c.isContinuation;
            // FLAG-46: identical re-send OR a subset/earlier upload (no new tail
            // beyond the stored prior). Keyed on the CHAT, not the reading — so
            // read/sub-score variance can't fake a change. Gates the delta off and
            // shows the calm "nothing new" note instead of a fresh read.
            nothingNewRef.current = c.nothingNew;
          }
        } catch {
          /* detection failure → normal read + normal question (safe fallthrough) */
        }
      }
      if (cancelled) return;

      // FLAG-34: the backgrounded history question (from-person only) rides in
      // FRONT of the generic clarify — UNLESS this is a continuation (delta carries
      // the thread) or a nothing-new re-send (no fresh-read question). Generic
      // clarify adds a 2nd question only when it genuinely finds a verdict-forking
      // ambiguity.
      const historyP =
        continuationRef.current || nothingNewRef.current
          ? Promise.resolve("")
          : (historyQRef.current ?? Promise.resolve("")).catch(() => "");
      const genericP = fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation: windowForApi(answers.conversation).text, // FLAG-43 (absorbs FLAG-41)
          nickname: name,
        }),
      })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d?.questions) ? (d.questions as string[]) : []))
        .catch(() => [] as string[]);

      const [hq, generic] = await Promise.all([historyP, genericP]);
      if (cancelled) return;
      const qs = [...(hq ? [hq] : []), ...generic].slice(0, 2);
      setClarifyLoading(false);
      if (qs.length === 0) {
        go("read");
      } else {
        setClarifyQs(qs);
        setClarifyAns(qs.map(() => ""));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, answers.conversation, name, go, extractStatus, reviewMessages, fromPerson, personId]);

  // Entry boot (FLAG-38): decide the first screen ONCE, then render — no
  // first-time→returning flash. Three lanes kept separate:
  //   (a) /api/me  → the SOLE "returning?" signal; entry routes only from it.
  //   (b) roster   → pick-vs-create *within* a recognized session, after it loads.
  //   (c) personReports (elsewhere) → FLAG-34 history question only; never entry.
  // /api/me is cookie-only server-side (no DB) but still a round-trip; /api/persons
  // adds a Neon query, so we gate on max(me, persons) — both run in parallel.
  useEffect(() => {
    type Me = { signedIn?: boolean; email?: string; hasSoftToken?: boolean };
    const meP: Promise<Me | null> = fetch("/api/me")
      .then((r) => r.json())
      .catch(() => null);
    const personsP: Promise<RosterPerson[]> = fetch("/api/persons")
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.persons) ? d.persons : []))
      .catch(() => []);

    // Data lanes — populate session + roster whenever they land; never move the
    // screen. So even a timed-out-to-cover user keeps their session/roster.
    meP.then((me) => {
      if (me?.signedIn) {
        setSignedIn(true);
        if (typeof me.email === "string") setEmail(me.email);
      }
    });
    personsP.then((persons) => {
      setRoster(persons);
      // Evict on-device conversations orphaned by a person delete (this or another
      // device) or an identity change — anything under no live person. Server roster
      // is source of truth; no-ops on an empty roster (see pruneOrphanConversations).
      pruneOrphanConversations(persons.map((p) => p.id));
    });

    // Screen lane — decided ONCE. A cold/hung check degrades to first-time after
    // a cap (safe — "treated as new"), never stuck on the splash.
    let decided = false;
    const cap = new Promise<null>((res) => setTimeout(() => res(null), 2500));
    Promise.race([Promise.all([meP, personsP]).then(([me]) => me), cap]).then((me) => {
      if (decided) return;
      decided = true;
      if (me?.signedIn) setScreen("pick");
      else if (me?.hasSoftToken) setScreen("welcome");
      else setScreen("cover");
    });
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
  const progress = (["boot", "cover", "recover", "pick", "person", "history", "report"] as Screen[]).includes(
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
              {screen === "cover" || screen === "boot" || screen === "recover"
                ? "Companion"
                : `${name}’s story`}
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
          {screen === "boot" && <Boot />}

          {/* Cover is the first-timer screen only; recognized users are routed to
              pick/welcome at boot. So Start always begins a new-person read — the
              roster.length signal (wrong + racy) is gone (FLAG-38). Recover is the
              tier-3 (no-token) recovery entry — quiet/secondary (FLAG-47). */}
          {screen === "cover" && (
            <Cover onStart={() => go("name")} onRecover={() => go("recover")} />
          )}

          {screen === "recover" && (
            <RecoverScreen
              onBack={() => go("cover")}
              onRecovered={async (em) => {
                // Verified email ownership → session is set. Load the roster ONLY
                // now (never on email entry alone), then into pick-or-create.
                setSignedIn(true);
                setEmail(em);
                const persons = await fetch("/api/persons")
                  .then((r) => r.json())
                  .then((d) => (Array.isArray(d?.persons) ? d.persons : []))
                  .catch(() => []);
                setRoster(persons);
                go("pick");
              }}
            />
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
                historyQRef.current = null; // new person → no history question
                go("name");
              }}
              onDelete={async (p) => {
                // Server is the source of truth for the roster: delete there first,
                // and only mirror locally + drop from the list once it confirms — so a
                // failed/offline server delete never leaves a ghost-free roster while
                // the person still exists on the server (or vice versa).
                const ok = await fetch(`/api/persons/${p.id}`, { method: "DELETE" })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => d?.ok === true)
                  .catch(() => false);
                if (!ok) return false;
                await deletePersonConversations(p.id); // local cleanup (best-effort)
                setRoster((rs) => rs.filter((x) => x.id !== p.id));
                return true;
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
                // FLAG-34: generate the personal history question now, in the
                // background, so it's ready by clarify (overlaps upload/paste).
                historyQRef.current = personId
                  ? fetch("/api/history-question", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ personId, nickname: name }),
                    })
                      .then((r) => r.json())
                      .then((d) => (typeof d?.question === "string" ? d.question : ""))
                      .catch(() => "")
                  : null;
                go("paste");
              }}
              onShowPrevious={() => {
                // Read-only recall of the most recent saved read (newest first).
                // No re-analyze — open the stored report in full; back returns here.
                if (personReports[0]) {
                  setSelectedReport(personReports[0]);
                  go("report");
                }
              }}
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

          {/* ReadScreen stays mounted during the reply screen so the read is
              preserved underneath — same scroll, no re-unfold (FLAG-48 reply). */}
          {(screen === "read" || screen === "reply") && (
            <ReadScreen
              name={name}
              status={status}
              read={read}
              error={error}
              trimmed={readTrimmed}
              delta={delta}
              nothingNew={nothingNew}
              movement={movement}
              conversation={answers.conversation}
              canFix={regenCount < 2}
              onFix={(text) => {
                setAnswers((a) => ({ ...a, conversation: text }));
                setRegenCount((n) => n + 1);
                bgReadRef.current = null;
                setStatus("idle"); // re-trigger produceRead → updates the same report
              }}
              onRetry={produceRead}
              onReply={() => go("reply")}
            />
          )}

          {/* Reply takeover: a real screen (screen state + back), rendered over the
              preserved read. Back returns to the read exactly as left. */}
          {screen === "reply" && (
            <ReplyScreen
              name={name}
              conversation={answers.conversation}
              safety={!!read?.safety.flag}
              onBack={back}
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
/**
 * FLAG-38: the entry splash held while the boot check resolves who you are.
 * Minimal brand mark — deliberately NOT TypingDots (that means "Claude is working
 * on your read"; this means "the app is figuring out who you are before anything
 * starts"). Distinct states, distinct visuals.
 */
function Boot() {
  return (
    <section className={styles.screen} style={{ justifyContent: "center" }}>
      <div className={styles.bootSplash}>
        <div className={styles.bootMark}>Companion</div>
      </div>
    </section>
  );
}

function Cover({ onStart, onRecover }: { onStart: () => void; onRecover: () => void }) {
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
        {/* FLAG-47: tier-3 recovery — discoverable but secondary, so it never
            competes with the primary start path or confuses genuinely-new users. */}
        <button
          className={styles.ghost}
          style={{ display: "block", width: "100%", marginTop: 12 }}
          onClick={onRecover}
        >
          Returning on a new device? Recover your people
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

/**
 * FLAG-47: tier-3 email-code recovery (new device / cleared cookies — no soft
 * token). Reuses the OTP plumbing: request a code, verify it, session is set,
 * then the parent loads the roster. Two-factor: email + the code that proves the
 * user owns it. The message after the email step is neutral (no enumeration).
 */
function RecoverScreen({
  onRecovered,
  onBack,
}: {
  onRecovered: (email: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      // Neutral by design: a registered email and an unregistered one both
      // return ok here — we never reveal which. Only a format/config error stops us.
      if (!res.ok) {
        setError(data?.error || "Couldn't send a code just now. Try again.");
        return;
      }
      setStep("code");
    } catch {
      setError("Couldn't send a code just now. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "That code didn't work. Request a new one.");
        return;
      }
      onRecovered(email.trim());
    } catch {
      setError("That code didn't work. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.screen}>
      <div className={styles.stepHead}>
        <div className={styles.questionWrap}>
          <h2 className={styles.question}>Recover your people</h2>
        </div>
        <p className={styles.subtext}>
          {step === "email"
            ? "New device or cleared your cookies? Enter your email and we'll bring your saved stories back."
            : "If that email's registered, we've sent a 6-digit code. Check your inbox and enter it below."}
        </p>
      </div>

      {step === "email" ? (
        <>
          <input
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && (
            <div className={styles.uploadError} role="alert" style={{ marginTop: 12 }}>
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div className={styles.footerActions}>
            <button
              className={styles.primary}
              disabled={loading || !email.trim()}
              onClick={sendCode}
            >
              {loading ? "Sending…" : "Send code"}
            </button>
            <button
              className={styles.ghost}
              style={{ display: "block", width: "100%", marginTop: 8 }}
              onClick={onBack}
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            className={styles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          {error && (
            <div className={styles.uploadError} role="alert" style={{ marginTop: 12 }}>
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div className={styles.footerActions}>
            <button
              className={styles.primary}
              disabled={loading || code.trim().length < 6}
              onClick={verify}
            >
              {loading ? "Checking…" : "Verify"}
            </button>
            <button
              className={styles.ghost}
              style={{ display: "block", width: "100%", marginTop: 8 }}
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Use a different email
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function PickScreen({
  roster,
  onPick,
  onNew,
  onDelete,
}: {
  roster: RosterPerson[];
  onPick: (p: RosterPerson) => void;
  onNew: () => void;
  onDelete: (p: RosterPerson) => Promise<boolean>;
}) {
  const { display, done } = useTypewriter("Who is this about?");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function doDelete(p: RosterPerson) {
    setBusyId(p.id);
    setErrorId(null);
    const ok = await onDelete(p); // on success the row leaves the roster on its own
    setBusyId(null);
    if (!ok) setErrorId(p.id); // keep the confirm open so they can retry
  }

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
          {roster.map((p) =>
            confirmingId === p.id ? (
              <div key={p.id} className={styles.confirmRow}>
                <p className={styles.confirmText}>
                  Delete {p.nickname} and their history? This can&rsquo;t be undone.
                </p>
                {errorId === p.id && (
                  <p className={styles.confirmError}>Couldn&rsquo;t delete &mdash; try again.</p>
                )}
                <div className={styles.confirmActions}>
                  <button
                    className={styles.confirmCancel}
                    onClick={() => {
                      setConfirmingId(null);
                      setErrorId(null);
                    }}
                    disabled={busyId === p.id}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.confirmDelete}
                    onClick={() => doDelete(p)}
                    disabled={busyId === p.id}
                  >
                    {busyId === p.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div key={p.id} className={styles.optionRow}>
                <button className={styles.option} onClick={() => onPick(p)}>
                  <span>
                    {p.nickname}
                    {p.differentiator ? ` – ${p.differentiator}` : ""}
                  </span>
                </button>
                <button
                  className={styles.deleteBtn}
                  aria-label={`Delete ${p.nickname}`}
                  onClick={() => {
                    setErrorId(null);
                    setConfirmingId(p.id);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ),
          )}
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

type Mode = "choose" | "enter" | "whatsapp" | "text" | "shots";

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
              ? "Enter the conversation, or upload screenshots. Names stay private."
              : mode === "enter"
                ? "Import a WhatsApp chat, or paste the text yourself. Names stay private."
                : "Names stay private — only “You” and the nickname are kept."}
          </p>
        )}
      </div>

      {mode === "choose" && (
        <div className={styles.options}>
          <button className={styles.option} onClick={() => setMode("enter")}>
            <span>
              💬 Enter conversation
              <small>Import a WhatsApp chat, or type it in</small>
            </span>
          </button>
          <button className={styles.option} onClick={() => setMode("shots")}>
            <span>🖼️ Upload screenshots</span>
          </button>
        </div>
      )}

      {/* "Enter conversation" sub-choice: WhatsApp first (the reliable path),
          plain text second (the existing manual paste). */}
      {mode === "enter" && (
        <>
          <div className={styles.options}>
            <button className={styles.option} onClick={() => setMode("whatsapp")}>
              <span>
                💬 WhatsApp
                <small>Export the chat and upload the file</small>
              </span>
            </button>
            <button className={styles.option} onClick={() => setMode("text")}>
              <span>
                ✍️ Plain text
                <small>Paste the lines that matter</small>
              </span>
            </button>
          </div>
          <button
            className={styles.ghost}
            style={{ display: "block", width: "100%", marginTop: 12 }}
            onClick={() => setMode("choose")}
          >
            Back
          </button>
        </>
      )}

      {mode === "whatsapp" && (
        <WhatsAppImport name={name} onText={onText} onBack={() => setMode("enter")} />
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

const WA_STEPS: Record<"ios" | "android", string[]> = {
  ios: [
    "Open the chat in WhatsApp.",
    "Tap the name at the top to open contact info.",
    "Scroll down and tap “Export Chat”.",
    "Choose “Without Media”.",
    "Save it (to Files, or mail it to yourself), then upload it here.",
  ],
  android: [
    "Open the chat in WhatsApp.",
    "Tap ⋮ (top right) → More → “Export chat”.",
    "Choose “Without Media”.",
    "Save or send it to yourself, then upload it here.",
  ],
};

/**
 * FLAG-37: pull the WhatsApp chat .txt out of an export zip, entirely in the
 * browser (JSZip is dynamic-imported so it stays off the .txt path and out of
 * the main bundle). Media entries are never decompressed — only the chosen .txt
 * is. Throws "NO_TXT" when the zip has no chat text; loadAsync throws on a
 * corrupt zip. The zip bytes never leave the device.
 */
async function readTxtFromZip(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const txts = Object.values(zip.files).filter((f) => {
    const base = f.name.split("/").pop() ?? f.name;
    // Real .txt entries only — skip directories, the __MACOSX/ folder, and
    // ._-prefixed AppleDouble stubs (a Mac re-zip leaves "._chat.txt" junk).
    return (
      !f.dir &&
      /\.txt$/i.test(f.name) &&
      !f.name.startsWith("__MACOSX/") &&
      !base.startsWith("._")
    );
  });
  if (txts.length === 0) throw new Error("NO_TXT");
  // Prefer the canonical chat file (iOS "_chat.txt", Android "WhatsApp Chat
  // with ….txt"); otherwise the first real .txt.
  const chat =
    txts.find((f) => /(^|\/)_chat\.txt$/i.test(f.name)) ??
    txts.find((f) => /whatsapp chat with/i.test(f.name)) ??
    txts[0];
  return chat.async("string");
}

/**
 * WhatsApp import (FLAG-32): per-device export steps → .txt upload → parse on
 * device → "which one is you?" → map the chosen sender to "You" and the other
 * to the nickname, flatten to the same transcript text the read pipeline takes,
 * and hand it to onText. No real name and no raw file ever leaves the device.
 */
function WhatsAppImport({
  name,
  onText,
  onBack,
}: {
  name: string;
  onText: (v: string) => void;
  onBack: () => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const [parsed, setParsed] = useState<ParsedChat | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) {
      setPlatform("android");
    }
  }, []);

  const onFile = useCallback(async (file?: File) => {
    setError("");
    if (!file) return;
    const isZip = /\.zip$/i.test(file.name) || /zip/i.test(file.type);
    // FLAG-37: validate SIZE BEFORE opening the zip — reject an oversized
    // container without decompressing it. Only the txt entry is ever
    // decompressed, so memory ≈ txt size; 50 MB just guards an absurd container.
    const cap = isZip ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
    if (file.size > cap) {
      setError(
        isZip
          ? "That zip's too large — export “Without Media” and it'll be just a few MB."
          : "That file's too large — a “Without Media” export should be well under 8 MB.",
      );
      return;
    }
    let raw = "";
    try {
      // .zip → unzip in-browser and pull the chat .txt out (FLAG-37); .txt →
      // read directly (FLAG-32, unchanged). Both feed the same parser below.
      raw = isZip ? await readTxtFromZip(file) : await file.text();
    } catch (err) {
      setError(
        err instanceof Error && err.message === "NO_TXT"
          ? "Couldn't find the chat text in that zip — make sure it's a WhatsApp export."
          : isZip
            ? "Couldn't open that zip — try exporting again, or upload the .txt."
            : "Couldn't read that file — try exporting the chat again.",
      );
      return;
    }
    const chat = parseWhatsAppExport(raw);
    // Media lines are EXPECTED and fine — the parser turns them into [media] /
    // [voice message] gaps; they are NEVER a reason to reject. The only real
    // failures are: nothing parsed, or only one side present (so the
    // "which one is you?" step can't work).
    if (chat.messages.length === 0) {
      setError(
        "I couldn't read any messages from that file. Upload the .txt WhatsApp gives you from the chat's “Export Chat” — photos and voice notes just show up as gaps, that's fine.",
      );
      return;
    }
    if (chat.senders.length < 2) {
      setError(
        "That looks like only one side of the conversation. Export the full chat between you and them, then upload it here.",
      );
      return;
    }
    setParsed(chat);
  }, []);

  const pickYou = (you: string) => {
    if (!parsed) return;
    // Map BEFORE anything leaves the device: chosen sender → "You", everyone
    // else → the nickname. Real names never reach the server (privacy invariant).
    const text = parsed.messages
      .map((m) => `${m.sender === you ? "You" : name}: ${m.text}`)
      .join("\n");
    onText(text);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.zip,text/plain,application/zip,application/x-zip-compressed"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {!parsed ? (
        <>
          <div className={styles.waToggle}>
            {(["ios", "android"] as const).map((p) => (
              <button
                key={p}
                className={`${styles.waToggleBtn}${platform === p ? ` ${styles.waToggleBtnActive}` : ""}`}
                onClick={() => setPlatform(p)}
              >
                {p === "ios" ? "iPhone" : "Android"}
              </button>
            ))}
          </div>
          <ol className={styles.waSteps}>
            {WA_STEPS[platform].map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className={styles.subtext} style={{ marginBottom: 4 }}>
            Upload whatever WhatsApp gives you — a .txt or .zip both work (any media is ignored).
          </p>
          {error && (
            <div className={styles.uploadError} role="alert">
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div className={styles.footerActions}>
            <button className={styles.primary} onClick={() => fileRef.current?.click()}>
              Upload .txt or .zip
            </button>
            <button
              className={styles.ghost}
              style={{ display: "block", width: "100%", marginTop: 8 }}
              onClick={onBack}
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.subtext} style={{ marginBottom: 6 }}>
            Got {parsed.messages.length} messages. Which one is you?
          </p>
          <div className={styles.options}>
            {parsed.senders.map((s) => (
              <button key={s} className={styles.option} onClick={() => pickYou(s)}>
                <span>{s}</span>
              </button>
            ))}
          </div>
          <button
            className={styles.ghost}
            style={{ display: "block", width: "100%", marginTop: 12 }}
            onClick={() => {
              setParsed(null);
              setError("");
            }}
          >
            Use a different file
          </button>
        </>
      )}
    </>
  );
}

type ShotImage = { id: string; dataUrl: string; media_type: string; data: string };
function PasteShots({
  onBack,
  onConfirm,
}: {
  onBack: () => void;
  onConfirm: (images: ShotImage[]) => void;
}) {
  const [images, setImages] = useState<ShotImage[]>([]);
  const [error, setError] = useState("");
  // FLAG-27: the drag-drop hover state.
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // FLAG-29: over-selection is gated at Continue, not sliced at add. The count
  // can exceed MAX_IMAGES; Continue stays disabled until the user trims back.
  const overBy = images.length - MAX_IMAGES;

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
    const all = Array.from(files);
    if (all.length === 0) return;
    // FLAG-29: add ALL validated images — no slice. Over-selection is handled at
    // the Continue gate (the count can exceed MAX_IMAGES), not by dropping files.
    // The file picker and drag-drop both reach this one validation path.
    // Stage 1 (FLAG-21): validate format + size + decodability BEFORE any vision
    // call. Specific, actionable message — never a generic "unsupported file".
    const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const MAX_BYTES = 20 * 1024 * 1024; // 20 MB original-file guard
    // FLAG-23 cut: validate + downscale concurrently (was a sequential for-await),
    // preserving order. Per-file validation/errors are unchanged.
    const results = await Promise.all(
      all.map(async (f): Promise<{ img?: ShotImage; err?: string }> => {
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
  }, []);

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

      {/* FLAG-27: one drop target over the whole media region. Dropped files go
          through the SAME addFiles as the picker — same Stage-1 validation + cap. */}
      <div
        className={`${styles.dropArea}${dragOver ? ` ${styles.dropAreaOver}` : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {images.length === 0 ? (
          <button className={styles.dropzone} onClick={() => fileRef.current?.click()}>
            <b>Add up to {MAX_IMAGES} screenshots</b>
            <span>Tap to choose, or drag them here · earliest first</span>
          </button>
        ) : (
          <>
            {/* FLAG-30: over the cap → red banner ON TOP of the grid. Red for
                visibility, wording stays directional (instruction, not accusation).
                Numbers interpolated from MAX_IMAGES + live count, never literals. */}
            {overBy > 0 && (
              <div className={styles.uploadBanner} role="alert">
                <div>
                  <b>
                    Remove {overBy} to continue
                  </b>{" "}
                  — max {MAX_IMAGES} images.
                </div>
                <div>Longer conversation? Paste the text instead.</div>
              </div>
            )}
            <p className={styles.subtext} style={{ marginBottom: 8 }}>
              {images.length} of {MAX_IMAGES}
              {images.length > 1 ? " · drag to reorder, earliest first" : ""}
            </p>
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
                      // FLAG-30: thumbnails beyond the cap are dimmed (visual only —
                      // their ✕ stays active) so the extras to remove are obvious.
                      dimmed={i >= MAX_IMAGES}
                      onRemove={() =>
                        setImages((p) => p.filter((x) => x.id !== img.id))
                      }
                    />
                  ))}
                  {/* Greyed (disabled), not hidden, at the cap — communicates the
                      limit; removing a ✕ drops the count and re-enables it. */}
                  <button
                    className={styles.thumbAdd}
                    onClick={() => fileRef.current?.click()}
                    disabled={images.length >= MAX_IMAGES}
                    aria-label={
                      images.length >= MAX_IMAGES
                        ? `Maximum ${MAX_IMAGES} screenshots reached`
                        : "Add screenshot"
                    }
                  >
                    +
                  </button>
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      {error && (
        <div className={styles.uploadError} role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className={styles.footerActions}>
        <button
          className={styles.primary}
          disabled={images.length === 0 || images.length > MAX_IMAGES}
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
  dimmed,
  onRemove,
}: {
  img: ShotImage;
  index: number;
  canReorder: boolean;
  dimmed: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: img.id });

  return (
    <div
      ref={setNodeRef}
      className={`${styles.thumb}${dimmed ? ` ${styles.thumbDimmed}` : ""}`}
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
  onShowPrevious,
}: {
  nickname: string;
  reports: ClientReport[];
  pattern: string | null;
  onNewReport: () => void;
  onShowPrevious: () => void;
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
        {/* View last time's read in full (read-only recall) before deciding to
            re-read. Only shown when there's a saved read to open. */}
        {count > 0 && (
          <button
            className={styles.ghost}
            style={{ display: "block", width: "100%", marginTop: 8 }}
            onClick={onShowPrevious}
          >
            Show my last read
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

const DEFAULT_SAFETY_NOTE =
  "Some of what you shared reads as pressure past a clear no. Trust that instinct — you don’t have to keep engaging. Reach out to people you trust, or your local support services. You don’t have to handle this alone.";

/** FLAG-59: the safety note LEADS the read when safety.flag is set (boundary-override /
 *  coercion). It names the concern plainly and coexists with the full behaviour read
 *  below — it never replaces or minimizes it. */
function SafetyBanner({ note }: { note: string | null }) {
  return (
    <div className={`${styles.insight} ${styles.relax}`} style={{ marginBottom: 16 }}>
      <div className={styles.k}>This may not be safe</div>
      <p style={{ fontSize: 14 }}>{note || DEFAULT_SAFETY_NOTE}</p>
    </div>
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
  // FLAG-54: the "Where it stands now" card shows the same Help-me-reply button as
  // the live page; tapping it reveals the recall reply path (ReplyHelper) inline.
  const [showReply, setShowReply] = useState(false);
  useEffect(() => {
    // FLAG-59: reply stays available even on a flagged read (user autonomy) — the
    // drafts just bias firm (see the safety pass-through below).
    if (canReply) {
      getConversation(report.id).then(setConversation).catch(() => {});
    }
  }, [canReply, report.id]);

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

      {/* FLAG-59: on a safety flag the supportive note LEADS, then the full read still
          follows (bars/receipts intact) — never replaced. Reply stays suppressed (the
          conversation isn't loaded on a flagged read — see the effect above). */}
      {read.safety.flag && <SafetyBanner note={read.safety.note} />}
      {(
        <>
          <div className={styles.status}>
            <span className={styles.pill}>{read.status_tag}</span>
          </div>
          {/* FLAG-46: the persisted "Since last time" before/after, shown in its
              original place (above the read body) exactly as the report had it. Only
              present when this report was a continuation; absent on a first read. The
              .friendRoot wrapper scopes the directional card's theme vars (they don't
              leak into the rest of the report). revealAll → shown at once (this is a
              static recall, not the friend-talking reveal). */}
          {read.delta && read.delta.length > 0 ? (
            <div className={styles.friendRoot}>
              <DeltaSection changes={read.delta} revealAll={true} />
            </div>
          ) : read.movement && read.movement.length >= 2 ? (
            // FLAG-53: the persisted movement-over-time timeline, replayed from the
            // saved snapshot (not regenerated). Animates on open, but never auto-scrolls
            // (recall is a static review screen).
            <div className={styles.friendRoot}>
              <MovementSection
                nodes={read.movement}
                nickname={nickname}
                revealAll={false}
                autoScroll={false}
              />
            </div>
          ) : null}
          {/* FLAG-54: persisted receipts replayed on recall — ABOVE the read body,
              right after the before/after (or after the title when there's none). */}
          {read.receipts && read.receipts.length > 0 && (
            <div className={styles.friendRoot}>
              <ReceiptsSection moments={read.receipts} nickname={nickname} />
            </div>
          )}
          <ReadBody read={read} />
          {canReply && conversation && conversation.trim() && (
            <>
              {/* "Where it stands now" — SAME design as the live page (chat bubbles +
                  reply-line + Help-me-reply button). Tapping the button opens the recall
                  reply flow (ReplyHelper) inline and hides the CTA — the chat bubbles
                  stay as context — so there's ONE section, never a dead button stacked
                  above a second reply UI. */}
              <div className={styles.friendRoot}>
                <WhereItStands
                  conversation={conversation}
                  nickname={nickname}
                  flagged={isFlagged(read)}
                  safety={read.safety.flag}
                  onReply={showReply ? null : () => setShowReply(true)}
                />
              </div>
              {showReply && (
                <ReplyHelper name={nickname} conversation={conversation} safety={read.safety.flag} />
              )}
            </>
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
  trimmed,
  delta,
  nothingNew,
  movement,
  conversation,
  canFix,
  onFix,
  onRetry,
  onReply,
}: {
  name: string;
  status: Status;
  read: Read | null;
  error: string;
  trimmed: boolean;
  delta: DeltaChange[] | null;
  nothingNew: boolean;
  movement: MovementNode[] | null;
  conversation: string;
  canFix: boolean;
  onFix: (text: string) => void;
  onRetry: () => void;
  onReply: () => void;
}) {
  // FLAG-48: "Help me reply" navigates to the dedicated reply screen (onReply →
  // go("reply")); the read stays mounted underneath and is restored on back.
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
  return (
    <section className={styles.screen}>
      {/* FLAG-59: on a safety flag the supportive note LEADS, then the full behaviour
          read still follows below (never replaced/minimized). Reply is suppressed on a
          flagged read — you don't have to keep engaging. */}
      {read.safety.flag && <SafetyBanner note={read.safety.note} />}
      {/* FLAG-48: the read is delivered as a friend talking it through. Pure
          presentation — the analysis/conclusions are unchanged (Option A maps the
          existing Read fields to typed/pop/reveal turns). */}
      <FriendRead
        read={read}
        trimmed={trimmed}
        delta={delta}
        nothingNew={nothingNew}
        movement={movement}
        nickname={name}
        conversation={conversation}
        canReply={!!conversation.trim()}
        onReply={onReply}
      />

      {/* Backstop: catch a confident misread (wrong-side attribution) or enrich
          voice-message gaps. ENTRY POINT HIDDEN (SHOW_FIX_BACKSTOP=false) — the
          edit-and-reread mechanism (FixBackstop + onFix → in-place regen) stays
          intact and dormant; flip the flag to re-expose it without a rebuild. */}
      {SHOW_FIX_BACKSTOP && canFix && conversation.trim() && (
        <FixBackstop
          conversation={conversation}
          voice={conversation.includes("[voice message]")}
          onFix={onFix}
        />
      )}
      {/* The cross-device verify offer is the read's closing line (in FriendRead). */}
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
            <h3>{stripQuotes(c.title)}</h3>
            <p>{renderQuotes(c.body)}</p>
          </div>
        ))}
        {read.suggested_move && (
          <div className={`${styles.insight} ${styles.move}`}>
            <div className={styles.k}>Suggested move</div>
            <p style={{ fontSize: 14 }}>{renderQuotes(read.suggested_move)}</p>
          </div>
        )}
        {read.where_this_leaves_you && (
          <div className={`${styles.insight} ${styles.relax}`}>
            <div className={styles.k}>Where this leaves you</div>
            <p style={{ fontSize: 14 }}>{renderQuotes(read.where_this_leaves_you)}</p>
          </div>
        )}
      </div>
    </>
  );
}

// Manual edit-and-reread entry point is hidden for now (mechanism kept dormant —
// see FixBackstop + onFix). Flip to true to re-expose it; no rebuild needed.
const SHOW_FIX_BACKSTOP = false;

/* ---------- FLAG-48: "friend talking it through" report delivery ---------- */
// Exact timings ported from the approved report-friend-final.html.
const FRIEND = {
  THINK: 3400, TYPE_PER: 20, SPACE: 10, PUNCT: 120, TYPE_PRE: 300, TYPE_POST: 650,
  POP: 560, REVEAL: 820,
} as const;
const FRIEND_PUNCT = /[.,;—?!]/;
// FLAG-46: the directional "Since last time" delta renders after the first two
// script turns (headline + the "reading what they do" subhead) and before the read
// body. toScript always emits those two first, so this index is stable.
const DELTA_AFTER = 2;

const friendToneColor = (tone: string) =>
  tone === "good" ? "var(--f-good)" : tone === "low" ? "var(--f-concern)" : "var(--f-warm)";

function FriendRead({
  read,
  trimmed,
  delta,
  nothingNew,
  movement,
  nickname,
  conversation,
  canReply,
  onReply,
}: {
  read: Read;
  trimmed: boolean;
  delta: DeltaChange[] | null;
  nothingNew: boolean;
  movement: MovementNode[] | null;
  nickname: string;
  conversation: string;
  canReply: boolean;
  onReply: () => void;
}) {
  const script = useMemo(
    () => toScript(read, { trimmed, nothingNew }),
    [read, trimmed, nothingNew],
  );
  const [phase, setPhase] = useState<"thinking" | "flow">("thinking");
  // `shown` counts the OPENING turns committed (0..DELTA_AFTER). Only the opening is
  // timer-sequenced + typed; everything below renders at once on openingDone and
  // reveals on scroll (RevealTurn / DeltaSection), not on a timer.
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState<{ i: number; text: string } | null>(null);
  const [openingDone, setOpeningDone] = useState(false);
  // revealAll forces the body + delta visible without scrolling — set by "Show it
  // all" and by reduced-motion (which also skips the opening typing).
  const [revealAll, setRevealAll] = useState(false);

  const cancelled = useRef(false);
  const timers = useRef<number[]>([]);

  // Typing is the opening signature only — the headline + the first "someone's
  // talking to you" line. The app never scrolls; below the opening, content reveals
  // (fade/rise) as it enters the viewport. "Show it all" skips the opening typing
  // AND reveals everything at once.
  const showAll = useCallback(() => {
    cancelled.current = true;
    timers.current.forEach((t) => clearTimeout(t));
    setTyping(null);
    setPhase("flow");
    setShown(DELTA_AFTER);
    setOpeningDone(true);
    setRevealAll(true);
  }, []);

  // The sequencer types ONLY the opening turns (indices 0..DELTA_AFTER-1), then
  // hands off: the rest is rendered and revealed on scroll. Same typing dwell values
  // as the reference file.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      showAll();
      return;
    }
    cancelled.current = false;
    const list = timers.current;
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        list.push(window.setTimeout(r, ms));
      });
    (async () => {
      await wait(FRIEND.THINK);
      if (cancelled.current) return;
      setPhase("flow");
      for (let i = 0; i < Math.min(DELTA_AFTER, script.length); i++) {
        if (cancelled.current) return;
        const item = script[i];
        if (item.t === "type") {
          await wait(FRIEND.TYPE_PRE);
          if (cancelled.current) return;
          let acc = "";
          setTyping({ i, text: "" });
          for (const ch of item.text) {
            if (cancelled.current) return;
            acc += ch;
            setTyping({ i, text: acc });
            await wait(ch === " " ? FRIEND.SPACE : FRIEND_PUNCT.test(ch) ? FRIEND.PUNCT : FRIEND.TYPE_PER);
          }
          setTyping(null);
          setShown(i + 1);
          await wait(FRIEND.TYPE_POST);
        } else {
          // The opening is always typed turns; this is a defensive fallthrough.
          setShown(i + 1);
          await wait(FRIEND.POP);
        }
      }
      if (!cancelled.current) setOpeningDone(true);
    })();
    return () => {
      cancelled.current = true;
      list.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typingItem = typing ? script[typing.i] : null;

  return (
    <div className={styles.friendRoot}>
      {phase === "thinking" ? (
        <div className={styles.friendThinking}>
          <div className={styles.friendThink} style={{ animationDelay: ".1s" }}>
            Okay — reading it now.
          </div>
          <div className={styles.friendThink} style={{ animationDelay: "1.4s" }}>
            Looking at what they actually do&hellip;
          </div>
        </div>
      ) : (
        <div className={styles.friendFlow}>
          {/* OPENING (typed): script[0] = headline/verdict, script[1] = the "someone's
              talking to you" line. The only letter-by-letter turns — the signature
              opening beat. */}
          {script.slice(0, Math.min(shown, DELTA_AFTER)).map((item, i) => (
            <FriendTurn key={i} item={item} />
          ))}
          {typingItem && typingItem.t === "type" && (
            <div className={styles.friendTurn}>
              <p
                className={`${
                  typingItem.cls === "small"
                    ? styles.friendSmall
                    : `${styles.friendSay} ${typingItem.cls === "accent" ? styles.friendAccent : styles.friendBig}`
                } ${styles.friendCaret}`}
              >
                {typing!.text}
              </p>
            </div>
          )}
          {/* Everything below the opening renders at once (openingDone) and reveals on
              SCROLL — no typing past the opening. */}
          {openingDone && (
            <>
              {/* High slot, MUTUALLY EXCLUSIVE: a continuation shows the directional
                  "Since last time" (what changed); a different-conversation re-read of
                  a person with prior reads shows the movement-over-time timeline.
                  Either sits right under the opening, above the body. */}
              {delta && delta.length > 0 ? (
                <DeltaSection changes={delta} revealAll={revealAll} />
              ) : movement && movement.length >= 2 ? (
                <MovementSection
                  nodes={movement}
                  nickname={nickname}
                  revealAll={revealAll}
                  autoScroll={true}
                />
              ) : null}
              {/* FLAG-54: "Key moments · receipts" — verbatim-validated exchanges. Sits
                  HIGH: right after the before/after (or after the title when there's
                  none), ABOVE the read body. Absent when no receipts survived. */}
              {read.receipts && read.receipts.length > 0 && (
                <RevealTurn revealAll={revealAll}>
                  <ReceiptsSection moments={read.receipts} nickname={nickname} />
                </RevealTurn>
              )}
              {/* The read body (bars, cards, where-this-leaves-you, move) — each fades/
                  rises in as it enters the viewport, no typing. */}
              {script.slice(DELTA_AFTER).map((item, i) => (
                <RevealTurn key={i + DELTA_AFTER} revealAll={revealAll}>
                  <FriendTurn item={item} />
                </RevealTurn>
              ))}
              {/* FLAG-54: "Where it stands now" + Help me reply — the very end. The
                  last real messages (verbatim) + the chat-context reply entry, which
                  wires to the EXISTING reply flow (onReply). Gated on the conversation
                  being in hand (same as reply). */}
              {canReply && (
                <RevealTurn revealAll={revealAll}>
                  <WhereItStands
                    conversation={conversation}
                    nickname={nickname}
                    flagged={isFlagged(read)}
                    safety={read.safety.flag}
                    onReply={onReply}
                  />
                </RevealTurn>
              )}
              {/* Cross-device verify offer: the closing fine print. */}
              <RevealTurn revealAll={revealAll}>
                <p className={`${styles.friendFine} ${styles.friendSaved}`}>
                  <Link href="/signin" style={{ color: "var(--f-accent)" }}>
                    Want your reads on any device? Verify your email &rarr;
                  </Link>
                </p>
              </RevealTurn>
            </>
          )}
        </div>
      )}
      {/* FLAG-48 sticky actions: reachable while scrolling, shown once the opening
          finishes (so they don't compete with the typing). Sticky-bottom as the last
          in-flow child — self-clearing, no content hidden behind it; safe-area padding
          handles the iPhone home bar. */}
      {openingDone && (
        <div className={styles.friendActions}>
          {/* "Help me reply" now lives in the "Where it stands now" card at the end
              (FLAG-54 chat-context entry) — not duplicated here. */}
          <Link href="/" className={`${styles.friendBtn} ${styles.friendBtnDark}`}>
            Read another conversation
          </Link>
          <Link href="/signin" className={`${styles.friendBtn} ${styles.friendBtnGhost}`}>
            See how this changes over time
          </Link>
        </div>
      )}
      {!openingDone && (
        <button className={styles.friendSkip} onClick={showAll}>
          Show it all
        </button>
      )}
    </div>
  );
}

const DIR_META: Record<DeltaChange["direction"], { arrow: string; label: string }> = {
  weakened: { arrow: "↓", label: "Weakened" },
  improved: { arrow: "↑", label: "Improved" },
  held: { arrow: "→", label: "Held" },
};

/**
 * FLAG-46 directional "Since last time" — ported from directional-animated.html.
 * Sits HIGH on a continuation — right under the headline/subhead, above the read
 * body — so the returning user sees "what changed" first. Reveals when VISIBLE: each
 * dimension fades/rises in via an IntersectionObserver, which fires on mount for an
 * element already in view (near the top, it's in view on load) and on scroll
 * otherwise. At reveal its pill springs + arrow starts drifting (down=weakened,
 * up=improved; held = no drift) + spine draws + "now" emphasises. Reveal-once.
 * Direction only — never a score number (sub-scores are unstable, FLAG-49). No
 * app-driven scrolling — the user's scroll paces it, which removes the sync problem.
 */
function DeltaSection({ changes, revealAll }: { changes: DeltaChange[]; revealAll: boolean }) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // reveal-once per dimension; reduced-motion / "Show it all" → all revealed at once.
  const [revealed, setRevealed] = useState<boolean[]>(() => changes.map(() => reduce || revealAll));
  const dimRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (revealAll) {
      setRevealed(changes.map(() => true));
      return;
    }
    if (reduce) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.idx);
          setRevealed((r) => {
            if (r[idx]) return r;
            const next = [...r];
            next[idx] = true;
            return next;
          });
          io.unobserve(e.target); // reveal-once: stays revealed if they scroll back up
        }
      },
      { threshold: 0.4, rootMargin: "0px 0px -12% 0px" },
    );
    dimRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAll]);

  return (
    <div className={styles.friendTurn}>
      <div className={styles.deltaCard}>
        <div className={styles.friendTiny}>Since last time</div>
        {changes.map((c, i) => {
          const meta = DIR_META[c.direction];
          const spineCls =
            c.direction === "improved"
              ? styles.improvedSpine
              : c.direction === "held"
                ? styles.heldSpine
                : "";
          return (
            <div
              key={i}
              data-idx={i}
              ref={(el) => {
                dimRefs.current[i] = el;
              }}
              // .go gates every animation (pill, arrow drift, spine, legs) and is now
              // added when the dimension SCROLLS into view (IntersectionObserver),
              // reveal-once. The drift selector is `.dim.go .dir.<direction> .arrow` —
              // go on THIS div, direction on the pill, arrow on the inner span.
              className={`${styles.dim} ${revealed[i] ? styles.go : ""}`}
            >
              <div className={styles.dimHead}>
                <span className={styles.dimName}>{c.dimension}</span>
                <span className={`${styles.dir} ${styles[c.direction]}`}>
                  <span className={styles.arrow}>{meta.arrow}</span> {meta.label}
                </span>
              </div>
              <div className={styles.pair}>
                <div className={`${styles.spine} ${spineCls}`} />
                <div className={`${styles.leg} ${styles.before}`}>
                  <div className={styles.legLabel}>Before</div>
                  <div className={styles.legText}>{c.before}</div>
                </div>
                <div className={styles.arrowDown}>↓</div>
                <div className={`${styles.leg} ${styles.now}`}>
                  <div className={styles.legLabel}>Now</div>
                  <div className={styles.legText}>{c.now}</div>
                </div>
              </div>
            </div>
          );
        })}
        <p className={styles.deltaNote}>
          Direction shows which way the behaviour moved &mdash; not a precise score. Read from the
          new messages you added.
        </p>
      </div>
    </div>
  );
}

/** A short relative-time label for a saved read, e.g. "3 days ago", "2 weeks ago". */
function relativeWhen(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  const m = Math.floor(days / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

/** The read's one-line takeaway — the first sentence of its grounding note (faithful
 *  to the saved report; never fabricated). Falls back to the lead card / status tag. */
function takeawayOf(read: Read): string {
  const s = (read.where_this_leaves_you || "").trim();
  if (s) {
    const m = s.match(/^(.*?[.!?])(\s|$)/);
    return m ? m[1] : s;
  }
  return (read.cards[0]?.body || "").trim() || read.status_tag || "";
}

/**
 * Build the movement-over-time timeline: the current read + prior saved reads, the
 * 3 MOST RECENT only (aligns with the 3-most-recent storage window), oldest→newest.
 * Replay — pulled from the saved reports, never regenerated. "· first read" marks the
 * oldest shown ONLY when it's genuinely the person's first (≤3 reads total).
 */
function buildMovement(current: Read, priors: ClientReport[]): MovementNode[] {
  const all = [
    { read: current, created_at: new Date().toISOString(), isNow: true },
    ...priors.map((p) => ({ read: p.result, created_at: p.created_at, isNow: false })),
  ];
  const total = all.length;
  const display = all.slice(0, 3).reverse(); // 3 most recent, oldest → newest
  return display.map((n, i) => ({
    headline: n.read.headline,
    take: takeawayOf(n.read),
    when: n.isNow
      ? "Now · this read"
      : relativeWhen(n.created_at) + (i === 0 && total <= 3 ? " · first read" : ""),
    isNow: n.isNow,
  }));
}

/**
 * Movement over time — ported from movement-3.html. A flowing timeline of up to the
 * 3 most recent reads of a person (oldest top → newest bottom): the spine draws
 * through the nodes, a glow dot travels down, each read emerges in sequence, older
 * reads progressively muted, the newest ("now") read pops full-ink. Self-animating on
 * mount (scoped to .friendRoot for the --f-* theme vars). After the entrance, scroll
 * the "now" read into view ONCE — only if it's off-screen and the user hasn't scrolled.
 * `revealAll` / reduced-motion → instant, fully drawn, no animation, no auto-scroll.
 */
function MovementSection({
  nodes,
  nickname,
  revealAll,
  autoScroll,
}: {
  nodes: MovementNode[];
  nickname: string;
  revealAll: boolean;
  /** Live read → scroll the "now" read into view after the entrance; recall → false. */
  autoScroll: boolean;
}) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const instant = reduce || revealAll;
  const nowRef = useRef<HTMLDivElement | null>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    if (instant || !autoScroll) return; // no auto-scroll on recall / reduced-motion / show-all
    const onUser = () => {
      userScrolled.current = true;
    };
    window.addEventListener("wheel", onUser, { passive: true });
    window.addEventListener("touchmove", onUser, { passive: true });
    window.addEventListener("keydown", onUser);
    // After the entrance completes, bring the "now" read into view — ONCE, and only
    // if it's off-screen and the user hasn't taken over scrolling.
    const t = window.setTimeout(() => {
      const el = nowRef.current;
      if (userScrolled.current || !el) return;
      const r = el.getBoundingClientRect();
      const visible = r.top >= 0 && r.bottom <= window.innerHeight;
      if (!visible) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 3600);
    return () => {
      clearTimeout(t);
      window.removeEventListener("wheel", onUser);
      window.removeEventListener("touchmove", onUser);
      window.removeEventListener("keydown", onUser);
    };
  }, [instant, autoScroll]);

  const n = nodes.length;
  // Newest is always r3 (full ink, accent node, pop); oldest is r1 (faintest); a
  // middle node (only when 3) is r2. Matches the design's progressive muting.
  const slot = (i: number) => (i === n - 1 ? styles.mvR3 : i === 0 ? styles.mvR1 : styles.mvR2);

  return (
    <div className={`${styles.mvRoot} ${instant ? styles.mvInstant : ""}`}>
      <div className={styles.mvDeck}>
        Across your last {n} reads of {nickname}
      </div>
      <div className={styles.mvFlowwrap}>
        <div className={styles.mvFlowline} />
        <div className={styles.mvFlowdot} />
        {nodes.map((nd, i) => (
          <div
            key={i}
            className={`${styles.mvRead} ${slot(i)}`}
            ref={nd.isNow ? nowRef : undefined}
          >
            <span className={styles.mvNode} />
            <div className={styles.mvWhen}>{nd.when}</div>
            <div className={styles.mvCard}>
              <div className={styles.mvHeadline}>{nd.headline}</div>
              <div className={styles.mvTake}>{nd.take}</div>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.mvFooter}>
        Your last {n} conversations with {nickname}, in order &mdash; separate chats, so read how
        they sit together for yourself.
      </p>
    </div>
  );
}

/**
 * Reveal-on-scroll wrapper for everything below the opening (FLAG: typing is the
 * opening flourish only). The child fades/rises in when it enters the viewport via
 * an IntersectionObserver (reveal-once). `revealAll` ("Show it all" / reduced-motion)
 * shows it immediately without needing a scroll. No typing — just the reveal.
 */
function RevealTurn({ children, revealAll }: { children: ReactNode; revealAll: boolean }) {
  const [revealed, setRevealed] = useState(revealAll);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (revealAll) {
      setRevealed(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setRevealed(true);
          io.unobserve(e.target); // reveal-once
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealAll]);

  return (
    <div ref={ref} className={`${styles.revealTurn} ${revealed ? styles.revealShown : ""}`}>
      {children}
    </div>
  );
}

function FriendTurn({ item }: { item: FriendItem }) {
  if (item.t === "type") {
    const cls =
      item.cls === "small"
        ? styles.friendSmall
        : `${styles.friendSay} ${item.cls === "accent" ? styles.friendAccent : styles.friendBig}`;
    return (
      <div className={styles.friendTurn}>
        <p className={cls}>{item.text}</p>
      </div>
    );
  }
  if (item.t === "pop") {
    const cls =
      item.cls === "small"
        ? styles.friendSmall
        : `${styles.friendSay} ${styles.friendSoft}`;
    return (
      <div className={styles.friendTurn}>
        <p className={`${cls} ${styles.friendPop}`}>{renderQuotes(item.text)}</p>
      </div>
    );
  }
  if (item.t === "bar") {
    const color = friendToneColor(item.bar.tone);
    return (
      <div className={styles.friendTurn}>
        <div className={styles.friendAside}>
          <div className={styles.friendAsideHead}>
            <span className={styles.friendAsideName}>{item.bar.label}</span>
            <span className={styles.friendAsideVerdict} style={{ color }}>
              {item.bar.tag}
            </span>
          </div>
          <div className={styles.friendTrack}>
            <div className={styles.friendFill} style={{ width: `${item.bar.level}%`, background: color }} />
          </div>
          <p>{renderQuotes(item.bar.caption)}</p>
        </div>
      </div>
    );
  }
  if (item.t === "card") {
    return (
      <div className={styles.friendTurn}>
        <div className={styles.friendAside}>
          <div className={styles.friendTiny}>{item.card.kind}</div>
          <h3 className={styles.friendCardTitle}>{stripQuotes(item.card.title)}</h3>
          <p>{renderQuotes(item.card.body)}</p>
        </div>
      </div>
    );
  }
  if (item.t === "nothingNew") {
    // FLAG-46 Bug 2: identical re-send → no before/after, just say so and nudge
    // toward a fresh take. (The "Read another conversation" action sits below.)
    return (
      <div className={styles.friendTurn}>
        <div className={styles.friendAside}>
          <div className={styles.friendTiny}>Since last time</div>
          <p>
            This is the same conversation you showed me last time — nothing new since
            then, so the read hasn&rsquo;t changed. When something new happens, bring
            me the updated chat and I&rsquo;ll tell you what moved.
          </p>
        </div>
      </div>
    );
  }
  // move
  return (
    <div className={styles.friendTurn}>
      <div className={styles.friendMove}>
        <div className={styles.friendTiny}>If you want a move</div>
        <p>{item.text}</p>
      </div>
    </div>
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

/**
 * FLAG-48: the reply screen — a full takeover rendered over the preserved read.
 * Driven by the `reply` screen state (go("reply") / back()), so the read stays
 * mounted underneath and is restored exactly on back. Hosts the real ReplyHelper.
 */
function ReplyScreen({
  name,
  conversation,
  safety,
  onBack,
}: {
  name: string;
  conversation: string;
  safety?: boolean;
  onBack: () => void;
}) {
  return (
    <div className={styles.replyScreen}>
      <div className={styles.replyBar}>
        <button className={styles.back} aria-label="Back to your read" onClick={onBack}>
          &#8249;
        </button>
        <div className={styles.replyBarTitle}>Help me reply</div>
      </div>
      <div className={styles.replyBody}>
        <p className={styles.subtext} style={{ marginTop: 0, marginBottom: 4 }}>
          {safety
            ? "You don’t owe them a reply. If you want to respond, I’ll help you say it clearly and firmly."
            : `Drafting a reply to ${name}. Tell me what you want to land.`}
        </p>
        <ReplyHelper name={name} conversation={conversation} safety={safety} />
        {/* Second back at the END, after the drafts, so a scrolled-down user can
            leave without scrolling up. Same behaviour as the top back. */}
        <button
          className={styles.secondary}
          style={{ marginTop: 20 }}
          onClick={onBack}
        >
          &#8249; Back to your read
        </button>
      </div>
    </div>
  );
}

/* ---------- FLAG-54: evidence as proof (receipts + where-it-stands) ---------- */

/** Render «verbatim» markers as styled inline quotes; everything else is plain text.
 *  The marks are only present on quotes that passed verbatim validation (analyze). */
function renderQuotes(text: string): ReactNode {
  return text.split(/(«[^«»]*»)/g).map((part, i) => {
    const m = part.match(/^«([^«»]*)»$/);
    return m ? (
      <span key={i} className={styles.evQ}>
        {m[1]}
      </span>
    ) : (
      part
    );
  });
}

/** Drop the «» marks, keeping the inner text — for TYPED lines (the typewriter
 *  shouldn't type guillemets) where styled spans can't be used. */
function stripQuotes(text: string): string {
  return text.replace(/«([^«»]*)»/g, "$1");
}

/** Does the read show concerning/boundary-pushing behaviour? Drives the reply-line
 *  copy ("no pressure to be nice…") — kept from being preachy by only firing here. */
function isFlagged(read: Read): boolean {
  return (
    read.safety.flag ||
    (read.receipts ?? []).some((r) => r.tone === "flag") ||
    read.bars.some((b) => b.tone === "low")
  );
}

type Bubble = { speaker: "you" | "them"; text: string };

/** The real conversation's last `n` messages, verbatim — parsed from the stored
 *  "Speaker: text" lines (no model). Verbatim by construction. */
function lastMessages(conversation: string, n: number): Bubble[] {
  const msgs: Bubble[] = [];
  for (const line of conversation.split("\n")) {
    const m = line.match(/^\s*([^:\n]{1,40}):\s+(.*)$/);
    if (!m || !m[2].trim()) continue;
    msgs.push({ speaker: /^you$/i.test(m[1].trim()) ? "you" : "them", text: m[2].trim() });
  }
  return msgs.slice(-n);
}

/** Chat bubbles in the app's BRAND colours (you = accent/right, them = muted/left) —
 *  a who-label per speaker-run, the last bubble optionally tagged. Shared by the
 *  receipts and the "where it stands" sections. */
function ChatThread({
  messages,
  nickname,
  lastTag,
}: {
  messages: Bubble[];
  nickname: string;
  lastTag?: string;
}) {
  const out: ReactNode[] = [];
  let prev: string | null = null;
  messages.forEach((m, i) => {
    if (m.speaker !== prev) {
      out.push(
        <span
          key={`w${i}`}
          className={`${styles.evWho} ${m.speaker === "you" ? styles.evYouWho : styles.evThemWho}`}
        >
          {m.speaker === "you" ? "You" : nickname}
        </span>,
      );
      prev = m.speaker;
    }
    const isLast = i === messages.length - 1;
    out.push(
      <div
        key={`m${i}`}
        className={`${styles.evMsg} ${m.speaker === "you" ? styles.evYou : styles.evThem} ${
          isLast && lastTag ? styles.evLast : ""
        }`}
      >
        {m.text}
      </div>,
    );
    if (isLast && lastTag) out.push(<span key="lt" className={styles.evLastTag}>{lastTag}</span>);
  });
  return <div className={styles.evChat}>{out}</div>;
}

/** "Key moments · the receipts" — the 2-3 telling exchanges as verbatim bubbles.
 *  Every message here was validated verbatim against the real conversation at
 *  generation (analyze → verbatimize); nothing here is invented or paraphrased. */
function ReceiptsSection({ moments, nickname }: { moments: ReadMoment[]; nickname: string }) {
  return (
    <div className={styles.rcCard}>
      <div className={styles.rcHead}>
        <div className={styles.rcEyebrow}>Key moments · the receipts</div>
        <p className={styles.rcNote}>
          The exchanges I&rsquo;m reading this from &mdash; {nickname}&rsquo;s words and yours,
          exactly as they were. You can check them yourself.
        </p>
      </div>
      {moments.map((mo, i) => (
        <div key={i} className={styles.rcMoment}>
          <span className={`${styles.rcTag} ${mo.tone === "neutral" ? styles.rcTagNeutral : ""}`}>
            {mo.tag}
          </span>
          <ChatThread messages={mo.messages} nickname={nickname} />
          {mo.reads_as && <p className={styles.rcReadsAs}>{renderQuotes(mo.reads_as)}</p>}
        </div>
      ))}
      <p className={styles.rcVerify}>
        Every read above points back to real messages &mdash; nothing&rsquo;s invented. What they
        add up to is yours to decide.
      </p>
    </div>
  );
}

/** "Where it stands now" — the real last few messages + the Help-me-reply entry.
 *  Verbatim by construction (parsed from the conversation). `onReply` wires to the
 *  EXISTING reply flow; when null (recall), the chat shows without its own button. */
function WhereItStands({
  conversation,
  nickname,
  flagged,
  safety,
  onReply,
}: {
  conversation: string;
  nickname: string;
  flagged: boolean;
  /** FLAG-59: safety-flagged read → reply stays offered but as the QUIETER, secondary
   *  option with an honest framing line; the drafts bias firm (ReplyHelper safety). */
  safety?: boolean;
  onReply: (() => void) | null;
}) {
  const last = lastMessages(conversation, 3);
  if (last.length === 0) return null;
  const lastFromYou = last[last.length - 1].speaker === "you";
  const tag = lastFromYou ? "↑ your last message" : `↑ ${nickname}'s last message`;
  return (
    <div className={styles.wsCard}>
      <div className={styles.rcHead}>
        <div className={styles.rcEyebrow}>Where it stands now</div>
        <p className={styles.rcNote}>The last of the conversation &mdash; what you&rsquo;d be replying to.</p>
      </div>
      <ChatThread messages={last} nickname={nickname} lastTag={tag} />
      {onReply && (
        <div className={styles.wsCta}>
          <p className={styles.wsReplyLine}>
            {safety ? (
              <>You don&rsquo;t owe them a reply &mdash; if you want to respond, I&rsquo;ll help you say it clearly.</>
            ) : (
              <>
                Want help responding to that? I&rsquo;ll draft a few ways to reply &mdash; clear, in your
                voice{flagged ? ", no pressure to be nice if you don't want to be" : ""}.
              </>
            )}
          </p>
          <button
            className={`${styles.wsReplyBtn} ${safety ? styles.wsReplyBtnQuiet : ""}`}
            onClick={onReply}
          >
            <span className={styles.wsIc}>✎</span> Help me reply
          </button>
        </div>
      )}
    </div>
  );
}

function ReplyHelper({
  name,
  conversation,
  safety,
}: {
  name: string;
  conversation: string;
  /** FLAG-59: flagged read → bias the drafts firm / boundary-holding. */
  safety?: boolean;
}) {
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
        body: JSON.stringify({ conversation: windowForApi(conversation).text, intent, nickname: name, safety: safety === true }), // FLAG-43/59
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

  // One reply path: this is the real draft UI, opened directly by the "Help me
  // reply" button (live read) or shown inline on a recent past report. No
  // intermediate "Want me to draft…" prompt.
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
      {drafts.length > 0 && (
        // Equal-height cards: grid-auto-rows:1fr sizes every card to the TALLEST,
        // so shorter suggestions get the same height (extra space), not ragged.
        <div className={styles.draftGrid}>
          {drafts.map((d, i) => (
            <DraftCard key={i} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: ReplyDraft }) {
  const [text, setText] = useState(draft.text);
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.draftCard}>
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
      {/* flex:1 → the textarea fills the equal-height card, so a short draft just
          gets a taller field rather than a short card. */}
      <textarea
        className={styles.textarea}
        style={{ flex: 1, minHeight: 72 }}
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
      <p className={styles.barcap}>{renderQuotes(bar.caption)}</p>
    </div>
  );
}
