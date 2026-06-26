"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

type State = "idle" | "loading" | "sent" | "error";

function SignInForm() {
  const params = useSearchParams();
  const linkError = params.get("error");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "sent") {
    return (
      <p style={{ color: "#3a2f2c", lineHeight: 1.6 }}>
        Check your inbox — we sent a sign-in link to <b>{email}</b>. It works once
        and expires in 15 minutes.
      </p>
    );
  }

  return (
    <>
      {linkError && (
        <p style={{ color: "#c0392f", lineHeight: 1.6, marginBottom: 12 }}>
          {linkError === "expired"
            ? "That sign-in link expired or was already used. Enter your email to get a new one."
            : "Something went wrong signing you in. Please try again."}
        </p>
      )}
      <form onSubmit={submit}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 15,
            borderRadius: 10,
            border: "1px solid #e0d2cc",
            marginBottom: 12,
          }}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 15,
            borderRadius: 10,
            border: "none",
            background: "#c0392f",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {state === "loading" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {state === "error" && (
        <p style={{ marginTop: 14, color: "#c0392f", lineHeight: 1.6 }}>{message}</p>
      )}
    </>
  );
}

export default function SignIn() {
  return (
    <main
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: "64px 20px",
        fontFamily: "var(--font-sans, sans-serif)",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Sign in</h1>
      <p style={{ color: "#5a4a45", lineHeight: 1.6, marginBottom: 20 }}>
        Enter your email and we&rsquo;ll send a one-tap link — no password. Your
        saved people then follow you on any device.
      </p>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
      <p style={{ marginTop: 28 }}>
        <Link href="/" style={{ color: "#9c4a3f" }}>
          &#8249; Back to home
        </Link>
      </p>
    </main>
  );
}
