#!/usr/bin/env node
// db/scripts/verify-rls-coverage.js
// TENANT-ISOLATION MERGE GATE + nightly alarm. The platform's #1 invariant is that
// no tenant can read another tenant's rows. This asserts, against the live schema:
//   1. v_tables_without_rls is EMPTY — no tenant-scoped table lacks an RLS policy;
//   2. every RLS-enabled tenant table is also FORCED (so the table owner can't bypass);
//   3. the money tables (ledger/wallet) intentionally have NO RLS but ARE protected
//      by role grants — positive control that kv_app/kv_relay cannot WRITE them directly.
// Exits non-zero (CI fails) if any check fails. Read-only; safe to run anywhere.
//
// [FIX 2026-07-29, migration 0077 / DEV-35, the standing P0 fix-forward] The `moneyLeaks`
// check below previously tested for a SELECT grant to kv_app on the 4 money tables and
// called that "a leak" — but migration 0014 deliberately, correctly grants kv_app SELECT
// on wallet_accounts/ledger_entries/ledger_transactions (the wallet-balance/wallet-ledger/
// wallet-insights read-models genuinely depend on it, confirmed by direct code read). That
// old check was a FALSE POSITIVE against the platform's own intended design — it would
// flag a correctly-migrated database every single time. It was also looking at the wrong
// thing entirely: the real P0 (proven by DEV-32 QA, fixed by migration 0077) was that
// `ledger_entries` PARTITIONS (not checked at all by the old parent-only query) silently
// inherited direct INSERT/UPDATE/DELETE grants for kv_app AND kv_relay via schema-wide
// `ALTER DEFAULT PRIVILEGES`, and that kv_relay separately held a full `ALL` grant on every
// one of the 4 parent tables since migration 0018, never narrowed. The corrected check
// below (a) tests WRITE privileges (INSERT/UPDATE/DELETE), not SELECT, since SELECT-by-
// kv_app is intended; (b) enumerates the parent AND every partition dynamically via
// `pg_inherits` (exactly the class of gap a parent-only check would miss again); (c)
// checks both kv_app and kv_relay, not just kv_app. This is the permanent CI-level guard
// against this P0 ever silently returning — see also the dedicated regression spec at
// `apps/api/src/core/wallet/__tests__/ledger-privilege-boundary.integration.spec.ts`.
'use strict';
const { withClient } = require('./lib/db');
const { parse, helpAndExit } = require('./lib/args');
const { makeLogger } = require('./lib/log');

const HELP = `
verify-rls-coverage — assert tenant isolation is enforced by the database.
Usage: node db/scripts/verify-rls-coverage.js [--json]
Exit 0 = all good; exit 1 = a coverage gap (block the merge/deploy).`;

const MONEY_TABLES = ['wallet_accounts', 'ledger_entries', 'ledger_transactions', 'reconciliation_runs'];

async function main() {
  const args = parse();
  if (args.has('help')) helpAndExit(HELP);
  const log = makeLogger('verify-rls-coverage');

  const report = await withClient({ appName: 'kv-rls-verify', statementTimeoutMs: 30000, log }, async (client) => {
    const gaps = (await client.query('SELECT tablename FROM v_tables_without_rls ORDER BY 1')).rows.map((r) => r.tablename);
    const notForced = (await client.query(`
      SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
      JOIN information_schema.columns col
        ON col.table_schema='public' AND col.table_name=c.relname AND col.column_name='tenant_id'
      WHERE c.relkind IN ('r','p') AND c.relrowsecurity AND NOT c.relforcerowsecurity
      ORDER BY 1`)).rows.map((r) => r.t);
    const policyCount = (await client.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'`)).rows[0].n;
    // Positive control: kv_app/kv_relay must hold NO write privilege (INSERT/UPDATE/DELETE)
    // on any of the 4 money tables OR any of their partitions — only kv_wallet may write
    // the ledger (Law 2). Enumerated dynamically (parent + pg_inherits children) so a future
    // partition-creation path can never silently re-open this the way 0014/0018's
    // schema-wide ALTER DEFAULT PRIVILEGES once did (migration 0077, DEV-35).
    // ONE documented, deliberate exception: kv_relay's INSERT on `reconciliation_runs` (not
    // partitioned) — migration 0077's own header names this the proven legitimate need of
    // `apps/worker/src/jobs/recon-zero-sum.job.ts` / `daily-gateway-recon.job.ts`, both of
    // which run on the kv_relay-authenticated worker connection. Any OTHER row this query
    // returns is a genuine leak.
    const ALLOWED_WRITE_GRANTS = new Set(['reconciliation_runs|kv_relay|INSERT']);
    const moneyLeaksRaw = (await client.query(`
      WITH money_relations AS (
        SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
        UNION
        SELECT child.oid, child.relname
        FROM pg_inherits i
        JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
        JOIN pg_class child ON child.oid = i.inhrelid
      )
      SELECT mr.relname AS table_name, g.grantee, g.privilege_type
      FROM money_relations mr
      JOIN information_schema.role_table_grants g
        ON g.table_name = mr.relname AND g.table_schema = 'public'
      WHERE g.grantee IN ('kv_app', 'kv_relay')
        AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      ORDER BY 1, 2, 3`, [MONEY_TABLES])).rows;
    const moneyLeaks = moneyLeaksRaw.filter(
      (r) => !ALLOWED_WRITE_GRANTS.has(`${r.table_name}|${r.grantee}|${r.privilege_type}`),
    );
    return { gaps, notForced, policyCount, moneyLeaks };
  });

  let ok = true;
  if (report.gaps.length) { ok = false; log.error('tenant tables WITHOUT an RLS policy', { tables: report.gaps }); }
  if (report.notForced.length) { ok = false; log.error('RLS enabled but NOT forced (owner can bypass)', { tables: report.notForced }); }
  if (report.moneyLeaks.length) { ok = false; log.error('kv_app/kv_relay hold a WRITE grant on a money table or partition (Law 2 violation)', { leaks: report.moneyLeaks }); }
  if (ok) log.info('RLS coverage complete', { policies: report.policyCount });

  if (args.has('json')) process.stdout.write(JSON.stringify({ ok, ...report }, null, 2) + '\n');
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => { makeLogger('verify-rls-coverage').error('FATAL', { error: err.message }); process.exit(1); });
