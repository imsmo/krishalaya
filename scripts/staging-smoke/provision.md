# Staging one-time provisioning — pilot tenant + founder test user + feature flags

Run this **once** per staging environment before `smoke.mjs` is usable. It has two parts:

- **Part A (feature flags)** — `apps/admin-api` genuinely has an HTTP surface for this
  (`apps/admin-api/src/modules/flags-ops/`). Use it.
- **Part B (tenant + user + roles)** — **no HTTP endpoint exists anywhere in this codebase** to create
  a tenant or grant a user a tenant-role from scratch. This is the exact same finding
  `scripts/pilot-e2e/README.md` documents ("Onboarding: why direct SQL, not an HTTP call") — verified
  again here against the current source, see "Why no endpoint" below. Since the staging Postgres
  isn't reachable directly from a laptop (unlike pilot-e2e's local docker Postgres), this part is a
  `psql`-over-bastion SQL block instead of a Node script.

Do Part B first (the tenant has to exist before you can target it with a flag in Part A), then Part A.

---

## Part B — tenant + founder test user + roles (psql via bastion)

### Why no endpoint (verified against source)

- `apps/admin-api/src/modules/tenant-ops/tenant-ops.controller.ts` exposes
  `POST /v1/tenants/:id/approve|suspend|archive` and `PATCH /v1/tenants/:id/limits` — all of them
  **mutate the status of a tenant row that already exists** (`ApproveTenantService.approve` does
  `repo.getForUpdate(client, id)` then throws `TenantNotFoundError` if it's not there). None of them
  **create** a tenant.
- `apps/api/src/modules/tenancy/controllers/v1/tenants.controller.ts` (the self-serve tenant surface)
  is scoped entirely to `ctx.tenantId` — every route reads/writes "my own tenant"; there is no
  `:tenantId` param and no bare `POST /v1/tenants` to create one. Its own integration test says so
  directly: `apps/api/src/modules/tenancy/__tests__/tenant-self-serve.integration.spec.ts` provisions
  the tenant row with a raw `INSERT INTO tenants` in a `provisionTenant()` helper and comments
  "provisioning itself is god-mode, not part of this plane."
- Granting a user a role in a tenant (`user_tenant_roles`) is likewise only reachable via
  `POST /v1/rbac/assignments`, which itself requires the caller to already hold `identity.approve` in
  that tenant — i.e. it onboards a *second* user once a first admin already exists. For the *first*
  user in a brand-new tenant, nothing holds that permission yet. (`POST /v1/users`,
  `apps/api/src/modules/identity/controllers/v1/users.controller.ts`, has the same bootstrap problem —
  it also requires `identity.approve`.)

So: SQL, via the bastion, exactly once per staging environment (or once per re-provisioning if you
tear the pilot tenant down). This mirrors `scripts/pilot-e2e/flow.mjs`'s "onboard farmer + buyer" step
almost verbatim, adapted for a single founder user holding three roles instead of two separate users.

> **KV-BL-066 (Sprint S3) update:** the `farmer`/`customer` role-grant rows below no longer strictly
> require this SQL path — `POST /v1/onboarding/roles` (authenticated, non-admin, behind the
> `selfserve_onboarding` flag) now lets an already-logged-in user self-grant those two roles without
> `identity.approve`. It does **not** solve tenant creation or the `tenant_admin` grant below (still
> genuinely god-mode / admin-only), so this block stays as-is for now — swapping the farmer/customer
> inserts for real HTTP calls is deferred to S4, tracked alongside `flow.mjs`'s equivalent note.

### Prerequisite

A bastion host (or SSM/`kubectl exec` session, whatever staging's `infra/DEPLOY-RUNBOOK.md` sets up)
that can reach the staging Aurora endpoint, and the **owner/migration** Postgres credentials (never
`kv_app`/`kv_wallet`/`kv_relay` — those are `NOLOGIN` in the real environment by design, per
`db/prod/bootstrap-roles.sql`; only the owner role can insert across these tables).

```bash
# from the bastion, or via kubectl exec into a pod that has psql + network access to Aurora:
psql "$STAGING_OWNER_DATABASE_URL"
```

### The SQL (adapt phone number + names, keep the rest)

Uses fixed placeholder UUIDs so re-running is idempotent (`ON CONFLICT DO NOTHING`/`DO UPDATE`) —
swap `<...>` for real values. `<CROPS_CATEGORY_ID>` is the same fixed catalogue id
`scripts/pilot-e2e/flow.mjs` uses (`44444444-0000-7000-8000-000000000001`,
`db/seeds/catalogue/0101_category_tree.sql`) — confirm it's present in staging's catalogue seed before
running (it should be, per prerequisite 1 in `README.md`).

```sql
-- ── 1. the pilot tenant ──────────────────────────────────────────────────────────────────────
-- Use the tenant-self-serve integration test's own provisioning helper as the template (it inserts
-- the SAME columns tenant-ops' approve/suspend later expect to exist).
INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
  VALUES ('tenant_type','Tenant Type', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name)
  VALUES ('tenant_type', NULL, 'fpo', 'FPO')
  ON CONFLICT (type_code, tenant_id, code) DO UPDATE SET default_name = EXCLUDED.default_name;
INSERT INTO countries (code, default_name) VALUES ('IN','India') ON CONFLICT (code) DO NOTHING;

INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
  SELECT '11111111-0000-7000-8000-000000000001', 'kv-staging-smoke', 'Krishalaya Staging Smoke Pilot',
         'Staging Smoke Pilot', lv.id, 'IN', 'active'
  FROM lookup_values lv WHERE lv.type_code = 'tenant_type' AND lv.code = 'fpo'
  ON CONFLICT (id) DO NOTHING;
-- (status inserted directly as 'active' — this is a TEST tenant created by an operator with DB
-- access, not a real self-serve applicant, so there is nothing for admin-api's tenant-ops
-- `approve` step to do. If you'd rather exercise that path too: insert status='pending_review'
-- here instead, then do the approve call in Part A's "optional: exercise tenant-ops approve" note.)

-- ── 2. the founder's one real phone, one user row ────────────────────────────────────────────
INSERT INTO users (id, phone, full_name, language_code, country_code, status, is_test)
  VALUES ('22222222-0000-7000-8000-000000000001', '<FOUNDER_PHONE_E164>', 'Founder Smoke Test',
          'en', 'IN', 'active', true)
  ON CONFLICT (id) DO NOTHING;

-- ── 3. three roles on the SAME user, SAME tenant — farmer (sell), customer (buy), tenant_admin (refund) ──
-- RoleCacheService.effectiveAccess (apps/api/src/core/rbac/role-cache.service.ts) UNIONS permissions
-- across every active user_tenant_roles row for (user, tenant) — one login therefore carries
-- listing.create + order.create + wallet.adjust all at once. This is a staging-smoke-only shortcut
-- (never provision a real user this way) so ONE real phone number can drive the whole flow.
INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
  SELECT gen_random_uuid(), '22222222-0000-7000-8000-000000000001',
         '11111111-0000-7000-8000-000000000001', r.id, 'verified', true
  FROM roles r WHERE r.code IN ('farmer','customer','tenant_admin')
  ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING;

-- ── 4. a product row for the listing check (fixed CROPS category from the catalogue seed) ───────
INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
  VALUES ('33333333-0000-7000-8000-000000000001', '44444444-0000-7000-8000-000000000001',
          'Staging Smoke Wheat Lot', 'kg', '11111111-0000-7000-8000-000000000001', true,
          to_tsvector('simple','Staging Smoke Wheat Lot'))
  ON CONFLICT (id) DO NOTHING;

-- ── 5. sanity read-back ──────────────────────────────────────────────────────────────────────
SELECT u.phone, r.code AS role, utr.is_active
  FROM user_tenant_roles utr
  JOIN users u ON u.id = utr.user_id
  JOIN roles r ON r.id = utr.role_id
 WHERE utr.tenant_id = '11111111-0000-7000-8000-000000000001'
 ORDER BY r.code;
-- expect exactly 3 rows: customer / farmer / tenant_admin, all is_active=true
```

Set the env vars `smoke.mjs` needs from what you just inserted:

```bash
export TENANT_ID="11111111-0000-7000-8000-000000000001"
export FOUNDER_PHONE="<FOUNDER_PHONE_E164>"          # same value as the SQL above
```

### Cleanup / re-provisioning

The tenant/user/product ids above are fixed placeholders — re-running the whole block is a no-op if
nothing changed (`ON CONFLICT DO NOTHING`). To fully tear down between test cycles:

```sql
DELETE FROM user_tenant_roles WHERE tenant_id = '11111111-0000-7000-8000-000000000001';
DELETE FROM products WHERE tenant_id = '11111111-0000-7000-8000-000000000001';
DELETE FROM users WHERE id = '22222222-0000-7000-8000-000000000001';
DELETE FROM tenants WHERE id = '11111111-0000-7000-8000-000000000001';
```
(Money already moved through the ledger for a prior run is **not** deleted by this — the ledger is
append-only by design; a full re-provision starts a fresh tenant/user but old `payments`/`ledger_entries`
rows from earlier smoke runs remain, which is correct and expected.)

---

## Part A — feature flags via admin-api (endpoint verified)

`apps/admin-api/src/modules/flags-ops/flags-ops.controller.ts` is a real, working admin-api surface:

- `POST /v1/flags` (`FlagsManage` owner permission) — **create** a new flag (default OFF). Only needed
  if a flag key doesn't exist yet; `online_payments`/`communication`/`kyc` are already seeded by
  `db/seeds/core/0009_feature_flags.sql` (OFF by default), so normally you'll use the PATCH below
  instead.
- `PATCH /v1/flags/:key` with `{"action":"enable","reason":"..."}` (`FlagsManage`) — flips an existing
  flag on. `{"action":"set_targeting","tenantIds":["<TENANT_ID>"],"reason":"..."}` scopes it to just
  the pilot tenant instead of every tenant on the platform, if you'd rather not flip it globally.

Enable exactly the three flags this suite's checks depend on: `online_payments` (checks 5/8),
`communication` (check 7), `kyc` (check 9, only if you're running it).

```bash
export ADMIN_API_URL="https://staging-admin-api.krishiverse.ai"
export ADMIN_API_TOKEN="<your admin-api bearer token>"

for KEY in online_payments communication kyc; do
  curl -sS -X PATCH "$ADMIN_API_URL/v1/flags/$KEY" \
    -H "authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
    -d "{\"action\":\"enable\",\"reason\":\"staging-smoke provisioning (Sprint S2)\"}"
done
```

### The FIDO2 / step-up catch (read before you assume the curl above "just works")

Every mutation in `flags-ops.controller.ts` (`create`, and every `PATCH` action) carries
`@UseGuards(HardwareKeyGuard, StepUpReauthGuard)` on top of the owner-permission check:

- `HardwareKeyGuard` (`apps/admin-api/src/core/auth/hardware-key.guard.ts`) requires the admin token's
  `amr` claim to include `'hwk'` (a FIDO2 hardware-key ceremony happened at admin login) — **but only
  when `ADMIN_REQUIRE_HARDWARE_KEY` is on**, and that env var defaults to `true` only when
  `NODE_ENV === 'production'` (`apps/admin-api/src/core/config/admin-config.ts`). Staging's `NODE_ENV`
  is `staging`, not `production` — so whether this guard actually blocks you depends entirely on
  whether staging's admin-api deployment explicitly set `ADMIN_REQUIRE_HARDWARE_KEY=true` anyway (a
  reasonable choice for a prod-like staging security posture, but not forced by the code's default).
- `StepUpReauthGuard` requires the token's `auth_time` to be within `ADMIN_STEP_UP_MAX_AGE_SEC`
  (default 900s / 15 min) of "now" — i.e. a **recent** strong re-auth, regardless of the hardware-key
  setting.
- **Neither of these gates `GET /v1/recon/overview`** (the read `smoke.mjs` checks 6/8 use) — only the
  `recon-monitor` *mutation* routes (`open/update investigation`, `freeze`) carry them. A plain
  admin-api bearer token with `platform_recon_viewer` (or better) is sufficient for what `smoke.mjs`
  itself calls.

**Practical guidance:**
- If the curl commands above 403 with "hardware-key (FIDO2) re-auth required" or "step-up
  re-authentication required", flip the three flags **through the admin console UI instead** (whatever
  front-end consumes this admin-api and drives its own WebAuthn login/step-up ceremony — not part of
  this repo's scope to build here). That UI mints a token with the right `amr`/`auth_time` claims for
  you; the curl-only path above is a convenience for environments where hardware-key enforcement is
  off.
- Either way, this is a **one-time-per-staging-environment** step — do it once, then leave the flags
  on for every future `smoke.mjs` run.
- Note this repo's own `admin-jwt.strategy.ts` only *verifies* admin tokens; the actual admin
  login/WebAuthn ceremony that mints one lives outside `apps/admin-api` (an external admin console /
  IdP) — obtaining `ADMIN_API_TOKEN` in the first place is that org-specific process, not something
  this suite can bootstrap.

### Verify the flags actually took

```bash
curl -sS "$ADMIN_API_URL/v1/flags?prefix=online_payments" -H "authorization: Bearer $ADMIN_API_TOKEN"
curl -sS "$ADMIN_API_URL/v1/flags/communication" -H "authorization: Bearer $ADMIN_API_TOKEN"
curl -sS "$ADMIN_API_URL/v1/flags/kyc" -H "authorization: Bearer $ADMIN_API_TOKEN"
# each should show "isEnabled": true (and rolloutPct 100, or your tenant id under targeting rules)
```

---

## Recap: what you should have when this file is done

- A tenant row (`TENANT_ID`) in staging Postgres, status `active`.
- One user row (the founder's real phone) with **three** active `user_tenant_roles`:
  `farmer`, `customer`, `tenant_admin`.
- One `products` row under the `crops` category for the listing check to attach to.
- `online_payments`, `communication`, and (optionally) `kyc` flags enabled — globally or targeted at
  `TENANT_ID`.
- `TENANT_ID` and `FOUNDER_PHONE` exported for `smoke.mjs`.

Now go run `smoke.mjs` per `README.md`.
