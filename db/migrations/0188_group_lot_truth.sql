-- ==================================================================================================================
-- MIGRATION 0188 — PC-56 TENANT-11c · GROUP LOTS — A POOLED LOT IS SOLD FOR REAL, AND EVERY FARMER IS PAID FROM THAT SALE
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0005, 0014, 0128, 0175, 0186, 0187 are applied; nothing here
-- edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION (brief_t11c.md, 2026-10-02): SETTLE PAYS FARMERS FROM THE REAL SALE, MAKER ≠ CHECKER.
--
-- What the survey proved at d0f4afe (survey_t11.md): `POST /v1/group-lots` and `POST /v1/group-lots/:id/pledges` were
-- registered twice and the LISTINGS duplicate won — it INSERTed a `version` column `group_lots` does not have, so no lot
-- could ever be created or pledged (F-3); `listed` and `sold` had no writer, so `settled` was unreachable, and if reached it
-- split a number the coordinator typed and moved no money (F-4); any holder of `group_lot.coordinate` — role `ambassador`
-- included — could ready / cancel / settle ANY lot (F-23); every member read every pledger's id and quantity (F-19); audits
-- carried no reason and no ip (F-24); cursors were milliseconds (F-25); one DTO capped the fee at 100 %, the other at 20 %,
-- and the duplicate's pledge quantity was a JS float (F-27e/f).
--
-- THE MONEY MODEL THIS FILE MAKES RECORDABLE (every move a balanced, idempotency-keyed WalletPort post):
--   • THE SALE. The lot is listed as ONE listing whose seller is the lot's coordinator (`listings.group_lot_id` = the lot,
--     min order = the whole lot). When that order COMPLETES, the existing settlement (payments' OrderCompletedHandler,
--     unchanged) pays the seller's net into the coordinator's Main and writes `settlement_lines`. A group-lots consumer then
--     reads the seller's settled amount for that order — `settlement_lines.net_minor` plus any coupon top-up the seller was
--     paid for it (TENANT-10b) — never a typed number, and in ONE transaction writes `sold_at`, `sale_order_id`,
--     `gross_proceeds_minor` and moves that amount coordinator Main → coordinator Hold, key `gl-hold:<lotId>`, txn
--     `group_lot_hold`. The pooled money cannot be spent before it is distributed.
--   • THE SETTLEMENT, IN TWO HANDS. `prepare` (the lot's coordinator or tenant_admin) computes the shares with the existing
--     `settleShares` (bigint, remainder largest-first) and writes `group_lot_settlements` + its lines — NO money.
--     `confirm` (`group_lot.settle_approve`, tenant_admin) posts ONE txn `gl-settle:<lotId>` (txn `group_lot_settle`):
--     coordinator Hold −gross, each farmer's Main +share, coordinator Main +fee. A DB trigger refuses a confirm by the
--     preparer — or by the coordinator, who is the fee's beneficiary. `refuse` (the checker, with a reason) marks the
--     preparation refused; the lot stays `sold` and may be prepared again.
--
-- WHAT THIS FILE DOES
--   188.1  VOCABULARY — ledger txn types `group_lot_hold`, `group_lot_settle` (also seed core/0005); lookup type
--          `group_lot_cancel_reason` (target missed, coordinator withdrew, quality, other + text).
--   188.2  `group_lots` — the lot number `GL-<yyyy>-<mmdd>-<nn>` (trigger), the listing link and the sale record, the
--          extend-once record, the nudge clock, the ready / cancel records, the appointment; money facts frozen by trigger;
--          the fee cap ONE value (20 % = 2000 bps).
--   188.3  `group_lot_pledges` — status (active | withdrawn | released), who recorded an on-behalf pledge, the settlement txn.
--   188.4  `group_lot_settlements` + `group_lot_settlement_lines` — the preparation and its shares; maker ≠ checker by trigger.
--   188.5  `group_lot_consents` — the appointed coordinator's recorded consent (append-only).
--   188.6  PERMISSIONS (also seed 0004) — `group_lot.settle_approve` (tenant_admin). `group_lot.coordinate` leaves role
--          `ambassador` (canon: coordinators are appointed, not role-wide); `group_lot.manage` (the tenant-wide reach: every
--          lot + appointing a coordinator) leaves `fpo_coordinator` and stays tenant_admin's.
--   188.7  NOTIFICATION CATALOGUE — `group_lot.deadline_extended`, `group_lot.cancelled`, `group_lot.nudge`,
--          `group_lot.settled` (templates in seed core/0007; reason words in seed core/0022).
--   188.8  kv_relay keeps SELECT only on `group_lots` (no relay path writes a lot: the sale consumer runs as kv_app).
--   188.9  Indexes.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • No "why pooling pays" estimate table: the panel reads confirmed `group_lot_settlements` and prints a figure only
--     when three or more of the same product exist in the tenant. No solo-lot estimate exists to compare with.
--   • No voice nudge: the nudge is a notification through the existing channels.
--   • `listings.group_lot_id` (0005) is unchanged; the listings group-lot duplicate is deleted in code, not here.
--
-- RLS DECISION: four new tables, all tenant tables (tenant_id NOT NULL): ENABLE + FORCE + the 0175 split (SELECT /
-- INSERT WITH CHECK / UPDATE USING + WITH CHECK bound to the tenant, an admin-realm policy TO kv_admin). No grant to
-- kv_relay anywhere; REVOKE ALL from kv_relay on each new table.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 188.1  VOCABULARY
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('ledger_txn_type', 'group_lot_hold',   'Group-lot sale proceeds held for distribution (coordinator main -> coordinator hold)', '{}', 30),
    ('ledger_txn_type', 'group_lot_settle', 'Group-lot settlement: pooled proceeds paid to each pledger by share + the coordinator fee (coordinator hold -> members main)', '{}', 31)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
VALUES ('group_lot_cancel_reason', 'Group lot cancel reason', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('group_lot_cancel_reason', 'target_missed',        'Target missed by the deadline',         '{}', 1),
    ('group_lot_cancel_reason', 'coordinator_withdrew', 'The coordinator withdrew',              '{}', 2),
    ('group_lot_cancel_reason', 'quality',              'Quality did not meet the buyer''s grade', '{}', 3),
    ('group_lot_cancel_reason', 'other',                'Other (reason written by the coordinator)', '{"textRequired": true}', 4)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 188.2  group_lots — NUMBER, LISTING + SALE, EXTEND ONCE, NUDGE CLOCK, READY / CANCEL RECORDS, APPOINTMENT
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS lot_no               varchar(24);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS listing_id           uuid REFERENCES listings(id);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS listed_at            timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS listed_by            uuid REFERENCES users(id);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS sold_at              timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS sale_order_id        uuid;          -- orders is partitioned (no FK), as order_items
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS gross_proceeds_minor bigint CHECK (gross_proceeds_minor IS NULL OR gross_proceeds_minor >= 0);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS hold_txn_id          uuid;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS settlement_txn_id    uuid;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS settled_at           timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS extended_once        boolean NOT NULL DEFAULT false;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS extended_at          timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS original_deadline    timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS last_nudged_at       timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS ready_at             timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS ready_reason         text CHECK (ready_reason IS NULL OR length(ready_reason) BETWEEN 3 AND 300);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS cancel_reason_id     uuid REFERENCES lookup_values(id);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS cancel_reason_text   text CHECK (cancel_reason_text IS NULL OR length(cancel_reason_text) BETWEEN 3 AND 300);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz;
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS cancelled_by         uuid REFERENCES users(id);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS appointed_by         uuid REFERENCES users(id);
ALTER TABLE group_lots ADD COLUMN IF NOT EXISTS consent_id           uuid;

ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_sale_whole;
-- A sale is recorded whole: the order, the instant, the proceeds and the hold that keeps them — or none of it.
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_sale_whole CHECK (
  (sold_at IS NULL AND sale_order_id IS NULL AND gross_proceeds_minor IS NULL AND hold_txn_id IS NULL)
  OR (sold_at IS NOT NULL AND sale_order_id IS NOT NULL AND gross_proceeds_minor IS NOT NULL AND hold_txn_id IS NOT NULL));
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_listed_whole;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_listed_whole CHECK ((listing_id IS NULL) = (listed_at IS NULL));
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_extend_whole;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_extend_whole CHECK (extended_once = (extended_at IS NOT NULL) AND extended_once = (original_deadline IS NOT NULL));
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_cancel_whole;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_cancel_whole CHECK ((cancel_reason_id IS NULL AND cancel_reason_text IS NULL) OR cancelled_at IS NOT NULL);
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_settled_whole;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_settled_whole CHECK ((settlement_txn_id IS NULL) = (settled_at IS NULL));
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_status;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_status CHECK (status IN ('pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'));
-- THE FEE CAP IS ONE VALUE: 2000 bps (20 %). The group-lots DTO allowed 10000 (100 %), the listings duplicate 2000; the
-- stricter wins because the fee is taken off every smallholder's share and the canon's own example is 50 bps. Rows
-- written before 0188 above the cap (none were writable: create always failed, F-3) would leave the constraint NOT VALID.
ALTER TABLE group_lots DROP CONSTRAINT IF EXISTS ck_gl_fee_cap;
ALTER TABLE group_lots ADD CONSTRAINT ck_gl_fee_cap CHECK (coordination_fee_bps BETWEEN 0 AND 2000) NOT VALID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_lots WHERE coordination_fee_bps NOT BETWEEN 0 AND 2000) THEN
    ALTER TABLE group_lots VALIDATE CONSTRAINT ck_gl_fee_cap;
  END IF;
END $$;

COMMENT ON COLUMN group_lots.gross_proceeds_minor IS
  'PC-56 TENANT-11c (0188, founder decision): what the lot''s sale actually paid the coordinator as seller — settlement_lines.net_minor for the sale order plus any coupon top-up settled to the seller for it (pro-rated by line total when the order also carried other listings). Written ONCE by the sale consumer, in the transaction that holds it (coordinator main -> coordinator hold, gl-hold:<lotId>). Never typed.';
COMMENT ON COLUMN group_lots.listing_id IS
  'PC-56 TENANT-11c (0188, F-4): the ONE listing the lot is sold through (seller = the coordinator, quantity = the pledged quantity, min order = the whole lot, listings.group_lot_id = this lot). Written by POST /group-lots/:id/list.';
COMMENT ON COLUMN group_lots.extended_once IS
  'PC-56 TENANT-11c (0188, A5): the pledge deadline was extended (by at most 48 h) once; a second extension is refused. original_deadline keeps the first deadline.';

-- THE LOT NUMBER. `GL-<yyyy>-<mmdd>-<nn>`: the India calendar day the lot opened and its sequence that day in the tenant.
-- Assigned BY TRIGGER at INSERT (only when the writer did not supply one), serialised per (tenant, day) by a
-- transaction-scoped advisory lock; the unique index is the second wall. Rows written before 0188 are numbered below.
CREATE OR REPLACE FUNCTION assign_group_lot_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d      date := ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'Asia/Kolkata')::date;
  prefix text := 'GL-' || to_char(d, 'YYYY') || '-' || to_char(d, 'MMDD') || '-';
  n      integer;
