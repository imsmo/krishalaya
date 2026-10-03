-- ==================================================================================================================
-- 0196 · PC-56 TENANT-SW-a · COMMISSION, DELIVERY ZONES, COD RECONCILIATION, POD REVIEW
--        canon W149 (money/commission) + W2431–W2433 · W233 (ops/logistics/zones) + W2848–W2854 · W243 (ops/logistics/cod)
--        + W2531–W2533 · W237 / W238 (ops/logistics/pod[/id]) + W2717–W2719
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (Law 9). MONEY — Law 9,
-- founder review owed. Migrations touching wallet/ledger need CODEOWNERS review: this file adds no ledger table and no ledger
-- grant; it adds two ledger_txn_type codes, two account codes are added in code (core/wallet/account-codes.ts).
--
-- Founder decisions (2026-10-03), built as decided:
--   • PLATFORM SHARE = PLAN FLOOR — the platform's share of a tenant commission is the tenant's PLAN's figure, never a tenant field.
--   • FREEZE AT PLACEMENT + 7-DAY NOTICE + CHECKER — the commission rule is frozen onto the order when it is placed; a tenant rule
--     change is proposed, confirmed by a second tenant_admin, effective from a midnight at least seven days out, never back-dated.
--   • COD CASH IS A LEDGER FACT — cash a rider collects is a wallet liability (the rider owes escrow), the bank deposit is the
--     platform's clearing fact; both through WalletPort, balanced and keyed.
--   • ESCROW HOLDS ONLY ON A FLAGGED POD — every delivered shipment gets a POD review; only a FLAGGED one holds settlement.
--
-- Findings closed (SWEEP survey): F-3 (tenant set the platform share), F-4 (rate re-resolved at completion; back-dating),
-- F-5 (quoted zone fee ≠ charged fee; unserviceable pincode still ordered), F-6 (0175 class on commission_rules,
-- logistics_partners, vehicles, cold_chain_logs, data_export_jobs), F-9 (commission rules and zone fees one-person),
-- F-10 (charged_to='buyer' deducted from the seller), F-16 (COD reconcile moved no money), F-21 (platform defaults seeded ×5).
--
-- SECTIONS
--   196.1  helpers — kv_ist_today(), kv_holds_any_role(), kv_commission_platform_share_bps(), platform settings
--   196.2  A1 plan floor — plans.commission_platform_share_bps (+ the kv_app write wall on it)
--   196.3  A4/F-21 platform defaults deduped (soft: deleted_at + is_active=false, logged) + one open-ended row per scope
--   196.4  A1 tenant rows backfilled to the floor (logged in commission_rule_share_backfill)
--   196.5  A5/F-6 the 0175 split on commission_rules, logistics_partners, vehicles, cold_chain_logs, data_export_jobs
--   196.6  A3 commission_rule_proposals (13b shape) + the commission_rules gate trigger (floor, 7-day notice, checker)
--   196.7  A2/B1 orders — commission_snapshot, charge_snapshot (commission_rule_snapshot deprecated), delivery_zone_id,
--          buyer_commission_minor, settlement_hold_reason; frozen-once trigger; settlement_lines buyer-commission columns
--   196.8  B2 delivery_zone_proposals + the delivery_zones gate trigger (fee re-point only onto a W150-approved definition)
--   196.9  C1 COD — cod_cash_days, cod_cash_day_carries, cod_collections, cod_shortfalls; cod_remittances.remit_txn_id
--   196.10 D1 POD — shipments.dispatched_by, pod_reviews (+ trigger), settlement_holds (+ sync trigger), settlement_deferrals;
--          disputes opened from a POD review
--   196.11 vocabulary — ledger_txn_type codes, pod_flag_reason lookup, permissions, flags, notification catalogue
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 196.1  helpers
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_ist_today() RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;
COMMENT ON FUNCTION kv_ist_today() IS
  'PC-56 TENANT-SW-a (0196): today''s date in Asia/Kolkata — the calendar every commission notice period and cash day is counted in.';

CREATE OR REPLACE FUNCTION kv_holds_any_role(p_tenant uuid, p_user uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
     WHERE utr.tenant_id = p_tenant AND utr.user_id = p_user AND r.code = ANY (p_roles)
       AND utr.is_active AND utr.deleted_at IS NULL)
   AND NOT EXISTS (
    SELECT 1 FROM tenant_member_suspensions s
     WHERE s.tenant_id = p_tenant AND s.user_id = p_user AND s.lifted_at IS NULL AND s.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION kv_holds_any_role(uuid, uuid, text[]) IS
  'PC-56 TENANT-SW-a (0196): an ACTIVE, UNSUSPENDED holder of any of the named roles in the tenant (kv_is_tenant_admin''s rule, widened to a set — the zone maker may be a tenant_admin or an fpo_coordinator). Invoker rights.';

INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class) VALUES
  ('platform.commission_platform_share_bps', 'int', '1000', 'platform',
   'PC-56 TENANT-SW-a (0196): the platform''s share (bps OF the commission) for a tenant that has no current subscription — the fallback under the plan floor (plans.commission_platform_share_bps). Seeded from the platform default of record, 1000 bps (the direct/auction platform rules); the labour rule''s 800 bps is a different rule''s share and is not a floor.', 'money_path'),
  ('platform.cod_rider_cap_minor', 'int', '1000000', 'platform',
   'PC-56 TENANT-SW-a (0196): the most COD cash (minor units) one rider may hold before remitting — canon W243 "within per-rider cap ₹10,000". A collection that would take the rider past it is refused at delivery.', 'money_path')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.2  A1 · THE PLAN FLOOR
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE plans ADD COLUMN IF NOT EXISTS commission_platform_share_bps integer NOT NULL DEFAULT 1000;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS ck_plans_commission_share;
ALTER TABLE plans ADD CONSTRAINT ck_plans_commission_share CHECK (commission_platform_share_bps BETWEEN 0 AND 10000);
COMMENT ON COLUMN plans.commission_platform_share_bps IS
  'PC-56 TENANT-SW-a (0196, founder decision "platform share = plan floor"): the platform''s share, in bps OF the commission, on every TENANT commission rule of a tenant on this plan. Written by the admin realm only (trg_plans_commission_share_wall refuses kv_app / kv_relay). Seeded 1000 bps on every plan from the platform default of record; the seeded labour rule (all categories, 150 bps, buyer) carries 800 — noted, not a floor.';

