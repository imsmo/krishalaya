-- ==================================================================================================================
-- MIGRATION 0183 — PC-56 TENANT-9d · ESG — NO METHOD, NO METRIC
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0015, 0181 and 0182 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t9.md F-16, F-11, F-17, F-18), RE-PROVEN AT 9158dee BEFORE THIS FILE:
--   • F-16 ESG DID NOT EXIST. No table, no metric registry, no method registry (the canon's `KV-ESG-M2` is in no file),
--          no route, no flag, no permission — `grep -rln "esg\|ESG\|sustainab" apps/api/src apps/web-tenant/src
--          packages/sdk-js/src` → 0. W423 draws fourteen rows of figures ("214 parcels", "18%", "94.8%", "0 hits —
--          34-day streak") and says each "already lives somewhere else in this platform with evidence attached".
--          Of the fourteen, the platform holds a recorded fact for THREE: one member one vote (0182's snapshot of every
--          closed resolution), adulteration flags + retests (dairy, 6b), and what the audit trail is (the catalogue).
--   • F-16 THE AUDIT ROW IS FALSE. W423's "Audit trail · hash-chained, immutable trail": `audit_log` has no hash column;
--          the hash chain on this platform is the money ledger's (`ledger_entries.prev_hash → entry_hash`). The trail is
--          append-only (0181 revoked UPDATE / DELETE / TRUNCATE from kv_app) — that half is true.
--   • F-16 THE CARBON SCHEMA MODELS WHAT THE CANON FORBIDS. 0015's `carbon_credits` (`status DEFAULT 'issued'`,
--          `sale_price_minor`, `sale_currency`, `distribution_txn_id`) and `carbon_projects.revenue_split` (60/25/15 with a
--          platform share) are a credit-issuance-and-sale model; the canon's footer says "we do not issue or sell
--          credits". Written and read by nothing. A read would print "0 parcels" — which is "no programme recorded", not
--          "no participation" (unknown ≠ zero).
--   • F-16 THE GRIEVANCE TABLE HAS NO WRITER. `labour_grievances` exists; `grep -rln labour_grievance apps packages` → 0.
--          A count over it is 0 by construction — the absence of a register, not the absence of grievances.
--   • F-18 "the tenant compliance role" / "tenant finance or compliance role" — no such role, no ESG verb.
--
-- WHAT THIS FILE DOES
--   183.1  THE METHOD REGISTRY (`esg_metric_methods`) — a PLATFORM catalogue (no tenant column, like `languages`): one row
--          per metric the canon draws, in its order and pillar. `method_status` is `published` for exactly the three
--          metrics with a declared method AND a fact this platform records; every other row is `not_published` with its
--          refusal (`no_method`, or `no_programme` for carbon). A published row MUST cite its method (`method_ref`,
--          `method_version`, `published_at`, declared `source_tables`, a `fact_kind` the API has a reader for, a
--          `freshness_rule`) — a CHECK, not app care. Method TEXT is platform vocabulary in `ui_messages`
--          (`esg.method.<code>.text`, en/hi/gu — seed core/0021). kv_app may SELECT and nothing else: a tenant never
--          edits a platform method (the 0175 rule, here by grant — 42501).
--   183.2  THE DISCLOSURE (`esg_disclosures`) — the tenant's OWN narrative per metric (the esg-form chain W2598–W2601 and
--          the esg-mutate chain W2602–W2604): words in the platform's active languages, **never a number** —
--          `esg_text_has_number()` refuses a decimal digit in ANY script the platform could be typed in (a CHECK, so a
--          self-reported figure cannot become a "fact" by any path). Born a draft; words change only while a draft;
--          draft → published, draft | published → withdrawn (with a declared reason); final is final; at most one
--          published disclosure per metric per tenant. RLS ENABLE + FORCE, tenant-bound read / insert / update policies,
--          no DELETE for anybody in the tenant realm, REVOKE before the narrow GRANT.
--   183.3  THE VERBS (F-18): `esg.read` (the dashboard, the method pages, the report checklist, the receipt — tenant_admin,
--          fpo_coordinator) and `esg.disclose` (write / publish / withdraw a disclosure, generate the unsigned export —
--          tenant_admin). Here AND in seed 0004. The auditor's set stays EXACTLY five reads (0181's invariant; extending
--          the auditor realm to ESG is named, not done here).
--   183.4  THE FLAG (Law 10): `esg`, OFF.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • THE CARBON TABLES ARE NOT TOUCHED. Not dropped, not altered, not re-granted (Law 5 — fix forward only, and the
--     choice between retiring 0015's sale model and declaring a participation-only one is the FOUNDER's: wave_9d_report.md
--     NAMED, NOT BUILT). Nothing in this wave reads them; the dashboard prints "no programme recorded" from THIS registry.
--   • No signing key, no document id, no verify URL, no watermark (F-11, founder-physical).
--   • No method for the eleven metrics without a fact — each row says what fact table it needs (`esg.metric.<code>.needs`).
--
-- RLS DECISION: `esg_metric_methods` has no tenant column (platform catalogue; SELECT-only for the tenant realm) and is
-- therefore outside v_tables_without_rls by construction; `esg_disclosures` carries tenant_id NOT NULL, RLS ENABLE + FORCE.
-- PARTITION NOTE: neither table is partitioned (fourteen platform rows; a handful of disclosures per cooperative).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 183.1  THE METHOD REGISTRY
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS esg_metric_methods (
  metric_code      varchar(40)  PRIMARY KEY,
  pillar           char(1)      NOT NULL CONSTRAINT ck_esgm_pillar CHECK (pillar IN ('E', 'S', 'G')),
  sort_order       smallint     NOT NULL,
  method_status    varchar(16)  NOT NULL CONSTRAINT ck_esgm_status CHECK (method_status IN ('published', 'not_published')),
  refusal_kind     varchar(16)  CONSTRAINT ck_esgm_refusal CHECK (refusal_kind IS NULL OR refusal_kind IN ('no_method', 'no_programme')),
  method_ref       varchar(40),
  method_version   smallint,
  published_at     timestamptz,
  fact_kind        varchar(30)  NOT NULL DEFAULT 'none',
  source_tables    text[]       NOT NULL DEFAULT '{}',
  freshness_rule   varchar(24)  NOT NULL DEFAULT 'none'
                   CONSTRAINT ck_esgm_freshness CHECK (freshness_rule IN ('latest_source_fact', 'catalogue_now', 'none')),
  stale_after_days smallint     CONSTRAINT ck_esgm_stale CHECK (stale_after_days IS NULL OR stale_after_days BETWEEN 1 AND 366),
  window_days      smallint     CONSTRAINT ck_esgm_window CHECK (window_days IS NULL OR window_days BETWEEN 1 AND 366),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  -- NO METHOD, NO METRIC — as a constraint. A published method cites itself completely; an unpublished one cites nothing
  -- and says which refusal it is.
  CONSTRAINT ck_esgm_published_cites CHECK (
    (method_status = 'published'
       AND method_ref IS NOT NULL AND method_version IS NOT NULL AND published_at IS NOT NULL
       AND cardinality(source_tables) > 0 AND fact_kind <> 'none' AND freshness_rule <> 'none' AND refusal_kind IS NULL)
    OR
    (method_status = 'not_published'
       AND method_ref IS NULL AND method_version IS NULL AND published_at IS NULL
       AND fact_kind = 'none' AND refusal_kind IS NOT NULL)
  ),
  CONSTRAINT uq_esgm_order UNIQUE (pillar, sort_order)
);
COMMENT ON TABLE esg_metric_methods IS
  'PC-56 TENANT-9d. The platform''s ESG method registry — one row per metric the canon draws (W423). Only a PUBLISHED method over a fact this platform records may print a figure; every other row prints "no method published" (or, for carbon, "no programme recorded"). Platform rows: the tenant realm reads, never writes.';

