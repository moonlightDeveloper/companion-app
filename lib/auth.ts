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
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

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

/** Value stored in the session cookie — carries the userId. */
export function createSessionValue(userId: string): string {
  return sign({ t: "session", uid: userId, exp: Date.now() + SESSION_TTL_MS });
}

/** Current signed-in userId from the session cookie, or null. */
export async function getUserId(): Promise<string | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const p = unsign(raw);
  if (!p || p.t !== "session" || typeof p.uid !== "string") return null;
  if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return p.uid;
}