BEGIN
  IF NEW.lot_no IS NOT NULL AND NEW.lot_no <> '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('group_lot_no:' || NEW.tenant_id::text || ':' || prefix));
  SELECT COALESCE(max(substring(lot_no FROM length(prefix) + 1)::integer), 0) + 1 INTO n
    FROM group_lots
   WHERE tenant_id = NEW.tenant_id AND lot_no LIKE prefix || '%' AND substring(lot_no FROM length(prefix) + 1) ~ '^[0-9]+$';
  NEW.lot_no := prefix || lpad(n::text, 2, '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gl_assign_no ON group_lots;
CREATE TRIGGER trg_gl_assign_no BEFORE INSERT ON group_lots FOR EACH ROW EXECUTE FUNCTION assign_group_lot_no();

WITH numbered AS (
  SELECT id, 'GL-' || to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY') || '-' || to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') || '-'
           || lpad(row_number() OVER (PARTITION BY tenant_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date ORDER BY created_at, id)::text, 2, '0') AS no
    FROM group_lots WHERE lot_no IS NULL
)
UPDATE group_lots g SET lot_no = numbered.no FROM numbered WHERE numbered.id = g.id;
ALTER TABLE group_lots ALTER COLUMN lot_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_tenant_no ON group_lots (tenant_id, lot_no);

