-- 0161_dairy_deduction_instructions.sql · PC-56 TENANT-6c-5 · W169 (Dairy payout cycles)
--
-- W169's rule names TWO things and this programme has only built one of them:
--   *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
--
-- TENANT-6c-4 built the fresh consent, the destinations, and the line that names what it pays. But it left the
-- sentence's other half missing and said so: *"Nothing ASSEMBLES the lines yet. The cycle's generation pass passes
-- `deductions: []`, so a cadence-built bill still carries none, and W169's ₹1,84,300 this cycle is still zero on the
-- automatic path."* A cooperative running 312 members cannot hand-enter a feed-credit line per family per fortnight;
-- the deduction only exists in practice if the cycle assembles it. **The standing instruction is what makes that
-- assembly authorised rather than merely automatic.**
--
-- WHAT WAS MISSING, AND WHY EACH PIECE IS A SEPARATE FACT:
--
--   1. **NOTHING RECORDED THE MEMBER'S ARRANGEMENT.** A feed credit says "this family owes ₹500". It does not say
--      *"recover ₹200 a fortnight"*, and it does not say the family agreed to recovery from the milk cheque at all.
--      Those are the two things a standing instruction is, and without them the only honest assembly would be "take
--      everything outstanding" — which is precisely the surprise W169's subtitle exists to prevent (*"surprises are
--      for birthdays, not milk money"*). An INSTALMENT arrangement is the humane case and it cannot be expressed
--      anywhere else: not on the credit (that is the debt), not on the loan (that is the bank's), not on the bill
--      (that is one fortnight).
--
--   2. **THE AUTOMATIC PATH HAD NO CAP.** 6c-4's consent gate refuses to PAY a bill whose deductions cross the
--      tenant's threshold, so an uncapped assembler would have built 312 bills that all need a member's fresh
--      consent before payday — a queue of 312 conversations produced by software, on a Thursday. The cap is what
--      makes the canon's sentence coherent: **standing instructions govern below the line, fresh consent above it**,
--      so the automatic path must never cross the line by construction. It is `min(assembly cap, consent
--      threshold)`, read from both settings, so a cooperative that tightens either one tightens the assembler.
--
--   3. **`loan_products.repayment_style = 'milk_bill_deduction'` HAD NO READER.** 6c-4 built the repayment mechanism
--      and named this: the style has existed since the fintech module was written, 0011's own comment lists it, and
--      nothing has ever SELECTED on it. So a loan sold to a farmer against her milk cheque still had to be recovered
--      by somebody typing a line by hand. `LoanRepository.listMilkDeductible` is that reader.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, AND SAYS SO:
--   * **No per-type priority.** When a fortnight's cap cannot cover every arrangement, the assembler recovers the
--     OLDEST outstanding first, across every type. Recovering a bank's loan before the cooperative's own feed shop
--     (or the reverse) is a policy W169 does not state, and inventing one would decide, silently, whose debt a
--     family pays first. Oldest-first is the one order that needs no justification; a per-tenant priority is named
--     here and not built.
--   * **No delegated authority.** A standing instruction is authorised BY THE MEMBER, on their own membership, like
--     TENANT-6c-2's dispute and 6c-4's consent. An ambassador SITTING WITH the member is supported through
--     `channel = 'ambassador_assisted'` (0003's own vocabulary, third wave running); an ambassador acting on a
--     member's behalf from their own login is a DIFFERENT act — delegated authority — which this platform does not
--     model anywhere, and faking it here would put a staff member's decision in a column that says "the member
--     agreed".
--   * **Still no EMI schedule** (0011 says so itself), so a `loan_emi` line recovers toward the OUTSTANDING within
--     the cap. It is not an instalment computed from a schedule and no screen may say it is.
--   * **Still no payout batch** behind *"one bank trip"*, so `paid` remains absent from the cycle vocabulary.
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- 161.1  THE STANDING INSTRUCTION
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dairy_deduction_instructions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  membership_id       uuid NOT NULL REFERENCES dairy_memberships(id),

  -- The vocabulary, by FK — the same `milk_deduction` rows a LINE points at (0160). An instruction for a kind of
  -- withholding this platform cannot post would be an arrangement that never happens.
  type_id             uuid NOT NULL REFERENCES lookup_values(id),

  -- NULL = "every source of this type", which is the ordinary case: *"take my feed credits off my bill"*.
  -- Set = one specific receivable, which is how an INSTALMENT on one debt is expressed without touching the debt.
  source_id           uuid,

  -- The instalment. NULL = recover the whole outstanding when the bill can carry it. The tenant's cap still applies
  -- on top, so this is a member's own further restraint rather than a permission to exceed anything.
  max_per_cycle_minor bigint CHECK (max_per_cycle_minor IS NULL OR max_per_cycle_minor > 0),

  -- WHO AGREED, HOW, AND WHEN. The member's own user id; `recorded_by` is whoever keyed it in, which may be the
  -- member or a desk operator sitting with them.
  authorised_by       uuid NOT NULL REFERENCES users(id),
  authorised_at       timestamptz NOT NULL DEFAULT now(),
  channel             varchar(30) NOT NULL,
  assisted_by         uuid REFERENCES users(id),
  recorded_by         uuid NOT NULL REFERENCES users(id),
  note                text,

  is_active           boolean NOT NULL DEFAULT true,
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES users(id),

  -- 0003's consent channel vocabulary, reused verbatim for the third wave running: a farmer with no smartphone
  -- arranges this through an ambassador beside her or an IVR call, and a platform that only accepts 'app' has
  -- excluded the people it exists for.
  CONSTRAINT ck_dairy_ded_instruction_channel CHECK (channel IN ('app','web','ambassador_assisted','ivr')),
  CONSTRAINT ck_dairy_ded_instruction_assisted
    CHECK ((channel = 'ambassador_assisted') = (assisted_by IS NOT NULL)),
  -- Active and revoked cannot disagree — the delay-fuse shape TENANT-6c-2 found three times in one wave.
  CONSTRAINT ck_dairy_ded_instruction_revoked
    CHECK (is_active = (revoked_at IS NULL) AND (revoked_at IS NULL) = (revoked_by IS NULL))
);
CALL add_std_columns('dairy_deduction_instructions');

COMMENT ON TABLE dairy_deduction_instructions IS
  'PC-56 TENANT-6c-5. W169: "Deductions above 25% of gross need the member''s fresh consent, NOT JUST STANDING '
  'INSTRUCTIONS." This is the standing instruction that sentence contrasts against - the member''s arrangement for '
  'routine recovery from their milk bill, with an optional per-cycle instalment. TENANT-6c-4 built the fresh consent '
  'and left this half named: without it the cycle could only assemble "everything outstanding", which is the surprise '
  'W169''s subtitle exists to prevent. Authorised BY THE MEMBER; an ambassador may sit with them (channel), but '
  'delegated authority is not modelled.';

COMMENT ON COLUMN dairy_deduction_instructions.max_per_cycle_minor IS
  'PC-56 TENANT-6c-5. The member''s instalment: recover at most this much per cycle against this arrangement. NULL '
  'means the whole outstanding when the bill can carry it. The tenant''s assembly cap applies on top - this can only '
  'ever make a deduction smaller, never larger, which is why a member may set it and an operator may not raise it.';

-- **TWO PARTIAL UNIQUE INDEXES, NOT ONE UNIQUE CONSTRAINT**, and TENANT-6c-4 is why: `UNIQUE (membership_id,
-- type_id, source_id)` would not constrain the rows whose `source_id` IS NULL, because Postgres treats NULLs as
-- DISTINCT in a unique index unless it is declared `NULLS NOT DISTINCT` — the exact defect that left 139 of 311
-- platform lookup values duplicated. So the "all sources of this type" arrangement gets its own index, on the
-- columns that are actually present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_ded_instruction_type
  ON dairy_deduction_instructions (membership_id, type_id)
  WHERE source_id IS NULL AND is_active AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_ded_instruction_source
  ON dairy_deduction_instructions (membership_id, type_id, source_id)
  WHERE source_id IS NOT NULL AND is_active AND deleted_at IS NULL;

-- The assembler's claim: one membership's live arrangements.
CREATE INDEX IF NOT EXISTS idx_dairy_ded_instruction_active
  ON dairy_deduction_instructions (tenant_id, membership_id)
  WHERE is_active AND deleted_at IS NULL;

ALTER TABLE dairy_deduction_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dairy_deduction_instructions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_dairy_deduction_instructions ON dairy_deduction_instructions;
CREATE POLICY tenant_isolation_dairy_deduction_instructions ON dairy_deduction_instructions
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0157's finding, applied from the start: ALTER DEFAULT PRIVILEGES grants kv_app INSERT+SELECT+UPDATE and kv_relay
-- INSERT+SELECT+UPDATE+DELETE on every new table at CREATE TABLE time, and a table-level UPDATE supersedes every
-- column grant. REVOKE first or the narrowing is decoration.
REVOKE UPDATE, DELETE ON dairy_deduction_instructions FROM kv_app;
REVOKE ALL ON dairy_deduction_instructions FROM kv_relay;
GRANT SELECT, INSERT ON dairy_deduction_instructions TO kv_app;
-- WHAT THE MEMBER AGREED TO IS APPEND-ONLY: the type, the source, the instalment, who authorised it, how and when.
-- Only the REVOCATION moves. Changing an arrangement is a new row, so the history says what was true in July when
-- somebody asks in December.
GRANT UPDATE (is_active, revoked_at, revoked_by, updated_at, updated_by) ON dairy_deduction_instructions TO kv_app;

-- ---------------------------------------------------------------------------------------------------------------
-- 161.1b  WHAT A NULL `created_by` ON A DEDUCTION LINE MEANS
-- ---------------------------------------------------------------------------------------------------------------
-- Recorded here because this wave is what makes it possible. `milk_bill_deductions.created_by` (0160) is
-- `uuid REFERENCES users(id)`, and the cadence's actor is the platform's `'system'` sentinel — a STRING, not a uuid.
-- The first live run of the assembler failed on every line with *"invalid input syntax for type uuid: system"*, which
-- is to say the cycle could not create a deduction at all. (The unit tests mocked the insert and never saw it; this
-- is the fourth time in this programme that a mocked write hid a real column's opinion.)
--
-- So the column is left NULL for assembled lines, and that is a FACT rather than a shrug: **a line with no
-- `created_by` was assembled by the cycle from a standing instruction, and a line with one was typed by a human.**
-- Anybody reading a member's bill can tell which, which is worth more than a fake user id would have been.
COMMENT ON COLUMN milk_bill_deductions.created_by IS
  'PC-56 TENANT-6c-4/6c-5. The human who added this line, or NULL when the CYCLE assembled it from the member''s '
  'standing instruction (dairy_deduction_instructions). Not a fake "system" user: the cadence''s actor id is a '
  'sentinel string, this column is a uuid FK, and the distinction between "somebody typed this" and "the arrangement '
  'produced this" is worth keeping.';

-- ---------------------------------------------------------------------------------------------------------------
-- 161.2  THE CAP THE AUTOMATIC PATH MUST NOT CROSS
-- ---------------------------------------------------------------------------------------------------------------
-- Separate from `dairy.deduction_consent_pct` (0160) even though it defaults to the same 25, because they answer
-- different questions: the consent threshold is *"above what share must we ASK?"* and this is *"what share may the
-- software take WITHOUT asking?"*. A cooperative may want to assemble at most 10% while still only needing consent
-- above 25 — that is a real and kinder configuration, and one setting could not express it.
--
-- The assembler uses the LOWER of the two, so tightening either tightens assembly and the automatic path can never
-- build a bill that needs a member's fresh consent. That is what makes W169's sentence true rather than aspirational.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'dairy.deduction_assembly_max_pct', 'int', 'tenant', 'money_path', '25'::jsonb,
       'PC-56 TENANT-6c-5. The most of a milk bill''s GROSS that the cycle may assemble into deductions from standing '
       'instructions, as a percentage. The assembler uses min(this, dairy.deduction_consent_pct), so the automatic '
       'path never produces a bill that needs the member''s fresh consent - W169: "above 25% of gross need the '
       'member''s fresh consent, not just standing instructions". Set 0 to switch assembly off for a tenant while '
       'leaving hand-entered lines working. `money_path` risk class: 0121''s control plane treats it as reviewable.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'dairy.deduction_assembly_max_pct');

-- ---------------------------------------------------------------------------------------------------------------
-- 161.3  THE FLAG (Law 10)
-- ---------------------------------------------------------------------------------------------------------------
-- A THIRD dairy-deduction flag, and the blast radii are genuinely different: `dairy_member_credit` gates the credit
-- desk, `dairy_deduction_recovery` gates whether a deduction's money may MOVE at all, and this gates whether the
-- CYCLE writes lines nobody typed. Switching this off must leave hand-entered lines and their recovery working —
-- which is exactly the state TENANT-6c-4 shipped.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_deduction_assembly',
   'PC-56 TENANT-6c-5: the cycle assembles a bill''s deduction lines from the member''s STANDING INSTRUCTIONS (feed '
   'credits, loans whose repayment_style is milk_bill_deduction), oldest debt first, capped at '
   'min(dairy.deduction_assembly_max_pct, dairy.deduction_consent_pct) of the gross so the automatic path never needs '
   'the member''s fresh consent. OFF means a cadence-built bill carries no deductions, which is where TENANT-6c-4 '
   'left it - hand-entered lines are unaffected either way.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

COMMIT;
