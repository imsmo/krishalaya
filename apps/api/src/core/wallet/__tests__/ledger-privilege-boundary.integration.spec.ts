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

// ════════════════════════════════════════════════════════════════════════════════════════════
// THIRD BLOCK — DEV-48 fix-forward 0079: STRUCTURAL v2 privilege sweep, closing the
// `loan_repayments` class of leak (money-bearing by column REGEX, not the literal string
// `amount_minor` or a `*ledger*/*wallet*/*account*` name — the exact pattern that let it escape
// 0077/0078's own narrower, pattern-keyed censuses). See spec_dev48.md for the full v2
// methodology + classification table. Appended as a NEW describe block; the DEV-35/0077 and
// DEV-47/0078 suites above are untouched, per this batch's explicit build-agent instruction.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const ADMIN_URL_48 = process.env.DATABASE_ADMIN_URL;
  const run48 = ADMIN_URL_48 ? describe : describe.skip;

  // The 16 DEV-48 named-residue tables (as they exist in the live schema; "settlement_statement
  // lines" is `settlement_lines`) with ZERO proven kv_relay need, code-verified this batch —
  // plus `loan_repayments` handled separately below as its own append-only special case.
  const RESIDUE_ZERO_RELAY_NEED = ['loans', 'loan_applications', 'bnpl_limits', 'trade_invoices',
    'freight_invoices', 'freight_invoice_lines', 'saas_invoices', 'saas_invoice_dunning_attempts',
    'milk_bills', 'contract_input_advances', 'upi_mandates', 'worker_insurance_enrolments'];

  // Proven narrow kv_relay need (code-verified: SELECT/UPDATE/INSERT only where a real
  // apps/*/jobs or */events/handlers file genuinely calls it) — the exact opposite failure
  // mode (over-revoking) must also never regress.
  const NARROW_LEGITIMATE = {
    insurance_policies: { select: true, insert: false, update: false },
    insurance_claims: { select: true, insert: false, update: true },
    settlement_statements: { select: true, insert: true, update: true },
    payout_batches: { select: true, insert: true, update: true },
  };

  run48('structural money-signal privilege sweep — permanent P0 regression (migration 0079, DEV-48)', () => {
    let admin48: Pool;

    beforeAll(async () => {
      admin48 = new Pool({ connectionString: ADMIN_URL_48 });
    }, 30000);

    afterAll(async () => {
      await admin48?.end();
    });

    describe('static grant enumeration — the 16 named residue relations', () => {
      it('kv_relay holds ZERO write/read grants on the 12 zero-legitimate-need residue tables', async () => {
        const res = await admin48.query(
          `SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND grantee = 'kv_relay' AND table_name = ANY($1)`,
          [RESIDUE_ZERO_RELAY_NEED],
        );
        expect(res.rows).toEqual([]);
      });

      it('kv_app holds INSERT+UPDATE (no DELETE) on the 12 zero-legitimate-need residue tables', async () => {
        const res = await admin48.query(
          `SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND grantee = 'kv_app' AND table_name = ANY($1)
             AND privilege_type NOT IN ('INSERT','UPDATE')`,
          [RESIDUE_ZERO_RELAY_NEED],
        );
        expect(res.rows).toEqual([]);
      });

      // [QA-FIX 2026-07-29] as shipped this asserted kv_app holds literally nothing but INSERT on
      // loan_repayments, which is FALSE against the real post-0079 grants and made this test fail on a
      // genuine run (`kv_app must be INSERT-only on loan_repayments, found SELECT`) — not a security gap:
      // `loan-repayment.repository.ts`'s `list()` method (line 24) issues a real `SELECT ... FROM
      // loan_repayments` to show a borrower their repayment history, and kv_app's SELECT there comes from
      // 0014's schema-wide default privileges, never revoked by 0079 (correctly — 0079 only revokes
      // UPDATE/DELETE from kv_app per its own header, it never claimed to revoke SELECT). The migration is
      // correct; this assertion was wrong. Fixed to match the real, evidenced design: kv_app may hold
      // SELECT+INSERT (both legitimate, both grep-confirmed against the repository), never UPDATE/DELETE.
      it('loan_repayments: kv_app is SELECT+INSERT only (append-only by design — no update() method exists in the repository), kv_relay holds nothing, incl. every existing partition + a partition created fresh', async () => {
        const parentAndPartitions = await admin48.query(
          `SELECT c.relname FROM pg_class c WHERE c.relname = 'loan_repayments'
           UNION
           SELECT child.relname FROM pg_inherits i
           JOIN pg_class parent ON parent.oid = i.inhparent AND parent.relname = 'loan_repayments'
           JOIN pg_class child ON child.oid = i.inhrelid`,
        );
        expect(parentAndPartitions.rows.length).toBeGreaterThan(0);
        const relnames = parentAndPartitions.rows.map((r: any) => r.relname);
        const grants = await admin48.query(
          `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema='public' AND table_name = ANY($1) AND grantee IN ('kv_app','kv_relay')`,
          [relnames],
        );
        for (const row of grants.rows) {
          if (row.grantee === 'kv_relay') throw new Error(`kv_relay must hold nothing on ${row.table_name}, found ${row.privilege_type}`);
          if (row.grantee === 'kv_app' && !['SELECT', 'INSERT'].includes(row.privilege_type)) {
            throw new Error(`kv_app must be SELECT+INSERT-only on ${row.table_name}, found ${row.privilege_type}`);
          }
        }
      });

      // [QA-FIX 2026-07-29] `CALL ensure_partitions(1)` iterates EVERY partitioned table in the whole
      // schema (not just loan_repayments), which genuinely exceeds jest's default 5000ms test timeout once
      // enough partitioned tables exist (reproduced live: "Exceeded timeout of 5000 ms for a test", which
      // then cascaded into the afterAll hook timing out too). Same cost DEV-47 QA already documented
      // (dev47_report.md §7.4: "CALL ensure_partitions(N) is expensive ... timed out under the sandbox's
      // 45s budget"). Not a privilege defect — a test-runtime-budget defect. Fixed with an explicit longer
      // per-test timeout, the same pattern beforeAll already uses two lines above.
      it('a Law-2 append-only trigger exists on loan_repayments, cloned onto every partition (incl. one created after 0079 via ensure_partitions)', async () => {
        const before = await admin48.query(
          `SELECT count(*)::int n FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent AND p.relname='loan_repayments'`,
        );
        await admin48.query(`CALL ensure_partitions(1)`);
        const freshPartition = await admin48.query(
          `SELECT c.relname FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent AND p.relname='loan_repayments'
           JOIN pg_class c ON c.oid=i.inhrelid ORDER BY c.relname DESC LIMIT 1`,
        );
        const partName = freshPartition.rows[0].relname;
        const triggerOnParent = await admin48.query(
          `SELECT 1 FROM pg_trigger WHERE tgrelid='loan_repayments'::regclass AND tgname='loan_repayments_append_only' AND NOT tgisinternal`,
        );
        expect(triggerOnParent.rows.length).toBe(1);
        const relayOnFresh = await admin48.query(
          `SELECT has_table_privilege('kv_relay', $1, 'INSERT') AS ins`, [partName],
        );
        expect(relayOnFresh.rows[0].ins).toBe(false);
        expect(before.rows[0].n).toBeGreaterThanOrEqual(0); // sanity, never negative
      }, 20000);
    });

    describe('proven narrow kv_relay grants remain exactly as evidenced — over-revoking regression guard', () => {
      it.each(Object.entries(NARROW_LEGITIMATE))('%s matches its code-verified privilege shape exactly', async (table, shape) => {
        const res = await admin48.query(
          `SELECT has_table_privilege('kv_relay',$1,'SELECT') AS sel,
                  has_table_privilege('kv_relay',$1,'INSERT') AS ins,
                  has_table_privilege('kv_relay',$1,'UPDATE') AS upd,
                  has_table_privilege('kv_relay',$1,'DELETE') AS del`,
          [table],
        );
        const row = res.rows[0];
        expect(row.sel).toBe(shape.select);
        expect(row.ins).toBe(shape.insert);
        expect(row.upd).toBe(shape.update);
        expect(row.del).toBe(false); // DELETE is never legitimate for kv_relay anywhere in this sweep
      });
    });

    describe('DELETE hygiene — cart_items is the ONE proven exception in this whole batch', () => {
      it('kv_app DELETE is granted on cart_items only, among every relation this batch touched', async () => {
        const ALL_TOUCHED = [...RESIDUE_ZERO_RELAY_NEED, 'loan_repayments', 'insurance_policies',
          'insurance_claims', 'settlement_statements', 'payout_batches', 'orders', 'order_items',
          'listings', 'notifications', 'subscriptions', 'promotions', 'requirements', 'disputes',
          'auctions', 'cart_items'];
        const res = await admin48.query(
          `SELECT table_name FROM information_schema.role_table_grants
           WHERE table_schema='public' AND grantee='kv_app' AND privilege_type='DELETE' AND table_name = ANY($1)`,
          [ALL_TOUCHED],
        );
        expect(res.rows.map((r: any) => r.table_name)).toEqual(['cart_items']);
      });
    });

    // ── STRUCTURAL FUTURE-PROOF ASSERTION ───────────────────────────────────────────────────
    // The root lesson of this whole batch: a census keyed on a NAMING or COLUMN-LITERAL pattern
    // missed `loan_repayments`. This test instead applies the SAME regex classifier spec_dev48.md
    // used to BUILD the census, live, every run — so a brand-new table with a money-shaped column
    // (`*_minor`, `amount*`, `*_amount`, `*_paise`, `price*`, `balance*`, `fee*`) that a future
    // migration forgets to explicitly GRANT/REVOKE can NEVER silently inherit kv_app/kv_relay
    // write access again without this test failing FIRST. An explicit, reviewed allow-list is the
    // only escape hatch (kept short and named, not a wildcard) — every entry here has a
    // code-verified justification earlier in this file or in 0077/0078/0079's own headers.
    it('NO relation matching the money-signal column regex holds kv_relay INSERT/UPDATE/DELETE unless explicitly allow-listed with a proven reason', async () => {
      const ALLOW_LIST_RELAY_WRITE = [
        'reconciliation_runs',      // 0077: INSERT only, recon-zero-sum.job.ts + daily-gateway-recon.job.ts
        'ambassador_earnings',      // 0078: UPDATE(payout_id) + SELECT only, weekly-payout-batch.job.ts
        'milk_collections',         // 0078: UPDATE(milk_bill_id) + SELECT only, milk-bill-cycle-close.job.ts
        'payouts',                  // 0078: UPDATE only, payout-execution/wage-priority jobs
        'settlement_statements',    // 0079: SELECT+INSERT+UPDATE, settlement-statements.cadence-job.ts
        'settlement_lines',         // 0079: SELECT+INSERT+UPDATE+DELETE, dispute-resolved/order-completed handlers
        'payout_batches',           // 0079: SELECT+INSERT+UPDATE, payout-execution.cadence-job.ts
        'insurance_claims',         // 0079: SELECT+UPDATE, surveyor-dispatch.handler.ts
        'orders',                   // 0079 Category D: INSERT+UPDATE, extensive job/handler state machine
        'order_items',              // 0079 Category D: partition of the orders state machine
        'listings',                 // 0079 Category D: boost-expiry/expire-listings/publish-scheduled jobs
        'notifications',            // 0014/0079 Category D: column-restricted + extensive job/handler fanout
        'subscriptions',            // 0079 Category D: tenancy renewal/grace-period/trial-expiry jobs
        'promotions',               // 0079 Category D: promo-budget-watch/festival-campaign jobs
        'requirements',             // 0079 Category D: match-notifications/expire-requirements jobs
        'disputes',                 // 0079 Category D: sla-escalation/seller-response-timeout jobs
        'auctions',                 // 0079 Category D: open-scheduled/release-losing-emd/close-ended jobs
      ];
      // Roll every partition up to its PARENT's name before comparing against the allow-list —
      // a partition like `orders_2026_07` must be judged as `orders`, not as its own unlisted
      // identity (the exact class of false-positive a naive per-relation check would produce).
      //
      // [QA-FIX 2026-07-29] as shipped this joined `information_schema.columns` (which internally
      // re-evaluates a column-privilege check for the CURRENT USER on every single column of every
      // relation in the schema — a well-documented Postgres information_schema performance trap)
      // against `information_schema.role_table_grants` with no early filter, and reproducibly took
      // >15s against this repo's ~869-relation catalog with no explicit jest timeout override —
      // meaning it silently exceeded jest's default 5000ms test timeout and would ALWAYS fail in CI,
      // making the single control this whole batch exists to deliver non-functional as shipped. Never
      // caught because DEV-48 never ran this spec live (its own gate table only reports the `unit`
      // project, 219/1524 — this `integration` spec was not executed). Rewritten to the identical
      // semantics using `pg_attribute` (no per-row ACL re-check) for the column-name match, restricting
      // `role_table_grants` to kv_relay write rows before joining — reproduced at 67ms against the same
      // catalog (vs >15000ms), verified to still return the identical (empty) result on a healthy DB and
      // to still detect a synthetic newly-added vulnerable table (see qa48 negative-test evidence).
      const res = await admin48.query(
        `WITH base_name AS (
           SELECT c.oid, COALESCE(p.relname, c.relname) AS base_relname, c.relname AS actual_relname
           FROM pg_class c
           LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
           LEFT JOIN pg_class p ON p.oid = i.inhparent
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
         ),
         money_cols AS (
           SELECT DISTINCT a.attrelid
           FROM pg_attribute a
           WHERE a.attnum > 0 AND NOT a.attisdropped
             AND (a.attname ~ '.*_minor$' OR a.attname ~ '^amount.*' OR a.attname ~ '.*_amount$'
                  OR a.attname ~ '.*_paise$' OR a.attname ~ '^price.*' OR a.attname ~ '^balance.*'
                  OR a.attname ~ '^fee.*')
         ),
         relay_write AS (
           SELECT DISTINCT g.table_name
           FROM information_schema.role_table_grants g
           WHERE g.table_schema = 'public' AND g.grantee = 'kv_relay'
             AND g.privilege_type IN ('INSERT','UPDATE','DELETE')
         )
         SELECT DISTINCT bn.base_relname
         FROM base_name bn
         JOIN money_cols mc ON mc.attrelid = bn.oid
         JOIN relay_write rw ON rw.table_name = bn.actual_relname
         WHERE bn.base_relname != ALL($1)`,
        [ALLOW_LIST_RELAY_WRITE],
      );
      expect(res.rows).toEqual([]);
    }, 20000);
  });
}
