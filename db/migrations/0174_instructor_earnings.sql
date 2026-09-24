-- ==================================================================================================================
-- 0174 · PC-56 TENANT-7d-money · THE EARNINGS — W418 (instructor earnings)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- **MONEY-PATH MIGRATION (Law 9 / CODEOWNERS): founder review owed before merge.**
-- ==================================================================================================================
--
-- W418: *"Royalty is respect with a decimal point — every rupee traced to a course and a learner count."* ·
--       *"Gross (Silage Making Masterclass) ₹31,886.00 · 214 enrollments × ₹149"* · *"Your royalty (80%) ₹25,508.80 ·
--       royalty_bps 8000"* · *"Tenant + platform (20%) ₹6,377.20 · hosting, QA, payment rails"* · *"Payout rides the
--       monthly wage-lane, alongside labour and ambassador payouts — same rails, same reconciliation."* · *"Payout
--       pending — This month's royalty is computed and waiting for the monthly wage-lane run — it hasn't left the
--       tenant's account yet."* · *"Earnings are yours alone — Only you and the tenant finance desk can see this
--       page's amounts."* · *"Flagged off — Earnings disabled."*
--
-- WHAT THE WAVE IS DECLARED AS (7d's evidence, verbatim): *"`enrollment.service.ts:50–58` pays the instructor at the
-- moment of purchase … `userMain(userId, currencyCode = 'INR')` — every leg is booked in INR by default whatever
-- `course.currencyCode` is … the tenant receives nothing — the remainder goes to platform Fees; `tenantCommission`
-- exists in the same file and is not used … no royalty ledger to sum … no instructor agreement on record."*
--
-- FOUR DEFECTS ON A MONEY PATH, AND THE ORDER THEY ARE FIXED IN:
--   1. **THE CURRENCY.** A course priced in AED (since 7a the course's currency is the TENANT's) posted rupee legs:
--      `wallet_accounts` rows named INR, `ledger_entries.currency_code` = 'INR', a Dubai learner's dirhams recorded as
--      paise. That is a false record (Rule Zero: blocks a country), so it is corrected AT SOURCE and NOT behind a
--      flag — a flag over a lie is a lie with a switch. `enrollment.service.ts` books every leg in
--      `course.currencyCode`; the line below snapshots the currency AND its `minor_units` (6e-1's rule) so a
--      figure can be summed and printed without guessing the scale.
--   2. **THE TENANT'S SHARE.** The canon prints *"Tenant + platform (20%)"*; the code sent 100% of the remainder to
--      platform `fees`. The split is a RULE the tenant owns (`course_royalty_rules`, below) — Law 6: the 20% is a
--      DEFAULT row, never a literal in code — and a change to it is a money rule, so it is maker ≠ checker as a
--      CHECK on the row (6c-3's precedent: true of the ROW whatever wrote it).
--   3. **THE LEDGER TO SUM.** W418's every figure is a SUM over `instructor_royalty_lines` — one line per paid
--      enrollment, the four legs of the split as columns, `gross = instructor + tenant + platform` as a CHECK, the
--      wallet transaction it rode on as a FK, the currency and its scale. Never a stored total: the balance is
--      `SUM(instructor_minor)` at read time, per currency (6e-1: never a mixed total).
--   4. **THE AGREEMENT.** Nothing recorded that an instructor ever agreed to a share. `instructor_agreements`
--      (version · share at issue · offered by the desk · accepted by the instructor, and only by them). Until an
--      agreement is ACCEPTED, a purchase still completes — the learner is not refused a course over the tenant's
--      paperwork — but the instructor's leg is credited to their `hold` account and the line reads
--      `held_pending_agreement`, named on W418; acceptance releases every held line (hold → main, one wallet
--      transaction per currency) in the acceptance's own transaction.
--
-- MONEY OUT rides the EXISTING payout plane and nothing else: a new `payout_purpose` value `course_royalty`, mapped
-- to the `instructor` role in 0125's purpose → role map (KYC verified AS an instructor), and — the canon's *"rides the
-- monthly wage-lane … same rails"* — a payout of this purpose may NEVER leave `queued` unbatched: ADMIN-6b's ruling
-- that a person withdrawing their own wallet needs no second human is kept for every other purpose, and this purpose
-- declares `meta.rides_batch = true`, which 0114's trigger (re-created below, fix-forward) and `claimQueued` both
-- read. A batch is TENANT-4b's two-person gate (0143). So: request → tenant maker prepares the batch → a different
-- human approves → the executor disburses. Never a new payout path.
--
-- FLAGS (Law 8 / Law 10): `course_royalty_split` (the rule-resolved split, the tenant's share, the hold) — default
-- OFF: while OFF the purchase posts the pre-0174 shape (row `royalty_bps` to the instructor's MAIN wallet, remainder
-- to platform fees) but in the COURSE's currency and WITH a line recording exactly that. `instructor_earnings` (W418,
-- its statement, export, payout request, agreement and rule surfaces) — default OFF. The currency correction and the
-- line are NOT flagged: they record what happened, and recording the truth is not a feature.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   • `course_royalty_rules`: `tenant_id` NULL = the platform default (readable by every tenant, written only by a
--     migration or admin-api — Law 11); SELECT policy `tenant_id IS NULL OR tenant_id = current_tenant_id()`,
--     INSERT/UPDATE policies `tenant_id = current_tenant_id()` (a tenant can never write a platform row). ENABLE +
--     FORCE. REVOKE ALL from kv_app, kv_relay; GRANT SELECT, INSERT, UPDATE to kv_app (propose · decide · supersede;
--     nothing deletes — a rule that stopped applying is `superseded`).
--   • `instructor_agreements`: `tenant_id` NOT NULL (a platform instructor's agreement is admin-api's, refused by
--     trigger); policy `tenant_id = current_tenant_id()`; ENABLE + FORCE; SELECT, INSERT, UPDATE to kv_app.
--   • `instructor_royalty_lines`: `tenant_id` NOT NULL; policy `tenant_id = current_tenant_id()`; ENABLE + FORCE;
--     SELECT, INSERT, UPDATE to kv_app — UPDATE for exactly one transition (held → released) and a trigger refuses
--     any change to a money column (Golden Law 2: append-only); DELETE to nobody.
--   • `payouts` / `payout_batches`: unchanged tables; the 0114 trigger function is re-created (fix-forward).
--
-- PARTITION NOTE. `instructor_royalty_lines` is one row per PAID enrollment — at 15,000 tenants × a few hundred paid
-- learners a year it is ~10⁷ rows a decade out, served by (tenant_id, instructor_id, occurred_at DESC, id DESC).
-- Unpartitioned, as `enrollments` (0012) is; the day it needs a range partition is the day `enrollments` does. Rules
-- and agreements are tens of rows per tenant. `ON CONFLICT` is asked of no nullable key anywhere here (6c-4).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 174.0  THE INSTRUCTOR ROLE, GUARANTEED BEFORE 174.4 BINDS TO IT (0056a's rule, applied to the one role it missed)
-- ------------------------------------------------------------------------------------------------------------------
-- `payout_purpose_roles.role_code` REFERENCES `roles(code)` and fails LOUDLY without the row; the seed (0004) runs
-- after migrations. Copied verbatim from db/seeds/core/0004_roles_permissions.sql line 16; WHERE NOT EXISTS so a
-- seeded database is untouched.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'instructor', 'Education Instructor', 'tenant', false, true, 'M09'
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = 'instructor');

-- ------------------------------------------------------------------------------------------------------------------
-- 174.1  THE SPLIT RULE THE TENANT OWNS
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE course_royalty_rules (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid REFERENCES tenants(id),          -- NULL = the platform default every tenant inherits
  instructor_share_bps integer NOT NULL,                      -- of GROSS
  tenant_share_bps     integer NOT NULL,                      -- of GROSS
  platform_share_bps   integer NOT NULL,                      -- of GROSS (the platform's cut is platform-owned: a tenant's
                                                              -- proposal copies the platform default's figure, never chooses it)
  status               varchar(12) NOT NULL DEFAULT 'proposed',
  proposed_by          uuid REFERENCES users(id),
  proposed_at          timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid REFERENCES users(id),
  decided_at           timestamptz,
  decision_note        varchar(300),
  effective_from       timestamptz,                           -- = decided_at for an active rule
  superseded_at        timestamptz,
  CONSTRAINT ck_crr_status CHECK (status IN ('proposed', 'active', 'rejected', 'superseded')),
  CONSTRAINT ck_crr_bps_range CHECK (instructor_share_bps BETWEEN 0 AND 10000 AND tenant_share_bps BETWEEN 0 AND 10000 AND platform_share_bps BETWEEN 0 AND 10000),
  CONSTRAINT ck_crr_bps_whole CHECK (instructor_share_bps + tenant_share_bps + platform_share_bps = 10000),
  -- a tenant's rule is a person's proposal; the platform default is a migration's (Law 11)
  CONSTRAINT ck_crr_tenant_has_maker CHECK (tenant_id IS NULL OR proposed_by IS NOT NULL),
  -- MAKER <> CHECKER, both asserted NOT NULL first (0139's lesson: a CHECK that evaluates to NULL passes)
  CONSTRAINT ck_crr_maker_ne_checker CHECK (decided_by IS NULL OR (proposed_by IS NOT NULL AND decided_by <> proposed_by)),
  -- a decision is whole: who, when, and a note a person reads
  CONSTRAINT ck_crr_decision_whole CHECK (
    (status = 'proposed' AND decided_by IS NULL AND decided_at IS NULL AND effective_from IS NULL)
    OR (status IN ('active', 'superseded') AND (tenant_id IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)) AND effective_from IS NOT NULL)
    OR (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_note IS NOT NULL)),
  CONSTRAINT ck_crr_superseded_stamp CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
CALL add_std_columns('course_royalty_rules');

-- One rule in force and one awaiting a signature per tenant. NULL tenant collapses to a sentinel so the platform
-- default is one row too (a partial unique on a nullable column would admit any number of NULLs).
CREATE UNIQUE INDEX uq_crr_active_per_tenant ON course_royalty_rules (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'active';
CREATE UNIQUE INDEX uq_crr_proposed_per_tenant ON course_royalty_rules (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'proposed';
CREATE INDEX idx_crr_tenant_history ON course_royalty_rules (tenant_id, proposed_at DESC);

ALTER TABLE course_royalty_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_royalty_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_course_royalty_rules ON course_royalty_rules FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY course_royalty_rules_insert ON course_royalty_rules FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY course_royalty_rules_update ON course_royalty_rules FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

REVOKE ALL ON course_royalty_rules FROM kv_app;
REVOKE ALL ON course_royalty_rules FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON course_royalty_rules TO kv_app;
GRANT SELECT ON course_royalty_rules TO kv_readonly;

COMMENT ON TABLE course_royalty_rules IS
  'How a paid course''s GROSS is split between instructor, tenant and platform, in basis points summing to 10000 (0174). tenant_id NULL is the platform default; a tenant''s own rule is proposed by one person and decided by another (ck_crr_maker_ne_checker). Read at purchase time by education''s enrollment path; never a literal in code.';

-- THE DEFAULT. W418: instructor 80% · "Tenant + platform (20%)". The canon does not split the 20; the Revenue
-- Playbook's every seeded platform commission row (0202) gives the platform 10% OF the commission, and this row
-- follows that convention rather than inventing a new one: 18% to the tenant, 2% to the platform. It is DATA — the
-- founder changes it here or in admin-api, never in a deploy — and it is NAMED for the founder in the wave report.
INSERT INTO course_royalty_rules (tenant_id, instructor_share_bps, tenant_share_bps, platform_share_bps, status, proposed_by, proposed_at, decided_by, decided_at, decision_note, effective_from)
SELECT NULL, 8000, 1800, 200, 'active', NULL, now(), NULL, now(), 'Platform default (0174): W418''s 80/20 with the platform taking 10% of the commission, as every seeded commission_rules row does.', now()
 WHERE NOT EXISTS (SELECT 1 FROM course_royalty_rules WHERE tenant_id IS NULL AND status = 'active');

-- ------------------------------------------------------------------------------------------------------------------
-- 174.2  THE AGREEMENT ON RECORD
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE instructor_agreements (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  instructor_id        uuid NOT NULL REFERENCES instructors(id),
  version              integer NOT NULL,
  instructor_share_bps integer NOT NULL,                      -- the share at issue, snapshotted from the rule in force
  tenant_share_bps     integer NOT NULL,
  platform_share_bps   integer NOT NULL,
  rule_id              uuid REFERENCES course_royalty_rules(id),
  status               varchar(12) NOT NULL DEFAULT 'offered',
  offered_by           uuid NOT NULL REFERENCES users(id),    -- the desk (course.publish), never the instructor
  offered_at           timestamptz NOT NULL DEFAULT now(),
  accepted_by          uuid REFERENCES users(id),             -- the instructor's own user, and only theirs
  accepted_at          timestamptz,
  declined_at          timestamptz,
  superseded_at        timestamptz,
  terms_note           varchar(600),
  CONSTRAINT ck_ia_status CHECK (status IN ('offered', 'accepted', 'declined', 'superseded')),
  CONSTRAINT ck_ia_version CHECK (version >= 1),
  CONSTRAINT ck_ia_bps_whole CHECK (instructor_share_bps + tenant_share_bps + platform_share_bps = 10000),
  CONSTRAINT ck_ia_bps_range CHECK (instructor_share_bps BETWEEN 0 AND 10000 AND tenant_share_bps BETWEEN 0 AND 10000 AND platform_share_bps BETWEEN 0 AND 10000),
  CONSTRAINT ck_ia_accepted_whole CHECK ((status IN ('accepted', 'superseded') AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL) OR (status IN ('offered', 'declined') AND accepted_by IS NULL AND accepted_at IS NULL)),
  CONSTRAINT ck_ia_declined_stamp CHECK ((status = 'declined') = (declined_at IS NOT NULL)),
  CONSTRAINT ck_ia_superseded_stamp CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  UNIQUE (instructor_id, version)
);
CALL add_std_columns('instructor_agreements');
CREATE UNIQUE INDEX uq_ia_one_offered ON instructor_agreements (instructor_id) WHERE status = 'offered';
CREATE UNIQUE INDEX uq_ia_one_accepted ON instructor_agreements (instructor_id) WHERE status = 'accepted';
CREATE INDEX idx_ia_tenant_instructor ON instructor_agreements (tenant_id, instructor_id, version DESC);

-- THE WALL: the desk offers, the instructor accepts — never the same person in either seat. And a platform
-- instructor's agreement is admin-api's (Law 11).
CREATE OR REPLACE FUNCTION assert_instructor_agreement_parties() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  instr_user uuid;
  instr_tenant uuid;
BEGIN
  SELECT user_id, tenant_id INTO instr_user, instr_tenant FROM instructors WHERE id = NEW.instructor_id;
  IF instr_user IS NULL THEN
    RAISE EXCEPTION 'instructor_agreements: instructor % does not exist', NEW.instructor_id USING ERRCODE = 'check_violation';
  END IF;
  IF instr_tenant IS NULL THEN
    RAISE EXCEPTION 'instructor_agreements: instructor % is a platform instructor; its agreement is admin-api''s (Law 11)', NEW.instructor_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.tenant_id := instr_tenant;
  IF NEW.offered_by = instr_user THEN
    RAISE EXCEPTION 'instructor_agreements: an instructor cannot offer their own agreement (maker <> checker)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.accepted_by IS NOT NULL AND NEW.accepted_by <> instr_user THEN
    RAISE EXCEPTION 'instructor_agreements: only the instructor''s own user may accept (got %)', NEW.accepted_by USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ia_parties BEFORE INSERT OR UPDATE ON instructor_agreements
  FOR EACH ROW EXECUTE FUNCTION assert_instructor_agreement_parties();

ALTER TABLE instructor_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_instructor_agreements ON instructor_agreements
  USING (tenant_id = current_tenant_id());
REVOKE ALL ON instructor_agreements FROM kv_app;
REVOKE ALL ON instructor_agreements FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON instructor_agreements TO kv_app;
GRANT SELECT ON instructor_agreements TO kv_readonly;

COMMENT ON TABLE instructor_agreements IS
  'The instructor''s royalty agreement on record (0174): version, the split at issue, offered by the tenant desk, accepted only by the instructor''s own user (trg_ia_parties). Until one is accepted, the instructor''s leg of every purchase is HELD (instructor_royalty_lines.state = held_pending_agreement).';

-- ------------------------------------------------------------------------------------------------------------------
-- 174.3  THE LEDGER TO SUM — one line per paid enrollment
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE instructor_royalty_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  instructor_id        uuid NOT NULL REFERENCES instructors(id),
  instructor_user_id   uuid NOT NULL REFERENCES users(id),
  course_id            uuid NOT NULL REFERENCES courses(id),
  enrollment_id        uuid NOT NULL REFERENCES enrollments(id),
  learner_user_id      uuid NOT NULL REFERENCES users(id),
  currency_code        char(3) NOT NULL REFERENCES currencies(code),   -- the COURSE's currency, never a default
  minor_units          smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 6),   -- the currency's scale AT the purchase (6e-1)
  gross_minor          bigint NOT NULL CHECK (gross_minor > 0),
  instructor_minor     bigint NOT NULL CHECK (instructor_minor >= 0),
  tenant_minor         bigint NOT NULL CHECK (tenant_minor >= 0),
  platform_minor       bigint NOT NULL CHECK (platform_minor >= 0),
  instructor_share_bps integer NOT NULL,
  tenant_share_bps     integer NOT NULL,
  platform_share_bps   integer NOT NULL,
  rule_id              uuid REFERENCES course_royalty_rules(id),      -- NULL = the pre-rule shape (flag OFF: row royalty_bps)
  agreement_id         uuid REFERENCES instructor_agreements(id),     -- NULL = no accepted agreement at purchase
  ledger_txn_id        uuid NOT NULL REFERENCES ledger_transactions(id),
  state                varchar(24) NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  released_at          timestamptz,
  release_txn_id       uuid REFERENCES ledger_transactions(id),
  CONSTRAINT ck_irl_nets_to_zero CHECK (gross_minor = instructor_minor + tenant_minor + platform_minor),
  CONSTRAINT ck_irl_bps_whole CHECK (instructor_share_bps + tenant_share_bps + platform_share_bps = 10000),
  CONSTRAINT ck_irl_state CHECK (state IN ('paid_to_wallet', 'held_pending_agreement', 'released')),
  CONSTRAINT ck_irl_release_whole CHECK ((state = 'released') = (released_at IS NOT NULL AND release_txn_id IS NOT NULL)),
  UNIQUE (enrollment_id)                                              -- an idempotent replay posts no second line
);
CALL add_std_columns('instructor_royalty_lines');
CREATE INDEX idx_irl_statement ON instructor_royalty_lines (tenant_id, instructor_id, occurred_at DESC, id DESC);
CREATE INDEX idx_irl_sums ON instructor_royalty_lines (tenant_id, instructor_id, currency_code, state);
CREATE INDEX idx_irl_course ON instructor_royalty_lines (tenant_id, course_id);

-- APPEND-ONLY MONEY (Golden Law 2). The ONE update this row admits is held → released with its stamp and its
-- release transaction; every money column, party and currency is frozen at INSERT. True of the row whatever wrote it.
CREATE OR REPLACE FUNCTION assert_royalty_line_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.instructor_id <> OLD.instructor_id OR NEW.instructor_user_id <> OLD.instructor_user_id
     OR NEW.course_id <> OLD.course_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.learner_user_id <> OLD.learner_user_id
     OR NEW.currency_code <> OLD.currency_code OR NEW.minor_units <> OLD.minor_units
     OR NEW.gross_minor <> OLD.gross_minor OR NEW.instructor_minor <> OLD.instructor_minor
     OR NEW.tenant_minor <> OLD.tenant_minor OR NEW.platform_minor <> OLD.platform_minor
     OR NEW.instructor_share_bps <> OLD.instructor_share_bps OR NEW.tenant_share_bps <> OLD.tenant_share_bps OR NEW.platform_share_bps <> OLD.platform_share_bps
     OR NEW.ledger_txn_id <> OLD.ledger_txn_id OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id THEN
    RAISE EXCEPTION 'instructor_royalty_lines is append-only: a money column of line % cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (OLD.state = 'held_pending_agreement' AND NEW.state = 'released') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'instructor_royalty_lines: the only transition is held_pending_agreement -> released (line % asked % -> %)', OLD.id, OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'released' AND (NEW.released_at IS DISTINCT FROM OLD.released_at OR NEW.release_txn_id IS DISTINCT FROM OLD.release_txn_id) THEN
    RAISE EXCEPTION 'instructor_royalty_lines: a release is final (line %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_irl_immutable BEFORE UPDATE ON instructor_royalty_lines
  FOR EACH ROW EXECUTE FUNCTION assert_royalty_line_immutable();

ALTER TABLE instructor_royalty_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_royalty_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_instructor_royalty_lines ON instructor_royalty_lines
  USING (tenant_id = current_tenant_id());
REVOKE ALL ON instructor_royalty_lines FROM kv_app;
REVOKE ALL ON instructor_royalty_lines FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON instructor_royalty_lines TO kv_app;
GRANT SELECT ON instructor_royalty_lines TO kv_readonly;

COMMENT ON TABLE instructor_royalty_lines IS
  'One line per PAID enrollment (0174): the gross and its three legs in the COURSE''s currency at that currency''s minor_units, netting to zero by CHECK, the wallet transaction they rode on, and the instructor leg''s state (paid_to_wallet | held_pending_agreement | released). W418''s every figure is a SUM over this table per currency; no total is stored anywhere. Append-only by trigger.';

-- ------------------------------------------------------------------------------------------------------------------
-- 174.4  THE VOCABULARY AND THE MAP — money out rides the existing plane
-- ------------------------------------------------------------------------------------------------------------------
-- `WHERE NOT EXISTS`, never ON CONFLICT (a platform row's tenant_id IS NULL — 6c-4's finding). Mirrored identically in
-- db/seeds/core/0005_lookup_vocabularies.sql for a fresh install; neither may diverge from the other.
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('payout_purpose', 'course_royalty', 'Instructor course royalty',
     '{"rides_batch":true,"reason":"W418: a royalty payout rides the tenant''s payout batch (TENANT-4b two-person gate) and never leaves queued unbatched (0174)."}', 10),
    ('ledger_txn_type', 'course_royalty_release', 'Course royalty released from hold on agreement acceptance (instructor hold -> main)', '{}', 20)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- 0125's map: royalty money is claimed AS an instructor. A farmer who authored a course under `course.author` but
-- holds no `instructor` role is refused BY NAME by the KYC gate (RoleKycRequiredError names the role), which is the
-- strict reading 0125 chose for every purpose.
INSERT INTO payout_purpose_roles (purpose_code, role_code, rationale) VALUES
  ('course_royalty', 'instructor', 'Course royalty is claimed as an instructor: the agreement on record (instructor_agreements) is with the person in that capacity, and their KYC as an instructor is what the tenant relied on (0174).')
ON CONFLICT (purpose_code, role_code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 174.5  THE BATCH GATE, FIX-FORWARD: a purpose that RIDES THE BATCH may not leave `queued` unbatched
-- ------------------------------------------------------------------------------------------------------------------
-- 0114's function is re-created (never edited) with one more refusal. ADMIN-6b's ruling stands for every other
-- purpose — a person's own wallet withdrawal needs no second human. This purpose declares otherwise in its own meta
-- (data, Law 6), and the trigger reads the declaration: an unbatched course_royalty payout stays queued until a
-- tenant maker batches it and a different human approves (0143).
CREATE OR REPLACE FUNCTION assert_payout_batch_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_status text;
  rides boolean;
BEGIN
  IF OLD.status <> 'queued' OR NEW.status = 'queued' THEN
    RETURN NEW;
  END IF;
  IF NEW.batch_id IS NULL THEN
    -- 0174: a purpose declaring rides_batch may not leave queued without a batch (and so without two signatures).
    SELECT COALESCE((lv.meta->>'rides_batch')::boolean, false) INTO rides FROM lookup_values lv WHERE lv.id = NEW.purpose_id;
    IF COALESCE(rides, false) AND NEW.status NOT IN ('cancelled') THEN
      RAISE EXCEPTION 'payout % has a purpose that rides the batch; it may not leave queued without an approved batch (two-person rule, 0174)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO batch_status FROM payout_batches WHERE id = NEW.batch_id;
  IF batch_status IS NULL THEN
    RAISE EXCEPTION 'payout % names batch % which does not exist; a batched payout cannot execute without an approved batch',
      NEW.id, NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF batch_status NOT IN ('approved','executing') THEN
    RAISE EXCEPTION 'payout % belongs to batch % in status %; money may only leave an approved batch (two-person rule)',
      NEW.id, NEW.batch_id, batch_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- The trigger `trg_payout_batch_approved` (0114) binds to the function by name; re-creating the function is enough.

-- The trigger runs as the executor's role (kv_relay claims; kv_app requests), which must read the purpose row.
GRANT SELECT ON lookup_values TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 174.5b FOUND ON THE WAY IN: TENANT-4b's APPROVAL PLANE COULD NEVER INSERT A BATCH — 0114's CHECK REFUSED IT
-- ------------------------------------------------------------------------------------------------------------------
-- 0114 (ADMIN-6b) added `ck_payout_batch_approval_evidence`: a batch may be `approved|executing|executed` only with
-- `approved_by_admin_id` + `approved_at`, OR be `open|returned|failed`. 0143 (TENANT-4b) then built the tenant plane on
-- NEW statuses — `pending_approval`, `rejected`, `expired` — and its own evidence columns (`decided_by`, `decided_at`),
-- widened `ck_payout_batch_status` to admit them (and, in doing so, DROPPED `returned`, 0114's own status) — and never
-- touched 0114's evidence CHECK. So `PayoutApprovalService.prepare`'s INSERT of a `pending_approval` row fails with
-- 23514 on any real database (proven by this wave's live suite; probed by hand:
--   INSERT INTO payout_batches (…status…) VALUES (…'pending_approval'…) → violates check constraint
--   "ck_payout_batch_approval_evidence"), and a tenant-plane approval (`decided_by` set, `approved_by_admin_id` NULL)
-- would fail the same way one step later. No integration spec covered `prepare` (`grep -rln "\.prepare(" apps/api/src
-- --include=*.spec.ts` → only this wave's), which is how W146's two-person gate shipped unreachable — 0143's unit
-- specs mocked the repository. A royalty payout RIDES this batch (174.5), so the gate must actually admit one.
--
-- Fix-forward, keeping BOTH planes' intent: evidence is required for approved|executing|executed from EITHER plane
-- (admin: approved_by_admin_id + approved_at; tenant: decided_by + decided_at — maker ≠ checker is each plane's own
-- CHECK), and every status either plane writes is admitted. NOT VALID as 0114's was (binds every future write; scans
-- nothing — the table's rows are 0143's shape). Founder review owed (Law 9).
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_status;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_status
  CHECK (status IN ('open', 'pending_approval', 'approved', 'rejected', 'expired', 'returned', 'executing', 'executed', 'failed'));
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_approval_evidence;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_approval_evidence CHECK (
    (status IN ('approved', 'executing', 'executed')
       AND ((approved_by_admin_id IS NOT NULL AND approved_at IS NOT NULL) OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)))
    OR status IN ('open', 'pending_approval', 'rejected', 'expired', 'returned', 'failed')
  ) NOT VALID;

-- ------------------------------------------------------------------------------------------------------------------
-- 174.6  THE FLAGS (Law 8 / Law 10) — both OFF
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('course_royalty_split',
   'PC-56 TENANT-7d-money (W418): the RULE-RESOLVED royalty split on a course purchase - instructor share, TENANT share '
   'and platform share from course_royalty_rules (tenant override over the platform default), the instructor leg HELD '
   'in their hold wallet until an instructor_agreements row is accepted. OFF = the pre-0174 shape (the instructor row''s '
   'royalty_bps to their main wallet, the remainder to platform fees) - but always in the COURSE''s currency and always '
   'with an instructor_royalty_lines row recording exactly what was posted, because the currency correction and the '
   'record are not features. Money path: founder review owed (Law 9).',
   false, 100, 'experiment'),
  ('instructor_earnings',
   'PC-56 TENANT-7d-money (W418): the instructor''s earnings desk - Gross / share / tenant / platform / held / paid out / '
   'available as SUMS over instructor_royalty_lines per currency (MTD and lifetime in the cooperative''s timezone), the '
   'keyset statement, the export dataset education.instructor_earnings, the payout request (purpose course_royalty, '
   'rides the tenant''s two-person batch), the agreement and the tenant''s rule surfaces. OFF = the API refuses the read '
   'and W418 says earnings are not switched on - never a page of zeroes.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 174.7  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It rewrites no history.** Every pre-0174 `course_purchase` transaction booked its legs in the default INR and
--     sent the remainder to platform fees. Those rows are honest about what happened and dishonest about what should
--     have; a migration that re-posted them would be a machine deciding a money question. The founder's
--     reconciliation query (run on the dev DB by the wave: 0 rows) is in the wave report, with the two choices.
--   • **It refunds nothing.** No line for a refunded enrollment exists because no refund path exists for a course
--     (education has no refund act); named.
--   • **It does not split the 20 for the founder.** 1800/200 is a default row following the seeded convention; it is
--     data, and the report names the decision.
--   • **It touches no `commission_rules` row.** That engine prices marketplace SALES (source direct|auction|…); a
--     tenant's general marketplace override must never silently reprice its courses, so the course split has its own
--     small rule table with the same shape (bps, tenant NULL = platform default) rather than a `source='course'` row
--     that `resolveBest`'s `source IS NULL` matching would confuse with a 3.5% crop commission.
