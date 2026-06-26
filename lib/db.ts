import postgres from "postgres";
import type { Read } from "@/types";

/**
 * Postgres access for saved reads.
 *
 * We store ONLY the nickname, the email, and the read result JSON — never the
 * pasted conversation. Connection string comes from DATABASE_URL (server-side
 * only). Use a pooled connection string on serverless hosts.
 */

declare global {
  // eslint-disable-next-line no-var
  var __companionSql: ReturnType<typeof postgres> | undefined;
}

export class DbError extends Error {}

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbError("Missing DATABASE_URL");
  // Reuse one client across hot reloads / warm invocations.
  globalThis.__companionSql ??= postgres(url, { max: 1, prepare: false });
  return globalThis.__companionSql;
}

let schemaReady: Promise<unknown> | undefined;

/** Create tables on first use so there's no separate migration step. */
function ensureSchema() {
  const sql = getSql();
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email      text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS reads (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nickname   text NOT NULL,
        email      text NOT NULL,
        result     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    // persons: a person the user is asking about. The nickname is a mutable
    // label, NOT the key; uniqueness is scoped per user (never global). Only
    // the nickname + an optional non-PII differentiator — no real names/notes.
    await sql`
      CREATE TABLE IF NOT EXISTS persons (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nickname            text NOT NULL,
        normalized_nickname text NOT NULL,
        differentiator      text,
        created_at          timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, normalized_nickname)
      )
    `;
    // reports: a read about a person. Result JSON only — never the conversation.
    await sql`
      CREATE TABLE IF NOT EXISTS reports (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id  uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        result     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    // login_codes: short-lived one-time sign-in codes (hashed), one per email,
    // with an attempt counter so a 6-digit code can't be brute-forced.
    await sql`
      CREATE TABLE IF NOT EXISTS login_codes (
        email      text PRIMARY KEY,
        code_hash  text NOT NULL,
        expires_at timestamptz NOT NULL,
        attempts   int NOT NULL DEFAULT 0
      )
    `;
  })();
  return schemaReady;
}

/** Store (or replace) the pending one-time code for an email. */
export async function setLoginCode(
  email: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql`
    INSERT INTO login_codes (email, code_hash, expires_at, attempts)
    VALUES (${email}, ${codeHash}, ${expiresAt}, 0)
    ON CONFLICT (email)
      DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0
  `;
}

/**
 * Verify a one-time code: must match, be unexpired, and under the attempt cap.
 * Consumes the code on success; counts the attempt on failure.
 */
export async function verifyLoginCode(email: string, codeHash: string): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql<{ code_hash: string; expires_at: Date; attempts: number }[]>`
    SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ${email}
  `;
  const row = rows[0];
  if (!row || row.attempts >= 5 || row.expires_at.getTime() < Date.now()) return false;
  if (row.code_hash === codeHash) {
    await sql`DELETE FROM login_codes WHERE email = ${email}`;
    return true;
  }
  await sql`UPDATE login_codes SET attempts = attempts + 1 WHERE email = ${email}`;
  return false;
}

/** Normalize a nickname for per-user uniqueness: trim, collapse spaces, lower. */
export function normalizeNickname(nickname: string): string {
  return nickname.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface Person {
  id: string;
  nickname: string;
  differentiator: string | null;
  created_at: string;
}

/** Roster of the user's saved persons, newest first (CLAUDE.md §2.7). */
export async function listPersons(userId: string): Promise<Person[]> {
  const sql = getSql();
  await ensureSchema();
  return sql<Person[]>`
    SELECT id, nickname, differentiator, created_at
    FROM persons
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

/**
 * Find or create a person for this user by normalized nickname. Uniqueness is
 * scoped to (user_id, normalized_nickname). Returns the person id.
 */
export async function getOrCreatePerson(params: {
  userId: string;
  nickname: string;
  differentiator?: string | null;
}): Promise<string> {
  const sql = getSql();
  await ensureSchema();
  const normalized = normalizeNickname(params.nickname);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO persons (user_id, nickname, normalized_nickname, differentiator)
    VALUES (${params.userId}, ${params.nickname.trim()}, ${normalized}, ${params.differentiator ?? null})
    ON CONFLICT (user_id, normalized_nickname)
      DO UPDATE SET nickname = EXCLUDED.nickname
    RETURNING id
  `;
  return rows[0].id;
}

/** True if this person exists and belongs to this user. */
export async function personOwnedBy(userId: string, personId: string): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT 1 FROM persons WHERE id = ${personId} AND user_id = ${userId} LIMIT 1
  `;
  return rows.length > 0;
}

/** Save a read as a report under a person. Result only — never the conversation. */
export async function createReport(params: {
  personId: string;
  result: Read;
}): Promise<string> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO reports (person_id, result)
    VALUES (${params.personId}, ${sql.json(params.result as never)})
    RETURNING id
  `;
  return rows[0].id;
}

export interface StoredReport {
  id: string;
  result: Read;
  created_at: Date;
}

/** A person's reports, newest first — ownership-checked (CLAUDE.md §2.5). */
export async function listReports(
  userId: string,
  personId: string,
): Promise<StoredReport[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql<{ id: string; result: unknown; created_at: Date }[]>`
    SELECT r.id, r.result, r.created_at
    FROM reports r
    JOIN persons p ON p.id = r.person_id
    WHERE r.person_id = ${personId} AND p.user_id = ${userId}
    ORDER BY r.created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    // Tolerate older rows that were stored as a JSON string.
    result: (typeof r.result === "string" ? JSON.parse(r.result) : r.result) as Read,
  }));
}

/**
 * Find or create a user by email and return their UUID id. Email is a unique
 * attribute, never the key (see CLAUDE.md §2.1).
 */
export async function upsertUser(email: string): Promise<string> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO users (email) VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `;
  return rows[0].id;
}

/** Persist a read. Stores nickname + email + result only — no conversation. */
export async function saveRead(params: {
  nickname: string;
  email: string;
  result: Read;
}): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql`
    INSERT INTO reads (nickname, email, result)
    VALUES (${params.nickname}, ${params.email}, ${sql.json(params.result as never)})
  `;
}

/** Delete-my-data: remove every saved read for an email. Returns rows removed. */
export async function deleteReadsByEmail(email: string): Promise<number> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`DELETE FROM reads WHERE email = ${email} RETURNING id`;
  return rows.length;
}
