-- ==================================================================================================================
-- MIGRATION 0245 — PC-56 DPDP-1 · AN ERASURE REQUEST NOW ERASES THE PERSON (launch blocker 8).
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. Nothing here edits an applied file: it widens one column, adds
-- columns and one status to `data_subject_requests`, two columns to `media_assets`, re-creates three guard functions with
-- ONE added clause each (injected, asserted), adds four functions, one notification catalogue row and grants. NOT MONEY:
-- no ledger, wallet, payment amount or price row is written, and a non-zero balance BLOCKS an erasure — it is never zeroed.
-- ==================================================================================================================
--
-- WHAT WAS TRUE (0107 §4 said it in capitals): `apps/worker/.../dpdp-erasure-cooling.job.ts` moved an erasure request whose 90-day
-- cooling ended to `in_progress` and wrote `identity.erasure_ready` — and NOTHING consumed it. Requests sat `in_progress` forever.
--
-- WHAT IS TRUE NOW (founder decisions DPDP-1, delegated to the lead, final):
--   245.1  `users.phone` varchar(20) → varchar(64): an erased person's row stays (every FK points at it) and becomes a tombstone whose
--          phone is the deterministic, non-reversible `erased:<user uuid>` — unique because the uuid is, and not a phone anybody can sign
--          in with. Widening a varchar is a catalogue-only change (no rewrite); no view depends on the column (checked).
--   245.2  `data_subject_requests`: status `blocked` (an erasure whose person still has an open order, a non-zero wallet balance, an open
--          dispute, an active loan, a pending payout, a listing under auction, or is the last administrator of a partner / a member of a
--          government authority) + `blocked_reasons` (machine-readable codes), `blocked_at`, `completed_at`, `erasure_summary` (counts
--          per data class — the regulator's evidence, no personal data), `erasure_attempts`, `last_attempt_at`. The SLA index now counts a
--          blocked request as live (it is: the person is waiting).
--   245.3  `media_assets.storage_purge_requested_at` + `storage_purge_reason`: THE PLATFORM HAS NO STORAGE-DELETE PATH (core/media
--          presigns PUT and GET only; no job deletes an S3 object). An erased person's photos, KYC scans, voice notes and listing images are
--          soft-deleted (no download URL is ever presigned again — `MediaRepository.getVisible` now filters `deleted_at`) and their
--          storage deletion is RECORDED AS PENDING here, with its reason, for the purge job that does not exist yet. Stated, not faked.
--   245.4  Three "moves" guards (0199 staff invites, 0225/0226 partner invites, 0200/0203 setup-call requests) made the person's phone
--          (or its masked tail and a free-text note) immutable, so erasure could never remove it. Each now admits ONE extra move: on a
--          row that is no longer pending, the phone becomes the sentinel and nothing else changes — and only when the person it belongs
--          to is already an erased tombstone (`kv_dsr_is_erased`, a fact the erasure function sets first in the same transaction). The
--          clause is injected at the top of each function's body and the injection is asserted, so a drifted body fails this migration
--          instead of silently skipping the clause. The sentinel `+10000000000` satisfies the E.164 CHECK and is no subscriber's number
--          (NANP area code 000 is never assigned).
--   245.5  THE EXECUTOR — four SECURITY DEFINER functions (the 0213/0214 wall: `SET search_path = public`, REVOKE FROM PUBLIC):
--            kv_dsr_erasure_figures(p_user)          internal — the blocker COUNTS (no amounts leave it). EXECUTE to nobody.
--            kv_dsr_erasure_claim(p_dsr)             locks the request + the person; returns status, cooling end, figures.
--            kv_dsr_erasure_block(p_dsr, reasons, t) records a blocked attempt; tells the person ONCE per new set of reasons
--                                                    (outbox `identity.erasure_blocked` → notification `dsr.erasure_blocked`).
--            kv_dsr_erasure_execute(p_dsr, t)        re-checks every blocker (fails closed), de-identifies the person per the
--                                                    matrix (apps/api/src/modules/identity/README.md § "DPDP erasure"), writes one
--                                                    `dsr_erasure_actions` evidence row per data class, one `audit_log` row (actor
--                                                    'system', no personal data), and completes the request with its summary.
--                                                    A completed request is a no-op on every later call (idempotent).
--          GRANT EXECUTE on the three callable ones TO kv_relay ONLY — the role the outbox relay runs every handler as (HOTFIX-2). kv_relay
--          gains NO table privilege: the whole de-identification happens behind this one wall, as the function owner. kv_app gets nothing:
--          the request tier must never be able to erase a person.
--   245.6  `notification_events` `dsr.erasure_blocked` (important, push + in-app, not opt-out-able — it is the answer to the person's own
--          legal request). Templates en/hi/gu live in seed core/0007 above its version backfill (the 0218 pattern).
--
-- NO KILL-SWITCH (Law 10, the 0214/0223 precedent): erasure is a statutory right under DPDP s.12; a flag that could switch it off would be a
-- switch that suspends the law. The executor's safety comes from the blockers, the cooling window and the fail-closed re-check instead.
--
-- RLS / GRANTS: no table is created (the RLS gate's count does not move). The functions read and write across organisations as their
-- OWNER, so — as for 0213/0214 — the production migration owner must bypass RLS (ops owed, unchanged). kv_relay: EXECUTE on three
-- functions; nothing else. Partition pass (Law 8): `messages` is narrowed through the person's conversations (its partitions are found by
-- conversation); `notifications`, `login_events`, `risk_events` and `idempotency_keys` are reached by their `user_id` indexes — an erasure
-- is a once-per-person act, so a per-partition index probe is the right cost.
--
-- REVERSAL (documented, not automatic — an executed erasure itself is irreversible by design):
--   DROP FUNCTION kv_dsr_erasure_execute(uuid, uuid); DROP FUNCTION kv_dsr_erasure_block(uuid, text[], uuid);
--   DROP FUNCTION kv_dsr_erasure_claim(uuid); DROP FUNCTION kv_dsr_erasure_figures(uuid);
--   re-create the three guard functions from 0199 / 0226 / 0203 (their clause is a no-op unless a person was erased);
--   DELETE FROM notification_templates WHERE event_code='dsr.erasure_blocked'; DELETE FROM notification_events WHERE code='dsr.erasure_blocked';
--   the new columns are nullable/defaulted and may stay; `blocked` may be removed from the CHECK only after no row holds it.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 245.1  the tombstone phone fits
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE users ALTER COLUMN phone TYPE varchar(64);
COMMENT ON COLUMN users.phone IS
  'E.164 sign-in phone, unique. PC-56 DPDP-1 (0245): an ERASED person''s row keeps its id (every FK) and carries the placeholder '
  '`erased:<id>` here — deterministic, unique, not reversible and not a number anybody can sign in with.';

-- ------------------------------------------------------------------------------------------------------------------
-- 245.2  the request can say it is blocked, and what it did
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE data_subject_requests DROP CONSTRAINT IF EXISTS data_subject_requests_status_check;
ALTER TABLE data_subject_requests ADD CONSTRAINT data_subject_requests_status_check
  CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'rejected'));
