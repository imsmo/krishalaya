-- ==================================================================================================================
-- MIGRATION 0193 — PC-56 TENANT-13c · TENANT API KEYS & INTEGRATIONS
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0002, 0014, 0090, 0123, 0191, 0192 are applied; nothing here
-- edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (brief_t13c.md, 2026-10-03): READ SCOPES + NARROW WRITES under `api.manage`; member-PII and money-write
-- scopes need a checker. INTEGRATIONS = credentials verified against the provider BEFORE vaulting; a platform allow-list of
-- tenant-ownable providers; DIRECT SETTLEMENT REFUSED BY NAME.
--
-- WHAT WAS WRONG (survey_t13.md):
--   F-9  `api_keys` (0002) had no issuer, no guard, no reader: a table and a canon screen with nothing behind either. Its
--        `key_prefix` (varchar(12)) carried no UNIQUE index, so a prefix lookup could not even be well-defined; its revocation
--        CHECK (0123) was NOT VALID; nothing recorded who created a key, whether a second person agreed to a member-data scope,
--        or when a key expires.
--   F-8  a tenant's "connected" provider was vaulted BEFORE the provider was checked (an unknown code orphaned a real secret),
--        nothing verified the credential, nothing read it — while the console badged it "active" and promised "direct
--        settlement" — and a tenant could attach a credential to a platform-managed government feed or the sandbox gateway.
--   F-21 `POST /integrations` demanded an Idempotency-Key and never used it.
--
-- WHAT THIS FILE DOES
--   193.1  api_scope_catalogue — the tenant key scopes, ONLY scopes that map to routes that exist today (the TypeScript
--          catalogue `modules/tenant-api-keys/domain/api-scopes.ts` is byte-equal in substance; a live spec compares them).
--          Global lookup: SELECT for the app roles, written by migrations only.
--   193.2  api_keys — key_prefix widened to varchar(24) and made UNIQUE (duplicates, if any, are renamed apart and revoked
--          first, with a NOTICE); `created_by` FK; `checker_user_id`, `activated_at`, `revoked_by`, `expires_at`;
--          rate_per_hour 1..10 000; the 0123 revocation CHECK backfilled and VALIDATED. The trigger `trg_api_keys_rules`:
--          a key is born by an active tenant_admin with a well-formed prefix and a sha256 hash, scopes a non-empty set from
--          the catalogue, born ACTIVE only when no scope needs a checker; what was issued is immutable; revocation is
--          permanent; a checker-scope key is ACTIVATED only by a confirmed proposal whose confirmer is not its creator.
--          `api_key_for_prefix(prefix)` (SECURITY DEFINER, one row, no tenant needed — the guard's ONE lookup) and
--          `api_key_touch(id)` (last_used_at, debounced >= 60 s IN THE DATABASE).
--   193.3  api_key_proposals — the maker-checker carrier for checker-scope keys (13b shape: born proposed by the key's
--          creator; confirmed / refused by a DIFFERENT active tenant_admin, in their own session, before expiry; 7 days).
--   193.4  integration_providers — `tenant_ownable`, `verify_method`, `verify_url`, `credential_fields`; gupshup and inaph
--          added; razorpay / gupshup / inaph ownable; every other provider (agmarknet, pfms, pmkisan, ikhedut, msg91,
--          razorpayx, sandbox) platform-managed.
--   193.5  tenant_integrations — `status` (unverified | verified | verify_failed | disconnected), `verified_at`,
--          `verify_result` (masked), `last_checked_at`, disconnect who/when/why. `trg_tenant_integrations_gate`: only an
--          ownable provider; a credential, an activation or a disconnection is written ONLY in the transaction that applies a
--          CONFIRMED proposal for the same tenant, provider and kind (`app.integration_proposal_id`).
--   193.6  integration_proposals — connect / rotate / disconnect; the candidate credential is held ENVELOPE-SEALED (bound to
--          the proposal row) only while the proposal is open and wiped when it closes; maker ≠ checker by trigger; ONE
--          in-flight proposal per tenant and provider (partial unique index — "never parallelize provider changes").
--   193.7  integration_verify_checks — every verification ping of a connection's credential (apply + daily), append-only:
--          the Health (24 h) column is a COUNT of these, never a percentage of calls nobody measures.
--   193.8  the flag `tenant_api` (default OFF; also seed 0009) — the key console AND key authentication.
--   193.9  walls — kv_relay loses its writes on api_keys and tenant_integrations (no relay writer; grep in the report);
--          kv_readonly never reads a key hash or a secret ref.
--   193.10 indexes.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 193.1  api_scope_catalogue
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_scope_catalogue (
  code        varchar(40) PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  kind        varchar(5)  NOT NULL CHECK (kind IN ('read', 'write')),
  checker     boolean     NOT NULL,
  description text        NOT NULL CHECK (length(btrim(description)) BETWEEN 10 AND 300),
  routes      jsonb       NOT NULL CHECK (jsonb_typeof(routes) = 'array' AND jsonb_array_length(routes) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE api_scope_catalogue IS
  'PC-56 TENANT-13c (0193). The tenant API key scopes: ONLY scopes that map to v1 routes that exist today, each read or write, each saying whether a second tenant_admin must confirm a key that carries it (member PII; any money write). Mirrors modules/tenant-api-keys/domain/api-scopes.ts (a live spec compares them). Written by migrations only.';

INSERT INTO api_scope_catalogue (code, kind, checker, description, routes) VALUES
  ('orders.read',            'read',  false, 'Read your organisation''s orders: the console list, one order, its items and its event history.',
   '["GET /v1/orders/console/list","GET /v1/orders/:id","GET /v1/orders/:id/items","GET /v1/orders/:id/events"]'),
  ('orders.status.write',    'write', false, 'Move an order through the status steps the console already exposes: confirm, packed, ready, delivered.',
   '["POST /v1/orders/:id/confirm","POST /v1/orders/:id/packed","POST /v1/orders/:id/ready","POST /v1/orders/:id/delivered"]'),
  ('listings.read',          'read',  false, 'Read your organisation''s marketplace listings and one listing''s price history.',
   '["GET /v1/listings","GET /v1/listings/:id","GET /v1/listings/:id/price-history"]'),
  ('listings.write',         'write', false, 'Create a listing (your own, or a member''s on their recorded consent) and change a listing''s price.',
   '["POST /v1/listings","POST /v1/listings/on-behalf","PATCH /v1/listings/:id/price"]'),
  ('members.read',           'read',  false, 'Read the member roster MASKED: short name and masked phone; no phone-number search.',
   '["GET /v1/members/roster","GET /v1/members/roster/:userId"]'),
  ('members.read.pii',       'read',  true,  'Reveal one member''s field (phone, address) — recorded and reasoned per reveal. A second administrator must confirm the key.',
   '["POST /v1/members/roster/:userId/reveal"]'),
  ('payments.summary.read',  'read',  false, 'Read settlement cycles and the organisation statement summary — totals only, never an account number.',
   '["GET /v1/settlements","GET /v1/settlements/org-statement"]'),
  ('statements.read',        'read',  false, 'Read generated settlement statements.',
   '["GET /v1/settlement-statements","GET /v1/settlement-statements/:id","GET /v1/settlements/statements"]'),
  ('invoices.read',          'read',  false, 'Read tax invoices: the list, one invoice, and the invoice of one order.',
   '["GET /v1/invoices","GET /v1/invoices/:id","GET /v1/invoices/order/:orderId"]'),
  ('webhooks.read',          'read',  false, 'Read your webhook endpoints and their delivery log (payloads masked).',
   '["GET /v1/webhooks","GET /v1/webhooks/deliveries","GET /v1/webhooks/deliveries/:id"]'),
  ('dairy.collections.read', 'read',  false, 'Read milk collections recorded at your centres.',
   '["GET /v1/dairy/collections"]'),
  ('labour.bookings.read',   'read',  false, 'Read labour bookings and one booking.',
   '["GET /v1/labour/bookings","GET /v1/labour/bookings/:id"]')
ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, checker = EXCLUDED.checker, description = EXCLUDED.description, routes = EXCLUDED.routes;

REVOKE ALL ON api_scope_catalogue FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON api_scope_catalogue TO kv_app, kv_relay, kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.2  api_keys — the credential realm
-- ------------------------------------------------------------------------------------------------------------------
-- (a) the prefix is the lookup handle and must be unique. Dedupe first: every duplicate but the newest is renamed apart
--     (its handle can never be presented again) and revoked with a reason. Dev and every scratch DB: 0 rows (nothing ever
--     wrote this table — 0123's own finding), so the block reports 0.
ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE varchar(24);
DO $$
DECLARE n int;
BEGIN
  WITH d AS (
    SELECT id, row_number() OVER (PARTITION BY key_prefix ORDER BY created_at DESC, id DESC) AS rn FROM api_keys)
  UPDATE api_keys k
     SET key_prefix = left(k.key_prefix, 15) || '~' || left(replace(k.id::text, '-', ''), 8),
         revoked_at = COALESCE(k.revoked_at, now()),
         revoked_reason = COALESCE(k.revoked_reason, 'duplicate key prefix — retired by migration 0193 so the prefix lookup is unique'),
         updated_at = now()
    FROM d WHERE d.id = k.id AND d.rn > 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0193: api_keys duplicate prefixes retired: %', n;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_prefix ON api_keys (key_prefix);

-- (b) new columns
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS checker_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS activated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by      uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz;
-- created_by exists (add_std_columns, 0002) without a reference; give it one (NOT VALID + VALIDATE: no row has a value).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_api_keys_created_by') THEN
    ALTER TABLE api_keys ADD CONSTRAINT fk_api_keys_created_by FOREIGN KEY (created_by) REFERENCES users(id) NOT VALID;
  END IF;
END $$;
ALTER TABLE api_keys VALIDATE CONSTRAINT fk_api_keys_created_by;

-- (c) legacy rows (none in dev): a key that existed before this file was issued by nobody this realm knows, so it is not
--     activated, and a revoked one without a reason gets the reason it never had.
UPDATE api_keys SET revoked_reason = 'revoked before migration 0193 — no reason was recorded' WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL;
ALTER TABLE api_keys VALIDATE CONSTRAINT ck_api_keys_revocation_recorded;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_api_keys_rate') THEN
    ALTER TABLE api_keys ADD CONSTRAINT ck_api_keys_rate CHECK (rate_per_hour BETWEEN 1 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_api_keys_expiry') THEN
    ALTER TABLE api_keys ADD CONSTRAINT ck_api_keys_expiry CHECK (expires_at IS NULL OR expires_at > created_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_api_keys_checker_whole') THEN
    -- a checker is recorded only together with the activation it made
    ALTER TABLE api_keys ADD CONSTRAINT ck_api_keys_checker_whole CHECK (checker_user_id IS NULL OR activated_at IS NOT NULL);
  END IF;
END $$;
COMMENT ON COLUMN api_keys.key_prefix IS 'PC-56 TENANT-13c (0193): the lookup handle `kv_live_<8 [a-z0-9]>`, UNIQUE. The secret half is never stored; key_hash = sha256(secret) hex.';
COMMENT ON COLUMN api_keys.activated_at IS 'PC-56 TENANT-13c (0193): when the key became usable — at birth when no scope needs a checker; at the confirmation of its proposal otherwise. NULL = waiting for a second administrator.';
COMMENT ON COLUMN api_keys.last_used_at IS 'PC-56 TENANT-13c (0193): stamped by the key guard through api_key_touch(), at most once per 60 s per key.';

CREATE OR REPLACE FUNCTION api_key_scope_problem(p_scopes jsonb) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb; seen text[] := '{}';
BEGIN
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array' OR jsonb_array_length(p_scopes) = 0 THEN
    RETURN 'scopes must be a non-empty array';
  END IF;
  IF jsonb_array_length(p_scopes) > 20 THEN RETURN 'at most 20 scopes'; END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(p_scopes) LOOP
    IF jsonb_typeof(s) <> 'string' THEN RETURN 'every scope is a string'; END IF;
    IF NOT EXISTS (SELECT 1 FROM api_scope_catalogue c WHERE c.code = s #>> '{}') THEN
      RETURN format('%s is not in the scope catalogue', s #>> '{}');
    END IF;
    IF (s #>> '{}') = ANY (seen) THEN RETURN format('%s is listed twice', s #>> '{}'); END IF;
    seen := seen || (s #>> '{}');
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION api_key_needs_checker(p_scopes jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_scopes, '[]'::jsonb)) s
                   JOIN api_scope_catalogue c ON c.code = s WHERE c.checker)
$$;

CREATE OR REPLACE FUNCTION assert_api_key_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); problem text; needs boolean;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '[API_KEY_NEVER_DELETED] an API key is revoked, never deleted — its row is the record of what it could do — PC-56 TENANT-13c' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.key_prefix !~ '^kv_live_[a-z0-9]{8}$' THEN
      RAISE EXCEPTION '[API_KEY_PREFIX] a key prefix is kv_live_ + 8 of [a-z0-9] — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.key_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION '[API_KEY_HASH] a key is stored as the sha256 hex of its secret, never the secret — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    problem := api_key_scope_problem(NEW.scopes);
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_SCOPES] % — PC-56 TENANT-13c', problem USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by IS NULL OR NOT kv_is_tenant_admin(NEW.tenant_id, NEW.created_by) THEN
      RAISE EXCEPTION '[API_KEY_CREATOR_NOT_ADMIN] only an active tenant_admin creates an API key — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.created_by <> me THEN
      RAISE EXCEPTION '[API_KEY_NOT_YOURS] a key is created in its creator''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL OR NEW.checker_user_id IS NOT NULL OR NEW.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_BORN_FRESH] a key is born unrevoked, unchecked and unused — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    needs := api_key_needs_checker(NEW.scopes);
    IF needs AND NEW.activated_at IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_NEEDS_CHECKER] a key with a member-data or money-write scope is born WAITING for a second administrator — PC-56 TENANT-13c maker-checker' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT needs AND NEW.activated_at IS NULL THEN
      RAISE EXCEPTION '[API_KEY_BORN_ACTIVE] a key without a checker scope is active at birth — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: what was issued is final.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.key_prefix <> OLD.key_prefix OR NEW.key_hash <> OLD.key_hash
     OR NEW.scopes <> OLD.scopes OR NEW.rate_per_hour <> OLD.rate_per_hour OR NEW.name <> OLD.name
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION '[API_KEY_ISSUED_FINAL] what key % was issued with is final — issue a new key instead — PC-56 TENANT-13c', OLD.key_prefix USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.checker_user_id IS DISTINCT FROM OLD.checker_user_id) THEN
    RAISE EXCEPTION '[API_KEY_REVOKED_FINAL] key % is revoked; revocation is permanent — PC-56 TENANT-13c', OLD.key_prefix USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.activated_at IS NOT NULL AND (NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.checker_user_id IS DISTINCT FROM OLD.checker_user_id) THEN
    RAISE EXCEPTION '[API_KEY_ACTIVATION_FINAL] the activation of key % is final — PC-56 TENANT-13c', OLD.key_prefix USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.activated_at IS NULL AND NEW.activated_at IS NOT NULL THEN
    -- the ONE way a waiting key becomes usable: a confirmed proposal for THIS key, by a DIFFERENT person, recorded as its checker
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_REVOKED_FINAL] a revoked key is never activated — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.checker_user_id IS NULL OR NEW.checker_user_id = OLD.created_by
       OR NOT EXISTS (SELECT 1 FROM api_key_proposals p
                       WHERE p.api_key_id = OLD.id AND p.status = 'confirmed' AND p.confirmed_by = NEW.checker_user_id
                         AND p.proposed_by = OLD.created_by AND p.confirmed_by <> p.proposed_by) THEN
      RAISE EXCEPTION '[API_KEY_CHECKER_REQUIRED] key % carries a checker scope and becomes usable only through a proposal a second administrator confirmed — PC-56 TENANT-13c maker-checker', OLD.key_prefix
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND (NEW.revoked_reason IS NULL OR length(btrim(NEW.revoked_reason)) < 5) THEN
    RAISE EXCEPTION '[API_KEY_REVOKE_REASON] a revocation carries its reason — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at AND NEW.last_used_at IS NOT NULL AND OLD.last_used_at IS NOT NULL
     AND NEW.last_used_at < OLD.last_used_at + interval '60 seconds' THEN
    RAISE EXCEPTION '[API_KEY_TOUCH_DEBOUNCE] last_used_at moves at most once a minute — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_api_keys_rules ON api_keys;
CREATE TRIGGER trg_api_keys_rules BEFORE INSERT OR UPDATE OR DELETE ON api_keys FOR EACH ROW EXECUTE FUNCTION assert_api_key_rules();
DROP TRIGGER IF EXISTS trg_api_keys_no_truncate ON api_keys;
CREATE TRIGGER trg_api_keys_no_truncate BEFORE TRUNCATE ON api_keys FOR EACH STATEMENT EXECUTE FUNCTION assert_api_key_rules();

-- The guard's ONE lookup. A presented key has a prefix and no tenant yet — and api_keys is FORCE'd RLS on the tenant — so
-- the lookup is a definer-rights function that returns EXACTLY one row for one exact prefix (never a scan, never a list):
-- the hash to compare in constant time, and the facts the guard judges. Never the hash of any other key.
CREATE OR REPLACE FUNCTION api_key_for_prefix(p_prefix varchar)
RETURNS TABLE (id uuid, tenant_id uuid, key_hash varchar, scopes jsonb, rate_per_hour int, activated_at timestamptz,
               revoked_at timestamptz, revoked_reason varchar, expires_at timestamptz, created_by uuid, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.tenant_id, k.key_hash, k.scopes, k.rate_per_hour, k.activated_at, k.revoked_at, k.revoked_reason, k.expires_at,
         k.created_by, t.status::text
    FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
   WHERE k.key_prefix = p_prefix AND k.deleted_at IS NULL AND p_prefix ~ '^kv_live_[a-z0-9]{8}$'
$$;
REVOKE ALL ON FUNCTION api_key_for_prefix(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_for_prefix(varchar) TO kv_app;
COMMENT ON FUNCTION api_key_for_prefix(varchar) IS
  'PC-56 TENANT-13c (0193): the tenant key guard''s one lookup — one exact, well-formed prefix → that key''s hash and state. Definer rights because the tenant is not known until the key is.';

-- last_used_at, debounced IN THE DATABASE: a stamp moves only when the previous one is at least 60 s old, so a burst of a
-- thousand calls writes one row once a minute and a read API never becomes a write API.
CREATE OR REPLACE FUNCTION api_key_touch(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE api_keys SET last_used_at = now()
   WHERE id = p_id AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= now() - interval '60 seconds');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION api_key_touch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_touch(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.3  api_key_proposals — the checker for member-data / money-write scopes
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_key_proposals (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  api_key_id     uuid NOT NULL UNIQUE REFERENCES api_keys(id),
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by    uuid NOT NULL REFERENCES users(id),
  proposed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  status         varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by   uuid REFERENCES users(id),
  confirmed_at   timestamptz,
  refused_by     uuid REFERENCES users(id),
  refused_at     timestamptz,
  refuse_reason  text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  expired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_akp_confirm_whole CHECK ((status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT ck_akp_refused_whole CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_akp_expired_whole CHECK ((status = 'expired') = (expired_at IS NOT NULL))
  -- maker ≠ checker is ONE wall, the trigger below — not a second CHECK that would hide the trigger's removal.
);
COMMENT ON TABLE api_key_proposals IS
  'PC-56 TENANT-13c (0193). A key carrying a checker scope (member PII; any money write) is issued WAITING: its creator sees it once and PROPOSES it with a reason; a DIFFERENT active tenant_admin CONFIRMS (trg_akp_moves) — which is the only thing that may activate the key (trg_api_keys_rules) — or REFUSES it with a reason (the key is revoked); unconfirmed after 7 days it EXPIRES (the key is revoked).';

CREATE OR REPLACE FUNCTION assert_api_key_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); k record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'api_key_proposals is append-only — PC-56 TENANT-13c' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.expired_at IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_BORN_PROPOSED] a key proposal is born proposed — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, created_by, activated_at, revoked_at INTO k FROM api_keys WHERE id = NEW.api_key_id;
    IF NOT FOUND OR k.tenant_id <> NEW.tenant_id OR k.created_by <> NEW.proposed_by OR k.activated_at IS NOT NULL OR k.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_KEY] a proposal names a waiting key its proposer created — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_EXPIRY] a key proposal expires 7 days after it is made — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.api_key_id <> OLD.api_key_id OR NEW.reason <> OLD.reason
     OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[API_KEY_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-13c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[API_KEY_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-13c', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[API_KEY_CHECKER_IS_MAKER] the person who created key proposal % cannot also confirm it — a second administrator — PC-56 TENANT-13c maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[API_KEY_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-13c', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[API_KEY_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF NEW.expired_at < OLD.expires_at THEN
      RAISE EXCEPTION '[API_KEY_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-13c', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[API_KEY_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13c', NEW.status USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_akp_moves ON api_key_proposals;
CREATE TRIGGER trg_akp_moves BEFORE INSERT OR UPDATE OR DELETE ON api_key_proposals FOR EACH ROW EXECUTE FUNCTION assert_api_key_proposal_moves();
DROP TRIGGER IF EXISTS trg_akp_no_truncate ON api_key_proposals;
CREATE TRIGGER trg_akp_no_truncate BEFORE TRUNCATE ON api_key_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_api_key_proposal_moves();

ALTER TABLE api_key_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS akp_read ON api_key_proposals;
DROP POLICY IF EXISTS akp_insert_own ON api_key_proposals;
DROP POLICY IF EXISTS akp_update_own ON api_key_proposals;
DROP POLICY IF EXISTS akp_admin_realm ON api_key_proposals;
CREATE POLICY akp_read        ON api_key_proposals FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY akp_insert_own  ON api_key_proposals FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY akp_update_own  ON api_key_proposals FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY akp_admin_realm ON api_key_proposals FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON api_key_proposals FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON api_key_proposals TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON api_key_proposals TO kv_app;
GRANT SELECT ON api_key_proposals TO kv_readonly;

-- api_keys: the app may create a key, revoke it, and activate it (the trigger above decides when); nothing else. Never DELETE.
-- last_used_at is written only through api_key_touch(). kv_relay has no business with credentials (no relay writer).
REVOKE INSERT, UPDATE, DELETE ON api_keys FROM kv_app;
GRANT INSERT ON api_keys TO kv_app;
GRANT UPDATE (revoked_at, revoked_reason, revoked_by, activated_at, checker_user_id, updated_at) ON api_keys TO kv_app;
REVOKE INSERT, UPDATE, DELETE ON api_keys FROM kv_relay;
REVOKE SELECT ON api_keys FROM kv_readonly;
GRANT SELECT (id, tenant_id, name, key_prefix, scopes, rate_per_hour, last_used_at, revoked_at, revoked_reason, created_at,
              updated_at, deleted_at, created_by, checker_user_id, activated_at, revoked_by, expires_at) ON api_keys TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.4  integration_providers — the platform allow-list of tenant-ownable providers
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS tenant_ownable    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verify_method     varchar(20),
  ADD COLUMN IF NOT EXISTS verify_url        varchar(300),
  ADD COLUMN IF NOT EXISTS credential_fields jsonb NOT NULL DEFAULT '[]';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_integration_providers_verify') THEN
    ALTER TABLE integration_providers ADD CONSTRAINT ck_integration_providers_verify CHECK (
      (verify_method IS NULL OR verify_method IN ('account_fetch', 'balance_profile', 'token_check'))
      AND (NOT tenant_ownable OR verify_method IS NOT NULL)
      AND (verify_url IS NULL OR verify_url ~ '^https://[a-z0-9.-]+(:443)?/')
      AND jsonb_typeof(credential_fields) = 'array');
  END IF;
END $$;
COMMENT ON COLUMN integration_providers.tenant_ownable IS
  'PC-56 TENANT-13c (0193, founder decision): a tenant may connect its OWN credential only for an ownable provider. Platform-managed feeds (agmarknet, pfms, pmkisan, ikhedut), the platform SMS route (msg91), payouts (razorpayx) and the sandbox gateway are not.';
COMMENT ON COLUMN integration_providers.verify_url IS
  'PC-56 TENANT-13c (0193): the provider endpoint a credential is verified against BEFORE it is vaulted (HTTPS, port 443, no redirects, 10 s). NULL on an ownable provider = no verification endpoint is configured on this platform, so a credential for it cannot be verified and is refused by name — never stored unverified.';

-- The fresh-DB seed order runs migrations before seeds, so the rows this file classifies are upserted here (the 0056a/0123
-- precedent); seed 0010's ON CONFLICT DO NOTHING keeps them.
INSERT INTO integration_providers (code, default_name, category, is_active, tenant_ownable, verify_method, verify_url, credential_fields) VALUES
  ('razorpay', 'Razorpay', 'payment', true, true, 'account_fetch', 'https://api.razorpay.com/v1/payments?count=1',
   '[{"name":"keyId","secret":false,"pattern":"^rzp_(live|test)_[A-Za-z0-9]{8,32}$"},{"name":"keySecret","secret":true,"pattern":"^[A-Za-z0-9]{16,64}$"}]'),
  ('gupshup', 'Gupshup (WhatsApp Business + SMS)', 'sms', true, true, 'balance_profile', 'https://api.gupshup.io/sm/api/v2/wallet/balance',
   '[{"name":"apiKey","secret":true,"pattern":"^[A-Za-z0-9]{16,64}$"},{"name":"senderId","secret":false,"pattern":"^[A-Z]{6}$"}]'),
  ('inaph', 'INAPH animal registry (NDDB)', 'government', true, true, 'token_check', NULL,
   '[{"name":"token","secret":true,"pattern":"^[A-Za-z0-9._-]{16,512}$"}]')
ON CONFLICT (code) DO UPDATE SET tenant_ownable = EXCLUDED.tenant_ownable, verify_method = EXCLUDED.verify_method,
  verify_url = EXCLUDED.verify_url, credential_fields = EXCLUDED.credential_fields, updated_at = now();
UPDATE integration_providers SET tenant_ownable = false, verify_method = NULL, verify_url = NULL, credential_fields = '[]', updated_at = now()
 WHERE code NOT IN ('razorpay', 'gupshup', 'inaph') AND tenant_ownable;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.6 (before 193.5, which references it)  integration_proposals
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_proposals (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  provider_code     varchar(60) NOT NULL REFERENCES integration_providers(code),
  kind              varchar(10) NOT NULL CHECK (kind IN ('connect', 'rotate', 'disconnect')),
  credential_sealed text,
  credential_hint   varchar(12),
  config            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  shadow_result     jsonb,
  reason            text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by       uuid NOT NULL REFERENCES users(id),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  status            varchar(13) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'applied', 'verify_failed', 'refused', 'expired')),
  confirmed_by      uuid REFERENCES users(id),
  confirmed_at      timestamptz,
  outcome           jsonb,
  closed_at         timestamptz,
  refused_by        uuid REFERENCES users(id),
  refuse_reason     text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 20 AND 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- the candidate credential exists only while the proposal is open, and never on a disconnect
  CONSTRAINT ck_ip_credential_open   CHECK (credential_sealed IS NULL OR status IN ('proposed', 'confirmed')),
  CONSTRAINT ck_ip_credential_kind   CHECK (kind <> 'disconnect' OR (credential_sealed IS NULL AND credential_hint IS NULL)),
  CONSTRAINT ck_ip_confirm_whole     CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT ck_ip_confirmed         CHECK (status NOT IN ('confirmed', 'applied', 'verify_failed') OR confirmed_by IS NOT NULL),
  CONSTRAINT ck_ip_refused_whole     CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_ip_closed_whole      CHECK ((status IN ('proposed', 'confirmed')) = (closed_at IS NULL))
);
-- "Never parallelize provider changes": ONE in-flight proposal per tenant and provider.
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_proposals_in_flight ON integration_proposals (tenant_id, provider_code) WHERE status IN ('proposed', 'confirmed');
COMMENT ON TABLE integration_proposals IS
  'PC-56 TENANT-13c (0193, founder decision: credentials verified before vaulting; owner + checker). A connect / rotate / disconnect is PROPOSED by a tenant_admin with a reason (the candidate credential is verified in shadow at once and held envelope-sealed, bound to this row); a DIFFERENT active tenant_admin CONFIRMS (trg_ip_moves); the credential is verified AGAIN and only on success vaulted and written (applied) — a failed verify closes it verify_failed with nothing vaulted and nothing written; or it is REFUSED with a reason; unconfirmed after 7 days it EXPIRES. Closing wipes the sealed credential.';

CREATE OR REPLACE FUNCTION assert_integration_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); p record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'integration_proposals is append-only — PC-56 TENANT-13c' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.outcome IS NOT NULL THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_BORN_PROPOSED] an integration proposal is born proposed — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_ownable, is_active INTO p FROM integration_providers WHERE code = NEW.provider_code;
    IF NOT FOUND OR NOT p.tenant_ownable OR NOT p.is_active THEN
      RAISE EXCEPTION '[INTEGRATION_PROVIDER_NOT_OWNABLE] % is platform-managed — a tenant cannot attach its own credential to it — PC-56 TENANT-13c', NEW.provider_code
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IN ('connect', 'rotate') AND NEW.credential_sealed IS NULL THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_CREDENTIAL] a connect or rotate carries the candidate credential (sealed) — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IN ('connect', 'rotate') AND (NEW.shadow_result IS NULL OR (NEW.shadow_result ->> 'ok') IS DISTINCT FROM 'true') THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_UNVERIFIED] a credential that did not verify in shadow is never held — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose a provider change — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.provider_code <> OLD.provider_code OR NEW.kind <> OLD.kind
     OR NEW.config <> OLD.config OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at OR NEW.credential_hint IS DISTINCT FROM OLD.credential_hint
     OR NEW.shadow_result IS DISTINCT FROM OLD.shadow_result
     OR (NEW.credential_sealed IS NOT NULL AND NEW.credential_sealed IS DISTINCT FROM OLD.credential_sealed) THEN
    RAISE EXCEPTION '[INTEGRATION_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-13c', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('applied', 'verify_failed', 'refused', 'expired') THEN
    RAISE EXCEPTION '[INTEGRATION_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-13c', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'confirmed' THEN
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_FINAL] the confirmation of % is final — PC-56 TENANT-13c', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('applied', 'verify_failed') THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_MOVE] confirmed -> % is not a move — PC-56 TENANT-13c', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome IS NULL THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_OUTCOME] a confirmed proposal closes with its verification outcome — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- OLD.status = 'proposed'
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[INTEGRATION_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second administrator — PC-56 TENANT-13c maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[INTEGRATION_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-13c', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_MOVE] a refused proposal carries no confirmation — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[INTEGRATION_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF NEW.closed_at < OLD.expires_at THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-13c', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[INTEGRATION_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13c', NEW.status USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_ip_moves ON integration_proposals;
CREATE TRIGGER trg_ip_moves BEFORE INSERT OR UPDATE OR DELETE ON integration_proposals FOR EACH ROW EXECUTE FUNCTION assert_integration_proposal_moves();
DROP TRIGGER IF EXISTS trg_ip_no_truncate ON integration_proposals;
CREATE TRIGGER trg_ip_no_truncate BEFORE TRUNCATE ON integration_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_integration_proposal_moves();

ALTER TABLE integration_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ip_read ON integration_proposals;
DROP POLICY IF EXISTS ip_insert_own ON integration_proposals;
DROP POLICY IF EXISTS ip_update_own ON integration_proposals;
DROP POLICY IF EXISTS ip_admin_realm ON integration_proposals;
CREATE POLICY ip_read        ON integration_proposals FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY ip_insert_own  ON integration_proposals FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ip_update_own  ON integration_proposals FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ip_admin_realm ON integration_proposals FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON integration_proposals FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON integration_proposals TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, credential_sealed, outcome, closed_at, refused_by, refuse_reason) ON integration_proposals TO kv_app;
-- kv_readonly reads the proposal history, never the sealed credential
GRANT SELECT (id, tenant_id, provider_code, kind, credential_hint, config, shadow_result, reason, proposed_by, proposed_at, expires_at, status,
              confirmed_by, confirmed_at, outcome, closed_at, refused_by, refuse_reason, created_at) ON integration_proposals TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.5  tenant_integrations — honest status and the proposal wall
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenant_integrations
  ADD COLUMN IF NOT EXISTS status            varchar(13) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS verify_result     jsonb,
  ADD COLUMN IF NOT EXISTS last_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS credential_hint   varchar(12),
  ADD COLUMN IF NOT EXISTS disconnected_at   timestamptz,
  ADD COLUMN IF NOT EXISTS disconnected_by   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS disconnect_reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_integrations_status') THEN
    ALTER TABLE tenant_integrations ADD CONSTRAINT ck_tenant_integrations_status CHECK (status IN ('unverified', 'verified', 'verify_failed', 'disconnected'));
  END IF;
END $$;
-- Legacy rows (dev: 0): a connection made before this file was never verified (it says so: `unverified`) — the daily check
-- verifies it; an inactive one is `disconnected`.
UPDATE tenant_integrations SET status = 'disconnected', disconnected_at = COALESCE(disconnected_at, updated_at),
       disconnect_reason = COALESCE(disconnect_reason, 'disconnected before migration 0193 — no reason was recorded')
 WHERE NOT is_active AND status <> 'disconnected';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_integrations_disconnect_whole') THEN
    ALTER TABLE tenant_integrations ADD CONSTRAINT ck_tenant_integrations_disconnect_whole CHECK (
      (status = 'disconnected') = (NOT is_active) AND (status <> 'disconnected' OR (disconnected_at IS NOT NULL AND disconnect_reason IS NOT NULL)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION assert_tenant_integration_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := current_setting('app.integration_proposal_id', true); p record; ownable boolean; kinds text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[INTEGRATION_NEVER_DELETED] a connection is disconnected, never deleted — PC-56 TENANT-13c' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_ownable INTO ownable FROM integration_providers WHERE code = NEW.provider_code;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.provider_code <> OLD.provider_code) THEN
    RAISE EXCEPTION '[INTEGRATION_IDENTITY_FINAL] a connection never changes tenant or provider — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
  END IF;
  -- Which kind of change is this? A credential (connect/rotate), a (re)activation (connect), a disconnection.
  IF TG_OP = 'INSERT' THEN
    kinds := ARRAY['connect'];
  ELSIF NEW.is_active AND NOT OLD.is_active THEN
    kinds := ARRAY['connect'];
  ELSIF NEW.secret_ref IS DISTINCT FROM OLD.secret_ref THEN
    kinds := ARRAY['connect', 'rotate'];
  ELSIF OLD.is_active AND NOT NEW.is_active THEN
    kinds := ARRAY['disconnect'];
  ELSIF NEW.config IS DISTINCT FROM OLD.config OR NEW.credential_hint IS DISTINCT FROM OLD.credential_hint
        OR NEW.disconnected_at IS DISTINCT FROM OLD.disconnected_at OR NEW.disconnected_by IS DISTINCT FROM OLD.disconnected_by
        OR NEW.disconnect_reason IS DISTINCT FROM OLD.disconnect_reason THEN
    kinds := ARRAY['connect', 'rotate', 'disconnect'];
  ELSE
    -- a verification result (status verified / verify_failed, verified_at, verify_result, last_checked_at): the daily check
    IF NEW.status = 'disconnected' AND OLD.status <> 'disconnected' THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_REQUIRED] a disconnection is written only by a confirmed proposal — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'disconnected' AND NEW.status <> 'disconnected' THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_REQUIRED] a disconnected provider is reconnected only by a confirmed proposal — PC-56 TENANT-13c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF 'disconnect' <> ALL (kinds) OR TG_OP = 'INSERT' THEN
    IF NOT COALESCE(ownable, false) THEN
      RAISE EXCEPTION '[INTEGRATION_PROVIDER_NOT_OWNABLE] % is platform-managed — a tenant cannot attach its own credential to it — PC-56 TENANT-13c', NEW.provider_code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF current_user IN ('kv_app', 'kv_relay') THEN
    IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_REQUIRED] a provider credential, connection or disconnection is written only by a proposal a second administrator confirmed — PC-56 TENANT-13c maker-checker'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, provider_code, kind, status, proposed_by, confirmed_by INTO p FROM integration_proposals WHERE id = pid::uuid;
    IF NOT FOUND OR p.tenant_id <> NEW.tenant_id OR p.provider_code <> NEW.provider_code OR p.status <> 'confirmed'
       OR p.confirmed_by IS NULL OR p.confirmed_by = p.proposed_by OR NOT (p.kind = ANY (kinds)) THEN
      RAISE EXCEPTION '[INTEGRATION_PROPOSAL_REQUIRED] proposal % does not authorise this change to % — PC-56 TENANT-13c maker-checker', pid, NEW.provider_code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tenant_integrations_gate ON tenant_integrations;
CREATE TRIGGER trg_tenant_integrations_gate BEFORE INSERT OR UPDATE OR DELETE ON tenant_integrations FOR EACH ROW EXECUTE FUNCTION assert_tenant_integration_gate();

REVOKE INSERT, UPDATE, DELETE ON tenant_integrations FROM kv_relay;
REVOKE SELECT ON tenant_integrations FROM kv_readonly;
GRANT SELECT (id, tenant_id, provider_code, config, is_active, created_at, updated_at, deleted_at, created_by, updated_by, status,
              verified_at, verify_result, last_checked_at, credential_hint, disconnected_at, disconnected_by, disconnect_reason) ON tenant_integrations TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.7  integration_verify_checks — the Health (24 h) source
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_verify_checks (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  integration_id uuid NOT NULL REFERENCES tenant_integrations(id),
  provider_code  varchar(60) NOT NULL REFERENCES integration_providers(code),
  kind           varchar(6)  NOT NULL CHECK (kind IN ('apply', 'daily')),
  ok             boolean     NOT NULL,
  error_class    varchar(8)  CHECK (error_class IN ('auth', 'network', 'unknown')),
  detail         varchar(200),
  duration_ms    integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  checked_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ivc_class CHECK (ok = (error_class IS NULL))
);
COMMENT ON TABLE integration_verify_checks IS
  'PC-56 TENANT-13c (0193). Every verification of a connection''s vaulted credential against its provider: at apply (connect / rotate) and by the daily job. Append-only. The console''s Health (24 h) is "N checks · last OK <time>" from these rows — never a percentage of calls no platform path makes.';
CREATE OR REPLACE FUNCTION integration_verify_checks_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_verify_checks is append-only — PC-56 TENANT-13c (0193)' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_ivc_append_only ON integration_verify_checks;
CREATE TRIGGER trg_ivc_append_only BEFORE UPDATE OR DELETE ON integration_verify_checks FOR EACH ROW EXECUTE FUNCTION integration_verify_checks_append_only();
DROP TRIGGER IF EXISTS trg_ivc_no_truncate ON integration_verify_checks;
CREATE TRIGGER trg_ivc_no_truncate BEFORE TRUNCATE ON integration_verify_checks FOR EACH STATEMENT EXECUTE FUNCTION integration_verify_checks_append_only();
ALTER TABLE integration_verify_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_verify_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ivc_read ON integration_verify_checks;
DROP POLICY IF EXISTS ivc_insert_own ON integration_verify_checks;
DROP POLICY IF EXISTS ivc_admin_realm ON integration_verify_checks;
CREATE POLICY ivc_read        ON integration_verify_checks FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY ivc_insert_own  ON integration_verify_checks FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ivc_admin_realm ON integration_verify_checks FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON integration_verify_checks FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON integration_verify_checks TO kv_app;
GRANT SELECT ON integration_verify_checks TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 193.8  the flag (also seed 0009) — default OFF
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'tenant_api',
       'PC-56 TENANT-13c. Tenant API keys: the developer console (W190) AND key authentication on the catalogue routes. Also needs the api_access plan feature. OFF until enabled; while off a key answers 404 and the console prints Flagged off.',
       false, 100, '{}'
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'tenant_api');

-- ------------------------------------------------------------------------------------------------------------------
-- 193.10 indexes
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_created ON api_keys (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_proposals_tenant ON api_key_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_proposals_due ON api_key_proposals (expires_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_integration_proposals_tenant ON integration_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_integration_proposals_due ON integration_proposals (expires_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_integration_verify_checks_recent ON integration_verify_checks (tenant_id, integration_id, checked_at DESC);
