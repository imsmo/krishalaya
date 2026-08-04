-- ============================================================================
-- db/local/local-login-roles.sql · LOCAL DEV ONLY — give the app roles a login.
--
-- WHY THIS EXISTS (read this — it's the #1 thing that trips people up):
--   The migrations create the application roles (kv_app, kv_wallet, kv_relay) as
--   NOLOGIN — they have permissions but cannot open a connection. That's correct for
--   production (the real password lives in AWS Secrets Manager, attached out-of-band).
--   On your laptop there is no Secrets Manager, so you must give each role a LOGIN and a
--   password ONCE, after migrations have created them.
--
-- ORDER: run this AFTER `pnpm migrate` (migrations create the roles) and BEFORE you start
--   the apps. Safe to re-run. Password is 'dev' to match the .env files in this guide.
--
-- RUN IT (from the repo root, with Docker Postgres up):
--   psql "postgres://postgres:dev@localhost:5432/krishalaya" -f db/local/local-login-roles.sql
--
-- NEVER run this in staging/production. These are weak dev passwords on purpose.
-- ============================================================================

ALTER ROLE kv_app    WITH LOGIN PASSWORD 'dev';   -- the API / worker / web SSR connect as this (RLS-enforced)
ALTER ROLE kv_wallet WITH LOGIN PASSWORD 'dev';   -- ONLY the wallet-service connects as this (ledger writer)
ALTER ROLE kv_relay  WITH LOGIN PASSWORD 'dev';   -- outbox relay / ai-services audit log (BYPASSRLS infra role)

-- Sanity print: confirm all three can now log in (rolcanlogin = t).
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('kv_app','kv_wallet','kv_relay')
ORDER BY rolname;