ALTER TABLE data_subject_requests
  ADD COLUMN IF NOT EXISTS blocked_reasons  jsonb,
  ADD COLUMN IF NOT EXISTS blocked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS erasure_summary  jsonb,
  ADD COLUMN IF NOT EXISTS erasure_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz;
-- A blocked request names why; nothing else carries reasons. A completed erasure carries its summary and its time.
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_blocked_has_reasons CHECK (
  (status = 'blocked') = (blocked_reasons IS NOT NULL)
  AND (blocked_reasons IS NULL OR (jsonb_typeof(blocked_reasons) = 'array' AND jsonb_array_length(blocked_reasons) > 0))
);
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_summary_only_when_completed CHECK (
  erasure_summary IS NULL OR (status = 'completed' AND completed_at IS NOT NULL)
);
ALTER TABLE data_subject_requests ADD CONSTRAINT ck_dsr_attempts_nonneg CHECK (erasure_attempts >= 0);
COMMENT ON COLUMN data_subject_requests.blocked_reasons IS
  'PC-56 DPDP-1 (0245): machine-readable codes for why an erasure cannot run yet (open_orders, wallet_balance, open_disputes, active_loans, '
  'pending_payouts, listings_under_auction, sole_partner_admin, authority_membership). Non-NULL exactly when status = blocked. Re-checked hourly.';
COMMENT ON COLUMN data_subject_requests.erasure_summary IS
  'PC-56 DPDP-1 (0245): what the executor did — per data class: action + row count; media pending storage purge; no personal data. '
  'The evidence a regulator reads, alongside dsr_erasure_actions.';

DROP INDEX IF EXISTS idx_dsr_open_sla;
CREATE INDEX idx_dsr_open_sla ON data_subject_requests (created_at)
  WHERE status IN ('open', 'in_progress', 'blocked') AND deleted_at IS NULL;
-- The hourly re-drive reads live erasures whose cooling ended.
CREATE INDEX IF NOT EXISTS idx_dsr_erasure_redrive ON data_subject_requests (last_attempt_at)
  WHERE request_type = 'erasure' AND status IN ('in_progress', 'blocked') AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 245.3  storage deletion is recorded as pending (no purge path exists yet)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS storage_purge_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_purge_reason       varchar(40);
