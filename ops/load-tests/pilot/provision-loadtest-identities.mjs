#!/usr/bin/env node
// ops/load-tests/pilot/provision-loadtest-identities.mjs (Sprint S5)
//
// ONE-TIME (per staging environment, or per re-provisioning) helper that mints a small pool of
// bearer tokens for ops/load-tests/pilot/run-pilot-gate.sh — so the k6 gate itself never has to do
// live OTP logins (which would either hammer the /v1/auth/otp rate limit — 5/60s/IP,
// apps/api/src/modules/identity/controllers/v1/auth.controller.ts:25 — or send real SMS to real
// phone numbers, which must NEVER happen to actual pilot farmers).
//
// What this does, over real HTTP only (no direct DB access — mirrors scripts/staging-smoke/smoke.mjs,
// not scripts/pilot-e2e/flow.mjs's DB-fixture path):
//   1. For each phone in LOAD_TEST_PHONES (comma-separated, dedicated STAGING-ONLY test numbers —
//      never a real farmer's number): POST /v1/auth/otp -> read `devCode` from the response ->
//      POST /v1/auth/verify -> capture {accessToken, refreshToken, userId}.
//        - `devCode` is only present when the staging deployment has `AUTH_EXPOSE_OTP=true`
//          (apps/api/src/core/config/app-config.ts:187) — this is explicitly NOT possible in prod
//          (`assertProductionSecurity` fails boot on it there) but is allowed in staging. Flip it on
//          staging ONLY for the duration of this provisioning step, then flip it back off — it is a
//          standing "read the OTP back" affordance and should not be left on.
//      Each user must already exist with `farmer`/`customer` roles on TENANT_ID — either via
//      scripts/staging-smoke/provision.md's SQL block (adapted: insert N users, not one), or via
//      `POST /v1/onboarding/roles` (self-serve, `selfserve_onboarding` flag, default ON) called right
//      after verify — this script does the latter automatically (idempotent, harmless if already granted).
//   2. Rate-limit-safe pacing: sleeps between OTP requests so N phones never exceed 5 requests/60s
//      to a single IP (the load generator's own egress IP, since these all originate from one box).
//   3. Designates the FIRST identity as the "seed farmer" and creates + publishes ONE listing with a
//      large `quantityTotal` (default 100000) via `POST /v1/listings` + `POST /v1/listings/:id/publish`
//      so the pilot gate's checkout stage never runs the listing out of stock mid-run — unless
//      LISTING_ID is already supplied, in which case it's reused as-is (idempotent re-runs).
//   4. Writes tokens.json + prints ready-to-export env lines for profile.env.
//
// Usage:
//   STAGING_API_URL=https://api.staging.krishalaya.com \
//   TENANT_ID=11111111-0000-7000-8000-000000000001 \
//   LOAD_TEST_PHONES=+919800000001,+919800000002,+919800000003 \
//   node ops/load-tests/pilot/provision-loadtest-identities.mjs
//
// Prerequisites (see ops/load-tests/pilot/README.md "Setup — one time per staging environment"):
//   - The tenant + a `crops`-category product row already exist (scripts/staging-smoke/provision.md,
//     Part B, steps 1+4 — reuse the SAME tenant id here).
//   - Each phone in LOAD_TEST_PHONES is a dedicated test number with NO real farmer behind it, and is
//     either pre-inserted as a `users` row (any status) or will self-register on first OTP verify
//     (verify creates the user if the phone is new — see AuthService.verifyOtp).
//   - `AUTH_EXPOSE_OTP=true` is temporarily set on the staging api deployment.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.STAGING_API_URL || process.env.PILOT_API_BASE || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID;
const PHONES = (process.env.LOAD_TEST_PHONES || '').split(',').map((s) => s.trim()).filter(Boolean);
const OTP_PACE_MS = Number(process.env.OTP_PACE_MS || 13000); // ~4.6/min, safely under the 5/60s/IP OTP limit
const PRODUCT_ID = process.env.CATALOGUE_PRODUCT_ID; // db/seeds/catalogue product row under CROPS_CATEGORY_ID
const CATEGORY_ID = process.env.CATALOGUE_CATEGORY_ID || '44444444-0000-7000-8000-000000000001'; // fixed crops id
const EXISTING_LISTING_ID = process.env.LISTING_ID;
const SEED_QTY = Number(process.env.SEED_LISTING_QTY || 100000);

if (!TENANT_ID) {
  console.error('Set TENANT_ID (see scripts/staging-smoke/provision.md Part B for how the pilot tenant is created).');
  process.exit(1);
}
if (!PHONES.length) {
  console.error('Set LOAD_TEST_PHONES to a comma-separated list of dedicated STAGING-ONLY test numbers.');
  console.error('NEVER use a real pilot farmer\'s phone number here.');
  process.exit(1);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function api(method, urlPath, { body, expect = [200, 201] } = {}, headers = {}) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  const okList = Array.isArray(expect) ? expect : [expect];
  if (!okList.includes(res.status)) {
    throw new Error(`${method} ${urlPath} -> HTTP ${res.status} (expected ${okList.join('/')}): ${text.slice(0, 400)}`);
  }
  return { status: res.status, body: json };
}

