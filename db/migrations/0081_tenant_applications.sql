-- ============================================================================
-- MIGRATION 0081 — TENANT APPLICATIONS (public "apply to become a tenant" intake, PC-55 A1)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): Development_Program/PC54_BACKLOG.md W54-7 ruling —
--   "the in-tenant leg (tenants/me/submit → review) ALREADY EXISTS; the PUBLIC new-FPO application needs a
--    `tenant_applications` migration → gated as `tenant-registration-public` (design: public POST → admin-api
--    review queue → tenant provision)."  PC55_COMPLETION_PROMPTS.md wave A1 is the build order.
--
-- RLS DECISION — DELIBERATELY **NOT** TENANT-SCOPED (the one honest exception, documented so no future sweep
-- "fixes" it by mistake): an APPLICANT HAS NO TENANT YET. This is a pre-tenant intake table, exactly like a
-- signup queue: rows exist precisely because the org is not yet a tenant. Therefore:
--   • the table carries NO tenant_id column → the idempotent tenant_isolation sweep (0066 pattern) skips it
--     BY CONSTRUCTION (that sweep joins on a tenant_id column), so no policy can ever leak it cross-tenant;
--   • confidentiality is enforced by GRANTS instead: kv_app may INSERT ONLY (the public POST) and may SELECT
--     nothing — a farmer-app token can never read other applicants' pitches/contacts (PII: contact phone/email);
--   • kv_admin (admin-api, RLS-bypass, every query audited) does the reviewing reads/writes;
--   • provisioned_tenant_id closes the loop to the real tenant once approved.
-- Rule Zero: no country/language is encoded — country_code is a real FK, regions is a free jsonb list, and the
-- pitch/org fields are unicode text so any script (Devanagari, Gujarati, Arabic, Bangla) submits cleanly.
--
-- STATUS MACHINE (server-enforced in the service; CHECK guards the vocabulary):
--   draft → submitted → under_review → approved | rejected      (withdrawn is applicant-side from draft/submitted)
-- ============================================================================

CREATE TABLE tenant_applications (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- who is applying (org identity; NO tenant_id — see RLS DECISION above)
  org_name              varchar(200) NOT NULL,
  org_type_id           uuid REFERENCES lookup_values(id),     -- lookup 'tenant_type' (fpo|cooperative|dairy_union|…), mirroring tenants.tenant_type_id (0002)
  org_type_other        varchar(120),                          -- honest free-text when the applicant's type isn't seeded yet
  country_code          char(2) NOT NULL DEFAULT 'IN' REFERENCES countries(code),
  region_ids            jsonb NOT NULL DEFAULT '[]',           -- [admin_region uuid, …] intended service areas (app-validated)
  -- contact (PII — masked in list reads, full only on the reviewer's detail read; never exposed to kv_app)
  contact_name          varchar(150) NOT NULL,
  contact_phone         varchar(20) NOT NULL,
  contact_email         varchar(255),
  -- the case
  member_count_estimate integer CHECK (member_count_estimate IS NULL OR member_count_estimate >= 0),
  pitch_text            text,                                  -- "why us / what we do" (unicode, any script)
  doc_media_ids         jsonb NOT NULL DEFAULT '[]',           -- registration certificate etc. via the media pipeline (ids only, never blobs)
  -- lifecycle
  status                varchar(16) NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('draft','submitted','under_review','approved','rejected','withdrawn')),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  -- reviewer trail (admin realm; who/when/why — the audit ledger carries the full record, these are the fast reads)
  reviewer_id           uuid REFERENCES users(id),
  review_started_at     timestamptz,
  decided_at            timestamptz,
  decision_reason       text,                                  -- REQUIRED on reject by the service (never a silent no)
  provisioned_tenant_id uuid REFERENCES tenants(id),           -- set when approve → tenant provisioned
  -- anti-abuse / idempotency
  submit_ip             inet,
  idempotency_key       varchar(120),
  version               integer NOT NULL DEFAULT 0
);
CALL add_std_columns('tenant_applications');

-- One open application per (phone, org) — a double-tap or a retry can never create twins.
CREATE UNIQUE INDEX uq_tenant_applications_open
  ON tenant_applications (contact_phone, lower(org_name))
  WHERE status IN ('draft','submitted','under_review');
-- Idempotency-Key replay guard for the public POST.
CREATE UNIQUE INDEX uq_tenant_applications_idem
  ON tenant_applications (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Reviewer queue read path (status + newest first).
CREATE INDEX idx_tenant_applications_queue ON tenant_applications (status, submitted_at DESC);
CREATE INDEX idx_tenant_applications_country ON tenant_applications (country_code, status);

-- GRANTS — the confidentiality boundary (see RLS DECISION):
--   kv_app: INSERT only. The public endpoint writes; no app token can read the queue.
GRANT INSERT ON tenant_applications TO kv_app;
--   (deliberately NO SELECT/UPDATE/DELETE to kv_app.)
