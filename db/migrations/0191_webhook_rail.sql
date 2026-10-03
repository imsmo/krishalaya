-- ==================================================================================================================
-- MIGRATION 0191 — PC-56 TENANT-13a · WEBHOOKS & THE DELIVERY RAIL
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0002, 0014, 0090, 0107, 0121, 0190 are applied; nothing
-- here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION (brief_t13a.md, 2026-10-03): HMAC-SHA256 SHARED SECRET, ENCRYPTED AT REST, SHOWN ONCE. The other 13a
-- contract points are adjudicated platform defaults (§B): the canon's ladder 1m · 5m · 30m · 2h · 12h, the ENDPOINT paused
-- after exhaustion with the developer contact told, every attempt its own row, a paused endpoint's events HELD and replayed
-- on resume, 90-day retention of deliveries and attempts.
--
-- WHAT WAS WRONG (survey_t13.md): the fanout listened for names nothing emits (F-1); the worker's result UPDATE matched
-- zero rows because it bound a millisecond JS Date against a microsecond partition key, so every due delivery was re-POSTed
-- every 30 s forever (F-2); the worker followed redirects and the guard accepted mapped/NAT64/site-local literals, a trailing
-- dot and any name resolving inside the VPC (F-3); the secret went into a URL (F-5, web); DELETE always failed 42501 (F-6);
-- rotation overwrote the one secret (F-10); nothing paused, held, replayed or logged per attempt (F-11); every member could
-- list URLs (F-12); partner deliveries sat in the tenant's RLS scope (F-19); kv_app could read every partner's secret
-- ciphertext and every tenant's plan code (F-23).
--
-- WHAT THIS FILE DOES
--   191.1  webhook_endpoints — the envelope ciphertext (`secret_enc`, `secret_hash` retired and emptied — it named a hash it
--          never was), the 24 h rotation pair (`secret_enc_prev`, `prev_expires_at`), the masked hint (last 3 characters,
--          stored apart), `status` active | paused | disabled with `paused_reason` exhausted | manual | unsafe_target,
--          `developer_email` (required at creation — trigger), soft delete with who and why (F-6). `is_active` is now
--          DERIVED (trigger) so every reader of the old flag (admin-api oversight, the 0090 view) stays truthful. The URL and
--          the tenant are immutable. The 0175 split replaces 0014's blanket policy. kv_app: column-scoped UPDATE, no DELETE;
--          kv_relay: SELECT + the pause / prev-secret columns only; kv_readonly: never a URL or a secret.
--   191.2  webhook_deliveries — `endpoint_kind` tenant | partner (backfilled from the endpoint id, F-19/F-23), `state`
--          pending | retrying | delivered | held | exhausted | cancelled (backfilled from succeeded / next_retry_at),
--          `retry_step`, the public payload version, the source outbox event, last error, replay bookkeeping. The tenant-realm
--          policy admits ONLY `endpoint_kind = 'tenant'` rows — a partner delivery is invisible to kv_app at the database.
--          Payload, endpoint and kind are immutable; nothing deletes a delivery younger than 90 days (trigger).
--   191.3  webhook_delivery_attempts — NEW, append-only: one row per attempt (attempt_no, outcome, status code, duration,
--          error class + message, signed_at, how many signatures it carried — none when nothing was sent). Cascades from its delivery (retention).
--   191.4  webhook_delivery_targets — recreated with kind, status and the rotation pair; kv_relay only.
--   191.5  F-23 — REVOKE kv_app SELECT on partner_webhook_endpoints (verified: no tenant-realm code reads it; the partner
--          fanout runs on the relay connection); tenant_flag_context becomes security_invoker (the flags service now reads
--          it under the tenant's own context).
--   191.6  PERMISSION `api.manage` (tenant_admin) — every webhook read AND write (F-12). Also seed 0004.
--   191.7  NOTIFICATION CATALOGUE `webhooks.endpoint_paused` (email + in-app; copy in seed 0007, above its version backfill).
--   191.8  RETENTION — `data_retention_policies.active_days` + the rule `webhook_deliveries` 90 days (attempts cascade).
--   191.9  INDEXES.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 191.1  webhook_endpoints
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret_enc        text;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret_enc_prev   text;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS prev_expires_at   timestamptz;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret_hint       varchar(3);
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS status            varchar(10);
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS paused_reason     varchar(20);
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS paused_at         timestamptz;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS developer_email   varchar(254);
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS deleted_by        uuid REFERENCES users(id);
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS delete_reason     text;

-- the ciphertext moves to a column that says what it is; legacy (0090 single-layer) tokens still open in the worker
UPDATE webhook_endpoints SET secret_enc = secret_hash WHERE secret_enc IS NULL;
UPDATE webhook_endpoints
   SET status        = CASE WHEN is_active THEN 'active' ELSE 'paused' END,
       paused_reason = CASE WHEN is_active THEN NULL ELSE 'manual' END,
       paused_at     = CASE WHEN is_active THEN NULL ELSE updated_at END
 WHERE status IS NULL;
ALTER TABLE webhook_endpoints ALTER COLUMN secret_enc SET NOT NULL;
ALTER TABLE webhook_endpoints ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE webhook_endpoints ALTER COLUMN status SET NOT NULL;
ALTER TABLE webhook_endpoints ALTER COLUMN secret_hash DROP NOT NULL;
UPDATE webhook_endpoints SET secret_hash = NULL WHERE secret_hash IS NOT NULL;
COMMENT ON COLUMN webhook_endpoints.secret_hash IS
  'RETIRED by 0191 (PC-56 TENANT-13a). It held the AES-GCM ciphertext of the signing secret under a name that claimed a hash; the ciphertext moved to secret_enc and this column was emptied. Nothing reads or writes it.';
COMMENT ON COLUMN webhook_endpoints.secret_enc IS
  'PC-56 TENANT-13a (0191, founder decision): the HMAC signing secret, ENVELOPE-ENCRYPTED (core/secrets/secret-envelope: a per-secret data key under AES-256-GCM bound to this row, wrapped by the KEK from the environment). Shown to the tenant once; decrypted only by the delivery worker to sign. Not a hash — an HMAC signer must hold the key.';
COMMENT ON COLUMN webhook_endpoints.secret_enc_prev IS
  'PC-56 TENANT-13a (0191): the rotated-out secret, still signing until prev_expires_at (rotation + 24 h). Deliveries in the window carry both v1 signatures; the worker clears it once expired.';
COMMENT ON COLUMN webhook_endpoints.secret_hint IS
  'PC-56 TENANT-13a (0191): the last 3 characters of the current secret, stored apart so the console can print whsec_••••8f2 without decrypting anything. NULL on endpoints created before 0191 until their first rotation.';
COMMENT ON COLUMN webhook_endpoints.developer_email IS
  'PC-56 TENANT-13a (0191): the developer contact told when the endpoint pauses (webhooks.endpoint_paused). Required at creation (trg_webhook_endpoints_rail); NULL only on endpoints created before 0191.';
COMMENT ON COLUMN webhook_endpoints.is_active IS
  'DERIVED since 0191: status = active AND deleted_at IS NULL (trg_webhook_endpoints_rail). Kept because admin-api oversight and the 0090 view read it.';

ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_status;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_status CHECK (
     (status = 'active'   AND paused_reason IS NULL AND paused_at IS NULL)
  OR (status = 'paused'   AND paused_reason IN ('exhausted', 'manual') AND paused_at IS NOT NULL)
  OR (status = 'disabled' AND paused_reason = 'unsafe_target' AND paused_at IS NOT NULL));
ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_prev_pair;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_prev_pair CHECK ((secret_enc_prev IS NULL) = (prev_expires_at IS NULL));
ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_secret;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_secret CHECK (length(secret_enc) BETWEEN 16 AND 1000 AND (secret_enc_prev IS NULL OR length(secret_enc_prev) BETWEEN 16 AND 1000));
ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_hint;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_hint CHECK (secret_hint IS NULL OR secret_hint ~ '^[A-Za-z0-9_-]{3}$');
ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_email;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_email CHECK (developer_email IS NULL OR developer_email ~ '^[^@[:space:]]{1,64}@[^@[:space:]]+\.[^@[:space:]]{2,}$');
ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS ck_webhook_endpoints_deleted;
ALTER TABLE webhook_endpoints ADD CONSTRAINT ck_webhook_endpoints_deleted CHECK (
  deleted_at IS NULL OR (deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(btrim(delete_reason)) BETWEEN 3 AND 300)) NOT VALID;

CREATE OR REPLACE FUNCTION webhook_endpoints_rail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.developer_email IS NULL OR btrim(NEW.developer_email) = '' THEN
      RAISE EXCEPTION 'webhook_endpoints: developer_email is required at creation (the contact told when the endpoint pauses)' USING ERRCODE = 'not_null_violation';
    END IF;
    IF NEW.secret_hint IS NULL THEN
      RAISE EXCEPTION 'webhook_endpoints: secret_hint is required at creation' USING ERRCODE = 'not_null_violation';
    END IF;
  ELSE
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'webhook_endpoints: % is deleted — a deleted endpoint is final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.url IS DISTINCT FROM OLD.url THEN
      RAISE EXCEPTION 'webhook_endpoints: the URL is immutable (the guard judged it at registration) — register a new endpoint' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'webhook_endpoints: tenant_id is immutable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.is_active := (NEW.status = 'active' AND NEW.deleted_at IS NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_webhook_endpoints_rail ON webhook_endpoints;
CREATE TRIGGER trg_webhook_endpoints_rail BEFORE INSERT OR UPDATE ON webhook_endpoints FOR EACH ROW EXECUTE FUNCTION webhook_endpoints_rail();
-- bring legacy rows' derived flag in line (no-op where already consistent)
UPDATE webhook_endpoints SET is_active = (status = 'active' AND deleted_at IS NULL) WHERE deleted_at IS NULL AND is_active IS DISTINCT FROM (status = 'active');

-- RLS: the 0175 split replaces 0014's blanket (tenant_id is NOT NULL, so the NULL arm was dead — now it is gone)
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_endpoints ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_read ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_insert_own ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_update_own ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_admin_realm ON webhook_endpoints;
CREATE POLICY webhook_endpoints_read        ON webhook_endpoints FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY webhook_endpoints_insert_own  ON webhook_endpoints FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY webhook_endpoints_update_own  ON webhook_endpoints FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY webhook_endpoints_admin_realm ON webhook_endpoints FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON webhook_endpoints FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON webhook_endpoints TO kv_app;
GRANT UPDATE (event_types, status, paused_reason, paused_at, secret_enc, secret_enc_prev, prev_expires_at, secret_hint, secret_rotated_at,
              deleted_at, deleted_by, delete_reason, updated_at, updated_by) ON webhook_endpoints TO kv_app;        -- never url, tenant_id, developer_email
GRANT SELECT ON webhook_endpoints TO kv_relay;                                                                     -- fanout + worker
GRANT UPDATE (status, paused_reason, paused_at, secret_enc_prev, prev_expires_at, updated_at) ON webhook_endpoints TO kv_relay;  -- pause / disable; retire an expired previous secret
GRANT SELECT (id, tenant_id, event_types, is_active, status, paused_reason, paused_at, created_at, updated_at, deleted_at) ON webhook_endpoints TO kv_readonly;  -- never a URL, never a secret

-- ------------------------------------------------------------------------------------------------------------------
-- 191.2  webhook_deliveries (partitioned)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS endpoint_kind   varchar(8);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS state           varchar(10);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS retry_step      smallint NOT NULL DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload_version smallint;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS internal_type   varchar(120);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS source_event_id bigint;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_error      varchar(300);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS delivered_at    timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS replay_count    smallint NOT NULL DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS replayed_at     timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS replayed_by     uuid;

UPDATE webhook_deliveries d
   SET endpoint_kind = CASE WHEN EXISTS (SELECT 1 FROM partner_webhook_endpoints p WHERE p.id = d.endpoint_id) THEN 'partner' ELSE 'tenant' END
 WHERE endpoint_kind IS NULL;
-- pre-0191 rows: the old worker's result never landed (F-2), so `attempt` counted nothing provable — a pending row starts at 0
UPDATE webhook_deliveries
   SET state   = CASE WHEN succeeded THEN 'delivered' WHEN next_retry_at IS NULL THEN 'exhausted' ELSE 'pending' END,
       attempt = CASE WHEN succeeded OR next_retry_at IS NULL THEN attempt ELSE 0 END
 WHERE state IS NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN endpoint_kind SET NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN state SET NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN attempt SET DEFAULT 0;
COMMENT ON COLUMN webhook_deliveries.endpoint_kind IS
  'PC-56 TENANT-13a (0191, F-19): whose endpoint this delivery goes to — tenant (webhook_endpoints) or partner (partner_webhook_endpoints). A partner delivery carries the ORIGINATING tenant_id; the tenant-realm RLS policy admits only tenant rows, so a tenant never sees what its bank or insurer was sent.';
COMMENT ON COLUMN webhook_deliveries.state IS
  'PC-56 TENANT-13a (0191): pending | retrying | delivered | held | exhausted | cancelled — transitions in modules/tenant-webhooks/domain/webhook-rail.state.ts (mirrored in the worker). `succeeded` and `next_retry_at` stay consistent with it (CHECK) for older readers.';
COMMENT ON COLUMN webhook_deliveries.attempt IS
  'Since 0191: how many attempts have been MADE (each is a webhook_delivery_attempts row). retry_step counts the failures of the current cycle (reset by resume / replay).';

ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS ck_webhook_deliveries_kind;
ALTER TABLE webhook_deliveries ADD CONSTRAINT ck_webhook_deliveries_kind CHECK (endpoint_kind IN ('tenant', 'partner'));
ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS ck_webhook_deliveries_state;
ALTER TABLE webhook_deliveries ADD CONSTRAINT ck_webhook_deliveries_state CHECK (
      state IN ('pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled')
  AND (succeeded = (state = 'delivered'))
  AND ((next_retry_at IS NOT NULL) = (state IN ('pending', 'retrying')))
  AND retry_step BETWEEN 0 AND 6 AND attempt >= 0
  AND (state <> 'retrying' OR retry_step BETWEEN 1 AND 5));

CREATE OR REPLACE FUNCTION webhook_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.created_at >= now() - interval '90 days' THEN
      RAISE EXCEPTION 'webhook_deliveries: % is younger than the 90-day retention — deliveries are kept, never deleted early', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.endpoint_id IS DISTINCT FROM OLD.endpoint_id
     OR NEW.endpoint_kind IS DISTINCT FROM OLD.endpoint_kind OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type THEN
    RAISE EXCEPTION 'webhook_deliveries: payload, endpoint, kind, tenant and event are immutable (a replay re-sends the ORIGINAL payload)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_webhook_deliveries_guard ON webhook_deliveries;
CREATE TRIGGER trg_webhook_deliveries_guard BEFORE UPDATE OR DELETE ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION webhook_deliveries_guard();

-- RLS: the 0175 split, and the tenant realm sees TENANT deliveries only (F-19 at the database)
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_read ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_insert_own ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_update_own ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_admin_realm ON webhook_deliveries;
CREATE POLICY webhook_deliveries_read        ON webhook_deliveries FOR SELECT USING (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_deliveries_insert_own  ON webhook_deliveries FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_deliveries_update_own  ON webhook_deliveries FOR UPDATE USING (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant') WITH CHECK (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_deliveries_admin_realm ON webhook_deliveries FOR ALL TO kv_admin USING (true) WITH CHECK (true);

REVOKE ALL ON webhook_deliveries FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON webhook_deliveries TO kv_app;                                                   -- the fanout runs on the relay; kv_app never enqueues
GRANT UPDATE (state, succeeded, retry_step, next_retry_at, replay_count, replayed_at, replayed_by) ON webhook_deliveries TO kv_app;  -- resume / replay / cancel
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO kv_relay;                          -- fanout, worker, retention (trigger: ≥ 90 days only)
GRANT SELECT (id, endpoint_id, tenant_id, event_type, endpoint_kind, state, attempt, status_code, succeeded, retry_step, created_at, delivered_at) ON webhook_deliveries TO kv_readonly;  -- never the payload
-- the partitions: drop their 0014 copies and take the parent's policies and grants (14 monthly + default)
CALL t12_resync_children('webhook_deliveries', 'tenant_isolation_webhook_deliveries');

-- ------------------------------------------------------------------------------------------------------------------
-- 191.3  webhook_delivery_attempts — NEW, append-only: "every attempt logged" (W189) becomes true
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  delivery_id         uuid NOT NULL,
  delivery_created_at timestamptz NOT NULL,
  endpoint_id         uuid NOT NULL,
  endpoint_kind       varchar(8) NOT NULL,
  attempt_no          smallint NOT NULL,
  outcome             varchar(10) NOT NULL,
  status_code         integer,
  duration_ms         integer NOT NULL,
  error               varchar(300),
  signed_at           timestamptz,
  signatures          smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_wda_delivery FOREIGN KEY (delivery_id, delivery_created_at) REFERENCES webhook_deliveries (id, created_at) ON DELETE CASCADE,
  CONSTRAINT uq_wda_attempt UNIQUE (delivery_id, attempt_no),
  CONSTRAINT ck_wda_kind CHECK (endpoint_kind IN ('tenant', 'partner')),
  CONSTRAINT ck_wda_attempt_no CHECK (attempt_no >= 1),
  CONSTRAINT ck_wda_duration CHECK (duration_ms >= 0),
  CONSTRAINT ck_wda_status CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT ck_wda_outcome CHECK (
       (outcome = 'delivered' AND status_code BETWEEN 200 AND 299 AND signed_at IS NOT NULL AND signatures BETWEEN 1 AND 2 AND error IS NULL)
    OR (outcome = 'failed'    AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299) AND (status_code IS NOT NULL OR error IS NOT NULL)
                              AND ((signed_at IS NOT NULL AND signatures BETWEEN 1 AND 2)                       -- sent (or attempted to send) signed
                                OR (signed_at IS NULL AND signatures = 0 AND status_code IS NULL)))            -- the host did not resolve: nothing was signed or sent
    OR (outcome = 'refused'   AND status_code IS NULL AND signed_at IS NULL AND signatures = 0 AND error IS NOT NULL))
);
COMMENT ON TABLE webhook_delivery_attempts IS
  'PC-56 TENANT-13a (0191, W189 "every attempt logged with status code"): ONE row per attempt the delivery worker made — delivered (2xx), failed (another status, or no answer: the error names the class — timeout, redirect refused, connect, tls, dns, network, body), or refused (the send-time guard refused the target; nothing was sent or signed). Append-only (trigger); cascades from its delivery at the 90-day retention. A partner delivery''s attempts carry the originating tenant_id and endpoint_kind partner; the tenant realm sees tenant rows only (RLS).';

CREATE OR REPLACE FUNCTION webhook_delivery_attempts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.delivery_created_at < now() - interval '90 days' THEN
    RETURN OLD;                                   -- the retention cascade from a ≥ 90-day delivery
  END IF;
  RAISE EXCEPTION 'webhook_delivery_attempts is append-only (an attempt that happened stays recorded for 90 days)' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS trg_wda_append_only ON webhook_delivery_attempts;
CREATE TRIGGER trg_wda_append_only BEFORE UPDATE OR DELETE ON webhook_delivery_attempts FOR EACH ROW EXECUTE FUNCTION webhook_delivery_attempts_append_only();
CREATE OR REPLACE FUNCTION webhook_delivery_attempts_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'webhook_delivery_attempts is append-only (no TRUNCATE)' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS trg_wda_no_truncate ON webhook_delivery_attempts;
CREATE TRIGGER trg_wda_no_truncate BEFORE TRUNCATE ON webhook_delivery_attempts FOR EACH STATEMENT EXECUTE FUNCTION webhook_delivery_attempts_no_truncate();

ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_delivery_attempts_read ON webhook_delivery_attempts;
DROP POLICY IF EXISTS webhook_delivery_attempts_insert_own ON webhook_delivery_attempts;
DROP POLICY IF EXISTS webhook_delivery_attempts_update_own ON webhook_delivery_attempts;
DROP POLICY IF EXISTS webhook_delivery_attempts_admin_realm ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_read        ON webhook_delivery_attempts FOR SELECT USING (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_delivery_attempts_insert_own  ON webhook_delivery_attempts FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_delivery_attempts_update_own  ON webhook_delivery_attempts FOR UPDATE USING (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant') WITH CHECK (tenant_id = current_tenant_id() AND endpoint_kind = 'tenant');
CREATE POLICY webhook_delivery_attempts_admin_realm ON webhook_delivery_attempts FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON webhook_delivery_attempts FROM PUBLIC, kv_app, kv_relay, kv_readonly;
GRANT SELECT ON webhook_delivery_attempts TO kv_app;                      -- the log reads; nothing in the tenant realm writes an attempt
GRANT SELECT, INSERT ON webhook_delivery_attempts TO kv_relay;            -- the worker records; the cascade deletes as the owner
GRANT SELECT ON webhook_delivery_attempts TO kv_readonly, kv_admin;

-- ------------------------------------------------------------------------------------------------------------------
-- 191.4  webhook_delivery_targets — the worker's one join, now with kind, status and the rotation pair
-- ------------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS webhook_delivery_targets;
CREATE VIEW webhook_delivery_targets WITH (security_invoker = true) AS
  SELECT id, url, secret_enc, is_active, tenant_id AS owner_tenant_id, NULL::uuid AS owner_partner_id,
         'tenant'::text AS kind, status::text AS status, paused_reason::text AS paused_reason,
         secret_enc_prev, prev_expires_at, developer_email::text AS developer_email, created_by, deleted_at
    FROM webhook_endpoints
  UNION ALL
  SELECT id, url, secret_enc::text, is_active, NULL::uuid, partner_id,
         'partner'::text, CASE WHEN is_active AND deleted_at IS NULL THEN 'active' ELSE 'paused' END, NULL::text,
         NULL::text, NULL::timestamptz, NULL::text, NULL::uuid, deleted_at
    FROM partner_webhook_endpoints;
COMMENT ON VIEW webhook_delivery_targets IS
  'PC-55 A10 (0090), recreated by PC-56 TENANT-13a (0191): every endpoint the delivery worker can send to — tenant endpoints and partner endpoints — with kind, status and the 24 h rotation pair. security_invoker: the caller''s own privileges and RLS apply. kv_relay only.';
REVOKE ALL ON webhook_delivery_targets FROM PUBLIC, kv_app, kv_readonly, kv_admin;
GRANT SELECT ON webhook_delivery_targets TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 191.5  F-23 — cross-realm reads by kv_app
-- ------------------------------------------------------------------------------------------------------------------
-- Verified before revoking: the only reader of partner_webhook_endpoints in apps/api is PartnerApiRepository.activeEndpointsForPartner,
-- called only by PartnerWebhookFanoutHandler, which runs inside the outbox relay's transaction on the relay pool (kv_relay).
REVOKE SELECT ON partner_webhook_endpoints FROM kv_app;
-- tenant_flag_context ran with its owner's rights, so kv_app could read every tenant's plan code. With invoker rights the
-- subscriptions table's own RLS confines it to the caller's tenant; core/feature-flags/flags.service reads it inside a
-- one-statement transaction with app.tenant_id set to the tenant being evaluated.
ALTER VIEW tenant_flag_context SET (security_invoker = true);

-- ------------------------------------------------------------------------------------------------------------------
-- 191.6  PERMISSION api.manage (also seed 0004)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('api.manage', 'Developer settings: webhook endpoints (URLs, secrets, pause / resume / rotate / delete) and the delivery log with payloads — tenant_admin', NULL)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'api.manage' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 191.7  NOTIFICATION CATALOGUE — the developer contact (and whoever added the endpoint) hear that it paused
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('webhooks.endpoint_paused', 'A webhook endpoint was paused after repeated failed deliveries (or disabled by the target guard)', 'important', '["email","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 191.8  RETENTION — 90 days of deliveries (and, by cascade, their attempts)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE data_retention_policies ADD COLUMN IF NOT EXISTS active_days integer;
ALTER TABLE data_retention_policies DROP CONSTRAINT IF EXISTS ck_drp_active_days;
ALTER TABLE data_retention_policies ADD CONSTRAINT ck_drp_active_days CHECK (active_days IS NULL OR active_days > 0);
COMMENT ON COLUMN data_retention_policies.active_days IS
  'PC-56 TENANT-13a (0191): when set, the retention enforcer keeps this many DAYS (overrides active_months, which stays as the coarse figure for readers). A delete rule with neither a positive active_days nor a positive active_months is erasure-scoped (0107: "once the person is gone") and is NOT a time sweep.';
INSERT INTO data_retention_policies (table_name, active_months, active_days, legal_basis, action, is_active)
SELECT 'webhook_deliveries', 3, 90, 'W189 delivery log — 90 days of payloads; webhook_delivery_attempts cascade', 'delete', true
 WHERE NOT EXISTS (SELECT 1 FROM data_retention_policies WHERE table_name = 'webhook_deliveries');

-- ------------------------------------------------------------------------------------------------------------------
-- 191.9  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_whd_due          ON webhook_deliveries (next_retry_at, created_at) WHERE state IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_whd_tenant_list  ON webhook_deliveries (tenant_id, created_at DESC, id DESC) WHERE endpoint_kind = 'tenant';
CREATE INDEX IF NOT EXISTS idx_whd_endpoint     ON webhook_deliveries (endpoint_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_wda_tenant_time  ON webhook_delivery_attempts (tenant_id, created_at DESC) WHERE endpoint_kind = 'tenant';
CREATE INDEX IF NOT EXISTS idx_wda_endpoint     ON webhook_delivery_attempts (endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wda_delivery     ON webhook_delivery_attempts (delivery_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_whe_tenant_live  ON webhook_endpoints (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
