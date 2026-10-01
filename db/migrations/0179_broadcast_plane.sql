-- ==================================================================================================================
-- MIGRATION 0179 — PC-56 TENANT-8e · WHATSAPP — THE BROADCAST PLANE, TOLD THE TRUTH
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0048 and 0073 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t8.md F-2, F-15, F-16, F-17, F-19, F-21), RE-PROVEN AT a94a869 BEFORE THIS FILE:
--   • This platform carries NO WhatsApp: no provider adapter (no Meta Cloud API, no BSP), no inbound sink, zero whatsapp
--     templates for any of the 68 catalogued events, no business number, no opt-in record — `integration_providers`
--     holds no `whatsapp` category row and `apps/whatsapp-bot` exits 1.
--   • …and yet 0073 gave `tenant_broadcasts.channel` the DEFAULT `'whatsapp'`, so EVERY broadcast row ever written claims
--     WhatsApp while the handler fanned it out as push + in-app (`tenant.broadcast`'s default_channels).
--   • `tenant.broadcast` had ZERO templates, so every push leg recorded `failed · no_template` per recipient — and the
--     handler then wrote `markSent(total, total)`: `sent_count` = the recipient count, whatever the log said.
--   • `scheduled_at`, `eligible_count`, `template_id` and `tenant_broadcast_recipients` (0073) were written by nothing;
--     `audience_role_code` was a free string, so a typo matched nobody and the broadcast still recorded `sent`.
--
-- WHAT THIS FILE DOES
--   179.1  `whatsapp_provider_connected()` — the ONLY place the platform answers "is there a WhatsApp provider": an
--          active `integration_providers` row of category `whatsapp`. Today: false (there is none). Nothing in this
--          wave creates one; that is the founder's provider decision (ADMIN-11b-Q1).
--   179.2  `tenant_broadcasts.channel` — every existing row corrected to `inapp` (what was actually done: the fan-out
--          has only ever written push + in-app rows, never a WhatsApp send), DEFAULT `inapp`, and a CHECK that admits
--          `whatsapp` ONLY while `whatsapp_provider_connected()` — so the column can never again claim a channel the
--          platform does not carry. (A CHECK reading a table is evaluated at write time only; it is the honest wall
--          here because the answer can only move from false to true by the founder's decision, never back under a
--          row that relied on it — named.)
--   179.3  THE LIFECYCLE (Law 5): draft → scheduled | queued | cancelled; scheduled → queued | cancelled | failed;
--          queued → sending | failed; sending → sent | failed. A broadcast is BORN A DRAFT (the canon's "Save draft",
--          W428/W2841's act, is the form chain; "Send broadcast" is the mutate chain, W2845). Who pressed send, when it
--          was queued, when it fanned out, who cancelled it and why, and why it failed — each a column, each required by
--          a CHECK for the state that needs it. The guard trigger enforces the table of moves, freezes the words after
--          the draft, refuses an audience role the `roles` registry does not hold as an active tenant role (F-16), and
--          refuses a move to scheduled/queued while `broadcast_template_gaps()` is non-empty.
--   179.4  THE COUNTS ARE THE LOG'S. `sent_count` and `recipient_count` are DROPPED: they were copies the handler wrote
--          (`markSent(total, total)`), and a copy is the column that lies. The receipt reads `notifications` through
--          `tenant_broadcast_recipients` (179.5). `eligible_count` stays — written by the SEND act from the real audience
--          query (the honest-math denominator: who the audience held when somebody pressed send). `template_id` is
--          DROPPED: a broadcast is rendered by the `tenant.broadcast` templates in each member's language, not by one
--          template, and the column was written by nothing.
--   179.5  `tenant_broadcast_recipients` — DECIDED: WRITTEN, one row per member the fan-out reached, carrying the
--          delivery instance key (`fanout_key`, 0176) that joins it to that member's channel rows in the log. Its own
--          copies of the outcome (`delivery_status`, `failure_reason`, `delivered_at`) are DROPPED for the same reason as
--          `sent_count`: W429's receipt ("1,384 delivered · 3 failed") is counted from the log, never from a second
--          table a handler must remember to update. Nothing ever wrote a row, so the table is empty and the NOT NULL is
--          safe.
--   179.6  `broadcast_template_gaps(tenant)` — the (channel, language) pairs of `tenant.broadcast` (its catalogued
--          default channels × en · hi · gu) with no SERVING template for that tenant (its own approved override or the
--          platform default — `resolve()`'s own join). A broadcast with a gap FAILS AT ENQUEUE (the send act's verdict
--          and this trigger), never as `no_template` per recipient. Seed 0007 now carries the six templates.
--   179.7  `whatsapp_optin_policies` — the ONE WhatsApp fact a cooperative can honestly record today (W430): how it
--          intends to collect consent (sources from the `whatsapp_optin_source` vocabulary, Law 6) and the statement a
--          member will be shown — and, as a column constrained to it, that consent is NOT being collected
--          (`collection_state = 'not_collected'`): there is no number to bind it to, no capture surface and no provider.
--          The CHECK widens only with the provider decision.
--   179.8  THE WALL. RLS decision: both broadcast tables and the policy table are TENANT-OWNED (tenant_id NOT NULL); the
--          0048/0073 auto-policy (`tenant_id IS NULL OR …`, ALL, no WITH CHECK) is replaced by `*_tenant` (FOR ALL,
--          USING + WITH CHECK `tenant_id = current_tenant_id()`) and `*_admin_realm` (TO kv_admin, named). ENABLE + FORCE
--          restated (both were already t/t — checked live: `relrowsecurity/relforcerowsecurity` = t/t on
--          tenant_broadcasts, on tenant_broadcast_recipients and on each of its 16 partitions). kv_app and kv_relay:
--          REVOKE ALL first, then column grants only — no DELETE anywhere (a broadcast is cancelled, never erased).
--
-- PARTITION NOTE (Law 8). `tenant_broadcast_recipients` stays RANGE-partitioned by `created_at` (0073); every row of one
-- broadcast carries the SAME `created_at` (the fan-out transaction's instant, also stored as
-- `tenant_broadcasts.fanned_out_at`), so the receipt's join to `notifications` — whose rows of that fan-out carry the
-- same instant — is pruned to ONE partition of each table. The policies and grants are rewritten on the parent AND every
-- partition (a partition is a table a role can name directly — 0176's reasoning).
--
-- WHAT THIS FILE DOES NOT DO (named): build any WhatsApp provider, number, webhook, template category or Meta
-- submission; add a maker ≠ checker step to a broadcast (W429 draws none — its confirm says "This action is recorded"
-- and nothing more); auto-retry a failed broadcast (a retry is a new draft made from the old one, by a person).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 179.1 · IS THERE A WHATSAPP PROVIDER — the one answer
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_provider_connected() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM integration_providers
                  WHERE category = 'whatsapp' AND is_active AND deleted_at IS NULL)
$$;
COMMENT ON FUNCTION whatsapp_provider_connected() IS
  'PC-56 TENANT-8e. True only when an active integration_providers row of category whatsapp exists. None does: the platform has no Meta Cloud API / BSP adapter, no inbound sink, no WhatsApp templates and no business number. The provider decision is the founder''s (ADMIN-11b-Q1).';

-- ------------------------------------------------------------------------------------------------------------------
-- 179.2 · THE CHANNEL, TRUTHFUL
-- ------------------------------------------------------------------------------------------------------------------
-- Every row the handler ever processed was fanned out on push + in-app; no WhatsApp message was ever sent.
UPDATE tenant_broadcasts SET channel = 'inapp' WHERE channel IS DISTINCT FROM 'inapp';
ALTER TABLE tenant_broadcasts ALTER COLUMN channel SET DEFAULT 'inapp';
ALTER TABLE tenant_broadcasts ADD CONSTRAINT ck_tb_channel
  CHECK (channel = 'inapp' OR (channel = 'whatsapp' AND whatsapp_provider_connected()));
COMMENT ON COLUMN tenant_broadcasts.channel IS
  'PC-56 TENANT-8e. inapp = an in-app announcement (the tenant.broadcast event: an in-app item, plus push where the member has a device). whatsapp is admitted only while whatsapp_provider_connected() — today never. 0073''s DEFAULT whatsapp was false on every row and was corrected by 0179.';

-- ------------------------------------------------------------------------------------------------------------------
-- 179.3 · THE LIFECYCLE
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenant_broadcasts DROP CONSTRAINT IF EXISTS tenant_broadcasts_status_check;
ALTER TABLE tenant_broadcasts ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE tenant_broadcasts
  ADD COLUMN send_requested_by uuid REFERENCES users(id),
  ADD COLUMN send_requested_at timestamptz,
  ADD COLUMN queued_at         timestamptz,
  ADD COLUMN fanned_out_at     timestamptz,
  ADD COLUMN failed_at         timestamptz,
  ADD COLUMN cancelled_by      uuid REFERENCES users(id),
  ADD COLUMN cancelled_at      timestamptz,
  ADD COLUMN cancel_reason     varchar(300);

-- Rows written before this wave (queued/sending/sent/failed by the PC-27 path) keep their status; they are given the
-- facts the new CHECKs require, from what the row itself says — never a guess about who pressed send:
--   • the author pressed send (PC-27 had no draft: create WAS send), at creation;
--   • a pre-0179 `sent` row fanned out at its last update (the handler's markSent wrote updated_at);
--   • a pre-0179 `failed` row (nothing ever wrote one — `markFailed` had no caller) failed at its last update.
UPDATE tenant_broadcasts
   SET send_requested_by = created_by_user_id, send_requested_at = created_at, queued_at = created_at
 WHERE status IN ('queued', 'sending', 'sent', 'failed') AND send_requested_at IS NULL;
UPDATE tenant_broadcasts SET fanned_out_at = updated_at WHERE status = 'sent' AND fanned_out_at IS NULL;
UPDATE tenant_broadcasts SET failed_at = updated_at, failure_reason = COALESCE(failure_reason, 'unrecorded')
 WHERE status = 'failed' AND failed_at IS NULL;
-- failure_reason becomes a CODE (Law 6): the vocabulary below. Anything free-text already there (none exists) is kept
-- out of the code column as 'unrecorded'.
UPDATE tenant_broadcasts SET failure_reason = 'unrecorded'
 WHERE failure_reason IS NOT NULL AND failure_reason NOT IN ('no_template', 'no_recipients', 'role_retired', 'unrecorded');
ALTER TABLE tenant_broadcasts ALTER COLUMN failure_reason TYPE varchar(40);

ALTER TABLE tenant_broadcasts
  ADD CONSTRAINT ck_tb_status CHECK (status IN ('draft', 'scheduled', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  ADD CONSTRAINT ck_tb_scheduled_has_time CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  ADD CONSTRAINT ck_tb_send_was_requested CHECK (
    status NOT IN ('scheduled', 'queued', 'sending', 'sent', 'failed') OR (send_requested_by IS NOT NULL AND send_requested_at IS NOT NULL)),
  ADD CONSTRAINT ck_tb_queued_when CHECK (status NOT IN ('queued', 'sending', 'sent') OR queued_at IS NOT NULL),
  ADD CONSTRAINT ck_tb_sent_fanned_out CHECK (status <> 'sent' OR fanned_out_at IS NOT NULL),
  ADD CONSTRAINT ck_tb_failed_says_why CHECK (status <> 'failed' OR (failure_reason IS NOT NULL AND failed_at IS NOT NULL)),
  ADD CONSTRAINT ck_tb_failure_reason CHECK (failure_reason IS NULL OR failure_reason IN ('no_template', 'no_recipients', 'role_retired', 'unrecorded')),
  ADD CONSTRAINT ck_tb_cancelled_says_why CHECK (
    status <> 'cancelled' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND char_length(btrim(cancel_reason)) >= 3)),
  ADD CONSTRAINT ck_tb_eligible CHECK (eligible_count >= 0),
  ADD CONSTRAINT ck_tb_words_plain CHECK (title !~ '[<>]' AND body !~ '[<>]');

COMMENT ON COLUMN tenant_broadcasts.eligible_count IS
  'PC-56 TENANT-8e. Written by the SEND act from the real audience query (active members holding the role, or all active members): who the audience held when the send was pressed. The receipt prints it beside the recipients the fan-out actually reached.';
COMMENT ON COLUMN tenant_broadcasts.fanned_out_at IS
  'PC-56 TENANT-8e. The fan-out transaction''s instant. Every tenant_broadcast_recipients row and every notifications row of this broadcast carries this same created_at — which is what prunes the receipt''s join to one partition of each.';

-- The words are frozen once the draft is sent; the audience must be a registered, active tenant role; the moves follow
-- the table; templates must serve before anything is queued; the person named is the session's own.
CREATE OR REPLACE FUNCTION broadcast_template_gaps(p_tenant uuid) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE chans jsonb; out text[];
BEGIN
  SELECT default_channels INTO chans FROM notification_events WHERE code = 'tenant.broadcast' AND deleted_at IS NULL;
  IF chans IS NULL OR jsonb_typeof(chans) <> 'array' OR jsonb_array_length(chans) = 0 THEN RETURN ARRAY['EVENT_MISSING']; END IF;
  SELECT COALESCE(array_agg(c.ch || ':' || l.code ORDER BY c.ch, l.code), '{}') INTO out
    FROM jsonb_array_elements_text(chans) AS c(ch)
   CROSS JOIN unnest(broadcast_required_languages()) AS l(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM notification_templates t
       JOIN notification_template_versions v ON v.id = t.serving_version_id AND v.lifecycle = 'approved' AND v.deleted_at IS NULL
      WHERE t.event_code = 'tenant.broadcast' AND t.channel = c.ch AND t.language_code = l.code
        AND t.is_active AND t.deleted_at IS NULL AND (t.tenant_id IS NULL OR t.tenant_id = p_tenant));
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION broadcast_required_languages() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['en', 'hi', 'gu']::text[] $$;
COMMENT ON FUNCTION broadcast_required_languages() IS
  'PC-56 TENANT-8e. The languages a broadcast''s frame (tenant.broadcast) must serve in before anything is queued — the binding en · hi · gu.';
COMMENT ON FUNCTION broadcast_template_gaps(uuid) IS
  'PC-56 TENANT-8e. channel:language pairs of tenant.broadcast (its catalogued default channels × broadcast_required_languages()) with no serving template for this tenant — its own approved override or the platform default, by resolve()''s own join. EVENT_MISSING when the catalogue lost the event. Non-empty = a broadcast fails at enqueue.';

CREATE OR REPLACE FUNCTION broadcast_role_known(p_code text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_code IS NULL OR EXISTS (SELECT 1 FROM roles WHERE code = p_code AND scope = 'tenant' AND is_active AND deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION trg_tenant_broadcasts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE gaps text[]; me uuid := current_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'tenant_broadcasts: a broadcast is born a draft (got %)', NEW.status USING ERRCODE = '23514';
    END IF;
    IF me IS NOT NULL AND NEW.created_by_user_id IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'tenant_broadcasts: a draft is written by the session''s own user' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
      RAISE EXCEPTION 'tenant_broadcasts %: the owner and the author never change', OLD.id USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
        OR NEW.audience_role_code IS DISTINCT FROM OLD.audience_role_code OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
        OR NEW.channel IS DISTINCT FROM OLD.channel) THEN
      RAISE EXCEPTION 'tenant_broadcasts %: the words, the audience and the time are frozen once a draft is sent (status %)', OLD.id, OLD.status
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'draft'     AND NEW.status IN ('scheduled', 'queued', 'cancelled'))
      OR (OLD.status = 'scheduled' AND NEW.status IN ('queued', 'cancelled', 'failed'))
      OR (OLD.status = 'queued'    AND NEW.status IN ('sending', 'failed'))
      OR (OLD.status = 'sending'   AND NEW.status IN ('sent', 'failed'))) THEN
      RAISE EXCEPTION 'tenant_broadcasts %: % → % is not a move a broadcast makes', OLD.id, OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = OLD.status AND OLD.status NOT IN ('draft', 'scheduled', 'queued', 'sending')
       AND (NEW.eligible_count IS DISTINCT FROM OLD.eligible_count OR NEW.fanned_out_at IS DISTINCT FROM OLD.fanned_out_at
            OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason) THEN
      RAISE EXCEPTION 'tenant_broadcasts %: a % broadcast is final', OLD.id, OLD.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND me IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'tenant_broadcasts %: a cancellation names the session''s own user', OLD.id USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('scheduled', 'queued') AND OLD.status = 'draft' AND me IS NOT NULL AND NEW.send_requested_by IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'tenant_broadcasts %: a send names the session''s own user', OLD.id USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT broadcast_role_known(NEW.audience_role_code) AND (TG_OP = 'INSERT'
      OR NEW.audience_role_code IS DISTINCT FROM OLD.audience_role_code
      OR (NEW.status IN ('scheduled', 'queued') AND NEW.status IS DISTINCT FROM OLD.status)) THEN
    RAISE EXCEPTION 'tenant_broadcasts: audience role % is not an active tenant role in the roles registry', NEW.audience_role_code
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('scheduled', 'queued') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    gaps := broadcast_template_gaps(NEW.tenant_id);
    IF cardinality(gaps) > 0 THEN
      RAISE EXCEPTION 'tenant_broadcasts: tenant.broadcast does not serve in %', array_to_string(gaps, ', ') USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'scheduled' AND (TG_OP = 'INSERT' OR OLD.status <> 'scheduled') AND NEW.scheduled_at <= now() THEN
    RAISE EXCEPTION 'tenant_broadcasts: a schedule is in the future' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tenant_broadcasts_guard BEFORE INSERT OR UPDATE ON tenant_broadcasts
  FOR EACH ROW EXECUTE FUNCTION trg_tenant_broadcasts_guard();

-- The scheduled job's scan (status = 'scheduled', due first), and the history list — keyset on the id alone (uuid v7 is
-- time-ordered and minted at creation; a timestamp cursor round-tripped through a JS Date loses its microseconds).
DROP INDEX IF EXISTS idx_tenant_broadcasts_scheduled;
CREATE INDEX idx_tenant_broadcasts_due ON tenant_broadcasts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_tenant_broadcasts_keyset ON tenant_broadcasts (tenant_id, id DESC);
CREATE INDEX idx_tenant_broadcasts_status ON tenant_broadcasts (tenant_id, status, id DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- 179.4 · THE COPIES GO — the counts are the log's
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenant_broadcasts DROP COLUMN sent_count, DROP COLUMN recipient_count, DROP COLUMN template_id;

-- ------------------------------------------------------------------------------------------------------------------
-- 179.5 · THE RECIPIENTS — written, one row per member reached, keyed to the log
-- ------------------------------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_tenant_broadcast_recipients_failed;
ALTER TABLE tenant_broadcast_recipients
  DROP COLUMN delivery_status, DROP COLUMN failure_reason, DROP COLUMN delivered_at,
  ADD COLUMN fanout_key varchar(64) NOT NULL;
ALTER TABLE tenant_broadcast_recipients ADD CONSTRAINT ck_tbr_fanout_key CHECK (fanout_key ~ '^[0-9a-f]{64}$');
COMMENT ON COLUMN tenant_broadcast_recipients.fanout_key IS
  'PC-56 TENANT-8e. The delivery instance key (0176) of this member''s rows of this broadcast in notifications — the join the receipt counts sent / failed / held / suppressed / read through. The outcome is never copied here.';

-- ------------------------------------------------------------------------------------------------------------------
-- 179.7 · THE ONE WHATSAPP FACT A COOPERATIVE CAN RECORD TODAY — its opt-in policy
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('whatsapp_optin_source', 'How a cooperative intends to collect a member''s WhatsApp consent', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.name, '{}'::jsonb, v.ord
  FROM (VALUES
    ('whatsapp_optin_source', 'storefront_checkbox',    'Storefront checkbox at checkout, on the member''s own verified number', 1),
    ('whatsapp_optin_source', 'qr_till_card',           'QR till-card scanned in store, same number-verified flow',               2),
    ('whatsapp_optin_source', 'assisted_kiosk_own_otp', 'Assisted kiosk — still the member''s own OTP; a helper tapping yes is not consent', 3)
  ) AS v(type_code, code, name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values l WHERE l.type_code = v.type_code AND l.tenant_id IS NULL AND l.code = v.code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_wa_optin_platform
  ON lookup_values (code) WHERE type_code = 'whatsapp_optin_source' AND tenant_id IS NULL;

CREATE TABLE whatsapp_optin_policies (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id),
  sources           varchar(40)[] NOT NULL,
  consent_statement text NOT NULL,
  collection_state  varchar(20) NOT NULL DEFAULT 'not_collected',
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_woo_sources_some CHECK (cardinality(sources) BETWEEN 1 AND 3),
  CONSTRAINT ck_woo_statement CHECK (char_length(btrim(consent_statement)) BETWEEN 20 AND 600 AND consent_statement !~ '[<>]'),
  CONSTRAINT ck_woo_not_collected CHECK (collection_state = 'not_collected'),
  CONSTRAINT ck_woo_version CHECK (version >= 1)
);
CALL add_std_columns('whatsapp_optin_policies');
COMMENT ON TABLE whatsapp_optin_policies IS
  'PC-56 TENANT-8e (W430). A cooperative''s declared WhatsApp opt-in policy: the consent sources it intends to use and the statement a member will be shown. collection_state is constrained to not_collected: no WhatsApp number, capture surface or provider exists, so no consent is being collected — the CHECK widens only with the provider decision.';

CREATE OR REPLACE FUNCTION trg_whatsapp_optin_policies_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'whatsapp_optin_policies: the owner never changes' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT s) FROM unnest(NEW.sources) s) <> cardinality(NEW.sources) THEN
    RAISE EXCEPTION 'whatsapp_optin_policies: a source is named once' USING ERRCODE = '23514';
  END IF;
  SELECT s INTO bad FROM unnest(NEW.sources) s
   WHERE NOT EXISTS (SELECT 1 FROM lookup_values l WHERE l.type_code = 'whatsapp_optin_source' AND l.tenant_id IS NULL
                       AND l.code = s AND l.is_active AND l.deleted_at IS NULL) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'whatsapp_optin_policies: % is not in the whatsapp_optin_source vocabulary', bad USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_whatsapp_optin_policies_guard BEFORE INSERT OR UPDATE ON whatsapp_optin_policies
  FOR EACH ROW EXECUTE FUNCTION trg_whatsapp_optin_policies_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 179.8 · THE WALL
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenant_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_broadcasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_broadcasts ON tenant_broadcasts;
CREATE POLICY tb_tenant ON tenant_broadcasts FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tb_admin_realm ON tenant_broadcasts FOR ALL TO kv_admin USING (true) WITH CHECK (true);

ALTER TABLE whatsapp_optin_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_optin_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY woo_tenant ON whatsapp_optin_policies FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY woo_admin_realm ON whatsapp_optin_policies FOR ALL TO kv_admin USING (true) WITH CHECK (true);

DO $$
DECLARE r record; p record;
BEGIN
  FOR r IN
    SELECT 'tenant_broadcast_recipients'::text AS rel
    UNION ALL
    SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'tenant_broadcast_recipients'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.rel);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.rel);
    FOR p IN SELECT polname FROM pg_policy WHERE polrelid = r.rel::regclass LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.polname, r.rel);
    END LOOP;
    EXECUTE format('CREATE POLICY tbr_tenant ON %I FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', r.rel);
    EXECUTE format('CREATE POLICY tbr_admin_realm ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', r.rel);
  END LOOP;
