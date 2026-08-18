-- ============================================================================
-- MIGRATION 0111 — THE MANUAL CORRECTION: A DRAFT A CHECKER CAN SEE, AND A ZERO-SUM THE DATABASE ENFORCES
-- (PC-56 ADMIN-5e — W068, the scariest screen on the platform)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- FIRST, A CORRECTION TO THE ADMIN-5 VERDICT ON THIS SCREEN
-- ---------------------------------------------------------------------------
-- PC56_TRACKER recorded W068 as "GAP-BACKEND — NO BACKING SCHEMA EXISTS ANYWHERE". That was true of the word
-- `correction` and false about the machinery. Verifying properly found that most of what W068 needs was built for
-- other reasons and is sitting there unused:
--   • `recon_investigations` (0033) IS the case W068 starts from — "corrections start from an investigation case,
--     never from a blank ledger write" is already the shape of the data.
--   • `WalletAdminPort.post()` (ADMIN-1b) already posts a balanced, signed, multi-leg, idempotent transaction
--     through the wallet-service, which is the platform's ONLY money writer.
--   • `ledger_transactions.idempotency_key` is already `varchar(120) UNIQUE`, so W068's "re-posting with this key
--     is a no-op" is already true of the ledger.
--   • `apps/wallet-service/.../post-transaction.service.ts:83` already HARD-FAILS an unbalanced post
--     (`LedgerNotBalancedError`). Zero-sum is not merely job-verified on the write path; the sole writer refuses.
-- What is genuinely missing is smaller and more specific than "everything", and naming it wrongly nearly cost this
-- wave a rebuild of things that exist.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ACTUALLY MISSING, AND WHY EACH PIECE MATTERS
-- ---------------------------------------------------------------------------
-- 1. THERE IS NOWHERE TO PUT A DRAFT. W068 is a four-step flow — evidence, draft legs, checker approval, posted —
--    and the third step is the control: "Checker sees evidence trail + legs side by side; approval posts txn type
--    `correction` and closes the case atomically." A checker cannot review legs that exist only in somebody's
--    browser. Without a stored draft the screen collapses into a single operator typing amounts into a form that
--    posts immediately, which is the exact thing a maker-checker exists to prevent.
--
-- 2. `correction` IS NOT A LEDGER TXN TYPE. `ledger_transactions.txn_type_id` is an FK to `lookup_values` and the
--    `ledger_txn_type` vocabulary seeds 30-odd codes — order_payment, escrow_hold, commission, refund, payout and
--    the rest — and NOT `correction`. A post typed `correction` today fails the foreign key. The screen names the
--    type in its own body text; the vocabulary never got the row.
--
-- 3. THE ZERO-SUM IS NOT A DATABASE FACT. 0077's own header says it plainly: "there is no synchronous DB-level
--    CHECK/CONSTRAINT TRIGGER rejecting a non-zero-sum transaction at commit time" — the guarantee is the hourly
--    `recon-zero-sum.job.ts` plus the wallet-service's refusal. That is fine for machine-generated postings, which
--    are balanced by construction. IT IS NOT FINE FOR A HUMAN TYPING AMOUNTS AT 02:14. W068 says "the form will not
--    submit unbalanced", and a form is the weakest place on the platform to keep that promise.
--
--    So the draft gets what the ledger does not have: a DEFERRED CONSTRAINT TRIGGER that sums the legs at COMMIT and
--    refuses the transaction. It is cheap here and expensive on `ledger_entries` — a draft has two to six legs and
--    the ledger has millions — and this is the one table where a human, not a machine, decides the numbers.
--
-- 4. THE EIGHTH MAKER-CHECKER SITE, and the canon names both halves: "Drafting needs `ledger.investigate`; posting
--    needs a DIFFERENT user with `ledger.correct`." Neither permission exists anywhere in the codebase.
-- ============================================================================


