-- ==================================================================================================================
-- MIGRATION 0234 — PC-56 HOTFIX-12 · NO RATE CHANGE WITHOUT A SECOND PERSON AND A RECORD — a milk rate card learns WHO
-- created it, WHO approved it and WHEN; the database refuses a row on which the approver is the creator, refuses an
-- approved card whose prices or dates are edited afterwards, and refuses two approved cards for one milk type in force
-- on the same day. Three columns (and a foreign key on a fourth that already existed), three CHECKs, one trigger, one
-- exclusion constraint, one notification catalogue row; no grant, no policy, no flag, no new table.
-- (Founder decisions, 2026-11-08, answered by the founder himself: `05_OPS.md` "OPS-3 SPLIT"; `survey_ops3.md` Q1-A —
-- every new rate card is recorded; a second person approves it before it prices anything (the creator cannot approve);
-- it cannot start before today (the tenant's today, in its own zone); only one card in force per milk type; members are
-- told in their own language when it is approved (push or in-app, never SMS) — and Q1-sub: the cards existing when the
-- rule ships keep pricing. Brief `wave-reports/brief_hotfix12.md` §D/§E; survey §2 F-1, §3 OPS3-B1, §5 item 1.)
-- FOUNDER'S FOLLOW-UP (2026-11-08, on the builder's §7 Q1, "the same-day split"): a card starts on the tenant's TOMORROW at the
-- earliest — today itself is refused at create and at approval — so pricing changes only at midnight and no day is ever split
-- between two cards. No one-administrator exception: two people, always.
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0233 are applied; nothing here edits them. 0009's
-- `milk_rate_cards` table, add_std_columns' `created_by` (0001:71, never written by any code until this hotfix) and the
-- 0001 `btree_gist` extension are REUSED UNCHANGED; 0233's NULL-tolerant CHECK shape and 0178/0203's trigger shape —
-- the admin realm by `kv_admin` or `pg_roles.rolsuper`, the session person by `kv_session_user()` (0192) — are copied.)
--
-- CLASS — MONEY PATH (Law 9 / KRISHALAYA_DEV_CONTRACT.md §8 "a payment code path … always founder-reviewed before
-- merge"): this file moves NO rupee; it decides WHO MAY set the rate that prices every member's milk, and FROM WHEN. No
-- ledger table, no wallet account, no posting and no money column is touched, so no CODEOWNERS ledger review is
-- triggered (krishalaya/CLAUDE.md Law 9). The founder's Law 9 review of every line stands before merge, in the REFUSING
-- direction only.
--
-- ==================================================================================================================
--
-- WHY. Until this file a rate card — the half of every farmer's pay that turns weight, fat and SNF into rupees — was
-- created by ONE person, with no audit row, no second person and no notice; it could take effect in the PAST (pricing
-- every backdated pour after it), and because nothing closed a predecessor's `effective_to`, two cards could be in force
-- for one milk type with `resolveActive` silently picking one (survey F-1, C-3, C-9; MC :5959-5960, :6857-6862). 0009
-- called this table "versioned" (0009:268); it has no version column and never had one.
--
-- WHAT EXISTS AFTER THIS FILE
--   234.1  milk_rate_cards.created_by gains a FOREIGN KEY to users(id). The column itself is add_std_columns' (0001:71),
--          present since 0009 and written by nothing until HOTFIX-12, so every row before this file holds NULL. From
--          this hotfix the service writes it, and the trigger (234.4) refuses a new row without it.
--   234.2  milk_rate_cards.approved_by uuid → users(id), approved_at timestamptz, approved_before_rule boolean NOT NULL
--          DEFAULT false. A card prices pours ONLY when `approved_at IS NOT NULL` (`MilkRateCardRepository.resolveActive`).
--   234.3  THE RULE AS A ROW FACT:
--          ck_rate_card_approver_ne_creator  approved_by IS NULL OR (created_by IS NOT NULL AND approved_by <> created_by)
--            — the brief's `approved_by IS NULL OR approved_by <> created_by`, made strict on one side: with a NULL
--              creator `approved_by <> NULL` is NULL and a CHECK passes NULL, so an approver could otherwise be stamped
--              on a card whose creator nobody knows. An unknown creator is not a "first person".
--          ck_rate_card_approval_stamp       the three legal shapes of the approval columns:
--              awaiting a second person   approved_at NULL     approved_by NULL     approved_before_rule false
--              approved by a second person approved_at set     approved_by set      approved_before_rule false
--              existed before this rule   approved_at set      approved_by NULL     approved_before_rule true
--   234.4  milk_rate_cards_hf12_guard (BEFORE INSERT OR UPDATE, outside the admin realm):
--          INSERT  a card is born AWAITING A SECOND PERSON (no approval stamp, never `approved_before_rule`), names its
--                  creator, and the creator is the person in this session when one is set.
--          UPDATE  tenant, creator, `created_at` and `approved_before_rule` never move.
--                  APPROVAL (an unapproved row gaining its stamp): the approver is the person in this session — a
--                  session with no person cannot approve — and the card's `effective_from` is AFTER the tenant's
--                  today in its own zone (`tenants.country_code → countries.timezone`, the 6c-1 rule): tomorrow at the
--                  earliest, so a card never starts pricing in the past or part-way through a day, whatever wrote the row.
--                  AN APPROVED CARD (including a pre-rule one) IS FROZEN: no un-approving, no re-stamping, and no change
--                  to its name, milk type, pricing model, the three rates, the premium slabs (`bonus_rules`),
--                  `effective_from`, `is_active` or `deleted_at`. ONE column may move: `effective_to`, and only EARLIER
--                  (or from open to a date), never before the tenant's today and never before its own start — the
--                  shape of closing a predecessor when its successor is approved (the service does exactly that, in
--                  the approval's transaction). Verified as the columns that set or gate a price: `priceMinor` reads the
--                  model, the three rates and the slabs (milk-rate-card.entity.ts); `resolveActive` reads tenant, milk
--                  type, `is_active`, `deleted_at`, the two dates and (from this file) `approved_at`. `updated_at` /
--                  `updated_by` stay free (0001's `_uat` trigger writes the first on every UPDATE).
--          The ADMIN REALM (kv_admin, or a superuser as pg_roles knows one — the 0203 rule) is exempt, exactly as 0203's
--          guards are: an operator repairing data by hand, a migration, and the test harness's own fixtures.
--   234.5  ex_rate_card_one_in_force — EXCLUDE USING gist (tenant_id =, animal_type =, daterange(effective_from,
--          effective_to, '[]') &&) WHERE (approved_at IS NOT NULL AND is_active AND deleted_at IS NULL). btree_gist IS
--          installed (0001:34 — checked, not installed here), so the DATABASE refuses two approved, active cards for one
--          (tenant, milk type) in force on any common day, whatever wrote them. An UNAPPROVED card is outside the
--          constraint on purpose: it prices nothing, and a draft for next month may sit beside the card in force today.
--   234.6  The PRE-RULE cards (founder Q1-sub, "the cards existing when the rule ships keep pricing"): every row present
--          when this file runs is marked `approved_before_rule = true`, `approved_at = now()` (the instant the rule
--          shipped — NOT a claim that anyone approved it then), `approved_by` NULL. They keep pricing; they are frozen
--          like any approved card; the console names them "existed before this rule". Before marking them, this file
--          REFUSES TO RUN if two pre-rule cards for one (tenant, milk type) are already in force on a common day — the
--          exclusion could not be added over them, and choosing which of two live cards stops pricing a farmer's milk
--          is a money decision this file must not make silently.
--   234.7  notification_events row `dairy.rate_card_approved` — 'important', ["push","inapp"], not mutable. NO SMS: an SMS
--          template needs a DLT registration this platform has not made (MC :6054). The copy (en/hi/gu × push/inapp)
--          and its declared variables live in seed core/0007, above the version backfill (the TENANT-6d-1 NOTE).
--   234.8  COMMENTs naming the founder decision on each new column and on the table — and correcting, in prose, 0009's
--          "versioned" (0009:268): there is no version column; from this file a card is RECORDED (an audit row on
--          create and on approval), APPROVED by a second person, and SUPERSEDED by closing its `effective_to`.
--
-- NO GRANT: kv_app already holds TABLE-level INSERT + UPDATE on milk_rate_cards and no DELETE (0079:285-320), which
-- covers new columns; the live spec pins that kv_app cannot set approved_by = created_by (CHECK) nor edit an approved
-- card (trigger).
-- NO POLICY / NO NEW TABLE: adding columns needs no RLS change, so the RLS gate count is UNCHANGED (asserted in QA).
-- NO FLAG (Law 10 reasoning, the HOTFIX precedents): a refusal on a money path is not a feature, and a kill-switch on it
-- would be a switch that re-opens the door. The member notice is not flagged either: it is the founder's Q1-A, and the
-- whole module still sits behind `dairy` OFF (seed 0009_feature_flags:36).
-- NOTHING ON THE PARTNER AXIS (kv_partner, current_partner_id(), the partner definers) is touched.
--
-- OWNER: plain DDL on a tenant table; the guard is SECURITY INVOKER (it reads `tenants` / `countries` as the writing
-- role, as `DairyNoticeVarsService.moneyContext` already does under RLS); nothing here runs as a definer.
--
-- SHARDS: milk_rate_cards carries tenant_id and lives on that tenant's shard; the columns, CHECKs, trigger and exclusion
-- are per-tenant facts (tenant_id is the exclusion's first key), so every shard runs this file unchanged and no
-- cross-shard read exists. The catalogue row is platform reference data, inserted ON CONFLICT DO NOTHING on each.
--
-- REVERSAL (hand-run, never by the runner; revert the API's HOTFIX-12 code in modules/dairy FIRST — the service and the
-- repository read and write these columns, and resolveActive prices only approved cards):
--   DROP TRIGGER IF EXISTS milk_rate_cards_hf12_guard ON milk_rate_cards;
--   DROP FUNCTION IF EXISTS milk_rate_cards_hf12_guard();
--   ALTER TABLE milk_rate_cards
--     DROP CONSTRAINT IF EXISTS ex_rate_card_one_in_force,
--     DROP CONSTRAINT IF EXISTS ck_rate_card_approval_stamp,
--     DROP CONSTRAINT IF EXISTS ck_rate_card_approver_ne_creator,
--     DROP CONSTRAINT IF EXISTS fk_milk_rate_cards_created_by,
--     DROP COLUMN IF EXISTS approved_before_rule,
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS approved_by;
--   (created_by is 0001's column and stays.) The catalogue row may stay (an uncatalogued event fails closed —
--   NotificationService.fanout records nothing for it); if removed: DELETE its templates, versions and variables first.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 234.1–234.2  THE CREATOR, THE SECOND PERSON AND THE INSTANT
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_rate_cards
  ADD COLUMN IF NOT EXISTS approved_by          uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at          timestamptz,
  ADD COLUMN IF NOT EXISTS approved_before_rule boolean NOT NULL DEFAULT false;

ALTER TABLE milk_rate_cards DROP CONSTRAINT IF EXISTS fk_milk_rate_cards_created_by;
ALTER TABLE milk_rate_cards ADD CONSTRAINT fk_milk_rate_cards_created_by
  FOREIGN KEY (created_by) REFERENCES users(id);

-- ------------------------------------------------------------------------------------------------------------------
-- 234.6  THE PRE-RULE CARDS KEEP PRICING (founder Q1-sub) — refused loudly if two are already in force at once
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE clashes int;
BEGIN
  SELECT count(*) INTO clashes
    FROM milk_rate_cards a
    JOIN milk_rate_cards b
      ON b.tenant_id = a.tenant_id AND b.animal_type = a.animal_type AND b.id > a.id
     AND daterange(a.effective_from, a.effective_to, '[]') && daterange(b.effective_from, b.effective_to, '[]')
   WHERE a.is_active AND a.deleted_at IS NULL AND b.is_active AND b.deleted_at IS NULL;
  IF clashes > 0 THEN
    RAISE EXCEPTION 'MIGRATION 0234: % pair(s) of existing active milk rate cards are in force for the same tenant and milk type on a common day. Founder Q1-sub keeps existing cards pricing, and only one card may be in force per milk type; which of two live cards stops pricing is a money decision this file will not make. Close one card''s effective_to by hand (admin realm) after the founder decides, then re-run.', clashes
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

UPDATE milk_rate_cards
   SET approved_before_rule = true, approved_at = now()
 WHERE approved_at IS NULL AND approved_by IS NULL AND approved_before_rule = false;

-- ------------------------------------------------------------------------------------------------------------------
-- 234.3  THE RULE, IN THE DATABASE (founder Q1-A: the creator cannot approve)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_rate_cards DROP CONSTRAINT IF EXISTS ck_rate_card_approver_ne_creator;
ALTER TABLE milk_rate_cards ADD CONSTRAINT ck_rate_card_approver_ne_creator
  CHECK (approved_by IS NULL OR (created_by IS NOT NULL AND approved_by <> created_by));

ALTER TABLE milk_rate_cards DROP CONSTRAINT IF EXISTS ck_rate_card_approval_stamp;
ALTER TABLE milk_rate_cards ADD CONSTRAINT ck_rate_card_approval_stamp
  CHECK (
       (approved_at IS NULL     AND approved_by IS NULL     AND approved_before_rule = false)
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_before_rule = false)
    OR (approved_at IS NOT NULL AND approved_by IS NULL     AND approved_before_rule = true)
  );

-- ------------------------------------------------------------------------------------------------------------------
-- 234.5  ONE CARD IN FORCE PER MILK TYPE (founder Q1-A), in the database
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE milk_rate_cards DROP CONSTRAINT IF EXISTS ex_rate_card_one_in_force;
ALTER TABLE milk_rate_cards
  ADD CONSTRAINT ex_rate_card_one_in_force EXCLUDE USING gist (
    tenant_id WITH =,
    animal_type WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (approved_at IS NOT NULL AND is_active AND deleted_at IS NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 234.4  THE GUARD — no self-approval in a session, no approval into the past, an approved card is frozen
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION milk_rate_cards_hf12_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  me    uuid := kv_session_user();
  realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);
  today date;
BEGIN
  IF realm THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_before_rule THEN
      RAISE EXCEPTION 'a milk rate card is born awaiting a second person (0234)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'a milk rate card names the person who created it (0234)' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.created_by <> me THEN
      RAISE EXCEPTION 'a milk rate card''s creator is the person in this session (0234)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.approved_before_rule IS DISTINCT FROM OLD.approved_before_rule THEN
    RAISE EXCEPTION 'milk rate card %: its tenant, creator and origin never move (0234)', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.approved_at IS NULL THEN
    IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL THEN
      IF me IS NULL OR NEW.approved_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'milk rate card %: an approval names the person approving, in their own session (0234)', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT (now() AT TIME ZONE co.timezone)::date INTO today
        FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = NEW.tenant_id;
      IF today IS NULL THEN
        RAISE EXCEPTION 'milk rate card %: the tenant has no country timezone, so its today is unknown (0234)', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.effective_from <= today THEN
        RAISE EXCEPTION 'milk rate card %: a card starts tomorrow at the earliest, never in the past or part-way through a day (effective_from % is not after the tenant''s today %) (0234)',
          OLD.id, NEW.effective_from, today USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- OLD is approved (by a second person, or before the rule): frozen.
  IF NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'milk rate card %: an approval is final (0234)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.default_name IS DISTINCT FROM OLD.default_name OR NEW.animal_type IS DISTINCT FROM OLD.animal_type
     OR NEW.pricing_model IS DISTINCT FROM OLD.pricing_model
     OR NEW.rate_per_kg_fat_minor IS DISTINCT FROM OLD.rate_per_kg_fat_minor
     OR NEW.rate_per_kg_snf_minor IS DISTINCT FROM OLD.rate_per_kg_snf_minor
     OR NEW.base_rate_per_litre_minor IS DISTINCT FROM OLD.base_rate_per_litre_minor
     OR NEW.bonus_rules IS DISTINCT FROM OLD.bonus_rules
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'milk rate card %: an approved card''s prices, dates and state are frozen (0234)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    IF NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to)
       OR NEW.effective_to < NEW.effective_from THEN
      RAISE EXCEPTION 'milk rate card %: an approved card is only ever closed earlier, never reopened or extended (0234)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT (now() AT TIME ZONE co.timezone)::date INTO today
      FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = NEW.tenant_id;
    IF today IS NULL OR NEW.effective_to < today THEN
      RAISE EXCEPTION 'milk rate card %: an approved card is never closed in the past (0234)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS milk_rate_cards_hf12_guard ON milk_rate_cards;
CREATE TRIGGER milk_rate_cards_hf12_guard BEFORE INSERT OR UPDATE ON milk_rate_cards
  FOR EACH ROW EXECUTE FUNCTION milk_rate_cards_hf12_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 234.7  THE MEMBER NOTICE'S CATALOGUE ROW (copy in seed core/0007)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('dairy.rate_card_approved', 'A new milk rate card was approved by a second person', 'important', '["push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 234.8  WHAT EACH COLUMN MEANS
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE milk_rate_cards IS
  'Milk pricing per tenant and milk type (PRD 19.4; 0009). 0009 called it "versioned": there is no version column. From '
  'PC-56 HOTFIX-12 (0234, founder Q1-A, 2026-11-08) a card is RECORDED (audit rows on create and approval), prices nothing '
  'until a SECOND person approves it (approved_by <> created_by), starts on the tenant''s tomorrow at the earliest, is FROZEN once '
  'approved, and is SUPERSEDED by closing its effective_to the day before its successor starts, in the approval''s '
  'transaction; ex_rate_card_one_in_force keeps one approved card in force per milk type.';
COMMENT ON COLUMN milk_rate_cards.created_by IS
  'PC-56 HOTFIX-12 (0234): the person who created this card (0001''s column, written for the first time by HOTFIX-12; '
  'NULL on every card created before 0234). The approver must differ (ck_rate_card_approver_ne_creator).';
COMMENT ON COLUMN milk_rate_cards.approved_by IS
  'PC-56 HOTFIX-12 (0234, founder Q1-A, 2026-11-08): the SECOND person, who approved this card in their own session. Never '
  'the creator. NULL while the card awaits a second person (it prices nothing) and on cards that existed before the rule.';
COMMENT ON COLUMN milk_rate_cards.approved_at IS
  'PC-56 HOTFIX-12 (0234): when the second person approved this card. MilkRateCardRepository.resolveActive prices only cards '
  'with approved_at set. On a card with approved_before_rule it is the instant 0234 ran, NOT an approval.';
COMMENT ON COLUMN milk_rate_cards.approved_before_rule IS
  'PC-56 HOTFIX-12 (0234, founder Q1-sub, 2026-11-08): true on every card that existed when the second-person rule shipped. '
  'Such a card keeps pricing (approved_at = the instant 0234 ran, approved_by NULL), is frozen like any approved card, and '
  'is closed by its successor''s approval like any other. Never set on a new row (milk_rate_cards_hf12_guard).';
