-- ==================================================================================================================
-- 0175 · PC-56 TENANT-8a · THE OVERRIDE — W180 (templates), W181 (template editor), W182 (A/B — refused, DELTA-029)
--        + the template-form (W2779–W2782), template-mutate (W2783–W2785), templates-form (W2786–W2789) and
--        templates-mutate (W2790–W2792) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- ==================================================================================================================
--
-- W180: *"Platform defaults you can override per event × channel × language (your tenant_id row wins). Security
--        templates (OTP, disputes) are platform-locked"* · *"Deleting an override never silences the event — sending
--        falls back to the platform default"*.
-- W181: *"Variables are fixed by the event — you rearrange words, never invent data"* · *"Edits re-verify DLT before next
--        send; until approved, the previous version keeps sending"*.
--
-- WHAT THE WAVE IS DECLARED AS (TENANT-8's survey, §3 F-1 / F-3 / F-11, verbatim in spirit):
--
--   F-1 · A TENANT OVERRIDE NEVER SENDS. `resolve()` joins `serving_version_id` → an APPROVED
--         `notification_template_versions` row; `kv_app` held SELECT only on versions (0122:172,184) and nothing minted
--         one, so a new tenant row sat at `serving_version_id NULL` and was skipped, and an edited one kept serving its
--         old words while the API returned the new body as if live (it read `t.body`, the row, not the version).
--         `authored_by_user_id` — the column 0122 reserved for tenant authoring — was written by nothing.
--   F-3 · THE DB WALL DID NOT HOLD. `notification_templates` had ONE policy for ALL commands,
--         `tenant_id IS NULL OR tenant_id = current_tenant_id()`, with no WITH CHECK — so `kv_app`, under ANY tenant
--         context, could INSERT platform-default rows and UPDATE the platform `auth.otp` rows (proven, rolled back);
--         0014's blanket `GRANT SELECT, INSERT, UPDATE ON ALL TABLES` was never narrowed on `notification_events`,
--         `notification_event_variables` or `messaging_sender_ids`, so `kv_app` could flip `auth.otp`'s catalogue lock
--         — the very row ADMIN-11b's security-copy trigger trusts — and rewrite the variable contract.
--   F-11 · A TEMPLATE FOR A CHANNEL OUTSIDE THE EVENT'S `default_channels` could be saved and could never send: the
--         fan-out iterates `event.defaultChannels` only. W180's own example (`payout.completed × whatsapp`, defaults
--         `push, sms`) is exactly this.
--
-- WHAT THIS FILE BUILDS: the wall first, then the one write path that makes an override real.
--   175.1  notification_templates — the ALL policy is split: SELECT admits the platform row; INSERT/UPDATE/DELETE admit
--          ONLY the current tenant's row (USING + WITH CHECK, never NULL). The platform row is READ-ONLY from the tenant
--          realm. kv_app's INSERT/UPDATE are narrowed to the columns the override needs (no `provider_template_ref`,
--          no 0072 dead columns, no `tenant_id` change). The admin realm (kv_admin) is named in its own policy.
--   175.2  The catalogue — REVOKE INSERT, UPDATE, DELETE on notification_events, notification_event_variables and
--          messaging_sender_ids FROM kv_app (and the same on notification_events / notification_templates from
--          kv_relay, a BYPASSRLS role that held write on platform copy and never wrote it — grep in the 8a report).
--   175.3  notification_template_versions — the tenant realm may INSERT its own versions (tenant_id copied from the
--          template by trigger, 7b's pattern; RLS ENABLE + FORCE; WITH CHECK tenant_id = current) and UPDATE only the
--          decision columns the acts need. `authored_by_user_id` becomes the writer 0122 reserved it for; the approver
--          is `approved_by_user_id`. The lifecycle gains `submitted_to_provider` (SMS / WhatsApp: a tenant checker's
--          yes that NEVER serves until a provider registration exists — ADMIN-11b-Q1 owns the provider).
--   175.4  MAKER ≠ CHECKER as a trigger: the approver of a tenant version is never its author (23514). An approved SMS /
--          WhatsApp tenant version without a provider ref is refused (23514). A tenant version is born `draft`.
--   175.5  The serving pointer on a TENANT row moves to a non-NULL value only onto an APPROVED version of that same
--          template (the approval act), and to NULL only with the row made inactive (the retire act). A tenant row is
--          never `is_active` without a serving version (nothing anywhere may treat an unserved override as live).
--   175.6  F-11 as a function + trigger: a tenant template's (and a tenant version's) channel must be in the event's
--          `default_channels`.
--   175.7  One open (draft / submitted) version per tenant template, as a partial unique index.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   • `notification_templates`: ENABLE + FORCE (already, 0027). The single ALL-command policy is DROPPED and replaced by
--     four: `nt_read` (SELECT: `tenant_id IS NULL OR tenant_id = current_tenant_id()` — every tenant reads the platform
--     defaults underneath its overrides), `nt_insert_own` / `nt_update_own` / `nt_delete_own` (`tenant_id =
--     current_tenant_id()` in USING and WITH CHECK — NULL never matches, so the platform row cannot be written from the
--     tenant realm), and `nt_admin_realm` (FOR ALL TO kv_admin — the admin realm owns platform copy, Law 11; it is
--     named rather than left to an attribute the dev database does not carry: live `rolbypassrls` for kv_admin is `f`).
--     kv_app: REVOKE INSERT, UPDATE (table-level, which drops every column grant with it — PG docs), then GRANT INSERT
--     and UPDATE on named columns only. kv_relay (BYPASSRLS): REVOKE INSERT, UPDATE, DELETE — it keeps SELECT.
--   • `notification_template_versions`: ENABLE + FORCE (restated). Its SELECT policy stays; `ntv_insert_own` /
--     `ntv_update_own` are added (`tenant_id = current_tenant_id()`), plus `ntv_admin_realm` (TO kv_admin). kv_app:
--     REVOKE ALL first, then GRANT SELECT, column-limited INSERT, column-limited UPDATE (the decision columns only —
--     the words were already immutable by 0122's trigger). No DELETE to anybody in the tenant realm: a version is
--     history.
--   • `notification_events`, `notification_event_variables`, `messaging_sender_ids`: global catalogue (no tenant_id; not
--     in `v_tables_without_rls`, by design). REVOKE INSERT, UPDATE, DELETE FROM kv_app — SELECT stays. They are written by
--     migrations, seeds and the admin realm only.
--
-- THE SAME POLICY SHAPE ON 35 OTHER TABLES IS NAMED, NOT WIDENED. TENANT-8's survey found 38 tables with a nullable
-- tenant_id and exactly this `tenant_id IS NULL OR …` ALL-command policy with no WITH CHECK. This wave owns
-- `notification_templates`; `cms_pages` is 8c's and `notifications` is 8b's. The other 35 (addresses, ai_inferences,
-- ai_review_queue, audit_log, bank_accounts, certificates, cold_chain_logs, commission_plans_ambassador,
-- commission_rules, contract_templates, course_lesson_subtitles, course_lessons, course_templates, courses,
-- credit_scores, crop_calendars, data_export_jobs, dbt_bounces, dbt_transfers, instructors, kyc_documents,
-- logistics_partners, lookup_values, media_assets, membership_tiers, outbox_events, products, risk_events, risk_scores,
-- stream_dead_letters, stream_processed_events, support_tickets, vehicles, vet_profiles, warehouses) are a sweep of
-- their own, each needing its owner's answer to "who may write the NULL row" — not a line in a template wave.
--
-- PARTITION NOTE. Neither table is partitioned and neither should be. Platform defaults are ~224 rows; an override is
-- one row per event × channel × language a tenant chooses to re-word, and a version is one row per edit — tens per
-- tenant per year. `notifications` (monthly partitions) points at a version id and is untouched here.
--
-- ON CONFLICT on a nullable key: none is asked here. The tenant row is written by a plain INSERT under the 0012 UNIQUE
-- (event_code, channel, language_code, tenant_id) — non-NULL tenant, so the constraint is a real one (F-20's lesson);
-- the platform side has 0162's partial `uq_notification_templates_platform`.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 175.1 · THE WALL ON notification_templates
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_templates ON notification_templates;

CREATE POLICY nt_read ON notification_templates
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY nt_insert_own ON notification_templates
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY nt_update_own ON notification_templates
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY nt_delete_own ON notification_templates
  FOR DELETE
  USING (tenant_id = current_tenant_id());
-- The admin realm owns platform copy (ADMIN-11b). Named, so the wall does not depend on a role attribute.
CREATE POLICY nt_admin_realm ON notification_templates
  FOR ALL TO kv_admin
  USING (true) WITH CHECK (true);

-- REVOKE before the narrow GRANT. A table-level REVOKE also revokes each column's privilege (PostgreSQL GRANT docs).
REVOKE INSERT, UPDATE, DELETE ON notification_templates FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON notification_templates FROM kv_relay;
GRANT INSERT (id, event_code, channel, language_code, tenant_id, subject, body, is_active, current_version_no,
              created_by, updated_by)
  ON notification_templates TO kv_app;
GRANT UPDATE (is_active, serving_version_id, current_version_no, updated_at, updated_by)
  ON notification_templates TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 175.2 · THE CATALOGUE IS READ-ONLY FROM THE TENANT REALM
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON notification_events FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON notification_event_variables FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON messaging_sender_ids FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON notification_events FROM kv_relay;
GRANT SELECT ON notification_events, notification_event_variables, messaging_sender_ids TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 175.3 · THE TENANT VERSION — a writer for the column 0122 reserved
-- ------------------------------------------------------------------------------------------------------------------
-- `submitted_to_provider` is 21 characters; 0122's varchar(12) cannot hold it.
ALTER TABLE notification_template_versions DROP CONSTRAINT notification_template_versions_lifecycle_check;
ALTER TABLE notification_template_versions ALTER COLUMN lifecycle TYPE varchar(24);
ALTER TABLE notification_template_versions ADD CONSTRAINT notification_template_versions_lifecycle_check
  CHECK (lifecycle IN ('draft', 'submitted', 'approved', 'submitted_to_provider', 'rejected', 'superseded'));

ALTER TABLE notification_template_versions
  ADD COLUMN approved_by_user_id  uuid REFERENCES users(id),
  ADD COLUMN submitted_by_user_id uuid REFERENCES users(id),
  ADD COLUMN submitted_at         timestamptz,
  ADD COLUMN rejected_by_user_id  uuid REFERENCES users(id),
  ADD COLUMN rejected_at          timestamptz;

COMMENT ON COLUMN notification_template_versions.authored_by_user_id IS
  'Tenant authoring (0175): the member who wrote this wording. Never the approver of the same version (trg_ntv_tenant_decision).';
COMMENT ON COLUMN notification_template_versions.approved_by_user_id IS
  'Tenant checker (0175): the second person with notification.templates.approve who made this version serving — or, for SMS / WhatsApp, sent it to the provider (lifecycle submitted_to_provider, never serving).';

-- 0122's pair admitted an approval by an ADMIN only (or a platform backfill with none). A tenant approval is by a USER.
ALTER TABLE notification_template_versions DROP CONSTRAINT ck_ntv_approval_pair;
ALTER TABLE notification_template_versions ADD CONSTRAINT ck_ntv_approval_pair CHECK (
  (approved_at IS NULL AND approved_by_admin_id IS NULL AND approved_by_user_id IS NULL)
  OR (approved_at IS NOT NULL AND (approved_by_admin_id IS NOT NULL OR approved_by_user_id IS NOT NULL OR tenant_id IS NULL)));
ALTER TABLE notification_template_versions ADD CONSTRAINT ck_ntv_one_approver CHECK (
  approved_by_admin_id IS NULL OR approved_by_user_id IS NULL);
ALTER TABLE notification_template_versions ADD CONSTRAINT ck_ntv_user_approver_is_tenant CHECK (
  approved_by_user_id IS NULL OR tenant_id IS NOT NULL);
ALTER TABLE notification_template_versions ADD CONSTRAINT ck_ntv_submitted_pair CHECK (
  (submitted_at IS NULL) = (submitted_by_user_id IS NULL));
ALTER TABLE notification_template_versions ADD CONSTRAINT ck_ntv_rejected_pair CHECK (
  (rejected_at IS NULL) = (rejected_by_user_id IS NULL));

-- The template's own tenant, event, channel and language — copied, never trusted from the caller (7b's pattern). A
-- version whose template is invisible under RLS is refused as a missing parent, not written against a guess.
CREATE OR REPLACE FUNCTION ntv_copy_from_template() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  SELECT tenant_id, event_code, channel, language_code INTO t
    FROM notification_templates WHERE id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_template_versions: template % not found', NEW.template_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := t.tenant_id;
  NEW.event_code := t.event_code;
  NEW.channel := t.channel;
  NEW.language_code := t.language_code;
  IF NEW.tenant_id IS NOT NULL THEN
    -- The tenant realm's version: born a draft, written by a member, hashed here so the sha can never disagree with
    -- the words, and on a channel the event is actually sent on (F-11).
    IF NEW.lifecycle <> 'draft' OR NEW.approved_at IS NOT NULL OR NEW.approved_by_user_id IS NOT NULL
       OR NEW.approved_by_admin_id IS NOT NULL THEN
      RAISE EXCEPTION 'a tenant template version is born draft and unapproved (template %)', NEW.template_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.authored_by_user_id IS NULL AND NEW.authored_by_admin_id IS NULL THEN
      RAISE EXCEPTION 'a tenant template version names its author (template %)', NEW.template_id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT notification_channel_is_default(NEW.event_code, NEW.channel) THEN
      RAISE EXCEPTION 'channel % is not a default channel of %: an override there could never send', NEW.channel, NEW.event_code
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.body_sha256 := encode(digest(NEW.body, 'sha256'), 'hex');
    -- A provider registration is the admin realm's (ADMIN-11b-Q1): a version a MEMBER wrote carries none, whatever
    -- the caller sent. (kv_app holds no INSERT on the column either; this is the second layer.)
    IF NEW.authored_by_admin_id IS NULL THEN NEW.provider_template_ref := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 175.6 · F-11 — the channel an event is sent on (declared before the triggers that call it)
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_channel_is_default(p_event varchar, p_channel varchar) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT e.default_channels ? p_channel FROM notification_events e WHERE e.code = p_event), false)
$$;

