-- ============================================================================
-- MIGRATION 0118 — THE REALM THAT CANNOT NAME ITS OWN OPERATORS (PC-56 ADMIN-9)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT: EVERY ADMIN REQUEST IS AUTHORISED BY A TOKEN AND CHECKED AGAINST NOTHING
-- ---------------------------------------------------------------------------
-- `AdminAuthGuard.canActivate` verifies the JWT signature, reads `sub`, `roles`, `amr`, `auth_time`, `sid`, resolves
-- permissions from the static catalogue in `owner-roles.ts`, and returns true. **It touches no database, ever.** The
-- consequences, each verified rather than inferred:
--
--   * THERE IS NO LIST OF PLATFORM OPERATORS ANYWHERE. `grep "CREATE TABLE .*(staff|admin_user|operator)"` over every
--     migration returns one row — `staff_permission_overrides`, keyed on `user_tenant_role_id`, which is a TENANT
--     staff member. W104 claims "Active staff 31" and "FIDO2 enrolled 31/31". Nothing on this platform can count to 31.
--   * A DEPARTED OPERATOR KEEPS FULL ACCESS UNTIL THEIR TOKEN EXPIRES, and nothing here can shorten that. W104 states
--     "Deactivation is immediate and audited — sessions killed, keys unbound... Departing staff are deactivated before
--     the exit conversation, not after." **There is no deactivation.** There is no row to flip and no check that would
--     read it. The only thing standing between a dismissed operator and the god-mode realm is the IdP's own revocation
--     and the token's `exp`.
--   * SIGNING OUT CANNOT INVALIDATE A LIVE ADMIN SESSION. The token carries `sid`; `admin-jwt.strategy.ts` copies it
--     onto the principal; **no guard, service or query reads it.** `clearAdminSession()` in web-admin deletes a cookie.
--     A copied bearer keeps working.
--   * DORMANCY DOES NOT EXIST FOR OPERATORS. `users.last_active_at` is written by apps/api for farmers; admin-api never
--     reads or writes it. W439 states "Dormant flag 30 days · Auto-suspend 45 days · Tracked by users.last_active_at" —
--     three facts about an operator, tracked by a column that describes somebody else.
--
-- **THIS IS THE NINTH OCCURRENCE OF THE REALM-IDENTITY PROBLEM AND THE FIRST WHERE IT IS THE SUBJECT RATHER THAN AN
-- OBSTACLE.** Eight times a table needed to record which platform operator did something and answered it with a bare
-- `*_admin_id uuid` and no FK (0038, 0099, 0100, 0101, 0103, 0112, 0114, 0115, 0116, 0117). Every one of those columns
-- points at an identity space **that has no home**. This migration gives it one.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
-- ---------------------------------------------------------------------------
-- W104's own deferral banner frames the choice as: "user_tenant_roles requires tenant_id, so platform-scope roles have
-- no storage home yet (platform pseudo-tenant vs. new table = founder decision)."
--
-- **BOTH OF THOSE OPTIONS PUT PLATFORM STAFF IN THE TENANT REALM'S TABLES, WHICH IS THE ONE THING THE TWO-REALM SPLIT
-- EXISTS TO PREVENT** — and 0101 already rejected exactly that, in writing, for exactly this reason: "INVENT A PLATFORM
-- ACCOUNT INSIDE EVERY TENANT'S USER TABLE — a cross-tenant identity, which is precisely what the two-realm split exists
-- to prevent." A pseudo-tenant is option (a) wearing a different hat. So this file takes neither: `platform_operators`
-- is an ADMIN-REALM table with no `tenant_id`, no FK into `users`, and no relationship to tenant RBAC.
--
-- (0074's header asserts the opposite — "there is no separate 'platform staff' table; a platform staff member is simply
-- a users row" — and `fido2_credentials.user_id REFERENCES users(id)` was built on that reading. The two readings have
-- coexisted since 0074 and only one can be true. This file settles it the way 0101/0103/0105/0107/0112 already had in
-- practice; 0074's table is left alone and ADMIN-9-Q3 records that it is unusable by the operators W439 is about.)
--
-- **IT IS NOT AN IDENTITY PROVIDER AND IT MUST NEVER BECOME ONE.** Authentication happens at the IdP; the token is the
-- credential. Rows here are OBSERVED — written from what arrived on real requests — never invented, never synced from a
-- directory this realm cannot read. Every column is something the realm actually saw. That constraint is why there is
-- no `full_name` and no `email` column: **the admin token carries no name claim**, so a roster with names would be a
-- roster of values this realm cannot obtain. W104 renders "Arif M. · ari•••@krishalaya.com" and the console will render
-- an operator id, because inventing a display name is inventing a person.
--
-- ---------------------------------------------------------------------------
-- THE GOVERNING RULE: THIS TABLE CAN REVOKE, AND CAN NEVER GRANT
-- ---------------------------------------------------------------------------
-- Law 5 is reflect-never-grant and Law 11 puts platform permissions in the god-mode realm's compiled catalogue, never in
-- data. So the guard's contract after this migration is exactly:
--
--     permissions = resolveOwnerPermissions(token.roles)  MINUS  restrictions(operator)
--
-- **A row in this database can only ever take a permission away.** If `platform_operator_restrictions` could add one,
-- then an INSERT — by anything holding a write grant, including a bug — would be a privilege escalation into god-mode,
-- and the compiled catalogue would stop being the ceiling. W104 shows two overrides on its roster: "+1 (refunds ≤
-- ₹10,000)" and "−1 (read-only enforced)". **Only the second can exist in this realm, and that asymmetry is the
-- control, not a limitation.** `ck_por_deny_only` makes it unrepresentable.
--
-- ---------------------------------------------------------------------------
-- SUSPENSION IS ONE PERSON; REINSTATEMENT IS TWO — THE INVERSE OF EVERY OTHER SITE
-- ---------------------------------------------------------------------------
-- The platform's thirteen maker-checker sites all gate the PERMISSIVE direction: approve a payout, promote a model,
-- apply a map change, publish a scheme version. Here the permissive direction is RESTORING access to the god-mode
-- realm, and the restrictive direction is removing it.
--
-- So suspension takes one operator and takes effect on the next request. **A second-person rule on an emergency
-- control is a second-person rule on a 2 a.m. incident**, and a platform that cannot cut off a compromised operator
-- until it finds a checker has built a control that will be bypassed the first time it matters. Reinstatement — putting
-- somebody back inside the realm — is the FOURTEENTH maker-checker site (`ck_por_reinstate_maker_ne_checker`).
--
-- ---------------------------------------------------------------------------
-- DORMANCY IS ENFORCED AT THE DOOR, NOT BY A JOB
-- ---------------------------------------------------------------------------
-- W439 promises auto-suspend at 45 days. A scheduled sweep would be the obvious build and would be wrong twice over:
-- it is one more job that can silently stop (0113 and 0114 are both findings of exactly that), and it suspends people
-- at 03:00 for a threshold they crossed in their sleep. The guard already runs on the only event that matters — an
-- attempt to USE the realm — so the check happens there: an operator whose last observed request is older than the
-- suspend line is refused AND recorded as suspended, in that order.
--
-- The honest consequence, which the console states rather than hides: a dormant operator's row still reads `active`
-- until they try to come back. **The roster therefore shows "past the line — will be refused and suspended at the next
-- request", never "suspended", because claiming a suspension that has not happened is exactly the defect this
-- programme has now found six times.**
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 118.1  THE OPERATOR RECORD — observed, never invented
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operators (
  -- The IdP's `sub`, and deliberately NOT a generated id: this row IS that subject, and a surrogate key would let two
  -- rows claim one operator. No FK — `users` is the tenant realm (0101/0103's reasoning, now the tenth application).
  admin_user_id     uuid PRIMARY KEY,

  -- OBSERVED FACTS. Every one of these is written from a request that actually arrived.
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_ip      inet,
  -- The roles the token carried last time. A MIRROR FOR DISPLAY, never an input to authorisation: permissions resolve
  -- from the live token's claim against the compiled catalogue, so a stale array here can mislead a reader but can
  -- never grant anything. The console labels it "last seen carrying" for that reason.
  last_roles        jsonb NOT NULL DEFAULT '[]',
  last_amr          jsonb NOT NULL DEFAULT '[]',
  request_count     bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),

  -- THE ONE FIELD THAT CHANGES WHAT THE REALM DOES.
  status            varchar(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended')),
  suspended_at      timestamptz,
  suspended_by_admin_id uuid,
  suspend_reason    text,
  -- 'manual' | 'dormant' — an auto-suspension and a human decision are not the same event and a console that renders
  -- them alike would let a dismissal hide inside a dormancy sweep.
  suspend_kind      varchar(20),

  reinstated_at     timestamptz,
  reinstated_by_admin_id uuid,
  reinstate_requested_by_admin_id uuid,
  reinstate_reason  text,

  -- Free-text the realm keeps about its own operator (desk, on-call rota). NOT a name: see the header.
  note              text,

  CONSTRAINT ck_po_suspended_evidence CHECK (
    status <> 'suspended'
    OR (suspended_at IS NOT NULL AND suspend_kind IN ('manual', 'dormant')
        AND (suspend_kind = 'dormant' OR (suspended_by_admin_id IS NOT NULL AND length(coalesce(suspend_reason, '')) >= 10)))
  ),
  -- **REINSTATEMENT IS THE FOURTEENTH MAKER-CHECKER SITE**, and the direction is the point: removing access is one
  -- person, restoring it is two. Self-reinstatement is the specific act this forbids — an operator who has been
  -- suspended must not be able to let themselves back in.
  CONSTRAINT ck_po_reinstate_maker_ne_checker CHECK (
    reinstated_by_admin_id IS NULL
    OR reinstate_requested_by_admin_id IS NULL
    OR reinstated_by_admin_id <> reinstate_requested_by_admin_id
  ),
  CONSTRAINT ck_po_reinstate_evidence CHECK (
    reinstated_at IS NULL
    OR (reinstated_by_admin_id IS NOT NULL AND reinstate_requested_by_admin_id IS NOT NULL
        AND length(coalesce(reinstate_reason, '')) >= 10)
  )
);
CALL add_std_columns('platform_operators');
CREATE INDEX idx_po_last_seen ON platform_operators(last_seen_at DESC, admin_user_id);
CREATE INDEX idx_po_status ON platform_operators(status, last_seen_at DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE platform_operators IS
  'The admin realm''s OWN record of the operators it has seen. Observed from real requests, never synced from a '
  'directory. Authentication remains the IdP''s; this table can only ever REFUSE (status=suspended), never authorise.';
COMMENT ON COLUMN platform_operators.last_roles IS
  'Display mirror of the last token''s roles claim. Never read for authorisation — permissions resolve from the live '
  'token against owner-roles.ts (Law 11), so a stale value here cannot grant anything.';

-- ---------------------------------------------------------------------------
-- 118.2  SESSIONS — so that "sign out" and "kill their sessions" can mean something
-- ---------------------------------------------------------------------------
-- The `sid` claim has been minted, carried and ignored since the realm was built. One row per observed session turns
-- three separate promises into facts: W439's "Active sessions / Revoke", W104's "sessions killed within 60s", and the
-- ordinary expectation that signing out ends a session rather than deleting a cookie.
CREATE TABLE platform_operator_sessions (
  session_id        varchar(80) PRIMARY KEY,          -- the token's `sid`; opaque, minted elsewhere
  admin_user_id     uuid NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  ip                inet,
  user_agent        varchar(300),
  -- The token's own `auth_time` — when the IdP last did a strong re-auth for this session. Recorded so W439's step-up
  -- age is read from the credential rather than guessed from session start.
  auth_time_at      timestamptz,
  amr               jsonb NOT NULL DEFAULT '[]',
  -- The token's `exp`, so the console can distinguish "ended" from "expired on its own" without inventing either.
  token_expires_at  timestamptz,
  revoked_at        timestamptz,
  revoked_by_admin_id uuid,
  revoke_reason     text,
  CONSTRAINT ck_pos_revoke_evidence CHECK (
    revoked_at IS NULL OR (revoked_by_admin_id IS NOT NULL AND length(coalesce(revoke_reason, '')) >= 5)
  )
);
CREATE INDEX idx_pos_operator ON platform_operator_sessions(admin_user_id, last_seen_at DESC);
CREATE INDEX idx_pos_live ON platform_operator_sessions(admin_user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE platform_operator_sessions IS
  'One row per admin `sid` the realm has observed. A revoked row is refused by AdminAuthGuard on the next request — '
  'the first admin-realm session revocation that exists at all.';

-- ---------------------------------------------------------------------------
-- 118.3  RESTRICTIONS — DENY ONLY. The asymmetry IS the control.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_operator_restrictions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  admin_user_id     uuid NOT NULL,
  -- A permission code from owner-roles.ts, or '*' meaning "every permission this operator's roles would give".
  -- Deliberately NOT an FK to `permissions`: that table is the TENANT realm's catalogue (0003) and these codes are the
  -- platform's, which live in code. An FK here would be the two realms' vocabularies pretending to be one.
  permission_code   varchar(80) NOT NULL,
  -- Present and always false. A boolean that can only hold one value looks redundant and is not: it makes the deny-only
  -- rule VISIBLE in the row and in every query that reads it, and `ck_por_deny_only` makes the other value impossible.
  -- The alternative — no column — would leave the rule living only in whichever service happened to apply it.
  is_granted        boolean NOT NULL DEFAULT false,
  reason            text NOT NULL,
  applied_by_admin_id uuid NOT NULL,
  expires_at        timestamptz,                       -- a restriction may be time-boxed; NULL = until lifted
  lifted_at         timestamptz,
  lifted_by_admin_id uuid,
  lift_reason       text,
  CONSTRAINT ck_por_deny_only CHECK (is_granted = false),
  CONSTRAINT ck_por_reason CHECK (length(reason) >= 10),
  CONSTRAINT ck_por_lift_evidence CHECK (
    lifted_at IS NULL OR (lifted_by_admin_id IS NOT NULL AND length(coalesce(lift_reason, '')) >= 10)
  )
);
CALL add_std_columns('platform_operator_restrictions');
CREATE INDEX idx_por_live ON platform_operator_restrictions(admin_user_id)
  WHERE lifted_at IS NULL AND deleted_at IS NULL;
-- One live restriction per (operator, permission). Two rows denying the same code would make "lift the restriction"
-- ambiguous, and a lift that left a duplicate behind would look successful and change nothing.
CREATE UNIQUE INDEX uq_por_live_code ON platform_operator_restrictions(admin_user_id, permission_code)
  WHERE lifted_at IS NULL AND deleted_at IS NULL;

COMMENT ON TABLE platform_operator_restrictions IS
  'DENY-ONLY permission removals for a platform operator. The guard subtracts these from the compiled catalogue''s '
  'answer. A row here can never add a permission (ck_por_deny_only) — if it could, an INSERT would be an escalation '
  'into god-mode and owner-roles.ts would stop being the ceiling (Law 5, Law 11).';

-- ---------------------------------------------------------------------------
-- 118.4  STEP-UP EVENTS — including the refusals, which are the interesting half
-- ---------------------------------------------------------------------------
-- W439 renders a step-up log whose fourth row is `failed · retried`. A log of successful elevations only would answer
-- "did I re-authenticate" and never "did somebody try to reach a gated action without the key", which is the question
-- a security page exists for.
CREATE TABLE platform_step_up_events (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  admin_user_id     uuid NOT NULL,
  session_id        varchar(80),
  gate              varchar(20) NOT NULL CHECK (gate IN ('hardware_key', 'step_up')),
  action_route      varchar(200) NOT NULL,             -- the gated route, never a body
  outcome           varchar(20) NOT NULL CHECK (outcome IN ('verified', 'refused')),
  detail            varchar(300),
  ip                inet,
  user_agent        varchar(300),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pse_operator ON platform_step_up_events(admin_user_id, created_at DESC, id);

-- ---------------------------------------------------------------------------
-- 118.5  APPEND-ONLY, AND THE GRANT DEFECT THIS FILE ALSO CLOSES
-- ---------------------------------------------------------------------------
-- 0014 line 157 runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO kv_app`, so
-- every table created afterwards silently hands the TENANT API role write access unless the migration revokes it. The
-- 0077/0078 sweeps were keyed on money relations and never covered the god-mode tables.
--
-- **THE LIVE CONSEQUENCE, VERIFIED AND NOT HYPOTHETICAL: `kv_app` TODAY HOLDS SELECT/INSERT/UPDATE ON
-- `impersonation_grants`, `impersonation_actions` AND `fido2_credentials`.** 0038 and 0074 issue no REVOKE. The tenant
-- API role can mint itself an impersonation grant row and can rewrite the god-mode realm's record of who impersonated
-- whom. That is a live privilege defect on the platform's most sensitive audit trail, so it is fixed here rather than
-- deferred to the impersonation wave that will otherwise build on top of it (ADMIN-9b).
REVOKE ALL ON platform_operators, platform_operator_sessions, platform_operator_restrictions,
              platform_step_up_events FROM kv_app, kv_relay;
GRANT SELECT ON platform_operators, platform_operator_sessions, platform_operator_restrictions,
                platform_step_up_events TO kv_readonly;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON impersonation_grants, impersonation_actions FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fido2_credentials FROM kv_app, kv_relay;
-- `impersonation_actions` is described by W008 as a permanent per-action record with 7-year retention. Nothing made it
-- append-only — it is absent from 0014's REVOKE list — so kv_admin could edit the log of its own conduct. The whole
-- point of that log is that the operator it describes cannot alter it.
REVOKE UPDATE, DELETE ON impersonation_actions FROM kv_admin;
REVOKE UPDATE, DELETE ON platform_step_up_events FROM kv_admin;

-- ---------------------------------------------------------------------------
-- 118.6  THE DORMANCY LINES, IN THE DATABASE RATHER THAN IN A CONSTANT
-- ---------------------------------------------------------------------------
-- W439 states 30 days to dormant and 45 to auto-suspend. They live here because the guard, the roster and the console
-- must agree, and three copies of "45" in three languages is how a threshold quietly becomes two thresholds (the
-- ADMIN-7 finding, four weight/threshold drifts, is the precedent).
CREATE TABLE platform_access_policy (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single row, enforced by the key
  dormant_after_days  integer NOT NULL DEFAULT 30 CHECK (dormant_after_days > 0),
  suspend_after_days  integer NOT NULL DEFAULT 45 CHECK (suspend_after_days > 0),
  -- How often the guard refreshes `last_seen_at`. A write on every request would multiply admin traffic by one UPDATE
  -- for no added truth; the read that decides access happens every time regardless.
  touch_interval_sec  integer NOT NULL DEFAULT 60 CHECK (touch_interval_sec >= 0),
  updated_by_admin_id uuid,
  CONSTRAINT ck_pap_order CHECK (suspend_after_days > dormant_after_days)
);
CALL add_std_columns('platform_access_policy');
INSERT INTO platform_access_policy (id) VALUES (true);
REVOKE ALL ON platform_access_policy FROM kv_app, kv_relay;
GRANT SELECT ON platform_access_policy TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 118.7  RLS
-- ---------------------------------------------------------------------------
-- None of these four tables carries a `tenant_id`: they are the platform's own record of its own operators, and no
-- tenant should ever read them. The idempotent tenant-isolation sweep enrols only tables with a literal `tenant_id`
-- column, so it skips these by construction — stated here so a future reader does not read the absence as an omission.
