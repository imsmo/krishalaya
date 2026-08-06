-- ============================================================================
-- MIGRATION 0104 — THE CROP LENS: calendar linkage + the source rule (PC-56 ADMIN-3c)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- DELTA-008 ASKED WHERE SEASONS AND MANDI-FEED MAPPING SHOULD LIVE, and offered two candidates: a `categories.meta
-- jsonb` column, or a new `crop_profiles` table. THE SURVEY REJECTS BOTH, and this migration is deliberately small as a
-- result — most of the answer was already in the schema.
--
-- ---------------------------------------------------------------------------
-- 1. THE MANDI MAPPING NEEDS NO NEW TABLE, AND IT DOES NOT BELONG ON A CATEGORY.
-- ---------------------------------------------------------------------------
-- `external_entity_refs` (0015) already models exactly this, and its own column comment lists 'product' among its example
-- entity types: (provider_code → integration_providers, entity_type, entity_id, external_id, sync_status,
-- last_synced_at, payload) with UNIQUE both ways — one mapping per entity per provider, and one entity per external id
-- per provider. That second constraint is the one a bespoke table would have forgotten: it stops two crops both claiming
-- Agmarknet commodity AGM-1101.
--
-- AND THE MAPPING MUST KEY TO A **PRODUCT**, NOT TO A CROP CATEGORY. This is the finding that matters:
--
--     mandi_prices.product_id uuid NOT NULL     -- 0013
--
-- The price series keys on PRODUCT. A category-level mapping would be unjoinable to any price — it would look correct on
-- the admin screen and resolve to nothing on the farmer's Mandi Pulse. The canon's W023 shows the mapping on a crop row
-- because a crop is what an operator thinks in, and that is right for the SCREEN; the crop row therefore shows a
-- ROLLUP ("3 of 5 products mapped") over the products in that branch, and the mapping itself lands on products.
--
-- So: no schema change for the mandi half. It needs an `agmarknet` provider row (below) and an admin surface.
--
-- ---------------------------------------------------------------------------
-- 2. SEASONS NEED NO NEW COLUMN EITHER — THEY ARE ALREADY DERIVABLE, AND BETTER.
-- ---------------------------------------------------------------------------
-- `crop_calendars` (0061) already carries `season` (CHECK kharif|rabi|zaid|perennial) per (crop, region), with a
-- `source` naming ICAR or a state department. So a crop's seasons ARE the distinct seasons of its sourced calendars.
--
-- That is strictly better than a column. A season typed into `categories.meta` is somebody's recollection; a season
-- backed by a sourced ICAR calendar is a claim with a citation — and W110's own rule is that agronomy content is
-- "sourced from ICAR/state depts, never fabricated". Deriving the season from the calendar makes the two consistent by
-- construction, and a crop with no calendar shows UNKNOWN rather than a guess.
--
-- WHAT THAT DOES REQUIRE is a reliable join, and today there is not one: `crop_calendars.crop_name` is FREE TEXT. Joining
-- a category to its calendars on a name would break the first time somebody wrote "Groundnut (Bt)" or "groundnut". Hence
-- the one real change in this file.
--
-- `crop_profiles` IS NOT CREATED. A table whose only columns would be a season list and a mapping — both of which live
-- better elsewhere — is a table that exists to satisfy a screen. `categories.meta jsonb` is not added either: a jsonb
-- blob on the taxonomy is where the next four unvalidated fields would go, and 0102 spent a migration proving how hard
-- it is to keep money and state out of one.
-- ============================================================================

-- ---------- 1. THE CALENDAR ↔ CROP LINK ----------
-- Nullable, because a calendar for a crop the taxonomy does not yet carry is still worth storing — an ICAR calendar for
-- a crop we have not launched is reference data, not an error. `crop_name` stays as the human label and the display
-- fallback; `category_id` is what a join uses.
ALTER TABLE crop_calendars ADD COLUMN category_id uuid REFERENCES categories(id);
COMMENT ON COLUMN crop_calendars.category_id IS
  'The crops.* category this calendar describes. NULL = not linked (crop_name is then the only handle). Added by 0104 (PC-56 ADMIN-3c): crop_name is free text, so deriving a crop''s seasons by matching names would break on "Groundnut (Bt)" vs "groundnut".';

-- The lookup W023 performs: this crop's calendars, by season.
CREATE INDEX idx_crop_calendar_category ON crop_calendars (category_id, season)
  WHERE is_active AND deleted_at IS NULL;

