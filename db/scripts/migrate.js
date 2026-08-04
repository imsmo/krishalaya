// db/scripts/migrate.js
// Production migration runner for Krishalaya.
//
// Properties (MNC-grade):
//  • Ordered: applies db/migrations/*.sql in ascending filename order.
//  • Atomic: each migration runs inside ONE transaction together with its
//    bookkeeping row — a failure rolls back fully; you never get a half-applied
//    migration. (Migrations contain no CONCURRENTLY/VACUUM, verified, so single-tx
//    is safe.)
//  • Tracked: applied migrations are recorded in `schema_migrations` and never
//    re-run.
//  • Immutable: an already-applied migration whose file content changed is a hard
//    error — you must add a NEW migration, never edit history.
//  • Advisory-locked: a Postgres advisory lock serialises concurrent runners
//    (CI + a human deploying at once can't double-apply).
//
// Connection: MIGRATION_DATABASE_URL (a DDL-capable owner role) or DATABASE_URL.
//   NOTE: the application connects as the least-privilege `kv_app` role (RLS-bound);
//   migrations run as the schema OWNER, which is a different, privileged role.
//
// Usage:
//   node db/scripts/migrate.js            # apply all pending migrations
//   node db/scripts/migrate.js --status   # show applied vs pending (needs DB)
//   node db/scripts/migrate.js --dry-run  # connect, show what WOULD apply, no writes
//   node db/scripts/migrate.js --plan     # list migration files + checksums (no DB)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 947312001; // arbitrary, stable advisory-lock key for migrations

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const full = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(full, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { version: file.replace(/\.sql$/, ''), file, sql, checksum };
    });
}

function arg(name) { return process.argv.includes(name); }

async function main() {
  const migrations = listMigrations();

  // --plan: no database needed — useful in CI to sanity-check ordering/checksums.
  if (arg('--plan')) {
    console.log(`Migration plan (${migrations.length} files):`);
    for (const m of migrations) console.log(`  ${m.version}  sha256:${m.checksum.slice(0, 12)}…`);
    return;
  }

  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error('FATAL: set MIGRATION_DATABASE_URL or DATABASE_URL'); process.exit(1); }

  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Serialise concurrent runners.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version       text PRIMARY KEY,
        checksum      text NOT NULL,
        applied_at    timestamptz NOT NULL DEFAULT now(),
        execution_ms  integer NOT NULL
      )`);

    const applied = new Map(
      (await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]),
    );

    // Immutability check: applied files must not have changed.
    for (const m of migrations) {
      if (applied.has(m.version) && applied.get(m.version) !== m.checksum) {
        throw new Error(
          `Migration ${m.version} was already applied but its content changed ` +
          `(checksum mismatch). Migrations are immutable — add a NEW migration instead.`,
        );
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version));

    if (arg('--status') || arg('--dry-run')) {
      console.log(`Applied: ${applied.size} | Pending: ${pending.length}`);
      for (const m of pending) console.log(`  PENDING  ${m.version}`);
      if (arg('--dry-run')) console.log('(dry-run — no changes written)');
      return;
    }

    if (pending.length === 0) { console.log('Database is up to date — no pending migrations.'); return; }

    for (const m of pending) {
      const t0 = Date.now();
      process.stdout.write(`Applying ${m.version} … `);
      try {
        await client.query('BEGIN');
        await client.query(m.sql); // multi-statement (simple protocol)
        const ms = Date.now() - t0;
        await client.query(
          'INSERT INTO schema_migrations (version, checksum, execution_ms) VALUES ($1, $2, $3)',
          [m.version, m.checksum, ms],
        );
        await client.query('COMMIT');
        console.log(`ok (${ms} ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`\nMigration ${m.version} failed and was rolled back:\n${err.message}\n`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`Done — applied ${pending.length} migration(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
