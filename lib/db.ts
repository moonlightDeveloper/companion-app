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

/** Create the reads table on first use so there's no separate migration step. */
function ensureSchema() {
  const sql = getSql();
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS reads (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nickname   text NOT NULL,
      email      text NOT NULL,
      result     jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  return schemaReady;
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
    VALUES (${params.nickname}, ${params.email}, ${JSON.stringify(params.result)}::jsonb)
  `;
}

/** Delete-my-data: remove every saved read for an email. Returns rows removed. */
export async function deleteReadsByEmail(email: string): Promise<number> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`DELETE FROM reads WHERE email = ${email} RETURNING id`;
  return rows.length;
}
