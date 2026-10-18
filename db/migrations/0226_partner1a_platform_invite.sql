-- ==================================================================================================================
-- MIGRATION 0226 — PC-56 PARTNER-1a · THE PLATFORM INVITES A PARTNER'S FIRST ADMINISTRATOR, AND READS THE PARTNER REGISTRY.
-- (brief_p1a.md founder decisions D2 + D3, 2026-10-18; PARTNER-0 report §8 item 2 — "there is no way to author a partner's first
-- administrator": the ops gap, Law 11.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0225 are applied; nothing here edits them. 0225's invite trigger
-- function is REPLACED here by `CREATE OR REPLACE FUNCTION` — the 0225 file itself is untouched; every rule it enforced still holds.)
-- LAW 9 / LAW 11 CLASS — IDENTITY: the god-mode realm (kv_admin) gains the right to create ONE kind of row in the partner realm (the first
-- partner_admin invite of a partner that has none) and to READ the two team tables' non-secret columns. NOT MONEY: no ledger table, no
-- posting, no money column is written here.
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   226.1  `partner_invites.invited_by` becomes NULLABLE and `partner_invites.invited_by_admin_id uuid` is added (the admin realm's
--          operator id — the JWT subject of the platform administrator; no FK, the house convention for `*_by_admin_id` columns, e.g.
--          `api_keys.revoked_by_admin_id`, `platform_operators.suspended_by_admin_id`). CHECK `ck_pi_one_inviter`: EXACTLY ONE of the two is
--          set — an invite is made by a partner administrator OR by the platform, never by both and never by nobody.
--   226.2  The invite trigger `assert_partner_invite_moves()` is REPLACED. Unchanged: born pending, a partner role, 7 days set here,
--          single use, accepted by the invited person in their own session, revoked by a partner admin in their own session, expired
--          only after 7 days, nothing about an invite moves once written. NEW — the PLATFORM branch of an INSERT (invited_by_admin_id set):
--            • the role is `partner_admin` (the platform appoints only the first administrator — `[PARTNER_PLATFORM_ROLE]`);
--            • under the per-partner admin lock 0225 uses for the last-admin rule: the partner has NO active partner_admin
--              (`[PARTNER_HAS_ADMIN]`) and no live pending platform invite (`[PARTNER_ADMIN_INVITE_PENDING]`);
--            • the partner row is active and not deleted (`[PARTNER_NOT_FOUND]`).
--          A partner admin's own invite (invited_by set) keeps 0225's rule exactly: the session user IS the inviter AND an active
--          partner_admin of that partner. The UPDATE branch now compares the two inviter columns with IS DISTINCT FROM (a NULL inviter
--          must not slip past a `<>` that yields NULL).
--   226.3  GRANTS — the column a request handler must never set: kv_app's table-wide INSERT on partner_invites is REVOKED and re-granted
--          column by column WITHOUT `invited_by_admin_id` (a partner-realm request can never claim to be the platform). kv_admin gains:
--            partner_invites      SELECT (id, partner_id, role_id, invited_by, invited_by_admin_id, status, expires_at, accepted_at, created_at)
--                                 INSERT (id, partner_id, phone, role_id, invited_by_admin_id, language_code, token_hash)
--                                 — never the token hash or the sealed token on SELECT, never `invited_by` on INSERT;
--            partner_memberships  SELECT (id, partner_id, role_id, is_active, created_at, deleted_at) — counts, never who.
--   226.4  RLS for kv_admin (both tables are FORCE RLS since 0225 and kv_admin is not BYPASSRLS):
--            pi_admin_realm_read    SELECT  TO kv_admin  USING (true)
--            pi_admin_realm_insert  INSERT  TO kv_admin  WITH CHECK (invited_by IS NULL AND invited_by_admin_id IS NOT NULL)
--            pm_admin_realm_read    SELECT  TO kv_admin  USING (true)
--          (+3 policies; `verify-rls-coverage` counts them.)
--
-- WHAT THIS FILE DOES NOT DO (named): no admin writer for `partner_memberships` (the first admin becomes a member only by ACCEPTING the
-- invite — the token AND an OTP on the invited phone, PARTNER-0's accept path); no author of a NEW `financial_partners` row (owner SQL —
-- a founder-signed agreement precedes it); no SMS for a platform invite (the admin realm holds no webhook KEK, so it keeps no sealed copy:
-- the platform administrator hands the code over; the relay handler records `send_failure = 'platform_handover'` on the invite).
--
-- REVERSAL (hand-run, never by the runner; revert the admin-api partner-ops module first):
--   DROP POLICY IF EXISTS pi_admin_realm_read ON partner_invites; DROP POLICY IF EXISTS pi_admin_realm_insert ON partner_invites;
--   DROP POLICY IF EXISTS pm_admin_realm_read ON partner_memberships;
--   REVOKE ALL ON partner_invites, partner_memberships FROM kv_admin;
--   REVOKE INSERT ON partner_invites FROM kv_app; GRANT INSERT ON partner_invites TO kv_app;
--   -- (only if no platform invite exists: DELETE is refused by the trigger, so check `SELECT count(*) FROM partner_invites WHERE invited_by IS NULL`)
--   ALTER TABLE partner_invites DROP CONSTRAINT IF EXISTS ck_pi_one_inviter, DROP COLUMN IF EXISTS invited_by_admin_id;
--   ALTER TABLE partner_invites ALTER COLUMN invited_by SET NOT NULL;
--   then re-run 0225's §225.3 `CREATE OR REPLACE FUNCTION assert_partner_invite_moves()` body by hand.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 226.1  WHO MADE THE INVITE: a partner administrator OR the platform — exactly one
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE partner_invites ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE partner_invites ADD COLUMN IF NOT EXISTS invited_by_admin_id uuid;
ALTER TABLE partner_invites DROP CONSTRAINT IF EXISTS ck_pi_one_inviter;
ALTER TABLE partner_invites ADD CONSTRAINT ck_pi_one_inviter CHECK (num_nonnulls(invited_by, invited_by_admin_id) = 1);
COMMENT ON COLUMN partner_invites.invited_by_admin_id IS
  'PC-56 PARTNER-1a (0226, founder D3): set ONLY when the PLATFORM (an admin-realm operator, this JWT subject) invites a partner''s FIRST '
  'partner_admin — the partner has no active administrator. Exactly one of invited_by / invited_by_admin_id is set (ck_pi_one_inviter).';

