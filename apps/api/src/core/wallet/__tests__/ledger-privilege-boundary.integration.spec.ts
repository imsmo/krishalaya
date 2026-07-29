// core/wallet/__tests__/ledger-privilege-boundary.integration.spec.ts
// PERMANENT REGRESSION SPEC for the standing P0 first proven at DEV-32 QA (qa_dev32_audit.md
// §3) and fixed forward at migration 0077 (DEV-35, KRISHI_VERSE_DEV_CONTRACT.md v1.1 Law 2/
// Law 5). This test exists so the P0 can never silently return: if a future migration or an
// `ensure_partitions()` change re-opens kv_app/kv_relay's direct write access to the ledger —
// on the parent table OR on any partition, existing or newly created — this spec fails.
//
// THE P0, IN ONE SENTENCE: migrations 0014/0018 granted kv_app/kv_relay schema-wide default
// privileges that silently re-materialized on every `ledger_entries` partition
// `ensure_partitions()` created (Postgres does not propagate a parent table's REVOKE to its
// partitions), and kv_relay separately held a full un-narrowed grant on all 4 money-table
// parents since migration 0018. A SECOND, independent root cause found while building 0077:
// migrations 0065/0076 granted kv_app/kv_relay membership in kv_wallet via a BARE
// `GRANT kv_wallet TO kv_app` — Postgres's default for a bare role-membership grant is
// `WITH INHERIT TRUE`, meaning kv_app/kv_relay were PASSIVELY exercising every kv_wallet
// privilege at all times, without ever needing the `SET LOCAL ROLE kv_wallet` elevation
// `wallet.client.inprocess.ts` performs — that elevation was never actually gating anything.
// Both are fixed by migration 0077; both are probed here.
//
// Pattern: reuses the `DATABASE_URL` (kv_app) / `DATABASE_ADMIN_URL` (owner/superuser)
// convention already established by
// `apps/api/src/modules/fintech/__tests__/kcc-drawl-ledger-loan-restructures.rls.integration.spec.ts`.
// The owner/superuser connection can `SET LOCAL ROLE <x>` to assume kv_app/kv_relay/kv_wallet's
// EXACT effective privileges for the duration of a transaction (real Postgres semantics: once a
// superuser session issues SET ROLE to a non-superuser role, ordinary grant/revoke checks apply
// for that role, not superuser bypass) — this is the same mechanism the production code itself
// relies on, so probing via `SET LOCAL ROLE` here exercises the real privilege boundary, not a
// simulation of it.
import { Pool } from 'pg';

const APP_URL = process.env.DATABASE_URL;         // least-privilege kv_app role
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;  // owner/superuser — can SET ROLE to anything
const run = ADMIN_URL ? describe : describe.skip;

const MONEY_TABLES = ['wallet_accounts', 'ledger_entries', 'ledger_transactions', 'reconciliation_runs'];

