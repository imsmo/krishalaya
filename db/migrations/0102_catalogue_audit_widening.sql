-- ============================================================================
-- MIGRATION 0102 — CATALOGUE AUDIT WIDENING + ATTRIBUTE OPTION SCOPING (PC-56 ADMIN-3)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THIS MIGRATION EXISTS BECAUSE OF A DEFECT, NOT A FEATURE. ADMIN-3's survey compared the canon's catalogue screens
-- against the built taxonomy plane and found the audit trail is only two-thirds wired:
--
--   catalogue_changes.entity_type CHECK (entity_type IN ('lookup_type', 'lookup_value', 'category'))
--
-- So a category rename is audited, a lookup value's deactivation is audited — and an ATTRIBUTE's validation range, a
-- UNIT's conversion factor, and a category's ATTRIBUTE BINDINGS cannot be. Not "are not": CANNOT BE. Any code trying to
-- record one would violate the CHECK.
--
-- AND THE ONE WRITE PATH THAT ALREADY EXISTED PROVES THE POINT. `catalogue-depth.service.ts` can create a unit and
-- deactivate one, and it does both with:
--   • no `catalogue_changes` row,
--   • no `reason` parameter anywhere in its signature,
--   • no transaction.
-- Its sibling module `global-catalogue-ops` requires a mandatory audit reason on every single mutation. Two modules, one
-- domain, opposite standards — and the unaudited one is the module touching UNIT CONVERSION FACTORS, which the canon
-- (W025) calls out as checker-gated because "factor edits change quoted quantities platform-wide". A bigha is 2.5 acres
-- in Gujarat and about 1.6 in UP; somebody editing that number and leaving no trace is the whole reason this file exists.
--
-- ============================================================================

-- ---------- 1. WIDEN THE AUDIT VOCABULARY ----------
-- varchar(16) is also too narrow for the new kinds ('category_attribute' is 19), so the column widens with the CHECK.
-- Dropping and re-adding the constraint is safe here: the new set is a strict superset, so no existing row can fail it.
ALTER TABLE catalogue_changes DROP CONSTRAINT IF EXISTS catalogue_changes_entity_type_check;
ALTER TABLE catalogue_changes ALTER COLUMN entity_type TYPE varchar(24);
ALTER TABLE catalogue_changes ADD CONSTRAINT catalogue_changes_entity_type_check CHECK (entity_type IN (
  'lookup_type', 'lookup_value', 'category',        -- the original three (0041)
  'attribute',                                       -- attribute_definitions: data_type, validation, unit
  'attribute_option',                                -- attribute_options: the values a farmer may pick
  'category_attribute',                              -- the BINDINGS: which attributes a category requires
  'unit',                                            -- units: code, class, active
  'unit_conversion'                                  -- unit_conversions: the factor. The most consequential of the lot.
));

-- The `action` vocabulary needs two more verbs the taxonomy actually performs. `bound`/`unbound` are not `created`/
-- `deleted`: binding an existing attribute to a category creates no attribute and destroys none, and calling it
-- "created" would make the ledger unreadable at exactly the moment somebody is asking what changed.
ALTER TABLE catalogue_changes DROP CONSTRAINT IF EXISTS catalogue_changes_action_check;
ALTER TABLE catalogue_changes ADD CONSTRAINT catalogue_changes_action_check CHECK (action IN (
  'created', 'updated', 'activated', 'deactivated', 'moved', 'renamed',
  'bound', 'unbound'
));

COMMENT ON COLUMN catalogue_changes.entity_type IS
  'Widened by 0102 (PC-56 ADMIN-3) from the original three kinds. Attribute, option, binding, unit and unit-conversion edits were previously IMPOSSIBLE to audit — the CHECK rejected them — which meant the one existing unit write path had no trail at all.';

-- ---------- 2. UNIT CONVERSIONS: THE MISSING GUARDS ----------
-- The table has (from_unit, to_unit) as its PK and a numeric(20,10) factor, and nothing else. Three things it permits
-- today that are arithmetic nonsense, each of which would silently corrupt a quoted quantity:
--
--   a) A REFLEXIVE ROW with a factor other than 1. `kg → kg = 2.2` is not a typo anybody would notice in a table of
--      fifty rows, and every quantity in kilograms would double somewhere downstream.
--   b) A ZERO OR NEGATIVE FACTOR. Zero makes every converted quantity zero — a seller's 40 quintals becomes nothing.
--      Negative is not a unit conversion in any physical sense.
--   c) A CROSS-CLASS CONVERSION. `litre → acre` is meaningless, and the class column exists precisely to say so.
--      Enforced by trigger rather than CHECK because a CHECK cannot read another table.
ALTER TABLE unit_conversions ADD CONSTRAINT ck_unit_conversion_factor_positive CHECK (factor > 0);
ALTER TABLE unit_conversions ADD CONSTRAINT ck_unit_conversion_reflexive_is_one CHECK (
  from_unit <> to_unit OR factor = 1
);

CREATE OR REPLACE FUNCTION trg_unit_conversion_same_class() RETURNS trigger AS $$
DECLARE
  from_class text;
  to_class   text;
