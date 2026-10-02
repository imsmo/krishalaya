-- ==================================================================================================================
-- MIGRATION 0185 — PC-56 TENANT-10b · PROMOTIONS + COUPONS — THE TENANT WALLET FUNDS THE DISCOUNT
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0005, 0014, 0078, 0079 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION F-2 (brief_t10b.md): A COUPON DISCOUNT IS FUNDED BY THE TENANT'S OWN WALLET, NOT BY THE SELLER.
-- What the survey proved at 9743e8b (survey_t10.md F-2): the discount lowered `orders.total_minor`, the settlement handler
-- settled the seller on `total − buyer charges`, so the FARMER paid for the cooperative's promotion and no tenant account
-- was ever debited — `promotions.spent_minor` was bookkeeping. The money model this file makes recordable:
--   • AT REDEMPTION (checkout tx): tenant Main −discount → tenant Hold +discount, key `promo-hold:<orderId>:<couponId>`,
--     txn type `promo_hold`. No funds → the coupon is NOT applied (the order proceeds at full price); nothing is reserved.
--   • AT SETTLEMENT (the relay tx that settles the order): tenant Hold −discount → seller Main +discount, key
--     `promo-settle:<orderId>:<couponId>`, txn type `promo_settle`. The seller is settled on the FULL goods value.
--   • ON CANCEL / REFUND before settlement: tenant Hold −discount → tenant Main +discount, key
--     `promo-release:<orderId>:<couponId>`, txn type `promo_release`; the reservation leaves the promotion's spend.
-- Every one of those moves is a balanced WalletPort post; this file only records which one happened to which redemption.
--
-- WHAT THIS FILE DOES
--   185.1  THE VOCABULARY — `promo_hold`, `promo_settle`, `promo_release` under `ledger_txn_type` (WHERE NOT EXISTS: a
--          platform row's tenant_id IS NULL, 6c-4's finding). Mirrored identically in db/seeds/core/0005.
--   185.2  `coupon_redemptions` LEARNS WHAT HAPPENED TO ITS MONEY — `hold_txn_id` (written at INSERT, with the row),
--          `settled_txn_id` + `settled_at` (written once, by settlement), `released_txn_id` + `released_at` (written once,
--          by the cancel/refund release). A row is settled XOR released, and only a row that took a hold can be either.
--          The table stays append-only for every column it had (trigger `trg_cr_money_state`), and DELETE is refused by
--          trigger as well as by grant. A row with `hold_txn_id IS NULL` predates this file (seller-funded) or was
--          recorded by the order-created backstop when the tenant could not fund it — the screens say so by name.
--   185.3  GRANTS, NARROWLY — kv_app gains UPDATE (released_txn_id, released_at) — the release runs in the request-tier
--          unit of work. kv_relay gains SELECT and UPDATE (settled_txn_id, settled_at) ONLY: the settlement leg must ride
--          the SAME transaction as the seller's settlement (the relay's, as kv_relay), or a stale read could spend another
--          order's reservation out of the pooled Hold account. kv_relay gets no INSERT, no DELETE, no other column. The
--          DEV-47 spec (ledger-privilege-boundary) is updated in this wave to pin exactly that shape.
--   185.4  `coupon_redemption_attempts` — every validate/redeem OUTCOME (applied and declined), the W130 "Recent
--          redemptions" panel's declined rows. tenant_id NOT NULL; RLS ENABLE + FORCE with the 0175 shape (SELECT and
--          INSERT bound to current_tenant_id() with WITH CHECK, an admin-realm policy TO kv_admin); kv_app SELECT + INSERT
--          only; append-only by trigger (UPDATE, DELETE and TRUNCATE refused — Law 2), whoever asks.
--   185.5  `promotions.paused_by_user_id` / `paused_at` — THE HUMAN-PAUSE BIT (F-10). The festival scheduler never
--          re-opens a promotion a person paused. Backfill: a promotion already inactive is marked paused (`paused_at =
--          updated_at`, `paused_by_user_id` NULL = "who paused it was not recorded") — the conservative reading, because
--          nothing before this file recorded whether a person or the budget sweep turned it off.
--   185.6  Indexes for the W130 per-coupon panel, the per-order settlement read, and the tenant-wide coupon list.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • No change to any existing settlement leg or to `settlement_lines` — the seller statement line does not yet carry
--     the promotion top-up as its own column (the ledger does: `promo_settle`, referenced to the redemption).
--   • No cashback / recharge-bonus / listing-boost engine (F-24): those promotion types stay labels and are refused at
--     creation by the API (PROMO_TYPE_NO_ENGINE).
--   • No coupon-level window: a coupon's status is derived from its promotion's.
--
-- RLS DECISION: one new table (185.4), ENABLE + FORCE + the 0175 policy split. `coupon_redemptions` keeps ENABLE + FORCE
-- and its 0014 policy (tenant_id NOT NULL, so the NULL arm is dead); it gains columns and narrow column grants only.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 185.1  THE VOCABULARY
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('ledger_txn_type', 'promo_hold',    'Promotion money reserved at coupon redemption (tenant main -> tenant hold)', '{}', 21),
    ('ledger_txn_type', 'promo_settle',  'Promotion money paid to the seller at settlement (tenant hold -> seller main)', '{}', 22),
    ('ledger_txn_type', 'promo_release', 'Promotion reservation released on cancel/refund (tenant hold -> tenant main)', '{}', 23)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 185.2  coupon_redemptions LEARNS WHAT HAPPENED TO ITS MONEY
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS hold_txn_id     uuid;
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS settled_txn_id  uuid;
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS settled_at      timestamptz;
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS released_txn_id uuid;
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS released_at     timestamptz;