-- ---------- 2. THE SOURCE RULE, ENFORCED ----------
-- W110 states it twice — "sourced from ICAR/state depts, never fabricated" and "source field is mandatory" — and the
-- column has been NULLABLE since 0061. The schema has therefore permitted exactly the thing the canon forbids: an
-- unsourced agronomy calendar, which is advice a farmer acts on with nobody's name behind it.
--
-- SAFE TO MAKE NOT NULL: the table is EMPTY. No seed has ever inserted a crop calendar (verified — `db/seeds/` contains
-- no crop_calendars insert), so there is no row to backfill and no deployment to break. Had there been rows, this would
-- have needed a backfill-then-constrain pair across two migrations rather than one line.
--
-- A CHECK rather than a bare NOT NULL, so whitespace cannot satisfy it: ' ' is not a source.
ALTER TABLE crop_calendars ADD CONSTRAINT ck_crop_calendar_source_present CHECK (
  source IS NOT NULL AND length(btrim(source)) >= 3
);

-- STAGES MUST NOT BE EMPTY EITHER. A calendar with no stages is a duration and a season pretending to be agronomy —
-- W110's whole value is the stage timeline, and the farmer-facing crop hub renders per-stage advisory.
ALTER TABLE crop_calendars ADD CONSTRAINT ck_crop_calendar_stages_present CHECK (
  jsonb_typeof(stages) = 'array' AND jsonb_array_length(stages) >= 1
);

-- ---------- 3. THE AGMARKNET PROVIDER ----------
-- `external_entity_refs.provider_code` is an FK to `integration_providers`, and no agmarknet row exists — so a mapping
-- could not currently be written even though the table is right. Inserted here rather than in a seed for the reason 0101
-- established: the mapping endpoint is fail-closed on the FK, and a skipped seed would mean an admin screen that accepts
-- a mapping and rejects it at the database.
--
-- The column list is (code, default_name, category, is_active) — checked against 0002 rather than assumed. `category` is
-- NOT NULL, and 'government' is the right one: Agmarknet is the Directorate of Marketing & Inspection's price feed.
-- 0002's own PK comment already lists 'agmarknet' as an intended provider code, so this is filling in a row the schema
-- was designed to expect.
INSERT INTO integration_providers (code, default_name, category, is_active)
VALUES ('agmarknet', 'Agmarknet (Directorate of Marketing & Inspection)', 'government', true)
ON CONFLICT (code) DO NOTHING;

-- ---------- 4. THE AUDIT VOCABULARY ----------
-- Same reasoning as 0102 and 0103: a crop-calendar edit is a change to advice a farmer plants by, and a mandi mapping
-- edit changes which price series a crop resolves to. Neither could be recorded before this.
ALTER TABLE catalogue_changes DROP CONSTRAINT IF EXISTS catalogue_changes_entity_type_check;
ALTER TABLE catalogue_changes ADD CONSTRAINT catalogue_changes_entity_type_check CHECK (entity_type IN (
  'lookup_type', 'lookup_value', 'category',
  'attribute', 'attribute_option', 'category_attribute', 'unit', 'unit_conversion',   -- 0102
  'translation', 'translation_reviewer', 'translation_run',                            -- 0103
  'crop_calendar',      -- the stage timeline and its source
  'mandi_mapping'       -- a product ↔ Agmarknet commodity code
));

-- ---------- 5. grants (the 0014/0018 default-privileges trap) --------------------------------------
-- crop_calendars already has RLS (0061 re-runs the idempotent pass) and the tenant API already READS it through the
-- education module — tenants may also add their OWN calendars, which is why kv_app keeps INSERT here unlike everywhere
-- else in the taxonomy. What it must not do is edit a PLATFORM-GLOBAL row; the RLS policy already scopes that.
GRANT SELECT, INSERT, UPDATE ON crop_calendars TO kv_admin;

-- external_entity_refs: admin-api authors the mappings, the tenant API reads them (a price lookup resolves through one),
-- and the relay reads them for the ingest.
REVOKE INSERT, UPDATE, DELETE ON external_entity_refs FROM kv_app;
GRANT SELECT ON external_entity_refs TO kv_app, kv_readonly;
GRANT SELECT, INSERT, UPDATE ON external_entity_refs TO kv_admin;
GRANT SELECT, INSERT, UPDATE ON external_entity_refs TO kv_relay;
