-- apps/api/test/sql/01_app_role.sql
-- Give the least-privilege application roles LOGIN so the integration tests can connect as them.
-- The migrations CREATE kv_app / kv_wallet / kv_relay / kv_admin / kv_ingest (NOLOGIN) and grant their production
-- privileges; in production, ops grant the login/password out-of-band (db/prod/bootstrap-roles.sql). We deliberately do
-- NOT re-grant table privileges here, so each test role has EXACTLY the production privilege set — any missing grant
-- surfaces as a failing integration test instead of being papered over.
--
-- PC-56 TEST-1: roles are CLUSTER-WIDE, not per-database. This file used to force `ALTER ROLE kv_app ... PASSWORD
-- 'kv_app_pw'` on every run, which silently changed the password every other local database on the same server uses
-- (db/local/local-login-roles.sql sets 'dev'). It now only grants a login to a role that has none, with the same
-- weak dev password the local scripts and the specs (`u.password = 'dev'`) use — an existing login is left alone.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['kv_app', 'kv_wallet', 'kv_relay', 'kv_admin', 'kv_ingest'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      IF r = 'kv_app' THEN EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r, 'dev'); END IF;
    ELSIF NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r, 'dev');
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO kv_app;