ALTER TABLE coupon_redemptions DROP CONSTRAINT IF EXISTS ck_cr_settled_xor_released;
ALTER TABLE coupon_redemptions ADD CONSTRAINT ck_cr_settled_xor_released CHECK (settled_txn_id IS NULL OR released_txn_id IS NULL);
ALTER TABLE coupon_redemptions DROP CONSTRAINT IF EXISTS ck_cr_money_needs_hold;
ALTER TABLE coupon_redemptions ADD CONSTRAINT ck_cr_money_needs_hold CHECK ((settled_txn_id IS NULL AND released_txn_id IS NULL) OR hold_txn_id IS NOT NULL);
ALTER TABLE coupon_redemptions DROP CONSTRAINT IF EXISTS ck_cr_settled_whole;
ALTER TABLE coupon_redemptions ADD CONSTRAINT ck_cr_settled_whole CHECK ((settled_txn_id IS NULL) = (settled_at IS NULL));
ALTER TABLE coupon_redemptions DROP CONSTRAINT IF EXISTS ck_cr_released_whole;
ALTER TABLE coupon_redemptions ADD CONSTRAINT ck_cr_released_whole CHECK ((released_txn_id IS NULL) = (released_at IS NULL));

COMMENT ON COLUMN coupon_redemptions.hold_txn_id IS
  'PC-56 TENANT-10b (0185): the promo_hold ledger txn that reserved this discount from the tenant''s Main into its Hold, written with the row. NULL = no reservation was taken (a redemption before 0185 — seller-funded — or a backstop-recorded one the tenant could not fund).';
COMMENT ON COLUMN coupon_redemptions.settled_txn_id IS
  'PC-56 TENANT-10b (0185): the promo_settle ledger txn that paid this discount from the tenant''s Hold to the seller at settlement. Written once, by the settlement relay transaction.';
COMMENT ON COLUMN coupon_redemptions.released_txn_id IS
  'PC-56 TENANT-10b (0185): the promo_release ledger txn that returned this reservation to the tenant''s Main when the order was cancelled or refunded before settlement. Written once.';

-- APPEND-ONLY FOR EVERY COLUMN IT HAD (Law 2). The only updates admitted are the two money-state stamps, each NULL → value
-- exactly once; a settled row can never be released and vice versa (the CHECK above), and nothing else may move.
CREATE OR REPLACE FUNCTION assert_coupon_redemption_money_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'coupon_redemptions is append-only: redemption % cannot be deleted (PC-56 TENANT-10b, 0185)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.coupon_id <> OLD.coupon_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.amount_minor <> OLD.amount_minor OR NEW.created_at <> OLD.created_at
     OR NEW.hold_txn_id IS DISTINCT FROM OLD.hold_txn_id THEN
    RAISE EXCEPTION 'coupon_redemptions is append-only: redemption % may only gain its settlement or release stamp', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.settled_txn_id IS NOT NULL AND (NEW.settled_txn_id IS DISTINCT FROM OLD.settled_txn_id OR NEW.settled_at IS DISTINCT FROM OLD.settled_at) THEN
    RAISE EXCEPTION 'coupon_redemptions: a settlement is final (redemption %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.released_txn_id IS NOT NULL AND (NEW.released_txn_id IS DISTINCT FROM OLD.released_txn_id OR NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
    RAISE EXCEPTION 'coupon_redemptions: a release is final (redemption %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cr_money_state ON coupon_redemptions;
