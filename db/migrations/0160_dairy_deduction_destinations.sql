-- 0160_dairy_deduction_destinations.sql · PC-56 TENANT-6c-4 · W169 (Dairy payout cycles)
--
-- W169 shows a deduction on three of its three visible bills and totals them in a header tile:
--   *"Deductions this cycle · ₹1,84,300 · feed credit + loan EMI + insurance — **each line itemised**"*
--   *"Suresh B. · −₹500 feed credit"*, *"Savita Ben M. · −₹1,240 loan EMI + insurance"*
--   *"member sees every pour + every deduction"*
--   *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
--
-- TENANT-6c-1 found that a deduction had nowhere to go and made `pay()` refuse any bill carrying one
-- (`DEDUCTION_HAS_NO_DESTINATION`) rather than quietly keep a family's money. THIS MIGRATION BUILDS THE DESTINATIONS.
-- What it found on the way there:
--
--   1. **A DEDUCTION WAS A FREE-TYPED STRING IN A JSONB BLOB.** `milk_bills.deductions` is
--      `[{type, amount_minor}]` with `type` a 40-character string the caller chooses (`create-milk-bill.dto.ts`:
--      `z.string().min(1).max(40)`). It references NOTHING. A line reading `loan_emi` names no loan, so there is no
--      row to reduce, no outstanding to check it against, and no way to answer "which loan did this ₹300 pay?" — which
--      is the question a member asks when their bill is short. 0009's own comment lists the intended vocabulary
--      (`feed_credit|loan_emi|insurance|share`) as a **comment**, which is Law 6 exactly inverted: the vocabulary a
--      cooperative's money moves by lived in a SQL remark while the column accepted anything.
--
--   2. **THE FEED CREDIT HAS NO SOURCE RECORD ANYWHERE.** W169's first and most common line is *"−₹500 feed credit"*.
--      `grep -rn "feed_credit"` over `db/migrations` finds it in one place: that comment. There is no table of
--      cattle-feed or mineral-mix sold to a member on credit at the MCC, no outstanding, no issue record. A deduction
--      cannot RECOVER a debt this platform never recorded — so `dairy_member_credits` is created here, and it is the
--      receivable the line pays.
--
--   3. **THE FINTECH MODULE ALREADY PROMISED THIS PATH, TWICE, AND NOTHING IMPLEMENTED IT.**
--      `fintech/domain/fintech.events.ts`: `REPAYMENT_STYLES = ['emi','bullet','harvest_aligned','milk_bill_deduction']`.
--      `0011_fintech_schemes.sql`, on `loan_repayments.channel`: `-- upi|milk_bill_deduction|harvest_settlement|cash_partner`.
--      So a loan can be sold to a farmer on the promise that it is repaid out of her milk cheque, and the dairy module
--      has never known that promise exists. This is the "a promise with no mechanism" class, and the mechanism is
--      built here — through the fintech module's own public service, in the dairy payment's transaction (Law: no
--      module reaches into another's repositories).
--
--   4. **THE >25% CONSENT RULE HAD NOWHERE TO LIVE.** `consents` (0003) is the DPDP purpose-consent table: a
--      (user, purpose_code, version, granted, channel) row with **no tenant, no amount and no reference**. It records
--      permission to PROCESS a person's data for a purpose. It cannot express *"this member agreed that ₹2,400 comes
--      out of THIS fortnight's ₹9,000"*, and reusing it would make a money authorisation indistinguishable from a
--      privacy notice. A purpose-specific record is created instead, and the two are deliberately not merged.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, AND SAYS SO:
--   * **The lines are still named by the caller** — `insurance` and `share` still have no destination and still refuse.
--     `insurance_policies.premium_minor` is collected through the payments module as a gateway INTENT
--     (`initiatePremiumPayment` → `payments.payment_succeeded`); there is no wallet-settled premium path, so a dairy
--     deduction has nothing to pay into. `share` was ruled on by the registry wave in this console's own words —
--     *"Allotment is not yet something this console can carry out — the deduction, the consent record and the
--     certificate are one money movement, and we would rather say so than offer a button that only records an
--     intention"* — and that ruling stands. Both are seeded as UNSUPPORTED with their reason IN THE DATA, so the
--     refusal an operator reads comes from the same row the vocabulary comes from.
--   * **Nothing ASSEMBLES the lines yet.** The cycle's generation pass passes `deductions: []` (0157), so a
--     cadence-built bill still carries none, and W169's *"₹1,84,300 this cycle"* is still zero on the automatic path.
--     Assembling lines from the outstanding source records — which is what W169's *"not just standing instructions"*
--     is contrasted AGAINST — is TENANT-6c-5, together with the standing-instruction record itself and the per-tenant
--     recovery caps. This wave makes a line REAL; the next makes it AUTOMATIC.
--   * **There is still no EMI schedule.** `0011_fintech_schemes.sql` says so itself
--     (`loan-repayment.entity.ts`: *"a pre-generated EMI schedule is deferred (documented)"*), so this platform cannot
--     state what a given fortnight's instalment IS. What a `loan_emi` line does here is recover an amount toward the
--     loan's OUTSTANDING, which is a real and reconcilable act — and the label a screen shows must not claim more than
--     that. The schedule belongs to the fintech module.
--   * `paid` is still absent from the cycle status vocabulary: there is still no payout batch behind W169's
--     *"one bank trip"*.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 160.1  THE VOCABULARY, IN THE PLATFORM'S OWN VOCABULARY MECHANISM
-- ---------------------------------------------------------------------------------------------------------------
-- `lookup_types`/`lookup_values` is where this platform keeps controlled vocabularies — the LEDGER's own
-- `txn_type_id` FKs `lookup_values(id)` (0006), as do dispute reasons, doc types and boost tiers (whose PRICE lives
-- in `meta`, the precedent for putting a parameter there). So no new vocabulary mechanism is invented: a deduction
-- type is a lookup value, and `meta.destination` names the mechanism that moves its money.
--
-- `is_tenant_extendable = false` ON PURPOSE, and it is the Rule-Zero call in this file. A tenant-invented deduction
-- type would be a line whose money has nowhere to go — the cooperative would withhold it from a family and the
-- platform would have no row to post it to. A tenant CAN choose which of these it uses (it simply never creates a
-- line of a type it does not use); it cannot create a new kind of withholding.
--
-- INSERTED BY THE MIGRATION AND BY THE SEED, both idempotently, and that is not two mechanisms for one fact:
-- TENANT-6c-2 established that **seeds run after migrations**, so a migration that needs a vocabulary row (this one
-- backfills a FK against it, below) cannot wait for the seed file — and a fresh install must still get the rows from
-- the seed that states them. Identical rows, and neither may drift from the other.
-- ###############################################################################################################
-- A PLATFORM-WIDE DEFECT THIS WAVE TRIPPED OVER, AND WHY THE INSERTS BELOW LOOK LIKE THIS
-- ###############################################################################################################
-- `lookup_values` has `UNIQUE (type_code, tenant_id, code)` (0001). A PLATFORM row has `tenant_id IS NULL`, and in
-- Postgres NULLs are DISTINCT in a unique index unless it is declared `NULLS NOT DISTINCT` — which this one is not.
-- **So `ON CONFLICT (type_code, tenant_id, code) DO NOTHING` cannot fire for a platform row, and every seed file that
-- inserts one is NOT idempotent.** `db/seeds/core/0005_lookup_vocabularies.sql` uses exactly that clause throughout,
-- and `apps/api/test/integration-global-setup.js` applies it TWICE on purpose, with a comment asserting the opposite:
-- *"Seed 0005 is idempotent (ON CONFLICT DO NOTHING throughout) so step 4 below re-applying it later in the normal
-- seed order is harmless, not a double-seed bug."*
--
-- MEASURED ON A FRESHLY BUILT DATABASE: 311 platform lookup values, of which **139 codes are duplicated**. Among
-- them `ledger_txn_type` (FK'd by every row in `ledger_transactions`), `payment_purpose`, `payout_purpose`,
-- `dispute_reason` and `boost_tier` — whose PRICE lives in `meta`, so two rows for one tier can quietly disagree
-- about what a boost costs. Every table that FKs `lookup_values(id)` is now pointing at one of several
-- indistinguishable rows, and an admin editing "the" row has a 50% chance of editing the one nothing references.
--
-- THIS WAVE DOES NOT SWEEP THAT. De-duplicating 139 codes means repointing FKs on the LEDGER and on payments, and a
-- migration that rewrites `ledger_transactions.txn_type_id` needs the CODEOWNERS review Law 9 requires and a founder
-- decision about which duplicate wins. **ESCALATED, NAMED IN THE TRACKER, NOT SMUGGLED INTO A WAVE ABOUT DEDUCTIONS.**
-- The harness's false comment is corrected in the same commit, because a comment claiming an idempotency the schema
-- cannot deliver is how this stayed invisible.
--
-- WHAT THIS WAVE DOES: its own vocabulary cannot be duplicated. `WHERE NOT EXISTS` instead of `ON CONFLICT`, plus a
-- PARTIAL UNIQUE INDEX scoped to this type — bounded, safe on a live database, and enough to make the FK on
-- `milk_bill_deductions.type_id` mean one thing. Two ids for `feed_credit` would split a cooperative's lines across
-- both and make the cycle tile disagree with the rows underneath it.
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
SELECT 'milk_deduction', 'Milk bill deduction type', false
 WHERE NOT EXISTS (SELECT 1 FROM lookup_types WHERE code = 'milk_deduction');

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('milk_deduction', 'feed_credit', 'Feed / input credit',
     '{"destination":"member_credit","source_type":"dairy_member_credit"}', 1),
    ('milk_deduction', 'loan_emi', 'Loan instalment',
     '{"destination":"loan","source_type":"loan"}', 2),
    ('milk_deduction', 'insurance', 'Insurance premium',
     '{"destination":"none","unsupported_reason":"A premium is collected through the payments module as a gateway intent (insurance_policy) and activated by payments.payment_succeeded. There is no wallet-settled premium path, so a milk-bill deduction has nothing to pay into. Belongs to the insurance module."}', 3),
    ('milk_deduction', 'share', 'Cooperative share allotment',
     '{"destination":"none","unsupported_reason":"The registry wave already ruled on this: the deduction, the consent record and the share certificate are one money movement, and coop_share_registers has no allotment act. Offering the deduction alone would take a family''s money for a certificate that never arrives."}', 4)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM lookup_values x
    WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ---------------------------------------------------------------------------------------------------------------
-- 160.2  THE LINE — one ROW per deduction, pointing at the thing it pays
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milk_bill_deductions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  bill_id        uuid NOT NULL REFERENCES milk_bills(id),
  membership_id  uuid NOT NULL REFERENCES dairy_memberships(id),

  -- The vocabulary, by FK. A line can no longer name a kind of withholding this platform does not have.
  type_id        uuid NOT NULL REFERENCES lookup_values(id),

  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),

  -- WHAT THIS LINE PAYS. The whole point of the table: `source_id` is the member credit, the loan, the policy — the
  -- row whose outstanding this reduces. A line with no source is a withholding nobody can reconcile, which is what
  -- the jsonb blob was.
  source_type    varchar(40) NOT NULL,
  source_id      uuid NOT NULL,

  status         varchar(16) NOT NULL DEFAULT 'pending',
  applied_at     timestamptz,
  -- The ledger transaction that moved this line's money. A deduction claiming to have been applied with no txn to
  -- point at is the shape TENANT-5d and 6b-1 both closed from the other direction.
  wallet_txn_id  uuid,

  created_by     uuid REFERENCES users(id),

  CONSTRAINT ck_milk_bill_deduction_status CHECK (status IN ('pending','applied')),
  CONSTRAINT ck_milk_bill_deduction_applied CHECK (
    (status = 'applied') = (applied_at IS NOT NULL)
    AND (applied_at IS NULL) = (wallet_txn_id IS NULL)),
  -- One line per (bill, type, source): recovering the same loan twice on one fortnight's bill is not two decisions,
  -- it is a double deduction. A second instalment against the same loan belongs on the next cycle.
  CONSTRAINT uq_milk_bill_deduction_source UNIQUE (bill_id, type_id, source_id)
);
CALL add_std_columns('milk_bill_deductions');

