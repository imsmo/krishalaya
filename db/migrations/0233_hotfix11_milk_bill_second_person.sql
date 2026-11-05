-- ==================================================================================================================
-- MIGRATION 0233 — PC-56 HOTFIX-11 · A SECOND PERSON ON EVERY MILK BILL — the bill learns WHO showed it to the
-- member, WHO approved it and WHO paid it, and the database refuses a row on which the approver is the previewer or the
-- payer is the approver. Five columns, five CHECKs, five comments; no grant, no policy, no flag, no backfill.
-- (Founder decisions H11-1 … H11-5, 2026-11-06, answered by the founder himself: `wave_ops1a_report.md` §0.b doors
-- (a)+(b); `survey_hotfix11.md` Q1-A (every bill, whichever way it was approved), Q2-A (two people suffice: A previews,
-- B approves, A pays), Q3-A (no one-person exception, no amount threshold), Q4-A (a disputed bill is not approvable),
-- Q5-A (whoever rejects an objection becomes the bill's previewer); survey §3 option A, §4, §6 E-1/E-2/E-3.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0232 are applied; nothing here edits them. 0158's
-- `previewed_at`, `ck_milk_bill_void_stamp` and `ck_milk_bill_preview_window`, and 0159's NULL-tolerant
-- maker-checker CHECK on `dairy_bill_cycles` (0159:84-87), are REUSED UNCHANGED; the last is the shape copied below.)
--
-- CLASS — MONEY PATH (Law 9 / KRISHALAYA_DEV_CONTRACT.md §8 "a payment code path … always founder-reviewed before
-- merge"): this file moves NO rupee; it decides WHO MAY. No ledger table, no wallet account, no posting and no money
-- column is touched, so no CODEOWNERS ledger review is triggered (krishalaya/CLAUDE.md Law 9). The founder's Law 9
-- review of every line stands before merge, in the REFUSING direction only.
--
-- ==================================================================================================================
--
-- WHY. Until this file a milk bill could not say who acted on it (survey C-1): it carried `previewed_at` (0158) and
-- `voided_by` (0158), and `updated_by` was never written. So nothing could stop ONE administrator previewing,
-- approving and paying a farmer's fortnight by himself over the per-bill routes (pinned live as "the open door" by
-- OPS-1a), and the cycle's second signature (0159) never reached the money — the cycle's checker could pay the very
-- bills he approved, and a re-press of approve by the cycle's previewer approved late bills as him (survey C-4).
--
-- WHAT EXISTS AFTER THIS FILE
--   233.1  milk_bills.previewed_by uuid → users(id) — the person who showed the bill to its member (MilkBill.preview),
--          or who answered the member's objection and showed it again (MilkBill.resolveToPreviewed, founder Q5-A).
--   233.2  milk_bills.approved_at timestamptz + milk_bills.approved_by uuid → users(id) — the second person.
--   233.3  milk_bills.paid_at timestamptz + milk_bills.paid_by uuid → users(id) — whoever moved the money. `paid_at` is
--          also the payment instant 0168:48-58 said this table lacked; insights do NOT start reading it in this file
--          (survey E-9, named out of scope).
--   233.4  ck_milk_bill_approve_stamp        (approved_at IS NULL) = (approved_by IS NULL)
--          ck_milk_bill_paid_stamp           (paid_at IS NULL) = (paid_by IS NULL)
--          ck_milk_bill_preview_by_needs_at  previewed_by IS NULL OR previewed_at IS NOT NULL
--          — the stamp pairs, in 0159's shape. The third is ONE-directional on purpose: a bill previewed before this
--          file has `previewed_at` and no `previewed_by`, and a two-way equality would fail on any database that holds
--          one.
--   233.5  THE RULE AS A ROW FACT, in 0159:84-87's NULL-tolerant shape:
--          ck_milk_bill_approver_ne_previewer  approved_by IS NULL OR previewed_by IS NULL OR approved_by <> previewed_by
--          ck_milk_bill_payer_ne_approver      paid_by IS NULL OR approved_by IS NULL OR paid_by <> approved_by
--          The DOMAIN is stricter than these (survey E-2): `MilkBill.approve` refuses a bill with no `previewed_by`
--          (DAIRY_BILL_PREVIEWER_UNKNOWN) and `MilkBill.assertPayer` refuses one with no `approved_by`
--          (DAIRY_BILL_APPROVER_UNKNOWN), because an unknown signer is not a second person. The CHECKs tolerate NULL
--          so that rows written before this file, and fixtures that INSERT a bill with a status and no stamps, still
--          load. The aggregate gives the operator a readable 409; the CHECK makes the rule true of the ROW whatever
--          wrote it — a hand-run UPDATE during an incident, a future job, a bug (0159:80-83's reasoning).
--   233.6  COMMENT ON COLUMN for each, naming the founder decision — and correcting, in prose, the false claim in
--          `milk-bill-dispute.service.ts` that a disputed bill was "therefore unpayable" (survey C-3): before this
--          hotfix `disputed → approved` was a legal transition and the bill was payable once the window shut. From
--          HOTFIX-11 an approval of a disputed bill is refused by name (DAIRY_BILL_DISPUTE_UNANSWERED) — founder Q4-A.
--
-- NO GRANT: kv_app already holds TABLE-level INSERT + UPDATE on milk_bills (0079:204-212), which covers new columns;
-- 0158:148-152 deliberately wrote no column grant and neither does this file (the live spec asserts no column ACL).
-- NO POLICY: adding columns needs no RLS change, so the RLS gate count is UNCHANGED (asserted in this wave's QA).
-- NO FLAG (Law 10 reasoning, the HOTFIX precedents): a refusal on a money path is not a feature, and a kill-switch on it
-- would be a switch that re-opens the door.
-- NO BACKFILL: there is no production database (founder, 2026-11-05, PPC §4). An unstamped legacy bill is refused at
-- approve / pay by the domain until a person previews / approves it again — fail closed, nothing stranded today.
-- NOTHING ON THE PARTNER AXIS (kv_partner, current_partner_id(), the partner definers) is touched.
--
-- OWNER: plain DDL on a tenant table; nothing here runs as a definer.
--
-- SHARDS: milk_bills carries tenant_id and lives on that tenant's shard; the columns and CHECKs are per-row facts, so
-- every shard runs this file unchanged and no cross-shard read exists.
--
-- REVERSAL (hand-run, never by the runner; revert the API's HOTFIX-11 code in modules/dairy FIRST — the service reads
-- and writes these columns):
--   ALTER TABLE milk_bills
--     DROP CONSTRAINT IF EXISTS ck_milk_bill_payer_ne_approver,
--     DROP CONSTRAINT IF EXISTS ck_milk_bill_approver_ne_previewer,
--     DROP CONSTRAINT IF EXISTS ck_milk_bill_preview_by_needs_at,
--     DROP CONSTRAINT IF EXISTS ck_milk_bill_paid_stamp,
--     DROP CONSTRAINT IF EXISTS ck_milk_bill_approve_stamp,
--     DROP COLUMN IF EXISTS paid_by, DROP COLUMN IF EXISTS paid_at,
--     DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS previewed_by;
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 233.1–233.3  THE THREE SIGNERS AND THEIR INSTANTS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_bills
  ADD COLUMN IF NOT EXISTS previewed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS paid_at      timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by      uuid REFERENCES users(id);

-- ------------------------------------------------------------------------------------------------------------------
-- 233.4  THE STAMP PAIRS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_approve_stamp;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_approve_stamp
  CHECK ((approved_at IS NULL) = (approved_by IS NULL));

ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_paid_stamp;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_paid_stamp
  CHECK ((paid_at IS NULL) = (paid_by IS NULL));

ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_preview_by_needs_at;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_preview_by_needs_at
  CHECK (previewed_by IS NULL OR previewed_at IS NOT NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 233.5  THE RULE, IN THE DATABASE (founder H11-1: approver ≠ previewer, payer ≠ approver; two people suffice)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_approver_ne_previewer;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_approver_ne_previewer
  CHECK (approved_by IS NULL OR previewed_by IS NULL OR approved_by <> previewed_by);

ALTER TABLE milk_bills DROP CONSTRAINT IF EXISTS ck_milk_bill_payer_ne_approver;
ALTER TABLE milk_bills ADD CONSTRAINT ck_milk_bill_payer_ne_approver
  CHECK (paid_by IS NULL OR approved_by IS NULL OR paid_by <> approved_by);

-- ------------------------------------------------------------------------------------------------------------------
-- 233.6  WHAT EACH COLUMN MEANS
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON COLUMN milk_bills.previewed_by IS
  'PC-56 HOTFIX-11 (0233, founder H11-1 + Q5-A, 2026-11-06): the person who showed this bill to its member - by '
  'MilkBill.preview (one bill, or the cycle preview pass as whoever pressed it), or by MilkBill.resolveToPreviewed when '
  'a member''s objection was REJECTED and the bill shown again (the person who answered becomes the previewer, so a '
  'different person must approve it). NULL on a bill never previewed, and on bills previewed before 0233; the domain '
  'refuses to approve a bill whose previewer is unknown (DAIRY_BILL_PREVIEWER_UNKNOWN).';
COMMENT ON COLUMN milk_bills.approved_at IS
  'PC-56 HOTFIX-11 (0233): when the second person approved this bill. Paired with approved_by (ck_milk_bill_approve_stamp).';
COMMENT ON COLUMN milk_bills.approved_by IS
  'PC-56 HOTFIX-11 (0233, founder H11-1/H11-2, Q1-A + Q3-A, 2026-11-06): the SECOND person. Must differ from '
  'previewed_by (ck_milk_bill_approver_ne_previewer) on EVERY bill, whichever way it was approved - the per-bill route '
  'and the cycle approve''s per-bill pass alike - with no one-person-cooperative exception and no amount threshold. '
  'Never the ''system'' sentinel. A DISPUTED bill is not approvable (founder Q4-A, DAIRY_BILL_DISPUTE_UNANSWERED): '
  'before HOTFIX-11 disputed -> approved was a legal transition and such a bill became payable once its window shut, so '
  'milk-bill-dispute.service.ts''s "a disputed bill is therefore unpayable" was false; from 0233 it is true.';
COMMENT ON COLUMN milk_bills.paid_at IS
  'PC-56 HOTFIX-11 (0233): the instant MilkBillService.pay moved this bill''s money (the `now` it was given). Paired with '
  'paid_by (ck_milk_bill_paid_stamp). Also the payment term 0168 said this table lacked; insights do not read it yet.';
COMMENT ON COLUMN milk_bills.paid_by IS
  'PC-56 HOTFIX-11 (0233, founder H11-1 + Q2-A, 2026-11-06): whoever paid this bill. Must differ from approved_by '
  '(ck_milk_bill_payer_ne_approver); may be the previewer - two people suffice, because paying cannot change the amount '
  'the second person approved. The service refuses DAIRY_BILL_PAYER_IS_APPROVER before any wallet posting.';
