-- ============================================================================
-- MIGRATION 0135 — FARMER 360'S READ PATHS, AND NOTHING ELSE (PC-56 ADMIN-SWEEP-b4, W109 + W2161–W2165)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- "NO NEW TABLES" IS THE CANON'S OWN CONSTRAINT, KEPT LITERALLY
-- ---------------------------------------------------------------------------
-- W109: "derived view across orders, listings, wallet, dairy, schemes (no new tables)". This migration creates
-- none. The VIEW-level access log is a row in the existing `audit_log` (`analytics.farmer360_opened` — the exact
-- discipline W155's tenant twin uses with `member.view360_opened`); the export receipt reuses 0120's append-only
-- `report_export_receipts` (report = 'farmer360_profile'); the permission is a catalog line in owner-roles.ts
-- (0120's own header deferred `analytics.farmer360` to "the wave that builds the route" — this is that wave).
--
-- What a derived-at-query-time view DOES need is for its reads not to be sequential scans. Two per-user paths had
-- no index at all, priced during the survey:
--   • dairy income joins milk_bills → dairy_memberships ON farmer_user_id — no index on that column anywhere;
--   • the dispute record's only index is partial on OPEN rows and EXCLUDES 'resolved' — the exact rows a trust
--     badge needs ("4/4 disputes resolved" is unanswerable from that index).
-- A 360 that times out on the farmer with the longest history would refuse exactly the person it is most about.
CREATE INDEX idx_dairy_memberships_farmer ON dairy_memberships (farmer_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_disputes_raised_by ON disputes (raised_by, created_at DESC);
CREATE INDEX idx_disputes_against ON disputes (against_user, created_at DESC);

COMMENT ON INDEX idx_disputes_raised_by IS
  'W109 (ADMIN-SWEEP-b4): the per-user dispute record. The pre-existing partial index excludes resolved rows, which are exactly what a trust badge counts.';