-- The parent vocabulary this insert needs (`lookup_types` / `languages` / `integration_providers`) is
-- guaranteed by **0056a_reference_data_the_chain_depends_on.sql**, which exists because
-- `db/prod/apply.sh` runs migrate BEFORE seed and this statement's parent rows live in `db/seeds/core/`.
-- Read 0056a's header for the full finding: the chain halted at 0057 and migrations 0057-0149 had never
-- applied to any database. Not repeated per file, deliberately — one authority, one explanation.

-- ---------------------------------------------------------------------------
-- 1. `correction` JOINS THE LEDGER VOCABULARY
-- ---------------------------------------------------------------------------
-- Platform-scoped (tenant_id NULL) like every other ledger txn type. ON CONFLICT DO NOTHING so a box that already
-- has it by hand is not an error.
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
VALUES ('ledger_txn_type', NULL, 'correction', 'Manual correction', '{}', 90)
ON CONFLICT (type_code, tenant_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. THE DRAFT
-- ---------------------------------------------------------------------------
CREATE TABLE correction_drafts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- "Corrections start from an investigation case — never from a blank ledger write." The FK is the rule.
  investigation_id  uuid NOT NULL REFERENCES recon_investigations(id),
  tenant_id         uuid,
  status            varchar(20) NOT NULL DEFAULT 'drafting'
                      CHECK (status IN ('drafting', 'awaiting_checker', 'posted', 'rejected', 'withdrawn')),
  currency_code     char(3) NOT NULL DEFAULT 'INR',

  -- W068: "Reason (recorded verbatim)". Verbatim is the point — this is the sentence an auditor reads in five years
  -- to understand why somebody moved money by hand, and a summary of it is not the same artefact.
  reason            text NOT NULL,
  source_document   varchar(300),

  -- Law 3. Generated once when the draft is created and REUSED on every post attempt, which is what makes the
  -- retry of a timed-out post a no-op rather than a second correction. Storing it on the draft rather than
  -- minting it at post time is the whole difference: a key minted at post time is a new key on every retry.
  idempotency_key   varchar(120) NOT NULL UNIQUE,

  maker_id          uuid NOT NULL,
  submitted_at      timestamptz,
  checker_id        uuid,
  checked_at        timestamptz,
  checker_note      text,
  -- Set only once the wallet-service has returned. A draft claiming to be posted with no txn id is a draft claiming
  -- money moved when nothing can show that it did.
  posted_txn_id     uuid,
  posted_at         timestamptz,

  -- The absolute size of the correction, in minor units, denormalised at submit time. NOT the source of truth for
  -- the legs — it exists so the founder-threshold rule and the queue ordering can be read without joining and
  -- summing on every row. Recomputed from the legs by the same trigger that checks the balance, so it cannot drift.
  gross_minor       bigint,

  CONSTRAINT ck_correction_maker_ne_checker CHECK (
    checker_id IS NULL OR maker_id IS NULL OR checker_id <> maker_id
  ),
  CONSTRAINT ck_correction_check_pair CHECK ((checker_id IS NULL) = (checked_at IS NULL)),
  CONSTRAINT ck_correction_posted_pair CHECK ((posted_txn_id IS NULL) = (posted_at IS NULL)),
  -- A posted correction was approved by somebody and carries the ledger transaction it produced.
  CONSTRAINT ck_correction_posted_has_checker CHECK (
    status <> 'posted' OR (checker_id IS NOT NULL AND posted_txn_id IS NOT NULL)
  ),
  -- A rejection is a decision and says why, for the same reason 0109's `not_applicable` needed a note.
  CONSTRAINT ck_correction_rejected_has_note CHECK (
    status <> 'rejected' OR (checker_note IS NOT NULL AND length(trim(checker_note)) > 0)
  ),
  CONSTRAINT ck_correction_reason_present CHECK (length(trim(reason)) >= 20)
);
CALL add_std_columns('correction_drafts');

