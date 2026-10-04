-- ==================================================================================================================
-- 0199 · PC-56 TENANT-SW-c · VERIFICATION DESK & TEAM
--        canon W157 / W158 + W2338–W2340 (people/verification[/id]) · W183 + W2335–W2337 (settings/team)
--        · W184 + W2768–W2774 (settings/team/[id])
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (fix forward).
-- TRUST, not money: identity + RBAC (Law 9 class care). No PII is written to an audit row by anything here.
--
-- Founder decisions (2026-10-04), built as decided:
--   • STAFF SEATS PER PLAN — plan feature `staff_seats` (config {"seats": N} or {"seats": null} = unlimited); a seat is held by
--     a person holding a STAFF role (`roles.is_staff`) that is active or awaiting approval. Taking a seat beyond the plan's
--     number is refused HERE (`[STAFF_SEATS_EXHAUSTED]`), under a per-tenant advisory lock, as well as by the service.
--   • SMS INVITE TOKEN — `staff_invites`: the raw token is shown once / sent once; only its sha256 is kept for lookup, plus a
--     KEK-sealed copy that the SMS dispatcher clears the moment the message has left (WhatsApp: no provider is connected on
--     this platform (8e) — refused by name, the channel CHECK admits `sms` only).
--   • TOTP 2FA FOR STAFF — `user_totp` (secret sealed with the 13a envelope, never plaintext; replay guard on the step),
--     `user_recovery_codes` (hashed, single use); a pending-2FA session; the tenant setting `security.require_staff_2fa`
--     (risk_class security → 13b proposal + second admin; platform floor = OFF).
--   • STAFF SELF-DECLARE CONFLICTS + ONBOARDER RULE, BOTH MECHANICALLY RECUSED — `staff_conflict_declarations`; the onboarder
--     of a member is whoever CREATED one of their `user_tenant_roles` rows in the tenant (the existing, never-written
--     `user_tenant_roles.created_by` column — stamped from now on, from the session's app.user_id when a writer leaves it
--     NULL). A KYC decision (and a take-next claim) by a recused person is refused here: `[KYC_RECUSED_DECLARED]`,
--     `[KYC_RECUSED_ONBOARDER]`. Nothing is inferred from names, surnames or addresses.
--
-- SECTIONS
--   199.1  roles.is_staff (set by name) · user_tenant_roles revoke columns + created_by stamping · staff seats (feature,
--          plan_features, kv_staff_seat_plan(), kv_staff_seats_used(), trg_utr_staff_seats)
--   199.2  staff_conflict_declarations (+ trigger) · kv_kyc_recusal() · trg_kyc_recusal on kyc_documents
--   199.3  kyc_claims (take next / skip — FOR UPDATE SKIP LOCKED in the service; the rules re-checked here)
--   199.4  staff_invites (+ trigger)
--   199.5  user_totp · user_recovery_codes · sessions.two_factor_pending · tenant_session_revocations ·
--          setting `security.require_staff_2fa`
--   199.6  staff_permission_overrides: reason (backfilled), granted_by, expires_at, revoke columns · override_checker_codes
--          · staff_override_proposals (13b shape) · the override gate (a money / PII grant needs a confirmed proposal)
--   199.7  RLS + grants · indexes
--
-- RLS DECISION: every new TENANT table (tenant_id NOT NULL) is ENABLE + FORCE with the 0175 split (SELECT / INSERT WITH
-- CHECK / UPDATE USING + WITH CHECK on current_tenant_id(), an admin-realm policy TO kv_admin), REVOKE ALL from kv_app /
-- kv_relay / kv_readonly, then the narrowest grants. `user_totp` and `user_recovery_codes` are PERSON tables (no tenant,
-- like `sessions` and `users`): no RLS, grants only (kv_app SELECT/INSERT + column UPDATE, no DELETE; nothing to kv_relay or
-- kv_readonly — the secret is sealed and the codes hashed regardless). `override_checker_codes` is a platform lookup
-- (SELECT only). No grant to kv_relay anywhere: the claim-expiry job reads only `tenants` as kv_relay and works per tenant
-- in kv_app's unit of work; the invite SMS handler does its table work in a kv_app unit of work (HOTFIX-2).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 199.1  STAFF ROLES, ROLE ROWS, SEATS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN roles.is_staff IS
  'PC-56 TENANT-SW-c: a STAFF role (holds a staff seat of the plan). Set BY NAME here and in seed core/0004 — the same five the 4d-1 '
  'meter counted (tenant_admin, tenant_staff, support_agent, auditor, fpo_coordinator). Members (farmer, buyer, worker, ambassador …) are not seats.';
UPDATE roles SET is_staff = true WHERE code IN ('tenant_admin', 'tenant_staff', 'support_agent', 'auditor', 'fpo_coordinator') AND NOT is_staff;

ALTER TABLE user_tenant_roles ADD COLUMN IF NOT EXISTS revoked_at    timestamptz;
ALTER TABLE user_tenant_roles ADD COLUMN IF NOT EXISTS revoked_by    uuid REFERENCES users(id);
ALTER TABLE user_tenant_roles ADD COLUMN IF NOT EXISTS revoke_reason text;
ALTER TABLE user_tenant_roles DROP CONSTRAINT IF EXISTS ck_utr_revoke_whole;
ALTER TABLE user_tenant_roles ADD CONSTRAINT ck_utr_revoke_whole CHECK (revoked_at IS NULL OR (NOT is_active AND revoked_by IS NOT NULL));
COMMENT ON COLUMN user_tenant_roles.revoked_at IS
  'PC-56 TENANT-SW-c: when the role was revoked (a revoked row holds no seat; an approve clears it). Backfilled from the audit trail '
  '(action role.revoked) where a pre-0199 revoke was recorded; the reason is in revoke_reason (DTO ≥ 10 since 0199) — older rows NULL.';
COMMENT ON COLUMN user_tenant_roles.created_by IS
  'PC-56 TENANT-SW-c: WHO ATTACHED THIS ROLE TO THE PERSON — the onboarder (W158 "reviewer ≠ onboarder"). Never written before 0199; '
  'stamped by trg_utr_created_by from the session''s app.user_id when a writer leaves it NULL. NULL on older rows = not recorded.';

