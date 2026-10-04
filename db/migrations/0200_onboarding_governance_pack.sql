-- ==================================================================================================================
-- 0200 · PC-56 TENANT-SW-d · ONBOARDING, HOME & GOVERNANCE PACK
--        canon W114 + W2693–W2695 (signup step 2 · organisation profile) · W2562–W2568 (dashboard "New listing")
--        · W2619–W2625 (/go "Book a setup call") · W199 + W2473–W2477 (AGM pack) · W2626–W2628 (register import)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (fix forward).
-- TRUST + MONEY-ADJACENT (the AGM pack prints money figures): Law 9 class care. No raw phone number is copied into any
-- table created here (setup calls keep the last four digits; import rows keep a masked phone; the CSV itself is a media
-- object, never a table row).
--
-- Founder decisions (2026-10-04), built as decided:
--   • PROFILE = SIGNUP STEP 2 WITH SAVE-AND-EXIT — `tenants.onboarding_step` / `profile_completed_at`; a server-side draft
--     (`tenant_onboarding_drafts`, 30 days, owner-only by trigger). "Entries kept in this browser and retried automatically"
--     is REFUSED BY NAME (server actions only — nothing is stored in a browser).
--   • SETUP CALL = A PLATFORM-STAFFED REQUEST OBJECT — `setup_call_requests` (one open request per tenant; the phone is the
--     requester's user record — only its last four digits are kept here); the admin realm (kv_admin) schedules / closes it;
--     `platform_ops_notices` is the admin realm's in-app queue (no platform alert channel exists — HOTFIX-1 / 13a named the gap).
--   • AGM PACK = IMMUTABLE PACK FROM FACTS ONLY — `agm_packs` + `agm_pack_sections`: every figure is a section row with its
--     METHOD; a figure without a method is a `refused` row that may carry NO figure (CHECK); an issued pack is immutable
--     (trigger) — a correction is an ADDENDUM chained to its issued parent; issuing needs a CHECKER (confirmed_by ≠ issued_by,
--     a tenant_admin — trigger).
--   • REGISTER IMPORT UNDER CHECKER + CONSENT EVIDENCE — `share_register_imports` (consent media REQUIRED, NOT NULL + trigger),
--     a second tenant_admin confirms (trigger refuses the proposer); `coop_share_registers` rows written by an import carry
--     `source = 'import'` + `import_batch_id` and are refused unless that import is confirmed (trigger).
--
-- SECTIONS
--   200.1  THE `tenants` WALL (F-7): onboarding columns · RLS ENABLE + FORCE (`id = current_tenant_id()`, admin realm named) ·
--          kv_app INSERT / UPDATE narrowed to named columns (status / risk_score / plan / approved_at / slug / type / country
--          are admin-realm only) · a kv_app INSERT is born `trial` (trigger) · kv_relay keeps SELECT only · SECURITY DEFINER
--          readers for the four context-free paths (slug, live id, public card, signup resume) — named, not a blanket bypass.
--   200.2  tenant_onboarding_drafts (+ trigger)
--   200.3  setup_call_requests (+ trigger) · platform_ops_notices
--   200.4  agm_packs · agm_pack_sections (+ triggers) · permission governance.agm.issue
--   200.5  coop_share_registers: folio · source · import_batch_id (+ trigger) · share_register_imports (+ trigger) ·
--          share_register_import_rows · permission governance.register.import
--   200.6  notification catalogue rows · RLS + grants · indexes
--
-- RLS DECISION: every new TENANT table is ENABLE + FORCE with the 0175 split (SELECT / INSERT WITH CHECK / UPDATE USING + WITH
-- CHECK on current_tenant_id(), DELETE only where a row may go, an admin-realm policy TO kv_admin), REVOKE ALL from kv_app /
-- kv_relay / kv_readonly, then the narrowest grants. No grant to kv_relay anywhere: the render / apply jobs read only
-- `tenants` as kv_relay and work per tenant in kv_app's unit of work; the setup-call handler works in a kv_app unit of work.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 200.1  THE `tenants` WALL
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step varchar(12);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_onboarding_step;
ALTER TABLE tenants ADD CONSTRAINT ck_tenants_onboarding_step CHECK (onboarding_step IS NULL OR onboarding_step IN ('profile', 'done'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_profile_done;
ALTER TABLE tenants ADD CONSTRAINT ck_tenants_profile_done CHECK ((onboarding_step = 'done') = (profile_completed_at IS NOT NULL) OR onboarding_step IS NULL);
COMMENT ON COLUMN tenants.onboarding_step IS
  'PC-56 TENANT-SW-d (W114): where a SELF-SERVE signup stands — profile (step 2 open) | done. NULL = not tracked (a tenant '
  'created before 0200, or provisioned by the admin realm) — never back-filled to "done", which would claim a profile nobody filled.';
COMMENT ON COLUMN tenants.profile_completed_at IS
  'PC-56 TENANT-SW-d: when the owner finished signup step 2 (the organisation profile). Set with onboarding_step = done (CHECK).';

-- RLS: the tenant row is visible to (and writable by) its own tenant context only. The admin realm is NAMED (kv_admin holds no
-- BYPASSRLS in dev). kv_relay is BYPASSRLS and keeps its SELECT for the per-tenant job sweeps ("SELECT id FROM tenants …").
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_self_read ON tenants;
DROP POLICY IF EXISTS tenants_self_insert ON tenants;
DROP POLICY IF EXISTS tenants_self_update ON tenants;
DROP POLICY IF EXISTS tenants_admin_realm ON tenants;
CREATE POLICY tenants_self_read ON tenants FOR SELECT USING (id = current_tenant_id());
-- signup sets app.tenant_id to the id it is about to insert (TenantSignupRepository.insertTenant) — nothing else inserts as kv_app
CREATE POLICY tenants_self_insert ON tenants FOR INSERT WITH CHECK (id = current_tenant_id());
CREATE POLICY tenants_self_update ON tenants FOR UPDATE USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
CREATE POLICY tenants_admin_realm ON tenants FOR ALL TO kv_admin USING (true) WITH CHECK (true);

-- Column-limited writes. A table-level REVOKE also revokes every column privilege (PostgreSQL GRANT docs), so the narrow
-- GRANTs below are the whole of what kv_app may write.
REVOKE INSERT, UPDATE, DELETE ON tenants FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON tenants FROM kv_relay;
GRANT SELECT ON tenants TO kv_app;
-- the signup INSERT (TenantSignupRepository.insertTenant) — status is limited to 'trial' by trg_tenants_app_insert below
GRANT INSERT (id, slug, legal_name, display_name, tenant_type_id, country_code, owner_name, owner_phone, status, onboarding_step)
  ON tenants TO kv_app;
-- the profile columns: profile PATCH (TenantRepository.updateProfile), the onboarding step, and the 13d brand sync
-- (TenantBrandingRepository → display_name / logo_url, still guarded by trg_tenants_brand_sync)
GRANT UPDATE (legal_name, display_name, region_id, gstin, pan, cin_or_reg_no, fssai_license, owner_name, owner_phone, owner_email,
              logo_url, onboarding_step, profile_completed_at, updated_at, updated_by)
  ON tenants TO kv_app;

CREATE OR REPLACE FUNCTION assert_tenants_app_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The request tier may only CREATE a trial organisation (the Law 11 line of 0131): going live, suspending or scoring is the
  -- admin realm's. Checked by role so the admin realm's own provisioning (kv_admin) and migrations / seeds are untouched.
  IF current_user = 'kv_app' AND (NEW.status::text <> 'trial' OR NEW.risk_score <> 0 OR NEW.approved_at IS NOT NULL OR NEW.onboarded_by IS NOT NULL) THEN
    RAISE EXCEPTION '[TENANT_INSERT_TRIAL_ONLY] the request tier creates a trial organisation only — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tenants_app_insert ON tenants;
CREATE TRIGGER trg_tenants_app_insert BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION assert_tenants_app_insert();

-- The four reads that legitimately have NO tenant context (or must see a row other than the context's). Each returns the
-- smallest answer its caller needs; each is SECURITY DEFINER with a pinned search_path; EXECUTE is granted to kv_app only.
--   resolve_tenant_slug      — anonymous storefront X-Tenant-Slug → id of a LIVE tenant (TenantSlugResolver.resolve)
--   resolve_live_tenant      — anonymous X-Tenant-Id → the same id iff LIVE (TenantSlugResolver.resolveId)
--   public_tenant_card       — the public display name + logo of a LIVE tenant (TenantSlugResolver.getBranding)
--   kv_signup_administered_tenant — W113's resume: the organisation a VERIFIED phone's user administers (signup, no context yet)
CREATE OR REPLACE FUNCTION resolve_tenant_slug(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM tenants t WHERE t.slug = p_slug AND t.status IN ('trial', 'active', 'grace') AND t.deleted_at IS NULL LIMIT 1
$$;
CREATE OR REPLACE FUNCTION resolve_live_tenant(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM tenants t WHERE t.id = p_id AND t.status IN ('trial', 'active', 'grace') AND t.deleted_at IS NULL LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public_tenant_card(p_id uuid) RETURNS TABLE (display_name varchar, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.display_name, t.logo_url::text FROM tenants t WHERE t.id = p_id AND t.status IN ('trial', 'active', 'grace') AND t.deleted_at IS NULL LIMIT 1
$$;
CREATE OR REPLACE FUNCTION kv_signup_administered_tenant(p_user uuid)
RETURNS TABLE (id uuid, slug varchar, display_name varchar, status text, onboarding_step varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.display_name, t.status::text, t.onboarding_step
    FROM user_tenant_roles utr
    JOIN roles r ON r.id = utr.role_id
    JOIN tenants t ON t.id = utr.tenant_id
   WHERE utr.user_id = p_user AND r.code = 'tenant_admin'
     AND utr.is_active = true AND utr.deleted_at IS NULL
     AND t.deleted_at IS NULL AND t.status NOT IN ('archived', 'terminated')
   ORDER BY t.created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_tenant_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_live_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_tenant_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION kv_signup_administered_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_slug(text), resolve_live_tenant(uuid), public_tenant_card(uuid), kv_signup_administered_tenant(uuid) TO kv_app;
COMMENT ON FUNCTION kv_signup_administered_tenant(uuid) IS
  'PC-56 TENANT-SW-d: W113 "a second attempt from the same number resumes the first" — called ONLY by the signup service after the '
  'phone''s OTP verified, before any tenant context exists (the `tenants` wall hides every row without one). Returns one row.';

-- ------------------------------------------------------------------------------------------------------------------
-- 200.2  tenant_onboarding_drafts — "Save & exit (resume later by OTP)", owner-only, 30 days
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_onboarding_drafts (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  owner_user_id  uuid NOT NULL REFERENCES users(id),
  step           varchar(12) NOT NULL DEFAULT 'profile' CHECK (step IN ('profile')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at       timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tod_tenant UNIQUE (tenant_id),
  -- only the profile step's own fields, as text; nothing else may ride in a draft (no phone, no status)
  CONSTRAINT ck_tod_payload CHECK (
    jsonb_typeof(payload) = 'object'
    AND (payload - ARRAY['legalName', 'displayName', 'regionId', 'cinOrRegNo', 'pan', 'gstin', 'fssaiLicense']) = '{}'::jsonb
    AND octet_length(payload::text) <= 4096)
);
COMMENT ON TABLE tenant_onboarding_drafts IS
  'PC-56 TENANT-SW-d (W114 "Save & exit"): the owner''s half-filled organisation profile, ON THE SERVER (never a browser store — '
  '"entries kept in this browser and retried automatically" is refused by name). One per tenant; the owner is fixed at first save and '
  'only the owner reads or writes it (trigger + service); expires 30 days after the last save; deleted when the profile is completed.';

CREATE OR REPLACE FUNCTION assert_onboarding_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- an EXPIRED draft is anybody's to clear (30 days unattended must not lock the organisation's profile step for ever)
    IF me IS NOT NULL AND OLD.owner_user_id <> me AND OLD.expires_at > now() THEN
      RAISE EXCEPTION '[ONBOARDING_DRAFT_OWNER_ONLY] a setup draft belongs to the person who started it — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF me IS NULL OR NEW.owner_user_id <> me THEN
    RAISE EXCEPTION '[ONBOARDING_DRAFT_OWNER_ONLY] a setup draft is saved in its owner''s own session — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.owner_user_id <> OLD.owner_user_id OR NEW.tenant_id <> OLD.tenant_id) THEN
    RAISE EXCEPTION '[ONBOARDING_DRAFT_OWNER_ONLY] a draft never changes hands — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  NEW.saved_at := now();
  NEW.expires_at := now() + interval '30 days';
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_onboarding_draft ON tenant_onboarding_drafts;
CREATE TRIGGER trg_onboarding_draft BEFORE INSERT OR UPDATE OR DELETE ON tenant_onboarding_drafts FOR EACH ROW EXECUTE FUNCTION assert_onboarding_draft();

-- ------------------------------------------------------------------------------------------------------------------
-- 200.3  setup_call_requests · platform_ops_notices
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setup_call_requests (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  requested_by          uuid NOT NULL REFERENCES users(id),
  preferred_slot_start  timestamptz NOT NULL,
  preferred_slot_end    timestamptz NOT NULL,
  language_code         varchar(2) NOT NULL CHECK (language_code IN ('en', 'hi', 'gu')),
  -- the last four digits only — the number itself is the requester's user record, read by the admin realm when it calls
  phone_masked          varchar(12) NOT NULL CHECK (phone_masked ~ '^••••[0-9]{4}$'),
  notes                 varchar(500),
  status                varchar(10) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'scheduled', 'done', 'cancelled')),
  scheduled_at          timestamptz,
  handled_by            uuid,          -- an admin-realm user id (platform staff live outside `users`' tenant roles) — no FK by design
  outcome_note          varchar(500),
  done_at               timestamptz,
  cancelled_by          uuid,
  cancel_reason         varchar(300),
  cancelled_at          timestamptz,
  ops_notified_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_scr_slot CHECK (preferred_slot_end > preferred_slot_start AND preferred_slot_end - preferred_slot_start <= interval '4 hours'),
  CONSTRAINT ck_scr_scheduled CHECK (status NOT IN ('scheduled', 'done') OR (scheduled_at IS NOT NULL AND handled_by IS NOT NULL)),
  CONSTRAINT ck_scr_done CHECK ((status = 'done') = (done_at IS NOT NULL) AND (status <> 'done' OR outcome_note IS NOT NULL)),
  CONSTRAINT ck_scr_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scr_one_open ON setup_call_requests (tenant_id) WHERE status IN ('requested', 'scheduled');
COMMENT ON TABLE setup_call_requests IS
  'PC-56 TENANT-SW-d (W2619–W2625, founder decision: a platform-staffed request object): "Book a setup call (free)". One OPEN '
  'request per tenant (uq_scr_one_open). The Krishalaya team (admin realm, kv_admin) schedules it and records the outcome; the '
  'tenant may cancel it with a reason. No calendar integration (the page says so). No raw phone here.';

CREATE OR REPLACE FUNCTION assert_setup_call_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); realm boolean := current_user IN ('kv_admin', 'postgres');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[SETUP_CALL_APPEND_ONLY] a setup-call request is history — cancel it, never delete it — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' OR NEW.scheduled_at IS NOT NULL OR NEW.handled_by IS NOT NULL OR NEW.done_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION '[SETUP_CALL_BORN_REQUESTED] a setup-call request is born requested — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT realm AND (me IS NULL OR NEW.requested_by <> me) THEN
      RAISE EXCEPTION '[SETUP_CALL_NOT_YOURS] a setup call is requested in the requester''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- what was asked is fixed
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.requested_by <> OLD.requested_by OR NEW.preferred_slot_start <> OLD.preferred_slot_start
     OR NEW.preferred_slot_end <> OLD.preferred_slot_end OR NEW.language_code <> OLD.language_code OR NEW.phone_masked <> OLD.phone_masked
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[SETUP_CALL_FINAL] what a setup-call request asks for is fixed — cancel and request again — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('done', 'cancelled') AND (NEW.status <> OLD.status OR NEW.outcome_note IS DISTINCT FROM OLD.outcome_note OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION '[SETUP_CALL_CLOSED] this setup-call request is closed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.status IN ('scheduled', 'done') AND NOT realm THEN
      RAISE EXCEPTION '[SETUP_CALL_ADMIN_REALM] only the Krishalaya team schedules or closes a setup call — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
    END IF;
    IF NOT ((OLD.status = 'requested' AND NEW.status IN ('scheduled', 'cancelled'))
         OR (OLD.status = 'scheduled' AND NEW.status IN ('done', 'cancelled'))) THEN
      RAISE EXCEPTION '[SETUP_CALL_BAD_MOVE] % → % is not a setup-call move — PC-56 TENANT-SW-d', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelled' AND NOT realm AND (me IS NULL OR NEW.cancelled_by IS DISTINCT FROM me) THEN
      RAISE EXCEPTION '[SETUP_CALL_NOT_YOURS] a cancellation names the person cancelling, in their own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT realm AND (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.handled_by IS DISTINCT FROM OLD.handled_by) THEN
    RAISE EXCEPTION '[SETUP_CALL_ADMIN_REALM] only the Krishalaya team schedules a setup call — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_setup_call_moves ON setup_call_requests;
CREATE TRIGGER trg_setup_call_moves BEFORE INSERT OR UPDATE OR DELETE ON setup_call_requests FOR EACH ROW EXECUTE FUNCTION assert_setup_call_moves();

CREATE TABLE IF NOT EXISTS platform_ops_notices (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  kind              varchar(40) NOT NULL CHECK (kind IN ('setup_call_requested')),
  ref_id            uuid NOT NULL,
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by   uuid,
  acknowledged_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pon_ref UNIQUE (kind, ref_id),
  -- no PII: the slot, the language, the last four digits — never a number, a name or free text
  CONSTRAINT ck_pon_summary CHECK (jsonb_typeof(summary) = 'object' AND (summary - ARRAY['slotStart', 'slotEnd', 'language', 'phoneMasked']) = '{}'::jsonb)
);
COMMENT ON TABLE platform_ops_notices IS
  'PC-56 TENANT-SW-d: the ADMIN REALM''s in-app queue (the platform has no alert channel to the ops team — named since HOTFIX-1 / '
  '13a). Written by the `tenancy.setup_call_requested` handler in a kv_app unit of work under the tenant''s context (idempotent on '
  '(kind, ref_id)); read and acknowledged by apps/admin-api (kv_admin). Summary is PII-free by CHECK.';

-- ------------------------------------------------------------------------------------------------------------------
-- 200.4  agm_packs · agm_pack_sections
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('governance.agm.issue', 'AGM pack: draft, request issue, confirm issue (a second tenant_admin), addendum, auditor annexure', NULL),
  ('governance.register.import', 'Share register: import a CSV of existing shareholders with consent evidence, for a second tenant_admin to confirm', NULL)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE p.code IN ('governance.agm.issue', 'governance.register.import') AND r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS agm_packs (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  fiscal_year_label  varchar(12) NOT NULL CHECK (fiscal_year_label ~ '^FY [0-9]{4}(-[0-9]{2})?$'),
  fy_start           date NOT NULL,
  fy_end             date NOT NULL,
  fy_start_month     smallint NOT NULL CHECK (fy_start_month BETWEEN 1 AND 12),
  fy_basis_source    varchar(20) NOT NULL CHECK (fy_basis_source IN ('tenant_setting', 'country_default')),
  zone               varchar(60) NOT NULL,
  second_language    varchar(2) NOT NULL CHECK (second_language IN ('hi', 'gu')),
  status             varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'issuing', 'issued', 'withdrawn')),
  drafted_by         uuid NOT NULL REFERENCES users(id),
  assembled_at       timestamptz NOT NULL DEFAULT now(),
  issued_by          uuid REFERENCES users(id),        -- the MAKER who asked for the pack to be issued
  issue_requested_at timestamptz,
  confirmed_by       uuid REFERENCES users(id),        -- the CHECKER (a different tenant_admin)
  confirmed_at       timestamptz,
  issued_at          timestamptz,
  document_id        varchar(90),
  pdf_sha256         char(64),
  content_sha256     char(64),   -- sha256 of the canonical sections (printed IN the PDF — a file cannot carry its own checksum)
  pdf_media_id       uuid REFERENCES media_assets(id),
  export_job_id      uuid,
  export_note        varchar(200),
  parent_pack_id     uuid REFERENCES agm_packs(id),
  addendum_no        integer NOT NULL DEFAULT 0 CHECK (addendum_no >= 0),
  reason             varchar(500),
  superseded_by      uuid REFERENCES agm_packs(id),
  auditor_media_id   uuid REFERENCES media_assets(id),
  render_attempts    integer NOT NULL DEFAULT 0,
  render_error       varchar(200),
  withdrawn_by       uuid REFERENCES users(id),
  withdrawn_at       timestamptz,
  withdraw_reason    varchar(300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_agm_fy CHECK (fy_end > fy_start),
  CONSTRAINT ck_agm_addendum CHECK ((parent_pack_id IS NULL) = (addendum_no = 0) AND (parent_pack_id IS NULL OR (reason IS NOT NULL AND length(btrim(reason)) >= 10))),
  CONSTRAINT ck_agm_issued CHECK (status <> 'issued' OR (document_id IS NOT NULL AND issued_at IS NOT NULL AND pdf_sha256 ~ '^[0-9a-f]{64}$'
                                                         AND content_sha256 ~ '^[0-9a-f]{64}$' AND pdf_media_id IS NOT NULL AND confirmed_by IS NOT NULL AND issued_by IS NOT NULL)),
  CONSTRAINT ck_agm_checker CHECK (confirmed_by IS NULL OR confirmed_by <> issued_by),
  CONSTRAINT ck_agm_withdrawn CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdraw_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agm_document_id ON agm_packs (document_id) WHERE document_id IS NOT NULL;
-- one live ROOT pack per tenant per FY; one live addendum per parent (the chain is linear)
CREATE UNIQUE INDEX IF NOT EXISTS uq_agm_root_fy ON agm_packs (tenant_id, fy_start) WHERE parent_pack_id IS NULL AND status <> 'withdrawn';
CREATE UNIQUE INDEX IF NOT EXISTS uq_agm_one_addendum ON agm_packs (parent_pack_id) WHERE parent_pack_id IS NOT NULL AND status <> 'withdrawn';
COMMENT ON TABLE agm_packs IS
  'PC-56 TENANT-SW-d (W199, founder decision: IMMUTABLE PACK FROM FACTS ONLY). draft → proposed (the maker asks to issue: issued_by) '
  '→ issuing (a DIFFERENT tenant_admin confirms: confirmed_by) → issued (the render job: PDF stored as media, sha256, document id, '
  'export job on the 6e-2 plane). An issued row is immutable (trigger) except `superseded_by`, set once when its addendum issues. '
  'A correction is a NEW pack with parent_pack_id → an issued parent, addendum_no = parent''s + 1, and a reason.';

CREATE OR REPLACE FUNCTION kv_agm_document_id(p_tenant uuid, p_fy_label text, p_addendum integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT 'AGM-' || upper(t.slug) || '-' || replace(p_fy_label, ' ', '') || '-' || (p_addendum + 1)::text FROM tenants t WHERE t.id = p_tenant
$$;
COMMENT ON FUNCTION kv_agm_document_id(uuid, text, integer) IS
  'PC-56 TENANT-SW-d: the human document id AGM-<SLUG>-<FY>-<n> (n = 1 for the pack, 2 for its first addendum …). The slug is '
  'globally unique, so the id is too. Invoker rights: under kv_app it reads the tenant row through the `tenants` wall (own row only).';

CREATE OR REPLACE FUNCTION assert_agm_pack_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); par agm_packs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[AGM_PACK_APPEND_ONLY] an AGM pack is a record — withdraw a draft, never delete it — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.issued_by IS NOT NULL OR NEW.confirmed_by IS NOT NULL OR NEW.issued_at IS NOT NULL OR NEW.document_id IS NOT NULL
       OR NEW.pdf_sha256 IS NOT NULL OR NEW.content_sha256 IS NOT NULL OR NEW.pdf_media_id IS NOT NULL OR NEW.export_job_id IS NOT NULL OR NEW.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION '[AGM_PACK_BORN_DRAFT] an AGM pack is born a draft — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.drafted_by <> me THEN
      RAISE EXCEPTION '[AGM_PACK_NOT_YOURS] a pack is drafted in the drafter''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.parent_pack_id IS NOT NULL THEN
      SELECT * INTO par FROM agm_packs WHERE id = NEW.parent_pack_id FOR UPDATE;
      IF NOT FOUND OR par.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION '[AGM_PARENT_NOT_FOUND] the pack to correct was not found — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF par.status <> 'issued' THEN
        RAISE EXCEPTION '[AGM_PARENT_NOT_ISSUED] an addendum corrects an ISSUED pack — a draft is simply edited — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF par.superseded_by IS NOT NULL THEN
        RAISE EXCEPTION '[AGM_PARENT_SUPERSEDED] this pack already has an issued addendum — correct the latest one — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.addendum_no <> par.addendum_no + 1 OR NEW.fy_start <> par.fy_start OR NEW.fy_end <> par.fy_end OR NEW.fiscal_year_label <> par.fiscal_year_label THEN
        RAISE EXCEPTION '[AGM_ADDENDUM_SEQUENCE] an addendum is the next number of the same financial year — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  IF OLD.status = 'issued' THEN
    -- IMMUTABLE ONCE ISSUED: the one column that may move is superseded_by, NULL → the id of this pack's own issued addendum
    IF ROW(NEW.id, NEW.tenant_id, NEW.fiscal_year_label, NEW.fy_start, NEW.fy_end, NEW.fy_start_month, NEW.fy_basis_source, NEW.zone, NEW.second_language,
           NEW.status, NEW.drafted_by, NEW.assembled_at, NEW.issued_by, NEW.issue_requested_at, NEW.confirmed_by, NEW.confirmed_at, NEW.issued_at,
           NEW.document_id, NEW.pdf_sha256, NEW.content_sha256, NEW.pdf_media_id, NEW.export_job_id, NEW.export_note, NEW.parent_pack_id, NEW.addendum_no, NEW.reason,
           NEW.auditor_media_id, NEW.render_attempts, NEW.render_error, NEW.withdrawn_by, NEW.withdrawn_at, NEW.withdraw_reason, NEW.created_at, NEW.updated_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.fiscal_year_label, OLD.fy_start, OLD.fy_end, OLD.fy_start_month, OLD.fy_basis_source, OLD.zone, OLD.second_language,
           OLD.status, OLD.drafted_by, OLD.assembled_at, OLD.issued_by, OLD.issue_requested_at, OLD.confirmed_by, OLD.confirmed_at, OLD.issued_at,
           OLD.document_id, OLD.pdf_sha256, OLD.content_sha256, OLD.pdf_media_id, OLD.export_job_id, OLD.export_note, OLD.parent_pack_id, OLD.addendum_no, OLD.reason,
           OLD.auditor_media_id, OLD.render_attempts, OLD.render_error, OLD.withdrawn_by, OLD.withdrawn_at, OLD.withdraw_reason, OLD.created_at, OLD.updated_at) THEN
      RAISE EXCEPTION '[AGM_PACK_IMMUTABLE] an issued AGM pack never changes — a correction is an addendum — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
      IF OLD.superseded_by IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM agm_packs a WHERE a.id = NEW.superseded_by AND a.parent_pack_id = OLD.id AND a.tenant_id = OLD.tenant_id AND a.status = 'issuing') THEN
        RAISE EXCEPTION '[AGM_PACK_IMMUTABLE] an issued pack is superseded once, by its own addendum as that addendum issues — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION '[AGM_PACK_WITHDRAWN] this draft was withdrawn — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  -- what the pack IS never changes after it is born
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.fiscal_year_label <> OLD.fiscal_year_label OR NEW.fy_start <> OLD.fy_start
     OR NEW.fy_end <> OLD.fy_end OR NEW.parent_pack_id IS DISTINCT FROM OLD.parent_pack_id OR NEW.addendum_no <> OLD.addendum_no
     OR NEW.drafted_by <> OLD.drafted_by OR NEW.created_at <> OLD.created_at OR NEW.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION '[AGM_PACK_FINAL] what an AGM pack is (tenant, FY, parent, number) is fixed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'draft' AND NEW.status IN ('proposed', 'withdrawn'))
         OR (OLD.status = 'proposed' AND NEW.status IN ('issuing', 'draft', 'withdrawn'))
         OR (OLD.status = 'issuing' AND NEW.status = 'issued')) THEN
      RAISE EXCEPTION '[AGM_PACK_BAD_MOVE] % → % is not an AGM pack move — PC-56 TENANT-SW-d', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'proposed' THEN
      IF NEW.issued_by IS NULL OR (me IS NOT NULL AND NEW.issued_by <> me) THEN
        RAISE EXCEPTION '[AGM_PACK_NOT_YOURS] the request to issue names its maker, in the maker''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.issued_by) THEN
        RAISE EXCEPTION '[AGM_ISSUER_NOT_ADMIN] only a tenant administrator asks for an AGM pack to be issued — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status = 'issuing' THEN
      IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = NEW.issued_by THEN
        RAISE EXCEPTION '[AGM_CHECKER_IS_MAKER] the person who asked for the pack to be issued cannot confirm it — a second tenant administrator must — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
        RAISE EXCEPTION '[AGM_PACK_NOT_YOURS] a confirmation is given in the checker''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.confirmed_by) THEN
        RAISE EXCEPTION '[AGM_CHECKER_NOT_ADMIN] only a tenant administrator confirms an AGM pack — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status = 'draft' AND (NEW.issued_by IS NOT NULL OR NEW.confirmed_by IS NOT NULL) THEN
      RAISE EXCEPTION '[AGM_PACK_BAD_MOVE] a pack sent back to draft carries no maker or checker — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'issued' THEN
      IF NEW.document_id IS DISTINCT FROM kv_agm_document_id(NEW.tenant_id, NEW.fiscal_year_label, NEW.addendum_no) THEN
        RAISE EXCEPTION '[AGM_DOCUMENT_ID] the document id is AGM-<slug>-<FY>-<n>, never free text — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.parent_pack_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agm_packs p WHERE p.id = NEW.parent_pack_id AND p.superseded_by = NEW.id) THEN
        RAISE EXCEPTION '[AGM_PARENT_NOT_SUPERSEDED] an addendum issues in the same act that marks its parent superseded — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status IN ('proposed', 'issuing') AND (NEW.issued_by IS DISTINCT FROM OLD.issued_by OR NEW.auditor_media_id IS DISTINCT FROM OLD.auditor_media_id
        OR NEW.assembled_at <> OLD.assembled_at OR (OLD.status = 'issuing' AND NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by)) THEN
    RAISE EXCEPTION '[AGM_PACK_FINAL] a pack waiting for its checker (or its render) is not edited — send it back to draft — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.auditor_media_id IS NOT NULL AND NEW.auditor_media_id IS DISTINCT FROM OLD.auditor_media_id
     AND NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.id = NEW.auditor_media_id AND m.tenant_id = NEW.tenant_id AND m.deleted_at IS NULL) THEN
    RAISE EXCEPTION '[AGM_ANNEXURE_NOT_FOUND] the auditor annexure must be a file this cooperative uploaded — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agm_pack_moves ON agm_packs;
CREATE TRIGGER trg_agm_pack_moves BEFORE INSERT OR UPDATE OR DELETE ON agm_packs FOR EACH ROW EXECUTE FUNCTION assert_agm_pack_moves();

CREATE TABLE IF NOT EXISTS agm_pack_sections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  pack_id       uuid NOT NULL REFERENCES agm_packs(id),
  section_code  varchar(30) NOT NULL CHECK (section_code IN ('income_expenditure', 'member_statements', 'share_register', 'resolutions', 'auditor_annexure', 'bylaws')),
  item_code     varchar(40) NOT NULL CHECK (item_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  status        varchar(10) NOT NULL CHECK (status IN ('included', 'refused')),
  method        text NOT NULL CHECK (length(btrim(method)) >= 10),
  refusal_code  varchar(40),
  figures       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_refs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_agm_section_item UNIQUE (pack_id, section_code, item_code),
  -- THE HONESTY WALL (F-24): a refused row names its refusal and carries NO figure; an included row carries a figure set
  CONSTRAINT ck_agm_section_refused CHECK (
    (status = 'refused' AND refusal_code ~ '^[A-Z][A-Z0-9_]{2,39}$' AND figures = '{}'::jsonb)
    OR (status = 'included' AND refusal_code IS NULL AND jsonb_typeof(figures) = 'object' AND figures <> '{}'::jsonb)),
  CONSTRAINT ck_agm_section_sources CHECK (jsonb_typeof(source_refs) = 'array')
);
COMMENT ON TABLE agm_pack_sections IS
  'PC-56 TENANT-SW-d (F-24): one row per figure of an AGM pack — the figure set, the METHOD that produced it from recorded facts, and '
  'its sources; or a REFUSED row that names why no figure exists (e.g. surplus / operating costs: no cost ledger) and may carry no '
  'figure (CHECK). Written only while the pack is a draft (trigger); frozen from the moment its maker asks to issue it.';

CREATE OR REPLACE FUNCTION assert_agm_section_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; pid uuid := COALESCE(NEW.pack_id, OLD.pack_id);
BEGIN
  SELECT status INTO st FROM agm_packs WHERE id = pid;
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION '[AGM_PACK_IMMUTABLE] the sections of a pack are frozen once its issue is requested — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '[AGM_SECTION_REASSEMBLE] a section is re-assembled (replaced), never edited — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.tenant_id <> (SELECT tenant_id FROM agm_packs WHERE id = NEW.pack_id) THEN
    RAISE EXCEPTION '[AGM_PARENT_NOT_FOUND] a section belongs to a pack of the same tenant — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_agm_section_moves ON agm_pack_sections;
CREATE TRIGGER trg_agm_section_moves BEFORE INSERT OR UPDATE OR DELETE ON agm_pack_sections FOR EACH ROW EXECUTE FUNCTION assert_agm_section_moves();

-- the public verify read (no auth, no tenant context): issued_at, FY, sha256, the addendum chain — NO figures, no names of people
CREATE OR REPLACE FUNCTION public_agm_pack_verify(p_document_id text)
RETURNS TABLE (document_id varchar, organisation varchar, fiscal_year_label varchar, issued_at timestamptz, pdf_sha256 char(64),
               content_sha256 char(64), addendum_no integer, parent_document_id varchar, superseded_by_document_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.document_id, t.display_name, a.fiscal_year_label, a.issued_at, a.pdf_sha256, a.content_sha256, a.addendum_no,
         p.document_id, s.document_id
    FROM agm_packs a
    JOIN tenants t ON t.id = a.tenant_id AND t.deleted_at IS NULL
    LEFT JOIN agm_packs p ON p.id = a.parent_pack_id
    LEFT JOIN agm_packs s ON s.id = a.superseded_by AND s.status = 'issued'
   WHERE a.document_id = p_document_id AND a.status = 'issued'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public_agm_pack_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_agm_pack_verify(text) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 200.5  THE REGISTER IMPORT
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE coop_share_registers ADD COLUMN IF NOT EXISTS folio varchar(40);
ALTER TABLE coop_share_registers ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'manual';
ALTER TABLE coop_share_registers ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE coop_share_registers DROP CONSTRAINT IF EXISTS ck_csr_source;
ALTER TABLE coop_share_registers ADD CONSTRAINT ck_csr_source CHECK (source IN ('manual', 'import') AND ((source = 'import') = (import_batch_id IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_csr_folio ON coop_share_registers (tenant_id, folio) WHERE folio IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN coop_share_registers.source IS
  'PC-56 TENANT-SW-d: manual (written by a person, or pre-0200) | import (written by a CONFIRMED share_register_imports batch — '
  'import_batch_id names it; trg_csr_import refuses an import row whose batch is not confirmed).';

CREATE TABLE IF NOT EXISTS share_register_imports (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  file_media_id     uuid NOT NULL REFERENCES media_assets(id),
  file_sha256       char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  consent_media_id  uuid NOT NULL REFERENCES media_assets(id),
  consent_kind      varchar(20) NOT NULL CHECK (consent_kind IN ('board_resolution', 'attestation')),
  status            varchar(10) NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'validated', 'proposed', 'confirmed', 'applied', 'rejected', 'failed')),
  row_count         integer NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 5000),
  valid_count       integer NOT NULL DEFAULT 0,
  error_count       integer NOT NULL DEFAULT 0,
  duplicate_count   integer NOT NULL DEFAULT 0,
  applied_count     integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  failure_code      varchar(40),
  proposed_by       uuid REFERENCES users(id),
  proposed_at       timestamptz,
  propose_reason    varchar(500),
  confirmed_by      uuid REFERENCES users(id),
  confirmed_at      timestamptz,
  rejected_by       uuid REFERENCES users(id),
  rejected_at       timestamptz,
  reject_reason     varchar(500),
  applied_at        timestamptz,
  batch_id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sri_batch UNIQUE (batch_id),
  CONSTRAINT ck_sri_checker CHECK (confirmed_by IS NULL OR confirmed_by <> proposed_by),
  CONSTRAINT ck_sri_proposed CHECK (status NOT IN ('proposed', 'confirmed', 'applied') OR (proposed_by IS NOT NULL AND propose_reason IS NOT NULL)),
  CONSTRAINT ck_sri_confirmed CHECK (status NOT IN ('confirmed', 'applied') OR confirmed_by IS NOT NULL),
  CONSTRAINT ck_sri_rejected CHECK ((status = 'rejected') = (rejected_by IS NOT NULL AND reject_reason IS NOT NULL))
);
COMMENT ON TABLE share_register_imports IS
  'PC-56 TENANT-SW-d (W2626–W2628, founder decision: under a checker + consent evidence). A CSV of existing shareholders '
  '(≤ 5,000 rows: phone, folio, shares, paid_up) with a REQUIRED consent document (board resolution or attestation): staged → '
  'validated (every row checked; errors named by line) → proposed (maker, reason) → confirmed (a DIFFERENT tenant_admin — trigger) '
  '→ applied (the apply job writes coop_share_registers rows source=import, idempotently) | rejected | failed. The proposal '
  'carrier is this row itself (13b shape: proposed_by / confirmed_by + trigger), not a separate table.';

CREATE OR REPLACE FUNCTION assert_register_import_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[IMPORT_APPEND_ONLY] a register import is history — reject it, never delete it — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'staged' OR NEW.proposed_by IS NOT NULL OR NEW.confirmed_by IS NOT NULL OR NEW.applied_at IS NOT NULL THEN
      RAISE EXCEPTION '[IMPORT_BORN_STAGED] a register import is born staged — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.uploaded_by <> me THEN
      RAISE EXCEPTION '[IMPORT_NOT_YOURS] an import is uploaded in the uploader''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.id = NEW.consent_media_id AND m.tenant_id = NEW.tenant_id AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[IMPORT_CONSENT_REQUIRED] a register import needs the consent document (board resolution or attestation) this cooperative uploaded — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.uploaded_by <> OLD.uploaded_by OR NEW.file_media_id <> OLD.file_media_id OR NEW.file_sha256 <> OLD.file_sha256
     OR NEW.consent_media_id <> OLD.consent_media_id OR NEW.consent_kind <> OLD.consent_kind OR NEW.batch_id <> OLD.batch_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[IMPORT_FINAL] what was uploaded (file, consent, batch) is fixed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('applied', 'rejected', 'failed') THEN
    RAISE EXCEPTION '[IMPORT_CLOSED] this import is closed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'staged' AND NEW.status IN ('validated', 'failed'))
         OR (OLD.status = 'validated' AND NEW.status IN ('proposed', 'rejected'))
         OR (OLD.status = 'proposed' AND NEW.status IN ('confirmed', 'rejected'))
         OR (OLD.status = 'confirmed' AND NEW.status IN ('applied', 'failed'))) THEN
      RAISE EXCEPTION '[IMPORT_BAD_MOVE] % → % is not a register-import move — PC-56 TENANT-SW-d', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'proposed' THEN
      IF NEW.valid_count = 0 THEN
        RAISE EXCEPTION '[IMPORT_NOTHING_VALID] no valid row to propose — fix the file and upload again — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.proposed_by IS NULL OR (me IS NOT NULL AND NEW.proposed_by <> me) THEN
        RAISE EXCEPTION '[IMPORT_NOT_YOURS] a proposal names its maker, in the maker''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
        RAISE EXCEPTION '[IMPORT_NOT_ADMIN] only a tenant administrator proposes a register import — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status = 'confirmed' THEN
      IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = OLD.proposed_by THEN
        RAISE EXCEPTION '[IMPORT_CHECKER_IS_MAKER] the person who proposed this import cannot confirm it — a second tenant administrator must — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
        RAISE EXCEPTION '[IMPORT_NOT_YOURS] a confirmation is given in the checker''s own session — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.confirmed_by) THEN
        RAISE EXCEPTION '[IMPORT_NOT_ADMIN] only a tenant administrator confirms a register import — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status = 'rejected' AND me IS NOT NULL AND NEW.rejected_by <> me THEN
      RAISE EXCEPTION '[IMPORT_NOT_YOURS] a rejection names the person rejecting — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION '[IMPORT_FINAL] the maker and checker are recorded by the move itself — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_register_import_moves ON share_register_imports;
CREATE TRIGGER trg_register_import_moves BEFORE INSERT OR UPDATE OR DELETE ON share_register_imports FOR EACH ROW EXECUTE FUNCTION assert_register_import_moves();

CREATE TABLE IF NOT EXISTS share_register_import_rows (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  import_id       uuid NOT NULL REFERENCES share_register_imports(id),
  line_no         integer NOT NULL CHECK (line_no >= 2),     -- the file's own line (1 = header)
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  member_user_id  uuid REFERENCES users(id),
  folio           varchar(40),
  shares          integer CHECK (shares IS NULL OR shares > 0),
  paid_up_minor   bigint CHECK (paid_up_minor IS NULL OR paid_up_minor >= 0),
  status          varchar(20) NOT NULL CHECK (status IN ('valid', 'error', 'applied', 'skipped_duplicate')),
  error_code      varchar(40),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_srir_line UNIQUE (import_id, line_no),
  -- no raw phone: the row keeps the masked form the preview shows (••••1234) and the cells that are not personal
  CONSTRAINT ck_srir_raw CHECK (jsonb_typeof(raw) = 'object' AND (raw - ARRAY['phoneMasked', 'folio', 'shares', 'paidUp']) = '{}'::jsonb
                                AND (NOT raw ? 'phoneMasked' OR raw->>'phoneMasked' ~ '^(••••[0-9]{0,4}|)$')),
  CONSTRAINT ck_srir_error CHECK ((status = 'error') = (error_code IS NOT NULL) OR status = 'skipped_duplicate'),
  CONSTRAINT ck_srir_valid CHECK (status NOT IN ('valid', 'applied') OR (member_user_id IS NOT NULL AND shares IS NOT NULL AND paid_up_minor IS NOT NULL))
);
COMMENT ON TABLE share_register_import_rows IS
  'PC-56 TENANT-SW-d: one row per data line of an import, its verdict (valid | error with a code | applied | skipped_duplicate) and '
  'the member it matched by phone. The phone is never stored — only its masked form (CHECK).';

CREATE OR REPLACE FUNCTION assert_register_import_row_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[IMPORT_APPEND_ONLY] an import row is history — PC-56 TENANT-SW-d' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO st FROM share_register_imports WHERE id = NEW.import_id;
  IF TG_OP = 'INSERT' THEN
    IF st IS DISTINCT FROM 'staged' OR NEW.status NOT IN ('valid', 'error', 'skipped_duplicate') THEN
      RAISE EXCEPTION '[IMPORT_FINAL] rows are written while the import is staged — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.import_id <> OLD.import_id OR NEW.line_no <> OLD.line_no OR NEW.raw <> OLD.raw OR NEW.member_user_id IS DISTINCT FROM OLD.member_user_id
     OR NEW.folio IS DISTINCT FROM OLD.folio OR NEW.shares IS DISTINCT FROM OLD.shares OR NEW.paid_up_minor IS DISTINCT FROM OLD.paid_up_minor THEN
    RAISE EXCEPTION '[IMPORT_FINAL] what a line said is fixed — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (st = 'confirmed' AND OLD.status = 'valid' AND NEW.status IN ('applied', 'skipped_duplicate')) THEN
    RAISE EXCEPTION '[IMPORT_FINAL] a line moves only when its confirmed import is applied — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_register_import_row_moves ON share_register_import_rows;
CREATE TRIGGER trg_register_import_row_moves BEFORE INSERT OR UPDATE OR DELETE ON share_register_import_rows FOR EACH ROW EXECUTE FUNCTION assert_register_import_row_moves();

CREATE OR REPLACE FUNCTION assert_csr_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.source = 'import' AND (NEW.source <> 'import' OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id) THEN
    RAISE EXCEPTION '[IMPORT_PROVENANCE_FINAL] a register row written by an import keeps its batch — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source = 'import' AND (TG_OP = 'INSERT' OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id OR OLD.source <> 'import') THEN
    IF NOT EXISTS (SELECT 1 FROM share_register_imports i WHERE i.batch_id = NEW.import_batch_id AND i.tenant_id = NEW.tenant_id AND i.status = 'confirmed') THEN
      RAISE EXCEPTION '[IMPORT_NOT_CONFIRMED] a register row from an import is written only by a confirmed import — PC-56 TENANT-SW-d' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_csr_import ON coop_share_registers;
CREATE TRIGGER trg_csr_import BEFORE INSERT OR UPDATE OF source, import_batch_id ON coop_share_registers FOR EACH ROW EXECUTE FUNCTION assert_csr_import();

-- ------------------------------------------------------------------------------------------------------------------
-- 200.6  CATALOGUE · RLS + GRANTS · INDEXES
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('tenant.setup_call_requested', 'Your setup call request was received', 'informational', '["inapp","push"]', true, false)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_onboarding_drafts', 'setup_call_requests', 'platform_ops_notices', 'agm_packs', 'agm_pack_sections',
                           'share_register_imports', 'share_register_import_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
  END LOOP;
END $$;
-- the draft is the only row a tenant may delete (on completion; the owner-only trigger guards it)
CREATE POLICY tenant_onboarding_drafts_delete_own ON tenant_onboarding_drafts FOR DELETE USING (tenant_id = current_tenant_id());
GRANT DELETE ON tenant_onboarding_drafts TO kv_app;
GRANT UPDATE (step, payload, saved_at, expires_at, updated_at) ON tenant_onboarding_drafts TO kv_app;
GRANT UPDATE (status, cancelled_by, cancel_reason, cancelled_at, ops_notified_at, updated_at) ON setup_call_requests TO kv_app;
GRANT UPDATE (status, issued_by, issue_requested_at, confirmed_by, confirmed_at, issued_at, document_id, pdf_sha256, content_sha256, pdf_media_id, export_job_id, export_note,
              superseded_by, auditor_media_id, assembled_at, render_attempts, render_error, withdrawn_by, withdrawn_at, withdraw_reason, updated_at) ON agm_packs TO kv_app;
GRANT DELETE ON agm_pack_sections TO kv_app;    -- re-assembly of a DRAFT (the section trigger refuses anything else)
CREATE POLICY agm_pack_sections_delete_own ON agm_pack_sections FOR DELETE USING (tenant_id = current_tenant_id());
GRANT UPDATE (status, row_count, valid_count, error_count, duplicate_count, applied_count, skipped_count, failure_code, proposed_by, proposed_at, propose_reason,
              confirmed_by, confirmed_at, rejected_by, rejected_at, reject_reason, applied_at, updated_at) ON share_register_imports TO kv_app;
GRANT UPDATE (status, updated_at) ON share_register_import_rows TO kv_app;
GRANT SELECT ON agm_packs, agm_pack_sections, setup_call_requests TO kv_readonly;
-- import rows / drafts / notices: no kv_readonly (member matches, a half-typed PAN, ops summaries)
-- the ADMIN REALM (apps/admin-api `setup-calls-ops`, kv_admin): works the setup-call queue and acknowledges its notices; reads the
-- tenant-side objects it may be asked about (no write on packs or imports — those are the cooperative's two-person acts).
GRANT SELECT, UPDATE ON setup_call_requests, platform_ops_notices TO kv_admin;
GRANT SELECT ON agm_packs, agm_pack_sections, share_register_imports, tenant_onboarding_drafts TO kv_admin;

-- the register's new columns: kv_app already holds table-level SELECT / INSERT / UPDATE on coop_share_registers (0130); the
-- import provenance is guarded by trg_csr_import (a confirmed batch to write it, and never rewritten once written).

CREATE INDEX IF NOT EXISTS idx_scr_tenant_created ON setup_call_requests (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_scr_open ON setup_call_requests (status, preferred_slot_start) WHERE status IN ('requested', 'scheduled');
CREATE INDEX IF NOT EXISTS idx_pon_open ON platform_ops_notices (created_at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agm_tenant_created ON agm_packs (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_agm_issuing ON agm_packs (tenant_id) WHERE status = 'issuing';
CREATE INDEX IF NOT EXISTS idx_agm_sections_pack ON agm_pack_sections (pack_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sri_tenant_created ON share_register_imports (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sri_confirmed ON share_register_imports (tenant_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_srir_import_line ON share_register_import_rows (import_id, line_no);
CREATE INDEX IF NOT EXISTS idx_tod_expires ON tenant_onboarding_drafts (expires_at);

-- ---------------------------------------------------------------------------------------------------------------
-- QA (Fable, TENANT-SW-d) · PRE-EXISTING BREAK FOUND BY THE BUILD'S PROOF RUN, FIXED FORWARD HERE (Law 5).
-- 13d's `add_included_tenant_domain` trigger on `tenants` calls `kv_platform_setting(...)`, which reads
-- `platform_setting_values`; 0121 granted SELECT on that table to kv_app and kv_readonly only. The admin realm
-- (kv_admin — admin-api's tenant-application approval INSERT) therefore failed with "permission denied for table
-- platform_setting_values" on EVERY tenant it tried to create since 0194. The admin realm reading platform settings
-- is legitimate (it is the realm that writes them through admin-api); a SELECT grant is the narrow fix. Proven live
-- in tenant-swd spec A6 (SET ROLE kv_admin → INSERT tenants succeeds).
GRANT SELECT ON platform_setting_values TO kv_admin;