-- THE LIFECYCLE AND THE MONEY FACTS, AS A WALL BEHIND THE SERVICE. The edges are the state machine's
-- (modules/group-lots/domain/group-lot.state.ts); the sale record, once written, is final; extend-once never un-happens;
-- the number, the tenant, the product and the coordinator never change.
CREATE OR REPLACE FUNCTION assert_group_lot_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.lot_no <> OLD.lot_no OR NEW.product_id <> OLD.product_id
     OR NEW.coordinator_user_id <> OLD.coordinator_user_id OR NEW.unit_code <> OLD.unit_code THEN
    RAISE EXCEPTION 'group_lots: the identity of lot % (number, product, unit, coordinator) is fixed — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pledging' AND NEW.status IN ('ready', 'cancelled'))
    OR (OLD.status = 'ready'    AND NEW.status IN ('listed', 'pledging', 'cancelled'))
    OR (OLD.status = 'listed'   AND NEW.status IN ('sold', 'cancelled'))
    OR (OLD.status = 'sold'     AND NEW.status = 'settled')) THEN
    RAISE EXCEPTION 'group_lots: % → % is not a move a lot makes — PC-56 TENANT-11c', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.sale_order_id IS NOT NULL AND NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id)
     OR (OLD.gross_proceeds_minor IS NOT NULL AND NEW.gross_proceeds_minor IS DISTINCT FROM OLD.gross_proceeds_minor)
     OR (OLD.hold_txn_id IS NOT NULL AND NEW.hold_txn_id IS DISTINCT FROM OLD.hold_txn_id)
     OR (OLD.settlement_txn_id IS NOT NULL AND NEW.settlement_txn_id IS DISTINCT FROM OLD.settlement_txn_id)
     OR (OLD.listing_id IS NOT NULL AND NEW.listing_id IS DISTINCT FROM OLD.listing_id) THEN
    RAISE EXCEPTION 'group_lots: the sale record of lot % is final — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.extended_once AND (NOT NEW.extended_once OR NEW.original_deadline IS DISTINCT FROM OLD.original_deadline OR NEW.extended_at IS DISTINCT FROM OLD.extended_at) THEN
    RAISE EXCEPTION 'group_lots: lot % was already extended once — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.extended_once AND NEW.pledge_deadline <> OLD.pledge_deadline THEN
    RAISE EXCEPTION 'group_lots: lot % was already extended once; its deadline is fixed — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT OLD.extended_once AND NEW.extended_once AND NEW.pledge_deadline > OLD.pledge_deadline + interval '48 hours' THEN
    RAISE EXCEPTION 'group_lots: an extension of lot % is at most 48 hours — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gl_moves ON group_lots;
