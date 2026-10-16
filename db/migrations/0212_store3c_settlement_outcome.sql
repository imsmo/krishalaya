-- ==================================================================================================================
-- MIGRATION 0212 — PC-56 STORE-3c · DEPOSITS, BALANCES AND POOLED LOTS: EVERY EMD ACCOUNTED FOR
-- (canon W295 auctions · W296 my bids & deposits · W279 group lot · the Retry chains W3077–W3079, W3089–W3091, W3115–W3117)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0211 are applied; nothing here edits them: this file REPLACES one trigger
-- function (fix-forward, `CREATE OR REPLACE`), widens one varchar column and swaps two CHECK constraints on `auction_settlements` (0186).)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store3.md F-4a's residue after HOTFIX-5; HOTFIX-5 founder question 3 — verified on krishalaya_dev at 0211):
--   • HOTFIX-5 (founder D4) made a PAID auction order that is cancelled return the winner's applied deposit (`emd_return`, keyed
--     `emd-return:<orderId>`) — but the settlement row could not SAY so. 0186's `auction_settlements.outcome` admits `open | paid | defaulted |
--     returned` and its trigger lets the outcome move ONCE, from `open`. An order paid first and cancelled later had its outcome recorded `paid`
--     when the balance was captured, so the return was written by the ledger, the auction event (`paid_order_cancelled`) and the audit row only;
--     the settlement kept saying `paid` for a sale that no longer existed, and `ck_as_return` refused `emd_return_txn_id` on any outcome but
--     `returned`.
--   • `outcome` is `varchar(12)`: the name the founder chose (`cancelled_paid`, 14 characters) did not fit.
--
-- WHAT IS TRUE NOW (founder D6, STORE-3c, 2026-10-16 — "Migration 0212 adds the settlement outcome cancelled_paid"):
--   212.1  `outcome` is `varchar(20)` (binary-coercible widening: no rewrite; the partial index `idx_as_due` keeps its predicate) and its
--          CHECK admits `cancelled_paid`: the order was PAID (the balance captured) and then CANCELLED — the deposit went back to the winner
--          (`emd-return:<orderId>`) and the balance was refunded to its source (`refund:<orderId>`, STORE-2c).
--   212.2  `ck_as_return`: `emd_return_txn_id` may be set on `returned` (as before) and on `cancelled_paid`; and a `cancelled_paid` row with a
--          deposit applied (`emd_applied_minor > 0`) MUST carry the return txn — the move records the money it claims.
--   212.3  `assert_auction_settlement_outcome()` — the money facts stay FINAL (every column but the outcome set is frozen at INSERT, as 0186
--          said); no row is ever deleted; `open` moves ONCE to `paid | defaulted | returned` (unchanged); and ONE second move exists:
--          `paid → cancelled_paid`, setting `outcome_at` and `emd_return_txn_id` in that same move (`emd_forfeit_txn_id` stays NULL). Every
--          other move from a decided outcome is refused (`paid → returned`, `defaulted → cancelled_paid`, `cancelled_paid → …`, `open →
--          cancelled_paid`): the trigger raises `check_violation` with the settlement id and the outcome it already has.
--   212.4  The table COMMENT names the new outcome.
--   212.5  `g` is a RESERVED tenant slug (the 0205 / 0207 pattern): STORE-3c adds the platform door `/g/[id]` (canon W279's route), and Next's
--          static segment wins over `/[tenantSlug]`, so an organisation slugged `g` would be unreachable. An existing holder is reported, never
--          renamed (0204's rule). Mirrored in apps/api tenancy/domain/signup.ts RESERVED_TENANT_SLUGS (a unit spec compares the two).
--
-- NOTHING ELSE (beyond 212.5's route reservation): no table for buyer interest in a group lot (founder D3 — refused by name), no indicative price column (refused), no ledger
-- transaction type (the EMD return is 0186's `emd_return`, already used by HOTFIX-5), no column for the group-lot deadline clock
-- (`group_lots.pledge_deadline` exists, 0005/0188), no flag change (`auctions` stays OFF in seed 0009 — Law 10).
--
-- RLS / GRANTS DECISION: no table is created and none is re-granted. `auction_settlements` keeps RLS ENABLED + FORCED and its four 0186
-- policies (as_read / as_insert_own / as_update_own / as_admin_realm); kv_app keeps its grants, kv_relay still holds none. The RLS gate's count
-- does not move. Partition pass: no partitioned table is touched.
--
-- LAW 9 (founder review before production): no money moves because of this file. The money lines of STORE-3c are CODE and are listed in the
-- wave report §9: the capture re-check now compares a payment to the DUE (total − the applied EMD), the offline default returns the EMD under
-- the existing `emd-return:<auctionId>` key, a captured payment counts as "paid" for the cancel's deposit decision, and the paid-then-cancelled
-- move records THIS outcome (`cancelled_paid`) with the `emd-return:<orderId>` txn.
--
-- REVERSAL (documented, not automatic; only while no row holds the new outcome):
--   -- first: SELECT count(*) FROM auction_settlements WHERE outcome = 'cancelled_paid';  -- must be 0 (else those rows have no older name)
--   ALTER TABLE auction_settlements DROP CONSTRAINT IF EXISTS auction_settlements_outcome_check;
--   ALTER TABLE auction_settlements ADD CONSTRAINT auction_settlements_outcome_check CHECK (outcome IN ('open', 'paid', 'defaulted', 'returned'));
--   ALTER TABLE auction_settlements DROP CONSTRAINT IF EXISTS ck_as_return;
--   ALTER TABLE auction_settlements ADD CONSTRAINT ck_as_return CHECK (emd_return_txn_id IS NULL OR outcome = 'returned');
--   -- then re-run 0186's CREATE OR REPLACE FUNCTION assert_auction_settlement_outcome() body (the column may stay varchar(20)).
--   -- the code must be reverted first: AuctionSettlementRepository.recordCancelledPaid writes the new outcome.
--   DELETE FROM reserved_tenant_slugs WHERE slug = 'g';   -- only once the storefront's /g route is removed
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 212.1  the outcome column admits `cancelled_paid`
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE auction_settlements ALTER COLUMN outcome TYPE varchar(20);
ALTER TABLE auction_settlements DROP CONSTRAINT IF EXISTS auction_settlements_outcome_check;
ALTER TABLE auction_settlements ADD CONSTRAINT auction_settlements_outcome_check
  CHECK (outcome IN ('open', 'paid', 'defaulted', 'returned', 'cancelled_paid'));

-- ------------------------------------------------------------------------------------------------------------------
-- 212.2  the return txn may sit on `cancelled_paid` — and must, when a deposit was applied
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE auction_settlements DROP CONSTRAINT IF EXISTS ck_as_return;
ALTER TABLE auction_settlements ADD CONSTRAINT ck_as_return
  CHECK (emd_return_txn_id IS NULL OR outcome IN ('returned', 'cancelled_paid'));
ALTER TABLE auction_settlements DROP CONSTRAINT IF EXISTS ck_as_cancelled_paid_return;
ALTER TABLE auction_settlements ADD CONSTRAINT ck_as_cancelled_paid_return
  CHECK (outcome <> 'cancelled_paid' OR emd_applied_minor = 0 OR emd_return_txn_id IS NOT NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 212.3  the outcome moves once from `open` — and `paid` may move once more, to `cancelled_paid`
-- ------------------------------------------------------------------------------------------------------------------
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
  -- PC-56 STORE-3c (0212, founder D6): `cancelled_paid` is reached ONLY from `paid` — never from `open`
  IF NEW.outcome = 'cancelled_paid' AND OLD.outcome NOT IN ('paid', 'cancelled_paid') THEN
    RAISE EXCEPTION 'auction_settlements: settlement % cannot become cancelled_paid from % (only a paid settlement can)', OLD.id, OLD.outcome USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.outcome <> 'open' AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.outcome_at IS DISTINCT FROM OLD.outcome_at
     OR NEW.emd_forfeit_txn_id IS DISTINCT FROM OLD.emd_forfeit_txn_id OR NEW.emd_return_txn_id IS DISTINCT FROM OLD.emd_return_txn_id) THEN
    -- the ONE second move: paid → cancelled_paid, with its time and the return txn set in this move; the forfeit txn stays empty
    IF OLD.outcome = 'paid' AND NEW.outcome = 'cancelled_paid' AND NEW.outcome_at IS NOT NULL
       AND NEW.emd_forfeit_txn_id IS NULL AND OLD.emd_return_txn_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'auction_settlements: settlement % already has its outcome (%)', OLD.id, OLD.outcome USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- the trigger itself is 0186's (trg_as_outcome, BEFORE UPDATE OR DELETE) — it calls the function above by name; not re-created here.

-- ------------------------------------------------------------------------------------------------------------------
-- 212.4  the table says what its outcomes mean
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE auction_settlements IS
  'PC-56 TENANT-11a (0186, founder decision F-2): one row per settled auction, written in the SAME transaction as status=settled and the order. order value = quantity × hammer unit price; the winner''s EMD is applied (emd-apply:<auction>, hold -> escrow) and the balance is due 48 h after settlement. outcome: paid (the order left payment_pending, or an offline order the seller confirmed), defaulted (EMD forfeited to the seller), returned (EMD back to the winner after a seller/system cancel, or an offline order the seller never confirmed — STORE-3c D5), cancelled_paid (PC-56 STORE-3c 0212, founder D6: a PAID order later cancelled — the EMD returned under emd-return:<orderId>, the balance refunded to source; the ONE second move, from paid).';

-- ------------------------------------------------------------------------------------------------------------------
-- 212.5  `g` — the platform door to a group lot (canon W279 `/g/[id]`) is a storefront route: no organisation may take it as its address
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('g', 'storefront route (canon W279 → the platform door /g/[id] to a group lot, STORE-3c)')
ON CONFLICT (slug) DO NOTHING;

-- an EXISTING organisation already holding the name is reported, never renamed (a slug is in printed QR codes and links) — 0204's rule
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM tenants t WHERE lower(t.slug) = 'g';
  IF n > 0 THEN RAISE NOTICE '0212: % existing tenant(s) hold the slug g — left as they are; the admin realm decides', n; END IF;
END $$;
