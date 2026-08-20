// apps/api/test/integration-global-setup.js
// Jest globalSetup for the `integration` project. Builds the test database ONCE, from the
// SAME SQL production uses — the real db/migrations/*.sql, the least-privilege app role, and the
// real db/seeds/*.sql (core + rules + catalogue, the non-demo set). No hand-maintained schema
// "slice" — so the integration tests can never drift from the migrations the product ships with.
//
// Runs only when DATABASE_ADMIN_URL (a DDL-capable superuser/owner) is set; the integration
// specs themselves connect as the least-privilege kv_app role (DATABASE_URL) so RLS is exercised.
// Without DATABASE_ADMIN_URL this is a no-op and every integration spec skips (describe.skip),
// keeping the fast unit suite runnable anywhere.
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..', '..');        // repo root (krishalaya)
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const SEEDS_DIR = path.join(ROOT, 'db', 'seeds');
const APP_ROLE_SQL = path.join(__dirname, 'sql', '01_app_role.sql');

module.exports = async function integrationGlobalSetup() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    // No admin DB → integration specs skip themselves. Nothing to build.
    return;
  }

  const admin = new Pool({ connectionString: adminUrl });
  const t0 = Date.now();
  try {
    // 1) Reset to a clean schema so the run is deterministic and repeatable.
    await admin.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public; GRANT ALL ON SCHEMA public TO CURRENT_USER;`);

    // 2) Apply the REAL migrations in ascending order (no params → simple-query, multi-statement OK).
    const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrations) {
      try { await admin.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); }
      catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
      // [DEV-30 2026-07-28 FIX] migration 0057_upi_mandate_executions.sql inserts a lookup_values row keyed by
      // lookup_type 'ledger_txn_type', which only exists once seed core/0005_lookup_vocabularies.sql has run
      // (lookup_values.type_code REFERENCES lookup_types(code); 'ledger_txn_type' is a lookup_types row seed
      // 0005 creates, not any migration) — this loop was applying ALL migrations before ANY seed (step 4 runs
      // after this whole loop), so it hit the identical FK-order failure db/scripts/migrate.js hits against a
      // truly fresh DB (first documented at DEV-04/05, re-confirmed live this batch — see dev30_report.md Part 6:
      // this exact loop, unpatched, fails with "insert or update on table lookup_values violates foreign key
      // constraint lookup_values_type_code_fkey" at 0057). This is the first time any sandbox has had a real
      // Postgres to actually execute this globalSetup, so the defect was never observable before now. Fix: seed
      // core/0005 only touches lookup_types/lookup_values, both created by migration 0001 — run it right after
      // 0001, well before 0057.
      //
      // [PC-56 TENANT-6c-4 CORRECTION] This comment used to end: *"Seed 0005 is idempotent (ON CONFLICT DO NOTHING
      // throughout) so step 4 below re-applying it later in the normal seed order is harmless, not a double-seed
      // bug."* **THAT IS FALSE, AND IT IS WHY NOBODY LOOKED.** `lookup_values` has `UNIQUE (type_code, tenant_id,
      // code)` and a PLATFORM row has `tenant_id IS NULL`; Postgres treats NULLs as DISTINCT in a unique index unless
      // it is declared `NULLS NOT DISTINCT`, which 0001's is not. So `ON CONFLICT` cannot fire for platform values,
      // this file's deliberate double-apply DUPLICATES every one of them, and a freshly built test database carries
      // 139 duplicated codes out of 311 — `ledger_txn_type` (FK'd by every ledger transaction), `payment_purpose`,
      // `payout_purpose`, `dispute_reason` and `boost_tier` (whose price lives in `meta`) among them. The double
      // apply is still needed for the FK-order reason above; what was wrong was the claim that it costs nothing.
      // De-duplicating the existing rows means repointing FKs on the ledger, so it is ESCALATED rather than swept
      // (see migration 0160's header). Migration 0160 gives its own vocabulary a partial unique index so the
      // deduction types at least cannot be duplicated.
      if (f.startsWith('0001_')) {
        await admin.query(fs.readFileSync(path.join(SEEDS_DIR, 'core', '0005_lookup_vocabularies.sql'), 'utf8'));
      }
    }

    // 3) Give kv_app LOGIN (its table privileges come from the migrations themselves, so the
    //    test role mirrors production exactly — see test/sql/01_app_role.sql).
    await admin.query(fs.readFileSync(APP_ROLE_SQL, 'utf8'));

    // 4) Apply the REAL seeds in the same order the seed runner uses (core → rules → catalogue).
    const { ORDER } = require(path.join(ROOT, 'db', 'scripts', 'seed.js'));
    for (const rel of ORDER) {
      const full = path.join(SEEDS_DIR, rel);
      if (!fs.existsSync(full)) continue;
      try { await admin.query(fs.readFileSync(full, 'utf8')); }
      catch (e) { throw new Error(`seed ${rel} failed: ${e.message}`); }
    }

    // (No extra grants — kv_app's privileges come from the migrations so the test role matches
    //  production. Seeds create no tables, and 0014's default privileges cover later migrations.)
    // eslint-disable-next-line no-console
    console.log(`[integration] built test DB from ${migrations.length} migrations + ${ORDER.length} seeds in ${Date.now() - t0}ms`);
  } finally {
    await admin.end();
  }
};
