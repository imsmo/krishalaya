-- ==================================================================================================================
-- MIGRATION 0181 — PC-56 TENANT-9c · THE AUDITOR REALM — A READ-ONLY ROLE, AN AUDITED READ, A FUNNELLED LEDGER
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0004 seed, 0014, 0128 and 0180 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t9.md F-8 … F-12, F-17, F-18), RE-PROVEN AT 640d41e BEFORE THIS FILE:
--   • F-8  THE AUDITOR WAS NOT READ-ONLY BY CONSTRUCTION. `POST /v1/invoices/:id/credit-notes` was gated by `report.view`
--          alone (`credit-note.service.ts:61` → `canReadFinance` = `report.view`), and the auditor holds `report.view` — so
--          the role the canon defines by having NO business-data write could issue a GST credit note. 201 of 542 mutating
--          routes carried no permission at all. Meanwhile `ledger.read`, which the auditor holds, gated no tenant route.
--   • F-9  THE AUDIT READ: diffs unmasked, never itself audited, `actor_role` written by 0 of 246 writer call sites.
--   • F-10 THE LEDGER HAS NO RLS on the tables anyone queries (0014:121, by design — "history is physics, not policy"), and
--          the platform accounts (escrow, fees, payouts) are STRIPED across every tenant's money events, so a per-tenant
--          chain verification of a platform account is impossible by construction (ADMIN-6's finding — cited, not re-litigated).
--   • F-12 THE 0175 CLASS ON `audit_log`: one FOR ALL policy, `tenant_id IS NULL OR tenant_id = current_tenant_id()`, no WITH
--          CHECK — `kv_app` under ANY tenant context could INSERT a platform-level (NULL-tenant) audit row (proven at
--          640d41e, rolled back: `INSERT … (NULL, 'platform.forged_by_tenant_ctx')` → `INSERT 0 1`).
--   • F-17 No fiscal year anywhere (`setting_definitions` has no `fiscal|fy` key); the canon bounds everything by "FY".
--   • F-18 The canon's auditor holds read codes the platform did not have as rows (`kyc.read`, `governance.read`).
--
-- WHAT THIS FILE DOES
--   181.1  THE WALL ON audit_log (F-12, 0175's split). The FOR ALL policy is dropped on the parent AND on every partition and
--          replaced by `al_read` (SELECT: `tenant_id = current_tenant_id()` — a platform row is the platform's, and every
--          tenant read path already binds `tenant_id = $tenant`, so nothing that worked stops working), `al_insert` (INSERT
--          WITH CHECK `tenant_id = current_tenant_id()` — NULL never matches, so a platform audit row is NEVER writable from
--          the tenant realm) and `al_admin_realm` (FOR ALL TO kv_admin — Law 11's realm, named, not left to an attribute).
--          No UPDATE / DELETE policy for anybody in the tenant realm: 0014 already revoked both from kv_app (restated).
--          `actor_role` widens 40 → 200: the writer now records the caller's role SET, which can be longer than one code.
--   181.2  THE AUDITED READ (F-9). `audit_read_purposes` — the closed vocabulary of why an auditor read something — and
--          `audit_read_log`, PARTITIONED monthly on `created_at` exactly like audit_log (Law 8), RLS ENABLE + FORCE on the
--          parent and every partition, tenant_id NOT NULL, append-only (kv_app SELECT + INSERT only; a trigger refuses
--          UPDATE / DELETE for every role, owner included). One row per auditor page read and per export enqueue: who, as
--          which roles, why (purpose), on which surface, with which filter, how many rows, the first and last row returned.
--   181.3  THE PERMISSIONS (F-8, F-18; rows here AND in seed 0004 — 0128's lesson). `payments.credit_note.issue` — the money
--          verb a credit note now needs (tenant_admin; no tenant finance role exists — `platform_finance` is platform-scope).
--          `kyc.read` (the KYC desk's reads, never its acts) and `governance.read` (the share register + resolutions) — the
--          canon's auditor reads. THE AUDITOR'S SET IS EXACTLY: audit.read, ledger.read, kyc.read, governance.read,
--          report.view. 0128's `listing.view_any` grant to the auditor is REMOVED (the canon's "What the auditor can see"
--          lists no listing console; a moderation read is a staff desk's).
--          BLAST RADIUS, STATED: before this file a credit note could be issued by every holder of `report.view` —
--          tenant_admin, auditor, gov_officer, support_agent. After it: tenant_admin only (and `*`). gov_officer and
--          support_agent lose the issue (they keep every read `report.view` gives); the auditor loses it AND is refused
--          every non-GET by the AuditorReadOnlyGuard (apps/api core/auth) — the structural fix this row only backs up.
--   181.4  THE FISCAL YEAR (F-17, rule zero). `countries.fiscal_year_start_month` — declared per country, IN = 4 (the
--          Income-tax Act's April–March "previous year"); every other seeded country is left NULL (undeclared — the realm
--          refuses an "FY" figure there by name rather than assume April). `finance.fiscal_year_start_month` — a tenant
--          setting that overrides the country (a cooperative whose bye-laws keep a July–June year). `tenant_fiscal_year_
--          start_month(tenant)` resolves the two, NULL when neither says.
--
-- WHAT THIS FILE DOES NOT DO (named): it does not put RLS on wallet_accounts / ledger_entries / ledger_transactions (0014's
-- deliberate exclusion; the auditor's ledger read is ONE funnel in apps/api, `AuditorLedgerReadModel`, pinned by a spec that
-- reads its SQL); it grants kv_app nothing on `ledger_chain_verifications` (no tenant_id; a platform verification of a striped
-- account is not a fact about one tenant); it adds no signing key (founder-physical); it sweeps no other 0175-class table.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 181.1  THE WALL ON audit_log
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE audit_log ALTER COLUMN actor_role TYPE varchar(200);

DO $$
DECLARE r record;
BEGIN
  -- The parent first, then every partition that exists (0014's loop gave each partition its own copy of the class).
  FOR r IN
    SELECT 'audit_log'::text AS rel
    UNION ALL
    SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'audit_log'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || r.rel, r.rel);
    EXECUTE format('DROP POLICY IF EXISTS al_read ON %I', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS al_insert ON %I', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS al_admin_realm ON %I', r.rel);
    EXECUTE format('CREATE POLICY al_read ON %I FOR SELECT USING (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY al_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY al_admin_realm ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', r.rel);
  END LOOP;
END $$;

-- Restated, not new: the trail is append-only from the tenant realm (0014:153-158).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 181.2  THE AUDITED READ
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE audit_read_purposes (
  code        varchar(40) PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]{2,39}$'),
  description text NOT NULL
);
INSERT INTO audit_read_purposes (code, description) VALUES
  ('auditor_overview', 'W200 — the auditor overview: ledger invariants, counts, the latest transactions'),
  ('trail_page',       'A page of the audit trail (filters + keyset)'),
  ('trail_entry',      'One audit-trail entry opened (masked diff)'),
  ('trail_reveal',     'One audit-trail entry UNMASKED by a recorded reveal (member.pii.reveal, reason >= 20)'),
  ('ledger_page',      'W436 — a page of the ledger drill-down (tenant-funnelled entry legs)'),
  ('compliance_pack',  'W437 — the compliance pack summary'),
  ('export_list',      'W201 — the auditor''s own export jobs'),
  ('export_enqueue',   'W2498 — an export enqueued (the realm''s one act; it produces a file, it changes no business data)')
ON CONFLICT (code) DO NOTHING;
REVOKE ALL ON audit_read_purposes FROM kv_app, kv_relay;
GRANT SELECT ON audit_read_purposes TO kv_app, kv_relay, kv_readonly;

CREATE TABLE audit_read_log (
  id             bigserial,
  tenant_id      uuid         NOT NULL,
  actor_user_id  uuid         NOT NULL,
  actor_role     varchar(200) NOT NULL,
  purpose        varchar(40)  NOT NULL REFERENCES audit_read_purposes(code),
  surface        varchar(120) NOT NULL,
  filter         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  row_count      integer      NOT NULL CHECK (row_count >= 0),
  span_first     varchar(80),
  span_last      varchar(80),
  window_from    timestamptz,
  window_to      timestamptz,
  request_id     varchar(60),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_arl_window CHECK (window_from IS NULL OR window_to IS NULL OR window_from <= window_to)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_arl_tenant_time ON audit_read_log (tenant_id, created_at DESC);
CREATE INDEX idx_arl_actor_time  ON audit_read_log (actor_user_id, created_at DESC);
COMMENT ON TABLE audit_read_log IS
  'PC-56 TENANT-9c (F-9). Every auditor read is itself recorded: who (actor + role set), why (purpose, a closed vocabulary), on which surface, with which filter, how many rows and which span. Append-only; partitioned monthly like audit_log (Law 8).';

-- The monthly partitions — 0014's `ensure_partitions` shape (current month .. 14 ahead + DEFAULT), for THIS table only:
-- calling the procedure itself walks every partitioned table in the schema and costs ~56 s of no-op CREATE … IF NOT
-- EXISTS on a full database (measured). The procedure remains the scheduled maintenance; it covers this table from now on.
DO $$
DECLARE m date;
BEGIN
  FOR i IN 0..14 LOOP
    m := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_read_log FOR VALUES FROM (%L) TO (%L)',
                   'audit_read_log_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
  EXECUTE 'CREATE TABLE IF NOT EXISTS audit_read_log_default PARTITION OF audit_read_log DEFAULT';
END $$;

CREATE OR REPLACE FUNCTION audit_read_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_read_log is append-only — a recorded read is never edited or removed (PC-56 TENANT-9c)'
    USING ERRCODE = '42501';
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'audit_read_log'::text AS rel
    UNION ALL
    SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'audit_read_log'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS arl_read ON %I', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS arl_insert ON %I', r.rel);
    EXECUTE format('DROP POLICY IF EXISTS arl_admin_realm ON %I', r.rel);
    EXECUTE format('CREATE POLICY arl_read ON %I FOR SELECT USING (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY arl_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY arl_admin_realm ON %I FOR SELECT TO kv_admin USING (true)', r.rel);
  END LOOP;
END $$;

CREATE TRIGGER trg_arl_append_only BEFORE UPDATE OR DELETE ON audit_read_log
  FOR EACH ROW EXECUTE FUNCTION audit_read_log_append_only();

REVOKE ALL ON audit_read_log FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON audit_read_log TO kv_app;
GRANT SELECT ON audit_read_log TO kv_relay, kv_readonly;
GRANT USAGE ON SEQUENCE audit_read_log_id_seq TO kv_app;
DO $$
DECLARE r record;
BEGIN
  -- Partitions are reached through the parent; nobody in the tenant realm may write one directly either.
  FOR r IN SELECT c.relname::text AS rel FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'audit_read_log'::regclass
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', r.rel);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', r.rel);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 181.3  THE PERMISSIONS
-- ------------------------------------------------------------------------------------------------------------------
-- The role this section grants to is guaranteed here (0180's shape, copied exactly from seed 0004:18): on a from-empty
-- database migrations run before seeds, and a grant to a role that does not exist yet is a grant to nobody.
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'auditor', 'Auditor / Accountant', 'tenant', false, true, NULL
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'auditor');
-- …and the two read codes it already held (seed 0004:52-53), so the five land in THIS file on a from-empty database too.
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('ledger.read', 'Read ledger (auditor)', 'M05'),
  ('audit.read', 'Read the append-only audit trail (auditor)', NULL),
  ('report.view', 'View reports', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('payments.credit_note.issue', 'Issue a GST credit note against an approved proposal (a money verb — never report.view)', 'M05'),
  ('kyc.read', 'Read the KYC desk — the organisation''s documents, the member desk and the queue (no act, no reveal)', 'M01'),
  ('governance.read', 'Read the share register, the resolutions and their tallies (never an individual ballot)', 'M04')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (r.code = 'tenant_admin' AND p.code IN ('payments.credit_note.issue', 'kyc.read', 'governance.read'))
    OR (r.code = 'auditor'      AND p.code IN ('audit.read', 'ledger.read', 'kyc.read', 'governance.read', 'report.view'))
ON CONFLICT DO NOTHING;

-- THE AUDITOR'S SET IS EXACTLY FIVE. Anything else a prior file granted it is removed here (0128's listing.view_any).
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id AND r.code = 'auditor'
   AND rp.permission_code NOT IN ('audit.read', 'ledger.read', 'kyc.read', 'governance.read', 'report.view');

-- ------------------------------------------------------------------------------------------------------------------
-- 181.4  THE FISCAL YEAR
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE countries ADD COLUMN IF NOT EXISTS fiscal_year_start_month smallint
  CONSTRAINT ck_countries_fy_month CHECK (fiscal_year_start_month IS NULL OR fiscal_year_start_month BETWEEN 1 AND 12);
COMMENT ON COLUMN countries.fiscal_year_start_month IS
  'PC-56 TENANT-9c (F-17). The month a statutory financial year starts in this country (IN = 4). NULL = not declared: the realm refuses an "FY" figure by name rather than assume one.';
UPDATE countries SET fiscal_year_start_month = 4 WHERE code = 'IN' AND fiscal_year_start_month IS NULL;

INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class)
VALUES ('finance.fiscal_year_start_month', 'int', 'null'::jsonb, 'tenant',
        'The month (1–12) this cooperative''s financial year starts. Empty = the country''s declared year (countries.fiscal_year_start_month).',
        'ordinary')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION tenant_fiscal_year_start_month(p_tenant uuid) RETURNS smallint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(s.value) = 'number' AND (s.value)::text ~ '^[0-9]{1,2}$'
                  AND (s.value)::text::int BETWEEN 1 AND 12 THEN (s.value)::text::smallint END
       FROM tenant_settings s WHERE s.tenant_id = p_tenant AND s.key = 'finance.fiscal_year_start_month' AND s.deleted_at IS NULL),
    (SELECT c.fiscal_year_start_month FROM tenants t JOIN countries c ON c.code = t.country_code WHERE t.id = p_tenant)
  );
$$;
GRANT EXECUTE ON FUNCTION tenant_fiscal_year_start_month(uuid) TO kv_app, kv_relay, kv_readonly;