COMMENT ON TABLE milk_bill_deductions IS
  'PC-56 TENANT-6c-4. W169: "feed credit + loan EMI + insurance - each line itemised" and "member sees every pour and '
  'every deduction". Before this table a deduction was an element of the milk_bills.deductions JSONB blob with a '
  'free-typed 40-char label and no reference to anything, so a loan_emi line reduced no loan, there was nothing to '
  'check it against, and "which loan did this pay?" had no answer. One row per line, pointing at the receivable it '
  'settles, stamped with the ledger txn that moved it.';

COMMENT ON COLUMN milk_bill_deductions.source_id IS
  'The row this line pays: dairy_member_credits.id for feed_credit, loans.id for loan_emi. Deliberately NOT a foreign '
  'key - the target table differs per type, and a polymorphic FK cannot be expressed. The owning module validates it '
  'before a line is created and again before it is applied (dairy for member credits, fintech LoanService for loans).';

-- De-duplicate first (a database that already ran an earlier build of this migration may carry copies), keeping the
-- OLDEST row of each code — the one any existing line already points at.
DELETE FROM lookup_values lv
 WHERE lv.type_code = 'milk_deduction' AND lv.tenant_id IS NULL
   AND EXISTS (SELECT 1 FROM lookup_values keep
                WHERE keep.type_code = lv.type_code AND keep.tenant_id IS NULL AND keep.code = lv.code
                  AND (keep.created_at, keep.id) < (lv.created_at, lv.id))
   AND NOT EXISTS (SELECT 1 FROM milk_bill_deductions d WHERE d.type_id = lv.id);