CREATE OR REPLACE FUNCTION assert_plans_commission_share_wall() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user IN ('kv_app', 'kv_relay') THEN
    IF TG_OP = 'INSERT' AND NEW.commission_platform_share_bps <> (kv_platform_setting('platform.commission_platform_share_bps') #>> '{}')::int THEN
      RAISE EXCEPTION '[PLAN_SHARE_ADMIN_REALM] a plan''s commission share is set by the admin realm — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.commission_platform_share_bps IS DISTINCT FROM OLD.commission_platform_share_bps THEN
      RAISE EXCEPTION '[PLAN_SHARE_ADMIN_REALM] a plan''s commission share is set by the admin realm — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_plans_commission_share_wall ON plans;
CREATE TRIGGER trg_plans_commission_share_wall BEFORE INSERT OR UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION assert_plans_commission_share_wall();

CREATE OR REPLACE FUNCTION kv_commission_platform_share_bps(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.commission_platform_share_bps
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = p_tenant AND s.deleted_at IS NULL AND s.status IN ('trialing', 'active', 'past_due', 'paused')
      ORDER BY s.created_at DESC LIMIT 1),
    (kv_platform_setting('platform.commission_platform_share_bps') #>> '{}')::int,
    1000)
$$;
COMMENT ON FUNCTION kv_commission_platform_share_bps(uuid) IS
  'PC-56 TENANT-SW-a (0196): the platform share floor for a tenant — its current subscription''s plan figure, else the platform setting. The ONLY source of commission_rules.platform_share_bps on a tenant row (the service writes it, trg_commission_rules_gate refuses anything else).';
REVOKE ALL ON FUNCTION kv_commission_platform_share_bps(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_commission_platform_share_bps(uuid) TO kv_app, kv_relay, kv_admin;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.3  A4 / F-21 · THE PLATFORM DEFAULTS, ONCE
-- 15 NULL-tenant rows = 3 rules × 5 seed runs. Duplicates of the same scope (source, category, seller role) are SOFT-retired
-- (deleted_at + is_active=false — nothing is deleted), keeping the lowest id; no FK points at a rule (nothing to repoint).
-- Every retired row is logged with its full content. A partial unique index then allows ONE open-ended live platform row per
-- scope, so the seed's ON CONFLICT DO NOTHING stops re-seeding. The seller role is part of the scope (deviation from the brief's
-- "(source, category)", stated): the labour default is scoped by role (worker) with source and category both NULL, and without
-- the role a future all-sources platform rule would collide with it.
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rule_dedupe_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  rule_id     uuid NOT NULL REFERENCES commission_rules(id),
  kept_id     uuid NOT NULL REFERENCES commission_rules(id),
  row_before  jsonb NOT NULL,
  retired_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE commission_rule_dedupe_log IS
  'PC-56 TENANT-SW-a (0196, F-21): the platform-default commission rows 0196 retired as seed duplicates (full row before), and the row each duplicated. Platform data — no tenant_id; append-only by grant.';
REVOKE ALL ON commission_rule_dedupe_log FROM kv_app, kv_relay;
GRANT SELECT ON commission_rule_dedupe_log TO kv_readonly;

WITH ranked AS (
  SELECT id, first_value(id) OVER w AS keep, row_number() OVER w AS rn
    FROM commission_rules
   WHERE tenant_id IS NULL AND deleted_at IS NULL AND is_active AND effective_to IS NULL
  WINDOW w AS (PARTITION BY COALESCE(source, '*'), COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            COALESCE(seller_role_id, '00000000-0000-0000-0000-000000000000'::uuid) ORDER BY id)
), logged AS (
  INSERT INTO commission_rule_dedupe_log (rule_id, kept_id, row_before)
  SELECT r.id, k.keep, to_jsonb(cr) FROM ranked r JOIN ranked k ON k.id = r.id JOIN commission_rules cr ON cr.id = r.id WHERE r.rn > 1
  RETURNING rule_id
)
UPDATE commission_rules SET is_active = false, deleted_at = now(), updated_at = now() WHERE id IN (SELECT rule_id FROM logged);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_rules_platform_scope ON commission_rules (
  (COALESCE(source, '*')), (COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE(seller_role_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE tenant_id IS NULL AND is_active AND deleted_at IS NULL AND effective_to IS NULL;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM commission_rule_dedupe_log;
  RAISE NOTICE '0196: % duplicate platform commission row(s) retired (logged in commission_rule_dedupe_log); live platform rows now %', n,
    (SELECT count(*) FROM commission_rules WHERE tenant_id IS NULL AND deleted_at IS NULL AND is_active);
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.4  A1 · EXISTING TENANT ROWS → THE FLOOR (before the gate exists)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS proposal_id uuid;
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS deactivation_proposal_id uuid;

CREATE TABLE IF NOT EXISTS commission_rule_share_backfill (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  rule_id       uuid NOT NULL REFERENCES commission_rules(id),
  old_share_bps integer NOT NULL,
  new_share_bps integer NOT NULL,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE commission_rule_share_backfill IS
  'PC-56 TENANT-SW-a (0196, F-3): every tenant commission rule whose tenant-chosen platform share 0196 moved to the tenant''s plan floor — old and new figure. Read-only history.';
ALTER TABLE commission_rule_share_backfill ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rule_share_backfill FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crsb_read ON commission_rule_share_backfill;
DROP POLICY IF EXISTS crsb_admin_realm ON commission_rule_share_backfill;
CREATE POLICY crsb_read ON commission_rule_share_backfill FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY crsb_admin_realm ON commission_rule_share_backfill FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON commission_rule_share_backfill FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON commission_rule_share_backfill TO kv_app, kv_readonly;

WITH moved AS (
  INSERT INTO commission_rule_share_backfill (tenant_id, rule_id, old_share_bps, new_share_bps)
  SELECT cr.tenant_id, cr.id, cr.platform_share_bps, kv_commission_platform_share_bps(cr.tenant_id)
    FROM commission_rules cr
   WHERE cr.tenant_id IS NOT NULL AND cr.platform_share_bps <> kv_commission_platform_share_bps(cr.tenant_id)
  RETURNING rule_id, new_share_bps
)
UPDATE commission_rules cr SET platform_share_bps = m.new_share_bps, updated_at = now() FROM moved m WHERE cr.id = m.rule_id;
DO $$ BEGIN RAISE NOTICE '0196: % tenant commission rule(s) moved to the plan floor (commission_rule_share_backfill)', (SELECT count(*) FROM commission_rule_share_backfill); END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.5  A5 / F-6 · THE 0175 SPLIT — read NULL-or-own, write own only, the admin realm named
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_rules', 'logistics_partners', 'vehicles', 'cold_chain_logs', 'data_export_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = current_tenant_id())', t || '_delete_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
  END LOOP;
END $$;
-- commission rules are effective-dated history: no tenant-realm DELETE; the relay reads nothing here (HOTFIX-2 kept it so).
REVOKE DELETE, TRUNCATE ON commission_rules FROM kv_app;
REVOKE ALL ON commission_rules FROM kv_relay;
COMMENT ON TABLE commission_rules IS
  'Revenue Playbook as data, effective-dated (0006). tenant_id NULL = platform default (admin realm); a tenant row is born ONLY from a confirmed commission_rule_proposal (0196 trg_commission_rules_gate): its platform_share_bps is the tenant''s plan floor, its effective_from at least 7 IST days after it is written, and it is never edited — only end-dated / deactivated by a second confirmed proposal. RLS (0196, the 0175 split): read NULL-or-own, write own only.';

-- ------------------------------------------------------------------------------------------------------------------
-- 196.6  A3 · commission_rule_proposals (13b shape) + THE GATE ON commission_rules
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rule_proposals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  kind            varchar(12) NOT NULL CHECK (kind IN ('create', 'deactivate')),
  target_rule_id  uuid REFERENCES commission_rules(id),
  category_id     uuid REFERENCES categories(id),
  source          varchar(20) CHECK (source IS NULL OR source IN ('direct', 'auction', 'requirement', 'subscription')),
  seller_role_id  uuid REFERENCES roles(id),
  rate_bps        integer CHECK (rate_bps IS NULL OR rate_bps BETWEEN 0 AND 10000),
  fixed_minor     bigint CHECK (fixed_minor IS NULL OR fixed_minor >= 0),
  cap_minor       bigint CHECK (cap_minor IS NULL OR cap_minor >= 0),
  charged_to      varchar(10) CHECK (charged_to IS NULL OR charged_to IN ('seller', 'buyer')),
  priority        smallint CHECK (priority IS NULL OR priority BETWEEN 0 AND 1000),
  -- create: the first IST day the rule is in force · deactivate: the first IST day it is NOT in force
  effective_from  date NOT NULL,
  effective_to    date,
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by     uuid NOT NULL REFERENCES users(id),
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  status          varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired', 'applied')),
  confirmed_by    uuid REFERENCES users(id),
  confirmed_at    timestamptz,
  rule_id         uuid,             -- create: the commission_rules row the confirmation writes (pre-allocated)
  refused_by      uuid REFERENCES users(id),
  refused_at      timestamptz,
  refuse_reason   text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  expired_at      timestamptz,
  expire_note     text,
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_crp_shape CHECK (
    (kind = 'create' AND target_rule_id IS NULL AND rate_bps IS NOT NULL AND fixed_minor IS NOT NULL AND charged_to IS NOT NULL AND priority IS NOT NULL)
    OR (kind = 'deactivate' AND target_rule_id IS NOT NULL AND rate_bps IS NULL AND fixed_minor IS NULL AND cap_minor IS NULL
        AND charged_to IS NULL AND priority IS NULL AND category_id IS NULL AND source IS NULL AND seller_role_id IS NULL AND effective_to IS NULL)),
  CONSTRAINT ck_crp_window       CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_crp_confirm_whole CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT ck_crp_confirmed    CHECK (status NOT IN ('confirmed', 'applied') OR confirmed_by IS NOT NULL),
  CONSTRAINT ck_crp_rule_id      CHECK (kind <> 'create' OR status NOT IN ('confirmed', 'applied') OR rule_id IS NOT NULL),
  CONSTRAINT ck_crp_refused_whole CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_crp_expired_whole CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  CONSTRAINT ck_crp_applied_whole CHECK ((status = 'applied') = (applied_at IS NOT NULL))
  -- maker ≠ checker is ONE wall, the trigger (trg_crp_moves) — not a CHECK that would hide the trigger's removal.
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crp_live_target ON commission_rule_proposals (tenant_id, target_rule_id) WHERE status IN ('proposed', 'confirmed') AND target_rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crp_list ON commission_rule_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crp_due ON commission_rule_proposals (tenant_id, status, effective_from) WHERE status IN ('proposed', 'confirmed');
COMMENT ON TABLE commission_rule_proposals IS
  'PC-56 TENANT-SW-a (0196, founder decision "freeze at placement + 7-day notice + checker"; canon W149 "owner + checker · touches every future order · 7-day notice enforced"). A tenant commission rule is created or deactivated only through here: a tenant_admin PROPOSES (reason 20–500, effective_from ≥ next IST midnight + 7 days); a DIFFERENT active tenant_admin CONFIRMS within 7 days (trg_crp_moves) — the confirmation writes the effective-dated rule row (or end-dates the target) in the same transaction; the registered apply job marks it APPLIED at the effective IST midnight and tells every member (tenancy.commission_rule_effective); unconfirmed after 7 days it EXPIRES.';

CREATE OR REPLACE FUNCTION assert_commission_rule_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); tgt record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'commission_rule_proposals is append-only: a proposal is never deleted — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.applied_at IS NOT NULL OR NEW.expired_at IS NOT NULL OR NEW.rule_id IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_BORN_PROPOSED] a commission proposal is born proposed — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose a commission rule change — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.effective_from < kv_ist_today() + 8 THEN
      RAISE EXCEPTION '[COMMISSION_NOTICE_7_DAYS] a commission change takes effect at an IST midnight at least 7 days after the next one (earliest %), never sooner and never back-dated — PC-56 TENANT-SW-a', kv_ist_today() + 8
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'deactivate' THEN
      SELECT tenant_id, is_active, deleted_at, effective_from, effective_to INTO tgt FROM commission_rules WHERE id = NEW.target_rule_id;
      IF NOT FOUND OR tgt.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION '[COMMISSION_TARGET_NOT_YOURS] only this organisation''s own rules can be deactivated (platform defaults are the admin realm''s) — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT tgt.is_active OR tgt.deleted_at IS NOT NULL OR (tgt.effective_to IS NOT NULL AND tgt.effective_to < NEW.effective_from) THEN
        RAISE EXCEPTION '[COMMISSION_TARGET_ENDED] that rule already ends before % — PC-56 TENANT-SW-a', NEW.effective_from USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: what was proposed is final.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.target_rule_id IS DISTINCT FROM OLD.target_rule_id
     OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.seller_role_id IS DISTINCT FROM OLD.seller_role_id
     OR NEW.rate_bps IS DISTINCT FROM OLD.rate_bps OR NEW.fixed_minor IS DISTINCT FROM OLD.fixed_minor OR NEW.cap_minor IS DISTINCT FROM OLD.cap_minor
     OR NEW.charged_to IS DISTINCT FROM OLD.charged_to OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.effective_from <> OLD.effective_from
     OR NEW.effective_to IS DISTINCT FROM OLD.effective_to OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by
     OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[COMMISSION_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-SW-a', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('refused', 'expired', 'applied') THEN
    RAISE EXCEPTION '[COMMISSION_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-SW-a', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'confirmed' THEN
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.refused_by IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_FINAL] the confirmation of % is final — PC-56 TENANT-SW-a', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'applied' AND kv_ist_today() < OLD.effective_from THEN
      RAISE EXCEPTION '[COMMISSION_NOT_DUE] proposal % takes effect on % (IST) — PC-56 TENANT-SW-a', OLD.id, OLD.effective_from USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('confirmed', 'applied') THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_MOVE] confirmed -> % is not a move — PC-56 TENANT-SW-a', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- OLD.status = 'proposed'
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[COMMISSION_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second administrator — PC-56 TENANT-SW-a maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[COMMISSION_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-SW-a', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.effective_from < kv_ist_today() + 7 THEN
      RAISE EXCEPTION '[COMMISSION_NOTICE_7_DAYS] confirmed today, % leaves members less than 7 days'' notice — propose again with a later date — PC-56 TENANT-SW-a', OLD.effective_from
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.kind = 'create' AND NEW.rule_id IS NULL THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_MOVE] a confirmed create names the rule it writes — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_MOVE] a refused proposal carries no confirmation — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[COMMISSION_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF NEW.expired_at < OLD.expires_at THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-SW-a', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[COMMISSION_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-SW-a', NEW.status USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_crp_moves ON commission_rule_proposals;
CREATE TRIGGER trg_crp_moves BEFORE INSERT OR UPDATE OR DELETE ON commission_rule_proposals FOR EACH ROW EXECUTE FUNCTION assert_commission_rule_proposal_moves();
DROP TRIGGER IF EXISTS trg_crp_no_truncate ON commission_rule_proposals;
CREATE TRIGGER trg_crp_no_truncate BEFORE TRUNCATE ON commission_rule_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_commission_rule_proposal_moves();

ALTER TABLE commission_rule_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rule_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crp_read ON commission_rule_proposals;
DROP POLICY IF EXISTS crp_insert_own ON commission_rule_proposals;
DROP POLICY IF EXISTS crp_update_own ON commission_rule_proposals;
DROP POLICY IF EXISTS crp_admin_realm ON commission_rule_proposals;
CREATE POLICY crp_read        ON commission_rule_proposals FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY crp_insert_own  ON commission_rule_proposals FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY crp_update_own  ON commission_rule_proposals FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY crp_admin_realm ON commission_rule_proposals FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON commission_rule_proposals FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON commission_rule_proposals TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, rule_id, refused_by, refused_at, refuse_reason, expired_at, expire_note, applied_at) ON commission_rule_proposals TO kv_app;
GRANT SELECT ON commission_rule_proposals TO kv_readonly;

ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_proposal_id_fkey;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES commission_rule_proposals(id);
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_deactivation_proposal_id_fkey;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_deactivation_proposal_id_fkey FOREIGN KEY (deactivation_proposal_id) REFERENCES commission_rule_proposals(id);

-- THE GATE. Platform rows (tenant_id NULL) are the admin realm's and pass (RLS already keeps kv_app off them). A TENANT row:
--   INSERT — must cite (app.commission_proposal_id) a CONFIRMED create proposal of this tenant confirmed by a different person,
--            whose pre-allocated rule_id is this row and whose terms are this row's terms; platform_share_bps = the plan floor;
--            effective_from ≥ the IST date it is written + 7 (never back-dated).
--   UPDATE — only effective_to / is_active / deactivation_proposal_id / updated_* may move, citing a confirmed-or-applied
--            deactivate proposal for THIS rule; the new end date leaves at least 7 days (≥ IST today + 6).
CREATE OR REPLACE FUNCTION assert_commission_rule_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := NULLIF(current_setting('app.commission_proposal_id', true), ''); p record; floor_bps integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_RULE_HISTORY] a tenant commission rule is history and is never deleted — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_RULE_FINAL] a tenant rule never becomes a platform default — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '[COMMISSION_PROPOSAL_REQUIRED] a tenant commission rule is written only by a confirmed proposal (owner + checker) — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM commission_rule_proposals WHERE id = pid::uuid;
  IF NOT FOUND OR p.tenant_id <> NEW.tenant_id OR p.status NOT IN ('confirmed', 'applied') OR p.confirmed_by IS NULL OR p.confirmed_by = p.proposed_by THEN
    RAISE EXCEPTION '[COMMISSION_PROPOSAL_REQUIRED] proposal % is not a confirmed two-person proposal of this organisation — PC-56 TENANT-SW-a', pid USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF p.kind <> 'create' OR p.status <> 'confirmed' OR p.rule_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION '[COMMISSION_PROPOSAL_REQUIRED] proposal % does not create this rule — PC-56 TENANT-SW-a', pid USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.category_id IS DISTINCT FROM p.category_id OR NEW.source IS DISTINCT FROM p.source OR NEW.seller_role_id IS DISTINCT FROM p.seller_role_id
       OR NEW.rate_bps <> p.rate_bps OR NEW.fixed_minor <> p.fixed_minor OR NEW.cap_minor IS DISTINCT FROM p.cap_minor OR NEW.charged_to <> p.charged_to
       OR NEW.priority <> p.priority OR NEW.effective_from <> p.effective_from OR NEW.effective_to IS DISTINCT FROM p.effective_to
       OR NEW.proposal_id IS DISTINCT FROM p.id OR NOT NEW.is_active OR NEW.deactivation_proposal_id IS NOT NULL THEN
      RAISE EXCEPTION '[COMMISSION_RULE_NOT_AS_PROPOSED] the rule written differs from what two administrators confirmed — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    floor_bps := kv_commission_platform_share_bps(NEW.tenant_id);
    IF NEW.platform_share_bps <> floor_bps THEN
      RAISE EXCEPTION '[COMMISSION_SHARE_NOT_PLAN_FLOOR] the platform share is set by the plan (% bps), never by the organisation — PC-56 TENANT-SW-a', floor_bps USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.effective_from < kv_ist_today() + 7 THEN
      RAISE EXCEPTION '[COMMISSION_NOTICE_7_DAYS] a tenant commission rule takes effect at least 7 IST days after it is written (earliest %) — never back-dated — PC-56 TENANT-SW-a', kv_ist_today() + 7
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.seller_role_id IS DISTINCT FROM OLD.seller_role_id OR NEW.rate_bps <> OLD.rate_bps OR NEW.fixed_minor <> OLD.fixed_minor
     OR NEW.cap_minor IS DISTINCT FROM OLD.cap_minor OR NEW.platform_share_bps <> OLD.platform_share_bps OR NEW.charged_to <> OLD.charged_to
     OR NEW.priority <> OLD.priority OR NEW.effective_from <> OLD.effective_from OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.created_at <> OLD.created_at OR (NEW.is_active AND NOT OLD.is_active) THEN
    RAISE EXCEPTION '[COMMISSION_RULE_FINAL] a tenant commission rule is never edited — propose a new effective-dated rule — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  IF p.kind <> 'deactivate' OR p.target_rule_id <> NEW.id OR NEW.deactivation_proposal_id IS DISTINCT FROM p.id THEN
    RAISE EXCEPTION '[COMMISSION_PROPOSAL_REQUIRED] proposal % does not deactivate this rule — PC-56 TENANT-SW-a', pid USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    IF NEW.effective_to IS DISTINCT FROM p.effective_from - 1 OR NEW.effective_to < kv_ist_today() + 6 THEN
      RAISE EXCEPTION '[COMMISSION_NOTICE_7_DAYS] a rule stops at an IST midnight at least 7 days out, as proposed — never back-dated — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NOT NEW.is_active AND OLD.is_active AND (p.status <> 'confirmed' OR kv_ist_today() < p.effective_from) THEN
    RAISE EXCEPTION '[COMMISSION_NOT_DUE] the rule stays in force until % (IST) — PC-56 TENANT-SW-a', p.effective_from USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_commission_rules_gate ON commission_rules;
