import { cookies } from "next/headers";
import crypto from "crypto";

/**
 * Passwordless auth: HMAC-signed, stateless tokens (no token table).
 *
 * - A magic-link token carries the email and a short expiry; it's emailed and
 *   redeemed once at /api/auth/verify.
 * - A session token carries the userId and a longer expiry; it lives in a
 *   signed, httpOnly cookie.
 *
 * Both are signed with SESSION_SECRET (server-side only). No PII or secrets are
 * exposed to the browser beyond the opaque signed cookie.
 */

export const SESSION_COOKIE = "companion_session";
export const SOFT_COOKIE = "companion_soft";
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SOFT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year (persistent device identity)
export const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
export const SOFT_MAX_AGE = Math.floor(SOFT_TTL_MS / 1000);

export class AuthError extends Error {}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new AuthError("Missing SESSION_SECRET");
  return s;
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function unsign(token: string): Record<string, unknown> | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

/** Token emailed in the magic link — carries the email, short-lived. */
export function createMagicToken(email: string): string {
  return sign({ t: "magic", email, exp: Date.now() + MAGIC_TTL_MS });
}

/** Returns the email if the magic token is valid and unexpired, else null. */
export function verifyMagicToken(token: string): string | null {
  const p = unsign(token);
  if (!p || p.t !== "magic" || typeof p.email !== "string") return null;
  if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return p.email;
}

/** Value stored in the session cookie — carries the userId and email. */
export function createSessionValue(userId: string, email: string): string {
  return sign({ t: "session", uid: userId, email, exp: Date.now() + SESSION_TTL_MS });
}

export interface Session {
  userId: string;
  email: string;
}

/** Current signed-in session from the cookie, or null. */
export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const p = unsign(raw);
  if (!p || p.t !== "session" || typeof p.uid !== "string") return null;
  if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return { userId: p.uid, email: typeof p.email === "string" ? p.email : "" };
}

/** Current signed-in userId, or null. */
export async function getUserId(): Promise<string | null> {
  return (await getSession())?.userId ?? null;
}

/**
 * Soft-identity token (FLAG-22): a persistent, httpOnly cookie carrying the
 * soft-user id. It identifies WHICH soft-user this device belongs to — it is
 * NEVER sufficient alone to unlock the roster; the user must also submit a
 * matching email (see /api/auth/recognize).
 */
export function createSoftValue(userId: string): string {
  return sign({ t: "soft", uid: userId, exp: Date.now() + SOFT_TTL_MS });
}

/** The soft-user id from the soft cookie, or null. (Candidate only — not auth.) */
export async function getSoftUserId(): Promise<string | null> {
  const raw = (await cookies()).get(SOFT_COOKIE)?.value;
  if (!raw) return null;
  const p = unsign(raw);
  if (!p || p.t !== "soft" || typeof p.uid !== "string") return null;
  if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return p.uid;
}

/** Deterministic hash of a one-time code, scoped to the email. */
export function hashCode(email: string, code: string): string {
  return crypto.createHmac("sha256", secret()).update(`${email}:${code}`).digest("base64url");
}