-- backfill revoked_at / revoked_by from the trail (a real read — nothing invented): the latest role.revoked row per assignment
UPDATE user_tenant_roles utr
   SET revoked_at = a.created_at, revoked_by = a.actor_user_id
  FROM (SELECT DISTINCT ON (entity_id) entity_id, created_at, actor_user_id
          FROM audit_log WHERE action = 'role.revoked' AND entity_type = 'user_tenant_role' AND actor_user_id IS NOT NULL
         ORDER BY entity_id, created_at DESC) a
 WHERE utr.id::text = a.entity_id::text AND NOT utr.is_active AND utr.revoked_at IS NULL;

CREATE OR REPLACE FUNCTION trg_utr_created_by() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NEW;   -- a non-uuid app.user_id (e.g. 'system') records no onboarder
END $$;
DROP TRIGGER IF EXISTS trg_utr_created_by ON user_tenant_roles;
CREATE TRIGGER trg_utr_created_by BEFORE INSERT ON user_tenant_roles FOR EACH ROW EXECUTE FUNCTION trg_utr_created_by();

-- the plan feature
INSERT INTO features (code, default_name, module_code, description) VALUES
  ('staff_seats', 'Staff seats', 'M01', 'PC-56 TENANT-SW-c: how many people may hold a staff role (tenant_admin, tenant_staff, support_agent, auditor, fpo_coordinator). plan_features.config {"seats": N}; {"seats": null} = unlimited.')
ON CONFLICT (code) DO NOTHING;
-- seeded per EXISTING plan row (dev); rules/0201 carries the same rows for a database built from empty. Defaults chosen by
-- the brief's honest shape: starter 3 · growth 10 · professional 25 · enterprise + government unlimited (private plans).
INSERT INTO plan_features (plan_id, feature_code, is_included, config)
SELECT p.id, 'staff_seats', true, jsonb_build_object('seats', v.seats)
  FROM plans p JOIN (VALUES ('starter', 3), ('growth', 10), ('professional', 25), ('enterprise', NULL::int), ('government', NULL::int)) AS v(code, seats) ON v.code = p.code
ON CONFLICT (plan_id, feature_code) DO NOTHING;

/** The tenant's CURRENT plan (a quota-bearing subscription, newest first — the 4d-1 rule) and its staff seats. */
CREATE OR REPLACE FUNCTION kv_staff_seat_plan(p_tenant uuid)
RETURNS TABLE (plan_code text, plan_name text, seats integer, defined boolean)
LANGUAGE sql STABLE AS $$
  SELECT p.code::text, p.default_name::text,
         CASE WHEN pf.config ? 'seats' AND jsonb_typeof(pf.config->'seats') = 'number' THEN (pf.config->>'seats')::int ELSE NULL END,
         (pf.feature_code IS NOT NULL AND pf.is_included AND pf.config ? 'seats')
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    LEFT JOIN plan_features pf ON pf.plan_id = p.id AND pf.feature_code = 'staff_seats'
   WHERE s.tenant_id = p_tenant AND s.deleted_at IS NULL AND s.status::text IN ('trialing', 'active', 'past_due', 'paused')
   ORDER BY s.created_at DESC
   LIMIT 1
$$;

/** People holding a seat: an active staff role, or one awaiting approval, not revoked, not deleted. A person is one seat. */
CREATE OR REPLACE FUNCTION kv_staff_seats_used(p_tenant uuid, p_except_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT u.user_id)::int
    FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id
   WHERE u.tenant_id = p_tenant AND r.is_staff AND u.deleted_at IS NULL AND u.revoked_at IS NULL
     AND (u.is_active OR u.approved_at IS NULL)
     AND (p_except_user IS NULL OR u.user_id <> p_except_user)
$$;

CREATE OR REPLACE FUNCTION trg_utr_staff_seats() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_staff boolean; v_new boolean; v_old boolean := false; v_seats integer; v_defined boolean; v_plan text; v_used integer;
BEGIN
  SELECT r.is_staff INTO v_staff FROM roles r WHERE r.id = NEW.role_id;
  IF NOT COALESCE(v_staff, false) THEN RETURN NEW; END IF;
  v_new := NEW.deleted_at IS NULL AND NEW.revoked_at IS NULL AND (NEW.is_active OR NEW.approved_at IS NULL);
  IF TG_OP = 'UPDATE' THEN
    v_old := OLD.role_id = NEW.role_id AND OLD.deleted_at IS NULL AND OLD.revoked_at IS NULL AND (OLD.is_active OR OLD.approved_at IS NULL);
  END IF;
  IF NOT v_new OR v_old THEN RETURN NEW; END IF;
  -- the person already holds a seat through another staff role: no NEW seat
  IF EXISTS (SELECT 1 FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id
              WHERE u.tenant_id = NEW.tenant_id AND u.user_id = NEW.user_id AND u.id <> NEW.id AND r.is_staff
                AND u.deleted_at IS NULL AND u.revoked_at IS NULL AND (u.is_active OR u.approved_at IS NULL)) THEN
    RETURN NEW;
  END IF;
  -- one seat decision at a time per tenant (two concurrent "add staff" acts cannot both take the last seat)
  PERFORM pg_advisory_xact_lock(hashtextextended('kv_staff_seats:' || NEW.tenant_id::text, 0));
  SELECT sp.seats, sp.defined, sp.plan_name INTO v_seats, v_defined, v_plan FROM kv_staff_seat_plan(NEW.tenant_id) sp;
  IF NOT COALESCE(v_defined, false) OR v_seats IS NULL THEN RETURN NEW; END IF;   -- no plan / no seat row / unlimited
  v_used := kv_staff_seats_used(NEW.tenant_id, NEW.user_id);
  IF v_used >= v_seats THEN
    RAISE EXCEPTION '[STAFF_SEATS_EXHAUSTED] all % staff seats of the % plan are in use (% held) — upgrade the plan or remove someone from the team first — PC-56 TENANT-SW-c',
      v_seats, v_plan, v_used USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_utr_staff_seats ON user_tenant_roles;
CREATE TRIGGER trg_utr_staff_seats BEFORE INSERT OR UPDATE OF is_active, revoked_at, deleted_at, approved_at, role_id ON user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION trg_utr_staff_seats();

