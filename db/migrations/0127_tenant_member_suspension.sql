-- ============================================================================
-- MIGRATION 0127 — A TENANT SUSPENDS ITS OWN MEMBER, AND NOBODY ELSE'S RELATIONSHIP (PC-56 TENANT-1b-2)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS FILE EXISTS TO AVOID, WHICH IS THE OBVIOUS IMPLEMENTATION
-- ---------------------------------------------------------------------------
-- W154 (tenant Member Detail) offers a danger zone:
--
--   "Suspending a member (user_status: suspended) pauses listings and app access; money owed still pays out —
--    suspension never confiscates."
--
-- And `UserService.changeStatus` ALREADY EXISTS — reason, audit row, `assertUserTransition` state machine — with no HTTP
-- route at all. Wiring it to a tenant console is five lines, and those five lines would be the worst change in this
-- programme so far:
--
--   **`users.status` IS A COLUMN ON THE GLOBAL `users` TABLE (0003), NOT ON `user_tenant_roles`.**
--
-- So Anand FPO's staff clicking Suspend would set that person's status platform-wide. Locked out of every OTHER FPO they
-- belong to — a farmer commonly belongs to two or three — out of the consumer storefront, out of the app. `isLoginable()`
-- is checked on both the OTP and refresh paths (auth.service.ts), so the lockout would be real and immediate on the next
-- token. One tenant's member desk would hold a cross-tenant denial-of-service switch, with an audit row to make it look
-- deliberate. At 15,000 tenants that is not a hypothetical.
--
-- Rule zero: no shortcut that breaks trust. The expensive path is the right one, and this is it.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AND NOT `user_tenant_roles.is_active = false`
-- ---------------------------------------------------------------------------
-- The per-tenant membership switch already exists, and reaching for it is the second-obvious implementation. It is wrong
-- for three reasons, each of which the screen itself names:
--
--   • "**Reason ***" — a mandatory reason. `is_active` records no reason, no actor and no timestamp beyond
--     `updated_at`/`updated_by`, which is one field for every kind of edit.
--   • "**reversible**" — a lift has to be distinguishable from an ordinary re-activation, and the reason for the LIFT is
--     as much a part of the record as the reason for the suspension. `is_active = true` again says nothing.
--   • And flipping `is_active` DESTROYS INFORMATION: a member whose worker role was already inactive last season comes
--     back with it ACTIVE on a lift, or the code has to remember which rows it touched. A separate record leaves the
--     roster exactly as it was, which is what makes the reversal honest rather than approximate.
--
-- ---------------------------------------------------------------------------
-- WHERE THE SUSPENSION IS ENFORCED, AND WHAT IT DELIBERATELY DOES NOT TOUCH
-- ---------------------------------------------------------------------------
-- Four enforcement points, each chosen because the code there ALREADY reads the database — so the rule costs nothing on
-- a path that was previously free:
--
--   1. TOKEN MINT AND REFRESH, per tenant. A member suspended by Anand FPO cannot get a token FOR ANAND FPO, and signs
--      into their other FPO exactly as before. That per-tenant asymmetry is the entire point of this file.
--   2. `RoleCacheService.effectiveAccess(user, tenant)` — the single authority for what somebody may do inside a tenant.
--      A suspension resolves to zero roles and zero permissions THERE and nowhere else. Invalidated on suspend and lift,
--      so the effect does not wait for the 5-minute cache.
--   3. LISTING CREATE / PUBLISH / REPOST — a suspended seller puts no new produce on the market.
--   4. THE FIVE PUBLIC LISTING READ SITES — their live listings stop being publicly visible. One shared SQL fragment
--      used at every site, with a test that enumerates the sites so a sixth cannot quietly forget it.
--
-- **AND THE PAYOUT PATH GAINS NO CHECK, ON PURPOSE.** "Money owed still pays out — suspension never confiscates" is a
-- promise about a farmer's earned income, and the way to keep it is for `PayoutService` to know nothing about this table.
-- There is a test asserting that ABSENCE, because a later reader "tidying up" by adding a status check here would turn a
-- suspension into a confiscation.
--
-- Note on the bound: this platform's RBAC is carried in the access token (`perms` claim, `JWT_ACCESS_TTL_SEC` = 900).
-- That is a pre-existing property — every revocation on this platform, including a role removal, is effective within 15
-- minutes for somebody already signed in — and the console says so rather than implying an instant cut-off. The write and
-- read paths above are immediate regardless, so a suspended member cannot list, sell or be seen in the meantime.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 127.1  THE RECORD
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_member_suspensions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  -- MANDATORY, and long enough to be a sentence. W154 marks the field with an asterisk; a suspension without a stated
  -- reason is an act nobody can review, and this one takes a person's livelihood off a marketplace.
  reason       varchar(500) NOT NULL CHECK (length(btrim(reason)) >= 20),
  suspended_by uuid NOT NULL REFERENCES users(id),
  -- THE LIFT. All three columns move together or none do: a lifted_at with no actor is a reversal nobody performed.
  lifted_at    timestamptz,
  lifted_by    uuid REFERENCES users(id),
  lift_reason  varchar(500),
  CONSTRAINT ck_tms_lift_complete CHECK (
    (lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL)
    OR (lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND length(btrim(coalesce(lift_reason, ''))) >= 20)
  ),
  -- A suspension is an act BY somebody ON somebody. Self-suspension is not a thing a member desk does, and allowing it
  -- would let a staff member erase their own listings with an audit trail pointing only at themselves.
  CONSTRAINT ck_tms_not_self CHECK (user_id <> suspended_by)
);
CALL add_std_columns('tenant_member_suspensions');