END $$;

-- kv_app / kv_relay: REVOKE first, then exactly the columns each writer needs. No DELETE anywhere.
REVOKE ALL ON tenant_broadcasts FROM kv_app, kv_relay;
GRANT SELECT ON tenant_broadcasts TO kv_app, kv_relay;
GRANT INSERT (id, tenant_id, created_by_user_id, audience_role_code, title, body, status, channel, scheduled_at, created_by, updated_by)
  ON tenant_broadcasts TO kv_app;
GRANT UPDATE (audience_role_code, title, body, scheduled_at, status, eligible_count, send_requested_by, send_requested_at, queued_at,
              fanned_out_at, failed_at, failure_reason, cancelled_by, cancelled_at, cancel_reason, updated_at, updated_by)
  ON tenant_broadcasts TO kv_app;
-- the relay (the fan-out) and the scheduled job: the system's own moves only
GRANT UPDATE (status, queued_at, fanned_out_at, failed_at, failure_reason, updated_at, updated_by) ON tenant_broadcasts TO kv_relay;

REVOKE ALL ON tenant_broadcast_recipients FROM kv_app, kv_relay;
GRANT SELECT ON tenant_broadcast_recipients TO kv_app, kv_relay;
GRANT INSERT (id, tenant_id, broadcast_id, user_id, fanout_key, created_at, created_by) ON tenant_broadcast_recipients TO kv_app, kv_relay;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT ch.relname FROM pg_inherits i JOIN pg_class ch ON ch.oid = i.inhrelid
            WHERE i.inhparent = 'tenant_broadcast_recipients'::regclass LOOP
    CALL sync_partition_privileges('tenant_broadcast_recipients', c.relname);
  END LOOP;
END $$;

REVOKE ALL ON whatsapp_optin_policies FROM kv_app, kv_relay;
GRANT SELECT ON whatsapp_optin_policies TO kv_app;
GRANT INSERT (tenant_id, sources, consent_statement, created_by, updated_by) ON whatsapp_optin_policies TO kv_app;
GRANT UPDATE (sources, consent_statement, version, updated_at, updated_by) ON whatsapp_optin_policies TO kv_app;
GRANT SELECT ON whatsapp_optin_policies TO kv_readonly;
