-- ============================================================================
-- MIGRATION 0131 — THERE WAS NO DOOR (PC-56 TENANT-1d-3a)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE FINDING: NOTHING IN THIS PLATFORM COULD CREATE A TENANT FROM THE OUTSIDE
-- ---------------------------------------------------------------------------
-- W113 (tenant sign-up) is unambiguous about what it is:
--
--     "No account needed to start · Bring your organisation online"
--     "14-day free trial · no card needed · GO LIVE THE SAME DAY"
--     "Krishalaya issues one active storefront per verified phone number — a second attempt from the same number resumes
--      the first, it never starts a duplicate."
--
-- TENANT-1d recorded this screen as "GAP-UI-QUEUED · tenant self-serve signup exists in apps/api (the tenancy module's own
-- integration suite covers it)". **IT DOES NOT.** `tenant-self-serve.integration.spec.ts` is the IN-TENANT self-serve
-- plane — a tenant admin editing its own profile — and its own header says so: "Provisions a full tenants row directly
-- (0002 columns) — provisioning itself is god-mode, not part of this plane."
--
-- What actually exists:
--   * `POST /v1/tenant-applications` (0081) — a PUBLIC intake, 3 per hour per IP, which files a REVIEW request. A human
--     decides, and only then is a tenant provisioned. That is a legitimate path, and it is NOT what W113 describes: a
--     screen promising "go live the same day" while filing a review request is a screen that lies about a wait.
--   * `POST /v1/auth/otp` + `/verify` — and **`VerifyOtpSchema` REQUIRES `tenantId` as a uuid.** So a person who does not
--     yet belong to any organisation cannot authenticate at all.
--   * `tenants.controller` — only `me` routes. Nothing creates a tenant.
--
-- **SO "NO ACCOUNT NEEDED TO START" HAD NO DOOR, IN EITHER DIRECTION: no way to sign up, and no way to sign in without
-- already belonging somewhere.** The screen was never built, which is why nobody noticed the plane behind it was missing
-- too — the same shape as TENANT-1d-2's finding one wave earlier, and the reason a "console half queued" note deserves
-- less trust than it usually gets.
--
-- ---------------------------------------------------------------------------
-- WHY SELF-SERVE CREATION IS NOT A LAW 11 VIOLATION, STATED BEFORE IT IS BUILT
-- ---------------------------------------------------------------------------
-- Law 11 keeps god-mode out of the tenant realm: tenant LIFECYCLE (status changes), feature grants and provisioning live
-- in apps/admin-api. A public route in apps/api that creates a tenant therefore needs an argument, not an assumption.
--
-- The argument: **creating your own organisation is not operating somebody else's.** The route is constrained so that it
-- can do exactly one thing and nothing adjacent:
--   * it can only CREATE, never read, update or touch any existing tenant;
--   * the new tenant starts at `status = 'trial'` — it cannot set `active`, `suspended` or any other lifecycle state, so
--     going properly live still passes through the operator plane and the go-live checklist (TENANT-1c);
--   * it grants no features. Capability comes from the plan, resolved the ordinary way;
--   * it is gated on a VERIFIED phone (the same OtpService the login path uses — one verification implementation, not a
--     second one), rate-limited per IP and per phone, and requires an Idempotency-Key;
--   * one active organisation per verified phone, so the route cannot be used to manufacture tenants.
--
-- What it does NOT get: no self-serve provisioning of a SECOND tenant for a phone that already owns one (that is a sales
-- conversation), no feature grants, no status changes, no plan choice beyond the trial plan below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 131.1  WHAT A NEW ORGANISATION GETS, AS DATA
-- ---------------------------------------------------------------------------
-- **THE TRIAL PLAN IS A SETTING BECAUSE A PLAN CODE IS A COUNTRY'S BUSINESS.** W113 says "14-day free trial"; hard-coding
-- `growth` and `14` would be rule zero broken twice — a Bangladeshi catalogue has its own codes, and a fourteen-day trial
-- is a commercial decision a founder must be able to change without a deploy.
--
-- `money_path`, so it takes two administrators: this setting decides what every new tenant on the platform is put on and
-- therefore what they are billed when the trial converts.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES
  ('signup.trial_plan_code', 'string', 'platform', 'money_path', '"starter"'::jsonb,
   'The plan code a self-serve signup is placed on for its trial (W113: "14-day free trial · no card needed"). Must exist in `plans` for the tenant''s country, and must be a PUBLIC plan — an enterprise quote is not a trial. Signup REFUSES rather than guessing if it cannot resolve this.',
   'This decides what every new organisation on the platform is put on, and what they are billed when the trial converts. Two administrators.'),
  ('signup.trial_days', 'int', 'platform', 'money_path', '14'::jsonb,
   'How many days a self-serve trial runs before the subscription needs a plan decision. W113 prints "14-day free trial". Zero is refused — a trial that ends the moment it starts would put a co-operative into dunning on day one.',
   'This is the length of every new organisation''s trial. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 131.2  ONE ACTIVE ORGANISATION PER VERIFIED PHONE
-- ---------------------------------------------------------------------------
-- W113: "Krishalaya issues one active storefront per verified phone number — a second attempt from the same number
-- RESUMES the first, it never starts a duplicate." And its own error state: "Number already registered · This mobile runs
-- Junagadh Kisan Producer Co. — sign in instead."
--
-- **THE RULE IS ENFORCED ON THE OWNER'S ROLE GRANT, NOT ON A COLUMN.** `tenants.owner_phone` exists (0002) and is a
-- CONTACT field: it is edited, it can be a landline, it can be an office number shared by two organisations, and nothing
-- keeps it in step with who actually administers the console. Ownership that matters is the `tenant_admin` grant in
-- `user_tenant_roles`, resolved from the verified phone's user — which is also what decides what the person can DO, so the
-- two can never disagree.
--
-- No unique index is added for it, and that is deliberate: a partial unique index across `user_tenant_roles` would also
-- forbid a legitimate case the platform must keep — a person who administers a federation AND a dairy union that an
-- operator provisioned for them. The rule belongs to the self-serve route, which is the only place it applies.
--
-- This index is the lookup that route makes on every attempt, and the resume path makes twice.
CREATE INDEX IF NOT EXISTS idx_utr_admin_by_user
  ON user_tenant_roles(user_id, tenant_id)
  WHERE is_active = true AND deleted_at IS NULL;

COMMENT ON COLUMN tenants.owner_phone IS
  'CONTACT number for the organisation''s owner — a human-readable field, not an identity. **NOT the basis of the one-organisation-per-phone rule (0131)**: that is decided from the verified phone''s `tenant_admin` grant in `user_tenant_roles`, because this column is editable, can be a shared office line, and is not kept in step with who administers the console.';

-- ---------------------------------------------------------------------------
-- 131.3  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **NO NEW TABLE.** A signup produces a `users` row, a `tenants` row, a `user_tenant_roles` grant and a `subscriptions`
-- row — all of which already exist. A `signups` table would be a second record of an event the four of them already
-- describe, and it would drift from them (the shape TENANT-1c and TENANT-1e both refused).
--
-- NO TRIAL-EXPIRY BEHAVIOUR. `subscriptions.status = 'trialing'` with a 14-day period is what a trial IS, and 0002's
-- lifecycle plus the existing (unregistered) trial-expiry job own what happens at the end of it. Naming it here:
-- **that job is still not registered anywhere**, so a trial currently ends by the period simply elapsing with nothing
-- said to the tenant (TENANT-1d-3-Q1).
--
-- NO EMAIL. W113 collects a phone, not an email, and the platform has no email provider configured anyway.
--
-- NO SECOND-TENANT PATH. A phone that already administers an organisation is RESUMED, never given a second one, because a
-- self-serve route that could mint tenants in a loop is an abuse surface with a billing consequence.
