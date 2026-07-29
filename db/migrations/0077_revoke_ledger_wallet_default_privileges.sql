-- ============================================================================
-- MIGRATION 0077 — REVOKE LEDGER/WALLET DEFAULT-PRIVILEGE WRITES + DB-ENFORCE LAW 2
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied
-- migration — 0014/0018/0065/0076 stay byte-untouched; this is a fix-forward, full stop
-- (KRISHI_VERSE_DEV_CONTRACT.md v1.1, Law 5 / Prohibitions §7).
--
-- Fix-forward for the STANDING P0 first proven at DEV-32 QA (2026-07-29, qa_dev32_audit.md
-- §3, DEV_TRACKER.md's DEV-32 QA STATE block), re-confirmed open at every subsequent batch
-- through the DEV-S7 founder merge sitting ("nothing merged this sitting is deployed ...
-- fix-forward migration 0077 still owed before any real deploy").
--
-- ── THE P0, EXACTLY ──────────────────────────────────────────────────────────────────────
-- 0014_platform_ops_security.sql set up the INTENDED role model:
--   kv_app     — request-tier login role (RLS-bound). Money: SELECT ONLY on
--                wallet_accounts/ledger_entries/ledger_transactions (read balances/
--                statements — apps/api/src/modules/payments/read-models/{wallet-balance,
--                wallet-ledger,wallet-insights}.read-model.ts genuinely depend on this,
--                confirmed by direct code read: they query these tables on the plain
--                kv_app-authenticated replica pool with NO `SET LOCAL ROLE`). No write.
--   kv_wallet  — the ONLY role that may INSERT into ledger_entries/ledger_transactions or
--                INSERT/UPDATE wallet_accounts/reconciliation_runs (Law 2's writer). kv_app
--                and kv_relay each hold role MEMBERSHIP in kv_wallet (0065, 0076) so a
--                money-writing code path can transiently `SET LOCAL ROLE kv_wallet` for the
--                duration of a ledger post (wallet.client.inprocess.ts), then RESET ROLE —
--                ordinary app/relay SQL never touches the ledger directly.
--   kv_relay   — the outbox-relay/worker BYPASSRLS system role (0018). Money: needs SELECT
--                on ledger_entries + INSERT on reconciliation_runs, UNELEVATED, for the
--                hourly zero-sum recon job (apps/worker/src/jobs/recon-zero-sum.job.ts —
--                direct `SELECT ... FROM ledger_entries ... HAVING SUM(amount_minor)<>0`
--                and `INSERT INTO reconciliation_runs`, run on the worker's kv_relay pool).
--                No other direct/unelevated money access is legitimate (confirmed: no
--                relay-dispatched handler under apps/api/src/modules/*/events/handlers/
--                touches ledger/wallet tables directly — every one calls only
--                `this.wallet.post(...)`, which elevates).
--
-- What ACTUALLY happened: 0014 issued a schema-wide
--   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO kv_app`
-- and 0018 issued the schema-wide equivalent for kv_relay
--   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kv_relay`
-- (plus `GRANT ... ON ALL TABLES IN SCHEMA public TO kv_relay`, unconditionally, on
-- whatever existed when 0018 ran). Postgres default privileges cannot be scoped "all
-- tables except these three" — there is no per-table exception syntax. 0014's own later,
-- narrower `REVOKE ALL ON wallet_accounts, ledger_entries, ledger_transactions,
-- reconciliation_runs FROM kv_app` only touched the exact relations that existed AT THAT
-- MOMENT, and 0018 never issued any REVOKE against kv_relay on these 4 tables at all. Net
-- effect, empirically proven by DEV-32 QA with a real unelevated `kv_app` INSERT into
-- `ledger_entries` that SUCCEEDED (landed in a real partition, confirmed via
-- `tableoid::regclass`):
--   (a) `kv_relay` has held full INSERT/UPDATE/DELETE directly on the PARENT relations of
--       all 4 protected tables since migration 0018 — never narrowed by any later
--       migration (0076 only granted kv_relay role MEMBERSHIP in kv_wallet; it never
--       touched kv_relay's own pre-existing direct grants).
--   (b) `ledger_entries` is the ONLY one of the 4 that is `PARTITION BY RANGE (created_at)`
--       (wallet_accounts/ledger_transactions/reconciliation_runs are plain tables, grep-
--       verified against 0006_money.sql — a one-time REVOKE on those 3 fully closes the
--       gap for them, no ongoing partition exposure). Every `ledger_entries_YYYY_MM`
--       partition is a BRAND NEW relation at `CREATE TABLE ... PARTITION OF` time; Postgres
--       does NOT propagate a parent table's REVOKE to its partitions (this is the same
--       false assumption migration 0069's own header comment made about
--       `kcc_drawl_ledger` — "REVOKE on the partitioned parent applies to all its
--       partitions transparently" — it does not; kcc_drawl_ledger's existing partitions
--       carry the identical bug class, escalated below, NOT remediated by this migration).
--       Each new `ledger_entries` partition instead silently re-acquires the SCHEMA-WIDE
--       default-privilege grants above at creation time, independent of the parent's own
--       correctly-narrow ACL. This is exactly how `ensure_partitions()` (defined in 0014,
--       made SECURITY DEFINER by 0053, called HOURLY by the kv_relay worker per
--       `apps/worker/src/jobs/ensure-partitions.job.ts`, and again by
--       `db/scripts/ensure-partitions.js` at every deploy/CI apply) has been silently
--       re-opening every ledger_entries partition it creates, for every environment, since
--       migration 0014 first ran.
--
-- ── WHAT THIS MIGRATION DOES ─────────────────────────────────────────────────────────────
-- 1. Enumerates ledger_entries' existing partitions BY QUERY (pg_inherits walk — not a
--    hand-written list, which would go stale the moment ensure_partitions() next runs) and
--    REVOKEs the excess INSERT/UPDATE/DELETE from kv_app and kv_relay down to SELECT-only
--    for both (kv_app's existing SELECT is preserved — a genuine, in-use read path, not
--    part of the leak). Also re-asserts the parent's own ACL idempotently.
-- 2. REVOKEs kv_relay's excess ALL-privilege grant (from 0018) on the 3 non-partitioned
--    money tables (wallet_accounts, ledger_transactions, reconciliation_runs) down to
--    exactly its one proven legitimate need: INSERT on reconciliation_runs.
-- 3. Re-asserts kv_wallet's writer grants explicitly on every existing ledger_entries
--    partition (belt-and-suspenders alongside the parent-level grant 0014 already gave it).
-- 4. FUTURE-PROOFS `ensure_partitions()` itself (CREATE OR REPLACE PROCEDURE — a NEW
--    migration replacing a function body, not an edit to 0014's file; same precedent as
--    0053's own `ALTER PROCEDURE`): every new partition it creates now has its ACL
--    explicitly SYNCED FROM ITS PARENT TABLE'S OWN ACL, via a new helper procedure
--    `sync_partition_privileges(parent, child)`, instead of silently inheriting the
--    schema-wide default privileges. This is fully generic (no hardcoded table name), so
--    it ALSO closes the identical bug class in `kcc_drawl_ledger` (0069) going forward for
--    any partition created from now on — kcc_drawl_ledger's ALREADY-EXISTING partitions
--    are NOT remediated here (out of this migration's named scope: "revoke ledger/wallet
--    default-privilege writes" — escalated in dev35_report.md for a dedicated batch).
-- 5. Adds a DB-level append-only trigger on ledger_entries (Law 2, second half): until now,
--    append-only-ness was enforced ONLY by the absence of an UPDATE/DELETE grant to any
--    role (grep-confirmed: zero `CREATE TRIGGER` anywhere in db/migrations/ touches
--    ledger_entries/ledger_transactions/wallet_accounts/reconciliation_runs) — i.e. the
--    exact same fragile "grant-only, no backstop" mechanism that caused this P0 in the
--    first place. A `BEFORE UPDATE OR DELETE` trigger on the ledger_entries PARENT is
--    created; PostgreSQL clones row-level triggers defined on a partitioned parent onto
--    every EXISTING and FUTURE partition automatically (this is real, standard PG
--    behavior for declarative partitioning, distinct from privilege grants, which do NOT
--    auto-propagate — verified live in this migration's own probe suite against a
--    partition created AFTER 0077). This blocks EVERY role, including kv_wallet and
--    kv_admin — a ledger correction must be a NEW reversing entry, never a mutation (the
--    correct fintech pattern); disabling this trigger for a genuine emergency requires its
--    own founder-reviewed fix-forward migration per contract §8.
--
-- ── WHAT THIS MIGRATION DOES NOT DO (explicitly out of scope, escalated not silently
--    absorbed — see dev35_report.md §escalations for the full list) ─────────────────────
-- - Does NOT touch kv_app's SELECT on wallet_accounts/ledger_entries/ledger_transactions —
--   removing it would break 3 live read-models, confirmed by direct code read.
-- - Does NOT remediate kcc_drawl_ledger's EXISTING partitions (same bug class, 0069) — only
--   the ensure_partitions() future-proofing (item 4) is shared going forward.
-- - Does NOT add a real-time (per-transaction) net-zero DB constraint. Net-zero across a
--   ledger_transactions' entries is enforced ONLY by the app layer at write time
--   (LedgerRepository) plus an hourly ASYNC batch recon job
--   (apps/worker/src/jobs/recon-zero-sum.job.ts) — there is no synchronous DB-level
--   CHECK/CONSTRAINT TRIGGER rejecting a non-zero-sum transaction at commit time. This is a
--   real, true gap (reported, not silently narrowed); a correct DEFERRABLE CONSTRAINT
--   TRIGGER for it is a bigger, separate piece of engineering than this S-sized batch's
--   named scope ("... + DB-enforce Law 2" = append-only, not net-zero) — escalated as a
--   recommended follow-up batch.
-- - Does NOT change kv_wallet's own grant shape (already correctly INSERT-only, no
--   UPDATE/DELETE, per 0014) — the new trigger is additional defense-in-depth, not a
--   replacement for the existing grant-level narrowness.
--
-- Idempotent throughout (IF EXISTS guards, CREATE OR REPLACE, DROP TRIGGER IF EXISTS,
-- pg_inherits-driven loops that no-op on a table with zero matching children).
--
-- ── A SECOND, DEEPER ROOT CAUSE FOUND WHILE BUILDING THIS FIX (DEV-35, not in DEV-32's
--    original finding) — STEP 0 below ──────────────────────────────────────────────────
-- Migrations 0065 and 0076 grant kv_wallet MEMBERSHIP to kv_app/kv_relay via a BARE
-- `GRANT kv_wallet TO kv_app` / `GRANT kv_wallet TO kv_relay` (no `WITH INHERIT` clause).
-- PostgreSQL's default for a bare role-membership GRANT is `WITH INHERIT TRUE` — meaning
-- kv_app and kv_relay have been PASSIVELY exercising every one of kv_wallet's table
-- privileges AT ALL TIMES since 0065/0076 first ran, WITHOUT ever needing the
-- `SET LOCAL ROLE kv_wallet` elevation that `wallet.client.inprocess.ts` performs before
-- every ledger write. That elevation was NEVER actually gating write access — under a bare
-- INHERIT-true membership it only changes `CURRENT_USER` for audit/logging purposes, since
-- the privilege was already passively available the whole time. Empirically verified with a
-- standalone reproduction in this migration's own probe suite (a throwaway
-- test_wallet/test_app role pair): a bare `GRANT` allows an UNELEVATED insert to succeed;
-- `GRANT ... WITH INHERIT FALSE` correctly denies the unelevated attempt while `SET LOCAL
-- ROLE` elevation continues to work exactly as designed. Fixed forward here (STEP 0) by
-- re-granting the SAME EXISTING membership with the option switched — this updates the
-- grant's WITH INHERIT flag in place; it does not touch 0065/0076's own file content, and
-- does not require dropping or re-creating any role. Without this, STEPS 1-2's privilege
-- revokes on kv_app/kv_relay are INSUFFICIENT on their own — those roles would still
-- passively hold every kv_wallet privilege via inherited membership, undermining Law 2
-- regardless of the partition-privilege fix.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 0 — stop kv_app/kv_relay from PASSIVELY inheriting kv_wallet's privileges; they must
-- explicitly `SET LOCAL ROLE kv_wallet` to use them (the entire point of the elevation
-- pattern in wallet.client.inprocess.ts). Idempotent: re-granting an existing membership
-- with a different WITH INHERIT option updates that option in place.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_wallet')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_app') THEN
    EXECUTE 'GRANT kv_wallet TO kv_app WITH INHERIT FALSE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_wallet')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_relay') THEN
    EXECUTE 'GRANT kv_wallet TO kv_relay WITH INHERIT FALSE';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 1 — remediate every EXISTING ledger_entries partition (enumerated by query)
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE child record;
BEGIN
  FOR child IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent AND p.relname = 'ledger_entries'
    JOIN pg_class c ON c.oid = i.inhrelid
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM kv_app', child.relname);
    EXECUTE format('REVOKE ALL ON %I FROM kv_relay', child.relname);
    EXECUTE format('GRANT SELECT ON %I TO kv_app', child.relname);
    EXECUTE format('GRANT SELECT ON %I TO kv_relay', child.relname);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_wallet', child.relname);
  END LOOP;
END $$;

-- Parent relation itself: idempotent re-assertion (matches 0014's original intent exactly;
-- defensive re-statement so the parent and every partition are provably in the same state).
REVOKE INSERT, UPDATE, DELETE ON ledger_entries FROM kv_app;
REVOKE ALL ON ledger_entries FROM kv_relay;
GRANT SELECT ON ledger_entries TO kv_app;
GRANT SELECT ON ledger_entries TO kv_relay;                 -- recon-zero-sum.job.ts, unelevated
GRANT SELECT, INSERT ON ledger_entries TO kv_wallet;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 2 — the 3 non-partitioned money tables: one-time REVOKE fully closes the gap
-- ────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON wallet_accounts, ledger_transactions, reconciliation_runs FROM kv_relay;
GRANT INSERT ON reconciliation_runs TO kv_relay;             -- recon-zero-sum.job.ts + daily-gateway-recon.job.ts

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 3 — future-proof ensure_partitions(): sync each new partition's ACL from its
-- parent's OWN acl, instead of relying on schema-wide ALTER DEFAULT PRIVILEGES. Generic —
-- not keyed to any specific table name, so it protects any current or future partitioned
-- table whose parent has been deliberately narrowed (ledger_entries here; also
-- kcc_drawl_ledger going forward, see header note).
-- ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE sync_partition_privileges(p_parent text, p_child text) AS $$
DECLARE
  role_name text;
  roles text[] := ARRAY['kv_app', 'kv_wallet', 'kv_admin', 'kv_readonly', 'kv_ingest', 'kv_relay'];
  privs text[];
BEGIN
  FOREACH role_name IN ARRAY roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      SELECT array_agg(DISTINCT privilege_type) INTO privs
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = p_parent AND grantee = role_name;

      EXECUTE format('REVOKE ALL ON %I FROM %I', p_child, role_name);
      IF privs IS NOT NULL THEN
        EXECUTE format('GRANT %s ON %I TO %I', array_to_string(privs, ', '), p_child, role_name);
      END IF;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

ALTER PROCEDURE sync_partition_privileges(text, text) SECURITY DEFINER;
ALTER PROCEDURE sync_partition_privileges(text, text) SET search_path = public, pg_temp;

-- Replace ensure_partitions() (0014's body, made SECURITY DEFINER by 0053) to call the
-- sync helper immediately after creating each partition — this is the actual future-proof.
CREATE OR REPLACE PROCEDURE ensure_partitions(p_months_ahead int DEFAULT 3) AS $$
DECLARE r record; m date; part_name text; parent_bare text;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS tbl,
           (SELECT attname FROM pg_attribute
             WHERE attrelid = c.oid
               AND attnum = (SELECT unnest(partattrs) FROM pg_partitioned_table WHERE partrelid = c.oid LIMIT 1)) AS keycol
    FROM pg_class c
    JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace
  LOOP
    parent_bare := replace(r.tbl, 'public.', '');
    FOR i IN 0..(11 + p_months_ahead) LOOP
      m := (date_trunc('month', now()) + (i || ' months')::interval)::date;
      part_name := parent_bare || '_' || to_char(m, 'YYYY_MM');
      EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L);',
                     part_name, r.tbl, m, (m + interval '1 month')::date);
      CALL sync_partition_privileges(parent_bare, part_name);
    END LOOP;
    part_name := parent_bare || '_default';
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %s DEFAULT;',
                   part_name, r.tbl);
    CALL sync_partition_privileges(parent_bare, part_name);
  END LOOP;
END $$ LANGUAGE plpgsql;

ALTER PROCEDURE ensure_partitions(integer) SECURITY DEFINER;
ALTER PROCEDURE ensure_partitions(integer) SET search_path = public, pg_temp;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 4 — DB-ENFORCE LAW 2: ledger_entries is append-only (INSERT-only), for every role,
-- with no grant-based escape hatch. Clones automatically onto every existing + future
-- ledger_entries partition (real PG behavior for row-level triggers on a partitioned
-- parent — verified live in this migration's own probe suite).
-- ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_ledger_entries_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (Golden Law 2): % is not permitted on % (id=%)',
    TG_OP, TG_TABLE_NAME, COALESCE(OLD.id::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();
