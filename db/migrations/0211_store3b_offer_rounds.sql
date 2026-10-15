-- ==================================================================================================================
-- MIGRATION 0211 — PC-56 STORE-3b · AN OFFER IS A NEGOTIATION WITH A CLOCK, A TURN, AND A REAL ORDER AT THE END
-- (canon W293 my offers · W294 offer thread · the response act chain W3121–W3123 · the offers Retry chain W3124–W3126)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0210 are applied; nothing here edits them: this file ADDS two platform
-- settings, one append-only tenant table, two nullable columns on `listing_offers`, one vocabulary type and its six platform values.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store3.md F-5 / F-13 / B15 / B16 — verified on krishalaya_dev at 0210 before writing this file):
--   • F-13 THE OFFER CLOCK. One expiry for the whole negotiation, 72 h by default (a literal in listing-offer.service.ts) and BUYER-SETTABLE
--          WITHOUT AN UPPER BOUND (the make DTO took any future datetime). A counter never reset it, so a seller's counter could arrive with
--          minutes left for the buyer — or a buyer could keep an offer open for a year.
--   • B15  NO ROUND HISTORY, NO REASON. A counter OVERWROTE the prices on the one `listing_offers` row (0015): "what did I offer in round 1?"
--          had no answer anywhere; a decline carried no reason (`POST :id/reject` took no body; 0015 has no column for one).
--   • F-5  (the stock half — code, not schema) an accepted offer re-checked nothing and reserved nothing: oversell ran through offers.
--
-- WHAT IS TRUE NOW:
--   211.1  `offers.round_ttl_hours` (int, 48, platform) and `offers.max_life_hours` (int, 336, platform) — founder D1 (Q3a, 2026-10-15):
--          every act that puts a price on the table (the first offer, every counter) gives the other side `round_ttl_hours` to answer
--          (`listing_offers.expires_at` = now + it); the whole negotiation ends `max_life_hours` after the FIRST offer (a counter that would
--          pass that ceiling is refused OFFER_MAX_LIFE and the negotiation lapses by the clock). The buyer's own `expiresAt` on make is
--          bounded by both (beyond → OFFER_EXPIRY_TOO_LATE). Read through `kv_platform_setting()` (the 0209 precedent); the code carries
--          compile-time FALLBACKS (OFFER_ROUND_TTL_FALLBACK_H / OFFER_MAX_LIFE_FALLBACK_H) used only when a setting is absent, with a log line.
--   211.2  `listing_offer_rounds` — THE NEGOTIATION'S HISTORY, APPEND-ONLY (founder D3). One row per act, written in the SAME transaction as
--          the act: `offer` (round 1, the buyer), `counter` (either party, the new round), `accept` / `decline` (either party, the round
--          answered), `expire` (the system — the `offers-expire` clock, HOTFIX-5). `price_minor` is the per-unit price the act put on (or
--          accepted from) the table, in the LISTING's currency (an offer has no currency of its own — HOTFIX-5 B4); NULL for decline / expire.
--          No note column: nothing a party types reaches the other side until messaging exists (founder D3 — refused by name).
--          EXISTING OFFERS HAVE NO ROWS: the read model SYNTHESISES round 1 from the offer row (`offer`, buyer, `offered_price_minor`,
--          `created_at`) when the table holds nothing for an offer — said here, said in the code; never back-filled (a counter already
--          overwrote the round-1 price of every countered legacy offer, so a back-fill would invent history).
--   211.3  `listing_offers.decline_reason_code varchar(40)` + `listing_offers.declined_by varchar(10)` ('buyer' | 'seller'), and the
--          `offer_decline_reason` vocabulary (founder D3): price · lot_committed · quantity · timing · changed_mind · other — usable by either
--          side, `other` carries NO note. Platform values (tenant_id NULL); the type is NOT tenant-extendable (one vocabulary the buyer's
--          catalogue labels — en/hi/gu in the storefront, keyed by code). The TYPE row is written here too (migrations run BEFORE seeds on a
--          database built from empty — the 0210 precedent). The API validates a given code against this vocabulary in the act's transaction
--          (OFFER_DECLINE_REASON_UNKNOWN, 422).
--
-- NOTHING ELSE: no stock column on the offer (founder D2: the reservation belongs to the ORDER — `orders.stock_reserved_at`, 0209, is set by
-- the order the relay creates from the accepted offer); no note / message column (D3, D6); no `offers` flag change (seed 0009 keeps it OFF —
-- Law 10).
--
-- RLS / GRANTS DECISION: `listing_offer_rounds` is a TENANT table: RLS ENABLED + FORCED with exactly the policy `listing_offers` carries
-- (0020's pass: `tenant_isolation_<table>` USING (tenant_id IS NULL OR tenant_id = current_tenant_id())) — the RLS gate counts one more
-- policy. Grants: the schema's default privileges (0014/0018) would hand kv_app arw and kv_relay arwd on a new table, so ALL is revoked from
-- kv_app / kv_relay first, then kv_app gets SELECT + INSERT ONLY — the history is append-only (never UPDATE, never DELETE); kv_relay gets
-- NOTHING (the expire act and every other writer run as kv_app in the request tier's unit of work — the relay gate proves kv_relay holds no
-- privilege on it); kv_readonly keeps SELECT (the analytics role, as on `listing_offers`). `listing_offers` keeps its policy and grants
-- (kv_app SELECT / INSERT / UPDATE, table-level — the two new columns inherit them). `setting_definitions` / `lookup_types` /
-- `lookup_values` are global registries (no RLS; kv_app SELECT, unchanged). Partition pass: no partitioned table is touched.
--
-- LAW 9 (founder review before production): NO money moves because of this file. The money-adjacent change of this wave is CODE: an ACCEPT
-- now reserves the listing's stock in the accept transaction (`ListingService.reserveInTx`, the 2c function) and the offer ORDER carries the
-- same platform fee / buyer commission rules a checkout order does (one shared function, `orders/domain/placement-charges.ts`) — both listed
-- in the wave report §9 with the clock settings above. No ledger vocabulary row, no posting function, no payment change.
--
-- REVERSAL (documented, not automatic):
--   DROP TABLE IF EXISTS listing_offer_rounds;          -- the code must be reverted first (the repository writes it in every act)
--   ALTER TABLE listing_offers DROP COLUMN IF EXISTS declined_by, DROP COLUMN IF EXISTS decline_reason_code;
--   UPDATE lookup_values SET is_active = false WHERE type_code = 'offer_decline_reason' AND tenant_id IS NULL;   -- a given reason is then
--                                                         refused OFFER_DECLINE_REASON_UNKNOWN (fail closed, never a silent unknown code)
--   DELETE FROM setting_definitions WHERE key IN ('offers.round_ttl_hours', 'offers.max_life_hours');   -- the code then uses its named
--                                                         fallbacks (48 / 336) and logs that the settings are absent
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 211.1  the offer clock (founder D1) — platform settings, never a literal in code
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class) VALUES
  ('offers.round_ttl_hours', 'int', '48', 'platform',
   'PC-56 STORE-3b (0211, founder D1): hours the other side has to answer each round of an offer negotiation. The first offer and every '
   'counter set the offer''s expires_at to now + this; the offers-expire clock lapses an unanswered round. A buyer''s own expiresAt on '
   'make may not be later than now + this (OFFER_EXPIRY_TOO_LATE). Seeded 48.',
   'ordinary'),
  ('offers.max_life_hours', 'int', '336', 'platform',
   'PC-56 STORE-3b (0211, founder D1): the ceiling on a whole offer negotiation, in hours from the FIRST offer. A counter whose new '
   'round would end after this is refused (OFFER_MAX_LIFE) and the negotiation lapses by its clock. Seeded 336 (14 days).',
   'ordinary')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 211.2  the negotiation's history, one row per act, append-only (founder D3)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_offer_rounds (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  offer_id    uuid NOT NULL REFERENCES listing_offers(id),
  round       smallint NOT NULL,
  party       varchar(10) NOT NULL,
  act         varchar(10) NOT NULL,
  price_minor bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lor_party CHECK (party IN ('buyer', 'seller', 'system')),
  CONSTRAINT ck_lor_act CHECK (act IN ('offer', 'counter', 'accept', 'decline', 'expire')),
  CONSTRAINT ck_lor_round CHECK (round >= 1),
  -- an offer / counter / accept names the price; a decline / expire names none
  CONSTRAINT ck_lor_price CHECK ((act IN ('offer', 'counter', 'accept')) = (price_minor IS NOT NULL AND price_minor > 0)),
  -- only the clock expires; only a party offers, counters, accepts or declines
  CONSTRAINT ck_lor_system CHECK ((act = 'expire') = (party = 'system'))
);
CREATE INDEX IF NOT EXISTS idx_listing_offer_rounds_offer ON listing_offer_rounds (offer_id, round);
COMMENT ON TABLE listing_offer_rounds IS
  'PC-56 STORE-3b (0211, founder D3): every act of an offer negotiation (offer / counter / accept / decline / expire) with the party, the '
  'round, the per-unit price (the listing''s currency; NULL for decline / expire) and the instant — written in the act''s own transaction. '
  'Append-only (kv_app SELECT + INSERT). Offers made before 0211 have no rows: the read synthesises round 1 from the offer row.';