CREATE TRIGGER trg_gl_moves BEFORE UPDATE ON group_lots FOR EACH ROW EXECUTE FUNCTION assert_group_lot_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 188.3  group_lot_pledges — A PLEDGE IS A PROMISE, NOT A LOCK
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE group_lot_pledges ADD COLUMN IF NOT EXISTS status            varchar(10) NOT NULL DEFAULT 'active';
ALTER TABLE group_lot_pledges ADD COLUMN IF NOT EXISTS withdrawn_at      timestamptz;
ALTER TABLE group_lot_pledges ADD COLUMN IF NOT EXISTS recorded_by       uuid REFERENCES users(id);
ALTER TABLE group_lot_pledges ADD COLUMN IF NOT EXISTS settlement_txn_id uuid;
ALTER TABLE group_lot_pledges DROP CONSTRAINT IF EXISTS ck_glp_status;
ALTER TABLE group_lot_pledges ADD CONSTRAINT ck_glp_status CHECK (status IN ('active', 'withdrawn', 'released'));
ALTER TABLE group_lot_pledges DROP CONSTRAINT IF EXISTS ck_glp_withdrawn_whole;
ALTER TABLE group_lot_pledges ADD CONSTRAINT ck_glp_withdrawn_whole CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL));
ALTER TABLE group_lot_pledges DROP CONSTRAINT IF EXISTS ck_glp_settled_whole;
ALTER TABLE group_lot_pledges ADD CONSTRAINT ck_glp_settled_whole CHECK ((settlement_txn_id IS NULL) OR (settled_share_minor IS NOT NULL AND status = 'active'));
COMMENT ON COLUMN group_lot_pledges.status IS
  'PC-56 TENANT-11c (0188, A7): active — counts toward the lot; withdrawn — the member withdrew before the lot listed (canon: "a pledge is a promise, not a lock"); released — the lot was cancelled. A re-pledge after a withdrawal reactivates the row with the new quantity.';
