-- ==================================================================================================================
-- MIGRATION 0186 — PC-56 TENANT-11a · AUCTIONS — THE DEPOSIT SECURES THE SALE, THE PRICE IS PER UNIT, THE LOT IS HELD
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0005, 0014, 0112, 0185 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (brief_t11a.md, 2026-10-02): F-12 = the auction price is PER UNIT; F-2 = the winner's EMD is APPLIED to
-- the order and FORFEITED to the seller on default.
--
-- What the survey proved at d0f4afe (survey_t11.md): an auction had no quantity, so the hammer price was the lot total and
-- the order was `1 × lot` (F-12); the close released EVERY bidder's EMD including the winner's (F-2), so a winner could walk
-- away at zero cost; the listing under auction stayed `published` and could be bought directly while it was auctioned (F-7);
-- a seller's approval window had no clock (F-13); `settled_order_id` was never written (F-16); kv_app had no DELETE on
-- `auction_watchers`, so every unwatch was a 500 (F-21).
--
-- THE MONEY MODEL THIS FILE MAKES RECORDABLE (every move is a balanced WalletPort post; this file records which happened):
--   • AT BID (unchanged): bidder Main −EMD → bidder Hold +EMD, key `emd:<auction>:<bidder>`, txn `emd_hold`. EMD is per LOT.
--   • AT CLOSE: every LOSER's hold is returned (Hold → Main, key `emd-release:<auction>:<bidder>`, txn `emd_hold`, unchanged);
--     the WINNER's hold is KEPT — in `settled` and in `awaiting_approval` alike.
--   • AT SETTLEMENT (the same transaction that writes `status='settled'` and creates the order): the winner's EMD is APPLIED
--     to the order — winner Hold −EMD → platform Escrow +EMD, key `emd-apply:<auction>`, txn `emd_apply`, reference
--     (order, <orderId>). The order's value is `quantity × hammer unit price`; what the winner still owes is that value less
--     the EMD (`auction_settlements.balance_due_minor`), due 48 h after settlement (`balance_due_at`).
--   • ON DEFAULT (the order is still awaiting payment at `balance_due_at`, or the winner cancels the order): the applied EMD
--     is FORFEITED to the seller — platform Escrow −EMD → seller Main +EMD, key `emd-forfeit:<auction>`, txn `emd_forfeit`.
--     The auction becomes `defaulted`, the order is cancelled, the listing goes back to `published`.
--   • IF THE SELLER (or the system for any other reason) CANCELS THE ORDER before it completes, the applied EMD goes back to
--     the winner — Escrow −EMD → winner Main +EMD, key `emd-return:<auction>`, txn `emd_return` — the winner did not default.
--   • LAPSE (the seller did not decide by `decision_due_at`): every hold, the winner's included, is returned (`emd-release:`).
--
-- WHAT THIS FILE DOES
--   186.1  THE VOCABULARY — `auction_status` gains `defaulted`; `listing_status` gains `reserved_auction` (no existing
--          status fits: `paused` is the seller's own hand and `held` is a platform moderation hold — neither says "this
--          produce is being auctioned and cannot be bought directly"). Ledger txn types `emd_apply`, `emd_forfeit`,
--          `emd_return` (also in seed core/0005).
--   186.2  `auctions` LEARNS ITS LOT AND ITS CLOCKS — `quantity` numeric(18,3) + `unit_code` (copied from the listing at
--          create; backfilled from each row's listing), `auction_no` (`AUC-<yyyy>-<mmdd>-<nn>`, per tenant per India day,
--          assigned by trigger), the seller-decision clock (`decision_window_hours` ≤ 72, `decision_due_at`), pause-entry
--          (`entry_paused` + who/when), and the lifecycle stamps (`ended_at`, `settled_at`, `lapsed_at`, `defaulted_at`,
--          `cancelled_at`, `cancelled_by`, `cancel_reason`).
--   186.3  `auction_settlements` — ONE row per settled auction: order, winner, seller, quantity, unit, hammer unit price,
--          order value, EMD applied (+ its txn), balance due + its due time, how the balance is collected (`online` when
--          the order awaits payment, `offline` when `online_payments` is OFF and the existing order flow collects it), and
--          the outcome (`open` → `paid` | `defaulted` | `returned`) with the forfeit / return txn. RLS ENABLE + FORCE, the
--          0175 shape; kv_app SELECT + INSERT + UPDATE of the outcome columns only.
--   186.4  `auction_consents` — the seller's RECORDED consent for an act staff performs on the seller's behalf (schedule,
--          approve, decline): channel voice | otp | written, the evidence media, who recorded it and when. Append-only by
--          trigger; RLS ENABLE + FORCE, the 0175 shape; kv_app SELECT + INSERT only.
--   186.5  `auction_watchers` — kv_app gains DELETE (F-21): unwatching is a delete of the caller's own row.
--   186.6  PERMISSIONS (also in seed 0004) — `auction.read` (the bid history; granted broadly), `auction.schedule_on_behalf`
--          (tenant_admin, fpo_coordinator: schedule FOR a seller, and record a seller's decision WITH their consent),
--          `auction.cancel_live` (tenant_admin: stop a live auction, reason mandatory, bidders notified),
--          `auction.pause_entry` (tenant_admin: stop NEW bidders entering, existing bidders continue).
--   186.7  NOTIFICATION CATALOGUE — `auction.cancelled`, `auction.failed_reserve`, `auction.defaulted`, `auction.lapsed`
--          (templates in seed core/0007, above its version backfill — 0122's send-time gate, TENANT-6c-2's finding).
--   186.8  Indexes for the console's grouped tabs, the cadence claims and the settlement read.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • No "offer to the next bidder" after a default (W139 note) — REFUSED BY NAME this wave; nothing here models it.
--   • No bidder qualification: `auctions.bidder_qualification` stays unwritten (the console prints "not checked").
--   • No same-IP / device integrity check (T10 F-18): `bids.ip` is stored, nothing reads it as a risk signal.
--   • `auctions.listing_id` stays UNIQUE (0005): a listing that returns to `published` after a cancel, lapse, failed reserve
--     or default cannot be auctioned a second time. Named, not changed.
--
-- RLS DECISION: two new tenant tables (186.3, 186.4), ENABLE + FORCE + the 0175 split (SELECT bound to the tenant, INSERT
-- WITH CHECK the tenant, UPDATE USING + WITH CHECK the tenant where an update exists, an admin-realm policy TO kv_admin).
-- `auctions` keeps ENABLE + FORCE and its 0014 policy (tenant_id NOT NULL — the NULL arm is dead). No grant to kv_relay:
-- every new reader runs in the request-tier unit of work (kv_app), the way TENANT-10a's sale handler does.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 186.1  THE VOCABULARY
-- ------------------------------------------------------------------------------------------------------------------
-- ADD VALUE inside the runner's transaction is allowed (PG ≥ 12); the new values are NOT used anywhere in this file.
ALTER TYPE auction_status ADD VALUE IF NOT EXISTS 'defaulted';
ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'reserved_auction';

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('ledger_txn_type', 'emd_apply',   'Auction winner''s EMD applied to the order (winner hold -> platform escrow)', '{}', 24),
    ('ledger_txn_type', 'emd_forfeit', 'Auction winner''s applied EMD forfeited to the seller on default (escrow -> seller main)', '{}', 25),
    ('ledger_txn_type', 'emd_return',  'Auction winner''s applied EMD returned when the order is cancelled by the seller or system (escrow -> winner main)', '{}', 26)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 186.2  auctions LEARNS ITS LOT AND ITS CLOCKS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS quantity              numeric(18,3);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS unit_code             varchar(20);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS auction_no            varchar(24);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS decision_window_hours smallint NOT NULL DEFAULT 24;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS decision_due_at       timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS entry_paused          boolean NOT NULL DEFAULT false;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS entry_paused_at       timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS entry_paused_by       uuid REFERENCES users(id);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS ended_at              timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS settled_at            timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS lapsed_at             timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS defaulted_at          timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS cancelled_at          timestamptz;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS cancelled_by          uuid REFERENCES users(id);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS cancel_reason         text;

-- BACKFILL: the lot is the listing's available quantity, in the listing's unit — what an auction created by this wave
-- copies at create. `listing_id` is NOT NULL REFERENCES listings (0005), so every row has a listing; the COALESCE to
-- quantity 1 / unit 'lot' covers a listing row whose quantity reads NULL or 0 (none can today: quantity_available is
-- NOT NULL) and is said here rather than guessed: such a row keeps the old "the hammer price is the lot" meaning.
UPDATE auctions a
   SET quantity  = COALESCE(NULLIF(l.quantity_available, 0), 1),
       unit_code = CASE WHEN NULLIF(l.quantity_available, 0) IS NULL THEN 'lot' ELSE l.unit_code END
  FROM listings l
 WHERE l.id = a.listing_id AND a.quantity IS NULL;
UPDATE auctions SET quantity = 1, unit_code = 'lot' WHERE quantity IS NULL OR unit_code IS NULL;
ALTER TABLE auctions ALTER COLUMN quantity SET NOT NULL;
ALTER TABLE auctions ALTER COLUMN unit_code SET NOT NULL;

ALTER TABLE auctions DROP CONSTRAINT IF EXISTS ck_auctions_quantity_positive;
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_quantity_positive CHECK (quantity > 0);
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS ck_auctions_decision_window;
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_decision_window CHECK (decision_window_hours BETWEEN 1 AND 72);
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS ck_auctions_cancel_whole;
-- A reason is never recorded without the cancellation it explains (rows cancelled before 0186 carry neither).
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_cancel_whole CHECK (cancel_reason IS NULL OR cancelled_at IS NOT NULL);
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS ck_auctions_pause_whole;
ALTER TABLE auctions ADD CONSTRAINT ck_auctions_pause_whole CHECK (NOT entry_paused OR entry_paused_at IS NOT NULL);

-- THE AUCTION NUMBER. `AUC-<yyyy>-<mmdd>-<nn>`: the India calendar day the auction was created and its sequence within that
-- tenant's day (two digits, three past 99). Assigned BY TRIGGER at INSERT so no writer can forget it or race it: a
-- transaction-scoped advisory lock on (tenant, day) serialises two creates in the same day, and the unique index is the
-- second wall. Backfilled for existing rows in created_at order.
CREATE OR REPLACE FUNCTION assign_auction_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d      date := ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'Asia/Kolkata')::date;
  prefix text := 'AUC-' || to_char(d, 'YYYY') || '-' || to_char(d, 'MMDD') || '-';
  n      integer;
BEGIN
  IF NEW.auction_no IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('auction_no:' || NEW.tenant_id::text || ':' || prefix));
  SELECT COALESCE(max(substring(auction_no FROM length(prefix) + 1)::integer), 0) + 1 INTO n
    FROM auctions WHERE tenant_id = NEW.tenant_id AND auction_no LIKE prefix || '%' AND substring(auction_no FROM length(prefix) + 1) ~ '^[0-9]+$';
  NEW.auction_no := prefix || lpad(n::text, 2, '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_auctions_assign_no ON auctions;
CREATE TRIGGER trg_auctions_assign_no BEFORE INSERT ON auctions FOR EACH ROW EXECUTE FUNCTION assign_auction_no();

WITH numbered AS (
  SELECT id, 'AUC-' || to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY') || '-' || to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') || '-'
           || lpad(row_number() OVER (PARTITION BY tenant_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date ORDER BY created_at, id)::text, 2, '0') AS no
    FROM auctions WHERE auction_no IS NULL
)
UPDATE auctions a SET auction_no = numbered.no FROM numbered WHERE numbered.id = a.id;
ALTER TABLE auctions ALTER COLUMN auction_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_tenant_no ON auctions (tenant_id, auction_no);

