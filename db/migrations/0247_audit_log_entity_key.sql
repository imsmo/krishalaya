-- ==================================================================================================================
-- MIGRATION 0247 — PC-56 TEST-1 · A GOD-MODE ACTION ON A THING NAMED BY A CODE CAN BE AUDITED (and therefore performed).
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. NOT MONEY: one nullable column on audit_log, nothing else.
-- ==================================================================================================================
--
-- WHAT WAS TRUE: `audit_log.entity_id` is `uuid` (0001). Several admin-api services audit an entity that has NO uuid — it is
-- named by a natural key: a feature flag (`flags.created` / `flags.killed` / `flags.ramped`, entityId = the flag key), an
-- integration provider (`providers.*`, the provider code), a lookup type (`catalogue.lookup_type.*`, its code), a risk rule
-- (`trust.risk_weight_*`, the event code), a residency profile (`cells.residency.profile_set`, the country code), a unit
-- (`catalogue-depth` unit edits, the unit code). AdminAuditWriter wrote that key into `entity_id`, Postgres refused it
--     error: invalid input syntax for type uuid: "itest.flag_…"
-- and because the audit row is written INSIDE the business transaction (atomic by design), the whole action rolled back. So the
-- owner console could not create a flag, PULL A KILL-SWITCH, ramp a rollout, toggle a provider or add a lookup type on a real
-- database. Found by the admin-api integration specs (flags-ops, providers-ops, global-catalogue-ops), which had never run in CI.
--
-- WHAT IS TRUE NOW: `entity_key` holds the natural key when the entity has no uuid; `entity_id` stays a uuid (NULL in that case).
-- AdminAuditWriter routes the value: a uuid goes to entity_id, anything else to entity_key. Nullable, no default: a catalogue-only
-- change on the partitioned table (no rewrite, no scan). Existing table-level grants cover the new column. No index — the audit
-- desk filters by action/actor/time (idx_audit_action / idx_audit_actor); an entity_key lookup index can follow if a screen needs it.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_key varchar(200);
COMMENT ON COLUMN audit_log.entity_key IS
  'Natural key of the audited entity when it has no uuid (flag key, provider code, lookup type code, country code). entity_id is NULL then. 0247.';