ALTER TABLE media_assets ADD CONSTRAINT ck_media_purge_pair CHECK (
  (storage_purge_requested_at IS NULL) = (storage_purge_reason IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_media_storage_purge_pending ON media_assets (storage_purge_requested_at)
  WHERE storage_purge_requested_at IS NOT NULL;
COMMENT ON COLUMN media_assets.storage_purge_requested_at IS
  'PC-56 DPDP-1 (0245): the object at s3_key must be DELETED from storage (reason in storage_purge_reason, e.g. dsr_erasure). The row is '
  'soft-deleted and never presigned again; NO JOB DELETES THE OBJECT YET — core/media has no DeleteObject path. This column is the queue '
  'that job will drain.';

-- ------------------------------------------------------------------------------------------------------------------
-- 245.4  an erased person's phone may leave the three guarded tables
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_dsr_is_erased(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_user AND u.status = 'soft_deleted' AND u.phone = 'erased:' || u.id::text);
$$;
COMMENT ON FUNCTION kv_dsr_is_erased(uuid) IS
  'PC-56 DPDP-1 (0245): true when the person is an erasure tombstone. Read by three guard triggers to admit the one erasure move.';
REVOKE ALL ON FUNCTION kv_dsr_is_erased(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_dsr_is_erased(uuid) TO kv_app, kv_relay, kv_admin;   -- triggers run as the writing role

DO $inject$
DECLARE
  v_def text; v_new text;
  v_anchor constant text := 'IF TG_OP = ''DELETE'' THEN';
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('assert_staff_invite_moves',
     $c$-- PC-56 DPDP-1 (0245): an erased person's phone leaves a used invite; nothing else may change in the same write.
  IF TG_OP = 'UPDATE' AND NEW.phone = '+10000000000' AND OLD.phone <> '+10000000000' AND OLD.status <> 'pending'
     AND kv_dsr_is_erased(OLD.accepted_user_id)
     AND (to_jsonb(NEW) - 'phone' - 'updated_at') = (to_jsonb(OLD) - 'phone' - 'updated_at') THEN
    NEW.updated_at := now(); RETURN NEW;
  END IF;
  $c$),
    ('assert_partner_invite_moves',
     $c$-- PC-56 DPDP-1 (0245): an erased person's phone leaves a used invite; nothing else may change in the same write.
  IF TG_OP = 'UPDATE' AND NEW.phone = '+10000000000' AND OLD.phone <> '+10000000000' AND OLD.status <> 'pending'
     AND kv_dsr_is_erased(OLD.accepted_user_id)
     AND (to_jsonb(NEW) - 'phone' - 'updated_at') = (to_jsonb(OLD) - 'phone' - 'updated_at') THEN
    NEW.updated_at := now(); RETURN NEW;
  END IF;
  $c$),
    ('assert_setup_call_moves',
     $c$-- PC-56 DPDP-1 (0245): an erased requester's masked phone tail and free-text note leave the request; nothing else changes.
  IF TG_OP = 'UPDATE' AND NEW.phone_masked = '••••0000' AND NEW.notes IS NULL
     AND (OLD.phone_masked <> '••••0000' OR OLD.notes IS NOT NULL)
     AND kv_dsr_is_erased(OLD.requested_by)
     AND (to_jsonb(NEW) - 'phone_masked' - 'notes' - 'updated_at') = (to_jsonb(OLD) - 'phone_masked' - 'notes' - 'updated_at') THEN
    NEW.updated_at := now(); RETURN NEW;
  END IF;
  $c$)
  ) AS t(fn, clause) LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    IF position('PC-56 DPDP-1 (0245)' IN v_def) > 0 THEN CONTINUE; END IF;          -- re-run safe
    IF position(v_anchor IN v_def) = 0 THEN
      RAISE EXCEPTION '0245: % no longer opens with its DELETE refusal — re-derive the erasure clause by hand', r.fn;
    END IF;
    v_new := regexp_replace(v_def, 'IF TG_OP = ''DELETE'' THEN', r.clause || v_anchor);   -- first occurrence only
    EXECUTE v_new;
    IF position('PC-56 DPDP-1 (0245)' IN pg_get_functiondef(r.fn::regproc)) = 0 THEN
      RAISE EXCEPTION '0245: the erasure clause did not land in %', r.fn;
    END IF;
  END LOOP;
END
$inject$;

-- ------------------------------------------------------------------------------------------------------------------
-- 245.5  the executor
-- ------------------------------------------------------------------------------------------------------------------

-- What stands between the person and erasure, as COUNTS (no amount leaves this function). Every key is a blocker when non-zero;
-- apps/api `erasureBlockers()` maps them to the reason codes the person is told (and fails closed on an unknown key).
CREATE OR REPLACE FUNCTION kv_dsr_erasure_figures(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    -- an order the person is party to (buyer OR seller) that has not closed — 0214's closed set
    'open_orders', (SELECT count(*) FROM orders o
                     WHERE (o.buyer_user_id = p_user OR o.seller_user_id = p_user)
                       AND o.status NOT IN ('completed', 'cancelled', 'refunded')),
    -- ANY of the person's own wallet accounts (main, hold, cash-in-hand…) with a non-zero cached balance: withdrawable OR held money
    'wallet_balance', (SELECT count(*) FROM wallet_accounts w
                        WHERE w.owner_kind = 'user' AND w.owner_user_id = p_user AND w.deleted_at IS NULL AND w.cached_balance_minor <> 0),
    'open_disputes', (SELECT count(*) FROM disputes d
                       WHERE (d.raised_by = p_user OR d.against_user = p_user) AND d.deleted_at IS NULL
                         AND d.status IN ('open', 'seller_responded', 'under_review', 'escalated')),
    'active_loans', (SELECT count(*) FROM loans l
                      WHERE l.borrower_user_id = p_user AND l.deleted_at IS NULL AND l.status IN ('active', 'overdue', 'restructured')),
    'pending_payouts', (SELECT count(*) FROM payouts p
                         WHERE p.user_id = p_user AND p.deleted_at IS NULL AND p.status IN ('queued', 'processing')),
    -- produce under auction cannot be pulled from under the bidders (listing.state.ts) — the auction must end first
    'listings_under_auction', (SELECT count(*) FROM listings l
                                WHERE l.seller_user_id = p_user AND l.deleted_at IS NULL AND l.status = 'reserved_auction'),
    -- the last administrator of a partner organisation (0225's guard would refuse the removal; a partner must appoint another first)
    'sole_partner_admin', (SELECT count(*) FROM partner_memberships m JOIN roles r ON r.id = m.role_id
                            WHERE m.user_id = p_user AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin'
                              AND NOT EXISTS (SELECT 1 FROM partner_memberships m2 JOIN roles r2 ON r2.id = m2.role_id
                                               WHERE m2.partner_id = m.partner_id AND m2.id <> m.id AND m2.is_active
                                                 AND m2.deleted_at IS NULL AND r2.code = 'partner_admin')),
    -- a government authority's membership is removed by the authority (GOV-0's guard); erasure does not reach into a ministry
    'authority_membership', (SELECT count(*) FROM authority_memberships a
                              WHERE a.user_id = p_user AND a.deleted_at IS NULL AND a.status IN ('requested', 'active'))
  );
$$;
REVOKE ALL ON FUNCTION kv_dsr_erasure_figures(uuid) FROM PUBLIC;
COMMENT ON FUNCTION kv_dsr_erasure_figures(uuid) IS
  'PC-56 DPDP-1 (0245): blocker counts for an erasure (internal; called by the kv_dsr_erasure_* functions). Counts only.';

-- Lock + read. The relay calls this first inside the event's transaction; the locks hold until it commits.
CREATE OR REPLACE FUNCTION kv_dsr_erasure_claim(p_dsr uuid)
RETURNS TABLE (status text, user_id uuid, cooling_ends_at timestamptz, figures jsonb, blocked_reasons jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  SELECT x.id, x.status, x.user_id, x.cooling_ends_at, x.blocked_reasons INTO d
    FROM data_subject_requests x WHERE x.id = p_dsr AND x.request_type = 'erasure' AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM users u WHERE u.id = d.user_id FOR UPDATE;
  RETURN QUERY SELECT d.status::text, d.user_id, d.cooling_ends_at,
    CASE WHEN d.status IN ('in_progress', 'blocked') THEN kv_dsr_erasure_figures(d.user_id) ELSE NULL END, d.blocked_reasons;
END
$$;
REVOKE ALL ON FUNCTION kv_dsr_erasure_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_dsr_erasure_claim(uuid) TO kv_relay;

-- A blocked attempt. Tells the person only when the SET of reasons changes (the hourly re-check must not message them every hour).
CREATE OR REPLACE FUNCTION kv_dsr_erasure_block(p_dsr uuid, p_reasons text[], p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  v_known constant text[] := ARRAY['open_orders', 'wallet_balance', 'open_disputes', 'active_loans', 'pending_payouts',
                                   'listings_under_auction', 'sole_partner_admin', 'authority_membership'];
  v_reasons jsonb;
  v_changed boolean;
BEGIN
  IF p_reasons IS NULL OR cardinality(p_reasons) = 0 THEN
    RAISE EXCEPTION 'kv_dsr_erasure_block: no reason — an erasure is blocked FOR something' USING ERRCODE = '22004';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_reasons) r WHERE r <> ALL (v_known) AND r NOT LIKE 'unknown:%') THEN
    RAISE EXCEPTION 'kv_dsr_erasure_block: unknown reason in %', p_reasons USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO d FROM data_subject_requests x WHERE x.id = p_dsr AND x.request_type = 'erasure' AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR d.status NOT IN ('in_progress', 'blocked') THEN RETURN false; END IF;
  SELECT jsonb_agg(r ORDER BY r) INTO v_reasons FROM (SELECT DISTINCT unnest(p_reasons) AS r) s;
  v_changed := d.blocked_reasons IS DISTINCT FROM v_reasons;
  UPDATE data_subject_requests
     SET status = 'blocked', blocked_reasons = v_reasons,
         blocked_at = CASE WHEN v_changed THEN now() ELSE blocked_at END,
         erasure_attempts = erasure_attempts + 1, last_attempt_at = now(), updated_at = now()
   WHERE id = p_dsr;
  IF v_changed THEN
    INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
    VALUES (p_tenant, 'data_subject_request', p_dsr, 'identity.erasure_blocked',
            jsonb_build_object('v', 1, 'dsrId', p_dsr, 'userId', d.user_id, 'reasons', v_reasons), 'pending', now());
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (NULL, NULL, 'system', 'dsr.erasure_blocked', 'data_subject_request', p_dsr,
            jsonb_build_object('status', d.status, 'reasons', d.blocked_reasons),
            jsonb_build_object('status', 'blocked', 'reasons', v_reasons), NULL);
  END IF;
  RETURN v_changed;
END
$$;
REVOKE ALL ON FUNCTION kv_dsr_erasure_block(uuid, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_dsr_erasure_block(uuid, text[], uuid) TO kv_relay;

-- THE ERASURE. One transaction (the relay's). Every class below is decided in apps/api/src/modules/identity/README.md § "DPDP erasure";
-- apps/api `ERASURE_MATRIX` names the same classes and the integration spec holds the two together.
CREATE OR REPLACE FUNCTION kv_dsr_erasure_execute(p_dsr uuid, p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  u uuid;
  n bigint;
  n2 bigint;
  c jsonb := '{}'::jsonb;                 -- data class → {action, rows}
  v_fig jsonb;
  v_media uuid[];
  v_media_n bigint := 0;
  v_tenants uuid[];
  v_now timestamptz := now();
  v_tomb constant text := '[erased]';
  v_sentinel_phone constant text := '+10000000000';
  v_summary jsonb;
  v_unmapped jsonb;
  r record;
BEGIN
  SELECT x.* INTO d FROM data_subject_requests x WHERE x.id = p_dsr AND x.request_type = 'erasure' AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'kv_dsr_erasure_execute: no erasure request %', p_dsr USING ERRCODE = 'P0002'; END IF;
  IF d.status = 'completed' THEN RETURN d.erasure_summary; END IF;                       -- idempotent: a second run changes nothing
  IF d.status NOT IN ('in_progress', 'blocked') THEN
    RAISE EXCEPTION 'kv_dsr_erasure_execute: request % is %, not in progress', p_dsr, d.status USING ERRCODE = '55000';
  END IF;
  IF d.cooling_ends_at IS NULL OR d.cooling_ends_at > v_now THEN
    RAISE EXCEPTION 'kv_dsr_erasure_execute: the cooling-off of % has not ended', p_dsr USING ERRCODE = '55000';
  END IF;
  u := d.user_id;
  PERFORM 1 FROM users x WHERE x.id = u FOR UPDATE;
  -- FAIL CLOSED: the caller decided there was no blocker; the database re-checks in the same transaction. Money is never touched.
  v_fig := kv_dsr_erasure_figures(u);
  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_fig) f WHERE f.value::bigint <> 0) THEN
    RAISE EXCEPTION 'kv_dsr_erasure_execute: % still has a blocker %', p_dsr, v_fig USING ERRCODE = '55000';
  END IF;

  -- ── sessions: every live token stops working ───────────────────────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(DISTINCT t), '{}') INTO v_tenants FROM (
    SELECT tenant_id AS t FROM user_tenant_roles WHERE user_id = u
    UNION SELECT tenant_id FROM carts WHERE user_id = u
    UNION SELECT tenant_id FROM addresses WHERE user_id = u AND tenant_id IS NOT NULL
  ) s WHERE t IS NOT NULL;
  -- the per-tenant cut-off SessionPostureGuard enforces on every access token issued before it (core/auth/session-posture.guard.ts)
  INSERT INTO tenant_session_revocations (tenant_id, user_id, revoked_after, revoked_by, reason)
  SELECT t, u, v_now, u, 'dsr_erasure' FROM unnest(v_tenants) t
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET revoked_after = EXCLUDED.revoked_after, revoked_by = EXCLUDED.revoked_by, reason = EXCLUDED.reason;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('tenant_session_revocations', jsonb_build_object('action', 'created', 'rows', n));
  -- refresh tokens: deleted, so no refresh can mint a new access token
  DELETE FROM sessions WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('sessions', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM devices WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('devices', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM push_devices WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('push_devices', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM login_events WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('login_events', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM fido2_credentials WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('fido2_credentials', jsonb_build_object('action', 'deleted', 'rows', n));
  -- 2FA rows are never deleted (SW-c's guards): the enrolment is disabled and the recovery codes retired
  UPDATE user_totp SET disabled_at = v_now, disabled_reason = 'dsr_erasure' WHERE user_id = u AND disabled_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_totp', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE user_recovery_codes SET retired_at = v_now WHERE user_id = u AND retired_at IS NULL AND used_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_recovery_codes', jsonb_build_object('action', 'anonymised', 'rows', n));
  DELETE FROM idempotency_keys WHERE user_id = u;                                         -- cached responses can echo personal data
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('idempotency_keys', jsonb_build_object('action', 'deleted', 'rows', n));

  -- ── roles and memberships: deactivated (rows stay — they are who-could-do-what history) ─────────────────────────────────
  UPDATE user_tenant_roles
     SET is_active = false, revoked_at = coalesce(revoked_at, v_now), revoked_by = coalesce(revoked_by, u),
         revoke_reason = coalesce(revoke_reason, 'dsr_erasure'), role_data = '{}'::jsonb, deleted_at = coalesce(deleted_at, v_now)
   WHERE user_id = u AND (is_active OR deleted_at IS NULL OR role_data <> '{}'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_tenant_roles', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE partner_memberships SET is_active = false, removed_at = v_now, removed_by = u, removed_reason = 'dsr_erasure', deleted_at = v_now
   WHERE user_id = u AND (is_active OR deleted_at IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('partner_memberships', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE desk_members SET removed_at = v_now, removed_by = u, remove_reason = 'dsr_erasure' WHERE user_id = u AND removed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('desk_members', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE user_memberships SET status = 'cancelled', deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_memberships', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── media the person put on the platform: collected BEFORE references are cleared, purged below ─────────────────────────
  SELECT coalesce(array_agg(DISTINCT m), '{}') INTO v_media FROM (
    SELECT photo_media_id AS m FROM users WHERE id = u
    UNION ALL SELECT media_id FROM kyc_documents WHERE user_id = u AND subject_kind = 'user'
    UNION ALL SELECT unnest(doc_media_ids) FROM business_kyc_profiles WHERE user_id = u
    UNION ALL SELECT mm FROM messages msg
                CROSS JOIN LATERAL (VALUES (msg.voice_media_id), (msg.attachment_media_id)) v(mm)
               WHERE msg.conversation_id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = u)
                 AND msg.sender_user_id = u
    UNION ALL SELECT symptoms_voice_media_id FROM vet_bookings WHERE farmer_user_id = u
    -- photos and trust documents of the person's listings that never became part of an order
    UNION ALL SELECT ml.media_id FROM media_links ml JOIN listings l ON l.id = ml.entity_id AND ml.entity_type = 'listing'
               WHERE l.seller_user_id = u AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.listing_id = l.id)
    UNION ALL SELECT ltd.media_id FROM listing_trust_documents ltd JOIN listings l ON l.id = ltd.listing_id
               WHERE l.seller_user_id = u AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.listing_id = l.id)
  ) s WHERE m IS NOT NULL
    -- never a file another party relies on as evidence: a dispute's exhibits, a delivery's proof
    AND NOT EXISTS (SELECT 1 FROM disputes dd WHERE m = ANY (dd.evidence_media_ids))
    AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.pod_media_id = m)
    AND NOT EXISTS (SELECT 1 FROM pod_reviews pr WHERE pr.pod_media_id = m);

  -- ── the person ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  UPDATE users
     SET phone = 'erased:' || id::text, phone_verified_at = NULL, full_name = NULL, gender = NULL, dob = NULL,
         email = NULL, email_verified_at = NULL, photo_media_id = NULL, aadhaar_last4 = NULL, aadhaar_vault_ref = NULL,
         pan_vault_ref = NULL, last_active_at = NULL, status = 'soft_deleted', deleted_at = coalesce(deleted_at, v_now)
   WHERE id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('users', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE addresses
     SET line1 = v_tomb, line2 = NULL, village = NULL, pincode = NULL, lat = NULL, lng = NULL, contact_name = NULL,
         contact_phone = NULL, delivery_note = NULL, is_default = false, deleted_at = coalesce(deleted_at, v_now)
   WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('addresses', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE user_phone_changes SET old_phone = v_sentinel_phone, new_phone = v_sentinel_phone WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_phone_changes', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── KYC: the document rows are kept as the desk's decision history (their subject, type and evidence are immutable by 9a's guard),
  --    stripped of every identifying field and soft-deleted; the scans themselves are in the media purge ───────────────────────
  UPDATE kyc_documents SET doc_no_masked = NULL, issued_by = NULL, verify_payload = NULL, reject_reason = NULL,
         deleted_at = coalesce(deleted_at, v_now)
   WHERE user_id = u AND subject_kind = 'user';
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('kyc_documents', jsonb_build_object('action', 'anonymised', 'rows', n));
  DELETE FROM ekyc_sessions WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('ekyc_sessions', jsonb_build_object('action', 'deleted', 'rows', n));
  UPDATE business_kyc_profiles SET legal_name = v_tomb, gstin_masked = NULL, pan_masked = NULL, doc_media_ids = '{}', reject_reason = NULL,
         deleted_at = coalesce(deleted_at, v_now)
   WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('business_kyc_profiles', jsonb_build_object('action', 'anonymised', 'rows', n));
  -- bank accounts: payouts point at them (kept), so the row stays — soft-deleted, and the vault token is DESTROYED on our side
  UPDATE bank_accounts SET vault_ref = 'erased:' || id::text, upi_id = NULL, account_last4 = NULL, ifsc = NULL, holder_name = NULL,
         is_primary = false, deleted_at = coalesce(deleted_at, v_now)
   WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('bank_accounts', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── what exists only for the person ────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM notification_preferences WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('notification_preferences', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM user_quiet_hours WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_quiet_hours', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM weather_prefs WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('weather_prefs', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM saved_searches WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('saved_searches', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM saved_items WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('saved_items', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM price_alert_triggers WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('price_alert_triggers', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM price_alerts WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('price_alerts', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM auction_watchers WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('auction_watchers', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM user_blocks WHERE blocker_user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('user_blocks', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = u);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('cart_items', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM carts WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('carts', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM notifications WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('notifications', jsonb_build_object('action', 'deleted', 'rows', n));
  DELETE FROM risk_scores WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('risk_scores', jsonb_build_object('action', 'deleted', 'rows', n));
  -- a credit score a loan application was decided on stays (the lender's record); every other one goes
  DELETE FROM credit_scores cs WHERE cs.user_id = u AND NOT EXISTS (SELECT 1 FROM loan_applications la WHERE la.credit_score_id = cs.id);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('credit_scores', jsonb_build_object('action', 'deleted', 'rows', n));
  UPDATE risk_events SET meta = '{}'::jsonb WHERE user_id = u AND meta <> '{}'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('risk_events', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── words the person wrote: replaced by a fixed tombstone (the thread, the rating and the dispute stay whole for the other party)
  UPDATE messages SET body = CASE WHEN body IS NULL THEN NULL ELSE v_tomb END, voice_media_id = NULL, attachment_media_id = NULL
   WHERE conversation_id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = u)
     AND sender_user_id = u
     AND (body IS DISTINCT FROM v_tomb AND body IS NOT NULL OR voice_media_id IS NOT NULL OR attachment_media_id IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('messages', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE dispute_messages SET body = v_tomb WHERE author_user_id = u AND body IS DISTINCT FROM v_tomb AND body IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('dispute_messages', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE disputes SET description = v_tomb WHERE raised_by = u AND description IS DISTINCT FROM v_tomb AND description IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('disputes', jsonb_build_object('action', 'anonymised', 'rows', n));
  -- reviews keep their stars and sub-ratings (the aggregate other buyers relied on); the text and tags go; the name was users.full_name
  UPDATE reviews SET body = CASE WHEN body IS NULL THEN NULL ELSE v_tomb END, tags = '[]'::jsonb
   WHERE reviewer_user_id = u AND (body IS DISTINCT FROM v_tomb AND body IS NOT NULL OR tags <> '[]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  -- …and the person's own answers to reviews of them, as a seller
  UPDATE reviews SET seller_response = v_tomb
   WHERE target_type IN ('seller', 'user') AND target_id = u AND seller_response IS NOT NULL AND seller_response <> v_tomb;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  c := c || jsonb_build_object('reviews', jsonb_build_object('action', 'anonymised', 'rows', n + n2));
  UPDATE support_csat_responses SET comment = NULL WHERE respondent_user_id = u AND comment IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('support_csat_responses', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE support_tickets SET subject = NULL WHERE requester_user_id = u AND subject IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('support_tickets', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE moderation_reports SET details = NULL WHERE reporter_user_id = u AND details IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('moderation_reports', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── listings: every live one is archived (the state machine's archive move) and stripped of place and description; one that never
  --    became part of an order also loses its title (free text) and its photos. A listing in an order keeps its title: the order's line
  --    snapshot and the invoice already carry it, and the buyer's record must still read.
  FOR r IN
    UPDATE listings l
       SET status = CASE WHEN l.status IN ('draft', 'pending_approval', 'published', 'paused', 'held', 'rejected', 'sold_out', 'expired', 'hidden')
                         THEN 'archived'::listing_status ELSE l.status END,
           title = CASE WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.listing_id = l.id) THEN l.title ELSE v_tomb END,
           description = NULL, lat = NULL, lng = NULL, pincode = NULL, ai_meta = '{}'::jsonb, reject_reason = NULL,
           deleted_at = CASE WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.listing_id = l.id) THEN l.deleted_at ELSE coalesce(l.deleted_at, v_now) END
     WHERE l.seller_user_id = u
       AND (l.status <> 'archived' OR l.description IS NOT NULL OR l.lat IS NOT NULL OR l.pincode IS NOT NULL
            OR (l.title <> v_tomb AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.listing_id = l.id)))
    RETURNING l.id, l.tenant_id, l.status::text AS to_status,
              (SELECT o.status::text FROM listings o WHERE o.id = l.id) AS from_status
  LOOP
    IF r.to_status = 'archived' AND r.from_status IS DISTINCT FROM 'archived' THEN
      -- the search index drops it on this event (core/search/indices/listings.index.ts re-reads the row)
      INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
      VALUES (r.tenant_id, 'listing', r.id, 'listing.status_changed',
              jsonb_build_object('v', 1, 'type', 'listing.status_changed', 'listingId', r.id, 'from', r.from_status, 'to', 'archived'), 'pending', now());
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM listings WHERE seller_user_id = u;
  c := c || jsonb_build_object('listings', jsonb_build_object('action', 'anonymised', 'rows', n));
  DELETE FROM media_links WHERE media_id = ANY (v_media);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('media_links', jsonb_build_object('action', 'deleted', 'rows', n));

  -- ── the files: soft-deleted now (never presigned again), storage deletion RECORDED AS PENDING (no purge path exists — 245.3) ──
  UPDATE media_assets SET deleted_at = coalesce(deleted_at, v_now), storage_purge_requested_at = coalesce(storage_purge_requested_at, v_now),
         storage_purge_reason = coalesce(storage_purge_reason, 'dsr_erasure')
   WHERE id = ANY (v_media);
  GET DIAGNOSTICS v_media_n = ROW_COUNT; c := c || jsonb_build_object('media_assets', jsonb_build_object('action', 'anonymised', 'rows', v_media_n));
  UPDATE vet_bookings SET symptoms_voice_media_id = NULL, symptoms_text = NULL
   WHERE farmer_user_id = u AND (symptoms_voice_media_id IS NOT NULL OR symptoms_text IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('vet_bookings', jsonb_build_object('action', 'anonymised', 'rows', n));
  -- the person's own DPDP export files (a copy of everything about them) — the job rows are retired; their files join the purge note
  UPDATE tenant_export_jobs SET deleted_at = coalesce(deleted_at, v_now)
   WHERE requested_by = u AND dataset_code = 'identity.dpdp_person' AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('tenant_export_jobs', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE data_export_jobs SET deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u AND job_kind = 'user_dpdp_export' AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('data_export_jobs', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── role profiles: soft-deleted, identifying fields cleared ─────────────────────────────────────────────────────────────
  UPDATE worker_profiles SET emergency_contact_name = NULL, emergency_contact_phone = NULL, eshram_no = NULL, discoverable = false,
         deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('worker_profiles', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE sardar_profiles SET compliance_note = NULL, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('sardar_profiles', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE vet_profiles SET registration_no = v_tomb, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('vet_profiles', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE drone_pilots SET rpl_no = v_tomb, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('drone_pilots', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE ambassador_profiles SET is_active = false, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('ambassador_profiles', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE instructors SET bio = NULL, display_name = NULL, verification_note = NULL, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('instructors', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE ambassador_visits SET notes = NULL, lat = NULL, lng = NULL WHERE visited_user_id = u AND (notes IS NOT NULL OR lat IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('ambassador_visits', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE land_parcels SET survey_no = NULL, bhulekh_ref = NULL, boundary_geojson = NULL, deleted_at = coalesce(deleted_at, v_now)
   WHERE owner_user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('land_parcels', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE animals SET pashu_aadhaar = NULL, name = NULL WHERE owner_user_id = u AND (pashu_aadhaar IS NOT NULL OR name IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('animals', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE mgnrega_job_cards SET job_card_no = v_tomb, deleted_at = coalesce(deleted_at, v_now) WHERE user_id = u;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('mgnrega_job_cards', jsonb_build_object('action', 'anonymised', 'rows', n));
  -- a scheme application never submitted is the person's draft; a submitted one is the authority's record (kept)
  UPDATE scheme_applications SET form_data = '{}'::jsonb, deleted_at = coalesce(deleted_at, v_now)
   WHERE applicant_user_id = u AND status = 'draft';
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('scheme_applications', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── records the law keeps, with the personal data they carried removed ──────────────────────────────────────────────────
  -- the gateway's raw webhook body can carry the payer's phone / email / VPA; amounts, status and references stay
  UPDATE payments SET webhook_payload = NULL WHERE user_id = u AND webhook_payload IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('payments', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE staff_invites SET phone = v_sentinel_phone WHERE accepted_user_id = u AND status <> 'pending' AND phone <> v_sentinel_phone;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('staff_invites', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE partner_invites SET phone = v_sentinel_phone WHERE accepted_user_id = u AND status <> 'pending' AND phone <> v_sentinel_phone;
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('partner_invites', jsonb_build_object('action', 'anonymised', 'rows', n));
  UPDATE setup_call_requests SET phone_masked = '••••0000', notes = NULL
   WHERE requested_by = u AND (phone_masked <> '••••0000' OR notes IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('setup_call_requests', jsonb_build_object('action', 'anonymised', 'rows', n));

  -- ── kept unchanged, counted: they hold only the (now meaningless) id and amounts / proofs ─────────────────────────────────
  SELECT count(*) INTO n FROM consents WHERE user_id = u;
  c := c || jsonb_build_object('consents', jsonb_build_object('action', 'blocked_by_law', 'rows', n));
  SELECT count(*) INTO n FROM ledger_entries le JOIN wallet_accounts w ON w.id = le.account_id WHERE w.owner_kind = 'user' AND w.owner_user_id = u;
  c := c || jsonb_build_object('ledger_entries', jsonb_build_object('action', 'blocked_by_law', 'rows', n));
  SELECT count(DISTINCT le.txn_id) INTO n FROM ledger_entries le JOIN wallet_accounts w ON w.id = le.account_id WHERE w.owner_kind = 'user' AND w.owner_user_id = u;
  c := c || jsonb_build_object('ledger_transactions', jsonb_build_object('action', 'blocked_by_law', 'rows', n));
  SELECT count(*) INTO n FROM wallet_accounts WHERE owner_kind = 'user' AND owner_user_id = u;
  c := c || jsonb_build_object('wallet_accounts', jsonb_build_object('action', 'blocked_by_law', 'rows', n));
  SELECT count(*) INTO n FROM audit_log WHERE actor_user_id = u;
  c := c || jsonb_build_object('audit_log', jsonb_build_object('action', 'blocked_by_law', 'rows', n));
  SELECT count(*) INTO n FROM orders WHERE buyer_user_id = u OR seller_user_id = u;
  c := c || jsonb_build_object('orders', jsonb_build_object('action', 'archived', 'rows', n));
  SELECT count(*) INTO n FROM trade_invoices WHERE buyer_user_id = u OR seller_user_id = u;
  c := c || jsonb_build_object('trade_invoices', jsonb_build_object('action', 'archived', 'rows', n));
  SELECT count(*) INTO n FROM payouts WHERE user_id = u;
  c := c || jsonb_build_object('payouts', jsonb_build_object('action', 'archived', 'rows', n));
  SELECT count(*) INTO n FROM settlement_statements WHERE seller_user_id = u;
  c := c || jsonb_build_object('settlement_statements', jsonb_build_object('action', 'archived', 'rows', n));
  -- a cold-chain breach is the seller's and the platform's record of a shipment; the buyer's free-text reason is theirs
  UPDATE cold_chain_breaches SET buyer_decision_reason = NULL WHERE buyer_user_id = u AND buyer_decision_reason IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO n2 FROM cold_chain_breaches WHERE buyer_user_id = u;
  c := c || jsonb_build_object('cold_chain_breaches', jsonb_build_object('action', 'archived', 'rows', n2));
  -- temperature readings name a shipment / device, never a person
  c := c || jsonb_build_object('cold_chain_logs', jsonb_build_object('action', 'archived', 'rows', 0));
  c := c || jsonb_build_object('webhook_deliveries', jsonb_build_object('action', 'archived', 'rows', 0));

  -- ── evidence: one row per data class (0107's append-only table); a retention policy's legal basis is SNAPSHOT at execution ──
  INSERT INTO dsr_erasure_actions (request_id, data_class, action, rows_affected, legal_basis, executed_by, note)
  SELECT p_dsr, k, CASE WHEN v->>'action' = 'created' THEN 'anonymised' ELSE v->>'action' END, (v->>'rows')::bigint,
         (SELECT p.legal_basis FROM data_retention_policies p WHERE p.table_name = k AND p.deleted_at IS NULL),
         'worker:dsr-erasure',
         CASE k WHEN 'media_assets' THEN 'rows soft-deleted; STORAGE DELETION PENDING (media_assets.storage_purge_requested_at) — no purge path exists yet'
                WHEN 'bank_accounts' THEN 'vault reference destroyed on our side; provider-side deactivation not performed (no provider call exists)'
                WHEN 'tenant_session_revocations' THEN 'per-tenant session cut-off written: every access token issued before it is refused'
                ELSE NULL END
    FROM jsonb_each(c) AS e(k, v)
  ON CONFLICT (request_id, data_class) WHERE action <> 'retracted' DO NOTHING;

  -- retention classes the executor has no rule for are NAMED in the summary (never silently treated as done)
  SELECT coalesce(jsonb_agg(p.table_name ORDER BY p.table_name), '[]'::jsonb) INTO v_unmapped
    FROM data_retention_policies p WHERE p.is_active AND p.deleted_at IS NULL AND NOT (c ? p.table_name);

  v_summary := jsonb_build_object('v', 1, 'executedAt', v_now, 'classes', c, 'mediaPendingStoragePurge', v_media_n,
    'storagePurge', jsonb_build_object('status', 'pending', 'reason', 'no_storage_delete_path'),
    'unmappedRetentionClasses', v_unmapped);

  UPDATE data_subject_requests
     SET status = 'completed', completed_at = v_now, erasure_summary = v_summary, blocked_reasons = NULL,
         resolution = coalesce(resolution, 'erased by the DPDP erasure executor (0245)'),
         erasure_attempts = erasure_attempts + 1, last_attempt_at = v_now, updated_at = v_now
   WHERE id = p_dsr;

  INSERT INTO audit_log (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
  VALUES (NULL, NULL, 'system', 'dsr.erasure_completed', 'data_subject_request', p_dsr,
          jsonb_build_object('status', d.status),
          jsonb_build_object('status', 'completed', 'classes', (SELECT count(*) FROM jsonb_object_keys(c)), 'mediaPendingStoragePurge', v_media_n),
          NULL);
  RETURN v_summary;
END
$$;
REVOKE ALL ON FUNCTION kv_dsr_erasure_execute(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_dsr_erasure_execute(uuid, uuid) TO kv_relay;
COMMENT ON FUNCTION kv_dsr_erasure_execute(uuid, uuid) IS
  'PC-56 DPDP-1 (0245): de-identify the person of an erasure request whose cooling ended and who has no blocker (re-checked, fails closed). '
  'Writes dsr_erasure_actions evidence per class + one audit_log row; completes the request with its summary. Idempotent. EXECUTE: kv_relay only.';

-- ------------------------------------------------------------------------------------------------------------------
-- 245.6  the person is told when their erasure is blocked (copy: seed core/0007)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('dsr.erasure_blocked', 'Your account deletion is waiting on something still open', 'important', '["push","inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;