CREATE TRIGGER trg_cr_money_state BEFORE UPDATE OR DELETE ON coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION assert_coupon_redemption_money_state();

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------------------------------------------
-- 185.3  GRANTS, NARROWLY
-- ------------------------------------------------------------------------------------------------------------------
GRANT UPDATE (released_txn_id, released_at) ON coupon_redemptions TO kv_app;
GRANT SELECT ON coupon_redemptions TO kv_relay;
GRANT UPDATE (settled_txn_id, settled_at) ON coupon_redemptions TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 185.4  coupon_redemption_attempts — EVERY OUTCOME, APPLIED OR DECLINED
-- ------------------------------------------------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE coupon_attempt_outcome AS ENUM ('applied', 'user_limit', 'budget_exhausted', 'window', 'tenant_funds_unavailable', 'invalid', 'max_uses_reached', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS coupon_redemption_attempts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  coupon_id    uuid REFERENCES coupons(id),           -- NULL: the code matched no coupon of this tenant
  order_id     uuid,                                  -- NULL: a checkout PREVIEW (no order exists yet)
  user_id      uuid NOT NULL REFERENCES users(id),
  stage        varchar(10) NOT NULL CHECK (stage IN ('preview', 'redeem', 'backstop')),
  outcome      coupon_attempt_outcome NOT NULL,
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),   -- the discount applied, or the one that would have; NULL = not computable
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cra_coupon_recent ON coupon_redemption_attempts (tenant_id, coupon_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cra_order ON coupon_redemption_attempts (tenant_id, order_id) WHERE order_id IS NOT NULL;

COMMENT ON TABLE coupon_redemption_attempts IS
  'PC-56 TENANT-10b (0185): one row per coupon validate (stage preview) or redeem (stage redeem/backstop) OUTCOME — applied or declined, with the reason as an enum. W130''s Recent redemptions panel reads its declined rows. Append-only by trigger; tenant-bound by RLS with WITH CHECK.';

CREATE OR REPLACE FUNCTION coupon_redemption_attempts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'coupon_redemption_attempts is append-only — a recorded attempt is never edited or removed (PC-56 TENANT-10b, 0185)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_cra_append_only ON coupon_redemption_attempts;
CREATE TRIGGER trg_cra_append_only BEFORE UPDATE OR DELETE ON coupon_redemption_attempts
  FOR EACH ROW EXECUTE FUNCTION coupon_redemption_attempts_append_only();
DROP TRIGGER IF EXISTS trg_cra_no_truncate ON coupon_redemption_attempts;
CREATE TRIGGER trg_cra_no_truncate BEFORE TRUNCATE ON coupon_redemption_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION coupon_redemption_attempts_append_only();

ALTER TABLE coupon_redemption_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemption_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cra_read ON coupon_redemption_attempts;
DROP POLICY IF EXISTS cra_insert_own ON coupon_redemption_attempts;
DROP POLICY IF EXISTS cra_admin_realm ON coupon_redemption_attempts;
CREATE POLICY cra_read        ON coupon_redemption_attempts FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY cra_insert_own  ON coupon_redemption_attempts FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cra_admin_realm ON coupon_redemption_attempts FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON coupon_redemption_attempts FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON coupon_redemption_attempts TO kv_app;
GRANT SELECT ON coupon_redemption_attempts TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 185.5  THE HUMAN-PAUSE BIT (F-10)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS paused_by_user_id uuid REFERENCES users(id);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS paused_at timestamptz;
COMMENT ON COLUMN promotions.paused_at IS
  'PC-56 TENANT-10b (0185): set when a PERSON paused this promotion (POST /promotions/:id/active, reason audited); cleared on resume. The festival scheduler never re-opens a row with paused_at set. Rows already inactive at 0185 were backfilled with updated_at and a NULL paused_by_user_id ("who paused it was not recorded").';
UPDATE promotions SET paused_at = updated_at WHERE is_active = false AND paused_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 185.6  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cr_coupon_recent ON coupon_redemptions (tenant_id, coupon_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cr_order ON coupon_redemptions (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_coupons_tenant_recent ON coupons (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_recent ON promotions (tenant_id, created_at DESC, id DESC);