-- The constraint the platform-wide one is missing, scoped to this type so it is safe to add on a live database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_milk_deduction_platform
  ON lookup_values (code) WHERE type_code = 'milk_deduction' AND tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_milk_bill_deduction_bill
  ON milk_bill_deductions (tenant_id, bill_id) WHERE deleted_at IS NULL;
-- "What has this member had taken, and for what?" — the member's own question, and the cycle tile's total.
CREATE INDEX IF NOT EXISTS idx_milk_bill_deduction_member
  ON milk_bill_deductions (tenant_id, membership_id, created_at DESC) WHERE deleted_at IS NULL;
-- "Everything ever recovered against this loan / this credit" — reconciliation from the destination's side.
CREATE INDEX IF NOT EXISTS idx_milk_bill_deduction_source
  ON milk_bill_deductions (tenant_id, source_type, source_id) WHERE deleted_at IS NULL;

ALTER TABLE milk_bill_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE milk_bill_deductions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_milk_bill_deductions ON milk_bill_deductions;
CREATE POLICY tenant_isolation_milk_bill_deductions ON milk_bill_deductions
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0157's finding: ALTER DEFAULT PRIVILEGES on this database grants kv_app INSERT+SELECT+UPDATE and kv_relay
-- INSERT+SELECT+UPDATE+DELETE on every new table at CREATE TABLE time, and a TABLE-level UPDATE supersedes every
-- column grant. REVOKE first or the narrowing is decoration.
REVOKE UPDATE, DELETE ON milk_bill_deductions FROM kv_app;
REVOKE ALL ON milk_bill_deductions FROM kv_relay;
GRANT SELECT, INSERT ON milk_bill_deductions TO kv_app;
-- The AMOUNT, the TYPE and the SOURCE are append-only: what was withheld and what it paid is not editable after the
-- fact. Only the application stamp moves, and only once (the CHECK above pairs it with its txn).
GRANT UPDATE (status, applied_at, wallet_txn_id, updated_at, updated_by) ON milk_bill_deductions TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 160.3  THE FEED CREDIT — the receivable W169's most common line pays
-- ---------------------------------------------------------------------------------------------------------------
-- A cooperative sells cattle feed, mineral mix or medicine to a member at the MCC and takes it out of the next milk
-- cheque. That is the single most common deduction in Indian dairy and this platform had no record of it: no balance,
-- no issue, nothing to recover.
--
-- NO WALLET MOVEMENT AT ISSUE, deliberately. The member received GOODS, not money — a `contract_input_advance`
-- (0010) is cash and posts a real transfer at disbursal, which is why its recovery correctly pays only the net. This
-- is a receivable, so the money moves ONCE: at recovery, member → cooperative, which is the member paying for the
-- feed. Anything else would either invent a cash movement that never happened or leave the payment unposted.
CREATE TABLE IF NOT EXISTS dairy_member_credits (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  membership_id   uuid NOT NULL REFERENCES dairy_memberships(id),
  mcc_id          uuid REFERENCES mcc_centres(id),

  -- WHAT WAS SOLD, in the operator's own words. NOT a code list, for TENANT-6c-2's reason: a closed set of things a
  -- cooperative might sell on credit would be missing the case that matters, and this is a description of a real
  -- transaction rather than a string a tenant admin configures. A floor, so "x" is not a description.
  description     text NOT NULL,

  value_minor     bigint NOT NULL CHECK (value_minor > 0),
  recovered_minor bigint NOT NULL DEFAULT 0 CHECK (recovered_minor >= 0),
  issued_on       date NOT NULL,
  issued_by       uuid NOT NULL REFERENCES users(id),
  status          varchar(16) NOT NULL DEFAULT 'outstanding',

  CONSTRAINT ck_dairy_member_credit_desc CHECK (length(btrim(description)) >= 3),
  -- A credit can never be over-recovered: the family cannot be charged more than the feed was worth.
  CONSTRAINT ck_dairy_member_credit_recovered CHECK (recovered_minor <= value_minor),
  CONSTRAINT ck_dairy_member_credit_status CHECK (status IN ('outstanding','recovered')),
  -- The status and the arithmetic cannot disagree — the delay-fuse shape TENANT-6c-2 found three times.
  CONSTRAINT ck_dairy_member_credit_status_matches
    CHECK ((status = 'recovered') = (recovered_minor = value_minor))
);
CALL add_std_columns('dairy_member_credits');

