-- ==================================================================================================================
-- MIGRATION 0239 — PC-56 GOV-0 · A GOVERNMENT AUTHORITY IS AN ORGANISATION — the government realm: an authority's own
-- people (memberships with an end date and a second person), its own sign-in (`sessions.realm = 'gov'`), its own roles,
-- and a RECORDED read of applications to the schemes it runs, across organisations, on the `kv_gov` axis.
-- (GOV-1 Q2-A, Q3-A, Q4-A and Q5-A, applied by the lead on 2026-11-10 under the founder's instruction of that day:
-- "please choose recommended option and start at your end next step … think as you are product owner" — `survey_gov1.md`
-- "WHAT A GOVERNMENT USER IS ON THE PLATFORM TODAY", §2 F-2/F-4/F-5/F-7, §3 GOV1-B4/B7, §5 item 2, §6 Q2–Q5; brief
-- `wave-reports/brief_gov0.md` §D/§E. The founder may reopen Q2–Q5.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0238 are applied; nothing here edits them. REUSED
-- UNCHANGED: 0011's `scheme_authorities` / `schemes.authority_id` (NOT NULL — the "house link" is direct) / `scheme_applications`;
-- 0014's tenant_isolation policies; 0090's NOLOGIN-axis-role pattern (kv_partner); 0181's `audit_read_log` and its
-- `arl_insert` policy; 0199's `user_totp` and `sessions.two_factor_pending`; 0225's `kv_session_user_uuid()`, its
-- `ck_sessions_realm_partner` and `trg_utr_no_partner_role` (the shape copied); 0238's `trg_utr_no_gov_role` (unchanged,
-- beside this file's `trg_utr_no_authority_role`). 0225's `ck_sessions_realm` is REPLACED BY NAME to admit 'gov' — the file
-- 0225 is untouched; every value it admitted is still admitted.)
--
-- CLASS — PII/TRUST — CODEOWNERS, the founder's Law 9 / Law 11 review. Identity infrastructure: who a government official is,
-- how they sign in, who may give them a role, and what of a farmer's application they may read. NOT MONEY: no ledger table, no
-- posting, no money column is written or read here (a government session reads no amount at all).
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   239.1  `roles.scope` admits 'authority' (the `roles_scope_check` CHECK replaced by name, 0225's way); TWO roles —
--          `authority_head`, `authority_officer` — and FIVE permissions; seed core/0004 carries the same rows, guarded on this file.
--          THE MATRIX:  authority_head     every authority.* permission
--                       authority_officer  authority.applications.read · authority.members.read · authority.members.request
--          Role separation by duty (scheme / verification / finance / field — survey GOV1-B8) is NAMED, not built.
--          An authority role is never held inside a tenant (`trg_utr_no_authority_role`, the 0225 :119 shape).
--   239.2  `current_authority_id()` (the `app.authority_id` GUC, NULL when unset — 0090's `current_partner_id()` shape) and the
--          NOLOGIN axis role `kv_gov` (kv_app holds it WITH INHERIT FALSE: only an explicit `SET LOCAL ROLE kv_gov` wears it).
--   239.3  `authority_memberships` — person × authority × role, ONE table with three states (0225's memberships + requests as one):
--            requested → active   only when a SECOND person approves: never the requester, never the grantee — two CHECKs
--                                 (ck_am_approver_not_requester, ck_am_approver_not_grantee) AND the guard trigger (the 0233/0237
--                                 shape); the approver must be a live head of THAT authority, in their own session;
--            requested → removed  withdrawn by a head, with a reason;
--            active    → removed  ONE head, at once, with a reason (Q4-A — the API cuts the person's gov sessions in the same
--                                 transaction); never your own row.
--          EVERY approved row has `expires_at` = the approval + `term_months` (1–12; CHECK `expires_at <= approved_at + 12 months`)
--          — set HERE by the guard, never by the caller. An active row past its `expires_at` resolves NO permission (the oracles
--          below) and its gov sessions refresh to 401. `removed` is final; nothing is ever DELETEd.
--          THE FIRST HEAD is appointed by the PLATFORM only: `kv_admin` (the admin realm — FIDO2 + step-up at the route) may INSERT
--          one `authority_head` row, born active, only while the authority has NO live head; `requested_by_admin_id` records who.
--   239.4  `sessions.realm` admits 'gov' + `sessions.authority_id` + CHECK ((realm = 'gov') = (authority_id IS NOT NULL)). A
--          refresh token of one realm never refreshes into another (the repositories filter by realm — 0225's rule).
--   239.5  THE RECORDED, NARROW READ (Q3-A). `kv_gov` holds a COLUMN-LEVEL SELECT on `scheme_applications` — never
--          `applicant_user_id`, `assisted_by`, `form_data`, `govt_app_ref`, `eligibility_check`, `rejection_reason`, `created_by`,
--          `updated_by`. Rows are admitted by `gov_runs_scheme(scheme_id)` (DEFINER): the scheme's `authority_id` IS
--          current_authority_id(). RLS `gov_own_schemes_scheme_applications` FOR SELECT TO kv_gov, NULL-guarded. The form is read
--          ONLY through `gov_application_form(id)` (DEFINER, kv_gov only): the stored `form_data` of an admitted application with
--          phone / Aadhaar / bank / account / IFSC / UPI / PAN keys MASKED to six bullets + the last 3 characters, and every
--          location key (lat / lng / geo / gps / location / coordinates / trace / address / boundary / polygon) DROPPED — no
--          officer-of-record notion exists for an authority, so no officer receives a location (reported). The schemes carry no
--          form schema, so "only the fields the scheme asks for" cannot be told apart from the stored fields (reported).
--          EVERY OPENING is recorded by the API in `audit_read_log` (0181's table, REUSED): a TENANT row of the application's
--          organisation (who, `gov:<authority>:<roles>`, purpose `gov_application_open`, the authority and the application) —
--          the organisation sees it through 0181's `arl_read`. A list writes one `gov_application_list` row per organisation.
--   239.6  THE MEMBERSHIP SURFACE IS DEFINER FUNCTIONS ONLY. kv_app / kv_relay / kv_readonly / PUBLIC hold NOTHING on
--          `authority_memberships` (REVOKE ALL first — 0090's default-privilege trap; a direct SELECT is 42501). kv_app EXECUTEs:
--            gov_my_authorities()                       the session person's live authorities (sign-in)
--            gov_access(user, authority)                roles + permissions of a LIVE (active, unexpired) membership — the guard,
--                                                       the refresh and the sign-in resolve through this one oracle
--            gov_authority_memberships()                the authority's people (current_authority_id()), phones masked
--            gov_membership_get(id)                     one row of the current authority (the domain's facts)
--            gov_membership_request(user, role, term, reason)   → the new row id (requested_by = the session person)
--            gov_membership_approve(id)                 → true when moved (approved_by = the session person)
--            gov_membership_remove(id, reason)          → true when moved (removed_by = the session person)
--            gov_authority_live_heads(authority)        a count (the admin realm's "no head yet" check uses its own read)
--          kv_admin: SELECT (non-personal columns) + INSERT (the appointment columns) with two policies.
--   239.7  `al_insert_gov_realm` — kv_app may write an audit row with NO tenant only inside a transaction naming an authority
--          (app.authority_id) and only when the row names that same authority (new_value->>'authorityId'). Two
--          `audit_read_purposes` rows. Flag `gov_console` OFF (Law 10, platform-scoped, fail-closed).
--
-- RLS — the gate count RISES by 4 policies on parent tables (authority_memberships ×2 for kv_admin,
-- scheme_applications ×1 for kv_gov, audit_log ×1); `ensure_partitions` then copies the audit_log one onto its partitions.
-- authority_memberships is ENABLE + FORCE.
--
-- OWNER: every DEFINER function assumes the migration owner bypasses RLS on a FORCE-RLS table (true of 0090's, 0204's and
-- 0225's oracles). If the production owner does not, the oracles answer "nothing" — fail closed. (PARTNER-0 §2.5, restated.)
-- The guard is SECURITY INVOKER: inside a DEFINER function `session_user` is still kv_app, so the guard's hand-repair branch
-- (a SUPERUSER LOGIN acting directly: `session_user` superuser AND current_user = session_user — fixtures, an operator) can
-- never be reached through the API.
--
-- SHARDS: roles, permissions, scheme_authorities, schemes, authority_memberships and sessions are control-plane / reference rows
-- read on shard 0 (the 0225 posture); `scheme_applications` and `audit_read_log` live on the application's TENANT shard — the API
-- scatters the read over every shard and writes each recorded read on that shard. Every shard runs this file unchanged.
--
-- REVERSAL (hand-run, never by the runner; revert the API's modules/gov-console, the admin-api head appointment and the gov
-- TwoFactorService branch FIRST):
--   DELETE FROM feature_flags WHERE key = 'gov_console';
--   DROP POLICY IF EXISTS al_insert_gov_realm ON audit_log;   -- (and on each audit_log partition ensure_partitions copied it to)
--   DROP POLICY IF EXISTS gov_own_schemes_scheme_applications ON scheme_applications;
--   REVOKE SELECT ON scheme_applications FROM kv_gov;
--   DROP FUNCTION IF EXISTS gov_runs_scheme(uuid), gov_application_form(uuid), gov_mask_form(jsonb), gov_authority_schemes(),
--     gov_my_authorities(), gov_access(uuid, uuid), gov_authority_memberships(), gov_membership_get(uuid),
--     gov_membership_request(uuid, text, smallint, text), gov_membership_approve(uuid), gov_membership_remove(uuid, text),
--     gov_authority_live_heads(uuid), kv_is_authority_member(uuid, uuid), kv_is_authority_head(uuid, uuid), kv_authority_role_code(uuid);
--   ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm_gov, DROP COLUMN IF EXISTS authority_id;
--   ALTER TABLE sessions DROP CONSTRAINT ck_sessions_realm, ADD CONSTRAINT ck_sessions_realm CHECK (realm IN ('tenant', 'partner'));
--     -- (only once no 'gov' session row exists)
--   DROP TABLE IF EXISTS authority_memberships;   -- (its guard function with it: assert_authority_membership_moves)
--   DROP TRIGGER IF EXISTS trg_utr_no_authority_role ON user_tenant_roles; DROP FUNCTION IF EXISTS trg_utr_no_authority_role();
--   DELETE FROM audit_read_purposes WHERE code IN ('gov_application_open', 'gov_application_list');   -- (only if no row uses them)
--   DELETE FROM role_permissions WHERE permission_code LIKE 'authority.%'; DELETE FROM permissions WHERE code LIKE 'authority.%';
--   DELETE FROM roles WHERE scope = 'authority';
--   ALTER TABLE roles DROP CONSTRAINT roles_scope_check, ADD CONSTRAINT roles_scope_check CHECK (scope IN ('tenant', 'platform', 'partner'));
--   REVOKE kv_gov FROM kv_app; (the cluster role kv_gov is left — other databases on the cluster may hold its grants)
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 239.1  ROLES AS DATA: the 'authority' scope, two roles, five permissions, the matrix
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
ALTER TABLE roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('tenant', 'platform', 'partner', 'authority'));

INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code) VALUES
  ('authority_head',    'Authority head (approves and removes the authority''s roles)', 'authority', false, true, 'M17'),
  ('authority_officer', 'Authority officer (reads applications to the authority''s schemes)', 'authority', false, true, 'M17')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('authority.applications.read', 'Government console: read applications to this authority''s schemes (masked; every opening recorded)', 'M17'),
  ('authority.members.read',      'Government console: read this authority''s people and their roles', 'M17'),
  ('authority.members.request',   'Government console: request a role for a person (a second person approves)', 'M17'),
  ('authority.members.approve',   'Government console: approve a requested role (never your own request, never for yourself)', 'M17'),
  ('authority.members.remove',    'Government console: remove a role at once, with a reason', 'M17')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON
       (r.code = 'authority_head'    AND p.code LIKE 'authority.%')
    OR (r.code = 'authority_officer' AND p.code IN ('authority.applications.read', 'authority.members.read', 'authority.members.request'))
 WHERE r.scope = 'authority'
ON CONFLICT DO NOTHING;

-- An authority role is never a tenant role.
CREATE OR REPLACE FUNCTION trg_utr_no_authority_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.scope = 'authority') THEN
    RAISE EXCEPTION '[GOV_ROLE_NOT_TENANT] an authority role is held inside an authority, never inside a tenant — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_utr_no_authority_role ON user_tenant_roles;
CREATE TRIGGER trg_utr_no_authority_role BEFORE INSERT OR UPDATE OF role_id ON user_tenant_roles FOR EACH ROW EXECUTE FUNCTION trg_utr_no_authority_role();

-- ------------------------------------------------------------------------------------------------------------------
-- 239.2  THE AUTHORITY AXIS: the GUC and the NOLOGIN role
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_authority_id() RETURNS uuid AS $$
SELECT NULLIF(current_setting('app.authority_id', true), '')::uuid; $$ LANGUAGE sql STABLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kv_gov') THEN
    CREATE ROLE kv_gov NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO kv_gov;
GRANT kv_gov TO kv_app WITH INHERIT FALSE;

-- ------------------------------------------------------------------------------------------------------------------
-- 239.3  AUTHORITY MEMBERSHIPS (person × authority × role; requested → active → removed)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE authority_memberships (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  authority_id           uuid NOT NULL REFERENCES scheme_authorities(id),
  user_id                uuid NOT NULL REFERENCES users(id),
  role_id                uuid NOT NULL REFERENCES roles(id),
  status                 varchar(10) NOT NULL DEFAULT 'requested',
  term_months            smallint NOT NULL,
  requested_by           uuid REFERENCES users(id),
  requested_by_admin_id  uuid,
  request_reason         text NOT NULL,
  approved_by            uuid REFERENCES users(id),
  approved_at            timestamptz,
  expires_at             timestamptz,
  removed_by             uuid REFERENCES users(id),
  removed_at             timestamptz,
  removed_reason         text,
  CONSTRAINT ck_am_status CHECK (status IN ('requested', 'active', 'removed')),
  CONSTRAINT ck_am_term CHECK (term_months BETWEEN 1 AND 12),
  CONSTRAINT ck_am_one_origin CHECK (num_nonnulls(requested_by, requested_by_admin_id) = 1),
  CONSTRAINT ck_am_request_reason CHECK (char_length(btrim(request_reason)) BETWEEN 10 AND 500),
  -- THE TWO-PERSON RULE, for every role in the database (owner included): the approver is never the requester, never the grantee.
  CONSTRAINT ck_am_approver_not_requester CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_am_approver_not_grantee CHECK (approved_by IS NULL OR approved_by <> user_id),
  -- an approval is whole: when, until when, and who (a person, or the platform's appointment)
  CONSTRAINT ck_am_approval_whole CHECK ((approved_at IS NULL) = (expires_at IS NULL)
                                         AND (approved_at IS NULL OR approved_by IS NOT NULL OR requested_by_admin_id IS NOT NULL)),
  CONSTRAINT ck_am_active_approved CHECK (status <> 'active' OR approved_at IS NOT NULL),
  CONSTRAINT ck_am_requested_bare CHECK (status <> 'requested' OR (approved_at IS NULL AND approved_by IS NULL AND removed_at IS NULL)),
  -- THE END DATE: after the approval, at most 12 months after it
  CONSTRAINT ck_am_expiry CHECK (expires_at IS NULL OR (expires_at > approved_at AND expires_at <= approved_at + interval '12 months')),
  CONSTRAINT ck_am_removed_whole CHECK ((status = 'removed') = (removed_at IS NOT NULL)
                                        AND (removed_at IS NULL OR (removed_by IS NOT NULL
                                             AND char_length(btrim(COALESCE(removed_reason, ''))) BETWEEN 10 AND 500)))
);
CALL add_std_columns('authority_memberships');
-- one live row (pending or active) per person × authority × role; a removed row never blocks a new request
CREATE UNIQUE INDEX uq_am_live ON authority_memberships (authority_id, user_id, role_id) WHERE status IN ('requested', 'active');
CREATE INDEX idx_am_authority ON authority_memberships (authority_id, created_at DESC, id DESC);
CREATE INDEX idx_am_user_live ON authority_memberships (user_id) WHERE status = 'active';
COMMENT ON TABLE authority_memberships IS
  'PC-56 GOV-0 (GOV-1 Q2-A/Q4-A, lead-applied 2026-11-10; the founder may reopen): a person''s role INSIDE a government authority '
  '(scheme_authorities). requested → active only when a second person (a live head, never the requester, never the grantee) approves; '
  'every approval ends at most 12 months later; removal is one head, at once, with a reason; the first head is appointed by the '
  'platform (kv_admin). A gov session (sessions.realm = ''gov'') is minted only for a person with a live row here. Never deleted.';

-- the role code of an AUTHORITY role (NULL for any other scope)
CREATE OR REPLACE FUNCTION kv_authority_role_code(p_role uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.code::text FROM roles r WHERE r.id = p_role AND r.scope = 'authority';
$$;
CREATE OR REPLACE FUNCTION kv_is_authority_member(p_authority uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM authority_memberships m
                  WHERE m.authority_id = p_authority AND m.user_id = p_user AND m.status = 'active' AND m.expires_at > now() AND m.deleted_at IS NULL);
$$;
CREATE OR REPLACE FUNCTION kv_is_authority_head(p_authority uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM authority_memberships m JOIN roles r ON r.id = m.role_id
                  WHERE m.authority_id = p_authority AND m.user_id = p_user AND m.status = 'active' AND m.expires_at > now()
                    AND m.deleted_at IS NULL AND r.code = 'authority_head');
$$;
CREATE OR REPLACE FUNCTION gov_authority_live_heads(p_authority uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM authority_memberships m JOIN roles r ON r.id = m.role_id
   WHERE m.authority_id = p_authority AND m.status = 'active' AND m.expires_at > now() AND m.deleted_at IS NULL AND r.code = 'authority_head';
$$;
REVOKE ALL ON FUNCTION kv_authority_role_code(uuid), kv_is_authority_member(uuid, uuid), kv_is_authority_head(uuid, uuid), gov_authority_live_heads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_authority_role_code(uuid), kv_is_authority_member(uuid, uuid), kv_is_authority_head(uuid, uuid), gov_authority_live_heads(uuid) TO kv_app, kv_admin;

-- THE GUARD (SECURITY INVOKER — see the header's OWNER note). Three callers, three branches:
--   kv_admin                                 → only the platform's appointment of a FIRST head (INSERT), never an UPDATE;
--   a SUPERUSER LOGIN acting as itself       → hand repair (fixtures, an operator) — the CHECKs above still hold;
--   anyone else (kv_app through the DEFINER functions: session_user = kv_app) → the request / approve / remove rules.
CREATE OR REPLACE FUNCTION assert_authority_membership_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_admin   boolean := current_user = 'kv_admin';
  v_hand    boolean := current_user = session_user AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolsuper);
  v_session uuid := kv_session_user_uuid();
  v_code    text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] a membership is removed with a reason, never deleted — PC-56 GOV-0' USING ERRCODE = '42501';
  END IF;
  IF v_hand AND NOT v_admin THEN RETURN NEW; END IF;
  v_code := kv_authority_role_code(NEW.role_id);
  IF v_code IS NULL THEN
    RAISE EXCEPTION '[GOV_ROLE_REQUIRED] an authority membership carries an authority role — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_admin THEN
      -- THE PLATFORM APPOINTS A FIRST HEAD — and nothing else; born active, ending term_months from now
      IF NEW.requested_by_admin_id IS NULL OR NEW.requested_by IS NOT NULL OR v_code <> 'authority_head' OR NEW.status <> 'active'
         OR NEW.approved_by IS NOT NULL OR NEW.removed_at IS NOT NULL THEN
        RAISE EXCEPTION '[GOV_PLATFORM_APPOINTS_FIRST_HEAD_ONLY] the platform appoints an authority''s first head, and nothing else — PC-56 GOV-0' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('kv_authority_heads:' || NEW.authority_id::text, 0));
      IF gov_authority_live_heads(NEW.authority_id) > 0 THEN
        RAISE EXCEPTION '[GOV_AUTHORITY_HAS_HEAD] this authority already has a current head — PC-56 GOV-0' USING ERRCODE = 'check_violation';
      END IF;
      NEW.approved_at := now(); NEW.expires_at := now() + make_interval(months => NEW.term_months);
      NEW.created_at := now(); NEW.updated_at := now();
      RETURN NEW;
    END IF;
    -- A REQUEST: born pending, bare, made by the session person, who is a live member of THIS authority
    IF NEW.status <> 'requested' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.expires_at IS NOT NULL
       OR NEW.removed_at IS NOT NULL OR NEW.requested_by_admin_id IS NOT NULL THEN
      RAISE EXCEPTION '[GOV_REQUEST_BORN_PENDING] a role request is born pending — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS NULL OR NEW.requested_by IS DISTINCT FROM v_session OR NOT kv_is_authority_member(NEW.authority_id, v_session) THEN
      RAISE EXCEPTION '[GOV_REQUESTER_NOT_MEMBER] only a current member of this authority requests a role, in their own session — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------------------------------------------
  IF v_admin THEN
    RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] the platform does not edit an authority''s memberships — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.authority_id <> OLD.authority_id OR NEW.user_id <> OLD.user_id OR NEW.role_id <> OLD.role_id
     OR NEW.term_months <> OLD.term_months OR NEW.request_reason IS DISTINCT FROM OLD.request_reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_by_admin_id IS DISTINCT FROM OLD.requested_by_admin_id
     OR NEW.created_at <> OLD.created_at OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR OLD.status = 'removed' THEN
    RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] who, where, which role and how long are fixed, and a removed membership never moves — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.removed_by IS DISTINCT FROM OLD.removed_by OR NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removed_reason IS DISTINCT FROM OLD.removed_reason THEN
      RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] an approval and a removal are written once — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'requested' AND NEW.status = 'active' THEN
    -- THE SECOND PERSON: in their own session, never the requester, never the grantee, a live head of THIS authority
    IF v_session IS NULL OR NEW.approved_by IS DISTINCT FROM v_session THEN
      RAISE EXCEPTION '[GOV_APPROVER_NOT_HEAD] a role is approved by a head of this authority, in their own session — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION '[GOV_APPROVER_IS_REQUESTER] the person who asked for a role cannot approve it — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by = OLD.user_id THEN
      RAISE EXCEPTION '[GOV_APPROVER_IS_GRANTEE] a person cannot approve a role for themselves — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_authority_head(OLD.authority_id, v_session) THEN
      RAISE EXCEPTION '[GOV_APPROVER_NOT_HEAD] only a current head of this authority approves a role — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := now(); NEW.expires_at := now() + make_interval(months => OLD.term_months);
    NEW.removed_by := NULL; NEW.removed_at := NULL; NEW.removed_reason := NULL;
    RETURN NEW;
  END IF;
  IF NEW.status = 'removed' THEN
    -- ONE head, at once, with a reason (the CHECK holds the reason); never their own row
    IF v_session IS NULL OR NEW.removed_by IS DISTINCT FROM v_session OR NOT kv_is_authority_head(OLD.authority_id, v_session) THEN
      RAISE EXCEPTION '[GOV_REMOVER_NOT_HEAD] only a current head of this authority removes a role, in their own session — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.user_id = v_session THEN
      RAISE EXCEPTION '[GOV_REMOVE_SELF] a person cannot remove their own role — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] a removal does not rewrite the approval — PC-56 GOV-0' USING ERRCODE = 'check_violation';
    END IF;
    NEW.removed_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[GOV_MEMBERSHIP_FINAL] % → % is not a move a membership makes — PC-56 GOV-0', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_am_moves BEFORE INSERT OR UPDATE OR DELETE ON authority_memberships FOR EACH ROW EXECUTE FUNCTION assert_authority_membership_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 239.4  SESSIONS KNOW THE GOVERNMENT REALM
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authority_id uuid REFERENCES scheme_authorities(id);
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm;
ALTER TABLE sessions ADD CONSTRAINT ck_sessions_realm CHECK (realm IN ('tenant', 'partner', 'gov'));
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_realm_gov;
ALTER TABLE sessions ADD CONSTRAINT ck_sessions_realm_gov CHECK ((realm = 'gov') = (authority_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_sessions_authority_user ON sessions (authority_id, user_id) WHERE revoked_at IS NULL AND authority_id IS NOT NULL;
COMMENT ON COLUMN sessions.authority_id IS
  'PC-56 GOV-0: set ⇔ a GOVERNMENT-realm session (realm = ''gov''; the access token carries aid + realm, no tid, no pid). A refresh token '
  'refreshes only inside its own realm.';

-- ------------------------------------------------------------------------------------------------------------------
-- 239.5  THE RECORDED, NARROW READ ON THE kv_gov AXIS
-- ------------------------------------------------------------------------------------------------------------------
-- Column-level, deliberately: never applicant_user_id / assisted_by / form_data / govt_app_ref / eligibility_check / rejection_reason /
-- created_by / updated_by.
GRANT SELECT (id, tenant_id, scheme_id, scheme_version, status, submitted_at, decided_at, created_at, updated_at, deleted_at)
  ON scheme_applications TO kv_gov;
CREATE INDEX IF NOT EXISTS idx_schemeapps_scheme ON scheme_applications (scheme_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- THE ORACLE (Q3-A): the scheme is run by the session's authority.
CREATE OR REPLACE FUNCTION gov_runs_scheme(p_scheme_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM schemes s
                  WHERE s.id = p_scheme_id AND current_authority_id() IS NOT NULL AND s.authority_id = current_authority_id());
$$;
REVOKE ALL ON FUNCTION gov_runs_scheme(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_runs_scheme(uuid) TO kv_gov;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scheme_applications' AND policyname = 'gov_own_schemes_scheme_applications') THEN
    CREATE POLICY gov_own_schemes_scheme_applications ON scheme_applications FOR SELECT TO kv_gov
      USING (current_authority_id() IS NOT NULL AND gov_runs_scheme(scheme_id));
  END IF;
END $$;

-- This authority's schemes: id, code, name — never another authority's, never rules or fees.
CREATE OR REPLACE FUNCTION gov_authority_schemes() RETURNS TABLE (id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.code::text, s.default_name::text FROM schemes s
   WHERE current_authority_id() IS NOT NULL AND s.authority_id = current_authority_id() AND s.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION gov_authority_schemes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_authority_schemes() TO kv_gov;

-- THE MASK (pure): phone / Aadhaar / bank / account / IFSC / UPI / PAN values → six bullets + the last 3 characters; location keys DROPPED.
-- Keys are compared as lower_snake tokens (`bankAccount` → bank_account), so `company` never matches `pan` and `plate` never matches `lat`.
CREATE OR REPLACE FUNCTION gov_mask_form(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE k text; v jsonb; tok text; out jsonb := '{}'::jsonb; d text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) = 'array' THEN
    SELECT COALESCE(jsonb_agg(gov_mask_form(e)), '[]'::jsonb) INTO out FROM jsonb_array_elements(p) AS e;
    RETURN out;
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
    tok := '_' || lower(regexp_replace(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g'), '[^A-Za-z0-9]+', '_', 'g')) || '_';
    IF tok ~ '_(lat|lng|lon|latitude|longitude|geo|geotag|geotags|gps|location|locations|coords|coordinates|trace|walk|address|boundary|polygon|geojson)_' THEN
      CONTINUE;
    ELSIF tok ~ '_(phone|phones|mobile|msisdn|aadhaar|aadhar|uid|bank|account|acct|ifsc|upi|vpa|pan)_' THEN
      d := regexp_replace(CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' ELSE v::text END, '[^0-9A-Za-z]', '', 'g');
      out := out || jsonb_build_object(k, repeat('•', 6) || CASE WHEN length(d) >= 4 THEN right(d, 3) ELSE '' END);
    ELSE
      out := out || jsonb_build_object(k, gov_mask_form(v));
    END IF;
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION gov_mask_form(jsonb) FROM PUBLIC;

-- The form of an ADMITTED application, masked. NULL for anything the session's authority does not run.
CREATE OR REPLACE FUNCTION gov_application_form(p_application_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT gov_mask_form(a.form_data) FROM scheme_applications a
   WHERE a.id = p_application_id AND a.deleted_at IS NULL AND gov_runs_scheme(a.scheme_id);
$$;
REVOKE ALL ON FUNCTION gov_application_form(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_application_form(uuid) TO kv_gov;

-- ------------------------------------------------------------------------------------------------------------------
-- 239.6  THE MEMBERSHIP SURFACE — DEFINER FUNCTIONS ONLY (kv_app holds nothing on the table)
-- ------------------------------------------------------------------------------------------------------------------
-- The session person's LIVE authorities (the sign-in chooser): app.user_id.
CREATE OR REPLACE FUNCTION gov_my_authorities() RETURNS TABLE (authority_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT m.authority_id, a.default_name::text FROM authority_memberships m JOIN scheme_authorities a ON a.id = m.authority_id
   WHERE kv_session_user_uuid() IS NOT NULL AND m.user_id = kv_session_user_uuid()
     AND m.status = 'active' AND m.expires_at > now() AND m.deleted_at IS NULL AND a.deleted_at IS NULL
   ORDER BY 2, 1;
$$;

-- THE ONE RESOLVER: roles + permissions of a LIVE membership (active AND unexpired). An expired row resolves nothing.
CREATE OR REPLACE FUNCTION gov_access(p_user uuid, p_authority uuid) RETURNS TABLE (role_code text, permission_code text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.code::text, rp.permission_code::text, m.expires_at
    FROM authority_memberships m JOIN roles r ON r.id = m.role_id JOIN scheme_authorities a ON a.id = m.authority_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
   WHERE m.user_id = p_user AND m.authority_id = p_authority AND m.status = 'active' AND m.expires_at > now()
     AND m.deleted_at IS NULL AND r.scope = 'authority' AND a.deleted_at IS NULL;
$$;

-- The authority's people (current_authority_id()): names, phones by their last 3, the role, who asked, who approved, the end.
CREATE OR REPLACE FUNCTION gov_authority_memberships() RETURNS TABLE (
  membership_id uuid, user_id uuid, full_name text, phone_masked text, role_code text, status text, live boolean, term_months smallint,
  requested_by uuid, requested_by_platform boolean, request_reason text, requested_at timestamptz, approved_by uuid, approved_at timestamptz,
  expires_at timestamptz, removed_by uuid, removed_at timestamptz, removed_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.user_id, u.full_name::text, repeat('•', 6) || right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 3), r.code::text, m.status::text,
         (m.status = 'active' AND m.expires_at > now()), m.term_months, m.requested_by, (m.requested_by_admin_id IS NOT NULL), m.request_reason,
         m.created_at, m.approved_by, m.approved_at, m.expires_at, m.removed_by, m.removed_at, m.removed_reason
    FROM authority_memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
   WHERE current_authority_id() IS NOT NULL AND m.authority_id = current_authority_id() AND m.deleted_at IS NULL
   ORDER BY (m.status = 'removed'), m.created_at DESC, m.id DESC
   LIMIT 500;
$$;

-- One row of the current authority — the facts the domain's two-person rule reads before anything is written.
CREATE OR REPLACE FUNCTION gov_membership_get(p_id uuid) RETURNS TABLE (
  membership_id uuid, user_id uuid, role_code text, status text, requested_by uuid, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.user_id, r.code::text, m.status::text, m.requested_by, m.expires_at
    FROM authority_memberships m JOIN roles r ON r.id = m.role_id
   WHERE current_authority_id() IS NOT NULL AND m.authority_id = current_authority_id() AND m.id = p_id AND m.deleted_at IS NULL;
$$;

-- THE THREE ACTS. Each writes as the session person (app.user_id) in the session's authority (app.authority_id); the guard decides.
CREATE OR REPLACE FUNCTION gov_membership_request(p_user uuid, p_role_code text, p_term smallint, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_role uuid;
BEGIN
  IF current_authority_id() IS NULL OR kv_session_user_uuid() IS NULL THEN
    RAISE EXCEPTION '[GOV_REQUESTER_NOT_MEMBER] no authority or person in scope — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.id INTO v_role FROM roles r WHERE r.code = p_role_code AND r.scope = 'authority' AND r.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION '[GOV_ROLE_REQUIRED] an authority membership carries an authority role — PC-56 GOV-0' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by, request_reason, created_by)
  VALUES (current_authority_id(), p_user, v_role, 'requested', p_term, kv_session_user_uuid(), btrim(p_reason), kv_session_user_uuid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION gov_membership_approve(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE authority_memberships SET status = 'active', approved_by = kv_session_user_uuid(), updated_by = kv_session_user_uuid()
   WHERE id = p_id AND current_authority_id() IS NOT NULL AND authority_id = current_authority_id() AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

CREATE OR REPLACE FUNCTION gov_membership_remove(p_id uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE authority_memberships SET status = 'removed', removed_by = kv_session_user_uuid(), removed_reason = btrim(p_reason), updated_by = kv_session_user_uuid()
   WHERE id = p_id AND current_authority_id() IS NOT NULL AND authority_id = current_authority_id() AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION gov_my_authorities(), gov_access(uuid, uuid), gov_authority_memberships(), gov_membership_get(uuid),
  gov_membership_request(uuid, text, smallint, text), gov_membership_approve(uuid), gov_membership_remove(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gov_my_authorities(), gov_access(uuid, uuid), gov_authority_memberships(), gov_membership_get(uuid),
  gov_membership_request(uuid, text, smallint, text), gov_membership_approve(uuid), gov_membership_remove(uuid, text) TO kv_app;

-- RLS + grants on the table: the default-privilege trap first (0014/0018 hand every FUTURE table to kv_app arw, kv_relay arwd,
-- kv_readonly r), then ONLY the admin realm's two narrow grants. kv_app reaches the table only through the functions above.
ALTER TABLE authority_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON authority_memberships FROM kv_app, kv_relay, kv_readonly, PUBLIC;
GRANT SELECT (id, authority_id, role_id, status, expires_at, approved_at, requested_by_admin_id, created_at, deleted_at) ON authority_memberships TO kv_admin;
GRANT INSERT (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason) ON authority_memberships TO kv_admin;
CREATE POLICY am_admin_realm_read ON authority_memberships FOR SELECT TO kv_admin USING (true);
CREATE POLICY am_admin_realm_insert ON authority_memberships FOR INSERT TO kv_admin
  WITH CHECK (requested_by IS NULL AND requested_by_admin_id IS NOT NULL AND status = 'active');

-- ------------------------------------------------------------------------------------------------------------------
-- 239.7  THE GOV-REALM AUDIT ROW · THE RECORDED-READ PURPOSES · THE FLAG
-- ------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'al_insert_gov_realm') THEN
    CREATE POLICY al_insert_gov_realm ON audit_log FOR INSERT TO kv_app
      WITH CHECK (tenant_id IS NULL AND current_authority_id() IS NOT NULL AND (new_value ->> 'authorityId') = current_authority_id()::text);
  END IF;
END $$;

INSERT INTO audit_read_purposes (code, description) VALUES
  ('gov_application_open', 'PC-56 GOV-0 — a government authority opened one application to a scheme it runs (masked form; who, which authority, which application)'),
  ('gov_application_list', 'PC-56 GOV-0 — a government authority listed applications to its schemes (one row per organisation on the page)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('gov_console',
   'PC-56 GOV-0 (GOV-1 Q2-A, Law 10): the government console realm (/v1/gov/*: sign-in to a government authority with phone code + authenticator, its people and role requests, the recorded read of applications to its schemes). Platform-scoped (evaluated with no tenant), fail-closed: OFF = every /v1/gov/* route answers 404',
   false, 100, '{}')
ON CONFLICT (key) DO NOTHING;
