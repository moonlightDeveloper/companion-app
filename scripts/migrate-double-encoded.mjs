// One-time migration: normalize double-encoded read JSON.
//
// Earlier rows in `reads` and `reports` were written with their JSON
// double-encoded — stored as a jsonb *string* (a JSON scalar) instead of a
// jsonb *object*. This converts each such row to a proper object.
//
// Safe to re-run: it only touches rows where jsonb_typeof(result) = 'string',
// and it validates each value parses to an object before writing.
//
// Usage:  DATABASE_URL=postgres://... node scripts/migrate-double-encoded.mjs

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
const TABLES = ["reads", "reports"];

async function counts(table) {
  const rows = await sql`
    SELECT jsonb_typeof(result) AS t, count(*)::int AS n
    FROM ${sql(table)} GROUP BY 1 ORDER BY 1
  `;
  return Object.fromEntries(rows.map((r) => [r.t ?? "null", r.n]));
}

async function migrateTable(table) {
  const before = await counts(table);
  let changed = 0;
  let skipped = 0;

  await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, result FROM ${tx(table)} WHERE jsonb_typeof(result) = 'string'
    `;
    for (const row of rows) {
      let parsed;
      try {
        parsed = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
      } catch {
        skipped++;
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        skipped++; // a genuine string read — never corrupt it
        continue;
      }
      await tx`UPDATE ${tx(table)} SET result = ${tx.json(parsed)} WHERE id = ${row.id}`;
      changed++;
    }
  });

  const after = await counts(table);
  return { table, before, after, changed, skipped };
}

const results = [];
for (const t of TABLES) results.push(await migrateTable(t));
await sql.end();

console.log("\n=== double-encoding migration ===");
for (const r of results) {
  console.log(
    `${r.table}: before=${JSON.stringify(r.before)} -> after=${JSON.stringify(r.after)} (changed ${r.changed}, skipped ${r.skipped})`,
  );
}
const remaining = results.reduce((n, r) => n + (r.after.string ?? 0), 0);
console.log(remaining === 0 ? "✓ 0 string-typed rows remain" : `⚠️ ${remaining} string rows remain`);
process.exit(remaining === 0 ? 0 : 1);