COMMENT ON TABLE dairy_member_credits IS
  'PC-56 TENANT-6c-4. Feed / mineral mix / medicine sold to a dairy member on credit at the MCC, recovered from the '
  'milk bill. W169 shows "-Rs 500 feed credit" as its first deduction line; before this table the platform had no '
  'record of such a debt at all, so the deduction could not recover anything - grep for feed_credit found exactly one '
  'hit in db/migrations, a COMMENT. Goods, not cash: no wallet movement at issue, one at recovery (member -> tenant).';

CREATE INDEX IF NOT EXISTS idx_dairy_member_credit_outstanding
  ON dairy_member_credits (tenant_id, membership_id, issued_on)
  WHERE status = 'outstanding' AND deleted_at IS NULL;

ALTER TABLE dairy_member_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dairy_member_credits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_dairy_member_credits ON dairy_member_credits;
CREATE POLICY tenant_isolation_dairy_member_credits ON dairy_member_credits
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

REVOKE UPDATE, DELETE ON dairy_member_credits FROM kv_app;
REVOKE ALL ON dairy_member_credits FROM kv_relay;
GRANT SELECT, INSERT ON dairy_member_credits TO kv_app;
-- What was sold, for how much, to whom and by whom is append-only. Only the RECOVERY moves.
GRANT UPDATE (recovered_minor, status, updated_at, updated_by) ON dairy_member_credits TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 160.4  THE FRESH CONSENT — W169's 25% rule
-- ---------------------------------------------------------------------------------------------------------------
-- *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
--
-- FRESH is the operative word, and it is why this is a row per BILL carrying that bill's OWN FIGURES rather than a
-- flag on the membership. A consent to "deductions from my milk bills" is the standing instruction the canon is
-- contrasting against. A consent that names ₹2,400 out of ₹9,000 for the fortnight ending 15 Jul is a decision about
-- a specific fortnight — and if the bill is voided, rebuilt and re-previewed with different figures (which
-- TENANT-6c-2 made possible), the old row no longer matches and the member is asked again. That is what makes it
-- fresh, and it is enforced by comparing the row to the bill at PAY time rather than by an expiry.
--
-- APPEND-ONLY, with no unique key beyond the primary one: a member may refuse after granting, or grant after
-- refusing, and both are facts. The latest row for a bill decides, and the history keeps the rest.
CREATE TABLE IF NOT EXISTS milk_bill_deduction_consents (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  bill_id          uuid NOT NULL REFERENCES milk_bills(id),
  membership_id    uuid NOT NULL REFERENCES dairy_memberships(id),
  -- The MEMBER's own user id. Staff consenting on a member's behalf is not a thing this table can express, which is
  -- the point; an ambassador SITTING WITH the member is, through `channel`.
  member_user_id   uuid NOT NULL REFERENCES users(id),

  -- The figures consented TO, copied at insert. Evidence years later, and the freshness test.
  gross_minor      bigint NOT NULL CHECK (gross_minor > 0),
  deductions_minor bigint NOT NULL CHECK (deductions_minor > 0),
  -- The threshold in force when it was asked for, so a later change to the tenant setting cannot rewrite what the
  -- member was told.
  threshold_pct    integer NOT NULL CHECK (threshold_pct BETWEEN 1 AND 100),

  granted          boolean NOT NULL,
  -- 0003's own consent channel vocabulary, reused verbatim: a farmer with no smartphone consents through an
  -- ambassador or an IVR call, and a platform that only accepts 'app' has excluded the people it exists for.
  channel          varchar(30) NOT NULL,
  assisted_by      uuid REFERENCES users(id),
  note             text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_milk_bill_consent_channel CHECK (channel IN ('app','web','ambassador_assisted','ivr')),
  -- An assisted consent must name the person who assisted; an unassisted one must not claim somebody did.
  CONSTRAINT ck_milk_bill_consent_assisted
    CHECK ((channel = 'ambassador_assisted') = (assisted_by IS NOT NULL)),
  CONSTRAINT ck_milk_bill_consent_amounts CHECK (deductions_minor <= gross_minor)
);
CALL add_std_columns('milk_bill_deduction_consents');

