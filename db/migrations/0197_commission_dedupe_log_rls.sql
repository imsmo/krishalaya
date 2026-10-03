-- ==================================================================================================================
-- MIGRATION 0197 — PC-56 TENANT-SW-a · fix-forward: RLS ENABLE + FORCE on commission_rule_dedupe_log
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0196 is applied; nothing here edits it.)
-- ==================================================================================================================
--
-- 0196 created commission_rule_dedupe_log — the record of every duplicate PLATFORM (tenant_id IS NULL) commission row it soft-retired.
-- It has no tenant column (it logs platform rows only), kv_app and kv_relay hold nothing on it, and kv_readonly holds SELECT. The
-- RLS coverage gate does not flag it (it is not tenant-scoped), but the programme rule is "RLS ENABLE + FORCE on every new table".
-- So: ENABLE + FORCE, the admin-realm policy every 0175-shaped table carries, and a read policy for kv_readonly (reporting) — the
-- only role granted anything. No tenant policy: there is no tenant row to own, and no request-tier role is granted access.
ALTER TABLE commission_rule_dedupe_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rule_dedupe_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crdl_admin_realm ON commission_rule_dedupe_log;
CREATE POLICY crdl_admin_realm ON commission_rule_dedupe_log FOR ALL TO kv_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS crdl_readonly ON commission_rule_dedupe_log;
CREATE POLICY crdl_readonly ON commission_rule_dedupe_log FOR SELECT TO kv_readonly USING (true);

REVOKE ALL ON commission_rule_dedupe_log FROM kv_app, kv_relay;
