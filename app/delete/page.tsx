"use client";

import Link from "next/link";
import { useState } from "react";

type State = "idle" | "loading" | "done" | "error";

export default function DeleteData() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/delete-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
      setState("done");
      setMessage(
        data.removed > 0
          ? `Done — we deleted ${data.removed} saved read${data.removed === 1 ? "" : "s"} for that email.`
          : "There was nothing saved for that email.",
      );
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main
      style={{
        maxWidth: 460,
        margin: "0 auto",
        padding: "64px 20px",
        fontFamily: "var(--font-sans, sans-serif)",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Delete my data</h1>
      <p style={{ color: "#5a4a45", lineHeight: 1.6, marginBottom: 20 }}>
        Enter the email you used. We&rsquo;ll permanently delete the read(s) we
        saved for it. We never stored the conversation you pasted.
      </p>
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
          {state === "loading" ? "Deleting…" : "Delete my data"}
        </button>
      </form>
      {message && (
        <p
          style={{
            marginTop: 16,
            color: state === "error" ? "#c0392f" : "#3a2f2c",
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>
      )}
      <p style={{ marginTop: 28 }}>
        <Link href="/" style={{ color: "#9c4a3f" }}>
          &#8249; Back to home
        </Link>
      </p>
    </main>
  );
}