COMMENT ON COLUMN group_lot_pledges.settlement_txn_id IS
  'PC-56 TENANT-11c (0188, A3): the gl-settle:<lotId> ledger txn that paid settled_share_minor to this member''s Main.';

-- ------------------------------------------------------------------------------------------------------------------
-- 188.4  group_lot_settlements + lines — THE PREPARATION, AND THE SECOND PERSON WHO CONFIRMS IT
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_lot_settlements (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  group_lot_id         uuid NOT NULL REFERENCES group_lots(id),
  coordinator_user_id  uuid NOT NULL REFERENCES users(id),
  sale_order_id        uuid NOT NULL,
  product_id           uuid NOT NULL REFERENCES products(id),
  unit_code            varchar(20) NOT NULL,
  quantity             numeric(14,3) NOT NULL CHECK (quantity > 0),
  gross_minor          bigint NOT NULL CHECK (gross_minor >= 0),
  fee_bps              integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 2000),
  fee_minor            bigint NOT NULL CHECK (fee_minor >= 0),
  net_minor            bigint NOT NULL CHECK (net_minor >= 0),
  status               varchar(10) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'confirmed', 'refused')),
  prepared_by          uuid NOT NULL REFERENCES users(id),
  prepared_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_by         uuid REFERENCES users(id),
  confirmed_at         timestamptz,
  confirm_reason       text CHECK (confirm_reason IS NULL OR length(confirm_reason) BETWEEN 3 AND 300),
  settlement_txn_id    uuid,
  refused_by           uuid REFERENCES users(id),
  refused_at           timestamptz,
  refuse_reason        text CHECK (refuse_reason IS NULL OR length(refuse_reason) BETWEEN 3 AND 300),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_gls_balanced CHECK (fee_minor + net_minor = gross_minor),
  CONSTRAINT ck_gls_confirmed_whole CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND settlement_txn_id IS NOT NULL)),
  CONSTRAINT ck_gls_refused_whole CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL))
  -- maker ≠ checker is ONE wall, the trigger below (trg_gls_moves) — not a second CHECK that would hide the trigger's removal.
);
-- One live preparation per lot: a refused one is history; a new preparation may follow it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gls_live ON group_lot_settlements (group_lot_id) WHERE status IN ('prepared', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_gls_product ON group_lot_settlements (tenant_id, product_id, confirmed_at DESC) WHERE status = 'confirmed';
COMMENT ON TABLE group_lot_settlements IS
  'PC-56 TENANT-11c (0188, founder decision: maker ≠ checker): a settlement of a SOLD lot. PREPARED (no money) by the lot''s coordinator or tenant_admin from group_lots.gross_proceeds_minor with settleShares; CONFIRMED by a tenant_admin holding group_lot.settle_approve who is neither the preparer nor the coordinator (trigger trg_gls_moves), which posts gl-settle:<lotId> coordinator hold -> each member''s main + the coordinator fee; or REFUSED with a reason (the lot stays sold).';

CREATE OR REPLACE FUNCTION assert_group_lot_settlement_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'group_lot_settlements is append-only: settlement % cannot be deleted — PC-56 TENANT-11c', OLD.id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'prepared' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.settlement_txn_id IS NOT NULL THEN
      RAISE EXCEPTION 'group_lot_settlements: a settlement is born prepared, with no money — PC-56 TENANT-11c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.group_lot_id <> OLD.group_lot_id OR NEW.coordinator_user_id <> OLD.coordinator_user_id
     OR NEW.sale_order_id <> OLD.sale_order_id OR NEW.product_id <> OLD.product_id OR NEW.unit_code <> OLD.unit_code OR NEW.quantity <> OLD.quantity
     OR NEW.gross_minor <> OLD.gross_minor OR NEW.fee_bps <> OLD.fee_bps OR NEW.fee_minor <> OLD.fee_minor OR NEW.net_minor <> OLD.net_minor
     OR NEW.prepared_by <> OLD.prepared_by OR NEW.prepared_at <> OLD.prepared_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'group_lot_settlements: the prepared figures of % are final — PC-56 TENANT-11c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'prepared' THEN
    RAISE EXCEPTION 'group_lot_settlements: % is already % — PC-56 TENANT-11c', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' AND (NEW.confirmed_by = OLD.prepared_by OR NEW.confirmed_by = OLD.coordinator_user_id) THEN
    RAISE EXCEPTION 'group_lot_settlements: the person who prepared settlement % (or the coordinator who earns its fee) cannot also confirm it — a second person — PC-56 TENANT-11c maker-checker', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gls_moves ON group_lot_settlements;
CREATE TRIGGER trg_gls_moves BEFORE INSERT OR UPDATE OR DELETE ON group_lot_settlements FOR EACH ROW EXECUTE FUNCTION assert_group_lot_settlement_moves();

ALTER TABLE group_lot_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_lot_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gls_read ON group_lot_settlements;
DROP POLICY IF EXISTS gls_insert_own ON group_lot_settlements;
DROP POLICY IF EXISTS gls_update_own ON group_lot_settlements;
DROP POLICY IF EXISTS gls_admin_realm ON group_lot_settlements;
CREATE POLICY gls_read        ON group_lot_settlements FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY gls_insert_own  ON group_lot_settlements FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY gls_update_own  ON group_lot_settlements FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY gls_admin_realm ON group_lot_settlements FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON group_lot_settlements FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON group_lot_settlements TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, confirm_reason, settlement_txn_id, refused_by, refused_at, refuse_reason) ON group_lot_settlements TO kv_app;
GRANT SELECT ON group_lot_settlements TO kv_readonly;

