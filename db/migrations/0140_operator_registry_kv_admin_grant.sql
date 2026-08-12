-- ============================================================================
-- MIGRATION 0140 — kv_admin CANNOT READ OR WRITE THE OPERATOR REGISTRY IT OWNS (PC-56, DEV-57 fix-forward)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
-- ---------------------------------------------------------------------------
-- DEFECT (found DEV-56 QA 2026-08-12, escalated §8, closed here on founder authorization to fix forward):
-- `0118_platform_operators.sql` creates `platform_operators`, `platform_operator_sessions`,
-- `platform_operator_restrictions`, `platform_access_policy` and `platform_step_up_events`, and grants `SELECT`
-- on all five to `kv_readonly` — and NEVER GRANTS `kv_admin` ANYTHING on any of them. `kv_admin` is the only
-- Postgres role `admin-api` ever connects as (`DATABASE_ADMIN_URL`, `admin-pool.ts`). Every one of
-- `AdminAuthGuard.canActivate()`'s `registry.observe()` call, `StepUpReauthGuard`, `HardwareKeyGuard`, and
-- `PlatformStaffService` (the `staff/operators` roster, `staff/operators/:id/suspend|reinstate`,
-- `staff/policy`) read or write these five tables through `operator-registry.repository.ts` — every one of
-- them 500s with Postgres `42501 permission denied for table platform_operators` (or the equivalent for the
-- other four) the moment it runs, live-reproduced by DEV-56 QA at login time and again by DEV-57 on
-- `GET /v1/staff/operators` against a genuinely fresh, migrated, seeded database. This is the SAME defect class
-- `0110_platform_blocklists_risk_grants.sql` already fixed for `platform_blocklists`/`risk_rules`/`appeals`
-- eight migrations earlier (0118 simply repeated it on its own new tables, one wave later).
--
-- THE LOCAL WORKAROUND `ADMIN_OPERATOR_REGISTRY_ENABLED=false` (documented DEV-56,
-- `Development_Program/DEV-56_ADMIN_LOCAL_RUN.md` step 5/7.3) ONLY SKIPS `AdminAuthGuard`'s OWN registry read on
-- login — it does not, and cannot, help `PlatformStaffService`'s direct reads/writes of these tables on the
-- `staff/operators` screen, which 500s with this flag either way. This migration is the actual fix; the env
-- flag remains available as a login-path-only workaround for anyone who has not yet applied it.
--
-- WHAT THIS GRANTS, AND WHY IT IS NOT `GRANT ALL` (Law 5 — minimal, reflected, never inferred):
-- Every statement `kv_admin` actually issues against these five tables was traced through
-- `operator-registry.repository.ts` and `platform-staff.service.ts` (the only two files that touch them):
--   * NO CODE PATH EVER DELETES A ROW on any of the five — every "removal" (session revocation, restriction
--     lift) is a soft UPDATE (a `revoked_at`/`lifted_at` timestamp), never a DELETE. So none of the five gets
--     a DELETE grant, on purpose — the same asymmetry 0118's own header describes for
--     `platform_operator_restrictions` ("this table can revoke, and can never grant") extends here to the SQL
--     verb level: a role that cannot DELETE a session/restriction/step-up row cannot destroy the evidence of
--     one either.
--   * `platform_operators` / `platform_operator_sessions` use `INSERT ... ON CONFLICT ... DO UPDATE` (the
--     first-sighting upsert `observe()` performs), so both INSERT and UPDATE are required even though the
--     call site is one statement.
--   * `platform_access_policy` is SELECT + UPDATE only — nothing ever INSERTs a new policy row (0118 seeds the
--     single `id=true` singleton at creation; `setPolicy()` only ever UPDATEs it).
--   * `platform_step_up_events` is SELECT + INSERT only — a step-up ceremony is recorded once and read back;
--     nothing ever amends or removes a past ceremony record.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON platform_operators, platform_operator_sessions, platform_operator_restrictions
  TO kv_admin;
GRANT SELECT, UPDATE ON platform_access_policy TO kv_admin;
GRANT SELECT, INSERT ON platform_step_up_events TO kv_admin;

COMMENT ON TABLE platform_operators IS
  'The observed roster of platform (god-mode) operators, first-sighting-provisioned by AdminAuthGuard (0118). '
  'kv_admin holds SELECT/INSERT/UPDATE only (0140) — no DELETE anywhere in this realm; kv_readonly keeps its '
  'pre-existing SELECT (0118) for the reporting plane.';