COMMENT ON TABLE milk_bill_deduction_consents IS
  'PC-56 TENANT-6c-4. W169: "Deductions above 25% of gross need the member''s fresh consent, not just standing '
  'instructions." NOT the DPDP consents table (0003): that row is (user, purpose_code, version, granted, channel) '
  'with no tenant, no amount and no reference - it records permission to PROCESS data for a purpose and cannot say '
  'that this member agreed to THIS deduction out of THIS fortnight''s gross. Append-only; the latest row for a bill '
  'decides; it must match the bill''s CURRENT figures at pay time, which is what "fresh" means here.';

CREATE INDEX IF NOT EXISTS idx_milk_bill_consent_bill
  ON milk_bill_deduction_consents (tenant_id, bill_id, recorded_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE milk_bill_deduction_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE milk_bill_deduction_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_milk_bill_deduction_consents ON milk_bill_deduction_consents;
CREATE POLICY tenant_isolation_milk_bill_deduction_consents ON milk_bill_deduction_consents
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

REVOKE UPDATE, DELETE ON milk_bill_deduction_consents FROM kv_app;
REVOKE ALL ON milk_bill_deduction_consents FROM kv_relay;
-- INSERT and SELECT only, and no UPDATE grant at all: what a member said about their own money is not editable by
-- anybody. A change of mind is a new row.
GRANT SELECT, INSERT ON milk_bill_deduction_consents TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 160.5  THE JSONB BLOB BECOMES ROWS — and then stops existing
-- ---------------------------------------------------------------------------------------------------------------
-- Two mechanisms over one fact is on this programme's own defect list, so the blob does not survive alongside the
-- table. It is backfilled first: any line whose `type` matches a seeded code becomes a real row, and any line that
-- does NOT is refused loudly rather than dropped, because a jsonb element saying `{"type":"Feed","amount_minor":500}`
-- is ₹5 of somebody's money and a migration that silently discards it is worse than one that stops.
--
-- `source_id` for a backfilled line is the BILL's own id with `source_type='unreconciled_legacy'`: there is no
-- receivable to point at, because none existed. Those lines are `pending` forever and their bill cannot be paid —
-- which is exactly the state 0157 already put it in, now visible per line instead of per bill.
DO $$
DECLARE
  bad integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'milk_bills' AND column_name = 'deductions') THEN

    SELECT count(*) INTO bad
      FROM milk_bills b, jsonb_array_elements(b.deductions) e
     WHERE NOT EXISTS (SELECT 1 FROM lookup_values lv
                        WHERE lv.type_code = 'milk_deduction' AND lv.tenant_id IS NULL
                          AND lv.code = (e->>'type'));
    IF bad > 0 THEN
      RAISE EXCEPTION 'PC-56 TENANT-6c-4: % milk_bills.deductions line(s) name a type outside the milk_deduction vocabulary. These are somebody''s money and this migration will not discard them - map or correct them, then re-run.', bad;
    END IF;

    INSERT INTO milk_bill_deductions (tenant_id, bill_id, membership_id, type_id, amount_minor, source_type, source_id, status)
    SELECT b.tenant_id, b.id, b.membership_id, lv.id, (e->>'amount_minor')::bigint, 'unreconciled_legacy', b.id, 'pending'
      FROM milk_bills b
      CROSS JOIN jsonb_array_elements(b.deductions) e
      JOIN lookup_values lv ON lv.type_code = 'milk_deduction' AND lv.tenant_id IS NULL AND lv.code = (e->>'type')
     WHERE (e->>'amount_minor')::bigint > 0
    ON CONFLICT (bill_id, type_id, source_id) DO NOTHING;

    ALTER TABLE milk_bills DROP COLUMN deductions;
  END IF;