BEGIN
  SELECT unit_class INTO from_class FROM units WHERE code = NEW.from_unit;
  SELECT unit_class INTO to_class   FROM units WHERE code = NEW.to_unit;
  IF from_class IS NULL OR to_class IS NULL THEN
    RAISE EXCEPTION 'unit_conversions references an unknown unit (% or %)', NEW.from_unit, NEW.to_unit;
  END IF;
  IF from_class <> to_class THEN
    -- named in full because the person who sees this is mid-edit and needs to know WHY, not just that it failed
    RAISE EXCEPTION 'cannot convert % (%) to % (%): a conversion only exists within one unit class',
      NEW.from_unit, from_class, NEW.to_unit, to_class;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS unit_conversions_same_class ON unit_conversions;
CREATE TRIGGER unit_conversions_same_class
  BEFORE INSERT OR UPDATE ON unit_conversions
  FOR EACH ROW EXECUTE FUNCTION trg_unit_conversion_same_class();

-- Standard columns so a conversion can be soft-deleted and attributed like everything else in this domain. It had none:
-- a factor could be changed with no record of when or by whom, which is the same hole as the missing audit kind above.
--
-- ONLY THE TWO THAT LACK THEM. `units` already got its std columns in 0001 (line ~203) and `attribute_options` in 0004.
-- add_std_columns is NOT idempotent despite its ADD COLUMN IF NOT EXISTS: it also does a bare `CREATE TRIGGER %I_uat`,
-- so calling it twice for one table fails the whole migration on a duplicate trigger name. Verified per table before
-- writing these two lines rather than after watching the migration abort.
CALL add_std_columns('unit_conversions');
CALL add_std_columns('lookup_types');

-- ---------- 3. ATTRIBUTE OPTIONS: THE SCOPING THE CANON NEEDS (W024's DELTA-009) ----------
-- The canon's W024 shows variety options scoped TO A CROP — "attribute_options for `variety` scoped to
-- crops.cereals.wheat" — and states the gap itself: "attribute_options is one global list per attribute
-- (UNIQUE attribute_id+code) — category scoping shown here needs either per-crop attribute codes (variety_wheat) or a
-- category_id column. Design leads."
--
-- THE DECISION, AND WHY. `category_id` on the option, nullable:
--   • NULL means "this option belongs to the attribute everywhere" — which is what every existing row means, so nothing
--     changes on the day this applies and the `grade` set stays one shared list (the canon shows exactly that: "Attribute
--     `grade` uses one option set across crops").
--   • A category_id narrows an option to a branch. Wheat's Lokwan stops being offered for groundnut.
-- The rejected alternative was per-crop attribute CODES (`variety_wheat`, `variety_groundnut`). That would multiply 214
-- crops into 214 attribute definitions, break every binding, and make "which attribute is this?" unanswerable — the
-- listing form would have to know a naming convention instead of following a foreign key.
ALTER TABLE attribute_options ADD COLUMN category_id uuid REFERENCES categories(id);
COMMENT ON COLUMN attribute_options.category_id IS
  'NULL = the option applies to this attribute for every category (the shared set, e.g. grade). Set = the option is only offered under that category subtree, which is what W024 shows for varieties. Added by 0102 (PC-56 ADMIN-3, closes DELTA-009).';

-- The old UNIQUE (attribute_id, code) would now reject Lokwan-for-wheat alongside Lokwan-for-anything, so it becomes
-- scope-aware. TWO partial indexes rather than one nullable-column index, because in Postgres NULLs do not collide: a
-- single UNIQUE (attribute_id, category_id, code) would happily accept two global rows with the same code.
ALTER TABLE attribute_options DROP CONSTRAINT IF EXISTS attribute_options_attribute_id_code_key;
CREATE UNIQUE INDEX uq_attribute_option_global ON attribute_options (attribute_id, code)
  WHERE category_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_attribute_option_scoped ON attribute_options (attribute_id, category_id, code)
  WHERE category_id IS NOT NULL AND deleted_at IS NULL;
-- the lookup W024 performs: this attribute's options for this category, in display order
CREATE INDEX idx_attribute_option_scope ON attribute_options (attribute_id, category_id, sort_order)
  WHERE is_active AND deleted_at IS NULL;

-- ---------- 4. grants (the 0014/0018 default-privileges trap) --------------------------------------
-- These are PLATFORM REFERENCE tables with no tenant_id, read by every tenant and written only by the admin realm.
-- add_std_columns above does not touch privileges, but the ALTERs and the new indexes are a good moment to make the
-- intended shape explicit rather than inherited: the tenant API must never write the taxonomy, because a tenant editing
-- a unit conversion would change quoted quantities for every other tenant on the platform.
REVOKE INSERT, UPDATE, DELETE ON units, unit_conversions, lookup_types, attribute_options, attribute_definitions,
  category_attributes, categories FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON units, unit_conversions, lookup_types, attribute_options, attribute_definitions,
  category_attributes, categories FROM kv_relay;
GRANT SELECT ON units, unit_conversions, lookup_types, attribute_options, attribute_definitions,
  category_attributes, categories TO kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT, UPDATE ON units, unit_conversions, attribute_options, attribute_definitions,
  category_attributes TO kv_admin;
-- No DELETE for anybody, anywhere in this domain: a category or attribute that has ever been used is referenced by
-- listings whose history must stay readable. Deactivation is the mechanism; 0041's ledger records it.