-- ------------------------------------------------------------------------------------------------------------------
-- 226.2  THE INVITE TRIGGER, with the platform branch
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_partner_invite_moves() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_scope text; v_role text; v_session uuid; v_admins integer; v_pending integer; v_partner_live boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[PARTNER_INVITE_FINAL] an invite is never deleted — revoke it with a reason — PC-56 PARTNER-0' USING ERRCODE = '42501';
  END IF;
  v_session := kv_session_user_uuid();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.accepted_user_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.sent_at IS NOT NULL THEN
      RAISE EXCEPTION '[PARTNER_INVITE_BORN_PENDING] an invite is born pending and unsent — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.scope, r.code INTO v_scope, v_role FROM roles r WHERE r.id = NEW.role_id;
    IF v_scope IS DISTINCT FROM 'partner' THEN
      RAISE EXCEPTION '[PARTNER_ROLE_REQUIRED] an invite carries a partner role — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.invited_by_admin_id IS NOT NULL THEN
      -- THE PLATFORM BRANCH (0226): the first administrator of a partner that has none — and nothing else.
      IF NEW.invited_by IS NOT NULL THEN
        RAISE EXCEPTION '[PARTNER_INVITE_ONE_INVITER] an invite has exactly one inviter — PC-56 PARTNER-1a' USING ERRCODE = 'check_violation';
      END IF;
      IF v_role IS DISTINCT FROM 'partner_admin' THEN
        RAISE EXCEPTION '[PARTNER_PLATFORM_ROLE] the platform appoints only a partner''s first administrator — PC-56 PARTNER-1a' USING ERRCODE = 'check_violation';
      END IF;
      SELECT (fp.is_active AND fp.deleted_at IS NULL) INTO v_partner_live FROM financial_partners fp WHERE fp.id = NEW.partner_id;
      IF NOT COALESCE(v_partner_live, false) THEN
        RAISE EXCEPTION '[PARTNER_NOT_FOUND] no active partner organisation with this id — PC-56 PARTNER-1a' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('kv_partner_admins:' || NEW.partner_id::text, 0));
      SELECT count(*)::int INTO v_admins FROM partner_memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.partner_id = NEW.partner_id AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin';
      IF v_admins > 0 THEN
        RAISE EXCEPTION '[PARTNER_HAS_ADMIN] this partner already has an administrator — they invite their own team — PC-56 PARTNER-1a' USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*)::int INTO v_pending FROM partner_invites i
       WHERE i.partner_id = NEW.partner_id AND i.invited_by_admin_id IS NOT NULL AND i.status = 'pending' AND i.expires_at > now();
      IF v_pending > 0 THEN
        RAISE EXCEPTION '[PARTNER_ADMIN_INVITE_PENDING] a platform invite for this partner''s first administrator is still open — PC-56 PARTNER-1a' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      -- THE PARTNER BRANCH (0225, unchanged): an active partner_admin of THAT partner, in their own session.
      IF NEW.invited_by IS NULL OR v_session IS NULL OR v_session <> NEW.invited_by OR NOT kv_is_partner_admin(NEW.partner_id, NEW.invited_by) THEN
        RAISE EXCEPTION '[PARTNER_INVITE_NOT_ADMIN] only a partner administrator invites, in their own session — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.created_at := now(); NEW.updated_at := now(); NEW.expires_at := now() + interval '7 days';
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.partner_id <> OLD.partner_id OR NEW.phone <> OLD.phone OR NEW.role_id <> OLD.role_id
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by OR NEW.invited_by_admin_id IS DISTINCT FROM OLD.invited_by_admin_id
     OR NEW.token_hash <> OLD.token_hash OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at OR NEW.language_code <> OLD.language_code
     OR (NEW.token_sealed IS NOT NULL AND NEW.token_sealed IS DISTINCT FROM OLD.token_sealed) THEN
    RAISE EXCEPTION '[PARTNER_INVITE_FINAL] what an invite says is fixed — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
  END IF;
  -- A CLOSED invite (accepted / revoked / expired) never moves again: single use.
  IF OLD.status <> 'pending' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.accepted_user_id IS DISTINCT FROM OLD.accepted_user_id OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
       OR NEW.expired_at IS DISTINCT FROM OLD.expired_at OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.send_failure IS DISTINCT FROM OLD.send_failure THEN
      RAISE EXCEPTION '[PARTNER_INVITE_FINAL] this invite is % — it is single use — PC-56 PARTNER-0', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      IF OLD.expires_at <= now() THEN
        RAISE EXCEPTION '[PARTNER_INVITE_EXPIRED] this invite expired — ask for a new one — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
      IF v_session IS NULL OR v_session <> NEW.accepted_user_id THEN
        RAISE EXCEPTION '[PARTNER_INVITE_NOT_YOURS] an invite is accepted by the invited person, in their own session — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
      NEW.accepted_at := now(); NEW.token_sealed := NULL;
    ELSIF NEW.status = 'revoked' THEN
      IF v_session IS DISTINCT FROM NEW.revoked_by OR NOT kv_is_partner_admin(NEW.partner_id, NEW.revoked_by) THEN
        RAISE EXCEPTION '[PARTNER_INVITE_NOT_ADMIN] only a partner administrator revokes an invite, in their own session — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
      NEW.revoked_at := now(); NEW.token_sealed := NULL;
    ELSIF NEW.status = 'expired' THEN
      IF OLD.expires_at > now() THEN
        RAISE EXCEPTION '[PARTNER_INVITE_NOT_STALE] an invite expires only after its 7 days — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
      NEW.expired_at := now(); NEW.token_sealed := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
