-- ==================================================================================================================
-- MIGRATION 0203 — PC-56 HOTFIX-3 · A PARTITION'S POLICY COPY NAMES THE CHILD, NOT THE PARENT
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0090 and 0190 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION (2026-10-13): "HOTFIX-3 first: migration 0203 repairs the 0190 partition-policy copy; CI structure/security
-- job fixed; committed-secret placeholders replaced."
--
-- WHAT WAS TRUE (the lead's diagnosis, reproduced on a from-empty `krishalaya_dev` and again by this batch):
--   `CALL ensure_partitions(3)` failed — every time, on every database built from the chain — with
--       ERROR:  missing FROM-clause entry for table "loan_repayments"
--       PL/pgSQL function sync_partition_rls(text,text) line 11 at EXECUTE
--   0190.13's `sync_partition_rls` copies a partitioned parent's policies onto a child as
--       CREATE POLICY … ON <child> USING (pg_get_expr(pol.polqual, <parent>))
--   and the deparsed text of 0090's `partner_own_book_loan_repayments` carries a TABLE-QUALIFIED self reference
--       … EXISTS ( SELECT 1 FROM loans l WHERE ((l.id = loan_repayments.loan_id) AND …))
--   which does not resolve on a relation named `loan_repayments_2026_10`. ensure_partitions runs as ONE statement, so the
--   failure on loan_repayments rolled back the whole call: no partition-runway top-up anywhere (db-migrate.yml's step and the
--   worker's hourly call both die), and no child of ANY partitioned parent received the parent's policy set that 0190 meant it to
--   carry (counted on krishalaya_dev before this file: 464 missing child copies across 24 parents — loan_repayments 32,
--   cold_chain_logs 80, and one tenant_isolation_<parent> copy per child on 22 others).
--   A pg_policy × pg_partitioned_table query shows `partner_own_book_loan_repayments` is TODAY the only self-qualified policy on
--   any partitioned parent — but the copy procedure is fixed generally, not for that one name.
--
-- WHY THE REWRITE IS SAFE. pg_get_expr prints a column of the policy's own relation as `<relname>.<col>` only when it must
-- disambiguate (inside a sub-select); every other range-table entry in the expression gets an alias or a de-duplicated refname
-- (`loan_repayments_1`), never the bare parent name. So a word-bounded `<parent>.` in the deparsed text is a reference to the
-- row being checked, and on the child that row is `<child>.`. Relation names come from pg_class (never from the text
-- parameters, which may be schema-qualified or quoted), are printed with quote_ident exactly as pg_get_expr prints them, and are
-- regex-escaped before they become a pattern.
--
-- WHAT THIS FILE DOES
--   203.1  CREATE OR REPLACE sync_partition_rls(text, text) — same signature, SECURITY DEFINER, search_path = public, pg_temp,
--          identical behaviour (ENABLE/FORCE copied from the parent, roles, PERMISSIVE/RESTRICTIVE, command, skip a policy name
--          the child already carries) EXCEPT the USING / WITH CHECK text has `<parent>.` rewritten to `<child>.`.
--          ensure_partitions (0190) and t12_resync_children (0190) call it by name and pick the fix up unchanged.
--   203.2  Re-sync every existing child of every partitioned parent in `public`, so children created before this fix (e.g.
--          loan_repayments_2026_10 …) receive the policies they are missing. Idempotent: the procedure skips a name the child
--          already carries, so a second run creates nothing.
--
-- NOT DONE HERE, ON PURPOSE
--   • No `CALL ensure_partitions(…)` — the partition runway depends on now(), and db-migrate.yml + the worker already call it; this
--     file stays deterministic.
--   • No GRANT / REVOKE — the privilege model (0077/0078 sync_partition_privileges) is untouched.
--   • Children's OWN pre-0190 policies (tenant_isolation_<child>) are left in place: the copies are added beside them, exactly as
--     0190's ensure_partitions would have done had it ever completed. Access through the parent is unchanged (Postgres applies the
--     parent's policies there); only direct access to a child gains the parent's set.
--
-- REVERSAL (documented, not automatic): re-apply 0190.13's body of sync_partition_rls; the copied child policies can be dropped by
-- name with the inverse of 203.2 (DROP POLICY <parent policy name> ON <child> for every child) — neither is ever needed to roll a
-- deploy back, since the old body cannot complete ensure_partitions at all.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 203.1  sync_partition_rls — 0190.13's body, with the self reference rewritten to the child
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sync_partition_rls(p_parent text, p_child text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE par regclass := p_parent::regclass; chi regclass := p_child::regclass; pol record; roles text;
        par_ident text; chi_ident text; self_ref text; chi_ref text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = par) THEN RETURN; END IF;
  -- The bare relation names, printed as pg_get_expr prints a refname (quoted only when they must be).
  SELECT quote_ident(relname) INTO par_ident FROM pg_class WHERE oid = par;
  SELECT quote_ident(relname) INTO chi_ident FROM pg_class WHERE oid = chi;
  -- `\m<parent>\.` for a plain name; a quoted name starts with `"`, which is not a word character, so it is bounded by a
  -- look-behind instead. The name is regex-escaped; the replacement escapes `\` (the only special character there).
  self_ref := CASE WHEN par_ident = (SELECT relname FROM pg_class WHERE oid = par) THEN '\m' ELSE '(?<![[:alnum:]_$"])' END
              || regexp_replace(par_ident, '([][^$.*+?(){}|\\])', '\\\1', 'g') || '\.';
  chi_ref := replace(chi_ident, '\', '\\') || '.';
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', chi);
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = par) THEN EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', chi); END IF;
  FOR pol IN SELECT * FROM pg_policy WHERE polrelid = par LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = chi AND polname = pol.polname) THEN
      SELECT CASE WHEN pol.polroles = '{0}'::oid[] THEN 'public' ELSE string_agg(quote_ident(rolname), ', ') END
        INTO roles FROM pg_roles WHERE oid = ANY (pol.polroles);
      EXECUTE format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s', pol.polname, chi,
        CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        COALESCE(roles, 'public'),
        CASE WHEN pol.polqual IS NOT NULL
             THEN ' USING (' || regexp_replace(pg_get_expr(pol.polqual, par), self_ref, chi_ref, 'g') || ')' ELSE '' END,
        CASE WHEN pol.polwithcheck IS NOT NULL
             THEN ' WITH CHECK (' || regexp_replace(pg_get_expr(pol.polwithcheck, par), self_ref, chi_ref, 'g') || ')' ELSE '' END);
    END IF;
  END LOOP;
END $$;

COMMENT ON PROCEDURE sync_partition_rls(text, text) IS
  'PC-56 TENANT-12 (0190) + HOTFIX-3 (0203): copies a partitioned parent''s ENABLE/FORCE RLS and every policy it carries onto one child (skipping a policy name the child already has). The USING / WITH CHECK text is pg_get_expr of the parent''s expression with every word-bounded `<parent relname>.` rewritten to `<child relname>.` (names from pg_class, quote_ident-printed, regex-escaped) — a table-qualified self reference such as 0090''s `loan_repayments.loan_id` otherwise fails on the child with "missing FROM-clause entry". Called by ensure_partitions and t12_resync_children.';

-- ------------------------------------------------------------------------------------------------------------------
-- 203.2  re-sync every existing child (idempotent — an existing policy name is skipped)
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.inhparent::regclass::text AS parent, i.inhrelid::regclass::text AS child
      FROM pg_partitioned_table pt
      JOIN pg_class p ON p.oid = pt.partrelid AND p.relnamespace = 'public'::regnamespace
      JOIN pg_inherits i ON i.inhparent = pt.partrelid
     ORDER BY 1, 2
  LOOP
    CALL sync_partition_rls(r.parent, r.child);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 203.3  QA FIX-FORWARD (lead's independent QA, 2026-10-13) — the SW-d setup-call trigger named the superuser by name.
-- 0200's assert_setup_call_moves() decided "admin realm" with `current_user IN ('kv_admin', 'postgres')`. The build
-- container's superuser happened to be called postgres, so every proof there passed; on the founder's Mac (superuser
-- `sanjayodedra`) and on any production DBA account the same statement is refused with [SETUP_CALL_NOT_YOURS] — the
-- HOTFIX-2 relay gate (apps/api/src/__tests__/relay-handlers-as-kv-relay.integration.spec.ts) was red at HEAD 2458617b
-- here for exactly that reason (its fixture inserts the request as the DB owner). A role name is not a realm: the realm
-- is kv_admin, or a superuser as PostgreSQL itself knows one (pg_roles.rolsuper). Law 5: 0200 is not edited; the function
-- is re-declared here, byte-equal to 0200's except the one DECLARE line marked below. Nothing else about the trigger moves.
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_setup_call_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);  -- HOTFIX-3 (0203): was IN ('kv_admin', 'postgres')
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[SETUP_CALL_APPEND_ONLY] a setup-call request is history — cancel it, never delete it — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' OR NEW.scheduled_at IS NOT NULL OR NEW.handled_by IS NOT NULL OR NEW.done_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION '[SETUP_CALL_BORN_REQUESTED] a setup-call request is born requested — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT realm AND (me IS NULL OR NEW.requested_by <> me) THEN
      RAISE EXCEPTION '[SETUP_CALL_NOT_YOURS] a setup call is requested in the requester''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- what was asked is fixed
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.requested_by <> OLD.requested_by OR NEW.preferred_slot_start <> OLD.preferred_slot_start
     OR NEW.preferred_slot_end <> OLD.preferred_slot_end OR NEW.language_code <> OLD.language_code OR NEW.phone_masked <> OLD.phone_masked
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[SETUP_CALL_FINAL] what a setup-call request asks for is fixed — cancel and request again — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('done', 'cancelled') AND (NEW.status <> OLD.status OR NEW.outcome_note IS DISTINCT FROM OLD.outcome_note OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION '[SETUP_CALL_CLOSED] this setup-call request is closed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.status IN ('scheduled', 'done') AND NOT realm THEN
      RAISE EXCEPTION '[SETUP_CALL_ADMIN_REALM] only the Krishalaya team schedules or closes a setup call — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
    END IF;
    IF NOT ((OLD.status = 'requested' AND NEW.status IN ('scheduled', 'cancelled'))
         OR (OLD.status = 'scheduled' AND NEW.status IN ('done', 'cancelled'))) THEN
      RAISE EXCEPTION '[SETUP_CALL_BAD_MOVE] % → % is not a setup-call move — PC-56 TENANT-SW-d', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelled' AND NOT realm AND (me IS NULL OR NEW.cancelled_by IS DISTINCT FROM me) THEN
      RAISE EXCEPTION '[SETUP_CALL_NOT_YOURS] a cancellation names the person cancelling, in their own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT realm AND (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.handled_by IS DISTINCT FROM OLD.handled_by) THEN
    RAISE EXCEPTION '[SETUP_CALL_ADMIN_REALM] only the Krishalaya team schedules a setup call — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