CREATE TRIGGER trg_ntv_copy_from_template
  BEFORE INSERT ON notification_template_versions
  FOR EACH ROW EXECUTE FUNCTION ntv_copy_from_template();

-- ------------------------------------------------------------------------------------------------------------------
-- 175.4 · MAKER ≠ CHECKER, AND SMS / WHATSAPP NEVER SERVE WITHOUT A PROVIDER
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntv_tenant_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;   -- platform versions are the admin realm's (0122's CHECK covers them)
  IF NEW.approved_by_user_id IS NOT NULL AND NEW.approved_by_user_id = NEW.authored_by_user_id THEN
    RAISE EXCEPTION 'maker is checker: the author of template version % cannot approve it', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lifecycle = 'approved' AND NEW.channel IN ('sms', 'whatsapp') AND NEW.provider_template_ref IS NULL THEN
    RAISE EXCEPTION 'a % tenant version cannot serve without a provider registration (version %) — it goes to submitted_to_provider', NEW.channel, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ntv_tenant_decision
  BEFORE INSERT OR UPDATE ON notification_template_versions
  FOR EACH ROW EXECUTE FUNCTION ntv_tenant_decision();

-- The wall on versions.
ALTER TABLE notification_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY ntv_insert_own ON notification_template_versions
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ntv_update_own ON notification_template_versions
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ntv_admin_realm ON notification_template_versions
  FOR ALL TO kv_admin
  USING (true) WITH CHECK (true);

