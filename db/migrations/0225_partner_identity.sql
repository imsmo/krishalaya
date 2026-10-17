-- ==================================================================================================================
-- MIGRATION 0225 — PC-56 PARTNER-0 · A PARTNER IS AN ORGANISATION — the partner identity realm, its people, its RBAC and a consent-gated
-- read of applicants' loan applications on the `kv_partner` axis.
-- (survey_partner1.md §1 "Who a partner is", §2 F-1/F-2/F-3/F-5, §3 B1/B2/B9/B12, §5 item 1; founder decisions D1–D8, 2026-10-17.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0224 are applied; nothing here edits them. 0090's role, axis GUC,
-- oracle and policies are REUSED, never altered: this file only ADDS grants, functions, policies and two tables.)
-- LAW 9 / LAW 11 CLASS — IDENTITY + RBAC + a consent-gated read of PII-adjacent rows: a founder review is owed before production. The PC-55
-- A10 posture (PC55_A10_PARTNER_API_SECURITY_NOTES.md) is EXTENDED, never loosened. NOT MONEY: no ledger table, no posting, no money column
-- is written here; a partner session can never disburse (refused by name in the API — the FPO is the lender of record, Law 2).
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   225.1  roles.scope admits 'partner' (the 0003 CHECK `roles_scope_check` replaced by name); four partner roles, eight permissions and
--          their grants inserted where missing (seed core/0004 carries the same rows, guarded on this file having run).
--          THE MATRIX (founder D1; the eighth permission `partner.applications.review` is this wave's — a maker who may start a review
--          but never decide needs a verb a viewer does not hold):
--            partner_admin    every partner.* permission
--            partner_checker  partner.applications.read · partner.applications.decide
--            partner_maker    partner.applications.read · partner.applications.review
--            partner_viewer   partner.applications.read
--          A partner role can never be attached to a person inside a TENANT (trg_utr_no_partner_role), and a tenant role never inside a
--          partner (trg_pm_moves) — the two realms do not share a role.
--   225.2  `partner_memberships` — person × partner × role (UNIQUE (user_id, partner_id, role_id)); removal is a reason (10–500), never a
--          DELETE; the last active partner_admin of a partner cannot be removed (`[PARTNER_LAST_ADMIN]`, under a per-partner lock).
--   225.3  `partner_invites` — the 0199 `staff_invites` shape on the partner axis: sha256(token) for lookup + a KEK-sealed copy the SMS
--          handler clears; 7 days (set HERE, not by the caller); single use; one pending invite per phone per partner; only an active
--          partner_admin of THAT partner invites or revokes, in their own session; accepted by the invited person in their own session.
--   225.4  `sessions.realm` ('tenant' | 'partner') + `sessions.partner_id` + CHECK (realm = 'partner' ⇔ partner_id IS NOT NULL). A refresh
--          token of one realm never refreshes into the other (the repositories filter by realm).
--   225.5  THE CONSENT-GATED READ. `kv_partner` gains a COLUMN-LEVEL SELECT on `loan_applications` — never `applicant_user_id`,
--          `purpose_text`, `decision_note`, `created_by`/`updated_by` (the applicant), `nwr_id`, `credit_score_id`, `group_id`. Rows are admitted
--          by the SECURITY DEFINER oracle `partner_owns_application(id)`: the product's partner IS current_partner_id() AND a LIVE
--          `credit_score_consents` row exists for that applicant, that partner, purpose_ref = that application id, not expired (founder D2:
--          nothing before per-application consent). RLS `partner_own_book_loan_applications` FOR SELECT TO kv_partner — role-scoped and
--          NULL-guarded exactly like 0090's three. Three more DEFINER answers, each EXECUTE to kv_partner only:
--            partner_loan_products()                  this partner's products (id, name, kind code) — never another partner's
--            partner_application_purpose(id)          the free-text purpose ONLY when the owned application is approved/disbursed
--            partner_applicant_phone_masked(id)       '••••••' || the last 3 digits ONLY when the owned application is approved/disbursed
--          and two for the team read (no `users` grant to kv_partner): partner_team(), partner_pending_invites().
--   225.6  THE PARTNER-REALM AUDIT ROW: `al_insert_partner_realm` lets kv_app write an audit row with NO tenant only inside a transaction
--          naming a partner (app.partner_id) AND only when the row names that same partner (new_value->>'partnerId'). A detail read is
--          audited as a TENANT row of the application's organisation (the FPO can see which partner read its member's application); a
--          list read writes one partner-realm row with the count. (A10 notes §4: partner reads were not audited — now they are.)
--   225.7  Two kv_app oracles: `partner_has_console_members(partner)` (the tenant-side product-owner rule, founder D3) and
--          `partner_invite_partner(token_hash)` (the public invite lookup needs the partner before any partner is in scope).
--   225.8  Flag `partner_console` OFF (Law 10, platform-scoped, fail-closed) · the invite SMS words + role names in en/hi/gu (ui_messages;
--          seed core/0027 mirrors them) · the rules-seed lending fixture renamed to a neutral name with NO regulator number (founder D7).
--
-- RLS POLICY SET ON THE TWO NEW TABLES (both ENABLE + FORCE; no tenant_id — partner-axis tables):
--   kv_partner  SELECT   partner_id = current_partner_id() (NULL-guarded)                       — the axis read
--   kv_app      SELECT   user_id = the session's app.user_id  (memberships only: a person's own rows — the sign-in chooser, the guard)
--   kv_app      SELECT / INSERT / UPDATE  partner_id = current_partner_id() (NULL-guarded)      — the service's writes, partner from the TOKEN
--   explicit REVOKE ALL from kv_app / kv_relay / kv_readonly / PUBLIC first (the 0090 "FOUND WHILE BUILDING" default-privilege trap: 0014
--   and 0018 hand every FUTURE table to kv_app arw, kv_relay arwd, kv_readonly r), then the narrowest grants. Nothing to kv_relay (the SMS
--   handler works in a kv_app unit of work) or kv_readonly (phones, sealed tokens). NO kv_admin grant — the admin realm has no writer for a
--   partner's first administrator yet (named in the wave report §8: an ops gap, not a silent one).
--
-- REVERSAL (hand-run, never by the runner; revert the API module + the web-partner session first):
--   DELETE FROM feature_flags WHERE key = 'partner_console';
--   DELETE FROM ui_messages WHERE key LIKE 'partner.invite.sms.%' OR key LIKE 'partner.role.%';
--   DROP POLICY IF EXISTS al_insert_partner_realm ON audit_log;
--   DROP POLICY IF EXISTS partner_own_book_loan_applications ON loan_applications;
--   REVOKE SELECT ON loan_applications FROM kv_partner;   -- (the column grants)
--   DROP FUNCTION IF EXISTS partner_owns_application(uuid), partner_loan_products(), partner_application_purpose(uuid),
--     partner_applicant_phone_masked(uuid), partner_team(), partner_pending_invites(), partner_has_console_members(uuid),
--     partner_invite_partner(char), kv_is_partner_admin(uuid, uuid), kv_session_user_uuid();
--   ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm_partner, DROP COLUMN IF EXISTS partner_id, DROP COLUMN IF EXISTS realm;
--   DROP TRIGGER IF EXISTS trg_utr_no_partner_role ON user_tenant_roles; DROP FUNCTION IF EXISTS trg_utr_no_partner_role();
--   DROP TABLE IF EXISTS partner_invites, partner_memberships;   -- (their trigger functions with them: assert_partner_invite_moves, assert_partner_membership_moves)
--   DELETE FROM role_permissions WHERE permission_code LIKE 'partner.%'; DELETE FROM permissions WHERE code LIKE 'partner.%';
--   DELETE FROM roles WHERE scope = 'partner';
--   ALTER TABLE roles DROP CONSTRAINT roles_scope_check, ADD CONSTRAINT roles_scope_check CHECK (scope IN ('tenant','platform'));
--   UPDATE financial_partners SET ... (the fixture rename is NOT reversed: the old name and licence were never a real partner's row).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 225.1  ROLES AS DATA: the 'partner' scope, four roles, eight permissions, the matrix
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
ALTER TABLE roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('tenant', 'platform', 'partner'));

INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code) VALUES
  ('partner_admin',   'Partner administrator', 'partner', false, false, 'M19'),
  ('partner_checker', 'Partner checker (decides applications)', 'partner', false, false, 'M19'),
  ('partner_maker',   'Partner maker (starts reviews)', 'partner', false, false, 'M19'),
  ('partner_viewer',  'Partner viewer (reads applications)', 'partner', false, false, 'M19')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('partner.applications.read',   'Partner console: read the consented loan applications on this partner''s products', 'M19'),
  ('partner.applications.review', 'Partner console: start the review of a consented application (maker)', 'M19'),
  ('partner.applications.decide', 'Partner console: approve or reject a consented application under review (checker) — never disburse', 'M19'),
  ('partner.team.manage',         'Partner console: invite, revoke an invite, remove a member (with a reason)', 'M19'),
  ('partner.keys.read',           'Partner console: read this partner''s API keys (prefix, scopes — never a secret)', 'M19'),
  ('partner.keys.revoke',         'Partner console: revoke one of this partner''s API keys (not built in PARTNER-0)', 'M19'),
  ('partner.webhooks.read',       'Partner console: read this partner''s webhook endpoints and deliveries (not built in PARTNER-0)', 'M19'),
  ('partner.settings.read',       'Partner console: read this partner''s organisation settings', 'M19')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON
       (r.code = 'partner_admin'   AND p.code LIKE 'partner.%')
    OR (r.code = 'partner_checker' AND p.code IN ('partner.applications.read', 'partner.applications.decide'))
    OR (r.code = 'partner_maker'   AND p.code IN ('partner.applications.read', 'partner.applications.review'))
    OR (r.code = 'partner_viewer'  AND p.code IN ('partner.applications.read'))
 WHERE r.scope = 'partner'