INSERT INTO esg_metric_methods
  (metric_code, pillar, sort_order, method_status, refusal_kind, method_ref, method_version, published_at, fact_kind, source_tables, freshness_rule, stale_after_days, window_days)
VALUES
  ('water_per_kg',          'E', 1, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('diesel_per_qtl',        'E', 2, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('solar_share_bmc',       'E', 3, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('carbon_participation',  'E', 4, 'not_published', 'no_programme', NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('women_participation',   'S', 1, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('wage_on_time',          'S', 2, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('delay_compensation',    'S', 3, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('adulteration',          'S', 4, 'published',     NULL, 'KV-ESG-S4', 1, '2026-10-02T00:00:00Z', 'adulteration',
     '{milk_collections,milk_quality_reviews}', 'latest_source_fact', 2, 30),
  ('worksite_facilities',   'S', 5, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('worksite_injury_rate',  'S', 6, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('one_member_one_vote',   'G', 1, 'published',     NULL, 'KV-ESG-G1', 1, '2026-10-02T00:00:00Z', 'omov',
     '{coop_resolutions,coop_votes}', 'latest_source_fact', NULL, NULL),
  ('to_farmer_hands',       'G', 2, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL),
  ('audit_trail',           'G', 3, 'published',     NULL, 'KV-ESG-G3', 1, '2026-10-02T00:00:00Z', 'audit_trail',
     '{audit_log,ledger_entries}', 'catalogue_now', NULL, NULL),
  ('grievance_channels',    'G', 4, 'not_published', 'no_method',    NULL, NULL, NULL, 'none', '{}', 'none', NULL, NULL)
ON CONFLICT (metric_code) DO NOTHING;

REVOKE ALL ON esg_metric_methods FROM kv_app, kv_relay;
GRANT SELECT ON esg_metric_methods TO kv_app, kv_relay, kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 183.2  THE DISCLOSURE
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('esg_disclosure_withdraw_reason', 'Why an ESG disclosure was withdrawn', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.t, NULL, v.code, v.name, '{}'::jsonb, v.ord
  FROM (VALUES
    ('esg_disclosure_withdraw_reason', 'superseded',     'Replaced by a newer disclosure',          1),
    ('esg_disclosure_withdraw_reason', 'inaccurate',     'Found to be inaccurate',                  2),
    ('esg_disclosure_withdraw_reason', 'drafting_error', 'Drafted in error',                        3),
    ('esg_disclosure_withdraw_reason', 'board_decision', 'Withdrawn by decision of the board',      4)
  ) AS v(t, code, name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.t AND x.tenant_id IS NULL AND x.code = v.code);

-- A DECIMAL DIGIT IN ANY SCRIPT. The TypeScript review uses \p{Nd} (every Unicode decimal digit); this is the net under it,
-- spelled out per block because a PostgreSQL bracket class cannot name a Unicode property: ASCII, Arabic-Indic, Extended
-- Arabic-Indic, NKo, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai,
-- Lao, Tibetan, Myanmar, Khmer, Mongolian, Fullwidth. A number a tenant types is a claim; the platform's figures come from
-- records, so a disclosure is words.
CREATE OR REPLACE FUNCTION esg_text_has_number(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) e
     WHERE e.value ~ '[0-9٠-٩۰-۹߀-߉०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯෦-෯๐-๙໐-໙༠-༩၀-၉០-៩᠐-᠙０-９]'
  );
$$;
GRANT EXECUTE ON FUNCTION esg_text_has_number(jsonb) TO kv_app, kv_relay, kv_readonly;

CREATE TABLE IF NOT EXISTS esg_disclosures (
  id               uuid         PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid         NOT NULL REFERENCES tenants(id),
  metric_code      varchar(40)  NOT NULL REFERENCES esg_metric_methods(metric_code),
  texts            jsonb        NOT NULL,
  status           varchar(12)  NOT NULL DEFAULT 'draft',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL REFERENCES users(id),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  updated_by       uuid         REFERENCES users(id),
  published_at     timestamptz,
  published_by     uuid         REFERENCES users(id),
  withdrawn_at     timestamptz,
  withdrawn_by     uuid         REFERENCES users(id),
  withdraw_reason  varchar(40),
  CONSTRAINT ck_esgd_status CHECK (status IN ('draft', 'published', 'withdrawn')),
  CONSTRAINT ck_esgd_texts_object CHECK (jsonb_typeof(texts) = 'object' AND texts <> '{}'::jsonb),
  CONSTRAINT ck_esgd_no_number CHECK (NOT esg_text_has_number(texts)),
  CONSTRAINT ck_esgd_published CHECK ((published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT ck_esgd_published_status CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT ck_esgd_withdrawn CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdraw_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esgd_one_published ON esg_disclosures (tenant_id, metric_code) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_esgd_tenant_metric ON esg_disclosures (tenant_id, metric_code, created_at DESC);
COMMENT ON TABLE esg_disclosures IS
  'PC-56 TENANT-9d. A cooperative''s own NARRATIVE about one ESG metric (W2598–W2604). Words only — a digit in any script is refused (ck_esgd_no_number): the platform never accepts a self-reported metric value as a fact.';

-- THE GUARD (every role, owner included): born a draft; words move only while a draft; draft → published, draft |
-- published → withdrawn; final is final; the tenant and the metric never move; every key of `texts` is an ACTIVE language.
CREATE OR REPLACE FUNCTION esg_disclosures_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  SELECT k INTO bad FROM jsonb_object_keys(CASE WHEN jsonb_typeof(NEW.texts) = 'object' THEN NEW.texts ELSE '{}'::jsonb END) k
   WHERE NOT EXISTS (SELECT 1 FROM languages l WHERE l.code = k AND l.is_active AND l.deleted_at IS NULL) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'esg_disclosures: % is not an active language of this platform', bad USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'esg_disclosures: a disclosure is born a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.metric_code <> OLD.metric_code OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'esg_disclosures: the tenant, the metric and the author never move' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'esg_disclosures: a withdrawn disclosure is final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'published' THEN
    IF NEW.status <> 'withdrawn' OR NEW.texts IS DISTINCT FROM OLD.texts
       OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'esg_disclosures: a published disclosure can only be withdrawn — its words are what was published' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- OLD.status = 'draft'
  IF NEW.status = 'draft' THEN
    IF NEW.published_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'esg_disclosures: a draft carries no publish or withdraw record' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'published' THEN
    IF NEW.texts IS DISTINCT FROM OLD.texts THEN
      RAISE EXCEPTION 'esg_disclosures: publish what was reviewed — the words cannot change in the same act' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_esg_disclosures_guard ON esg_disclosures;
CREATE TRIGGER trg_esg_disclosures_guard BEFORE INSERT OR UPDATE ON esg_disclosures
  FOR EACH ROW EXECUTE FUNCTION esg_disclosures_guard();

-- A withdraw reason is one the vocabulary declares (a CHECK may not read another table, so the trigger above would be the
-- place — kept separate so the refusal names its own rule).
CREATE OR REPLACE FUNCTION esg_disclosures_reason_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.withdraw_reason IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM lookup_values v WHERE v.type_code = 'esg_disclosure_withdraw_reason' AND v.tenant_id IS NULL AND v.code = NEW.withdraw_reason) THEN
    RAISE EXCEPTION 'esg_disclosures: % is not a declared withdraw reason', NEW.withdraw_reason USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_esg_disclosures_reason ON esg_disclosures;
CREATE TRIGGER trg_esg_disclosures_reason BEFORE INSERT OR UPDATE OF withdraw_reason ON esg_disclosures
  FOR EACH ROW EXECUTE FUNCTION esg_disclosures_reason_guard();

DROP TRIGGER IF EXISTS esg_disclosures_uat ON esg_disclosures;
CREATE TRIGGER esg_disclosures_uat BEFORE UPDATE ON esg_disclosures FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE esg_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE esg_disclosures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS esgd_read ON esg_disclosures;
DROP POLICY IF EXISTS esgd_insert ON esg_disclosures;
DROP POLICY IF EXISTS esgd_update ON esg_disclosures;
DROP POLICY IF EXISTS esgd_admin_realm ON esg_disclosures;
CREATE POLICY esgd_read ON esg_disclosures FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY esgd_insert ON esg_disclosures FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY esgd_update ON esg_disclosures FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY esgd_admin_realm ON esg_disclosures FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON esg_disclosures FROM kv_app, kv_relay;
GRANT SELECT ON esg_disclosures TO kv_app, kv_readonly;
GRANT INSERT (id, tenant_id, metric_code, texts, status, created_by, updated_by) ON esg_disclosures TO kv_app;
GRANT UPDATE (texts, status, updated_at, updated_by, published_at, published_by, withdrawn_at, withdrawn_by, withdraw_reason) ON esg_disclosures TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 183.3  THE VERBS
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('esg.read',     'Read the ESG dashboard, the method registry, the report checklist and its receipts (figures only where a published method meets a recorded fact)', NULL),
  ('esg.disclose', 'Write, publish and withdraw the cooperative''s own ESG disclosures (words, never figures); generate the unsigned ESG export', NULL)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (r.code IN ('tenant_admin', 'fpo_coordinator') AND p.code = 'esg.read')
    OR (r.code = 'tenant_admin' AND p.code = 'esg.disclose')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 183.4  THE FLAG
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'esg',
       'PC-56 TENANT-9d. The ESG dashboard (W423), the method registry, the report checklist + unsigned export (W424) and the cooperative''s disclosures (W2598–W2604). OFF until enabled per tenant. A figure prints only where a published method meets a recorded fact.',
       false, 100, '{}'
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'esg');