-- One live draft per investigation. A second concurrent draft on the same case is two people correcting the same
-- discrepancy in ignorance of each other, which is how a discrepancy gets corrected twice.
CREATE UNIQUE INDEX uq_correction_draft_open_per_case ON correction_drafts (investigation_id)
  WHERE status IN ('drafting', 'awaiting_checker') AND deleted_at IS NULL;
CREATE INDEX idx_correction_drafts_queue ON correction_drafts (status, created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE correction_draft_legs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  draft_id      uuid NOT NULL REFERENCES correction_drafts(id) ON DELETE CASCADE,
  -- Mirrors WalletAdminPort.AdjustmentLeg exactly, because these rows become that call and nothing in between may
  -- reinterpret them. owner_id is NULL for platform legs (a suspense account has no owner).
  owner_kind    varchar(10) NOT NULL CHECK (owner_kind IN ('user', 'tenant', 'platform')),
  owner_id      uuid,
  account_code  varchar(40) NOT NULL,
  -- Signed minor units. bigint, never numeric and never a float (Law 2). A zero leg is meaningless and the
  -- wallet-service refuses it, so it is refused here too rather than being discovered three steps later.
  amount_minor  bigint NOT NULL CHECK (amount_minor <> 0),
  leg_note      varchar(300),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_correction_leg_owner CHECK (
    (owner_kind = 'platform' AND owner_id IS NULL) OR (owner_kind <> 'platform' AND owner_id IS NOT NULL)
  )
);
CREATE INDEX idx_correction_legs_draft ON correction_draft_legs (draft_id);

-- ---------------------------------------------------------------------------
-- 3. THE ZERO-SUM THE LEDGER NEVER GOT, ON THE ONE TABLE A HUMAN TYPES INTO
-- ---------------------------------------------------------------------------
-- A DEFERRED constraint trigger, and deferred is load-bearing rather than incidental: the legs and the status flip
-- happen in the same transaction, in whatever order the service finds convenient, and an immediate trigger would
-- fire on a draft that is halfway assembled and refuse a perfectly good submission. Deferring to COMMIT means the
-- check sees the finished object, which is the only state worth checking.
--
-- WHY THIS IS NOT ALSO DONE ON `ledger_entries`. 0077 considered it and declined, and that judgement stands: the
-- ledger takes millions of machine-generated rows that are balanced by construction, and a per-transaction summing
-- trigger on the hot path would be a permanent tax to catch a class of bug that has never occurred there. This
-- table is the opposite — a handful of rows a month, every one typed by a person under pressure — so the same
-- trigger that would be extravagant there is close to free here.
CREATE OR REPLACE FUNCTION trg_correction_draft_balanced() RETURNS trigger AS $$
DECLARE
  v_sum   bigint;
  v_legs  integer;
  v_gross bigint;
BEGIN
  -- Only submitted and posted drafts must balance. A draft being assembled is allowed to be lopsided; that is what
  -- assembling one looks like, and W068's own "legs do not balance" state exists to show it mid-edit.
  IF NEW.status NOT IN ('awaiting_checker', 'posted') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*), COALESCE(SUM(ABS(amount_minor)), 0) / 2
    INTO v_sum, v_legs, v_gross
    FROM correction_draft_legs WHERE draft_id = NEW.id;

  IF v_legs < 2 THEN
    RAISE EXCEPTION 'correction draft % has % leg(s); a correction is a transfer and needs at least two', NEW.id, v_legs
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'correction draft % does not balance: legs sum to % minor units, not zero', NEW.id, v_sum
      USING ERRCODE = 'check_violation';
  END IF;
  -- `gross_minor` is recomputed here rather than trusted from the caller, so the denormalised figure the founder
  -- threshold reads can never disagree with the legs it is supposed to describe.
  IF NEW.gross_minor IS DISTINCT FROM v_gross THEN
    UPDATE correction_drafts SET gross_minor = v_gross WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_correction_draft_balanced
  AFTER INSERT OR UPDATE ON correction_drafts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_correction_draft_balanced();

