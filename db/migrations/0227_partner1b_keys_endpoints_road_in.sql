-- ==================================================================================================================
-- MIGRATION 0227 — PC-56 PARTNER-1b · KEYS, ENDPOINTS AND THE ROAD IN — a partner reads its OWN API keys, webhook endpoints and
-- deliveries on the kv_partner axis, and a partner administrator REVOKES one of its own keys with a reason. Nothing else is writable.
-- (brief_p1b.md founder decisions D1 + D2 + D5, 2026-10-18; survey_partner1.md §1D, §1E, F-5, B6, B7, §5.3.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0226 are applied; nothing here edits them. 0090's tables, role, axis GUC
-- and REVOKEs are REUSED, never loosened: kv_app keeps exactly 0090's `UPDATE (last_used_at, updated_at)` on partner_api_keys and nothing
-- more; kv_partner gains NO table privilege on partner_api_keys or partner_webhook_endpoints — only EXECUTE on four definers.)
-- LAW 9 / LAW 11 CLASS — SECRETS: the first request-path WRITE to a credential table (the revoke — the safe direction: a key can only be
-- switched OFF, never on, never minted, never re-scoped). The S2 review (PC55_A10 notes §6) is owed before `partner_api` is switched on; the
-- PARTNER-0 review is owed before `partner_console` is switched on. NOT MONEY: no ledger table, no posting, no money column is written here.
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   227.1  partner_api_keys + `revoked_reason varchar(300)` (the partner administrator's own words, 20–300 characters) and
--          `revoked_by_user_id uuid` (the partner person who revoked — no FK, the house `*_by_*_id` convention for an actor column written
--          across realms, e.g. `api_keys.revoked_by_admin_id` (0123, no FK) and `partner_invites.invited_by_admin_id` (0226, no FK)).
--          CHECKs: a reason or a revoker exists only on a revoked key, and a reason is 20–300 characters.
--   227.2  `partner_console_revoke_key(key uuid, reason text, by_user uuid) RETURNS jsonb` — SECURITY DEFINER, EXECUTE to kv_partner ONLY.
--          It refuses (each BY NAME, `[CODE] …`, the 0225 convention the API maps to a typed 4xx):
--            [PARTNER_KEY_NOT_FOUND]        no partner in scope (current_partner_id() IS NULL), or the key is not THIS partner's (the service
--                                           answers 404 — never "not yours"), or no such key;
--            [PARTNER_KEY_REASON_REQUIRED]  the reason is not 20–300 characters after whitespace is collapsed;
--            [PARTNER_PERMISSION_MISSING]   `by_user` holds no ACTIVE membership of THIS partner whose role carries `partner.keys.revoke`;
--            [PARTNER_KEY_ALREADY_REVOKED]  the key is revoked already (revocation is permanent; there is no un-revoke path);
--          and otherwise sets revoked_at = now(), is_active = false, revoked_reason, revoked_by_user_id, updated_at — NOTHING ELSE, EVER: no
--          INSERT, no scope, no rate, no name, no un-revoke. Answers { id, keyPrefix, revokedAt } (never the hash).
--   227.3  THE READS ON THE AXIS WITHOUT OPENING THE TABLES (the 0090 `partner_owns_insurance_policy` precedent; kv_app reaches them only
--          inside `SET LOCAL ROLE kv_partner` — the non-inheriting grant of 0090):
--            partner_console_keys()        this partner's keys — every column EXCEPT key_hash (and partner_id, which is the caller's own);
--            partner_console_endpoints()   this partner's endpoints — every column EXCEPT secret_enc;
--            partner_owns_endpoint(id)     yes / no: is this endpoint THIS partner's (the deliveries policy's oracle).
--          All three NULL-guarded: with app.partner_id unset they answer nothing / false.
--   227.4  DELIVERIES on the axis: kv_partner gains a COLUMN-LEVEL SELECT on webhook_deliveries (never `payload`, never `tenant_id` — the
--          originating tenant is the TENANT's transparency, not the partner's) and on webhook_delivery_attempts (never `tenant_id`), and two
--          role-scoped policies:
--            webhook_deliveries_partner_read          SELECT TO kv_partner  partner kind AND partner_owns_endpoint(endpoint_id)
--            webhook_delivery_attempts_partner_read   SELECT TO kv_partner  partner kind AND partner_owns_endpoint(endpoint_id)
--          then `t12_resync_children('webhook_deliveries', …)` so every existing partition (the 14 monthly + default) carries the parent's
--          policies; ensure_partitions copies them onto every future one (0190 / 0203). webhook_delivery_attempts is not partitioned.
--   227.5  RBAC (founder D2 "delivery history visible to all partner staff"; brief §C (1) "GET /v1/partner/keys as A's viewer"): the READ
--          permissions `partner.keys.read` and `partner.webhooks.read` are granted to partner_checker, partner_maker and partner_viewer.
--          `partner.keys.revoke` stays with partner_admin ONLY. (0225 gave the two reads to partner_admin alone; seed core/0004 is NOT edited —
--          it inserts the 0225 rows where missing and never deletes, so this file's rows stand on every database built from empty.)
--
-- WHAT THIS FILE DOES NOT DO (named): no new flag (`partner_console` gates the console; `partner_api` stays OFF and untouched); no INSERT or
-- re-scope path for a key; no endpoint write (add / rotate / activate / pause / replay / ping stay with platform operations); no RLS change on
-- partner_api_keys or partner_webhook_endpoints (the relay's `activeEndpointsForPartner` reads endpoints as kv_relay, the worker reads the
-- `webhook_delivery_targets` view as kv_relay — neither is touched); no outbox event for a revoke (a `partner.key_revoked` event would need a
-- handler and the relay gate — named in the wave report); no grant to kv_admin, kv_relay or kv_readonly.
--
-- REVERSAL (hand-run, never by the runner; revert the API's partner-console keys / webhooks / readiness routes first):
--   DELETE FROM role_permissions rp USING roles r WHERE rp.role_id = r.id AND r.scope = 'partner'
--     AND rp.permission_code IN ('partner.keys.read','partner.webhooks.read')
--     AND NOT EXISTS (SELECT 1 FROM role_permissions a WHERE a.role_id = r.id AND a.permission_code = 'partner.keys.revoke');   -- (the administrator keeps 0225's)
--   DROP POLICY IF EXISTS webhook_deliveries_partner_read ON webhook_deliveries;            -- then CALL t12_resync_children('webhook_deliveries', 'webhook_deliveries_partner_read');
--   DROP POLICY IF EXISTS webhook_delivery_attempts_partner_read ON webhook_delivery_attempts;
--   REVOKE SELECT ON webhook_deliveries, webhook_delivery_attempts FROM kv_partner;          -- (the column grants)
--   DROP FUNCTION IF EXISTS partner_console_revoke_key(uuid, text, uuid), partner_console_keys(), partner_console_endpoints(), partner_owns_endpoint(uuid);
--   ALTER TABLE partner_api_keys DROP CONSTRAINT IF EXISTS ck_pak_revoked_reason, DROP CONSTRAINT IF EXISTS ck_pak_revoked_by,
--     DROP COLUMN IF EXISTS revoked_reason, DROP COLUMN IF EXISTS revoked_by_user_id;     -- (the reasons written are lost; the audit rows keep them)
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 227.1  WHY A KEY WAS REVOKED, AND BY WHOM (partner realm)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE partner_api_keys ADD COLUMN IF NOT EXISTS revoked_reason varchar(300);
ALTER TABLE partner_api_keys ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid;
ALTER TABLE partner_api_keys DROP CONSTRAINT IF EXISTS ck_pak_revoked_reason;
ALTER TABLE partner_api_keys ADD CONSTRAINT ck_pak_revoked_reason CHECK (
  revoked_reason IS NULL OR (revoked_at IS NOT NULL AND char_length(btrim(revoked_reason)) BETWEEN 20 AND 300));
ALTER TABLE partner_api_keys DROP CONSTRAINT IF EXISTS ck_pak_revoked_by;
ALTER TABLE partner_api_keys ADD CONSTRAINT ck_pak_revoked_by CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL);
COMMENT ON COLUMN partner_api_keys.revoked_reason IS
  'PC-56 PARTNER-1b (0227, founder D1): the partner administrator''s reason (20–300 characters) when the key was revoked from the partner '
  'console (partner_console_revoke_key). NULL for a key revoked by the mint script or the admin realm (their reason lives in their audit row).';
COMMENT ON COLUMN partner_api_keys.revoked_by_user_id IS
  'PC-56 PARTNER-1b (0227): the partner person who revoked the key from the console (users.id; no FK — the house *_by_*_id actor convention). '
  'NULL for a revocation by the mint script or the admin realm.';

-- ------------------------------------------------------------------------------------------------------------------
-- 227.2  THE REVOKE — inside the partner axis, the key must be THIS partner's, and nothing but the revocation moves
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_console_revoke_key(p_key_id uuid, p_reason text, p_by_user uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_partner uuid := current_partner_id();
  v_reason  text := btrim(regexp_replace(COALESCE(p_reason, ''), '\s+', ' ', 'g'));
  v_key     record;
  v_at      timestamptz;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION '[PARTNER_KEY_NOT_FOUND] no partner is in scope — PC-56 PARTNER-1b' USING ERRCODE = 'no_data_found';
  END IF;
  IF char_length(v_reason) < 20 OR char_length(v_reason) > 300 THEN
    RAISE EXCEPTION '[PARTNER_KEY_REASON_REQUIRED] a reason of 20–300 characters is required — PC-56 PARTNER-1b' USING ERRCODE = 'check_violation';
  END IF;
  IF p_by_user IS NULL OR NOT EXISTS (
       SELECT 1 FROM partner_memberships m JOIN role_permissions rp ON rp.role_id = m.role_id
        WHERE m.partner_id = v_partner AND m.user_id = p_by_user AND m.is_active AND m.deleted_at IS NULL
          AND rp.permission_code = 'partner.keys.revoke') THEN
    RAISE EXCEPTION '[PARTNER_PERMISSION_MISSING] only a person of this partner whose role may revoke keys revokes one — PC-56 PARTNER-1b' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT pk.id, pk.key_prefix, pk.revoked_at
    INTO v_key
    FROM partner_api_keys pk
   WHERE pk.id = p_key_id
     AND pk.partner_id = v_partner
     AND pk.deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[PARTNER_KEY_NOT_FOUND] no such key in this partner organisation — PC-56 PARTNER-1b' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_key.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION '[PARTNER_KEY_ALREADY_REVOKED] this key is revoked already — revocation is permanent — PC-56 PARTNER-1b' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE partner_api_keys
     SET revoked_at = now(), is_active = false, revoked_reason = v_reason, revoked_by_user_id = p_by_user, updated_at = now()
   WHERE partner_api_keys.id = v_key.id
  RETURNING partner_api_keys.revoked_at INTO v_at;
  RETURN jsonb_build_object('id', v_key.id, 'keyPrefix', v_key.key_prefix, 'revokedAt', v_at);
END $$;
REVOKE ALL ON FUNCTION partner_console_revoke_key(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_console_revoke_key(uuid, text, uuid) TO kv_partner;
COMMENT ON FUNCTION partner_console_revoke_key(uuid, text, uuid) IS
  'PC-56 PARTNER-1b (0227, founder D1): a partner administrator revokes ONE of its own keys with a reason. Runs inside the partner axis '
  '(kv_partner, app.partner_id from the verified token). Refuses by name: PARTNER_KEY_NOT_FOUND (no partner / not this partner''s / absent), '
  'PARTNER_KEY_REASON_REQUIRED, PARTNER_PERMISSION_MISSING, PARTNER_KEY_ALREADY_REVOKED. Writes revoked_at, is_active=false, revoked_reason, '
  'revoked_by_user_id, updated_at — nothing else.';

-- ------------------------------------------------------------------------------------------------------------------
-- 227.3  THE READS — never key_hash, never secret_enc
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_console_keys() RETURNS TABLE (
  id uuid, name text, key_prefix text, scopes jsonb, rate_limit_per_hour integer, is_active boolean,
  last_used_at timestamptz, revoked_at timestamptz, revoked_reason text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.name::text, k.key_prefix::text, k.scopes, k.rate_limit_per_hour, k.is_active,
         k.last_used_at, k.revoked_at, k.revoked_reason::text, k.created_at
    FROM partner_api_keys k
   WHERE current_partner_id() IS NOT NULL
     AND k.partner_id = current_partner_id()
     AND k.deleted_at IS NULL
   ORDER BY k.created_at DESC, k.id DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION partner_console_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_console_keys() TO kv_partner;

CREATE OR REPLACE FUNCTION partner_console_endpoints() RETURNS TABLE (
  id uuid, url text, event_types jsonb, is_active boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.url::text, e.event_types, e.is_active, e.created_at
    FROM partner_webhook_endpoints e
   WHERE current_partner_id() IS NOT NULL
     AND e.partner_id = current_partner_id()
     AND e.deleted_at IS NULL
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 100;
$$;
REVOKE ALL ON FUNCTION partner_console_endpoints() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_console_endpoints() TO kv_partner;

CREATE OR REPLACE FUNCTION partner_owns_endpoint(p_endpoint_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM partner_webhook_endpoints e
     WHERE e.id = p_endpoint_id
       AND current_partner_id() IS NOT NULL
       AND e.partner_id = current_partner_id());
$$;
REVOKE ALL ON FUNCTION partner_owns_endpoint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_owns_endpoint(uuid) TO kv_partner;

-- ------------------------------------------------------------------------------------------------------------------
-- 227.4  DELIVERIES AND ATTEMPTS ON THE AXIS — never the payload, never the originating tenant
-- ------------------------------------------------------------------------------------------------------------------
GRANT SELECT (id, endpoint_id, event_type, endpoint_kind, state, attempt, status_code, succeeded, retry_step, created_at, delivered_at,
              last_attempt_at, last_error, replay_count, replayed_at)
  ON webhook_deliveries TO kv_partner;
GRANT SELECT (id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, status_code, duration_ms, error,
              signed_at, signatures, created_at)
  ON webhook_delivery_attempts TO kv_partner;

DROP POLICY IF EXISTS webhook_deliveries_partner_read ON webhook_deliveries;
CREATE POLICY webhook_deliveries_partner_read ON webhook_deliveries FOR SELECT TO kv_partner
  USING (current_partner_id() IS NOT NULL
         AND endpoint_kind = 'partner'
         AND partner_owns_endpoint(endpoint_id));
DROP POLICY IF EXISTS webhook_delivery_attempts_partner_read ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_partner_read ON webhook_delivery_attempts FOR SELECT TO kv_partner
  USING (current_partner_id() IS NOT NULL
         AND endpoint_kind = 'partner'
         AND partner_owns_endpoint(endpoint_id));

-- the partitions take the parent's policy set (0190's procedure; 0191:233 is the same call)
CALL t12_resync_children('webhook_deliveries', 'webhook_deliveries_partner_read');

-- ------------------------------------------------------------------------------------------------------------------
-- 227.5  RBAC — the two READS for every partner role; the revoke stays the administrator's
-- ------------------------------------------------------------------------------------------------------------------
-- Every role of scope 'partner' (0225 created the four; the administrator already holds both reads — ON CONFLICT is its no-op). Bound by SCOPE,
-- not by role codes, and asserted loudly: a grant that silently matched no role would grant nothing (the tenant4d5 chain-repair lesson).
DO $$
BEGIN
  IF (SELECT count(*) FROM roles WHERE scope = 'partner') < 4 THEN
    RAISE EXCEPTION '0227: the four partner roles of 0225 are missing — the reads would grant nothing';
  END IF;
END $$;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code IN ('partner.keys.read', 'partner.webhooks.read')
 WHERE r.scope = 'partner'
ON CONFLICT DO NOTHING;
UPDATE permissions SET default_name = 'Partner console: revoke one of this partner''s API keys with a reason (partner_admin)'
 WHERE code = 'partner.keys.revoke';
UPDATE permissions SET default_name = 'Partner console: read this partner''s webhook endpoints and deliveries (never a secret, never a payload)'
 WHERE code = 'partner.webhooks.read';