-- An auction already awaiting the seller when this file lands gets the default 24 h clock FROM NOW (its end time is
-- unknown to the schema — `ended_at` did not exist): the conservative reading, which never lapses an auction early.
UPDATE auctions SET decision_due_at = now() + interval '24 hours' WHERE status = 'awaiting_approval' AND decision_due_at IS NULL;

COMMENT ON COLUMN auctions.quantity IS
  'PC-56 TENANT-11a (0186, founder decision F-12): the lot''s quantity in unit_code, copied from the listing at create. Bids are PER UNIT; the lot value is quantity × bid. Rows before 0186 were backfilled from their listing''s quantity_available (1 / lot where it read 0).';
COMMENT ON COLUMN auctions.decision_due_at IS
  'PC-56 TENANT-11a (0186, F-13): set when the auction closes into awaiting_approval = ended_at + decision_window_hours. At that time SellerDecisionLapseJob moves it to ended (no sale), returns every EMD and re-publishes the listing.';
COMMENT ON COLUMN auctions.entry_paused IS
  'PC-56 TENANT-11a (0186, A11): tenant_admin stopped NEW bidders entering (a user with no prior bid in this auction is refused AUCTION_ENTRY_PAUSED); existing bidders continue. Audited with a reason.';

-- ------------------------------------------------------------------------------------------------------------------
-- 186.3  auction_settlements — WHAT THE WINNER OWES, AND WHAT HAPPENED TO THE DEPOSIT
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auction_settlements (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  auction_id           uuid NOT NULL UNIQUE REFERENCES auctions(id),
  order_id             uuid NOT NULL UNIQUE,
  winner_user_id       uuid NOT NULL REFERENCES users(id),
  seller_user_id       uuid NOT NULL REFERENCES users(id),
  quantity             numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit_code            varchar(20) NOT NULL,
  hammer_unit_minor    bigint NOT NULL CHECK (hammer_unit_minor > 0),
  order_value_minor    bigint NOT NULL CHECK (order_value_minor > 0),
  emd_applied_minor    bigint NOT NULL DEFAULT 0 CHECK (emd_applied_minor >= 0),
  emd_apply_txn_id     uuid,
  balance_due_minor    bigint NOT NULL CHECK (balance_due_minor >= 0),
  balance_due_at       timestamptz NOT NULL,
  collection           varchar(10) NOT NULL CHECK (collection IN ('online', 'offline')),
  settled_at           timestamptz NOT NULL,
  outcome              varchar(12) NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'paid', 'defaulted', 'returned')),
  outcome_at           timestamptz,
  emd_forfeit_txn_id   uuid,
  emd_return_txn_id    uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_as_balance CHECK (balance_due_minor = order_value_minor - emd_applied_minor),
  CONSTRAINT ck_as_apply_whole CHECK ((emd_applied_minor = 0) = (emd_apply_txn_id IS NULL)),
  CONSTRAINT ck_as_outcome_whole CHECK ((outcome = 'open') = (outcome_at IS NULL)),
  CONSTRAINT ck_as_forfeit CHECK (emd_forfeit_txn_id IS NULL OR outcome = 'defaulted'),
  CONSTRAINT ck_as_return CHECK (emd_return_txn_id IS NULL OR outcome = 'returned'),
  CONSTRAINT ck_as_one_end CHECK (emd_forfeit_txn_id IS NULL OR emd_return_txn_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_as_due ON auction_settlements (tenant_id, balance_due_at) WHERE outcome = 'open';

COMMENT ON TABLE auction_settlements IS
  'PC-56 TENANT-11a (0186, founder decision F-2): one row per settled auction, written in the SAME transaction as status=settled and the order. order value = quantity × hammer unit price; the winner''s EMD is applied (emd-apply:<auction>, hold -> escrow) and the balance is due 48 h after settlement. outcome: paid (the order left payment_pending), defaulted (EMD forfeited to the seller), returned (EMD back to the winner after a seller/system cancel).';

-- The money facts of a settlement are FROZEN at INSERT; only the outcome may move, once, from open.
CREATE OR REPLACE FUNCTION assert_auction_settlement_outcome() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'auction_settlements is append-only: settlement % cannot be deleted (PC-56 TENANT-11a, 0186)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.auction_id <> OLD.auction_id OR NEW.order_id <> OLD.order_id
     OR NEW.winner_user_id <> OLD.winner_user_id OR NEW.seller_user_id <> OLD.seller_user_id OR NEW.quantity <> OLD.quantity
     OR NEW.unit_code <> OLD.unit_code OR NEW.hammer_unit_minor <> OLD.hammer_unit_minor OR NEW.order_value_minor <> OLD.order_value_minor
     OR NEW.emd_applied_minor <> OLD.emd_applied_minor OR NEW.emd_apply_txn_id IS DISTINCT FROM OLD.emd_apply_txn_id
     OR NEW.balance_due_minor <> OLD.balance_due_minor OR NEW.balance_due_at <> OLD.balance_due_at OR NEW.collection <> OLD.collection
     OR NEW.settled_at <> OLD.settled_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'auction_settlements: the money facts of settlement % are final; only its outcome may be recorded', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.outcome <> 'open' AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.outcome_at IS DISTINCT FROM OLD.outcome_at
     OR NEW.emd_forfeit_txn_id IS DISTINCT FROM OLD.emd_forfeit_txn_id OR NEW.emd_return_txn_id IS DISTINCT FROM OLD.emd_return_txn_id) THEN
    RAISE EXCEPTION 'auction_settlements: settlement % already has its outcome (%)', OLD.id, OLD.outcome USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_as_outcome ON auction_settlements;