-- ------------------------------------------------------------------------------------------------------------------
-- 199.2  CONFLICT DECLARATIONS + RECUSAL
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_conflict_declarations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  staff_user_id   uuid NOT NULL REFERENCES users(id),
  member_user_id  uuid NOT NULL REFERENCES users(id),
  relation        varchar(12) NOT NULL CONSTRAINT ck_scd_relation CHECK (relation IN ('family', 'household', 'business', 'other')),
  relation_note   varchar(200),
  reason          text NOT NULL CONSTRAINT ck_scd_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  declared_by     uuid NOT NULL REFERENCES users(id),
  declared_via    varchar(6) NOT NULL CONSTRAINT ck_scd_via CHECK (declared_via IN ('self', 'admin')),
  active          boolean NOT NULL DEFAULT true,
  revoked_by      uuid REFERENCES users(id),
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_scd_not_self CHECK (staff_user_id <> member_user_id),
  CONSTRAINT ck_scd_other_says CHECK (relation <> 'other' OR char_length(btrim(COALESCE(relation_note, ''))) >= 3),
  CONSTRAINT ck_scd_self_is_self CHECK (declared_via <> 'self' OR declared_by = staff_user_id),
  CONSTRAINT ck_scd_revoke_whole CHECK (active OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND char_length(btrim(COALESCE(revoke_reason, ''))) BETWEEN 10 AND 500))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scd_live ON staff_conflict_declarations (tenant_id, staff_user_id, member_user_id) WHERE active;
COMMENT ON TABLE staff_conflict_declarations IS
  'PC-56 TENANT-SW-c (founder decision 2026-10-04): a staff member DECLARES a conflict with a member (self, from /me/security) or a '
  'tenant_admin records one for them (/settings/team/[id]). An active declaration MECHANICALLY RECUSES the staff member from that '
  'member''s KYC decisions and take-next claims ([KYC_RECUSED_DECLARED]). Nothing is inferred from names or addresses. A declaration '
  'is lifted only by a tenant_admin who is not the declared staff member (a recusal is never self-lifted).';

CREATE OR REPLACE FUNCTION assert_conflict_declaration_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[CONFLICT_FINAL] a conflict declaration is never deleted — lift it with a reason — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  BEGIN v_session := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_session := NULL; END;
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.active OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION '[CONFLICT_BORN_ACTIVE] a declaration is born active — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS NOT NULL AND v_session <> NEW.declared_by THEN
      RAISE EXCEPTION '[CONFLICT_NOT_YOURS] a declaration is recorded in the declarer''s own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.declared_via = 'admin' AND NOT kv_is_tenant_admin(NEW.tenant_id, NEW.declared_by) THEN
      RAISE EXCEPTION '[CONFLICT_RECORDER_NOT_ADMIN] only a tenant_admin records a conflict for someone else — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_tenant_roles u WHERE u.tenant_id = NEW.tenant_id AND u.user_id = NEW.member_user_id AND u.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[CONFLICT_MEMBER_NOT_IN_TENANT] the member holds no role in this organisation — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id
                    WHERE u.tenant_id = NEW.tenant_id AND u.user_id = NEW.staff_user_id AND r.is_staff AND u.deleted_at IS NULL AND u.revoked_at IS NULL) THEN
      RAISE EXCEPTION '[CONFLICT_STAFF_NOT_STAFF] a conflict is declared by (or for) someone holding a staff role here — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- UPDATE: only the one lift, once
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.staff_user_id <> OLD.staff_user_id OR NEW.member_user_id <> OLD.member_user_id
     OR NEW.relation <> OLD.relation OR NEW.relation_note IS DISTINCT FROM OLD.relation_note OR NEW.reason <> OLD.reason
     OR NEW.declared_by <> OLD.declared_by OR NEW.declared_via <> OLD.declared_via OR NEW.created_at <> OLD.created_at OR NOT OLD.active OR NEW.active THEN
    RAISE EXCEPTION '[CONFLICT_FINAL] a declaration is only ever lifted, once, with a reason — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_by = OLD.staff_user_id THEN
    RAISE EXCEPTION '[CONFLICT_SELF_LIFT] a recusal is never lifted by the recused person — a tenant_admin lifts it — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.revoked_by) THEN
    RAISE EXCEPTION '[CONFLICT_LIFTER_NOT_ADMIN] only a tenant_admin lifts a conflict declaration — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF v_session IS NOT NULL AND v_session <> NEW.revoked_by THEN
    RAISE EXCEPTION '[CONFLICT_NOT_YOURS] a lift is made in the lifter''s own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  NEW.revoked_at := now(); NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_scd_moves ON staff_conflict_declarations;
CREATE TRIGGER trg_scd_moves BEFORE INSERT OR UPDATE OR DELETE ON staff_conflict_declarations FOR EACH ROW EXECUTE FUNCTION assert_conflict_declaration_moves();

/** Is this staff member recused from this member's KYC? Returns the refusal code, or NULL. The two rules the founder decided. */
CREATE OR REPLACE FUNCTION kv_kyc_recusal(p_tenant uuid, p_staff uuid, p_member uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_staff IS NULL OR p_member IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM staff_conflict_declarations c
                  WHERE c.tenant_id = p_tenant AND c.staff_user_id = p_staff AND c.member_user_id = p_member AND c.active) THEN 'KYC_RECUSED_DECLARED'
    WHEN EXISTS (SELECT 1 FROM user_tenant_roles u
                  WHERE u.tenant_id = p_tenant AND u.user_id = p_member AND u.created_by = p_staff AND u.created_by <> u.user_id) THEN 'KYC_RECUSED_ONBOARDER'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION trg_kyc_documents_recusal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('verified', 'rejected') AND NEW.subject_kind = 'user' AND NEW.reviewed_by IS NOT NULL THEN
    v := kv_kyc_recusal(NEW.tenant_id, NEW.reviewed_by, NEW.user_id);
    IF v = 'KYC_RECUSED_DECLARED' THEN
      RAISE EXCEPTION '[KYC_RECUSED_DECLARED] kyc_documents %: the reviewer declared a conflict with this member — recused — PC-56 TENANT-SW-c', OLD.id USING ERRCODE = 'check_violation';
    ELSIF v = 'KYC_RECUSED_ONBOARDER' THEN
      RAISE EXCEPTION '[KYC_RECUSED_ONBOARDER] kyc_documents %: the reviewer onboarded this member — no self-review — PC-56 TENANT-SW-c', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_kyc_recusal ON kyc_documents;