REVOKE ALL ON notification_template_versions FROM kv_app;
GRANT SELECT ON notification_template_versions TO kv_app;
GRANT INSERT (template_id, tenant_id, event_code, channel, language_code, version_no, subject, body, body_sha256,
              lifecycle, needs_second_person, authored_by_user_id, reason, created_by)
  ON notification_template_versions TO kv_app;
GRANT UPDATE (lifecycle, approved_by_user_id, approved_at, submitted_by_user_id, submitted_at, rejected_by_user_id,
              rejected_at, rejection_reason, updated_at, updated_by)
  ON notification_template_versions TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 175.5 · THE SERVING POINTER ON A TENANT ROW
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nt_tenant_row_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;   -- platform rows: the admin realm's pointer (ADMIN-11b)
  IF TG_OP = 'INSERT' THEN
    IF NOT notification_channel_is_default(NEW.event_code, NEW.channel) THEN
      RAISE EXCEPTION 'channel % is not a default channel of %: an override there could never send', NEW.channel, NEW.event_code
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.serving_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'a tenant template is born unserved: its words serve only after a second person approves a version'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.serving_version_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.serving_version_id IS DISTINCT FROM OLD.serving_version_id) THEN
    SELECT template_id, lifecycle, channel, provider_template_ref INTO v
      FROM notification_template_versions WHERE id = NEW.serving_version_id;
    IF NOT FOUND OR v.template_id <> NEW.id OR v.lifecycle <> 'approved' THEN
      RAISE EXCEPTION 'the serving pointer of tenant template % moves only onto an approved version of its own', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v.channel IN ('sms', 'whatsapp') AND v.provider_template_ref IS NULL THEN
      RAISE EXCEPTION 'a % override cannot serve without a provider registration', v.channel USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.is_active AND NEW.serving_version_id IS NULL THEN
    RAISE EXCEPTION 'tenant template % cannot be active with no serving version (an unserved override is never live)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_nt_tenant_row_guard
  BEFORE INSERT OR UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION nt_tenant_row_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 175.7 · ONE OPEN VERSION PER TENANT TEMPLATE
-- ------------------------------------------------------------------------------------------------------------------
-- A second draft beside an undecided one is two answers to "what will this say". The checker decides the open one (or
-- its author withdraws it) before the next is written.
CREATE UNIQUE INDEX uq_ntv_tenant_open ON notification_template_versions (template_id)
  WHERE tenant_id IS NOT NULL AND lifecycle IN ('draft', 'submitted');
CREATE INDEX idx_nt_tenant_slot ON notification_templates (tenant_id, event_code, channel, language_code)
  WHERE tenant_id IS NOT NULL AND deleted_at IS NULL;