async function loginOne(phone) {
  const otp = await api('POST', '/v1/auth/otp', { body: { phone, channel: 'sms' }, expect: 200 });
  const devCode = otp.body?.data?.devCode;
  if (!devCode) {
    throw new Error(
      `No devCode in /v1/auth/otp response for ${phone} — staging must have AUTH_EXPOSE_OTP=true ` +
      `for this provisioning step (see file header). Refusing to proceed with a real SMS-based flow ` +
      `for what should be a scripted test identity.`,
    );
  }
  const verify = await api('POST', '/v1/auth/verify', {
    body: { phone, code: devCode, tenantId: TENANT_ID, fullName: 'Pilot Load-Test User' },
    expect: 200,
  });
  const { accessToken, refreshToken, user } = verify.body?.data || {};
  if (!accessToken || !user?.id) throw new Error(`verify did not return accessToken/user for ${phone}`);
  return { phone, userId: user.id, accessToken, refreshToken };
}

async function ensureRoles(identity) {
  const auth = { authorization: `Bearer ${identity.accessToken}`, 'x-tenant-id': TENANT_ID };
  for (const role of ['customer', 'farmer']) {
    try {
      await api('POST', '/v1/onboarding/roles', { body: { role }, expect: [200, 201, 403, 409] },
        { ...auth, 'idempotency-key': crypto.randomUUID() });
      // 403 = role not self-grantable or flag off (already logged, non-fatal here); 409 = already granted.
    } catch (err) {
      console.warn(`  (warn) onboarding/roles '${role}' for ${identity.phone}: ${err.message}`);
    }
  }
}

async function seedListing(farmer) {
  if (EXISTING_LISTING_ID) return EXISTING_LISTING_ID;
  if (!PRODUCT_ID) {
    console.warn('  (warn) CATALOGUE_PRODUCT_ID not set and no LISTING_ID given — skipping listing seed.');
    console.warn('  The pilot gate\'s checkout stage will be skipped (LISTING_ID empty) until one is provided.');
    return '';
  }
  const auth = { authorization: `Bearer ${farmer.accessToken}`, 'x-tenant-id': TENANT_ID };
  const create = await api('POST', '/v1/listings', {
    body: {
      productId: PRODUCT_ID,
      categoryId: CATEGORY_ID,
      title: 'Pilot Load-Test Wheat Lot',
      description: 'Seeded by ops/load-tests/pilot/provision-loadtest-identities.mjs — high stock, load-test only.',
      quantityTotal: SEED_QTY,
      minOrderQty: 1,
      unitCode: 'kg',
      priceMinor: '5000',
      currencyCode: 'INR',
      saleType: 'direct',
      visibility: 'public',
    },
    expect: [200, 201],
  }, { ...auth, 'idempotency-key': crypto.randomUUID() });
  const listingId = create.body?.data?.id;
  if (!listingId) throw new Error('listing create did not return an id');
  await api('POST', `/v1/listings/${listingId}/publish`, { expect: 200 }, auth);
  return listingId;
}

async function main() {
  console.log(`=== Pilot load-test identity provisioning ===`);
  console.log(`API: ${API_BASE}  Tenant: ${TENANT_ID}  Phones: ${PHONES.length}`);

  const identities = [];
  for (const [i, phone] of PHONES.entries()) {
    process.stdout.write(`[${i + 1}/${PHONES.length}] logging in ${phone} ... `);
    const identity = await loginOne(phone);
    console.log(`ok (userId=${identity.userId})`);
    await ensureRoles(identity);
    identities.push(identity);
    if (i < PHONES.length - 1) await sleep(OTP_PACE_MS); // stay under the OTP rate limit
  }

  console.log('Seeding a high-stock listing from the first identity (the "seed farmer") ...');
  const listingId = await seedListing(identities[0]);
  if (listingId) console.log(`  listingId=${listingId}`);

  const tokensLine = identities.map((t) => `${t.accessToken}:${t.refreshToken}:${t.userId}`).join(',');
  const outFile = path.join(__dirname, 'tokens.json');
  fs.writeFileSync(outFile, JSON.stringify({ tenantId: TENANT_ID, listingId, identities }, null, 2));

  console.log(`\nWrote ${outFile}`);
  console.log('\nAdd these lines to your pilot profile.env (see profile.env.example):\n');
  console.log(`TENANT_ID=${TENANT_ID}`);
  console.log(`LISTING_ID=${listingId}`);
  console.log(`TOKENS=${tokensLine}`);
  console.log(
    '\nReminder: turn AUTH_EXPOSE_OTP back off on staging now that provisioning is done, unless you ' +
    'expect to re-run this script again soon.',
  );
}

main().catch((err) => {
  console.error(`\nProvisioning FAILED: ${err.message}`);
  process.exit(1);
});
