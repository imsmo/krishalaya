-- ==================================================================================================================
-- MIGRATION 0231 — PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — FACTS, NEVER A BORROWER — a lending partner reads the LOAN FACTS on its
-- OWN book, on the kv_partner axis, through four SECURITY DEFINER reads; and 0090's last two FULL-TABLE grants are narrowed to column grants,
-- so the borrower's user id and the repayment channel leave the axis entirely.
-- (brief_p4a.md founder decisions 4a-2 (Q6) + 4a-3 (Q7) + 4a-4 (Q8) + 4a-5 (Q5) + 4a-7 (Q12), 2026-10-28; survey_partner4.md
-- "WHAT LENDING IS ON THE PLATFORM TODAY", §1A, §1B, §1E, §1F, F-5, F-10, C-12, C-13, P4-B1, P4-B3, §5.1, E1, E3, E8, E9.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0230 are applied; nothing here edits them. 0090's role `kv_partner`, its axis
-- GUC `current_partner_id()` and its two RLS policies `partner_own_book_loans` / `partner_own_book_loan_repayments` are REUSED UNCHANGED;
-- 0225's column-grant pattern on `loan_applications`, 0228's REVOKE-then-column-GRANT narrowing of `insurance_policies` and 0230's
-- bind-by-scope permission + three-part wall assert are the shapes this file follows.)
--
-- LAW 9 / LAW 11 CLASS — PII + TRUST, NOT MONEY: a cross-tenant read of farmers' loans by a lending organisation (loan facts only). The
-- PARTNER-0 founder review stands before `partner_console` is switched on.
-- NOT MONEY: no ledger table, no wallet account, no posting, and NO MONEY COLUMN IS WRITTEN. Every money column named here is READ, as bigint
-- minor units — `loans.principal_minor`, `loans.outstanding_minor`, `loan_repayments.amount_due_minor`,
-- `loan_repayments.amount_paid_minor` — and two more are READ in the aggregate only (SUM(outstanding_minor), SUM(principal_minor)).
-- `loans.origination_fee_txn_id` is the one money-adjacent column this file deliberately REVOKES: nothing writes it (the platform's fee leg is
-- deferred — survey F-8, founder 4a-5 refuses the fee by name), so a lender must not be handed a ledger anchor for a movement that never
-- happened. `loan_repayments` is append-only by trigger and grant (0079) and this file changes neither.
-- The lender funds nothing and is credited nothing: no `wallet_accounts` row can belong to a `financial_partner` (0006), and the partner realm
-- has no money route by construction. Nothing in PARTNER-4a moves a rupee.
--
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   231.1  0090:124-125 NARROWED (founder 4a-2 / Q6 — DONE FIRST, so the definers below are written against the narrowed axis):
--            `REVOKE SELECT ON loans FROM kv_partner` then a COLUMN grant of
--              id, application_id, tenant_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, maturity_date, status,
--              outstanding_minor, next_due_date, created_at, updated_at, deleted_at
--            — i.e. NEVER `borrower_user_id`, `created_by`, `updated_by`, `origination_fee_txn_id`. (`deleted_at` because the machine book
--            filters on it; `tenant_id` because the console resolves the FPO's PUBLIC name from it and never returns it.)
--            `REVOKE SELECT ON loan_repayments FROM kv_partner` then a COLUMN grant of
--              id, loan_id, tenant_id, due_date, amount_due_minor, amount_paid_minor, paid_at, created_at
--            — i.e. NEVER `channel`. (`loan_repayments` carries NO std columns at all — 0011:120-132: there is no `created_by`,
--            `updated_by`, `updated_at` or `deleted_at` on it to revoke. Named, not pretended.)
--          WHY: `milk_bill_deduction` is the only non-default `channel` any code writes (fintech/services/loan.service.ts), so the channel
--          alone told a lender that this borrower is a dairy member of a cooperative and that her milk cheque was debited — which W215's own
--          "Consent status (servicing)" block promises a lender does NOT see. And `loans` was the only full-table grant kv_partner still held
--          that carried a person (survey F-5, C-12, C-13). 0225 did this for `loan_applications` and 0228 for `insurance_policies`; `loans`
--          and `loan_repayments` were missed.
--          CONSEQUENCE, IN THE SAME COMMIT: `PAPI/repositories/partner-api.repository.ts` stops selecting `borrower_user_id` and `channel`,
--          or the machine realm's own SELECT becomes a 42501. `partner_api` is OFF at rollout_pct 0 with 0 keys, so no integrator is
--          affected — **but SEC §8's own warning applies again: the machine book's SHAPE HAS CHANGED and the S2 review must record it**
--          (the note is in the partner-api README).
--          `loan_repayments` IS PARTITIONED BY `created_at` (0011:131): a column grant on the PARENT covers reads through the parent (0090's
--          own note), and 231.4 asserts the grant on the parent AND spot-checks one live child so a direct read of a partition cannot
--          bypass the narrowing.
--   231.2  Permission `partner.loans.read` (M19) granted to EVERY role of scope 'partner' (bound BY SCOPE with 0230's pre-assert and two loud
--          asserts — the 0227.5 / 0228.1 / 0230.1 pattern and the tenant4d5-chain-repair rule: NEVER by role code, because seed
--          core/0004's `LIKE 'partner.%'` line would silently grant `partner_admin` alone and leave the other three roles short). Seed
--          core/0004 carries the same permission row (inserted where missing — the row is named explicitly there), so a database built from
--          empty and an existing one agree. A DISTINCT permission (survey E1): 2c reused `partner.applications.read` for the shelf because a
--          shelf is the partner's own configuration; a borrower's loan book is not, and a distinct permission lets it be narrowed later
--          without touching the queue.
--   231.3  FOUR READS ON THE AXIS (all `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`, NULL-guarded on
--          current_partner_id() BEFORE the ownership predicate, `AND l.deleted_at IS NULL`, REVOKE ALL FROM PUBLIC, EXECUTE to kv_partner
--          ONLY — kv_app reaches them only inside `SET LOCAL ROLE kv_partner`, 0090's non-inheriting grant):
--            partner_loans(status, cursor_created, cursor_id, limit)
--                this lender's own book, NEWEST FIRST, keyset on (created_at, id), limit 1–100, optional status filter (a `loan_status`
--                value; anything else matches nothing). A portfolio is read newest-first — the claims queue's oldest-first (0230) was about
--                how long a claim has WAITED, which does not apply to a disbursed loan;
--            partner_loan(id)                      ONE such loan (nothing for another lender's or an absent id);
--            partner_loan_repayments(loan_id, limit)
--                the repayments RECORDED against one owned loan, newest due date first, limit 1–200, bounded
--                `created_at >= now() - interval '5 years'` so Postgres prunes the partitions (Law 8, the
--                fintech/repositories/loan-repayment.repository.ts shape). Ownership is the 0090:155 two-independent-checks shape: an
--                `EXISTS` over `loans` which is ITSELF evaluated under `partner_own_book_loans`;
--            partner_loan_counts(from, to)
--                rows (kind_code, status, n, outstanding_minor, principal_minor) over the loans OPENED (`created_at`) in [from, to) — the two
--                dates are IST calendar days (`p_from::timestamp AT TIME ZONE 'Asia/Kolkata'`), the FY window the API asks for. COUNTS and
--                bigint SUMS, never a ratio and never a percentage (founder 4a-7 / survey E9).
--          THE OWNERSHIP JOIN (the three row reads): `loans l` WHERE `l.partner_id = current_partner_id()` — 0090's own axis, NOT 0225's
--          consent oracle. Note honestly what that means and what it does not: `partner_own_book_loans` gates a loan on `partner_id` ALONE,
--          with no consent requirement, so a lender's loan-level read is NOT consent-gated today (W212's "borrower-level drill-down stays
--          consent-gated even here" is FALSE and is refused by name in the console). What makes the read safe is the WALL — the columns.
--          THE PRODUCT JOIN (partner_loans / partner_loan / partner_loan_counts): `JOIN loan_applications a ON a.id = l.application_id JOIN
--          loan_products lp ON lp.id = a.product_id` (`loans.application_id` is NOT NULL UNIQUE, 0011:103, so the inner join drops nothing),
--          for the product's id, its own name and its `loan_kind` CODE. The code is resolved BY PRIMARY KEY
--          (`lookup_values.id = lp.product_kind_id AND type_code = 'loan_kind' AND tenant_id IS NULL`), so seed rules/0208's duplicated-
--          platform-value trap cannot make it ambiguous; an id that does not resolve answers NULL → the console prints "not recorded".
--          THE LOAN COLUMNS (list + detail): id, application_id (the application REFERENCE — there is no human-readable loan or application
--          number: `loan_applications.partner_app_ref` is never written), tenant_id (for the FPO's PUBLIC name only — the console never
--          prints or returns it), product_id, product_name, kind_code, principal_minor, interest_apr_bps (stamped at disbursal — the ONE
--          place a loan's terms are snapshotted), disbursed_at, maturity_date (NULL on every loan both rails open — survey F-8), status,
--          outstanding_minor, next_due_date (NULL likewise), created_at, updated_at.
--          NEVER borrower_user_id, created_by, updated_by, origination_fee_txn_id; never the repayment channel; never a bank account, a drawl
--          narrative, a milk-bill figure, a herd claim, a ledger transaction id, the application's purpose text or decision note.
--          NO definer for `kcc_drawl_ledger`, `loan_restructures`, `loan_disbursement_runs`, `loan_disbursement_run_items`, `credit_scores`
--          or `credit_score_consents`: founder 4a-4 refuses the credit score BY NAME in Phase 1, the KCC ledger is PARTNER-4c's door (Q4),
--          and the disbursement run is PARTNER-4b's (Q2 / Q3). 231.4 asserts kv_partner holds NOTHING on any of them, so a later wave cannot
--          widen them by accident.
--   231.4  THE ASSERTS (0230:171-188's three-part block, adapted to a table kv_partner legitimately reads):
--            (a) kv_partner holds NO column privilege on `loans.borrower_user_id`, `loans.created_by`, `loans.updated_by`,
--                `loans.origination_fee_txn_id` or `loan_repayments.channel` — a per-column loop, plus the explicit five;
--            (b) kv_partner holds NOTHING AT ALL (no table privilege, no column privilege) on `kcc_drawl_ledger`, `loan_restructures`,
--                `loan_disbursement_runs`, `loan_disbursement_run_items`, `credit_scores`, `credit_score_consents`, `bank_accounts`,
--                `payouts`;
--            (c) `has_function_privilege('kv_app', …, 'EXECUTE')` is FALSE for all four new definers — kv_app must wear the axis role.
--
-- RLS: the policies `partner_own_book_loans` (0090:146-147) and `partner_own_book_loan_repayments` (0090:153-155) already exist and are
-- correct — **0231 ADDS NO POLICY, so the RLS gate stays at 1,988** (0230:43's figure, probe-confirmed). Stated here because a reviewer will
-- look, and asserted in the wave's QA.
-- NO NEW FLAG (the 0229:31 precedent — a partner-console read adds none). `fintech`, `partner_console` and `partner_api` all stay OFF; the
-- partner realm deliberately does not consult the tenant-scoped `fintech` flag (PCON/services/partner-loan-products.service.ts:11-12,
-- survey F-20 / E5), so a lending console page prints the console's own switched-off sentence, never "lending is off".
--
-- OWNER: like 0228's and 0230's definers, these read `loans`, `loan_applications`, `loan_products`, `loan_repayments` and `lookup_values`
-- (FORCE RLS on the tenant-scoped ones) as the MIGRATION OWNER — they return rows only where that owner bypasses RLS (a superuser or
-- BYPASSRLS owner, as on every database these migrations have run on). The production owner's BYPASSRLS is the same standing question as
-- PARTNER-0's, owed since then.
--
-- SHARDS: `loans` and `loan_repayments` carry a tenant_id and live on that tenant's shard — the list and the counts SCATTER and merge in the
-- API (the 2a / 3a book shape); the detail and the repayments are searched shard by shard. `loan_products` and `lookup_values` are global
-- reference data (shard 0, replicated).
--
-- REVERSAL (hand-run, never by the runner; revert the API's `partner/loans` routes, the console's `/lender/*` pages and the machine book's
-- two SELECTs first):
--   DROP FUNCTION IF EXISTS partner_loans(text, timestamptz, uuid, integer), partner_loan(uuid),
--     partner_loan_repayments(uuid, integer), partner_loan_counts(date, date);
--   DELETE FROM role_permissions WHERE permission_code = 'partner.loans.read';
--   DELETE FROM permissions WHERE code = 'partner.loans.read';
--   REVOKE SELECT ON loans FROM kv_partner;           GRANT SELECT ON loans TO kv_partner;             -- (0090:124's table-wide grant back)
--   REVOKE SELECT ON loan_repayments FROM kv_partner;  GRANT SELECT ON loan_repayments TO kv_partner;  -- (0090:125's)
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 231.1  0090:124-125 NARROWED — kv_partner reads the LOAN FACTS columns only (founder 4a-2); the machine book changes with it
-- ------------------------------------------------------------------------------------------------------------------
REVOKE SELECT ON loans FROM kv_partner;
GRANT SELECT (id, application_id, tenant_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, maturity_date, status,
              outstanding_minor, next_due_date, created_at, updated_at, deleted_at)
  ON loans TO kv_partner;

REVOKE SELECT ON loan_repayments FROM kv_partner;
GRANT SELECT (id, loan_id, tenant_id, due_date, amount_due_minor, amount_paid_minor, paid_at, created_at)
  ON loan_repayments TO kv_partner;

-- ------------------------------------------------------------------------------------------------------------------
-- 231.2  THE PERMISSION — every partner role reads its lending organisation's own book (loan facts only)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('partner.loans.read', 'Partner console: read the loans on this lender''s own book — loan facts only, never a borrower', 'M19')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM roles WHERE scope = 'partner') < 4 THEN
    RAISE EXCEPTION '0231: the four partner roles of 0225 are missing — the loan book read would grant nothing';
  END IF;
END $$;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = 'partner.loans.read'
 WHERE r.scope = 'partner'
ON CONFLICT DO NOTHING;
DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.scope = 'partner' AND rp.permission_code = 'partner.loans.read') < 4 THEN
    RAISE EXCEPTION '0231: partner.loans.read is not held by every partner role';
  END IF;
  IF EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE r.scope <> 'partner' AND rp.permission_code = 'partner.loans.read') THEN
    RAISE EXCEPTION '0231: partner.loans.read is held by a role outside the partner realm';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 231.3  THE READS — the loan FACTS on this lender's own book; never a borrower, a channel, a narrative or a fee
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_loans(p_status text, p_cursor_created timestamptz, p_cursor_id uuid, p_limit integer) RETURNS TABLE (
  id uuid, application_id uuid, tenant_id uuid, product_id uuid, product_name text, kind_code text, principal_minor bigint,
  interest_apr_bps integer, disbursed_at date, maturity_date date, status text, outstanding_minor bigint, next_due_date date,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.application_id, l.tenant_id, lp.id, lp.default_name::text,
         (SELECT lv.code::text FROM lookup_values lv
           WHERE lv.id = lp.product_kind_id AND lv.type_code = 'loan_kind' AND lv.tenant_id IS NULL),
         l.principal_minor, l.interest_apr_bps, l.disbursed_at, l.maturity_date, l.status::text, l.outstanding_minor, l.next_due_date,
         l.created_at, l.updated_at
    FROM loans l
    JOIN loan_applications a ON a.id = l.application_id
    JOIN loan_products lp ON lp.id = a.product_id
   WHERE current_partner_id() IS NOT NULL
     AND l.partner_id = current_partner_id()
     AND l.deleted_at IS NULL
     AND (p_status IS NULL OR l.status::text = p_status)
     AND (p_cursor_created IS NULL OR (l.created_at, l.id) < (p_cursor_created, p_cursor_id))
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;
REVOKE ALL ON FUNCTION partner_loans(text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loans(text, timestamptz, uuid, integer) TO kv_partner;
COMMENT ON FUNCTION partner_loans(text, timestamptz, uuid, integer) IS
  'PC-56 PARTNER-4a (0231, founder 4a-2): the loans on THIS lender''s own book, NEWEST first, keyset (created_at, id), 1–100 rows — loan '
  'FACTS only: never borrower_user_id, created_by, updated_by, origination_fee_txn_id. NULL-guarded: no partner in scope → no rows.';

CREATE OR REPLACE FUNCTION partner_loan(p_id uuid) RETURNS TABLE (
  id uuid, application_id uuid, tenant_id uuid, product_id uuid, product_name text, kind_code text, principal_minor bigint,
  interest_apr_bps integer, disbursed_at date, maturity_date date, status text, outstanding_minor bigint, next_due_date date,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.application_id, l.tenant_id, lp.id, lp.default_name::text,
         (SELECT lv.code::text FROM lookup_values lv
           WHERE lv.id = lp.product_kind_id AND lv.type_code = 'loan_kind' AND lv.tenant_id IS NULL),
         l.principal_minor, l.interest_apr_bps, l.disbursed_at, l.maturity_date, l.status::text, l.outstanding_minor, l.next_due_date,
         l.created_at, l.updated_at
    FROM loans l
    JOIN loan_applications a ON a.id = l.application_id
    JOIN loan_products lp ON lp.id = a.product_id
   WHERE l.id = p_id
     AND current_partner_id() IS NOT NULL
     AND l.partner_id = current_partner_id()
     AND l.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION partner_loan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan(uuid) TO kv_partner;
COMMENT ON FUNCTION partner_loan(uuid) IS
  'PC-56 PARTNER-4a (0231, founder 4a-2): ONE loan on THIS lender''s own book (nothing for another lender''s or an absent id) — the same loan '
  'facts as partner_loans, never a borrower. NULL-guarded: no partner in scope → no rows.';

-- The repayments RECORDED against one owned loan. There is NO SCHEDULE on this platform: a `loan_repayments` row is created AT PAYMENT with
-- `due_date = now()` (fintech/services/loan.service.ts), and every loan is opened with `next_due_date` and `maturity_date` NULL — so this is a
-- history, never a plan, and nothing here can be called "on time" (founder 4a-5 refuses the schedule and every on-time figure BY NAME).
-- The 5-year bound is Law 8: `loan_repayments` is partitioned by `created_at`, and without it Postgres scans every partition.
CREATE OR REPLACE FUNCTION partner_loan_repayments(p_loan_id uuid, p_limit integer) RETURNS TABLE (
  id uuid, loan_id uuid, due_date date, amount_due_minor bigint, amount_paid_minor bigint, paid_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.loan_id, r.due_date, r.amount_due_minor, r.amount_paid_minor, r.paid_at, r.created_at
    FROM loan_repayments r
   WHERE current_partner_id() IS NOT NULL
     AND p_loan_id IS NOT NULL
     AND r.loan_id = p_loan_id
     AND r.created_at >= now() - interval '5 years'
     AND EXISTS (SELECT 1 FROM loans l
                  WHERE l.id = r.loan_id AND l.partner_id = current_partner_id() AND l.deleted_at IS NULL)
   ORDER BY r.due_date DESC, r.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;
REVOKE ALL ON FUNCTION partner_loan_repayments(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_repayments(uuid, integer) TO kv_partner;
COMMENT ON FUNCTION partner_loan_repayments(uuid, integer) IS
  'PC-56 PARTNER-4a (0231, founder 4a-2): the repayments RECORDED against ONE loan of THIS lender''s own book — due date, both amounts, paid '
  'at. NEVER the channel (it says whose milk cheque was debited). A history, not a schedule; 5-year bound prunes the partitions. '
  'NULL-guarded: no partner in scope → no rows.';

-- The portfolio's figures: COUNTS and bigint SUMS over the loans OPENED in an IST window, per platform `loan_kind` code × `loan_status`.
-- No ratio, no percentage, no average, no PAR (founder 4a-5 / 4a-7, survey E9): a rate over a book whose due dates are all NULL would be a lie
-- either way, and the console prints the two figures a ratio is made of or refuses the figure by name.
CREATE OR REPLACE FUNCTION partner_loan_counts(p_from date, p_to date) RETURNS TABLE (
  kind_code text, status text, n bigint, outstanding_minor bigint, principal_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT lv.code::text FROM lookup_values lv
           WHERE lv.id = lp.product_kind_id AND lv.type_code = 'loan_kind' AND lv.tenant_id IS NULL) AS kind_code,
         l.status::text, count(*), COALESCE(sum(l.outstanding_minor), 0), COALESCE(sum(l.principal_minor), 0)
    FROM loans l
    JOIN loan_applications a ON a.id = l.application_id
    JOIN loan_products lp ON lp.id = a.product_id
   WHERE current_partner_id() IS NOT NULL
     AND l.partner_id = current_partner_id()
     AND l.deleted_at IS NULL
     AND p_from IS NOT NULL AND p_to IS NOT NULL
     AND l.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND l.created_at <  (p_to::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY 1, l.status;
$$;
REVOKE ALL ON FUNCTION partner_loan_counts(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_counts(date, date) TO kv_partner;
COMMENT ON FUNCTION partner_loan_counts(date, date) IS
  'PC-56 PARTNER-4a (0231): COUNTS and bigint SUMS of the loans on THIS lender''s own book OPENED in [p_from, p_to) (IST calendar days), by '
  'platform loan_kind code (NULL = not recorded) × loan_status. Counts and sums only — no ratio, no percentage, no PAR. Shards add (a loan '
  'lives on one shard). NULL-guarded: no partner in scope → no rows.';

-- ------------------------------------------------------------------------------------------------------------------
-- 231.4  THE WALL, ASSERTED — the five banned columns, the eight forbidden tables, and kv_app's lack of EXECUTE
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE col text; t text; child text;
BEGIN
  -- (a) the five banned columns, named explicitly …
  IF has_column_privilege('kv_partner', 'loans', 'borrower_user_id', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'created_by', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'updated_by', 'SELECT')
     OR has_column_privilege('kv_partner', 'loans', 'origination_fee_txn_id', 'SELECT') THEN
    RAISE EXCEPTION '0231: kv_partner can still read a borrower''s identity or a fee anchor on loans';
  END IF;
  IF has_column_privilege('kv_partner', 'loan_repayments', 'channel', 'SELECT') THEN
    RAISE EXCEPTION '0231: kv_partner can still read loan_repayments.channel — the channel says whose milk cheque was debited';
  END IF;
  -- … and the whole-table privilege that would make the column grant pointless (a `SELECT *` must fail)
  IF has_table_privilege('kv_partner', 'loans', 'SELECT') OR has_table_privilege('kv_partner', 'loan_repayments', 'SELECT') THEN
    RAISE EXCEPTION '0231: kv_partner holds a TABLE-wide SELECT again — the wall is the column grant, not the query';
  END IF;
  -- the grant is asserted on the PARTITIONED PARENT (reads go through it) and spot-checked on one live child, so a direct read of a
  -- partition cannot bypass the narrowing
  IF NOT has_column_privilege('kv_partner', 'loan_repayments', 'amount_paid_minor', 'SELECT') THEN
    RAISE EXCEPTION '0231: kv_partner cannot read loan_repayments.amount_paid_minor on the parent — the narrowing took too much';
  END IF;
  SELECT c.relname INTO child
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
   WHERE p.relname = 'loan_repayments' ORDER BY c.relname LIMIT 1;
  IF child IS NOT NULL AND has_column_privilege('kv_partner', child, 'channel', 'SELECT') THEN
    RAISE EXCEPTION '0231: kv_partner can read %.channel directly — a partition must not bypass the parent''s narrowing', child;
  END IF;
  -- (b) nothing at all on the eight tables this console never reaches
  FOREACH t IN ARRAY ARRAY['kcc_drawl_ledger', 'loan_restructures', 'loan_disbursement_runs', 'loan_disbursement_run_items',
                           'credit_scores', 'credit_score_consents', 'bank_accounts', 'payouts'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0231: table % is missing — the forbidden-table assert cannot be made', t;
    END IF;
    IF has_table_privilege('kv_partner', t, 'SELECT') OR has_table_privilege('kv_partner', t, 'INSERT')
       OR has_table_privilege('kv_partner', t, 'UPDATE') OR has_table_privilege('kv_partner', t, 'DELETE') THEN
      RAISE EXCEPTION '0231: kv_partner holds a table privilege on % — this console never reaches it', t;
    END IF;
    FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = t LOOP
      IF has_column_privilege('kv_partner', t, col, 'SELECT') THEN
        RAISE EXCEPTION '0231: kv_partner can read %.% — this console never reaches that table', t, col;
      END IF;
    END LOOP;
  END LOOP;
  -- (c) kv_app must wear the axis role to call a definer
  IF has_function_privilege('kv_app', 'partner_loans(text, timestamptz, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_loan(uuid)', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_loan_repayments(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_loan_counts(date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0231: kv_app can call a loan-book definer without wearing the axis role';
  END IF;
END $$;