-- **ONE LIVE SUSPENSION PER MEMBER PER TENANT, ENFORCED BY THE DATABASE.** Two live rows would make "is this member
-- suspended" a question with two answers and "lift it" an act with an arbitrary target. A partial unique index is the
-- right shape: the HISTORY is unbounded (a member may be suspended, lifted and suspended again, and every episode stays
-- readable), while at most one episode is open.
CREATE UNIQUE INDEX uq_tms_live ON tenant_member_suspensions(tenant_id, user_id)
  WHERE lifted_at IS NULL AND deleted_at IS NULL;

-- The lookup every enforcement point makes. Partial, so the index holds ONLY live suspensions — a few rows per tenant
-- rather than the whole history — which is what makes the NOT EXISTS on the public listing feed affordable.
CREATE INDEX idx_tms_live_lookup ON tenant_member_suspensions(tenant_id, user_id)
  WHERE lifted_at IS NULL AND deleted_at IS NULL;
-- The member desk's own list: current suspensions in a tenant, newest first.
CREATE INDEX idx_tms_tenant_recent ON tenant_member_suspensions(tenant_id, created_at DESC);

REVOKE ALL ON tenant_member_suspensions FROM kv_relay;
-- The tenant realm reads this on the paths above and WRITES it from the member desk: unlike the eligibility map in 0125,
-- this record is the tenant's own decision about its own member, and it belongs to them.
GRANT SELECT, INSERT, UPDATE ON tenant_member_suspensions TO kv_app;
GRANT SELECT ON tenant_member_suspensions TO kv_readonly;
-- **NO DELETE, EVER.** A suspension episode is evidence: the member may dispute it, a regulator may ask, and a lift is
-- recorded as a lift rather than as the row disappearing. The 0014 ALTER DEFAULT PRIVILEGES trap means this has to be an
-- explicit REVOKE rather than an assumption.
REVOKE DELETE ON tenant_member_suspensions FROM kv_app;

-- RLS: this carries `tenant_id`, so 0014's idempotent sweep picks it up. Stated because a reader who checks the grants
-- and not the policy would think one tenant could read another's suspensions — which would leak that a farmer had been
-- suspended elsewhere, exactly the cross-tenant disclosure this whole file exists to prevent.
ALTER TABLE tenant_member_suspensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_member_suspensions ON tenant_member_suspensions
  FOR ALL
  USING (tenant_id = current_tenant_id());

COMMENT ON TABLE tenant_member_suspensions IS
  'A TENANT suspending its own member (0127, W154). Scoped to one tenant on purpose: users.status is GLOBAL, so using it here would lock the member out of every other tenant and the storefront. Pauses that tenant''s app access (token mint/refresh + RBAC resolution) and their listings (create/publish + the five public read sites). Does NOT touch payouts — money owed still pays out; suspension never confiscates.';

COMMENT ON COLUMN tenant_member_suspensions.reason IS
  'Mandatory, 20+ characters after trimming. Read by the member, by a reviewer, and potentially by a regulator.';

-- ---------------------------------------------------------------------------
-- 127.2  A NOTE ON THE COLUMN THIS FILE REFUSES TO USE
-- ---------------------------------------------------------------------------
-- Left on `users.status` so the next person to reach for it from a tenant surface reads this first. The column is not
-- wrong — it is the PLATFORM's status, set by the god-mode realm, and ADMIN-9's operator plane is where it belongs.
COMMENT ON COLUMN users.status IS
  'PLATFORM-WIDE user status (active|pending_verification|suspended|restricted|soft_deleted). GLOBAL: setting it affects every tenant the person belongs to AND the consumer storefront, so it is an ADMIN-REALM act only. A TENANT suspending its own member uses tenant_member_suspensions (0127) — never this column.';

-- ---------------------------------------------------------------------------
-- 127.3  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- NO MAKER-CHECKER, IN EITHER DIRECTION, AND THE ASYMMETRY THIS PROGRAMME USES ELSEWHERE IS DELIBERATELY NOT APPLIED.
-- The established rule has been "restrictive = one person, permissive = two". Here BOTH acts are one person with a
-- reason, because the second signature would fall on the wrong side: requiring two people to LIFT a suspension keeps a
-- wrongly-suspended farmer off the marketplace for longer, and the harm of a mistaken suspension is borne entirely by
-- the member. The same scope that can suspend can lift, which makes the error cheap to reverse — and every episode is
-- recorded with both reasons, so the review happens after the farmer is trading again rather than before.
--
-- NO AUTOMATIC EXPIRY. A suspension with a timer would end itself while the reason for it was still true, and nobody
-- would have looked. It ends when a person decides it ends and says why.
--
-- NO NOTIFICATION TO THE MEMBER YET. It should exist — being suspended without being told is not a thing this platform
-- should do — and the notification event, template and DLT registration are a communication-plane change rather than a
-- migration's business. TENANT-1b-2-Q1, and the console says plainly that the member is not told automatically, so staff
-- know to ring them.
--
-- NO CANCELLATION OF IN-FLIGHT ORDERS. A suspended seller's existing orders continue: a buyer who paid for groundnut is
-- owed groundnut, and the dispute plane already handles a seller who then fails to deliver. Cancelling live orders would
-- punish the buyer for the seller's suspension.
