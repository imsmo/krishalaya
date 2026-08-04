#!/usr/bin/env node
// scripts/pilot-e2e/flow.mjs
// The Krishalaya pilot slice, proven over real HTTP against a locally-running api:
//   OTP login (farmer + buyer) -> onboard -> create + publish listing -> buyer orders (direct
//   sale) -> wallet credit/escrow -> payout (stub provider) -> notification recorded.
//
// Every endpoint below was verified against the actual controller/DTO source (not guessed) — see
// scripts/pilot-e2e/README.md for the file:line references. No new npm dependencies: uses Node's
// built-in fetch + the `pg` package (already a dependency of the repo root / @krishalaya/api).
//
// Onboarding note: there is no self-serve "become a farmer / become a buyer" HTTP endpoint in this
// codebase yet (checked: no POST /v1/farmers, /v1/buyers, /v1/onboarding/*; role assignment is an
// admin-only POST /v1/rbac/assignments gated by identity.approve). The repo's OWN integration tests
// solve this by inserting tenant/user/role rows directly via a privileged pg pool (see
// apps/api/test/helpers/fixtures.ts). Step 0 below does the same — it is the "onboard farmer +
// buyer" step, just done at the DB layer because that is the only mechanism that exists today.
// Every step AFTER that is a real HTTP call exercising OTP login, listings, orders, payments and
// notifications exactly as a client would.
//
// KV-BL-066 (Sprint S3) update: the role-grant HALF of Step 0 (INSERT INTO user_tenant_roles for
// farmer/customer) is no longer the only mechanism — POST /v1/onboarding/roles (authenticated,
// non-admin, gated by the `selfserve_onboarding` flag; see apps/api/src/modules/identity/
// controllers/v1/onboarding.controller.ts + services/onboarding.service.ts) now lets an
// already-OTP-logged-in user self-grant farmer or customer without an admin. The TENANT + first-user
// bootstrap (rows above this comment: tenants/users) is still SQL — creating a tenant is genuinely
// god-mode and out of scope for this endpoint. Rewiring this script to call the new endpoint instead
// of direct SQL is deliberately deferred to S4 (kept as direct SQL here so this proven E2E script
// doesn't change behaviour mid-sprint).
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const API_BASE = process.env.PILOT_API_BASE || 'http://localhost:3000';
const ADMIN_DATABASE_URL = process.env.DATABASE_ADMIN_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  console.error('Set DATABASE_ADMIN_URL (or MIGRATION_DATABASE_URL / DATABASE_URL) before running flow.mjs.');
  process.exit(1);
}

// db/seeds/catalogue/0101_category_tree.sql — fixed id for the top-level "crops" category, present
// after `pnpm seed` (core + rules + catalogue; no --demo needed).
const CROPS_CATEGORY_ID = '44444444-0000-7000-8000-000000000001';

// ---------------------------------------------------------------------------------------------
// tiny step runner
// ---------------------------------------------------------------------------------------------
const results = [];
let stepNo = 0;

async function step(name, fn) {
  stepNo += 1;
  process.stdout.write(`\n[${String(stepNo).padStart(2, '0')}] ${name}\n`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ n: stepNo, name, ok: true, ms });
    process.stdout.write(`     PASS (${ms}ms)${detail ? '  ' + detail : ''}\n`);
    return detail;
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ n: stepNo, name, ok: false, ms, error: err.message });
    process.stdout.write(`     FAIL (${ms}ms)\n`);
    process.stderr.write(`     ${err.stack || err.message}\n`);
    throw err;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function api(method, urlPath, { token, tenantId, idemKey, body, expect = [200, 201] } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (idemKey) headers['idempotency-key'] = idemKey;
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  const okList = Array.isArray(expect) ? expect : [expect];
  if (!okList.includes(res.status)) {
    throw new Error(`${method} ${urlPath} -> HTTP ${res.status} (expected ${okList.join('/')}): ${text.slice(0, 500)}`);
  }
  return { status: res.status, body: json };
}