-- (the trigger `trg_pi_moves` from 0225 already EXECUTEs this function by name — nothing to re-create)

-- ------------------------------------------------------------------------------------------------------------------
-- 226.3  GRANTS: kv_app may never name the platform as inviter; kv_admin reads counts and writes the one row
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT ON partner_invites FROM kv_app;
GRANT INSERT (id, partner_id, phone, role_id, invited_by, language_code, token_hash, token_sealed, expires_at) ON partner_invites TO kv_app;

REVOKE ALL ON partner_invites, partner_memberships FROM kv_admin;
GRANT SELECT (id, partner_id, role_id, invited_by, invited_by_admin_id, status, expires_at, accepted_at, created_at) ON partner_invites TO kv_admin;
GRANT INSERT (id, partner_id, phone, role_id, invited_by_admin_id, language_code, token_hash) ON partner_invites TO kv_admin;
GRANT SELECT (id, partner_id, role_id, is_active, created_at, deleted_at) ON partner_memberships TO kv_admin;

-- ------------------------------------------------------------------------------------------------------------------
-- 226.4  RLS for the admin realm (the tables are FORCE RLS; kv_admin is not BYPASSRLS)
-- ------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_invites' AND policyname = 'pi_admin_realm_read') THEN
    CREATE POLICY pi_admin_realm_read ON partner_invites FOR SELECT TO kv_admin USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_invites' AND policyname = 'pi_admin_realm_insert') THEN
    CREATE POLICY pi_admin_realm_insert ON partner_invites FOR INSERT TO kv_admin WITH CHECK (invited_by IS NULL AND invited_by_admin_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_memberships' AND policyname = 'pm_admin_realm_read') THEN
    CREATE POLICY pm_admin_realm_read ON partner_memberships FOR SELECT TO kv_admin USING (true);
  END IF;
END $$;
