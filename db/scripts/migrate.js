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
const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const LOCK_KEY = 947312001; // arbitrary, stable advisory-lock key for migrations

// [DEV-56 2026-08-12 FIX — Golden Law 5: fix forward, never edit an applied migration]
// `0057_upi_mandate_executions.sql` INSERTs a `lookup_values` row keyed by `type_code='ledger_txn_type'`.
// `lookup_values.type_code` is `NOT NULL REFERENCES lookup_types(code)` (0001_foundation.sql:260) and the
// `lookup_types` row for `ledger_txn_type` is created ONLY by `db/seeds/core/0005_lookup_vocabularies.sql` —
// which this runner's own doc comment says runs AFTER migrations (`db/prod/apply.sh` step [1/6] migrate, then
// step [4/6] seed). So a migrate-only run against a truly fresh DB (no seed step ever run first) dies at 0057
// with `23503 lookup_values_type_code_fkey` — and every migration after it (0058–0138, including 0118 which
// admin-api's auth depends on) never applies. Grep-verified this is the FIRST such dependency in file order;
// three later migrations lean on the SAME seed-created vocabulary rows (0088/0089 need `payout_purpose`, 0111
// needs `ledger_txn_type` again) — all downstream of 0057, so fixing the ordering once here, before 0057, is
// sufficient for all four; no migration before 0057 needs a seed-only lookup_types row.
// 0057 itself is already applied in real environments and is NEVER edited (checksum-locked, per this file's own
// immutability check above). The fix is ordering, not content: run the exact same idempotent seed file
// (`ON CONFLICT DO NOTHING` throughout — safe to run twice) one migration early. This mirrors the identical,
// already-proven fix `apps/api/test/integration-global-setup.js` carries as `[DEV-30 2026-07-28 FIX]` for the
// JEST INTEGRATION harness only — that fix was never ported to this production runner (or to `db/prod/apply.sh`,
// which calls this file), so real `migrate.js`/`apply.sh` runs against a fresh DB have carried this defect
// undetected since 0057 shipped (first documented DEV-04/05, re-confirmed DEV-30/DEV-54, fixed for real DEV-56).
// [DEV-56 2026-08-12] Second, independently-found instance of the SAME defect class, discovered by actually
// running the fresh chain end-to-end (0001→0138) rather than assuming the 0057 fix alone was sufficient:
// `0086_ops_alert_rules.sql` INSERTs `notification_templates` rows with `language_code` values ('en','hi','gu');
// `notification_templates.language_code` is `NOT NULL REFERENCES languages(code)` (0001_foundation.sql), and
// `languages` rows are created ONLY by `db/seeds/core/0001_languages.sql` — same seeds-run-after-migrations
// ordering gap as 0057, different reference table. Fixed the same way, for the same reason.
// [DEV-56 2026-08-12] Third instance of the same class: `0122_template_versions_and_variables.sql` INSERTs
// `notification_event_variables` rows for event codes ('auth.otp','order.delivered','bid.outbid','wage.paid',
// 'scheme.approved') that are only created by `db/seeds/core/0007_notification_events_templates.sql` — that
// seed touches only `notification_events`/`notification_templates`, both created by 0012_engagement.sql, so it
// is safe to run any time after 0012 (long before 0122); running it a second time via the normal seed step is
// the same proven-safe idempotent-double-seed as the two fixups above.
const PRE_APPLY_SEED_FIXUPS = {
  // Runs core/0005 (idempotent) immediately before 0057 applies, guaranteeing the `ledger_txn_type` /
  // `payout_purpose` lookup_types rows exist before any migration reads them. Harmless on an environment where
  // the seed already ran normally (ON CONFLICT DO NOTHING == no-op); the seed step at the end of `apply.sh`
  // re-runs the same file later with no ill effect (documented idempotent-double-seed, same as DEV-30's note).
  '0057_upi_mandate_executions': [path.join(SEEDS_DIR, 'core', '0005_lookup_vocabularies.sql')],
  // Runs core/0001 (idempotent) immediately before 0086 applies, guaranteeing 'en'/'hi'/'gu' exist in `languages`
  // before any migration's notification_templates INSERT reads them.
  '0086_ops_alert_rules': [path.join(SEEDS_DIR, 'core', '0001_languages.sql')],
  // Runs core/0007 (idempotent) immediately before 0122 applies, guaranteeing its referenced notification_events
  // rows exist before 0122's notification_event_variables INSERT reads them.
  '0122_template_versions_and_variables': [path.join(SEEDS_DIR, 'core', '0007_notification_events_templates.sql')],
  // Runs core/0010 (idempotent) immediately before 0123 applies: `provider_dependencies` INSERTs reference
  // integration_providers('razorpay') and ('razorpayx'), which (unlike 'agmarknet'/'msg91', fixed directly in
  // 0104/0123 themselves) are ONLY created by this seed — same class of defect, fourth instance.
  '0123_provider_truth_and_inbound_evidence': [path.join(SEEDS_DIR, 'core', '0010_integration_providers.sql')],
  // Runs core/0004 (idempotent) immediately before 0125 applies: `payout_purpose_roles.role_code REFERENCES
  // roles(code)`, and every `roles` row (including `super_admin`) is created ONLY by this seed — fifth instance
  // of the same defect class, and confirms (per DEV-56 Part 3's own question) that `super_admin` is a real,
  // seeded RBAC role, not an invented name.
  '0125_payout_kyc_per_role': [path.join(SEEDS_DIR, 'core', '0004_roles_permissions.sql')],
};

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
        const seedFixups = PRE_APPLY_SEED_FIXUPS[m.version] || [];
        for (const seedFixup of seedFixups) {
          // [DEV-56 2026-08-12 FIX] see PRE_APPLY_SEED_FIXUPS comment above — run the dependency's idempotent
          // seed inside THIS migration's own transaction so a failure rolls back both together, atomically.
          await client.query(fs.readFileSync(seedFixup, 'utf8'));
        }
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
