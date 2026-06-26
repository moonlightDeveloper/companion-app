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
import type { Intake, Read, TranscriptMessage } from "@/types";
import { saveConversation, evictExpired } from "@/lib/localConversations";
import styles from "./story.module.css";

type Screen =
  | "cover"
  | "pick"
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

type RosterPerson = { id: string; nickname: string; differentiator: string | null };

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
        body: JSON.stringify({ ...answers, email, consent, personId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }
      const { emailed: sent, personId: savedPersonId, reportId, ...rest } = data as Read & {
        emailed?: boolean;
        personId?: string;
        reportId?: string;
      };
      setEmailed(sent !== false);
      setRead(rest as Read);
      setStatus("done");
      // Create order: the read is saved server-side first; only then does the
      // raw conversation land on-device, tagged with the returned ids.
      if (savedPersonId && reportId) {
        saveConversation({
          personId: savedPersonId,
          reportId,
          text: answers.conversation,
        }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, [answers, email, consent, personId]);

  // Kick off the live read when we land on the read screen.
  useEffect(() => {
    if (screen === "read" && status === "idle") {
      runAnalyze();
    }
  }, [screen, status, runAnalyze]);

  // Lazy eviction of expired on-device conversations on app-open (§2.1).
  useEffect(() => {
    evictExpired();
  }, []);

  // Load the signed-in user's roster (empty if not signed in) for pick-or-create.
  useEffect(() => {
    fetch("/api/persons")
      .then((r) => r.json())
      .then((d) => setRoster(Array.isArray(d?.persons) ? d.persons : []))
      .catch(() => {});
  }, []);

  const idx = FLOW.indexOf(screen);
  const progress =
    screen === "cover" || screen === "pick"
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
          {screen === "cover" && (
            <Cover onStart={() => go(roster.length ? "pick" : "name")} />
          )}

          {screen === "pick" && (
            <PickScreen
              roster={roster}
              onPick={(p) => {
                setPersonId(p.id);
                setAnswers((a) => ({ ...a, name: p.nickname }));
                go("origin");
              }}
              onNew={() => {
                setPersonId(undefined);
                go("name");
              }}
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

type Mode = "choose" | "text" | "shots";

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
  const [mode, setMode] = useState<Mode>(value.trim() ? "text" : "choose");

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
        <PasteText name={name} value={value} onContinue={onContinue} />
      )}

      {mode === "shots" && (
        <PasteShots
          name={name}
          onBack={() => setMode("choose")}
          onConfirm={onContinue}
        />
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
type ShotStage = "pick" | "extracting" | "review";

const MAX_IMAGES = 6;

function PasteShots({
  name,
  onBack,
  onConfirm,
}: {
  name: string;
  onBack: () => void;
  onConfirm: (text: string) => void;
}) {
  const [images, setImages] = useState<ShotImage[]>([]);
  const [stage, setStage] = useState<ShotStage>("pick");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
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
    const converted = (await Promise.all(picked.map(downscaleToBase64))).filter(
      (x): x is ShotImage => x !== null,
    );
    if (converted.length < picked.length) {
      setError("Some files were skipped — images only.");
    }
    setImages((prev) => [...prev, ...converted]);
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

  const extract = useCallback(async () => {
    setStage("extracting");
    setError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: name,
          images: images.map((i) => ({ media_type: i.media_type, data: i.data })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't read those.");
      setMessages(data.messages as TranscriptMessage[]);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read those.");
      setStage("pick");
    }
  }, [images, name]);

  if (stage === "extracting") {
    return (
      <>
        <div className={styles.stepHead}>
          <TypingDots />
        </div>
        <p className={styles.subtext}>
          Reading your screenshots and stitching them in order&hellip;
        </p>
      </>
    );
  }

  if (stage === "review") {
    return (
      <TranscriptReview
        name={name}
        messages={messages}
        setMessages={setMessages}
        onRedo={() => setStage("pick")}
        onConfirm={() => onConfirm(messages.map((m) => `${m.speaker}: ${m.text}`).join("\n"))}
      />
    );
  }

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
        <p className={styles.subtext} style={{ color: "var(--red)" }}>{error}</p>
      )}

      <div className={styles.footerActions}>
        <button
          className={styles.primary}
          disabled={images.length === 0}
          onClick={extract}
        >
          Extract conversation
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