function relayTick() {
  const r = spawnSync('node', [path.join(__dirname, 'relay-tick.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout.replace(/^/gm, '     '));
  if (r.stderr) process.stderr.write(r.stderr.replace(/^/gm, '     '));
  if (r.status !== 0) throw new Error(`relay tick exited with code ${r.status}`);
  const lastLine = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}';
  try { return JSON.parse(lastLine); } catch { return {}; }
}

function randPhone() {
  const n = Math.floor(10000000 + Math.random() * 89999999);
  return `+9198${n}`;
}

const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------------------------
// the flow
// ---------------------------------------------------------------------------------------------
async function main() {
  console.log('=== Krishalaya pilot E2E ===');
  console.log(`API base: ${API_BASE}`);

  const tenantId = uuid();
  const farmerUserId = uuid();
  const buyerUserId = uuid();
  const productId = uuid();
  const bankAccountId = uuid();
  const farmerPhone = randPhone();
  const buyerPhone = randPhone();

  const admin = new Pool({ connectionString: ADMIN_DATABASE_URL });

  let farmerToken, buyerToken, listingId, orderId, totalMinor, paymentId, gatewayOrderId, payoutId;

  try {
    await step(
      'Onboard farmer + buyer (tenant + users + tenant-roles + a farmer bank account + feature flags — direct SQL; see header comment)',
      async () => {
        // [DEV-32 2026-07-29 FIX] `tenants` has no `name` column (confirmed against the applied
        // migrations by direct SQL error: "column \"name\" of relation \"tenants\" does not exist")
        // — this INSERT would have failed the moment it actually ran against a real, fully-migrated
        // DB. Corrected to the real columns (slug/legal_name/display_name/tenant_type_id/
        // country_code/status), matching the SAME pattern scripts/staging-smoke/provision.md already
        // documents and DEV-30 proved live. Pure fix-forward on an unapplied/non-migration script —
        // no migration touched, Law 5 n/a.
        await admin.query(`INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('tenant_type','Tenant Type', false) ON CONFLICT (code) DO NOTHING`);
        await admin.query(
          `INSERT INTO lookup_values (type_code, tenant_id, code, default_name) VALUES ('tenant_type', NULL, 'fpo', 'FPO')
           ON CONFLICT (type_code, tenant_id, code) DO UPDATE SET default_name = EXCLUDED.default_name`,
        );
        await admin.query(`INSERT INTO countries (code, default_name) VALUES ('IN','India') ON CONFLICT (code) DO NOTHING`);
        await admin.query(
          `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
           SELECT $1, $2, 'Pilot E2E Tenant', 'Pilot E2E Tenant', lv.id, 'IN', 'active'
           FROM lookup_values lv WHERE lv.type_code='tenant_type' AND lv.code='fpo'
           ON CONFLICT (id) DO NOTHING`,
          [tenantId, `pilot-e2e-${tenantId.slice(0, 8)}`],
        );
        await admin.query(
          `INSERT INTO users (id, phone, full_name, language_code, country_code, status, is_test)
           VALUES ($1,$2,'Pilot Farmer','en','IN','active',true) ON CONFLICT (id) DO NOTHING`,
          [farmerUserId, farmerPhone],
        );
        await admin.query(
          `INSERT INTO users (id, phone, full_name, language_code, country_code, status, is_test)
           VALUES ($1,$2,'Pilot Buyer','en','IN','active',true) ON CONFLICT (id) DO NOTHING`,
          [buyerUserId, buyerPhone],
        );
        await admin.query(
          `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
           SELECT $1,$2,$3,r.id,'verified',true FROM roles r WHERE r.code='farmer'
           ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`,
          [uuid(), farmerUserId, tenantId],
        );
        await admin.query(
          `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
           SELECT $1,$2,$3,r.id,'verified',true FROM roles r WHERE r.code='customer'
           ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`,
          [uuid(), buyerUserId, tenantId],
        );
        await admin.query(
          `INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
           VALUES ($1,$2,'Pilot Wheat Lot','kg',$3,true,to_tsvector('simple','Pilot Wheat Lot'))
           ON CONFLICT (id) DO NOTHING`,
          [productId, CROPS_CATEGORY_ID, tenantId],
        );
        await admin.query(
          `INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, vault_ref)
           VALUES ($1,$2,$3,'upi','vault_pilot_farmer') ON CONFLICT (id) DO NOTHING`,
          [bankAccountId, farmerUserId, tenantId],
        );
        // online_payments + communication default OFF (db/seeds/core/0009_feature_flags.sql) — this
        // pilot slice needs both. Mirrors apps/api/test/e2e/bootstrap.ts's enableFlag() helper.
        for (const key of ['online_payments', 'communication']) {
          await admin.query(
            `INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
             VALUES ($1,'enabled for scripts/pilot-e2e',true,100,'{}'::jsonb)
             ON CONFLICT (key) DO UPDATE SET is_enabled=true, rollout_pct=100`,
            [key],
          );
        }
        return `tenant=${tenantId}`;
      },
    );

    await step('Health check — GET /v1/healthz', async () => {
      const r = await api('GET', '/v1/healthz', { expect: 200 });
      assert(r.body?.data?.status === 'ok', `status ok, got ${r.body?.data?.status}`);
    });

    await step('Readiness — GET /v1/readyz (poll up to 30s for the DB pool)', async () => {
      let last;
      for (let i = 0; i < 30; i++) {
        const r = await api('GET', '/v1/readyz', { expect: [200] });
        last = r;
        if (r.body?.data?.status === 'ready') return 'db up';
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error(`api never became ready: ${JSON.stringify(last?.body)}`);
    });

    await step('OTP login — farmer (POST /v1/auth/otp -> POST /v1/auth/verify, dev-mode devCode)', async () => {
      // [DEV-32 2026-07-29 FIX] `AuthController.requestOtp`/`.verify` have no `@HttpCode` override, so
      // NestJS's default POST status (201 Created) applies — confirmed against a live boot, not just
      // the source. A hardcoded `expect: 200` here would fail every real execution; dropped to the
      // api() helper's own default ([200, 201]).
      const otp = await api('POST', '/v1/auth/otp', { body: { phone: farmerPhone, channel: 'sms' } });
      const devCode = otp.body?.data?.devCode;
      assert(devCode, 'devCode present in the /v1/auth/otp response (requires AUTH_EXPOSE_OTP=true)');
      const verify = await api('POST', '/v1/auth/verify', {
        body: { phone: farmerPhone, code: devCode, tenantId, fullName: 'Pilot Farmer' },
      });
      farmerToken = verify.body?.data?.accessToken;
      assert(farmerToken, 'farmer accessToken returned');
      return `userId=${verify.body?.data?.user?.id}`;
    });

    await step('OTP login — buyer', async () => {
      const otp = await api('POST', '/v1/auth/otp', { body: { phone: buyerPhone, channel: 'sms' } });
      const devCode = otp.body?.data?.devCode;
      assert(devCode, 'devCode present');
      const verify = await api('POST', '/v1/auth/verify', {
        body: { phone: buyerPhone, code: devCode, tenantId, fullName: 'Pilot Buyer' },
      });
      buyerToken = verify.body?.data?.accessToken;
      assert(buyerToken, 'buyer accessToken returned');
      return `userId=${verify.body?.data?.user?.id}`;
    });

    await step('Farmer creates a listing — POST /v1/listings', async () => {
      const r = await api('POST', '/v1/listings', {
        token: farmerToken,
        tenantId,
        idemKey: uuid(),
        body: {
          productId,
          categoryId: CROPS_CATEGORY_ID,
          title: 'Pilot E2E Wheat Lot',
          description: 'Seeded by scripts/pilot-e2e for the local pilot proof.',
          quantityTotal: 50,
          minOrderQty: 1,
          unitCode: 'kg',
          priceMinor: '5000',
          currencyCode: 'INR',
          saleType: 'direct',
          visibility: 'public',
        },
        expect: [200, 201],
      });
      listingId = r.body?.data?.id;
      assert(listingId, 'listing id returned');
      return `listingId=${listingId}`;
    });

    await step('Farmer publishes the listing — POST /v1/listings/:id/publish', async () => {
      await api('POST', `/v1/listings/${listingId}/publish`, { token: farmerToken, tenantId });
    });

    await step('Verify the listing is published + public — GET /v1/listings/:id', async () => {
      const r = await api('GET', `/v1/listings/${listingId}`, { token: buyerToken, tenantId, expect: 200 });
      assert(r.body?.data?.status === 'published', `status published, got ${r.body?.data?.status}`);
    });

    await step('Buyer adds the listing to their cart — POST /v1/cart/items', async () => {
      await api('POST', '/v1/cart/items', { token: buyerToken, tenantId, body: { listingId, quantity: 2 }, expect: [200, 201] });
    });

    await step('Buyer checks out (direct sale: cart -> order) — POST /v1/checkout', async () => {
      const r = await api('POST', '/v1/checkout', { token: buyerToken, tenantId, idemKey: uuid(), body: {}, expect: [200, 201] });
      const order = r.body?.data?.orders?.[0];
      assert(order?.id, 'order id returned');
      orderId = order.id;
      totalMinor = order.totalMinor;
      assert(order.status === 'payment_pending', `order starts payment_pending (online_payments on), got ${order.status}`);
      assert(order.orderNo, 'orderNo present');
      return `orderId=${orderId} totalMinor=${totalMinor}`;
    });

    await step('Buyer creates a payment intent (sandbox gateway) — POST /v1/payments', async () => {
      const r = await api('POST', '/v1/payments', {
        token: buyerToken,
        tenantId,
        idemKey: uuid(),
        body: { purpose: 'direct_order', amountMinor: totalMinor, currencyCode: 'INR', referenceType: 'order', referenceId: orderId },
        expect: [200, 201],
      });
      paymentId = r.body?.data?.paymentId;
      gatewayOrderId = r.body?.data?.gatewayOrderId;
      assert(paymentId && gatewayOrderId, 'paymentId + gatewayOrderId returned');
      return `paymentId=${paymentId}`;
    });

    await step('Simulate a successful payment webhook (sandbox provider, HMAC-signed) — POST /v1/payments/webhooks/sandbox', async () => {
      const secret = process.env.SANDBOX_WEBHOOK_SECRET || process.env.RAZORPAYX_WEBHOOK_SECRET || 'sandbox-secret';
      const payload = JSON.stringify({
        id: `evt_${uuid()}`,
        event: 'payment.captured',
        tenant_id: tenantId,
        order_id: gatewayOrderId,
        payment_id: `pay_${uuid()}`,
        amount: Number(totalMinor),
        method: 'upi',
      });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const res = await fetch(`${API_BASE}/v1/payments/webhooks/sandbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
        body: payload,
      });
      assert(res.status === 200, `webhook accepted with HTTP 200, got ${res.status}`);
    });

    await step(
      '⚠️  RELAY TICK #1 (manual — see README "Why a manual relay tick"): payments.payment_succeeded -> order confirmed + escrow credited',
      async () => {
        const r = relayTick();
        assert(r.ok !== false, 'relay tick reported ok');
        return `processed=${r.processed ?? '?'}`;
      },
    );

    await step('Verify the order is now confirmed — GET /v1/orders/:id', async () => {
      const r = await api('GET', `/v1/orders/${orderId}`, { token: farmerToken, tenantId, expect: 200 });
      assert(r.body?.data?.status === 'confirmed', `status confirmed, got ${r.body?.data?.status}`);
    });

    await step('Farmer (seller) walks the order: packed -> ready -> delivered', async () => {
      await api('POST', `/v1/orders/${orderId}/packed`, { token: farmerToken, tenantId });
      await api('POST', `/v1/orders/${orderId}/ready`, { token: farmerToken, tenantId });
      await api('POST', `/v1/orders/${orderId}/delivered`, { token: farmerToken, tenantId });
    });

    await step('Buyer confirms receipt — POST /v1/orders/:id/complete (emits orders.order_completed)', async () => {
      await api('POST', `/v1/orders/${orderId}/complete`, { token: buyerToken, tenantId });
    });

    await step(
      '⚠️  RELAY TICK #2 (manual): orders.order_completed -> escrow released to seller wallet + notification fan-out',
      async () => {
        const r = relayTick();
        assert(r.ok !== false, 'relay tick reported ok');
        return `processed=${r.processed ?? '?'}`;
      },
    );

    await step('Farmer requests a payout from the released wallet balance (stub payout provider) — POST /v1/payouts', async () => {
      const r = await api('POST', '/v1/payouts', {
        token: farmerToken,
        tenantId,
        idemKey: uuid(),
        body: { amountMinor: totalMinor, bankAccountId, purpose: 'settlement', currencyCode: 'INR' },
        expect: [200, 201],
      });
      payoutId = r.body?.data?.payoutId;
      assert(r.body?.data?.status === 'queued', `payout queued, got ${r.body?.data?.status}`);
      return `payoutId=${payoutId}`;
    });

    await step('Verify a notification was recorded (order.completed fan-out) — GET /v1/notifications', async () => {
      const r = await api('GET', '/v1/notifications', { token: farmerToken, tenantId, expect: 200 });
      const items = r.body?.data || [];
      assert(items.length > 0, 'at least one notification row exists for the seller');
      return `count=${items.length} (e.g. ${items[0]?.eventCode}/${items[0]?.channel}/${items[0]?.status})`;
    });

    console.log('\n=== ALL STEPS PASSED — pilot loop proven end-to-end ===');
  } finally {
    await admin.end().catch(() => {});
  }
}

function printSummary() {
  console.log('\n--- PASS/FAIL summary ---');
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${String(r.n).padStart(2, '0')}. ${r.name}${r.ok ? '' : `  <- ${r.error}`}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed.`);
}

main()
  .then(() => {
    printSummary();
    process.exit(0);
  })
  .catch((err) => {
    printSummary();
    console.error(`\nPILOT E2E FAILED: ${err.message}`);
    process.exit(1);
  });
