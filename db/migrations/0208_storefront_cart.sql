-- ==================================================================================================================
-- MIGRATION 0208 — PC-56 STORE-2b · WHAT'S IN THE CART IS REAL (canon W281 cart + its quantity chain W3041–W3044, its Remove / Accept price /
-- Resolve / Retry chain W3045–W3047, the add-to-cart chain on the listing page W3099–W3102 and the refused licence-upload chain W3092–W3095)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0207 are applied; nothing here edits them: this file only ADDS one flag row.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey F-11 / B24, founder Q13 — the 2b half): `GET/POST/PATCH/DELETE /v1/cart*` and `POST /v1/checkout*` ran behind NO
-- flag (Law 10 unmet). Canon W281 carries a "Flagged off — Cart disabled" state that had no flag it could read, and no operator could pause
-- buying on the platform without a deploy.
--
-- WHAT IS TRUE NOW:
--   208.1  flag `storefront_cart`, seeded **ON**. FOUNDER DECISION D2 (2026-10-15): ONE kill-switch for buying — the cart AND checkout (one
--          switch, buying is one act), read in ONE place: apps/api `StorefrontCartGate` (modules/orders/storefront-cart.guard.ts), a route
--          guard on `carts.controller.ts` (every /v1/cart* route, the new accept-price act included) and `checkout.controller.ts` (placement,
--          the preview and the delivery-methods read). OFF answers 503 STOREFRONT_CART_OFF (named). The storefront reads it through
--          `GET /v1/storefront/flags` (allow-listed, PLATFORM-scoped like `storefront_browse`) and says "buying is paused on this platform for
--          now" on the cart and checkout — never "for this tenant/plan" (canon refused by name).
--          A flag-store FAILURE reads as ON (fail OPEN), the reasoning of 0207's `storefront_browse`: the switch is for humans during an
--          incident; it moves no money and grants nothing (every money rule — the minimum order, the accepted price, the regulated rules, the
--          idempotent placement — is enforced whether the switch answers or not), so a dead flag store must not close every organisation's
--          till. An operator who flips it OFF is honoured within the flag cache's TTL once the store answers again.
--          **THE LAW 10 EXCEPTION, NAMED (the 0205 / 0207 pattern):** seeded ON, not OFF, because buying IS the store — the cart and checkout
--          have been live and unflagged since Phase 1 (mobile and the storefront both sell through them); seeding it OFF would stop every sale
--          on the platform the moment this file applied. The founder chose ON knowingly (D2); turning it OFF is the operator's switch.
--
-- NOTHING ELSE (brief A2) — every column the wave needs already exists, verified on krishalaya_dev before writing this file:
--   • `cart_items.added_price_minor` (0005) — the price snapshot; the accept-price act RE-SNAPSHOTS it to the current price inside the cart's
--     row lock. The act is recorded in `cart_items.updated_at` (0001 add_std_columns trigger) + `updated_by` (the buyer) and in the
--     response (`accepted.acceptedAt`); no `accepted_at` column is added (a cart writes no audit row — the canon's "audit trail entry" on the
--     cart chain is refused by name, and the money decision itself is frozen on the ORDER at placement: unit_price_minor = the accepted price);
--   • `cart_items.quantity numeric(14,3)` (0005) — decimal quantities to 3 places, now carried as decimal STRINGS end to end (F-24);
--   • `listings.min_order_qty numeric(14,3)` (0005) — the minimum, now enforced at cart add, cart update, the preview and placement;
--   • `regulated_product_rules` (0004) — `license_required` (national) refuses a cart add, `banned_state` refuses the preview / placement for
--     a delivery address inside the banned region's subtree (`admin_regions.path` ltree). GLOBAL master, no RLS, kv_app SELECT (0207 verified).
--   No buyer licence document type, no age check and no table for either (founder D1: the licence-upload chain is refused by name).
--
-- RLS / GRANTS DECISION: no table is created or altered. `feature_flags` keeps its existing policies and grants. Partition pass: not
-- partitioned.
--
-- REVERSAL (documented, not automatic): `DELETE FROM feature_flags WHERE key = 'storefront_cart'` — the gate then reads an unknown flag =
-- OFF, which PAUSES BUYING everywhere; so set it ON instead if buying must continue. Nothing existing is altered, so nothing needs restoring.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 208.1  storefront_cart — the platform's kill-switch for buying: the cart and checkout (ON; founder D2)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'storefront_cart',
       'PC-56 STORE-2b (0208, founder D2). The PLATFORM kill-switch for buying: every /v1/cart route (read, add, update, remove, clear, '
       'accept-price) and every /v1/checkout route (placement, the preview, the delivery-methods read). ON (seeded ON: buying IS the store — '
       'the named Law 10 exception) = buyers buy. OFF = each of those routes answers 503 STOREFRONT_CART_OFF and the storefront says buying '
       'is paused on this platform for now. Evaluated platform-wide; a flag-store failure reads ON. A kill-switch, not a rollout.',
       true, 100, '{}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = 'storefront_cart');