CREATE TRIGGER trg_commission_rules_gate BEFORE INSERT OR UPDATE OR DELETE ON commission_rules FOR EACH ROW EXECUTE FUNCTION assert_commission_rule_write();

-- ------------------------------------------------------------------------------------------------------------------
-- 196.7  A2 / B1 · THE ORDER FREEZES WHAT IT WAS PRICED WITH
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_snapshot jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charge_snapshot jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_commission_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_hold_reason varchar(30);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_buyer_commission;
ALTER TABLE orders ADD CONSTRAINT ck_orders_buyer_commission CHECK (buyer_commission_minor >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_hold_reason;
ALTER TABLE orders ADD CONSTRAINT ck_orders_hold_reason CHECK (settlement_hold_reason IS NULL OR settlement_hold_reason IN ('pod_review', 'cod_shortfall'));

-- the charge snapshot moves to the column named for what it holds; the old column stays, deprecated (no destructive rename)
UPDATE orders SET charge_snapshot = commission_rule_snapshot WHERE commission_rule_snapshot IS NOT NULL AND charge_snapshot IS NULL;
COMMENT ON COLUMN orders.commission_rule_snapshot IS
  'DEPRECATED by PC-56 TENANT-SW-a (0196): TENANT-3a wrote the CHARGE snapshot (delivery / platform fee rules) into this column, whose name says commission. Backfilled into orders.charge_snapshot; no code writes or reads it since 0196. Kept, never dropped.';
COMMENT ON COLUMN orders.charge_snapshot IS
  'PC-56 TENANT-SW-a (0196): the buyer-charge rules this order was priced with at placement (TENANT-3a''s snapshot, under its true name) — delivery fee (the chosen ZONE''s definition when zones apply), buyer platform fee, member benefit, and the buyer commission when the frozen rule charges the buyer. Written once.';
COMMENT ON COLUMN orders.commission_snapshot IS
  'PC-56 TENANT-SW-a (0196, founder decision "freeze at placement"): the commission rule resolved at placement (rule id, rate_bps, fixed_minor, cap_minor, platform_share_bps — the plan floor — charged_to, resolved_on IST). Settlement, dispute and return pricing read THIS and never re-resolve. An order placed before 0196 has none: it is resolved once at completion on its placement date and recorded here (resolved_at_completion=true). Written once (trg_orders_frozen_once).';
COMMENT ON COLUMN orders.delivery_zone_id IS
  'PC-56 TENANT-SW-a (0196, F-5): the delivery zone the buyer chose and that served the delivery pincode at placement; its fee is the delivery fee charged. NULL when the tenant delivers without zones.';
COMMENT ON COLUMN orders.buyer_commission_minor IS
  'PC-56 TENANT-SW-a (0196, F-10): the commission (+ GST on it) charged to the BUYER at placement when the frozen rule says charged_to=buyer — part of total_minor; settlement routes it to the tenant / platform / GST and settles the seller on the full goods value.';
COMMENT ON COLUMN orders.settlement_hold_reason IS
  'PC-56 TENANT-SW-a (0196): why settlement of this order is on hold right now (a flagged POD review, or a COD shortfall) — maintained from settlement_holds by trigger; NULL = nothing holds it.';
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders (tenant_id, delivery_zone_id, created_at DESC) WHERE delivery_zone_id IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_orders_frozen_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.commission_snapshot IS NOT NULL AND NEW.commission_snapshot IS DISTINCT FROM OLD.commission_snapshot THEN
    RAISE EXCEPTION '[ORDER_SNAPSHOT_FROZEN] order % froze its commission rule at % — it is never re-priced — PC-56 TENANT-SW-a', OLD.id, OLD.commission_snapshot->>'resolvedOn' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.charge_snapshot IS NOT NULL AND NEW.charge_snapshot IS DISTINCT FROM OLD.charge_snapshot THEN
    RAISE EXCEPTION '[ORDER_SNAPSHOT_FROZEN] order % froze its charges at placement — PC-56 TENANT-SW-a', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.delivery_zone_id IS DISTINCT FROM OLD.delivery_zone_id OR NEW.buyer_commission_minor <> OLD.buyer_commission_minor THEN
    RAISE EXCEPTION '[ORDER_SNAPSHOT_FROZEN] order % froze its zone and buyer commission at placement — PC-56 TENANT-SW-a', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_frozen_once ON orders;
CREATE TRIGGER trg_orders_frozen_once BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION assert_orders_frozen_once();

ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS buyer_commission_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS buyer_commission_gst_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE settlement_lines DROP CONSTRAINT IF EXISTS ck_settlement_lines_buyer_commission;
ALTER TABLE settlement_lines ADD CONSTRAINT ck_settlement_lines_buyer_commission CHECK (buyer_commission_minor >= 0 AND buyer_commission_gst_minor >= 0);
COMMENT ON COLUMN settlement_lines.buyer_commission_minor IS
  'PC-56 TENANT-SW-a (0196, F-10): the commission the BUYER paid on this order (charged_to=buyer) — never deducted from the seller, so commission_minor / gst_minor on the seller''s line stay 0 for it; its tenant and platform parts are in tenant_commission_minor / platform_fees_minor.';
COMMENT ON COLUMN settlement_lines.buyer_commission_gst_minor IS
  'PC-56 TENANT-SW-a (0196): GST on the buyer-paid commission (booked to gst_payable from escrow) — a clawback reverses it with the line.';

-- ------------------------------------------------------------------------------------------------------------------
-- 196.8  B2 · delivery_zone_proposals + THE GATE ON delivery_zones
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_charge_definition_checker_passed(p_tenant uuid, p_def uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM charge_definitions d JOIN charge_change_proposals cp ON cp.id = d.proposal_id
     WHERE d.id = p_def AND d.tenant_id = p_tenant AND d.deleted_at IS NULL
       AND cp.tenant_id = p_tenant AND cp.status = 'applied' AND cp.decided_by IS NOT NULL AND cp.decided_by <> cp.proposed_by)
$$;
COMMENT ON FUNCTION kv_charge_definition_checker_passed(uuid, uuid) IS
  'PC-56 TENANT-SW-a (0196, F-9): a charge definition of THIS tenant that was born from an APPLIED W150 charge_change_proposal signed by a different person — the only kind a delivery zone''s fee may point at (a zone re-point cannot side-step W150''s own checker).';

ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS proposal_id uuid;

CREATE TABLE IF NOT EXISTS delivery_zone_proposals (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  kind                 varchar(12) NOT NULL CHECK (kind IN ('create', 'repoint_fee', 'deactivate', 'activate')),
  zone_id              uuid NOT NULL,     -- create: pre-allocated id of the zone the confirmation writes; else the target
  default_name         varchar(120),
  pincodes             jsonb,
  region_ids           jsonb,
  charge_definition_id uuid REFERENCES charge_definitions(id),
  reason               text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by          uuid NOT NULL REFERENCES users(id),
  proposed_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  status               varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by         uuid REFERENCES users(id),
  confirmed_at         timestamptz,
  refused_by           uuid REFERENCES users(id),
  refused_at           timestamptz,
  refuse_reason        text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  expired_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dzp_shape CHECK (
    (kind = 'create' AND default_name IS NOT NULL AND pincodes IS NOT NULL AND region_ids IS NOT NULL)
    OR (kind = 'repoint_fee' AND default_name IS NULL AND pincodes IS NULL AND region_ids IS NULL)
    OR (kind IN ('deactivate', 'activate') AND default_name IS NULL AND pincodes IS NULL AND region_ids IS NULL AND charge_definition_id IS NULL)),
  CONSTRAINT ck_dzp_confirm_whole CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT ck_dzp_confirmed     CHECK (status <> 'confirmed' OR confirmed_by IS NOT NULL),
  CONSTRAINT ck_dzp_refused_whole CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_dzp_expired_whole CHECK ((status = 'expired') = (expired_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dzp_live ON delivery_zone_proposals (tenant_id, zone_id) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_dzp_list ON delivery_zone_proposals (tenant_id, created_at DESC, id DESC);
COMMENT ON TABLE delivery_zone_proposals IS
  'PC-56 TENANT-SW-a (0196, F-9; canon W233 "logistics lead + checker"). A zone is created, its fee re-pointed, deactivated or re-activated only here: a tenant_admin or fpo_coordinator PROPOSES with a reason (20–500); a DIFFERENT active tenant_admin CONFIRMS within 7 days (trg_dzp_moves), which applies it in the same transaction (new orders only — the order freezes its zone and fee at placement). A fee may point only at a definition that passed W150''s charge_change_proposals.';

CREATE OR REPLACE FUNCTION assert_delivery_zone_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); z record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'delivery_zone_proposals is append-only — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.expired_at IS NOT NULL THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_BORN_PROPOSED] a zone proposal is born proposed — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_holds_any_role(NEW.tenant_id, NEW.proposed_by, ARRAY['tenant_admin', 'fpo_coordinator']) THEN
      RAISE EXCEPTION '[ZONE_PROPOSER_NOT_LEAD] only an active tenant_admin or fpo_coordinator may propose a zone change — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.charge_definition_id IS NOT NULL AND NOT kv_charge_definition_checker_passed(NEW.tenant_id, NEW.charge_definition_id) THEN
      RAISE EXCEPTION '[ZONE_FEE_NOT_APPROVED] a zone fee may point only at one of your charge definitions that a second person approved (W150 charges) — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind <> 'create' THEN
      SELECT tenant_id, is_active, charge_definition_id INTO z FROM delivery_zones WHERE id = NEW.zone_id;
      IF NOT FOUND OR z.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION '[ZONE_NOT_FOUND] zone % is not one of this organisation''s zones — PC-56 TENANT-SW-a', NEW.zone_id USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.kind = 'deactivate' AND NOT z.is_active) OR (NEW.kind = 'activate' AND z.is_active)
         OR (NEW.kind = 'repoint_fee' AND NEW.charge_definition_id IS NOT DISTINCT FROM z.charge_definition_id) THEN
        RAISE EXCEPTION '[ZONE_ALREADY_SO] zone % is already in that state — PC-56 TENANT-SW-a', NEW.zone_id USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.zone_id <> OLD.zone_id
     OR NEW.default_name IS DISTINCT FROM OLD.default_name OR NEW.pincodes IS DISTINCT FROM OLD.pincodes OR NEW.region_ids IS DISTINCT FROM OLD.region_ids
     OR NEW.charge_definition_id IS DISTINCT FROM OLD.charge_definition_id OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by
     OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[ZONE_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-SW-a', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[ZONE_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-SW-a', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[ZONE_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second person — PC-56 TENANT-SW-a maker-checker', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[ZONE_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm a zone change — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-SW-a', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.charge_definition_id IS NOT NULL AND NOT kv_charge_definition_checker_passed(OLD.tenant_id, OLD.charge_definition_id) THEN
      RAISE EXCEPTION '[ZONE_FEE_NOT_APPROVED] the definition this zone would charge is no longer an approved one — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF NEW.confirmed_by IS NOT NULL OR (me IS NOT NULL AND NEW.refused_by <> me)
       OR NOT kv_holds_any_role(OLD.tenant_id, NEW.refused_by, ARRAY['tenant_admin', 'fpo_coordinator']) THEN
      RAISE EXCEPTION '[ZONE_PROPOSAL_MOVE] a refusal is made by a zone lead in their own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' AND NEW.expired_at >= OLD.expires_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION '[ZONE_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-SW-a', NEW.status USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_dzp_moves ON delivery_zone_proposals;
CREATE TRIGGER trg_dzp_moves BEFORE INSERT OR UPDATE OR DELETE ON delivery_zone_proposals FOR EACH ROW EXECUTE FUNCTION assert_delivery_zone_proposal_moves();
DROP TRIGGER IF EXISTS trg_dzp_no_truncate ON delivery_zone_proposals;
CREATE TRIGGER trg_dzp_no_truncate BEFORE TRUNCATE ON delivery_zone_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_delivery_zone_proposal_moves();

ALTER TABLE delivery_zone_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_zone_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dzp_read ON delivery_zone_proposals;
DROP POLICY IF EXISTS dzp_insert_own ON delivery_zone_proposals;
DROP POLICY IF EXISTS dzp_update_own ON delivery_zone_proposals;
DROP POLICY IF EXISTS dzp_admin_realm ON delivery_zone_proposals;
CREATE POLICY dzp_read        ON delivery_zone_proposals FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY dzp_insert_own  ON delivery_zone_proposals FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY dzp_update_own  ON delivery_zone_proposals FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY dzp_admin_realm ON delivery_zone_proposals FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON delivery_zone_proposals FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON delivery_zone_proposals TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON delivery_zone_proposals TO kv_app;
GRANT SELECT ON delivery_zone_proposals TO kv_readonly;

ALTER TABLE delivery_zones DROP CONSTRAINT IF EXISTS delivery_zones_proposal_id_fkey;
ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES delivery_zone_proposals(id);

-- THE GATE: a zone's existence, its fee and its active state change only in the transaction that confirms the proposal for it
-- (app.zone_proposal_id + confirmed_at = now(): an old confirmation cannot be replayed). Name, pincodes and regions stay a direct,
-- audited, reasoned act (serviceability, not money).
CREATE OR REPLACE FUNCTION assert_delivery_zone_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := NULLIF(current_setting('app.zone_proposal_id', true), ''); p record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[ZONE_HISTORY] a delivery zone is deactivated, never deleted — orders point at it — PC-56 TENANT-SW-a' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.charge_definition_id IS NOT DISTINCT FROM OLD.charge_definition_id AND NEW.is_active = OLD.is_active
     AND NEW.tenant_id = OLD.tenant_id AND NEW.id = OLD.id AND NEW.proposal_id IS NOT DISTINCT FROM OLD.proposal_id THEN
    RETURN NEW;   -- name / pincodes / regions: direct, audited
  END IF;
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '[ZONE_PROPOSAL_REQUIRED] a zone is created, its fee re-pointed or its state changed only by a confirmed proposal (lead + checker) — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM delivery_zone_proposals WHERE id = pid::uuid;
  IF NOT FOUND OR p.tenant_id <> NEW.tenant_id OR p.zone_id <> NEW.id OR p.status <> 'confirmed' OR p.confirmed_at <> now()
     OR p.confirmed_by = p.proposed_by OR NEW.proposal_id IS DISTINCT FROM p.id THEN
    RAISE EXCEPTION '[ZONE_PROPOSAL_REQUIRED] proposal % is not this zone''s confirmation, made now by a second person — PC-56 TENANT-SW-a', pid USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF p.kind <> 'create' OR NEW.default_name <> p.default_name OR NEW.pincodes <> p.pincodes OR NEW.region_ids <> p.region_ids
       OR NEW.charge_definition_id IS DISTINCT FROM p.charge_definition_id OR NOT NEW.is_active THEN
      RAISE EXCEPTION '[ZONE_NOT_AS_PROPOSED] the zone written differs from what was confirmed — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (p.kind = 'repoint_fee' AND (NEW.charge_definition_id IS DISTINCT FROM p.charge_definition_id OR NEW.is_active <> OLD.is_active))
     OR (p.kind = 'deactivate' AND (NEW.is_active OR NEW.charge_definition_id IS DISTINCT FROM OLD.charge_definition_id))
     OR (p.kind = 'activate' AND (NOT NEW.is_active OR NEW.charge_definition_id IS DISTINCT FROM OLD.charge_definition_id))
     OR p.kind = 'create' THEN
    RAISE EXCEPTION '[ZONE_NOT_AS_PROPOSED] the change written differs from what was confirmed — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_delivery_zones_gate ON delivery_zones;
CREATE TRIGGER trg_delivery_zones_gate BEFORE INSERT OR UPDATE OR DELETE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION assert_delivery_zone_write();
REVOKE DELETE, TRUNCATE ON delivery_zones FROM kv_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON delivery_zones FROM kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.9  C1 · COD CASH AS A LEDGER FACT
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cod_cash_days (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  business_date date NOT NULL,
  status        varchar(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by     uuid NOT NULL REFERENCES users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_by     uuid REFERENCES users(id),
  closed_at     timestamptz,
  close_note    text CHECK (close_note IS NULL OR length(btrim(close_note)) BETWEEN 3 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cod_cash_day UNIQUE (tenant_id, business_date),
  CONSTRAINT ck_ccd_closed_whole CHECK ((status = 'closed') = (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
COMMENT ON TABLE cod_cash_days IS
  'PC-56 TENANT-SW-a (0196, canon W243 "Close today''s cash day (checker)"). One per tenant per IST business date. Opened by one person; CLOSED by a different person (trg_ccd_moves) only when every remittance of the day is reconciled or carried with a reason (the service checks; the carries are cod_cash_day_carries). Closing moves no money; a re-run of a close changes nothing.';

CREATE OR REPLACE FUNCTION assert_cod_cash_day_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'cod_cash_days is append-only — PC-56 TENANT-SW-a' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.closed_by IS NOT NULL THEN
      RAISE EXCEPTION '[COD_DAY_BORN_OPEN] a cash day is born open — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.opened_by <> me THEN
      RAISE EXCEPTION '[COD_DAY_NOT_YOURS] a cash day is opened in the opener''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.business_date <> OLD.business_date OR NEW.opened_by <> OLD.opened_by OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION '[COD_DAY_FINAL] a cash day''s identity is final — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION '[COD_DAY_CLOSED] the cash day % is already closed — PC-56 TENANT-SW-a', OLD.business_date USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'closed' THEN
    IF NEW.closed_by = OLD.opened_by THEN
      RAISE EXCEPTION '[COD_DAY_CHECKER_IS_MAKER] the person who opened the cash day cannot also close it — a second person — PC-56 TENANT-SW-a maker-checker' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.closed_by <> me THEN
      RAISE EXCEPTION '[COD_DAY_NOT_YOURS] a close is made in the closer''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ccd_moves ON cod_cash_days;
CREATE TRIGGER trg_ccd_moves BEFORE INSERT OR UPDATE OR DELETE ON cod_cash_days FOR EACH ROW EXECUTE FUNCTION assert_cod_cash_day_moves();

CREATE TABLE IF NOT EXISTS cod_cash_day_carries (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  cash_day_id    uuid NOT NULL REFERENCES cod_cash_days(id),
  remittance_id  uuid NOT NULL REFERENCES cod_remittances(id),
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  carried_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cod_carry UNIQUE (cash_day_id, remittance_id)
);
COMMENT ON TABLE cod_cash_day_carries IS
  'PC-56 TENANT-SW-a (0196): a remittance still open when its cash day closed, carried forward with a written reason (canon W243: every open item reconciled or carried). Append-only.';

CREATE TABLE IF NOT EXISTS cod_collections (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  shipment_id     uuid NOT NULL,
  order_id        uuid NOT NULL,
  rider_user_id   uuid NOT NULL REFERENCES users(id),
  expected_minor  bigint NOT NULL CHECK (expected_minor > 0),
  collected_minor bigint NOT NULL CHECK (collected_minor >= 0),
  ledger_txn_id   uuid,
  collected_by    uuid NOT NULL REFERENCES users(id),
  collected_at    timestamptz NOT NULL DEFAULT now(),
  business_date   date NOT NULL DEFAULT kv_ist_today(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cod_collection_shipment UNIQUE (shipment_id),
  CONSTRAINT ck_cod_collection_le CHECK (collected_minor <= expected_minor),
  CONSTRAINT ck_cod_collection_txn CHECK (collected_minor = 0 OR ledger_txn_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cod_collections_rider ON cod_collections (tenant_id, rider_user_id, collected_at);
CREATE INDEX IF NOT EXISTS idx_cod_collections_day ON cod_collections (tenant_id, business_date);
COMMENT ON TABLE cod_collections IS
  'PC-56 TENANT-SW-a (0196, founder decision "COD cash is a ledger fact"): the cash a rider took at the door for one delivered COD shipment, once per shipment. Its ledger_txn_id is the cod-collect:<shipment> transaction (escrow +, the rider''s cash_in_hand −). A collection below expected writes a cod_shortfall against the ORDER.';

CREATE TABLE IF NOT EXISTS cod_shortfalls (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  order_id         uuid NOT NULL,
  shipment_id      uuid NOT NULL,
  collection_id    uuid NOT NULL REFERENCES cod_collections(id),
  buyer_user_id    uuid NOT NULL REFERENCES users(id),
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  status           varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'collected')),
  recorded_by      uuid NOT NULL REFERENCES users(id),
  collected_by     uuid REFERENCES users(id),
  collected_at     timestamptz,
  collected_txn_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cod_shortfall_collection UNIQUE (collection_id),
  CONSTRAINT ck_cod_shortfall_collected CHECK ((status = 'collected') = (collected_by IS NOT NULL AND collected_at IS NOT NULL AND collected_txn_id IS NOT NULL))
);
COMMENT ON TABLE cod_shortfalls IS
  'PC-56 TENANT-SW-a (0196, canon W243 "short-paid cash logs against the ORDER (buyer owes), not the rider"): the BUYER owes this; reason mandatory; the order''s settlement holds (settlement_holds reason cod_shortfall) until it is collected. Never charged to the rider. A write-off is not modelled (founder question).';

ALTER TABLE cod_remittances ADD COLUMN IF NOT EXISTS remit_txn_id uuid;
ALTER TABLE cod_remittances ADD COLUMN IF NOT EXISTS ledger_amount_minor bigint;
COMMENT ON COLUMN cod_remittances.remit_txn_id IS
  'PC-56 TENANT-SW-a (0196): the cod-remit:<remittance> ledger transaction posted at reconcile (the rider''s cash_in_hand +, cash_clearing −) — NULL when none of its shipments was collected through the ledger (pre-0196 / cod_ledger OFF).';
COMMENT ON COLUMN cod_remittances.ledger_amount_minor IS
  'PC-56 TENANT-SW-a (0196): the part of amount_minor that was a ledger collection (and so is remitted on the ledger at reconcile).';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cod_cash_days', 'cod_cash_day_carries', 'cod_collections', 'cod_shortfalls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
  END LOOP;
END $$;
GRANT UPDATE (status, closed_by, closed_at, close_note) ON cod_cash_days TO kv_app;
GRANT UPDATE (status, collected_by, collected_at, collected_txn_id) ON cod_shortfalls TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 196.10 D1 · POD REVIEW, SETTLEMENT HOLDS, DEFERRED SETTLEMENT
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dispatched_by uuid;
COMMENT ON COLUMN shipments.dispatched_by IS
  'PC-56 TENANT-SW-a (0196): who dispatched the shipment for final delivery (the out-for-delivery act). With rider_user_id (the driver) it is what a POD review is checked against — "you cannot review a shipment you drove or dispatched". NULL on shipments dispatched before 0196.';

CREATE TABLE IF NOT EXISTS pod_reviews (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  shipment_id          uuid NOT NULL,
  shipment_created_at  timestamptz NOT NULL,
  order_id             uuid NOT NULL,
  driver_user_id       uuid,
  dispatcher_user_id   uuid,
  pod_media_id         uuid,
  otp_verified         boolean NOT NULL,
  delivered_at         timestamptz NOT NULL,
  timer_due_at         timestamptz NOT NULL,
  status               varchar(12) NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting', 'auto_cleared', 'flagged', 'approved', 'rejected')),
  flag_reason          varchar(20) CHECK (flag_reason IS NULL OR flag_reason IN ('mismatch', 'no_photo', 'wrong_recipient', 'weight_variance', 'other')),
  flag_note            text CHECK (flag_note IS NULL OR length(btrim(flag_note)) BETWEEN 3 AND 1000),
  variance_minor       bigint CHECK (variance_minor IS NULL OR variance_minor > 0),
  flagged_by           uuid REFERENCES users(id),
  flagged_at           timestamptz,
  reviewer_user_id     uuid REFERENCES users(id),
  claimed_at           timestamptz,
  decided_by           uuid REFERENCES users(id),
  decided_at           timestamptz,
  decision_note        text CHECK (decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 3 AND 1000),
  reject_proposed_by   uuid REFERENCES users(id),
  reject_proposed_at   timestamptz,
  checker_user_id      uuid REFERENCES users(id),
  dispute_id           uuid,
  auto_cleared_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pod_review_shipment UNIQUE (shipment_id),
  CONSTRAINT ck_pod_flag_whole     CHECK ((flag_reason IS NULL) = (flagged_by IS NULL) AND (flagged_by IS NULL) = (flagged_at IS NULL)),
  CONSTRAINT ck_pod_other_text     CHECK (flag_reason IS DISTINCT FROM 'other' OR flag_note IS NOT NULL),
  CONSTRAINT ck_pod_flagged        CHECK (status NOT IN ('flagged', 'approved', 'rejected') OR flag_reason IS NOT NULL),
  CONSTRAINT ck_pod_decided        CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_pod_rejected       CHECK (status <> 'rejected' OR (checker_user_id IS NOT NULL AND reject_proposed_by IS NOT NULL AND dispute_id IS NOT NULL)),
  CONSTRAINT ck_pod_auto           CHECK ((status = 'auto_cleared') = (auto_cleared_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_pod_reviews_queue ON pod_reviews (tenant_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_pod_reviews_timer ON pod_reviews (tenant_id, timer_due_at) WHERE status = 'awaiting';
COMMENT ON TABLE pod_reviews IS
  'PC-56 TENANT-SW-a (0196, founder decision "escrow holds only on a flagged POD"; canon W237/W238). One per delivered shipment (pod_review ON). AWAITING clears itself on a 2-hour timer (the registered job) unless FLAGGED within it; a flagged review holds the order''s settlement (settlement_holds); APPROVE releases it; REJECT needs a second person and opens a qty_mismatch dispute with the POD evidence. Nobody who drove or dispatched the shipment may flag, review, decide or check it (trg_pod_reviews_moves). Weighbridge slips: not recorded on this platform.';

CREATE OR REPLACE FUNCTION assert_pod_review_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); actor uuid;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'pod_reviews is append-only — PC-56 TENANT-SW-a' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'awaiting' OR NEW.flagged_by IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.reviewer_user_id IS NOT NULL THEN
      RAISE EXCEPTION '[POD_REVIEW_BORN_AWAITING] a POD review is born awaiting — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.timer_due_at <> NEW.delivered_at + interval '2 hours' THEN
      RAISE EXCEPTION '[POD_REVIEW_TIMER] a clean POD clears 2 hours after delivery — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.shipment_id <> OLD.shipment_id OR NEW.order_id <> OLD.order_id
     OR NEW.driver_user_id IS DISTINCT FROM OLD.driver_user_id OR NEW.dispatcher_user_id IS DISTINCT FROM OLD.dispatcher_user_id
     OR NEW.pod_media_id IS DISTINCT FROM OLD.pod_media_id OR NEW.otp_verified <> OLD.otp_verified OR NEW.delivered_at <> OLD.delivered_at
     OR NEW.timer_due_at <> OLD.timer_due_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[POD_REVIEW_FINAL] what was delivered is final — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('auto_cleared', 'approved', 'rejected') THEN
    RAISE EXCEPTION '[POD_REVIEW_CLOSED] POD review % is already % — PC-56 TENANT-SW-a', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  -- every human who touches the review in this move is checked against the driver and the dispatcher
  FOREACH actor IN ARRAY ARRAY[
      CASE WHEN NEW.flagged_by IS DISTINCT FROM OLD.flagged_by THEN NEW.flagged_by END,
      CASE WHEN NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id THEN NEW.reviewer_user_id END,
      CASE WHEN NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN NEW.decided_by END,
      CASE WHEN NEW.reject_proposed_by IS DISTINCT FROM OLD.reject_proposed_by THEN NEW.reject_proposed_by END,
      CASE WHEN NEW.checker_user_id IS DISTINCT FROM OLD.checker_user_id THEN NEW.checker_user_id END] LOOP
    CONTINUE WHEN actor IS NULL;
    IF actor = OLD.driver_user_id OR actor = OLD.dispatcher_user_id THEN
      RAISE EXCEPTION '[POD_REVIEWER_IS_DRIVER] you cannot review a shipment you drove or dispatched — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND actor <> me THEN
      RAISE EXCEPTION '[POD_REVIEW_NOT_YOURS] a POD review act is made in the actor''s own session — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF NEW.status = 'auto_cleared' THEN
    IF OLD.status <> 'awaiting' OR NEW.auto_cleared_at < OLD.timer_due_at OR NEW.flagged_by IS NOT NULL THEN
      RAISE EXCEPTION '[POD_REVIEW_MOVE] only an unflagged review clears, and only after its 2-hour timer — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'flagged' AND OLD.status = 'awaiting' AND NEW.flagged_at > OLD.timer_due_at THEN
    RAISE EXCEPTION '[POD_REVIEW_WINDOW_CLOSED] the 2-hour review window closed at % — PC-56 TENANT-SW-a', OLD.timer_due_at USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'flagged' THEN
    RAISE EXCEPTION '[POD_REVIEW_MOVE] only a flagged review is approved — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'rejected' THEN
    IF OLD.status <> 'flagged' OR OLD.reject_proposed_by IS NULL OR NEW.checker_user_id IS NULL OR NEW.checker_user_id = OLD.reject_proposed_by
       OR NEW.decided_by <> NEW.checker_user_id THEN
      RAISE EXCEPTION '[POD_REJECT_NEEDS_CHECKER] a rejection is proposed by one person and confirmed by a different one — PC-56 TENANT-SW-a maker-checker' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pod_reviews_moves ON pod_reviews;
CREATE TRIGGER trg_pod_reviews_moves BEFORE INSERT OR UPDATE OR DELETE ON pod_reviews FOR EACH ROW EXECUTE FUNCTION assert_pod_review_moves();
DROP TRIGGER IF EXISTS trg_pod_reviews_no_truncate ON pod_reviews;
CREATE TRIGGER trg_pod_reviews_no_truncate BEFORE TRUNCATE ON pod_reviews FOR EACH STATEMENT EXECUTE FUNCTION assert_pod_review_moves();

CREATE TABLE IF NOT EXISTS settlement_holds (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  order_id      uuid NOT NULL,
  reason        varchar(30) NOT NULL CHECK (reason IN ('pod_review', 'cod_shortfall')),
  source_id     uuid NOT NULL,
  opened_by     uuid REFERENCES users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  released_by   uuid REFERENCES users(id),
  released_at   timestamptz,
  release_note  text CHECK (release_note IS NULL OR length(btrim(release_note)) BETWEEN 3 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_settlement_hold_release CHECK ((released_at IS NULL) OR (release_note IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_hold_open ON settlement_holds (tenant_id, order_id, reason, source_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_holds_order ON settlement_holds (tenant_id, order_id) WHERE released_at IS NULL;
COMMENT ON TABLE settlement_holds IS
  'PC-56 TENANT-SW-a (0196): what keeps an order''s escrow from settling — a FLAGGED POD review or an open COD shortfall. The settlement handler takes these rows FOR UPDATE before it settles; with one open it records a settlement_deferral and settles nothing; releasing the last hold emits payments.settlement_hold_released, which settles the deferral through the same idempotent settle:<order> key. orders.settlement_hold_reason mirrors the open set (trigger).';

CREATE OR REPLACE FUNCTION sync_order_settlement_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r varchar(30);
BEGIN
  SELECT h.reason INTO r FROM settlement_holds h WHERE h.tenant_id = NEW.tenant_id AND h.order_id = NEW.order_id AND h.released_at IS NULL
   ORDER BY h.opened_at, h.id LIMIT 1;
  UPDATE orders SET settlement_hold_reason = r
   WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id
     AND created_at >= uuid_v7_time(NEW.order_id) - interval '5 seconds' AND created_at < uuid_v7_time(NEW.order_id) + interval '5 seconds'
     AND settlement_hold_reason IS DISTINCT FROM r;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_settlement_holds_sync ON settlement_holds;
CREATE TRIGGER trg_settlement_holds_sync AFTER INSERT OR UPDATE ON settlement_holds FOR EACH ROW EXECUTE FUNCTION sync_order_settlement_hold();

CREATE OR REPLACE FUNCTION assert_settlement_hold_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'settlement_holds is append-only — PC-56 TENANT-SW-a' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.order_id <> OLD.order_id OR NEW.reason <> OLD.reason OR NEW.source_id <> OLD.source_id
       OR NEW.opened_at <> OLD.opened_at OR NEW.opened_by IS DISTINCT FROM OLD.opened_by OR OLD.released_at IS NOT NULL THEN
      RAISE EXCEPTION '[SETTLEMENT_HOLD_FINAL] a hold is opened once and released once — PC-56 TENANT-SW-a' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_settlement_holds_moves ON settlement_holds;
CREATE TRIGGER trg_settlement_holds_moves BEFORE INSERT OR UPDATE OR DELETE ON settlement_holds FOR EACH ROW EXECUTE FUNCTION assert_settlement_hold_moves();

CREATE TABLE IF NOT EXISTS settlement_deferrals (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  order_id     uuid NOT NULL,
  payload      jsonb NOT NULL,
  deferred_at  timestamptz NOT NULL DEFAULT now(),
  settled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_settlement_deferral_order UNIQUE (tenant_id, order_id)
);
COMMENT ON TABLE settlement_deferrals IS
  'PC-56 TENANT-SW-a (0196): an order_completed settlement that arrived while a hold was open — the completion payload, kept so the release can settle it later through the same handler path. settled_at is informational; the ledger key settle:<order> is what makes a settlement happen once.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pod_reviews', 'settlement_holds', 'settlement_deferrals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
  END LOOP;
END $$;
GRANT UPDATE (status, flag_reason, flag_note, variance_minor, flagged_by, flagged_at, reviewer_user_id, claimed_at, decided_by, decided_at,
              decision_note, reject_proposed_by, reject_proposed_at, checker_user_id, dispute_id, auto_cleared_at) ON pod_reviews TO kv_app;
GRANT UPDATE (released_by, released_at, release_note) ON settlement_holds TO kv_app;
GRANT UPDATE (settled_at) ON settlement_deferrals TO kv_app;

-- disputes opened by a POD review (raised on the buyer's behalf by the desk; evidence attached)
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS opened_via varchar(12) NOT NULL DEFAULT 'party';
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS pod_review_id uuid REFERENCES pod_reviews(id);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence_media_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS opened_by_staff uuid REFERENCES users(id);
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_opened_via;
ALTER TABLE disputes ADD CONSTRAINT ck_disputes_opened_via CHECK (
  (opened_via = 'party' AND pod_review_id IS NULL AND opened_by_staff IS NULL)
  OR (opened_via = 'pod_review' AND pod_review_id IS NOT NULL AND opened_by_staff IS NOT NULL));
COMMENT ON COLUMN disputes.opened_via IS
  'PC-56 TENANT-SW-a (0196): party = raised by the buyer or seller; pod_review = opened by the logistics desk when a second person confirmed a POD rejection (raised_by is the buyer whose delivery it was, opened_by_staff is the confirming reviewer, evidence_media_ids carries the POD photo).';

ALTER TABLE pod_reviews DROP CONSTRAINT IF EXISTS pod_reviews_dispute_id_fkey;
ALTER TABLE pod_reviews ADD CONSTRAINT pod_reviews_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES disputes(id);

-- ------------------------------------------------------------------------------------------------------------------
-- 196.11 VOCABULARY — ledger txn types, POD flag reasons, permissions, flags, the notice
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order)
SELECT 'ledger_txn_type', NULL, v.code, v.name, 200
  FROM (VALUES ('cod_collection', 'COD cash collected at the door (escrow funded; the rider owes it)'),
               ('cod_remittance', 'COD cash remitted and reconciled (the rider''s cash-in-hand cleared against the bank deposit)')) AS v(code, name)
 WHERE EXISTS (SELECT 1 FROM lookup_types WHERE code = 'ledger_txn_type')
   AND NOT EXISTS (SELECT 1 FROM lookup_values lv WHERE lv.type_code = 'ledger_txn_type' AND lv.tenant_id IS NULL AND lv.code = v.code);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('pod_flag_reason', 'Why a proof of delivery was flagged', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order)
SELECT 'pod_flag_reason', NULL, v.code, v.name, v.ord
  FROM (VALUES ('mismatch', 'Quantity or item does not match the order', 10), ('no_photo', 'No delivery photo', 20),
               ('wrong_recipient', 'Handed to the wrong person', 30), ('weight_variance', 'Weight differs from the order', 40),
               ('other', 'Other (written reason)', 90)) AS v(code, name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values lv WHERE lv.type_code = 'pod_flag_reason' AND lv.tenant_id IS NULL AND lv.code = v.code);

-- the zone maker role is guaranteed here (0174's shape — 0056a carries tenant_admin, not fpo_coordinator), copied EXACTLY from seed 0004
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'fpo_coordinator', 'FPO Coordinator', 'tenant', true, true, NULL
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = 'fpo_coordinator');

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('commission.manage', 'Commission rules: propose / confirm / refuse tenant commission rule changes (a second tenant_admin confirms) — tenant_admin', NULL),
  ('logistics.zones.manage', 'Delivery zones: propose zone create / fee re-point / deactivate (tenant_admin or fpo_coordinator; a tenant_admin confirms)', NULL)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON
       (r.code = 'tenant_admin' AND p.code IN ('commission.manage', 'logistics.zones.manage'))
    OR (r.code = 'fpo_coordinator' AND p.code = 'logistics.zones.manage')
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('tenant_commission_rules', 'PC-56 TENANT-SW-a: tenant commission rule proposals (owner + checker, 7-day notice) — OFF = platform defaults govern, no tenant overrides', false, 100, '{}'),
  ('cod_ledger', 'PC-56 TENANT-SW-a: COD cash as a ledger fact (collect at delivery → rider cash-in-hand; remit at reconcile; per-rider cap; cash day) — OFF = the off-ledger worksheet', false, 100, '{}'),
  ('pod_review', 'PC-56 TENANT-SW-a: POD review on every delivered shipment (2h auto-clear; a flagged POD holds settlement) — OFF = no review rows, no holds', false, 100, '{}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('tenant.commission_rule_effective', 'A commission rule of your organisation takes effect (confirmed by two administrators, 7 days'' notice)', 'important', '["push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;
