-- ==================================================================================================================
-- MIGRATION 0232 — PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE — the two servicing figures 0231 could not
-- answer: the arrears buckets of this lender's own book, and the repayments RECORDED against it in a window. Two more
-- SECURITY DEFINER reads on the kv_partner axis, in 0231's shape; no new table, no new column, no new policy, no new
-- permission, no new flag, and not one rupee.
-- (brief_p4b.md founder decisions 4b-4 (Q9) + 4b-5 (Q10) + 4b-6 + 4b-7 (Q12), 2026-10-28; survey_partner4.md §1C W210,
-- §1D W211, §1I W218, F-1, F-3, F-5, F-8, F-22, F-24, P4-B2, §5.2, E8, E9, E10.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0231 are applied; nothing here edits them. 0090's
-- role `kv_partner`, its axis GUC `current_partner_id()` and its two RLS policies `partner_own_book_loans` /
-- `partner_own_book_loan_repayments` are REUSED UNCHANGED; 0231's definer shape, its column grants and its three-part
-- wall assert are the shapes this file follows, and 0231's permission `partner.loans.read` is REUSED — the figures
-- below are the same lender reading the same book.)
--
-- LAW 9 / LAW 11 CLASS — PII + TRUST, NOT MONEY: a cross-tenant read of farmers' loans and repayments by a lending
-- organisation, as COUNTS and bigint SUMS only. The PARTNER-0 founder review stands before `partner_console` is
-- switched on.
-- NOT MONEY: no ledger table, no wallet account, no posting, and NO MONEY COLUMN IS WRITTEN. Two money columns are
-- READ in the aggregate only — `loans.outstanding_minor` (SUM per arrears bucket) and
-- `loan_repayments.amount_paid_minor` (SUM over a window) — both as bigint minor units. Nothing here moves a rupee.
-- (The money PATH this wave does touch is the tenant plane's own disbursement run and wallet rail, in the
-- fixing/refusing direction, in this wave's FIRST COMMIT — not in this migration, which adds two read functions.)
--
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   232.1  partner_loan_dpd()  — THE ARREARS BUCKETS OF THIS LENDER'S OWN BOOK, as count + SUM(outstanding_minor) per
--          bucket over `status IN ('active','overdue')`: `1-30` / `31-60` / `61-90` / `90+` days past the recorded next
--          due date, plus TWO buckets the tenant plane's own query (FIN/repositories/servicing.repository.ts:18-26)
--          does not have and which are the honest answer today:
--            `not_due`      — a next due date is recorded and has not passed;
--            `no_due_date`  — NO next due date is recorded at all.
--          WHY THEY MATTER: every loan both disbursal rails open is created with `next_due_date` AND `maturity_date`
--          NULL (FIN/services/loan-application.service.ts:122), and there is no instalment schedule on this platform
--          (FIN/domain/loan-repayment.entity.ts:2-3) — so the four arrears buckets are STRUCTURALLY ZERO, and a
--          console that printed four zeros and stopped would be hiding the reason. `no_due_date` carries the count and
--          the outstanding sum of exactly the loans that cannot be bucketed, so the page can say WHY (founder 4b-7,
--          survey F-8). Every servicing loan lands in exactly one bucket; the six rows are exhaustive and disjoint.
--          THE DAY ARITHMETIC IS IST, NOT THE SERVER'S: `(now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_due_date`.
--          The tenant-plane query uses `CURRENT_DATE`, which is the DATABASE SESSION's timezone — a day earlier or
--          later for a farmer in Gujarat depending on how the connection happens to be configured. A lender's arrears
--          figure must not depend on that (survey E8; the day-early bug FIN/repositories/loan.repository.ts:10-11
--          records is the same family of mistake). Recorded as a deliberate difference, not a copy.
--          NO RATIO: no portfolio-at-risk rate, no share of the book, no percentage (founder 4b-7, survey E9).
--   232.2  partner_loan_collected(p_from date, p_to date) — count, SUM(amount_paid_minor) and the number of DISTINCT
--          loans of the repayments RECORDED against this lender's own book in [p_from, p_to) as IST calendar days
--          (0231's `partner_loan_counts` window shape). RECORDED, not DUE: a `loan_repayments` row is written AT
--          PAYMENT with `due_date` and `paid_at` both `now()` (FIN/services/loan.service.ts:51, :105), so "collected
--          in this window" is the only figure this platform can honestly answer, and the console prints that caveat.
--          The window is on `created_at`, which is also the PARTITION KEY (0011:131), so Postgres prunes (Law 8) —
--          and `created_at` is the same instant as `paid_at` for every row any code writes today, named rather than
--          assumed. NEVER `channel`: it says whose milk cheque was debited, 0231 revoked it from the axis, and no
--          figure here is grouped by it (survey F-5, F-24).
--          Ownership is 0090:155's two-independent-checks shape: an `EXISTS` over `loans` on `partner_id =
--          current_partner_id()`, itself evaluated under `partner_own_book_loans`.
--   232.3  THE ASSERTS (0231:275-328's three-part block, extended):
--            (a) kv_partner still holds NO column privilege on `loans.borrower_user_id`, `loans.created_by`,
--                `loans.updated_by`, `loans.origination_fee_txn_id` or `loan_repayments.channel`, and no table-wide
--                SELECT on either table — 0231's wall is re-asserted here because this file reads through it;
--            (b) kv_partner holds NOTHING AT ALL (no table privilege, no column privilege) on the EIGHT tables of
--                0231's list PLUS the two this wave's screens are ABOUT — so W210 and W218 can print counts and
--                sentences and nothing else: `bank_accounts`, `payouts`, `payout_batches`, `loan_disbursement_runs`,
--                `loan_disbursement_run_items`, `kcc_drawl_ledger`, `loan_restructures`, `credit_scores`,
--                `credit_score_consents`. (`payout_batches` is the one 0231 did not name.);
--            (c) `has_function_privilege('kv_app', …, 'EXECUTE')` is FALSE for both new definers — kv_app must wear
--                the axis role;
--            (d) NEW, and the reason it is here: a SOURCE assertion over `pg_get_functiondef` that ALL SIX partner
--                loan-book definers (0231's four and this file's two) still carry BOTH
--                `current_partner_id() IS NOT NULL` and `current_partner_id()` in their ownership predicate. The lead's
--                ruling on PARTNER-4a's surviving mutant M6 asked for exactly this: dropping the NULL guard changes no
--                behaviour (because `l.partner_id = NULL` is already NULL and returns no rows), so no behavioural test
--                can kill it — but the guard is what every `COMMENT ON FUNCTION` promises and what survives a future
--                NULL-tolerant rewrite. From this file on, removing it makes the MIGRATION fail on a from-empty build.
--
-- RLS: 0232 ADDS NO POLICY — the two policies it reads through already exist and are correct, so the RLS gate stays at
-- **1,988** (0231:101-103's figure, probe-confirmed at PARTNER-4a). Stated here because a reviewer will look, and
-- asserted in this wave's QA.
-- NO NEW PERMISSION: `partner.loans.read` (0231.2, held by all four partner roles and no role outside the realm)
-- covers these two reads — the same lender's own book, the same wall, the same audit rule (one row per read, counts
-- only). NO NEW FLAG and NO NEW EVENT (the relay gate stays 174/174). `fintech`, `partner_console` and `partner_api`
-- all stay OFF.
--
-- OWNER: like 0231's definers, these read `loans` and `loan_repayments` (FORCE RLS) as the MIGRATION OWNER — they
-- return rows only where that owner bypasses RLS (a superuser or BYPASSRLS owner, as on every database these
-- migrations have run on). The production owner's BYPASSRLS is the standing PARTNER-0 question, owed since then.
--
-- SHARDS: `loans` and `loan_repayments` carry a tenant_id and live on that tenant's shard, so both figures SCATTER
-- over the shards and are merged in the API (bigint sums added as BigInt, never as floats) — the 0231 shape.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT ADD
--   • no definer for W210's application pipeline. kv_partner ALREADY holds the four columns it needs on
--     `loan_applications` (0225:319 — `status`, `cooling_off_until`, `decision_at`, `created_at`) under 0225's
--     consent-gated policy `partner_own_book_loan_applications`, and the console already reads that table on the axis
--     (PCON/repositories/partner-console.repository.ts:387-389, the 30-day count). The pipeline counts are therefore a
--     direct read on the axis with `partner_owns_application(a.id)` repeated as defence in depth — no new function was
--     needed, and none was invented (brief §E: "if an existing read already answers it, use that and say so");
--   • no definer and no grant for `loan_disbursement_runs` / `loan_disbursement_run_items` / `payouts` /
--     `payout_batches`. W210's "Disburse ready batch" and W218's "Co-approve — disburse now" are DECOR, refused by
--     name (`PARTNER_CANNOT_DISBURSE`), and W218 is an HONEST PAGE with NO READ AT ALL: a lender is told whose money
--     moves and who signs, in counts and sentences. (c) and (b) above make that structural;
--   • no `next_due_date` backfill, no schedule table, no fee posting: P4-B8 / P4-B9 are a founder-signed money wave
--     (founder 4b-7 refuses every figure built on them by name).
--
-- REVERSAL (hand-run, never by the runner; revert the API's three new `partner/loans` reads and the console's
-- `/lender/disbursements`, `/lender/disbursements/[id]` and `/lender/repayments` pages first):
--   DROP FUNCTION IF EXISTS partner_loan_dpd(), partner_loan_collected(date, date);
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 232.1  THE ARREARS BUCKETS — counts and bigint sums, six disjoint buckets, and the honest reason four of them are 0
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_loan_dpd() RETURNS TABLE (
  bucket text, n bigint, outstanding_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN l.next_due_date IS NULL THEN 'no_due_date'
           WHEN l.next_due_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'not_due'
           WHEN ((now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_due_date) BETWEEN 1 AND 30 THEN '1-30'
           WHEN ((now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_due_date) BETWEEN 31 AND 60 THEN '31-60'
           WHEN ((now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_due_date) BETWEEN 61 AND 90 THEN '61-90'
           ELSE '90+'
         END AS bucket,
         count(*), COALESCE(sum(l.outstanding_minor), 0)
    FROM loans l
   WHERE current_partner_id() IS NOT NULL
     AND l.partner_id = current_partner_id()
     AND l.deleted_at IS NULL
     AND l.status IN ('active', 'overdue')
   GROUP BY 1;
$$;
REVOKE ALL ON FUNCTION partner_loan_dpd() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_dpd() TO kv_partner;
COMMENT ON FUNCTION partner_loan_dpd() IS
  'PC-56 PARTNER-4b (0232, founder 4b-7): the ARREARS BUCKETS of THIS lender''s own servicing book (status active or '
  'overdue) as count + SUM(outstanding_minor) — 1-30 / 31-60 / 61-90 / 90+ days past the recorded next due date, plus '
  '`not_due` and `no_due_date`. Six disjoint buckets, IST day arithmetic, no ratio and no percentage. Every loan this '
  'platform opens has next_due_date NULL, so the four arrears buckets are 0 and `no_due_date` says why. '
  'NULL-guarded: no partner in scope → no rows.';

-- ------------------------------------------------------------------------------------------------------------------
-- 232.2  WHAT WAS COLLECTED IN A WINDOW — recorded, never due; never the channel
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_loan_collected(p_from date, p_to date) RETURNS TABLE (
  n bigint, amount_paid_minor bigint, loans bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*), COALESCE(sum(r.amount_paid_minor), 0), count(DISTINCT r.loan_id)
    FROM loan_repayments r
   WHERE current_partner_id() IS NOT NULL
     AND p_from IS NOT NULL AND p_to IS NOT NULL
     AND r.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND r.created_at <  (p_to::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND EXISTS (SELECT 1 FROM loans l
                  WHERE l.id = r.loan_id AND l.partner_id = current_partner_id() AND l.deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION partner_loan_collected(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_collected(date, date) TO kv_partner;
COMMENT ON FUNCTION partner_loan_collected(date, date) IS
  'PC-56 PARTNER-4b (0232, founder 4b-7): the repayments RECORDED against THIS lender''s own book in [p_from, p_to) '
  '(IST calendar days) — count, bigint SUM(amount_paid_minor) and the number of distinct loans. RECORDED, never DUE: '
  'there is no instalment schedule on this platform. NEVER the channel. The window is on created_at, the partition '
  'key, so Postgres prunes. NULL-guarded: no partner in scope → no rows.';

-- ------------------------------------------------------------------------------------------------------------------
-- 232.3  THE WALL, RE-ASSERTED — 0231's columns, TEN forbidden tables, kv_app's lack of EXECUTE, and the NULL guard
--        asserted in the FUNCTION SOURCE (the lead's ruling on PARTNER-4a's surviving mutant M6)
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE col text; t text; fn text; src text;
BEGIN
  -- (a) 0231's five banned columns and the table-wide SELECT that would make the column grant pointless
  IF has_column_privilege('kv_partner', 'loans', 'borrower_user_id', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'created_by', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'updated_by', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'origination_fee_txn_id', 'SELECT') THEN
    RAISE EXCEPTION '0232: kv_partner can read a borrower''s identity or a fee anchor on loans — 0231''s narrowing was undone';
  END IF;
  IF has_column_privilege('kv_partner', 'loan_repayments', 'channel', 'SELECT') THEN
    RAISE EXCEPTION '0232: kv_partner can read loan_repayments.channel — the channel says whose milk cheque was debited';
  END IF;
  IF has_table_privilege('kv_partner', 'loans', 'SELECT') OR has_table_privilege('kv_partner', 'loan_repayments', 'SELECT') THEN
    RAISE EXCEPTION '0232: kv_partner holds a TABLE-wide SELECT again — the wall is the column grant, not the query';
  END IF;
  IF NOT has_column_privilege('kv_partner', 'loans', 'next_due_date', 'SELECT')
     OR NOT has_column_privilege('kv_partner', 'loan_repayments', 'amount_paid_minor', 'SELECT') THEN
    RAISE EXCEPTION '0232: the axis cannot read the two columns these figures are made of — the narrowing took too much';
  END IF;

  -- (b) nothing at all on the TEN tables this console never reaches (0231's eight + payout_batches, re-listed in full)
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'payouts', 'payout_batches', 'loan_disbursement_runs', 'loan_disbursement_run_items',
                           'kcc_drawl_ledger', 'loan_restructures', 'credit_scores', 'credit_score_consents'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0232: table % is missing — the forbidden-table assert cannot be made', t;
    END IF;
    IF has_table_privilege('kv_partner', t, 'SELECT') OR has_table_privilege('kv_partner', t, 'INSERT')
       OR has_table_privilege('kv_partner', t, 'UPDATE') OR has_table_privilege('kv_partner', t, 'DELETE') THEN
      RAISE EXCEPTION '0232: kv_partner holds a table privilege on % — a lender never reads the money queue or a farmer''s debt record', t;
    END IF;
    FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = t LOOP
      IF has_column_privilege('kv_partner', t, col, 'SELECT') THEN
        RAISE EXCEPTION '0232: kv_partner can read %.% — this console never reaches that table', t, col;
      END IF;
    END LOOP;
  END LOOP;

  -- (c) kv_app must wear the axis role to call a definer
  IF has_function_privilege('kv_app', 'partner_loan_dpd()', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_loan_collected(date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0232: kv_app can call a servicing-figure definer without wearing the axis role';
  END IF;

  -- (d) the NULL guard and the ownership predicate, asserted in the SOURCE of all SIX loan-book definers
  FOREACH fn IN ARRAY ARRAY['partner_loans(text, timestamptz, uuid, integer)', 'partner_loan(uuid)',
                            'partner_loan_repayments(uuid, integer)', 'partner_loan_counts(date, date)',
                            'partner_loan_dpd()', 'partner_loan_collected(date, date)'] LOOP
    src := pg_get_functiondef(fn::regprocedure);
    IF position('current_partner_id() IS NOT NULL' IN src) = 0 THEN
      RAISE EXCEPTION '0232: % lost its NULL guard — every COMMENT ON FUNCTION promises "no partner in scope → no rows"', fn;
    END IF;
    IF position('= current_partner_id()' IN src) = 0 THEN
      RAISE EXCEPTION '0232: % lost its ownership predicate — a lender would read another lender''s book', fn;
    END IF;
    -- pg_get_functiondef renders the clause as `SET search_path TO 'public', 'pg_temp'` (PG16) — matched on the
    -- parameter name only, so a future server's quoting cannot make this assert lie in either direction.
    IF position('SECURITY DEFINER' IN src) = 0 OR position('SET search_path TO' IN src) = 0 THEN
      RAISE EXCEPTION '0232: % is not a search_path-pinned SECURITY DEFINER any more', fn;
    END IF;
  END LOOP;
END $$;
