/**
 * Per-path model selection (FLAG-24).
 *
 * Each Claude call site picks its model by purpose, not from one global. The
 * nuance paths (read / reply / pattern / clarify) need a strong, low-sycophancy
 * model — that judgment IS the product (CLAUDE.md §2.2). Extraction is mechanical
 * OCR/transcription and can run on a faster, cheaper model.
 *
 * Config, not a framework. Backward-compatible: the existing `MODEL` env var
 * still sets the strong default, so current behaviour is unchanged. New knobs:
 * `MODEL_FAST`, and per-path `MODEL_<PATH>` overrides (highest priority) so every
 * path stays swappable as the frontier shifts.
 */
import type Anthropic from "@anthropic-ai/sdk";

export type ModelPath = "extract" | "analyze" | "reply" | "pattern" | "clarify" | "history" | "delta";

/**
 * FLAG-40: a system prompt marked for prompt caching. The stable prefix is cached
 * (5-min TTL); after the first call it bills at 0.1× input instead of 1×. Below
 * the ~1024-token cache minimum the marker is silently ignored, so marking a
 * short prompt is harmless — it just starts caching if the prompt ever grows.
 * Today only analyze's ~1,275-token system actually caches; the rest are marked
 * for consistency + future-proofing.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

const STRONG = process.env.MODEL || "claude-sonnet-4-6";
const FAST = process.env.MODEL_FAST || "claude-haiku-4-5";

const PATH_MODEL: Record<ModelPath, string> = {
  analyze: STRONG, // the read — §2.2 nuance
  reply: STRONG, // §2.6
  pattern: STRONG, // §2.5 cross-report synthesis
  clarify: STRONG, // §2.11 verdict-forking judgment
  history: STRONG, // FLAG-34 single-read pre-read question — nuance/voice
  delta: STRONG, // FLAG-46 what-changed delta — nuance/voice
  // extract stays STRONG until the FLAG-24 accuracy gate (real dense screenshots)
  // proves a fast model keeps message/attribution/ordering parity. Flip to FAST
  // there, not before.
  extract: STRONG,
};

/** The model for a given call site (per-path env override wins). */
export function modelFor(path: ModelPath): string {
  return process.env[`MODEL_${path.toUpperCase()}`] || PATH_MODEL[path];
}