DO $$
BEGIN
  EXECUTE 'ALTER TABLE listing_offer_rounds ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE listing_offer_rounds FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_listing_offer_rounds ON listing_offer_rounds';
  -- exactly the policy listing_offers carries (0020's tenant pass)
  EXECUTE 'CREATE POLICY tenant_isolation_listing_offer_rounds ON listing_offer_rounds USING (tenant_id IS NULL OR tenant_id = current_tenant_id())';
  EXECUTE 'REVOKE ALL ON listing_offer_rounds FROM kv_app, kv_relay';
END $$;
GRANT SELECT, INSERT ON listing_offer_rounds TO kv_app;
GRANT SELECT ON listing_offer_rounds TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 211.3  the decline reason (founder D3) — on the offer, from one vocabulary
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE listing_offers ADD COLUMN IF NOT EXISTS decline_reason_code varchar(40);
ALTER TABLE listing_offers ADD COLUMN IF NOT EXISTS declined_by varchar(10);
ALTER TABLE listing_offers DROP CONSTRAINT IF EXISTS ck_listing_offers_declined_by;
ALTER TABLE listing_offers ADD CONSTRAINT ck_listing_offers_declined_by CHECK (declined_by IS NULL OR declined_by IN ('buyer', 'seller'));
COMMENT ON COLUMN listing_offers.decline_reason_code IS
  'PC-56 STORE-3b (0211, founder D3): the CODE of the decline reason (lookup type offer_decline_reason) when the offer was declined with one; '
  'NULL otherwise (a decline without a reason, every offer declined before 0211). No free text exists.';
COMMENT ON COLUMN listing_offers.declined_by IS
  'PC-56 STORE-3b (0211): which side declined (buyer | seller — a moderator acts as the seller); NULL when not declined or declined before 0211.';

INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('offer_decline_reason', 'Offer decline reason', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, '{}'::jsonb, v.sort_order
  FROM (VALUES
    ('offer_decline_reason', 'price',         'The price does not work',                 1),
    ('offer_decline_reason', 'lot_committed', 'The lot is committed elsewhere',          2),
    ('offer_decline_reason', 'quantity',      'The quantity does not work',              3),
    ('offer_decline_reason', 'timing',        'The timing does not work',                4),
    ('offer_decline_reason', 'changed_mind',  'Changed my mind',                         5),
    ('offer_decline_reason', 'other',         'Another reason (no note is carried)',     6)
  ) AS v(type_code, code, default_name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);