CREATE TRIGGER trg_as_outcome BEFORE UPDATE OR DELETE ON auction_settlements FOR EACH ROW EXECUTE FUNCTION assert_auction_settlement_outcome();

ALTER TABLE auction_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS as_read ON auction_settlements;
DROP POLICY IF EXISTS as_insert_own ON auction_settlements;
DROP POLICY IF EXISTS as_update_own ON auction_settlements;
DROP POLICY IF EXISTS as_admin_realm ON auction_settlements;
CREATE POLICY as_read        ON auction_settlements FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY as_insert_own  ON auction_settlements FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY as_update_own  ON auction_settlements FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY as_admin_realm ON auction_settlements FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON auction_settlements FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON auction_settlements TO kv_app;
GRANT UPDATE (outcome, outcome_at, emd_forfeit_txn_id, emd_return_txn_id) ON auction_settlements TO kv_app;
GRANT SELECT ON auction_settlements TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 186.4  auction_consents — THE SELLER SAID YES, AND HERE IS HOW WE KNOW
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auction_consents (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  auction_id      uuid NOT NULL REFERENCES auctions(id),
  seller_user_id  uuid NOT NULL REFERENCES users(id),
  act             varchar(10) NOT NULL CHECK (act IN ('schedule', 'approve', 'decline')),
  channel         varchar(10) NOT NULL CHECK (channel IN ('voice', 'otp', 'written')),
  media_id        uuid,
  note            text CHECK (note IS NULL OR length(note) <= 500),
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ac_evidence CHECK (channel = 'otp' OR media_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ac_auction ON auction_consents (tenant_id, auction_id, recorded_at DESC);

COMMENT ON TABLE auction_consents IS
  'PC-56 TENANT-11a (0186, F-10 / F-20): the seller''s recorded consent for an act staff performed on their behalf — scheduling the auction, approving the result, declining it. A voice or written consent carries its evidence media; an otp consent is the verification itself. Append-only by trigger. Staff never decide for the seller without one of these rows for THAT act.';

CREATE OR REPLACE FUNCTION auction_consents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auction_consents is append-only — a recorded consent is never edited or removed (PC-56 TENANT-11a, 0186)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_ac_append_only ON auction_consents;
CREATE TRIGGER trg_ac_append_only BEFORE UPDATE OR DELETE ON auction_consents FOR EACH ROW EXECUTE FUNCTION auction_consents_append_only();
DROP TRIGGER IF EXISTS trg_ac_no_truncate ON auction_consents;
CREATE TRIGGER trg_ac_no_truncate BEFORE TRUNCATE ON auction_consents FOR EACH STATEMENT EXECUTE FUNCTION auction_consents_append_only();

ALTER TABLE auction_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ac_read ON auction_consents;
DROP POLICY IF EXISTS ac_insert_own ON auction_consents;
DROP POLICY IF EXISTS ac_admin_realm ON auction_consents;
CREATE POLICY ac_read        ON auction_consents FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY ac_insert_own  ON auction_consents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ac_admin_realm ON auction_consents FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON auction_consents FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON auction_consents TO kv_app;
GRANT SELECT ON auction_consents TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 186.5  UNWATCH (F-21)
-- ------------------------------------------------------------------------------------------------------------------
GRANT DELETE ON auction_watchers TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 186.6  PERMISSIONS — rows here AND in seed 0004
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('auction.read', 'Read an auction''s bid stream (bidders masked as B1…Bn)', 'M04'),
  ('auction.schedule_on_behalf', 'Schedule an auction for a seller, and record the seller''s decision, each with the seller''s recorded consent', 'M04'),
  ('auction.cancel_live', 'Cancel a live auction (reason mandatory; every bidder notified, every EMD released)', 'M04'),
  ('auction.pause_entry', 'Pause / resume NEW bidders entering a live auction (existing bidders continue; reason recorded)', 'M04')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (p.code = 'auction.read' AND r.code IN ('farmer','vyapari','customer','dairy_farmer','pashupalak','organic_store','pharma_store',
                                               'fpo_coordinator','tenant_admin','tenant_staff','ambassador','sardar','support_agent','ai_ops'))
    OR (p.code = 'auction.schedule_on_behalf' AND r.code IN ('tenant_admin','fpo_coordinator'))
    OR (p.code IN ('auction.cancel_live','auction.pause_entry') AND r.code = 'tenant_admin')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 186.7  NOTIFICATION CATALOGUE (templates: seed core/0007, above the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('auction.cancelled',      'An auction you bid on was cancelled', 'important', '["push","inapp"]', true, false),
  ('auction.failed_reserve', 'An auction closed without a sale',    'important', '["push","inapp"]', true, false),
  ('auction.defaulted',      'An auction sale was defaulted',        'important', '["push","inapp"]', true, false),
  ('auction.lapsed',         'An auction lapsed without a decision', 'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 186.8  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_auctions_tenant_recent ON auctions (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_auctions_decision_due ON auctions (decision_due_at) WHERE status = 'awaiting_approval';
CREATE INDEX IF NOT EXISTS idx_auctions_due_open ON auctions (starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_bids_auction_bidder ON bids (tenant_id, auction_id, bidder_user_id, created_at);