-- ---------------------------------------------------------------------------
-- 4. GRANTS — the ADMIN-5d lesson applied on the way in rather than three waves later
-- ---------------------------------------------------------------------------
-- 0067 created three tables for the admin realm with no grant at all and nobody noticed until a console tried to
-- read them. Written here at creation time instead.
REVOKE ALL ON correction_drafts, correction_draft_legs FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON correction_drafts, correction_draft_legs TO kv_admin;
GRANT SELECT ON correction_drafts, correction_draft_legs TO kv_readonly;
-- No DELETE, and the CASCADE above is for a hard tenant teardown only. **W068: "There is no delete. A wrong
-- correction is fixed by another correction — the ledger tells the whole story forever."**

COMMENT ON TABLE correction_drafts IS
  'Manual ledger corrections (W068), drafted against a recon investigation and posted only after a DIFFERENT operator approves. The platform''s EIGHTH maker-checker site. Legs must sum to zero at COMMIT — the synchronous check the ledger itself does not have (0077), placed on the one money table a human types into. Posting goes through WalletAdminPort like every other admin money movement; admin-api never writes ledger rows itself.';
COMMENT ON COLUMN correction_drafts.idempotency_key IS
  'Minted ONCE when the draft is created and reused on every post attempt, so a retried post is a no-op rather than a second correction. A key minted at post time would be a new key on each retry.';
COMMENT ON COLUMN correction_drafts.gross_minor IS
  'Half the sum of absolute leg amounts — the size of the correction. Recomputed by trg_correction_draft_balanced so it cannot drift from the legs it describes. Read by the founder-notification threshold.';

-- ---------------------------------------------------------------------------
-- 5. THE AUDIT EXPLORER'S MISSING INDEX
-- ---------------------------------------------------------------------------
-- W039 offers an ACTION filter and W040 the per-entity trail. `idx_audit_entity (entity_type, entity_id,
-- created_at DESC)` and `idx_audit_actor` exist (0014) and serve the entity drill and the actor filter. Nothing
-- serves a filter by ACTION over a date range, which on a table this size means a partition scan per query — the
-- screen's own error state ("partition scan timed out") describing a defect rather than a limit.
CREATE INDEX idx_audit_action ON audit_log (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO SYNCHRONOUS ZERO-SUM TRIGGER ON `ledger_entries`. See the note on the trigger above — 0077 weighed this and
--     declined for the hot path, and nothing found in this wave changes that arithmetic.
--
--   • NO FOUNDER-PAGING MECHANISM. W068: "Corrections above ₹50,000 additionally page the founder." The threshold is
--     recorded and the console shows it, and the platform HAS NO WAY TO PAGE ANYBODY — 0098's support-escalation
--     ladder can only deliver in-app steps, and its own note says nothing can place a call, send an email or raise a
--     pager. Building a `notified_founder_at` column would produce a timestamp that means "we wrote a row", not "a
--     human was woken up". The threshold is enforced as a CONSENT — a high-value correction requires the checker to
--     confirm explicitly that the founder was informed out of band — which is honest about who actually did the
--     informing, and the gap is named as ADMIN-5e-Q1 with the provider decision as its owner.
--
--   • NO `audit.values.read` COLUMN CHANGE. The permission is added in code (owner-roles.ts); `audit_log.old_value`
--     and `new_value` have existed since 0014 and have simply never been selected. The canon's own restricted states
--     answer the question the ADMIN-5 verdict called an open tension — W039: "old/new values additionally need
--     `audit.values.read` (PII in diffs)", W040: "timeline stays visible, diffs show ▪▪▪". The resolution was filed
--     in the screens all along.
--
--   • NO 7-YEAR RETENTION ENFORCEMENT FOR `audit_log`. W039 promises it. 0107 seeded the POLICY row and the
--     retention worker implements `action='delete'` only, which is the one action that must never run on an
--     append-only ledger. Naming it beats wiring a job whose only implemented verb would destroy the evidence.
