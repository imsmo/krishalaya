-- ==================================================================================================================
-- MIGRATION 0213 — PC-56 HOTFIX-6 · AN ADDRESS SOMEBODY ELSE IS DELIVERING TO IS NEVER EDITED IN PLACE
-- (no canon screen — the STORE-4 survey's P0 F-3 / B4 / E1, fixed before any STORE-4 screen is built)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0212 are applied; nothing here edits them: this file CREATES one function.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store4.md F-3, verified at c083bac1):
--   • `PATCH /v1/addresses/:id` UPDATEd the row in place (apps/api identity address.repository.ts). Orders keep only `delivery_address_id`
--     (0005), shipments join `addresses` live on `pickup_address_id` / `drop_address_id` (logistics delivery-route / logistics-desk /
--     village-run repositories), and the trade invoice resolves its place-of-supply state from the live row (payments
--     trade-invoice.repository.ts resolveParties). A buyer who edited "warehouse" after paying redirected goods in transit and could change the
--     IGST/CGST split of an invoice issued later.
--
-- WHAT IS TRUE NOW (HOTFIX-6 brief B3 — copy-on-write): `AddressService.update` asks THIS function, inside its transaction and with the row
-- locked, whether the address is in use; if it is, the edit INSERTs a new row (same owner, the edited fields, the default flag carried) and
-- soft-retires the old one (`deleted_at`) — every order, shipment, booking and subscription keeps pointing at the old id and its old values.
-- An address in use by nobody is edited in place, as before.
--
-- WHY A FUNCTION AND NOT A QUERY IN apps/api (THE DEVIATION — the brief expected no migration, or one column):
--   `orders`, `shipments`, `labour_bookings` and `d2c_subscriptions` are tenant-isolated (`tenant_id IS NULL OR tenant_id =
--   current_tenant_id()`). A person's address book is PLATFORM-level (`addresses.tenant_id IS NULL`): the same address can be the delivery
--   address of an order at organisation A while the buyer edits it from organisation B's storefront session. As kv_app, under B's tenant, A's
--   order is invisible — a request-tier EXISTS would answer "not in use" and the edit would move A's delivery in place. This function reads
--   across organisations, but returns ONE boolean, and only for an address the caller owns (`p_user` must be the row's `user_id`; anyone
--   else's id answers false and the service has already refused it with a 404). No row, no id and no tenant crosses back.
--
-- WHICH REFERENCES COUNT (every column that points at `addresses`, read from pg_constraint + information_schema on the 0212 schema):
--   COUNTED — a commitment to ANOTHER party that is in motion or on record:
--     orders.delivery_address_id (no FK; partitioned) · shipments.pickup_address_id · shipments.drop_address_id (no FK) ·
--     labour_bookings.farm_address_id · d2c_subscriptions.address_id.
--     (The trade invoice has no address column: it resolves the state through the ORDER's `delivery_address_id`, so the order covers it.)
--   NOT COUNTED — the owner's OWN standing records, which follow the owner's address book by design:
--     listings.address_id · warehouses.address_id · equipment_assets.base_address_id · service_offerings.address_id.
--   A retired (soft-deleted) order or shipment still counts: it is a record of where something went.
--
-- SCALE: four EXISTS probes per address EDIT (a human act, never a list). No index exists on these columns (orders is partitioned by month);
-- each probe stops at its first hit. An index on `orders (delivery_address_id)` is named in the HOTFIX-6 report as ops owed if edits grow.
--
-- RLS / GRANTS DECISION: no table is created, altered or re-granted; the RLS gate's count does not move. The function is SECURITY DEFINER with
-- `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO kv_app` only (the 0204 pattern). Partition pass: nothing.
--
-- REVERSAL (documented, not automatic): DROP FUNCTION kv_address_in_use(uuid, uuid); apps/api then refuses every address edit with a 500
-- until the service is reverted — revert the service first.
-- ==================================================================================================================

CREATE OR REPLACE FUNCTION kv_address_in_use(p_address uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM addresses a WHERE a.id = p_address AND a.user_id = p_user)
     AND (   EXISTS (SELECT 1 FROM orders o            WHERE o.delivery_address_id = p_address)
          OR EXISTS (SELECT 1 FROM shipments s         WHERE s.drop_address_id = p_address OR s.pickup_address_id = p_address)
          OR EXISTS (SELECT 1 FROM labour_bookings b   WHERE b.farm_address_id = p_address)
          OR EXISTS (SELECT 1 FROM d2c_subscriptions d WHERE d.address_id = p_address))
$$;

COMMENT ON FUNCTION kv_address_in_use(uuid, uuid) IS
  'PC-56 HOTFIX-6 (0213, survey STORE-4 F-3): is this address — owned by p_user — the destination or origin of any order, shipment, labour '
  'booking or d2c subscription, in ANY organisation? One boolean; false for an address p_user does not own. apps/api AddressService.update '
  'asks it with the row locked: true → copy-on-write (insert a new row, soft-retire the old); false → edit in place.';

REVOKE ALL ON FUNCTION kv_address_in_use(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_address_in_use(uuid, uuid) TO kv_app;