run('ledger/wallet privilege boundary — permanent P0 regression (migration 0077, DEV-35)', () => {
  let admin: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
  }, 30000);

  afterAll(async () => {
    await admin?.end();
  });

  // ── STATIC ACL ASSERTIONS — parent + every partition, enumerated by query ──────────────
  describe('static grant enumeration (parent + all partitions, no hand-written list)', () => {
    it('kv_app holds ZERO write grants (INSERT/UPDATE/DELETE) on any money relation, incl. every ledger_entries partition', async () => {
      const res = await admin.query(
        `WITH money_relations AS (
           SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
           UNION
           SELECT child.oid, child.relname
           FROM pg_inherits i
           JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
           JOIN pg_class child ON child.oid = i.inhrelid
         )
         SELECT mr.relname, g.privilege_type
         FROM money_relations mr
         JOIN information_schema.role_table_grants g
           ON g.table_name = mr.relname AND g.table_schema = 'public'
         WHERE g.grantee = 'kv_app' AND g.privilege_type IN ('INSERT','UPDATE','DELETE')`,
        [MONEY_TABLES],
      );
      expect(res.rows).toEqual([]);
    });

    it('kv_relay holds ZERO write grants on any money relation except INSERT on reconciliation_runs (its one proven legitimate need)', async () => {
      const res = await admin.query(
        `WITH money_relations AS (
           SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
           UNION
           SELECT child.oid, child.relname
           FROM pg_inherits i
           JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
           JOIN pg_class child ON child.oid = i.inhrelid
         )
         SELECT mr.relname, g.privilege_type
         FROM money_relations mr
         JOIN information_schema.role_table_grants g
           ON g.table_name = mr.relname AND g.table_schema = 'public'
         WHERE g.grantee = 'kv_relay' AND g.privilege_type IN ('INSERT','UPDATE','DELETE')`,
        [MONEY_TABLES],
      );
      const unexpected = res.rows.filter((r) => !(r.relname === 'reconciliation_runs' && r.privilege_type === 'INSERT'));
      expect(unexpected).toEqual([]);
    });

    it('every ledger_entries partition exists and is covered (sanity: at least the current-month partition is present)', async () => {
      const res = await admin.query(
        `SELECT count(*)::int n FROM pg_inherits i
         JOIN pg_class p ON p.oid = i.inhparent AND p.relname = 'ledger_entries'`,
      );
      expect(res.rows[0].n).toBeGreaterThan(0);
    });

    it('kv_app/kv_relay membership in kv_wallet is NON-INHERITING (WITH INHERIT FALSE) — the second root cause', async () => {
      const res = await admin.query(
        `SELECT m.roleid::regrole::text AS role_granted, r.rolname AS member, m.inherit_option
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member
         JOIN pg_roles ro ON ro.oid = m.roleid AND ro.rolname = 'kv_wallet'
         WHERE r.rolname IN ('kv_app','kv_relay')`,
      );
      expect(res.rows.length).toBeGreaterThanOrEqual(2);
      for (const row of res.rows) {
        expect(row.inherit_option).toBe(false);
      }
    });

    it('a Law-2 append-only trigger exists on ledger_entries (BEFORE UPDATE OR DELETE)', async () => {
      const res = await admin.query(
        `SELECT tgname, tgtype FROM pg_trigger
         WHERE tgrelid = 'ledger_entries'::regclass AND NOT tgisinternal`,
      );
      expect(res.rows.some((r) => r.tgname === 'ledger_entries_append_only')).toBe(true);
    });
  });

  // ── LIVE BEHAVIORAL PROBES — the exact class of probe that caught the P0 originally ─────
  describe('live probes — unelevated writes are DENIED, elevated writer is ALLOWED but append-only', () => {
    async function withRole<T>(role: string, fn: (c: Pool) => Promise<T>): Promise<T> {
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        // @ts-expect-error — reuse the Pool-shaped .query signature on a single client for this probe
        const result = await fn({ query: (...args: any[]) => client.query(...args) });
        await client.query('ROLLBACK'); // never actually commit a probe write
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    }

    it('kv_app unelevated INSERT into ledger_entries is DENIED (the exact probe DEV-32 QA proved SUCCEEDED before 0077)', async () => {
      await expect(
        withRole('kv_app', (c) => c.query(
          `INSERT INTO ledger_entries (txn_id, account_id, amount_minor, currency_code, balance_after_minor, entry_hash)
           VALUES (gen_random_uuid(), gen_random_uuid(), -1, 'INR', 0, 'regression-probe')`,
        )),
      ).rejects.toThrow(/permission denied/i);
    });

    it('kv_relay unelevated INSERT into ledger_entries is DENIED', async () => {
      await expect(
        withRole('kv_relay', (c) => c.query(
          `INSERT INTO ledger_entries (txn_id, account_id, amount_minor, currency_code, balance_after_minor, entry_hash)
           VALUES (gen_random_uuid(), gen_random_uuid(), -1, 'INR', 0, 'regression-probe')`,
        )),
      ).rejects.toThrow(/permission denied/i);
    });

    it('kv_relay unelevated INSERT into wallet_accounts is DENIED (0018 blanket grant, now narrowed)', async () => {
      await expect(
        withRole('kv_relay', (c) => c.query(
          `INSERT INTO wallet_accounts (owner_kind, account_code, currency_code) VALUES ('platform','regression-probe','INR')`,
        )),
      ).rejects.toThrow(/permission denied/i);
    });

    const run2 = APP_URL ? it : it.skip;
    run2('kv_app (real DATABASE_URL connection, not SET ROLE) still SUCCEEDS reading ledger_entries — the preserved legitimate read-path', async () => {
      const app = new Pool({ connectionString: APP_URL });
      try {
        await expect(app.query('SELECT count(*) FROM ledger_entries')).resolves.toBeDefined();
      } finally {
        await app.end();
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// SIBLING SUITE — DEV-47 fix-forward 0078: the SAME privilege-class fix, swept across all
// money-bearing partitioned tables (kcc_drawl_ledger's existing partitions were the escalated
// finding at DEV-35 QA; 0078 also found + fixed 14 more relations, and a second-order bug in
// 0077's own sync_partition_privileges() procedure — see spec_dev47.md / dev47_report.md).
// Appended as a NEW describe block; the DEV-35/0077 suite above is untouched, per this batch's
// explicit instruction not to modify DEV-35's pre-existing uncommitted content.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const ADMIN_URL_47 = process.env.DATABASE_ADMIN_URL;
  const run47 = ADMIN_URL_47 ? describe : describe.skip;
  const SWEPT_PARTITIONED = ['kcc_drawl_ledger', 'group_ledger_entries', 'dbt_transfers',
    'ambassador_earnings', 'aeps_service_events', 'milk_collections'];
  const APPEND_ONLY_FULL = ['kcc_drawl_ledger', 'group_ledger_entries', 'dbt_transfers'];
  const ZERO_KV_RELAY_NEED = ['kcc_drawl_ledger', 'group_ledger_entries', 'dbt_transfers', 'aeps_service_events',
    'bank_accounts', 'bids', 'billing_adjustments', 'commission_plans_ambassador', 'coupon_redemptions',
    'payments', 'upi_mandate_executions', 'worker_advances'];

  run47('money-bearing partition privilege sweep — permanent P0 regression (migration 0078, DEV-47)', () => {
    let admin47: Pool;

    beforeAll(async () => {
      admin47 = new Pool({ connectionString: ADMIN_URL_47 });
    }, 30000);

    afterAll(async () => {
      await admin47?.end();
    });

    describe('static grant enumeration — parent + every existing partition, no hand-written list', () => {
      it('kv_relay holds ZERO write/read grants on the 12 zero-legitimate-need tables (table-wide or column-restricted), incl. every partition of the 6 partitioned ones', async () => {
        const res = await admin47.query(
          `WITH swept_relations AS (
             SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
             UNION
             SELECT child.oid, child.relname
             FROM pg_inherits i
             JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
             JOIN pg_class child ON child.oid = i.inhrelid
           )
           SELECT sr.relname, g.privilege_type FROM swept_relations sr
           JOIN information_schema.role_table_grants g ON g.table_name = sr.relname AND g.table_schema = 'public'
           WHERE g.grantee = 'kv_relay'
           UNION
           SELECT sr.relname, cp.privilege_type FROM swept_relations sr
           JOIN information_schema.column_privileges cp ON cp.table_name = sr.relname AND cp.table_schema = 'public'
           WHERE cp.grantee = 'kv_relay'`,
          [ZERO_KV_RELAY_NEED],
        );
        expect(res.rows).toEqual([]);
      });

      it('kv_app holds ZERO table-wide UPDATE/DELETE on the 6 ledger-class tables (append-only or narrowly-mutable-only), incl. every existing partition', async () => {
        const res = await admin47.query(
          `WITH ledger_relations AS (
             SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
             UNION
             SELECT child.oid, child.relname
             FROM pg_inherits i
             JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
             JOIN pg_class child ON child.oid = i.inhrelid
           )
           SELECT lr.relname, g.privilege_type FROM ledger_relations lr
           JOIN information_schema.role_table_grants g ON g.table_name = lr.relname AND g.table_schema = 'public'
           WHERE g.grantee = 'kv_app' AND g.privilege_type IN ('UPDATE','DELETE')`,
          [SWEPT_PARTITIONED],
        );
        expect(res.rows).toEqual([]);
      });

      it('DELETE is granted to neither kv_app nor kv_relay on any of the 15 swept relations', async () => {
        const ALL_15 = [...ZERO_KV_RELAY_NEED, 'ambassador_earnings', 'milk_collections', 'payouts'];
        const res = await admin47.query(
          `SELECT table_name, grantee FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND grantee IN ('kv_app','kv_relay')
             AND table_name = ANY($1) AND privilege_type = 'DELETE'`,
          [ALL_15],
        );
        expect(res.rows).toEqual([]);
      });

      it('the 4 new append-only triggers exist on kcc_drawl_ledger/group_ledger_entries/dbt_transfers/billing_adjustments, cloned onto every existing partition', async () => {
        const res = await admin47.query(
          `WITH targets AS (
             SELECT c.oid, c.relname FROM pg_class c WHERE c.relname = ANY($1)
             UNION
             SELECT child.oid, child.relname
             FROM pg_inherits i
             JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = ANY($1)
             JOIN pg_class child ON child.oid = i.inhrelid
           )
           SELECT t.relname, tg.tgname FROM targets t
           JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal`,
          [[...APPEND_ONLY_FULL, 'billing_adjustments']],
        );
        const relnamesWithTrigger = new Set(res.rows.map((r: any) => r.relname));
        // every parent (billing_adjustments is unpartitioned, the other 3 are) must have its own trigger
        expect(relnamesWithTrigger.has('kcc_drawl_ledger')).toBe(true);
        expect(relnamesWithTrigger.has('group_ledger_entries')).toBe(true);
        expect(relnamesWithTrigger.has('dbt_transfers')).toBe(true);
        expect(relnamesWithTrigger.has('billing_adjustments')).toBe(true);
      });

      it('ambassador_earnings/milk_collections: kv_relay holds table-wide SELECT + its one narrow column UPDATE, nothing more (the second-order column-privilege propagation fix)', async () => {
        for (const [table, col] of [['ambassador_earnings', 'payout_id'], ['milk_collections', 'milk_bill_id']] as const) {
          const selectGrant = await admin47.query(
            `SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee='kv_relay' AND privilege_type='SELECT'`,
            [table],
          );
          expect(selectGrant.rows.length).toBeGreaterThan(0);
          const colGrant = await admin47.query(
            `SELECT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name=$1 AND grantee='kv_relay' AND privilege_type='UPDATE'`,
            [table],
          );
          expect(colGrant.rows.map((r: any) => r.column_name)).toEqual([col]);
          const insertOrDelete = await admin47.query(
            `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee='kv_relay' AND privilege_type IN ('INSERT','DELETE')`,
            [table],
          );
          expect(insertOrDelete.rows).toEqual([]);
        }
      });
    });

    describe('live probes — illegitimate writes DENIED, the narrow legitimate paths still SUCCEED', () => {
      async function withRole47<T>(role: string, fn: (c: Pool) => Promise<T>): Promise<T> {
        const client = await admin47.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL ROLE ${role}`);
          // @ts-expect-error — reuse the Pool-shaped .query signature on a single client for this probe
          const result = await fn({ query: (...args: any[]) => client.query(...args) });
          await client.query('ROLLBACK');
          return result;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
      }

      // [QA-FIX 2026-07-29] as shipped this INSERT named columns that do not exist on kcc_drawl_ledger
      // (kcc_account_id/entry_type/txn_ref — the real columns per 0069_kcc_drawl_ledger_loan_restructures.sql
      // are loan_id/entry_kind, and there is no txn_ref column at all). Postgres resolves column names during
      // parse-analysis BEFORE the executor's ACL check runs, so the original statement would have failed with
      // "column ... does not exist" rather than "permission denied" — the test would have FAILED even against a
      // correctly-secured, correctly-migrated database, proving nothing about the privilege boundary it claims to
      // guard. Corrected to the real schema (also supplying balance_after_minor/narrative, both NOT NULL with no
      // default) so the probe actually exercises the ACL and not a schema-drift parse error.
      it('kv_relay unelevated INSERT into kcc_drawl_ledger is DENIED (the exact DEV-35-QA-escalated finding, now fixed)', async () => {
        await expect(
          withRole47('kv_relay', (c) => c.query(
            `INSERT INTO kcc_drawl_ledger (tenant_id, loan_id, entry_kind, amount_minor, balance_after_minor, narrative)
             VALUES (gen_random_uuid(), gen_random_uuid(), 'drawl', 100, 100, 'regression-probe')`,
          )),
        ).rejects.toThrow(/permission denied/i);
      });

      it('kv_app unelevated UPDATE on kcc_drawl_ledger is DENIED (append-only)', async () => {
        await expect(
          withRole47('kv_app', (c) => c.query(`UPDATE kcc_drawl_ledger SET amount_minor = 999 WHERE true`)),
        ).rejects.toThrow(/permission denied/i);
      });

      // [QA-FIX 2026-07-29] as shipped this INSERT named a "reason_code" column that does not exist on
      // billing_adjustments (the real column is "reason", per 0035_billing_ops.sql) and omitted 3 other NOT
      // NULL columns (direction, currency_code, idempotency_key, wallet_txn_id). Same class of defect as the
      // kcc_drawl_ledger probe above — a parse-time "column does not exist" error, not "permission denied",
      // so the test would have failed for the wrong reason even against a correctly-secured database.
      it('kv_relay unelevated INSERT/UPDATE/DELETE into billing_adjustments is DENIED (append-only, zero legitimate kv_relay need)', async () => {
        await expect(
          withRole47('kv_relay', (c) => c.query(
            `INSERT INTO billing_adjustments (tenant_id, direction, amount_minor, currency_code, reason, idempotency_key, wallet_txn_id)
             VALUES (gen_random_uuid(), 'credit', 100, 'INR', 'regression-probe', 'regression-probe-key', gen_random_uuid())`,
          )),
        ).rejects.toThrow(/permission denied/i);
      });

      it('kv_relay UPDATE(amount_minor) on ambassador_earnings is DENIED even though it holds table-wide SELECT + UPDATE(payout_id) (column-restriction still enforced)', async () => {
        await expect(
          withRole47('kv_relay', (c) => c.query(`UPDATE ambassador_earnings SET amount_minor = 999 WHERE true`)),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
}