CREATE TABLE IF NOT EXISTS group_lot_settlement_lines (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  settlement_id     uuid NOT NULL REFERENCES group_lot_settlements(id),
  pledge_id         uuid NOT NULL REFERENCES group_lot_pledges(id),
  farmer_user_id    uuid NOT NULL REFERENCES users(id),
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  share_minor       bigint NOT NULL CHECK (share_minor >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_glsl_pledge UNIQUE (settlement_id, pledge_id)
);
COMMENT ON TABLE group_lot_settlement_lines IS
  'PC-56 TENANT-11c (0188): one line per active pledge of a prepared settlement — the member''s quantity and share (bigint, remainder largest-first; Σ share = settlement net). Append-only.';

CREATE OR REPLACE FUNCTION group_lot_settlement_lines_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'group_lot_settlement_lines is append-only — a prepared share is never edited or removed (PC-56 TENANT-11c, 0188)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_glsl_append_only ON group_lot_settlement_lines;
CREATE TRIGGER trg_glsl_append_only BEFORE UPDATE OR DELETE ON group_lot_settlement_lines FOR EACH ROW EXECUTE FUNCTION group_lot_settlement_lines_append_only();
DROP TRIGGER IF EXISTS trg_glsl_no_truncate ON group_lot_settlement_lines;
CREATE TRIGGER trg_glsl_no_truncate BEFORE TRUNCATE ON group_lot_settlement_lines FOR EACH STATEMENT EXECUTE FUNCTION group_lot_settlement_lines_append_only();

ALTER TABLE group_lot_settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_lot_settlement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS glsl_read ON group_lot_settlement_lines;
DROP POLICY IF EXISTS glsl_insert_own ON group_lot_settlement_lines;
DROP POLICY IF EXISTS glsl_admin_realm ON group_lot_settlement_lines;
CREATE POLICY glsl_read        ON group_lot_settlement_lines FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY glsl_insert_own  ON group_lot_settlement_lines FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY glsl_admin_realm ON group_lot_settlement_lines FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON group_lot_settlement_lines FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON group_lot_settlement_lines TO kv_app;
GRANT SELECT ON group_lot_settlement_lines TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 188.5  group_lot_consents — THE APPOINTED COORDINATOR SAID YES
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_lot_consents (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  group_lot_id         uuid NOT NULL REFERENCES group_lots(id),
  coordinator_user_id  uuid NOT NULL REFERENCES users(id),
  act                  varchar(10) NOT NULL CHECK (act IN ('appoint')),
  channel              varchar(10) NOT NULL CHECK (channel IN ('voice', 'otp', 'written')),
  media_id             uuid,
  note                 text CHECK (note IS NULL OR length(note) <= 500),
  recorded_by          uuid NOT NULL REFERENCES users(id),
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_glc_evidence CHECK (channel = 'otp' OR media_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_glc_lot ON group_lot_consents (tenant_id, group_lot_id, recorded_at DESC);
COMMENT ON TABLE group_lot_consents IS
  'PC-56 TENANT-11c (0188, F-23): the recorded consent of a member appointed coordinator of a lot by tenant_admin (canon W135: "coordinators are appointed by tenant_admin"). voice / written carry evidence media; otp is the verification itself. Append-only by trigger.';

CREATE OR REPLACE FUNCTION group_lot_consents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'group_lot_consents is append-only — a recorded consent is never edited or removed (PC-56 TENANT-11c, 0188)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_glc_append_only ON group_lot_consents;
CREATE TRIGGER trg_glc_append_only BEFORE UPDATE OR DELETE ON group_lot_consents FOR EACH ROW EXECUTE FUNCTION group_lot_consents_append_only();
DROP TRIGGER IF EXISTS trg_glc_no_truncate ON group_lot_consents;
CREATE TRIGGER trg_glc_no_truncate BEFORE TRUNCATE ON group_lot_consents FOR EACH STATEMENT EXECUTE FUNCTION group_lot_consents_append_only();

ALTER TABLE group_lot_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_lot_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS glc_read ON group_lot_consents;
DROP POLICY IF EXISTS glc_insert_own ON group_lot_consents;
DROP POLICY IF EXISTS glc_admin_realm ON group_lot_consents;
CREATE POLICY glc_read        ON group_lot_consents FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY glc_insert_own  ON group_lot_consents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY glc_admin_realm ON group_lot_consents FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON group_lot_consents FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON group_lot_consents TO kv_app;
GRANT SELECT ON group_lot_consents TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 188.6  PERMISSIONS — rows here AND in seed 0004
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('group_lot.settle_approve', 'Confirm a prepared group-lot settlement: pays every pledger''s share + the fee from the held proceeds (never the preparer)', 'M12')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'group_lot.settle_approve' AND r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- Canon W135: "coordinators are appointed by tenant_admin". A coordinator acts on THEIR lot (per-lot check in the service);
-- the role-wide grant that let a village ambassador ready, cancel or settle any lot in the tenant is removed (F-23).
DELETE FROM role_permissions rp USING roles r
 WHERE rp.role_id = r.id AND r.code = 'ambassador' AND rp.permission_code = 'group_lot.coordinate';
-- `group_lot.manage` is now the TENANT-WIDE reach (every lot's coordinator acts + appointing a coordinator) — tenant_admin's.
-- fpo_coordinator held it only for the deleted listings duplicate's create route; it keeps `group_lot.coordinate`.
DELETE FROM role_permissions rp USING roles r
 WHERE rp.role_id = r.id AND r.code = 'fpo_coordinator' AND rp.permission_code = 'group_lot.manage';

-- ------------------------------------------------------------------------------------------------------------------
-- 188.7  NOTIFICATION CATALOGUE (templates: seed core/0007, above the version backfill; reason words: seed core/0022)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('group_lot.deadline_extended', 'A group lot you pledged to has a new deadline',      'informational',    '["push","inapp"]', true, false),
  ('group_lot.cancelled',         'A group lot you pledged to was cancelled',           'important', '["push","inapp"]', true, false),
  ('group_lot.nudge',             'A group lot for your crop is collecting pledges',    'informational',    '["push","inapp"]', true, false),
  ('group_lot.settled',           'Your share of a group-lot sale was paid',            'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 188.8  kv_relay — READ ONLY ON group_lots
-- ------------------------------------------------------------------------------------------------------------------
-- No relay path writes a lot: the sale consumer reads in kv_app's unit of work and enqueues on the relay's transaction (an
-- outbox row, granted since 0014); the hold + sale record run in kv_app's unit of work when that row is delivered.
REVOKE INSERT, UPDATE, DELETE ON group_lots FROM kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 188.9  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_gl_tenant_recent   ON group_lots (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gl_tenant_deadline ON group_lots (tenant_id, pledge_deadline, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gl_tenant_status   ON group_lots (tenant_id, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_listing   ON group_lots (listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_glp_lot_active     ON group_lot_pledges (tenant_id, group_lot_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_group_lot ON listings (group_lot_id) WHERE group_lot_id IS NOT NULL;