ON CONFLICT DO NOTHING;

-- A partner role is never a tenant role (and a person's tenant token can therefore never carry partner.* by an assignment).
CREATE OR REPLACE FUNCTION trg_utr_no_partner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.scope = 'partner') THEN
    RAISE EXCEPTION '[PARTNER_ROLE_NOT_TENANT] a partner role is held inside a partner organisation, never inside a tenant — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_utr_no_partner_role ON user_tenant_roles;
CREATE TRIGGER trg_utr_no_partner_role BEFORE INSERT OR UPDATE OF role_id ON user_tenant_roles FOR EACH ROW EXECUTE FUNCTION trg_utr_no_partner_role();

-- app.user_id as a uuid, or NULL when unset / not a uuid (a job's 'system') — never an error inside a policy.
CREATE OR REPLACE FUNCTION kv_session_user_uuid() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 225.2  PARTNER MEMBERSHIPS (person × partner × role)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE partner_memberships (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         uuid NOT NULL REFERENCES users(id),
  partner_id      uuid NOT NULL REFERENCES financial_partners(id),
  role_id         uuid NOT NULL REFERENCES roles(id),
  is_active       boolean NOT NULL DEFAULT true,
  invited_by      uuid REFERENCES users(id),
  invite_id       uuid,
  removed_at      timestamptz,
  removed_by      uuid REFERENCES users(id),
  removed_reason  text,
  CONSTRAINT uq_pm_user_partner_role UNIQUE (user_id, partner_id, role_id),
  CONSTRAINT ck_pm_removed_whole CHECK (removed_at IS NULL OR (NOT is_active AND removed_by IS NOT NULL
                                        AND char_length(btrim(COALESCE(removed_reason, ''))) BETWEEN 10 AND 500))
);
CALL add_std_columns('partner_memberships');
COMMENT ON TABLE partner_memberships IS
  'PC-56 PARTNER-0 (founder D1): a person''s role INSIDE a financial partner organisation (person × partner × role; roles.scope = ''partner''). '
  'A partner session (sessions.realm = ''partner'') is minted only for a person with an active row here. Removal is a reason, never a DELETE; '
  'the last active partner_admin cannot be removed.';
CREATE INDEX idx_pm_partner ON partner_memberships (partner_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_pm_user ON partner_memberships (user_id) WHERE is_active AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION kv_is_partner_admin(p_partner uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM partner_memberships m JOIN roles r ON r.id = m.role_id
                  WHERE m.partner_id = p_partner AND m.user_id = p_user AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin');
$$;
REVOKE ALL ON FUNCTION kv_is_partner_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_is_partner_admin(uuid, uuid) TO kv_app;

CREATE OR REPLACE FUNCTION assert_partner_membership_moves() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_scope text; v_admin boolean; v_others integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[PARTNER_MEMBERSHIP_FINAL] a membership is removed with a reason, never deleted — PC-56 PARTNER-0' USING ERRCODE = '42501';
  END IF;
  SELECT r.scope INTO v_scope FROM roles r WHERE r.id = NEW.role_id;
  IF v_scope IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION '[PARTNER_ROLE_REQUIRED] a partner membership carries a partner role — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id <> OLD.user_id OR NEW.partner_id <> OLD.partner_id THEN
      RAISE EXCEPTION '[PARTNER_MEMBERSHIP_FINAL] who and where a membership is are fixed — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    -- THE LAST ADMIN: an active partner_admin row going inactive needs another active partner_admin of the same partner (one decision at a time).
    SELECT (r.code = 'partner_admin') INTO v_admin FROM roles r WHERE r.id = OLD.role_id;
    IF COALESCE(v_admin, false) AND OLD.is_active AND OLD.deleted_at IS NULL AND (NOT NEW.is_active OR NEW.deleted_at IS NOT NULL OR NEW.role_id <> OLD.role_id) THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('kv_partner_admins:' || OLD.partner_id::text, 0));
      SELECT count(*)::int INTO v_others FROM partner_memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.partner_id = OLD.partner_id AND m.id <> OLD.id AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin';
      IF v_others = 0 THEN
        RAISE EXCEPTION '[PARTNER_LAST_ADMIN] this is the last administrator of the partner — appoint another first — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pm_moves BEFORE INSERT OR UPDATE OR DELETE ON partner_memberships FOR EACH ROW EXECUTE FUNCTION assert_partner_membership_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 225.3  PARTNER INVITES (the 0199 staff_invites shape, on the partner axis)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE partner_invites (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  partner_id       uuid NOT NULL REFERENCES financial_partners(id),
  phone            varchar(20) NOT NULL CONSTRAINT ck_pi_phone CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role_id          uuid NOT NULL REFERENCES roles(id),
  invited_by       uuid NOT NULL REFERENCES users(id),
  language_code    varchar(8) NOT NULL DEFAULT 'en' REFERENCES languages(code),
  token_hash       char(64) NOT NULL CONSTRAINT uq_pi_token UNIQUE,
  token_sealed     text,
  expires_at       timestamptz NOT NULL,
  status           varchar(10) NOT NULL DEFAULT 'pending' CONSTRAINT ck_pi_status CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  sent_at          timestamptz,
  send_failure     varchar(80),
  accepted_user_id uuid REFERENCES users(id),
  accepted_at      timestamptz,
  revoked_by       uuid REFERENCES users(id),
  revoked_at       timestamptz,
  revoked_reason   text,
  expired_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pi_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_pi_accepted_whole CHECK (status <> 'accepted' OR (accepted_user_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CONSTRAINT ck_pi_revoked_whole CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL
                                        AND char_length(btrim(COALESCE(revoked_reason, ''))) BETWEEN 10 AND 500)),
  CONSTRAINT ck_pi_sealed_only_pending CHECK (token_sealed IS NULL OR status = 'pending')
);
CREATE UNIQUE INDEX uq_pi_one_pending ON partner_invites (partner_id, phone) WHERE status = 'pending';
CREATE INDEX idx_pi_partner ON partner_invites (partner_id, created_at DESC, id DESC);
ALTER TABLE partner_memberships ADD CONSTRAINT fk_pm_invite FOREIGN KEY (invite_id) REFERENCES partner_invites(id);
COMMENT ON TABLE partner_invites IS
  'PC-56 PARTNER-0 (founder D4): a partner_admin invites a phone into a partner role. The raw token is returned once and sent once by SMS '
  '(outbox partner.member_invited); the database keeps sha256(token) and a KEK-sealed copy the SMS handler clears. Accepting needs the '
  'token AND an OTP on the invited phone; one pending invite per phone per partner; 7 days; single use.';

CREATE OR REPLACE FUNCTION assert_partner_invite_moves() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_scope text; v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[PARTNER_INVITE_FINAL] an invite is never deleted — revoke it with a reason — PC-56 PARTNER-0' USING ERRCODE = '42501';
  END IF;
  v_session := kv_session_user_uuid();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.accepted_user_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.sent_at IS NOT NULL THEN
      RAISE EXCEPTION '[PARTNER_INVITE_BORN_PENDING] an invite is born pending and unsent — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.scope INTO v_scope FROM roles r WHERE r.id = NEW.role_id;
    IF v_scope IS DISTINCT FROM 'partner' THEN
      RAISE EXCEPTION '[PARTNER_ROLE_REQUIRED] an invite carries a partner role — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS NULL OR v_session <> NEW.invited_by OR NOT kv_is_partner_admin(NEW.partner_id, NEW.invited_by) THEN
      RAISE EXCEPTION '[PARTNER_INVITE_NOT_ADMIN] only a partner administrator invites, in their own session — PC-56 PARTNER-0' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now(); NEW.expires_at := now() + interval '7 days';
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.partner_id <> OLD.partner_id OR NEW.phone <> OLD.phone OR NEW.role_id <> OLD.role_id OR NEW.invited_by <> OLD.invited_by
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
CREATE TRIGGER trg_pi_moves BEFORE INSERT OR UPDATE OR DELETE ON partner_invites FOR EACH ROW EXECUTE FUNCTION assert_partner_invite_moves();

-- The public invite page knows only a token: which partner is it for (before any partner is in scope)? One question, one answer.
CREATE OR REPLACE FUNCTION partner_invite_partner(p_token_hash char(64)) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT partner_id FROM partner_invites WHERE token_hash = p_token_hash;
$$;
REVOKE ALL ON FUNCTION partner_invite_partner(char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_invite_partner(char) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 225.4  SESSIONS KNOW THEIR REALM
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS realm varchar(10) NOT NULL DEFAULT 'tenant';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES financial_partners(id);
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm;
ALTER TABLE sessions ADD CONSTRAINT ck_sessions_realm CHECK (realm IN ('tenant', 'partner'));
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm_partner;
ALTER TABLE sessions ADD CONSTRAINT ck_sessions_realm_partner CHECK ((realm = 'partner') = (partner_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_sessions_partner_user ON sessions (partner_id, user_id) WHERE revoked_at IS NULL AND partner_id IS NOT NULL;
COMMENT ON COLUMN sessions.realm IS
  'PC-56 PARTNER-0: ''tenant'' (the access token carries tid) or ''partner'' (the access token carries pid + realm, no tid). A refresh token '
  'refreshes only inside its own realm.';

-- ------------------------------------------------------------------------------------------------------------------
-- 225.5  THE CONSENT-GATED READ ON THE kv_partner AXIS (0090's role, GUC and NULL guard, reused)
-- ------------------------------------------------------------------------------------------------------------------
-- Column-level, deliberately: never applicant_user_id / purpose_text / decision_note / created_by / updated_by / nwr_id / credit_score_id / group_id.
GRANT SELECT (id, tenant_id, product_id, amount_requested_minor, status, decision_at, amount_approved_minor, cooling_off_until, created_at, updated_at, deleted_at)
  ON loan_applications TO kv_partner;

CREATE INDEX IF NOT EXISTS idx_loanapps_product ON loan_applications (product_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_csc_purpose ON credit_score_consents (purpose_ref, partner_id);

-- THE ORACLE (founder D2): the product's partner is the session's partner AND the applicant's live consent for THIS partner and THIS application.
CREATE OR REPLACE FUNCTION partner_owns_application(p_application_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM loan_applications la JOIN loan_products lp ON lp.id = la.product_id
     WHERE la.id = p_application_id
       AND current_partner_id() IS NOT NULL
       AND lp.partner_id = current_partner_id()
       AND EXISTS (SELECT 1 FROM credit_score_consents c WHERE c.user_id = la.applicant_user_id AND c.partner_id = lp.partner_id AND c.purpose_ref = la.id::text AND (c.expires_at IS NULL OR c.expires_at > now()))
  );
$$;
REVOKE ALL ON FUNCTION partner_owns_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_owns_application(uuid) TO kv_partner;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loan_applications' AND policyname = 'partner_own_book_loan_applications') THEN
    CREATE POLICY partner_own_book_loan_applications ON loan_applications FOR SELECT TO kv_partner
      USING (current_partner_id() IS NOT NULL AND partner_owns_application(id));
  END IF;
END $$;

-- This partner's products: id, name, the loan kind (the purpose CATEGORY) — never another partner's, never pricing internals.
CREATE OR REPLACE FUNCTION partner_loan_products() RETURNS TABLE (id uuid, name text, kind_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT lp.id, lp.default_name::text, lv.code::text
    FROM loan_products lp LEFT JOIN lookup_values lv ON lv.id = lp.product_kind_id
   WHERE current_partner_id() IS NOT NULL AND lp.partner_id = current_partner_id() AND lp.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION partner_loan_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_products() TO kv_partner;

-- The applicant's own words — withheld until the owned application is approved (founder D2), then printed.
CREATE OR REPLACE FUNCTION partner_application_purpose(p_application_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT la.purpose_text::text FROM loan_applications la
   WHERE la.id = p_application_id AND la.status IN ('approved', 'disbursed') AND partner_owns_application(la.id);
$$;
REVOKE ALL ON FUNCTION partner_application_purpose(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_application_purpose(uuid) TO kv_partner;

-- A masked phone ('••••••' + the last 3 digits) ONLY after approval of an owned application; NULL before, NULL for anything not owned.
CREATE OR REPLACE FUNCTION partner_applicant_phone_masked(p_application_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT repeat('•', 6) || right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 3)
    FROM loan_applications la JOIN users u ON u.id = la.applicant_user_id
   WHERE la.id = p_application_id AND la.status IN ('approved', 'disbursed') AND partner_owns_application(la.id);
$$;
REVOKE ALL ON FUNCTION partner_applicant_phone_masked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_applicant_phone_masked(uuid) TO kv_partner;

-- The team read on the axis: this partner's people (name, masked phone, roles, 2FA state) — kv_partner holds no grant on users.
CREATE OR REPLACE FUNCTION partner_team() RETURNS TABLE (
  membership_id uuid, user_id uuid, full_name text, phone_masked text, role_code text, is_active boolean, since timestamptz,
  removed_at timestamptz, removed_reason text, two_factor boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.user_id, u.full_name::text, repeat('•', 6) || right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 3), r.code::text, m.is_active,
         m.created_at, m.removed_at, m.removed_reason,
         EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = m.user_id AND t.confirmed_at IS NOT NULL AND t.disabled_at IS NULL)
    FROM partner_memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
   WHERE current_partner_id() IS NOT NULL AND m.partner_id = current_partner_id() AND m.deleted_at IS NULL
   ORDER BY m.is_active DESC, m.created_at, m.id;
$$;
REVOKE ALL ON FUNCTION partner_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_team() TO kv_partner;

CREATE OR REPLACE FUNCTION partner_pending_invites() RETURNS TABLE (
  id uuid, phone_masked text, role_code text, invited_by uuid, expires_at timestamptz, sent_at timestamptz, send_failure text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, repeat('•', 6) || right(regexp_replace(i.phone, '[^0-9]', '', 'g'), 3), r.code::text, i.invited_by, i.expires_at, i.sent_at, i.send_failure::text, i.created_at
    FROM partner_invites i JOIN roles r ON r.id = i.role_id
   WHERE current_partner_id() IS NOT NULL AND i.partner_id = current_partner_id() AND i.status = 'pending' AND i.expires_at > now()
   ORDER BY i.created_at DESC, i.id DESC LIMIT 100;
$$;
REVOKE ALL ON FUNCTION partner_pending_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_pending_invites() TO kv_partner;

-- ------------------------------------------------------------------------------------------------------------------
-- 225.6  RLS + GRANTS on the two new tables; the partner-realm audit row
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE partner_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE partner_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_invites FORCE ROW LEVEL SECURITY;

CREATE POLICY partner_memberships_partner_read ON partner_memberships FOR SELECT TO kv_partner
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_memberships_app_self ON partner_memberships FOR SELECT TO kv_app
  USING (kv_session_user_uuid() IS NOT NULL AND user_id = kv_session_user_uuid());
CREATE POLICY partner_memberships_app_read ON partner_memberships FOR SELECT TO kv_app
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_memberships_app_insert ON partner_memberships FOR INSERT TO kv_app
  WITH CHECK (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_memberships_app_update ON partner_memberships FOR UPDATE TO kv_app
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id())
  WITH CHECK (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());

CREATE POLICY partner_invites_partner_read ON partner_invites FOR SELECT TO kv_partner
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_invites_app_read ON partner_invites FOR SELECT TO kv_app
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_invites_app_insert ON partner_invites FOR INSERT TO kv_app
  WITH CHECK (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());
CREATE POLICY partner_invites_app_update ON partner_invites FOR UPDATE TO kv_app
  USING (current_partner_id() IS NOT NULL AND partner_id = current_partner_id())
  WITH CHECK (current_partner_id() IS NOT NULL AND partner_id = current_partner_id());

-- The default-privilege trap (0090): revoke what 0014/0018 handed out, then grant the narrowest set.
REVOKE ALL ON partner_memberships, partner_invites FROM kv_app, kv_relay, kv_readonly, PUBLIC;
GRANT SELECT, INSERT ON partner_memberships TO kv_app;
GRANT UPDATE (role_id, is_active, invited_by, invite_id, removed_at, removed_by, removed_reason, updated_at, updated_by) ON partner_memberships TO kv_app;
GRANT SELECT, INSERT ON partner_invites TO kv_app;
GRANT UPDATE (status, token_sealed, sent_at, send_failure, accepted_user_id, accepted_at, revoked_by, revoked_at, revoked_reason, expired_at, updated_at) ON partner_invites TO kv_app;
GRANT SELECT ON partner_memberships TO kv_partner;
-- never the phone, the token hash or the sealed token to the axis role
GRANT SELECT (id, partner_id, role_id, invited_by, status, expires_at, sent_at, send_failure, accepted_at, revoked_at, created_at) ON partner_invites TO kv_partner;

-- A partner-realm audit row has no tenant: allowed to kv_app ONLY inside a transaction that names a partner, and only for THAT partner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'al_insert_partner_realm') THEN
    CREATE POLICY al_insert_partner_realm ON audit_log FOR INSERT TO kv_app
      WITH CHECK (tenant_id IS NULL AND current_partner_id() IS NOT NULL AND (new_value ->> 'partnerId') = current_partner_id()::text);
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 225.7  kv_app ORACLES
-- ------------------------------------------------------------------------------------------------------------------
-- The tenant-side product-owner rule (founder D3): does this partner decide its own applications in its console?
CREATE OR REPLACE FUNCTION partner_has_console_members(p_partner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM partner_memberships m WHERE m.partner_id = p_partner AND m.is_active AND m.deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION partner_has_console_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_has_console_members(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 225.8  THE FLAG · THE SMS WORDS · THE FIXTURE RENAME
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('partner_console',
   'PC-56 PARTNER-0 (founder D6, Law 10): the partner console realm (/v1/partner/*: sign-in to a partner organisation, its team, the consent-gated applications read and decisions). Platform-scoped (evaluated with no tenant), fail-closed: OFF = every /v1/partner/* route answers 404',
   false, 100, '{}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ui_messages (key, language_code, text) VALUES
  ('partner.invite.sms.code', 'en', '{org} invited you to its partner console as {role}. On the console''s invite page enter code {code}, then the code we send to this phone. Valid {days} days.'),
  ('partner.invite.sms.code', 'hi', '{org} ने आपको अपने पार्टनर कंसोल में {role} के रूप में आमंत्रित किया है। कंसोल के निमंत्रण पेज पर कोड {code} डालें, फिर इस फ़ोन पर भेजा गया कोड। {days} दिन तक मान्य।'),
  ('partner.invite.sms.code', 'gu', '{org} એ તમને તેના પાર્ટનર કન્સોલમાં {role} તરીકે આમંત્રણ આપ્યું છે. કન્સોલના આમંત્રણ પેજ પર કોડ {code} દાખલ કરો, પછી આ ફોન પર મોકલેલો કોડ. {days} દિવસ માન્ય.'),
  ('partner.role.partner_admin', 'en', 'administrator'),
  ('partner.role.partner_admin', 'hi', 'प्रशासक'),
  ('partner.role.partner_admin', 'gu', 'વ્યવસ્થાપક'),
  ('partner.role.partner_checker', 'en', 'checker'),
  ('partner.role.partner_checker', 'hi', 'जाँचकर्ता'),
  ('partner.role.partner_checker', 'gu', 'ચકાસનાર'),
  ('partner.role.partner_maker', 'en', 'maker'),
  ('partner.role.partner_maker', 'hi', 'प्रस्तावक'),
  ('partner.role.partner_maker', 'gu', 'પ્રસ્તાવક'),
  ('partner.role.partner_viewer', 'en', 'viewer'),
  ('partner.role.partner_viewer', 'hi', 'दर्शक'),
  ('partner.role.partner_viewer', 'gu', 'દર્શક')
ON CONFLICT (key, language_code) DO NOTHING;

-- Founder D7: the rules seed's lending fixture (fixed id …0001) carried a real-sounding NBFC name and an invented RBI licence number.
-- BEFORE: code / name as seeded by rules/0208 (a real-sounding NBFC), regulator_ref 'RBI-NBFC-0001'.
-- AFTER:  code 'fixture_nbfc', name 'Fixture Lending Partner', regulator_ref NULL. Guarded on the fixture's own invented licence, so a row an
-- operator has already re-authored is never touched. (Seed rules/0208 now inserts the neutral row for a database built from empty.)
UPDATE financial_partners
   SET code = 'fixture_nbfc', default_name = 'Fixture Lending Partner', regulator_ref = NULL
 WHERE id = '22222222-0000-7000-8000-000000000001' AND regulator_ref = 'RBI-NBFC-0001';