END $$;

-- The bill keeps `deductions_minor` — a bill's net is `gross - deductions_minor` and that arithmetic must be
-- readable without a join, on a partitioned money table, for 312 members at a time. It is a DERIVED total, so the
-- invariant that matters is that it equals the sum of the lines; the aggregate computes it from them and a live test
-- proves it. A trigger would be a third mechanism, and 0009's CHECK already binds it to the net.
COMMENT ON COLUMN milk_bills.deductions_minor IS
  'PC-56 TENANT-6c-4. The SUM of this bill''s milk_bill_deductions rows, kept on the bill so net = gross - this is '
  'readable without a join. The rows are the truth; the JSONB column that used to hold them (a free-typed label and '
  'an amount, referencing nothing) was dropped by 0160 after being backfilled into them.';

-- ---------------------------------------------------------------------------------------------------------------
-- 160.6  THE THRESHOLD IS A SETTING, NOT A LITERAL 25
-- ---------------------------------------------------------------------------------------------------------------
-- A cooperative in one state may cap withholding at 25% and another at 15%; the canon's 25 is a default, not a law
-- of nature. Same shape as 0158's `dairy.dispute_window_hours`.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.deduction_consent_pct', 'int', 'tenant', 'money_path', '25'::jsonb,
       'PC-56 TENANT-6c-4. W169: "Deductions above 25% of gross need the member''s fresh consent, not just standing '
       'instructions." Above this percentage of a milk bill''s gross, payment REFUSES until the member has consented '
       'to THAT BILL''S OWN figures. Lower it to protect members further. Setting it to 100 does not switch the rule '
       'off - it makes it apply only when a whole fortnight''s milk is withheld, which is a decision somebody has to '
       'make on purpose. `money_path` risk class: 0121''s control plane treats it as a change that needs review.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.deduction_consent_pct');

-- ---------------------------------------------------------------------------------------------------------------
-- 160.7  THE FLAGS (Law 10)
-- ---------------------------------------------------------------------------------------------------------------
-- TWO, because they are two blast radii. Killing the credit desk must not strand a bill whose line is already
-- recorded, and killing recovery must not stop the MCC from writing down what it sold.
--
-- `dairy_deduction_recovery` OFF means `pay()` refuses a bill carrying any deduction — which is precisely where
-- 0157 left it, so the OFF state is the shipped state and switching the flag ON is the only change in behaviour.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_member_credit',
   'PC-56 TENANT-6c-4: record feed / mineral mix / medicine sold to a dairy member on credit at the MCC (the receivable W169''s "feed credit" line recovers). OFF means the desk cannot issue new credits; existing ones stay recoverable.',
   false, 100, 'experiment'),
  ('dairy_deduction_recovery',
   'PC-56 TENANT-6c-4: apply a milk bill''s deduction lines when it is paid - the member is paid the GROSS and each line is then posted to what it pays, in the same transaction. OFF means pay() refuses any bill carrying a deduction, which is exactly where 0157 left it (DEDUCTION_HAS_NO_DESTINATION). Kill-switch for the whole recovery path.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

COMMIT;