CREATE TRIGGER trg_kyc_recusal BEFORE UPDATE OF status ON kyc_documents FOR EACH ROW EXECUTE FUNCTION trg_kyc_documents_recusal();

-- ------------------------------------------------------------------------------------------------------------------
-- 199.3  KYC CLAIMS (W157 "Take next", W158 "Skip (take next)")
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_claims (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  document_id      uuid NOT NULL REFERENCES kyc_documents(id),
  claimed_by       uuid NOT NULL REFERENCES users(id),
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  released_at      timestamptz,
  released_by      uuid REFERENCES users(id),
  release_kind     varchar(10) CONSTRAINT ck_kc_release_kind CHECK (release_kind IN ('skip', 'decided', 'expired', 'released')),
  skip_reason_code varchar(30) CONSTRAINT ck_kc_skip_reason CHECK (skip_reason_code IN ('needs_specialist', 'evidence_unclear', 'language', 'conflict_to_declare', 'other')),
  release_note     varchar(300),
  CONSTRAINT ck_kc_window CHECK (expires_at > claimed_at AND expires_at <= claimed_at + interval '15 minutes'),
  CONSTRAINT ck_kc_release_whole CHECK ((released_at IS NULL) = (release_kind IS NULL)),
  CONSTRAINT ck_kc_skip_says_why CHECK (release_kind IS DISTINCT FROM 'skip' OR (skip_reason_code IS NOT NULL AND released_by IS NOT NULL
                                        AND (skip_reason_code <> 'other' OR char_length(btrim(COALESCE(release_note, ''))) >= 10))),
  CONSTRAINT ck_kc_expired_job CHECK (release_kind IS DISTINCT FROM 'expired' OR released_by IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kc_live_doc   ON kyc_claims (document_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kc_live_staff ON kyc_claims (tenant_id, claimed_by) WHERE released_at IS NULL;
COMMENT ON TABLE kyc_claims IS
  'PC-56 TENANT-SW-c: W157 "Take next" — a 15-minute claim on the oldest pending MEMBER document the claimant may decide (claimed '
  'FOR UPDATE SKIP LOCKED: two claimers get two documents). One live claim per document and per person. Released by Skip (a coded '
  'reason), by the decision, by the person, or by the expiry job (kyc-claims-expiry, kv_app UoW per tenant).';

CREATE OR REPLACE FUNCTION assert_kyc_claim_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; v text; v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[KYC_CLAIM_FINAL] a claim is released, never deleted — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  BEGIN v_session := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_session := NULL; END;
  IF TG_OP = 'INSERT' THEN
    NEW.claimed_at := now(); NEW.expires_at := now() + interval '15 minutes';
    IF NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION '[KYC_CLAIM_BORN_LIVE] a claim is born live — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS NULL OR v_session <> NEW.claimed_by THEN
      RAISE EXCEPTION '[KYC_CLAIM_NOT_YOURS] a claim is taken in the claimant''s own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    SELECT k.tenant_id, k.status::text AS status, k.subject_kind, k.user_id, k.submitted_by INTO d FROM kyc_documents k WHERE k.id = NEW.document_id AND k.deleted_at IS NULL;
    IF NOT FOUND OR d.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION '[KYC_NOT_FOUND] document % is not this tenant''s — PC-56 TENANT-SW-c', NEW.document_id USING ERRCODE = 'check_violation';
    END IF;
    IF d.status <> 'pending' OR d.subject_kind <> 'user' THEN
      RAISE EXCEPTION '[KYC_CLAIM_NOT_PENDING] only a pending member document is claimed — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF d.submitted_by = NEW.claimed_by THEN
      RAISE EXCEPTION '[MAKER_IS_CHECKER] the submitter of a document never claims it — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF d.user_id = NEW.claimed_by THEN
      RAISE EXCEPTION '[OWN_DOCUMENT] nobody claims their own document — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    v := kv_kyc_recusal(NEW.tenant_id, NEW.claimed_by, d.user_id);
    IF v IS NOT NULL THEN
      RAISE EXCEPTION '[%] a recused reviewer never claims this member''s document — PC-56 TENANT-SW-c', v USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: the one release
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.document_id <> OLD.document_id OR NEW.claimed_by <> OLD.claimed_by
     OR NEW.claimed_at <> OLD.claimed_at OR NEW.expires_at <> OLD.expires_at OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
    RAISE EXCEPTION '[KYC_CLAIM_FINAL] a claim is released once — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.release_kind = 'expired' AND OLD.expires_at > now() THEN
    RAISE EXCEPTION '[KYC_CLAIM_NOT_STALE] a claim expires only after its 15 minutes — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.release_kind IN ('skip', 'released') AND NEW.released_by IS DISTINCT FROM OLD.claimed_by THEN
    RAISE EXCEPTION '[KYC_CLAIM_NOT_YOURS] only the claimant skips or releases a claim — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  NEW.released_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_kc_moves ON kyc_claims;
CREATE TRIGGER trg_kc_moves BEFORE INSERT OR UPDATE OR DELETE ON kyc_claims FOR EACH ROW EXECUTE FUNCTION assert_kyc_claim_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 199.4  STAFF INVITES (W183 "Invite staff", W2335–W2337)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_invites (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  phone            varchar(20) NOT NULL CONSTRAINT ck_si_phone CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role_id          uuid NOT NULL REFERENCES roles(id),
  desk_ids         uuid[] NOT NULL DEFAULT '{}',
  invited_by       uuid NOT NULL REFERENCES users(id),
  language_code    varchar(8) NOT NULL DEFAULT 'en' REFERENCES languages(code),
  channel          varchar(10) NOT NULL DEFAULT 'sms' CONSTRAINT ck_si_channel CHECK (channel IN ('sms')),
  token_hash       char(64) NOT NULL CONSTRAINT uq_si_token UNIQUE,
  token_sealed     text,
  expires_at       timestamptz NOT NULL,
  status           varchar(10) NOT NULL DEFAULT 'pending' CONSTRAINT ck_si_status CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  sent_at          timestamptz,
  send_failure     varchar(80),
  accepted_user_id uuid REFERENCES users(id),
  accepted_at      timestamptz,
  revoked_by       uuid REFERENCES users(id),
  revoked_at       timestamptz,
  revoke_reason    text,
  expired_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_si_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_si_accepted_whole CHECK (status <> 'accepted' OR (accepted_user_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CONSTRAINT ck_si_revoked_whole CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND char_length(btrim(COALESCE(revoke_reason, ''))) BETWEEN 10 AND 500)),
  CONSTRAINT ck_si_sealed_only_pending CHECK (token_sealed IS NULL OR status = 'pending')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_si_one_pending ON staff_invites (tenant_id, phone) WHERE status = 'pending';
COMMENT ON TABLE staff_invites IS
  'PC-56 TENANT-SW-c (founder decision): a tenant_admin invites a phone into a staff role (+ desks). The raw token is returned once and '
  'sent once by SMS; the database keeps sha256(token) for lookup and a KEK-sealed copy the SMS dispatcher clears when the message '
  'has left. Accepting needs the token AND an OTP on the invited phone; one pending invite per phone per tenant; 7 days; single use.';

CREATE OR REPLACE FUNCTION assert_staff_invite_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_staff boolean; v_platform boolean; v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[INVITE_FINAL] an invite is never deleted — revoke it with a reason — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  BEGIN v_session := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_session := NULL; END;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.accepted_user_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.sent_at IS NOT NULL THEN
      RAISE EXCEPTION '[INVITE_BORN_PENDING] an invite is born pending and unsent — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.is_staff, (r.scope = 'platform') INTO v_staff, v_platform FROM roles r WHERE r.id = NEW.role_id;
    IF NOT COALESCE(v_staff, false) OR COALESCE(v_platform, true) THEN
      RAISE EXCEPTION '[INVITE_ROLE_NOT_STAFF] an invite carries a staff role of this organisation — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS NULL OR v_session <> NEW.invited_by OR NOT kv_is_tenant_admin(NEW.tenant_id, NEW.invited_by) THEN
      RAISE EXCEPTION '[INVITE_NOT_ADMIN] only a tenant_admin invites staff, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now(); NEW.expires_at := now() + interval '7 days';
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.phone <> OLD.phone OR NEW.role_id <> OLD.role_id OR NEW.desk_ids <> OLD.desk_ids
     OR NEW.invited_by <> OLD.invited_by OR NEW.token_hash <> OLD.token_hash OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at
     OR NEW.channel <> OLD.channel OR NEW.language_code <> OLD.language_code
     OR (NEW.token_sealed IS NOT NULL AND NEW.token_sealed IS DISTINCT FROM OLD.token_sealed) THEN
    RAISE EXCEPTION '[INVITE_FINAL] what an invite says is fixed — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  -- A CLOSED invite (accepted / revoked / expired) never moves again — not its status, not who accepted it, not when: single use.
  IF OLD.status <> 'pending' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.accepted_user_id IS DISTINCT FROM OLD.accepted_user_id OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
       OR NEW.expired_at IS DISTINCT FROM OLD.expired_at OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.send_failure IS DISTINCT FROM OLD.send_failure THEN
      RAISE EXCEPTION '[INVITE_ALREADY_USED] this invite is % — it is single use — PC-56 TENANT-SW-c', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      IF OLD.expires_at <= now() THEN
        RAISE EXCEPTION '[INVITE_EXPIRED] this invite expired on % — ask for a new one — PC-56 TENANT-SW-c', OLD.expires_at USING ERRCODE = 'check_violation';
      END IF;
      IF v_session IS NULL OR v_session <> NEW.accepted_user_id THEN
        RAISE EXCEPTION '[INVITE_NOT_YOURS] an invite is accepted by the invited person, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
      END IF;
      NEW.accepted_at := now(); NEW.token_sealed := NULL;
    ELSIF NEW.status = 'revoked' THEN
      IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.revoked_by) OR v_session IS DISTINCT FROM NEW.revoked_by THEN
        RAISE EXCEPTION '[INVITE_NOT_ADMIN] only a tenant_admin revokes an invite, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
      END IF;
      NEW.revoked_at := now(); NEW.token_sealed := NULL;
    ELSIF NEW.status = 'expired' THEN
      IF OLD.expires_at > now() THEN
        RAISE EXCEPTION '[INVITE_NOT_STALE] an invite expires only after its 7 days — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
      END IF;
      NEW.expired_at := now(); NEW.token_sealed := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_si_moves ON staff_invites;
CREATE TRIGGER trg_si_moves BEFORE INSERT OR UPDATE OR DELETE ON staff_invites FOR EACH ROW EXECUTE FUNCTION assert_staff_invite_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 199.5  TOTP 2FA · RECOVERY CODES · PENDING SESSIONS · PER-TENANT SESSION REVOCATION · THE SETTING
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_totp (
  user_id         uuid PRIMARY KEY REFERENCES users(id),
  secret_enc      text NOT NULL CONSTRAINT ck_ut_sealed CHECK (secret_enc ~ '^v2\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  last_used_step  bigint,
  last_used_at    timestamptz,
  disabled_at     timestamptz,
  disabled_reason varchar(40),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ut_disabled_says CHECK (disabled_at IS NULL OR disabled_reason IS NOT NULL)
);
COMMENT ON TABLE user_totp IS
  'PC-56 TENANT-SW-c: RFC 6238 TOTP (30 s, SHA-1, 6 digits, ±1 step) per PERSON. secret_enc is the 13a envelope (AES-256-GCM, a '
  'per-secret data key under the KEK, bound to the row: AAD user_totp:<user_id>) — NEVER plaintext; the otpauth URI is shown once at '
  'enrolment. last_used_step only ever increases (replay guard, trigger). A person table (no tenant): no RLS, grants only.';

CREATE OR REPLACE FUNCTION assert_user_totp_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[TOTP_FINAL] a 2FA enrolment is disabled, never deleted — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.confirmed_at IS NOT NULL OR NEW.last_used_step IS NOT NULL OR NEW.last_used_at IS NOT NULL OR NEW.disabled_at IS NOT NULL THEN
      RAISE EXCEPTION '[TOTP_BORN_UNCONFIRMED] an enrolment is born unconfirmed — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.enrolled_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- a new secret (re-enrolment) is allowed only while unconfirmed or after a disable, and starts over
  IF NEW.secret_enc <> OLD.secret_enc THEN
    IF OLD.confirmed_at IS NOT NULL AND OLD.disabled_at IS NULL THEN
      RAISE EXCEPTION '[TOTP_ALREADY_CONFIRMED] a confirmed 2FA is disabled (with a code) before re-enrolling — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at IS NOT NULL OR NEW.disabled_at IS NOT NULL OR NEW.last_used_step IS NOT NULL OR NEW.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION '[TOTP_BORN_UNCONFIRMED] a re-enrolment starts unconfirmed — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.enrolled_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- A USE of a code stamps last_used_at; its step must be LATER than the last one used (an equal step = the same code again).
  IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at OR NEW.last_used_step IS DISTINCT FROM OLD.last_used_step THEN
    IF NEW.last_used_step IS NULL OR NEW.last_used_at IS NULL OR (OLD.last_used_step IS NOT NULL AND NEW.last_used_step <= OLD.last_used_step) THEN
      RAISE EXCEPTION '[TOTP_REPLAY] this code (or an earlier one) was already used — wait for the next code — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION '[TOTP_FINAL] a confirmation is final — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    RAISE EXCEPTION '[TOTP_FINAL] a disable is final (enrol again) — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ut_moves ON user_totp;
CREATE TRIGGER trg_ut_moves BEFORE INSERT OR UPDATE OR DELETE ON user_totp FOR EACH ROW EXECUTE FUNCTION assert_user_totp_moves();

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),
  batch_id    uuid NOT NULL,
  code_hash   char(64) NOT NULL CONSTRAINT ck_urc_hash CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  retired_at  timestamptz,
  CONSTRAINT uq_urc_code UNIQUE (user_id, code_hash)
);
COMMENT ON TABLE user_recovery_codes IS
  'PC-56 TENANT-SW-c: 10 recovery codes per enrolment, shown once; only HMAC-SHA256(pepper, code) is stored. used_at is set once '
  '(single use, trigger); a new batch retires the old one. A person table: no RLS, grants only.';
CREATE OR REPLACE FUNCTION assert_recovery_code_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[RECOVERY_CODE_FINAL] recovery codes are retired, never deleted — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.used_at IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION '[RECOVERY_CODE_BORN_LIVE] a recovery code is born unused — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.batch_id <> OLD.batch_id OR NEW.code_hash <> OLD.code_hash OR NEW.created_at <> OLD.created_at
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
    RAISE EXCEPTION '[RECOVERY_CODE_USED] a recovery code is used once — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL AND OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION '[RECOVERY_CODE_USED] a retired recovery code no longer works — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_urc_moves ON user_recovery_codes;
CREATE TRIGGER trg_urc_moves BEFORE INSERT OR UPDATE OR DELETE ON user_recovery_codes FOR EACH ROW EXECUTE FUNCTION assert_recovery_code_moves();

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS two_factor_pending     boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS two_factor_verified_at timestamptz;
COMMENT ON COLUMN sessions.two_factor_pending IS
  'PC-56 TENANT-SW-c: a session opened by a person with confirmed TOTP is PENDING until POST /auth/2fa/verify (within 5 minutes of '
  'the OTP step). A pending session mints no access token and cannot be refreshed.';

CREATE TABLE IF NOT EXISTS tenant_session_revocations (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  revoked_after  timestamptz NOT NULL DEFAULT now(),
  revoked_by     uuid NOT NULL REFERENCES users(id),
  reason         text NOT NULL CONSTRAINT ck_tsr_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
COMMENT ON TABLE tenant_session_revocations IS
  'PC-56 TENANT-SW-c (W184 "Remove from team … sessions end"): sessions are PERSON-wide (a refresh token serves any tenant), so '
  'removal records a per-tenant cut-off instead: a session born at or before revoked_after can never refresh into this tenant again, '
  'and an access token issued at or before it is refused by SessionPostureGuard (cache bound printed on the page).';

INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class, member_notice)
VALUES ('security.require_staff_2fa', 'bool', 'false'::jsonb, 'tenant',
        'When ON, every person holding a staff role here must confirm an authenticator-app code (TOTP) on their account; until they do, '
        'every console route except /me/2fa answers TWO_FACTOR_REQUIRED. The platform floor is OFF; turning it ON (or OFF) is a '
        'security setting: proposed by one tenant_admin, confirmed by another, effective next midnight IST (13b).',
        'security', false)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 199.6  PER-STAFF OVERRIDES — WHY, BY WHOM, UNTIL WHEN; MONEY / PII GRANTS NEED A CHECKER
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS reason        text;
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS granted_by    uuid REFERENCES users(id);
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS granted_at    timestamptz;
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS expires_at    timestamptz;
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS revoked_at    timestamptz;
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS revoked_by    uuid REFERENCES users(id);
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS revoke_reason text;
ALTER TABLE staff_permission_overrides ADD COLUMN IF NOT EXISTS proposal_id   uuid;
UPDATE staff_permission_overrides SET reason = 'legacy: no reason recorded (pre-0199)' WHERE reason IS NULL;
ALTER TABLE staff_permission_overrides ALTER COLUMN reason SET NOT NULL;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT IF EXISTS ck_spo_reason;
ALTER TABLE staff_permission_overrides ADD CONSTRAINT ck_spo_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500);
ALTER TABLE staff_permission_overrides DROP CONSTRAINT IF EXISTS ck_spo_revoke_whole;
ALTER TABLE staff_permission_overrides ADD CONSTRAINT ck_spo_revoke_whole CHECK (revoked_at IS NULL OR (revoked_by IS NOT NULL AND char_length(btrim(COALESCE(revoke_reason, ''))) BETWEEN 10 AND 500));
ALTER TABLE staff_permission_overrides DROP CONSTRAINT IF EXISTS ck_spo_expiry_after;
ALTER TABLE staff_permission_overrides ADD CONSTRAINT ck_spo_expiry_after CHECK (expires_at IS NULL OR granted_at IS NULL OR expires_at > granted_at);
COMMENT ON COLUMN staff_permission_overrides.reason IS
  'PC-56 TENANT-SW-c (F-15): WHY (recorded) — required (10–500) on every write since 0199; rows written before carry '
  '''legacy: no reason recorded (pre-0199)''. A revoked or expired override grants (or denies) nothing (core/rbac/role-cache).';

CREATE TABLE IF NOT EXISTS override_checker_codes (
  code       varchar(80) PRIMARY KEY,
  class      varchar(5) NOT NULL CONSTRAINT ck_occ_class CHECK (class IN ('money', 'pii')),
  note       varchar(300) NOT NULL
);
COMMENT ON TABLE override_checker_codes IS
  'PC-56 TENANT-SW-c (W184): the permission codes a per-staff override may GRANT only after a second tenant_admin confirms a '
  'staff_override_proposals row (13b shape). Codes already on the ungrantable list (payout.approve, wallet.adjust …) are refused '
  'outright and are not listed. No FK to permissions on purpose: some codes are seeded after migrations on a database built from empty.';
INSERT INTO override_checker_codes (code, class, note) VALUES
  ('payout.prepare',            'money', 'prepares payout batches (the maker of a money run)'),
  ('ambassador.payout.prepare', 'money', 'prepares the weekly ambassador run'),
  ('ambassador.payout',         'money', 'confirms (pays) an ambassador run'),
  ('advance.approve',           'money', 'approves a wage advance out of a booking escrow'),
  ('order.refund',              'money', 'refunds an order'),
  ('dispute.resolve',           'money', 'resolves a dispute (can refund)'),
  ('settlement.close',          'money', 'closes a settlement cycle'),
  ('payments.credit_note.issue','money', 'issues a GST credit note'),
  ('loan.manage',               'money', 'manages member loans'),
  ('wallet.view',               'money', 'reads members'' wallets'),
  ('wallet.org_view',           'money', 'reads the organisation wallet'),
  ('ledger.read',               'money', 'reads the ledger'),
  ('member.pii.reveal',         'pii',   'reveals a member''s masked personal data (recorded)'),
  ('member.view360',            'pii',   'the deepest per-person view (land, income, schemes)'),
  ('export.manage',             'pii',   'exports datasets that carry member data'),
  ('kyc.review',                'pii',   'decides KYC documents (and so unlocks money for a role)'),
  ('kyc.manage',                'pii',   'uploads KYC documents for members and the organisation')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_override_proposals (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  user_tenant_role_id uuid NOT NULL REFERENCES user_tenant_roles(id),
  grantee_user_id     uuid NOT NULL REFERENCES users(id),
  permission_code     varchar(80) NOT NULL REFERENCES permissions(code),
  override_expires_at timestamptz,
  reason              text NOT NULL CONSTRAINT ck_sop_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  proposed_by         uuid NOT NULL REFERENCES users(id),
  proposed_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  status              varchar(10) NOT NULL DEFAULT 'proposed' CONSTRAINT ck_sop_status CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by        uuid REFERENCES users(id),
  confirmed_at        timestamptz,
  refused_by          uuid REFERENCES users(id),
  refused_at          timestamptz,
  refuse_reason       text,
  expired_at          timestamptz,
  CONSTRAINT ck_sop_confirm_whole CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT ck_sop_refuse_whole  CHECK (status <> 'refused' OR (refused_by IS NOT NULL AND refused_at IS NOT NULL AND char_length(btrim(COALESCE(refuse_reason, ''))) BETWEEN 10 AND 500))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sop_live ON staff_override_proposals (user_tenant_role_id, permission_code) WHERE status = 'proposed';
COMMENT ON TABLE staff_override_proposals IS
  'PC-56 TENANT-SW-c (W184): a per-staff GRANT of a money or PII permission (override_checker_codes) is a proposal a SECOND tenant_admin '
  'confirms — never the proposer, never the grantee (trigger) — and the override row is written only in the confirming transaction '
  '(app.override_proposal_id, the 13b gate shape). 7-day expiry.';

CREATE OR REPLACE FUNCTION assert_override_proposal_moves() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[OVERRIDE_PROPOSAL_FINAL] a proposal is never deleted — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  BEGIN v_session := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_session := NULL; END;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL THEN
      RAISE EXCEPTION '[OVERRIDE_PROPOSAL_BORN] a proposal is born proposed — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF v_session IS DISTINCT FROM NEW.proposed_by OR NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[OVERRIDE_NOT_ADMIN] only a tenant_admin proposes a privileged override, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_tenant_roles u WHERE u.id = NEW.user_tenant_role_id AND u.tenant_id = NEW.tenant_id AND u.user_id = NEW.grantee_user_id AND u.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[ROLE_NOT_FOUND] the assignment is not this tenant''s — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.proposed_at := now(); NEW.expires_at := now() + interval '7 days';
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.user_tenant_role_id <> OLD.user_tenant_role_id OR NEW.grantee_user_id <> OLD.grantee_user_id
     OR NEW.permission_code <> OLD.permission_code OR NEW.override_expires_at IS DISTINCT FROM OLD.override_expires_at OR NEW.reason <> OLD.reason
     OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[OVERRIDE_PROPOSAL_FINAL] what was proposed is fixed, and a decided proposal is final — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[OVERRIDE_CHECKER_IS_MAKER] the person who proposed a privileged override cannot confirm it — a second tenant_admin must — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_by = OLD.grantee_user_id THEN
      RAISE EXCEPTION '[OVERRIDE_CHECKER_IS_GRANTEE] nobody confirms a permission for themselves — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.confirmed_by) OR v_session IS DISTINCT FROM NEW.confirmed_by THEN
      RAISE EXCEPTION '[OVERRIDE_NOT_ADMIN] only a tenant_admin confirms, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.expires_at <= now() THEN
      RAISE EXCEPTION '[OVERRIDE_PROPOSAL_EXPIRED] this proposal expired — propose again — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.confirmed_at := now();
  ELSIF NEW.status = 'refused' THEN
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.refused_by) OR v_session IS DISTINCT FROM NEW.refused_by THEN
      RAISE EXCEPTION '[OVERRIDE_NOT_ADMIN] only a tenant_admin refuses, in their own session — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.refused_at := now();
  ELSIF NEW.status = 'expired' THEN
    IF OLD.expires_at > now() THEN
      RAISE EXCEPTION '[OVERRIDE_PROPOSAL_NOT_STALE] a proposal expires only after 7 days — PC-56 TENANT-SW-c' USING ERRCODE = 'check_violation';
    END IF;
    NEW.expired_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sop_moves ON staff_override_proposals;
CREATE TRIGGER trg_sop_moves BEFORE INSERT OR UPDATE OR DELETE ON staff_override_proposals FOR EACH ROW EXECUTE FUNCTION assert_override_proposal_moves();

-- THE OVERRIDE GATE: a live GRANT of a checker code is written only in the transaction that confirms its proposal.
CREATE OR REPLACE FUNCTION assert_override_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid uuid; v_ok boolean; v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[OVERRIDE_FINAL] an override is revoked with a reason, never deleted — PC-56 TENANT-SW-c' USING ERRCODE = '42501';
  END IF;
  BEGIN v_session := NULLIF(current_setting('app.user_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_session := NULL; END;
  IF NEW.revoked_at IS NULL THEN
    NEW.granted_at := COALESCE(CASE WHEN TG_OP = 'UPDATE' AND (OLD.is_granted IS DISTINCT FROM NEW.is_granted OR OLD.revoked_at IS NOT NULL OR OLD.reason <> NEW.reason) THEN now() END,
                               NEW.granted_at, now());
    IF v_session IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.revoked_at IS NOT NULL OR OLD.is_granted IS DISTINCT FROM NEW.is_granted OR OLD.reason <> NEW.reason) THEN
      NEW.granted_by := v_session;
    END IF;
  END IF;
  IF NEW.is_granted AND NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM override_checker_codes c WHERE c.code = NEW.permission_code)
     AND (TG_OP = 'INSERT' OR OLD.revoked_at IS NOT NULL OR NOT OLD.is_granted) THEN
    BEGIN v_pid := NULLIF(current_setting('app.override_proposal_id', true), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_pid := NULL; END;
    SELECT EXISTS (SELECT 1 FROM staff_override_proposals p
                    WHERE p.id = v_pid AND p.status = 'confirmed' AND p.confirmed_at = now()
                      AND p.user_tenant_role_id = NEW.user_tenant_role_id AND p.permission_code = NEW.permission_code
                      AND p.confirmed_by <> p.proposed_by)
      INTO v_ok;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION '[OVERRIDE_NEEDS_CHECKER] granting % by override needs a second tenant_admin''s confirmation — PC-56 TENANT-SW-c', NEW.permission_code USING ERRCODE = 'check_violation';
    END IF;
    NEW.proposal_id := v_pid;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
    IF v_session IS NOT NULL THEN NEW.revoked_by := v_session; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_spo_gate ON staff_permission_overrides;
CREATE TRIGGER trg_spo_gate BEFORE INSERT OR UPDATE OR DELETE ON staff_permission_overrides FOR EACH ROW EXECUTE FUNCTION assert_override_gate();

-- ------------------------------------------------------------------------------------------------------------------
-- 199.7  RLS + GRANTS · INDEXES
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_conflict_declarations', 'kyc_claims', 'staff_invites', 'tenant_session_revocations', 'staff_override_proposals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
  END LOOP;
END $$;
GRANT SELECT ON staff_conflict_declarations, kyc_claims, tenant_session_revocations, staff_override_proposals TO kv_readonly;
-- staff_invites: no kv_readonly (it carries the phone and the sealed token)
GRANT UPDATE (active, revoked_by, revoked_at, revoke_reason, updated_at) ON staff_conflict_declarations TO kv_app;
GRANT UPDATE (released_at, released_by, release_kind, skip_reason_code, release_note) ON kyc_claims TO kv_app;
GRANT UPDATE (status, token_sealed, sent_at, send_failure, accepted_user_id, accepted_at, revoked_by, revoked_at, revoke_reason, expired_at, updated_at) ON staff_invites TO kv_app;
GRANT UPDATE (revoked_after, revoked_by, reason, updated_at) ON tenant_session_revocations TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON staff_override_proposals TO kv_app;

REVOKE ALL ON user_totp, user_recovery_codes FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON user_totp, user_recovery_codes TO kv_app;
GRANT UPDATE (secret_enc, enrolled_at, confirmed_at, last_used_step, last_used_at, disabled_at, disabled_reason, updated_at) ON user_totp TO kv_app;
GRANT UPDATE (used_at, retired_at) ON user_recovery_codes TO kv_app;

REVOKE ALL ON override_checker_codes FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON override_checker_codes TO kv_app, kv_readonly;

-- overrides: kv_app keeps INSERT/SELECT/UPDATE (the upsert); never DELETE (the gate refuses it too)
REVOKE DELETE ON staff_permission_overrides FROM kv_app, kv_relay;

CREATE INDEX IF NOT EXISTS idx_scd_staff   ON staff_conflict_declarations (tenant_id, staff_user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_scd_member  ON staff_conflict_declarations (tenant_id, member_user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_kc_stale    ON kyc_claims (tenant_id, expires_at) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kc_doc      ON kyc_claims (tenant_id, document_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_tenant   ON staff_invites (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_urc_user    ON user_recovery_codes (user_id) WHERE used_at IS NULL AND retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sop_tenant  ON staff_override_proposals (tenant_id, proposed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_utr_created_by ON user_tenant_roles (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kdd_decided ON kyc_document_decisions (tenant_id, decided_at DESC) WHERE act IN ('verify', 'reject', 'request_more');

-- ------------------------------------------------------------------------------------------------------------------
-- 199.8  FLAG (Law 10) — the invite flow (the admin-add exception path is unflagged, as before)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('staff_invites', 'PC-56 TENANT-SW-c: staff invites by SMS token + OTP on the invited phone (W183) — OFF = "Add staff directly" (with a reason) only', false, 100, '{}')
ON CONFLICT (key) DO NOTHING;
