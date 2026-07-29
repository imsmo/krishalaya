#!/usr/bin/env node
// scripts/staging-smoke/smoke.mjs
// Sprint S2 — the STAGING-flavored sibling of scripts/pilot-e2e/flow.mjs. Read
// scripts/staging-smoke/README.md first (what differs from pilot-e2e + what each check proves) and
// scripts/staging-smoke/provision.md (the one-time setup this script assumes already happened).
//
// Runs against a REMOTE staging deployment (STAGING_API_URL) with REAL providers: real SMS/OTP, real
// UPI money (capped at exactly ₹1, never more), a real webhook. No docker, no direct SQL — staging
// Postgres isn't reachable from a laptop. Every human-in-the-loop point (OTP codes, the UPI payment
// itself, optionally the eKYC provider OTP) uses node:readline/promises to prompt a real person; there
// is no AUTH_EXPOSE_OTP/devCode path here (that only exists in dev/test — see
// apps/api/src/core/config/app-config.ts's assertProductionSecurity and
// apps/api/src/modules/identity/services/auth.service.ts's requestOtp).
//
// No new npm dependencies: Node's built-in fetch, node:tls, node:readline/promises, node:crypto only.
import { createInterface } from 'node:readline/promises';
import { connect as tlsConnect } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

// -------------------------------------------------------------------------------------------------
// args / env
// -------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`usage: node scripts/staging-smoke/smoke.mjs [--skip-money] [--skip-ekyc]

  --skip-money   skip checks 5, 6, 7, 8 (₹1 payment, webhook-replay, notification, refund)
  --skip-ekyc    skip check 9 (eKYC session start) — this is also the default unless
                 EKYC_TEST_ID_NUMBER is set

env (required): STAGING_API_URL, TENANT_ID, FOUNDER_PHONE
env (optional): ADMIN_API_URL, ADMIN_API_TOKEN, EKYC_TEST_ID_NUMBER, EKYC_TEST_DOC_TYPE,
                PAYMENT_POLL_TIMEOUT_MS, PAYMENT_POLL_INTERVAL_MS

See scripts/staging-smoke/README.md for full docs.`);
  process.exit(0);
}
const SKIP_MONEY = argv.includes('--skip-money');
const SKIP_EKYC_FLAG = argv.includes('--skip-ekyc');

const API_BASE = (process.env.STAGING_API_URL || '').replace(/\/+$/, '');
const TENANT_ID = process.env.TENANT_ID || '';
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';
const ADMIN_API_BASE = (process.env.ADMIN_API_URL || '').replace(/\/+$/, '');
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
const EKYC_ID_NUMBER = process.env.EKYC_TEST_ID_NUMBER || '';
const EKYC_DOC_TYPE = process.env.EKYC_TEST_DOC_TYPE || 'aadhaar';
const PAYMENT_POLL_TIMEOUT_MS = Number(process.env.PAYMENT_POLL_TIMEOUT_MS || 10 * 60 * 1000); // 10 min
const PAYMENT_POLL_INTERVAL_MS = Number(process.env.PAYMENT_POLL_INTERVAL_MS || 5000);

const ONE_RUPEE_MINOR = 100n; // exactly ₹1. Never change this to "test with a bigger amount".

for (const [name, val] of [['STAGING_API_URL', API_BASE], ['TENANT_ID', TENANT_ID], ['FOUNDER_PHONE', FOUNDER_PHONE]]) {
  if (!val) {
    console.error(`Missing required env var ${name}. See scripts/staging-smoke/README.md "Usage".`);
    process.exit(1);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(question) { return (await rl.question(question)).trim(); }

// -------------------------------------------------------------------------------------------------
// tiny step runner (same shape as scripts/pilot-e2e/flow.mjs, plus a SKIP outcome)
// -------------------------------------------------------------------------------------------------
const results = [];
let stepNo = 0;

async function step(name, fn) {
  stepNo += 1;
  const n = stepNo;
  process.stdout.write(`\n[${String(n).padStart(2, '0')}] ${name}\n`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ n, name, status: 'PASS', ms });
    process.stdout.write(`     PASS (${ms}ms)${detail ? '  ' + detail : ''}\n`);
    return detail;
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ n, name, status: 'FAIL', ms, error: err.message });
    process.stdout.write(`     FAIL (${ms}ms)\n`);
    process.stderr.write(`     ${err.stack || err.message}\n`);
    throw err;
  }
}

function skipStep(name, reason) {
  stepNo += 1;
  const n = stepNo;
  results.push({ n, name, status: 'SKIP', reason });
  process.stdout.write(`\n[${String(n).padStart(2, '0')}] ${name}\n     SKIP  — ${reason}\n`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// -------------------------------------------------------------------------------------------------
// HTTP helpers
// -------------------------------------------------------------------------------------------------
async function api(method, urlPath, { token, idemKey, body, expect = [200, 201] } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (TENANT_ID) headers['x-tenant-id'] = TENANT_ID; // ignored once a JWT's own tid is present; harmless
  if (idemKey) headers['idempotency-key'] = idemKey;
  const res = await fetch(`${API_BASE}${urlPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  const okList = Array.isArray(expect) ? expect : [expect];
  if (!okList.includes(res.status)) {
    throw new Error(`${method} ${urlPath} -> HTTP ${res.status} (expected ${okList.join('/')}): ${text.slice(0, 500)}`);
  }
  return { status: res.status, body: json };
}

async function adminApi(method, urlPath, { body, expect = [200, 201] } = {}) {
  if (!ADMIN_API_BASE || !ADMIN_API_TOKEN) return null; // caller must handle "not configured"
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_API_TOKEN}` };
  const res = await fetch(`${ADMIN_API_BASE}${urlPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  const okList = Array.isArray(expect) ? expect : [expect];
  if (!okList.includes(res.status)) {
    throw new Error(`[admin-api] ${method} ${urlPath} -> HTTP ${res.status} (expected ${okList.join('/')}): ${text.slice(0, 500)}`);
  }
  return { status: res.status, body: json };
}

async function poll(label, fn, { timeoutMs, intervalMs }) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last && last.done) return last.value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label} (last seen: ${JSON.stringify(last?.value ?? last)})`);
}

function loudConfirm(message, requiredPhrase) {
  return (async () => {
    console.log(`\n${'!'.repeat(78)}\n${message}\n${'!'.repeat(78)}`);
    const typed = await ask(`Type exactly "${requiredPhrase}" to proceed (anything else aborts): `);
    if (typed !== requiredPhrase) throw new Error(`confirmation phrase did not match — aborting before any money moved`);
  })();
}

// -------------------------------------------------------------------------------------------------
// state threaded across checks
// -------------------------------------------------------------------------------------------------
let founderToken, founderUserId;
let listingId, orderId, totalMinor, paymentId, gatewayOrderId;

// ===================================================================================================
// Check 1 — health, readiness, TLS
// ===================================================================================================
async function check1() {
  return step('Health + readiness + TLS — GET /v1/healthz, GET /v1/readyz, tls.connect', async () => {
    const h = await api('GET', '/v1/healthz', { expect: 200 });
    assert(h.body?.data?.status === 'ok', `healthz status ok, got ${h.body?.data?.status}`);

    const r = await api('GET', '/v1/readyz', { expect: [200] });
    assert(r.body?.data?.status === 'ready', `readyz status ready, got ${JSON.stringify(r.body?.data)}`);

    const u = new URL(API_BASE);
    if (u.protocol !== 'https:') return `TLS check skipped (${u.protocol} target, not https)`;
    const port = u.port ? Number(u.port) : 443;
    const cert = await new Promise((resolve, reject) => {
      const socket = tlsConnect({ host: u.hostname, port, servername: u.hostname, timeout: 10000 }, () => {
        const c = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        resolve({ c, authorized });
      });
      socket.on('error', reject);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS connect timed out')); });
    });
    assert(cert.authorized, `TLS chain is authorized (trusted CA) for ${u.hostname}`);
    const notAfter = new Date(cert.c.valid_to);
    const daysLeft = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
    assert(daysLeft > 0, `certificate for ${u.hostname} has not expired (valid_to=${cert.c.valid_to})`);
    if (daysLeft < 14) console.log(`     WARNING: TLS cert for ${u.hostname} expires in ${daysLeft} day(s) — renew soon`);
    return `cert valid_to=${cert.c.valid_to} (${daysLeft}d left), issuer=${cert.c.issuer?.O ?? cert.c.issuer?.CN ?? '?'}`;
  });
}

// ===================================================================================================
// Check 2 — real OTP round-trip -> JWT
// ===================================================================================================
async function check2() {
  return step('Real OTP round-trip (founder\'s phone) — POST /v1/auth/otp -> human types the code -> POST /v1/auth/verify', async () => {
    // [DEV-32 2026-07-29 FIX] `AuthController.requestOtp`/`.verify` carry no `@HttpCode` override, so
    // NestJS's default POST status (201 Created) applies — confirmed live against a real boot during
    // DEV-32's local-full-stack execution (this file itself was never previously run against a real
    // process to catch it). Dropped the hardcoded `expect: 200` in favor of the api() helper's own
    // default ([200, 201]) on both calls below.
    const otp = await api('POST', '/v1/auth/otp', { body: { phone: FOUNDER_PHONE, channel: 'sms' } });
    assert(otp.body?.data?.sent === true, 'otp request accepted (sent:true)');
    if (otp.body?.data?.devCode) {
      console.log('     WARNING: the /v1/auth/otp response included devCode — AUTH_EXPOSE_OTP appears to be on for ' +
        'this environment. That is a real, separate finding (should never be true outside dev/test) but this ' +
        'script still proceeds via the real SMS path so the check proves what it says it proves.');
    }
    console.log(`     An SMS should now be on its way to ${FOUNDER_PHONE}. This can take up to ~60s.`);
    const code = await ask('     Enter the OTP code you received: ');
    const verify = await api('POST', '/v1/auth/verify', {
      body: { phone: FOUNDER_PHONE, code, tenantId: TENANT_ID, fullName: 'Founder Smoke Test' },
    });
    founderToken = verify.body?.data?.accessToken;
    founderUserId = verify.body?.data?.user?.id;
    assert(founderToken, 'accessToken returned');
    assert(founderUserId, 'user id returned');
    return `userId=${founderUserId}`;
  });
}

// ===================================================================================================
// Check 3 — authenticated profile fetch (RLS sanity)
// ===================================================================================================
async function check3() {
  return step('Authenticated profile fetch — GET /v1/users/me (RLS sanity: no :tenantId param exists to ask for another tenant)', async () => {
    const r = await api('GET', '/v1/users/me', { token: founderToken, expect: 200 });
    assert(r.body?.data?.id === founderUserId, `profile id matches the logged-in user (${founderUserId})`);
    assert(r.body?.data?.status === 'active', `profile status active, got ${r.body?.data?.status}`);
    // UserService.getById(tenantId, id) resolves through a tenant-scoped repository lookup
    // (apps/api/src/modules/identity/services/user.service.ts) — a 200 here already proves the
    // caller's JWT tenant (TENANT_ID) actually has this user as a member; there is no way to pass a
    // *different* tenant id in this request at all (no :tenantId path param on this route), so
    // cross-tenant profile reads are structurally impossible here, not merely policy-forbidden.
    return `phone(masked)=${r.body?.data?.phone}`;
  });
}

// ===================================================================================================
// Check 4 — listing create + publish + public fetch
// ===================================================================================================
// db/seeds/catalogue/0101_category_tree.sql — fixed id for the top-level "crops" category (same one
// scripts/pilot-e2e/flow.mjs uses; must be present in staging's catalogue seed).
const CROPS_CATEGORY_ID = '44444444-0000-7000-8000-000000000001';
// Fixed product id inserted by provision.md Part B step 4 — reused here rather than creating a new
// product per run (products aren't part of what this suite is trying to prove).
const PRODUCT_ID = process.env.STAGING_SMOKE_PRODUCT_ID || '33333333-0000-7000-8000-000000000001';

async function check4() {
  return step('Listing create + publish + public fetch — POST /v1/listings, POST /v1/listings/:id/publish, GET /v1/listings/:id (no auth)', async () => {
    const create = await api('POST', '/v1/listings', {
      token: founderToken, idemKey: randomUUID(),
      body: {
        productId: PRODUCT_ID, categoryId: CROPS_CATEGORY_ID,
        title: 'Staging Smoke Wheat Lot', description: 'Created by scripts/staging-smoke for Sprint S2.',
        quantityTotal: 1, minOrderQty: 1, unitCode: 'kg',
        priceMinor: ONE_RUPEE_MINOR.toString(), currencyCode: 'INR', saleType: 'direct', visibility: 'public',
      },
      expect: [200, 201],
    });
    listingId = create.body?.data?.id;
    assert(listingId, 'listing id returned');

    await api('POST', `/v1/listings/${listingId}/publish`, { token: founderToken, expect: 200 });

    // no `token` at all — proves the @Public() storefront path on a real deployment.
    const pub = await api('GET', `/v1/listings/${listingId}`, { expect: 200 });
    assert(pub.body?.data?.status === 'published', `publicly-fetched listing is published, got ${pub.body?.data?.status}`);
    return `listingId=${listingId}, priceMinor=${ONE_RUPEE_MINOR}`;
  });
}

// ===================================================================================================
// Check 5 — the ₹1 LIVE payment round-trip
// ===================================================================================================
async function check5() {
  return step('₹1 LIVE payment — cart -> checkout -> payment intent -> human pays via UPI -> poll captured + order confirmed', async () => {
    await api('POST', '/v1/cart/items', { token: founderToken, body: { listingId, quantity: 1 }, expect: [200, 201] });

    const co = await api('POST', '/v1/checkout', { token: founderToken, idemKey: randomUUID(), body: {}, expect: [200, 201] });
    const order = co.body?.data?.orders?.[0];
    assert(order?.id, 'order id returned');
    orderId = order.id;
    totalMinor = order.totalMinor;
    assert(order.status === 'payment_pending', `order starts payment_pending, got ${order.status}`);
    // HARD SAFETY GUARD — never let this script charge more than ₹1, ever, for any reason.
    assert(BigInt(totalMinor) === ONE_RUPEE_MINOR,
      `order total is exactly ${ONE_RUPEE_MINOR} paise (₹1) — got ${totalMinor}. Refusing to create a payment ` +
      `intent for any other amount. Check the listing price provisioned above (should be priceMinor=100, qty=1).`);

    const intent = await api('POST', '/v1/payments', {
      token: founderToken, idemKey: randomUUID(),
      body: { purpose: 'direct_order', amountMinor: totalMinor, currencyCode: 'INR', referenceType: 'order', referenceId: orderId },
      expect: [200, 201],
    });
    paymentId = intent.body?.data?.paymentId;
    gatewayOrderId = intent.body?.data?.gatewayOrderId;
    assert(paymentId && gatewayOrderId, 'paymentId + gatewayOrderId returned');

    await loudConfirm(
      `About to ask you to pay a REAL ₹1.00 (100 paise, INR) via UPI.\n` +
      `  paymentId      = ${paymentId}\n` +
      `  gatewayOrderId = ${gatewayOrderId}\n` +
      `This is the only amount this script will ever charge. It will be refunded in check 8.`,
      'PAY-1-RUPEE',
    );
    console.log(`     Open your UPI app now and complete the ₹1.00 payment for gateway order ${gatewayOrderId}.`);
    await ask('     Press Enter once you have completed the UPI payment on your phone: ');

    console.log(`     Waiting for the real Razorpay webhook to land and the outbox relay (S1, KV-BL-063 — no manual tick needed here) to confirm the order...`);
    await poll('payment captured', async () => {
      const p = await api('GET', `/v1/payments/${paymentId}`, { token: founderToken, expect: 200 });
      if (p.body?.data?.status === 'failed') throw new Error(`payment failed (gateway reported failure) — did the UPI payment actually complete?`);
      return { done: p.body?.data?.status === 'success', value: p.body?.data?.status };
    }, { timeoutMs: PAYMENT_POLL_TIMEOUT_MS, intervalMs: PAYMENT_POLL_INTERVAL_MS });

    await poll('order confirmed', async () => {
      const o = await api('GET', `/v1/orders/${orderId}`, { token: founderToken, expect: 200 });
      return { done: o.body?.data?.status === 'confirmed', value: o.body?.data?.status };
    }, { timeoutMs: PAYMENT_POLL_TIMEOUT_MS, intervalMs: PAYMENT_POLL_INTERVAL_MS });

    return `paymentId=${paymentId} orderId=${orderId} amountMinor=${totalMinor}`;
  });
}

// ===================================================================================================
// Check 6 — webhook replay no-op (documented dashboard step; ledger-zero-sum bracket if admin-api set)
// ===================================================================================================
async function check6() {
  if (!ADMIN_API_BASE || !ADMIN_API_TOKEN) {
    skipStep(
      'Webhook replay no-op check',
      'ADMIN_API_URL/ADMIN_API_TOKEN not set, and there is no in-repo replay-trigger endpoint (verified: ' +
      'apps/api/src/modules/payments/controllers/v1/payment-webhooks.controller.ts exposes only the same public ' +
      'signature-verified ingest route Razorpay itself calls). Do this manually per apps/api/PAYMENTS-GO-LIVE.md ' +
      '§4: in the Razorpay dashboard, resend the payment.captured delivery for this order, then confirm via SQL ' +
      '(SELECT SUM(amount_minor) FROM ledger_entries; -- unchanged) that it was a no-op.',
    );
    return;
  }
  return step('Webhook replay no-op (best-effort, bracketed by GET /v1/recon/overview) — see README "Check 6" for why this can\'t be fully automated', async () => {
    const before = await adminApi('GET', '/v1/recon/overview');
    assert(before.body?.data?.ledgerZeroSum?.balanced === true, `ledger balanced before replay, got ${JSON.stringify(before.body?.data?.ledgerZeroSum)}`);
    console.log('     If you have Razorpay dashboard access: go resend the payment.captured delivery for this order now (Settings -> Webhooks -> Recent Deliveries -> Resend).');
    await ask('     Press Enter once you\'ve done that (or immediately, to skip the manual dashboard step and just re-check the ledger): ');
    const after = await adminApi('GET', '/v1/recon/overview');
    assert(after.body?.data?.ledgerZeroSum?.balanced === true, `ledger STILL balanced after replay attempt, got ${JSON.stringify(after.body?.data?.ledgerZeroSum)}`);
    return 'ledger balanced before and after — consistent with a redelivered webhook being a no-op (dedup on the gateway event id)';
  });
}

// ===================================================================================================
// Check 7 — notification recorded
// ===================================================================================================
async function check7() {
  return step('Notification recorded — GET /v1/notifications', async () => {
    const r = await api('GET', '/v1/notifications', { token: founderToken, expect: 200 });
    const items = r.body?.data || [];
    assert(items.length > 0, 'at least one notification exists for the founder (seller side of the order)');
    return `count=${items.length} (e.g. ${items[0]?.eventCode}/${items[0]?.channel}/${items[0]?.status})`;
  });
}

// ===================================================================================================
// Check 8 — refund the ₹1 + reconciliation
// ===================================================================================================
async function check8() {
  return step('Refund the ₹1 + reconciliation — POST /v1/payments/:id/refund, poll status, GET /v1/recon/overview (if configured)', async () => {
    await loudConfirm(
      `About to REFUND the real ₹1.00 for paymentId=${paymentId} back to the founder's UPI account.`,
      'REFUND-1-RUPEE',
    );
    await api('POST', `/v1/payments/${paymentId}/refund`, {
      token: founderToken, idemKey: randomUUID(),
      body: { amountMinor: ONE_RUPEE_MINOR.toString(), reason: 'scripts/staging-smoke ₹1 round-trip reconciliation (Sprint S2)' },
      expect: [200, 201],
    });
    // Requires the founder's provisioned `tenant_admin` role (wallet.adjust) — see
    // apps/api/src/modules/payments/policies/payments.policies.ts. A plain farmer/customer role 403s here.

    await poll('refund settled', async () => {
      const p = await api('GET', `/v1/payments/${paymentId}`, { token: founderToken, expect: 200 });
      return { done: p.body?.data?.status === 'refunded' && p.body?.data?.refundedMinor === ONE_RUPEE_MINOR.toString(), value: p.body?.data };
    }, { timeoutMs: 60_000, intervalMs: 3000 });

    if (!ADMIN_API_BASE || !ADMIN_API_TOKEN) {
      console.log('     ADMIN_API_URL/ADMIN_API_TOKEN not set — skipping the live ledger-zero-sum check via GET /v1/recon/overview.');
      console.log('     Manual fallback (apps/api/PAYMENTS-GO-LIVE.md §5): SELECT status, refunded_minor FROM payments WHERE id=\'' + paymentId + '\'; SELECT SUM(amount_minor) FROM ledger_entries; -- expect 0');
      return `paymentId=${paymentId} refunded (ledger check: manual, see above)`;
    }
    const recon = await adminApi('GET', '/v1/recon/overview');
    assert(recon.body?.data?.ledgerZeroSum?.balanced === true, `whole-platform ledger nets to zero after refund, got ${JSON.stringify(recon.body?.data?.ledgerZeroSum)}`);
    return `paymentId=${paymentId} refunded, ledger balanced`;
  });
}

// ===================================================================================================
// Check 9 — eKYC session start (real provider), as far as automatable
// ===================================================================================================
async function check9() {
  if (SKIP_EKYC_FLAG || !EKYC_ID_NUMBER) {
    skipStep(
      'eKYC session start',
      SKIP_EKYC_FLAG
        ? '--skip-ekyc passed'
        : 'EKYC_TEST_ID_NUMBER not set (default behaviour — this script never sends a real Aadhaar/PAN number ' +
          'unless you explicitly opt in). To automate this check: export EKYC_TEST_ID_NUMBER (and optionally ' +
          'EKYC_TEST_DOC_TYPE=aadhaar|pan) and drop --skip-ekyc. Otherwise, prove this manually via the mobile/web ' +
          'KYC screen against staging: Profile -> KYC -> Aadhaar/PAN -> enter id -> enter provider OTP -> verified.',
    );
    return;
  }
  return step('eKYC session start (real provider) — POST /v1/kyc/ekyc/start -> human types provider OTP -> POST /v1/kyc/ekyc/verify', async () => {
    await loudConfirm(
      `About to send a REAL ${EKYC_DOC_TYPE.toUpperCase()} number to the real staging eKYC provider (EKYC_PROVIDER_KIND).\n` +
      `This id is never persisted (see apps/api/src/modules/identity/services/ekyc.service.ts) but it IS sent to a ` +
      `third-party verification service.`,
      'SEND-REAL-ID',
    );
    const start = await api('POST', '/v1/kyc/ekyc/start', {
      token: founderToken, idemKey: randomUUID(),
      body: { docType: EKYC_DOC_TYPE, idNumber: EKYC_ID_NUMBER, fullName: 'Founder Smoke Test' },
      expect: [200, 201],
    });
    const sessionId = start.body?.data?.sessionId ?? start.body?.data?.id;
    assert(sessionId, 'eKYC session id returned');
    if (start.body?.data?.otpRequired === false) return `sessionId=${sessionId} (no OTP step required by this provider)`;

    console.log(`     The eKYC provider should now send an OTP (e.g. to the Aadhaar-linked phone).`);
    const otp = await ask('     Enter the eKYC provider OTP: ');
    const verify = await api('POST', '/v1/kyc/ekyc/verify', {
      token: founderToken, idemKey: randomUUID(), body: { sessionId, otp }, expect: [200, 201],
    });
    assert(verify.body?.data?.verified === true, `eKYC session verified, got ${JSON.stringify(verify.body?.data)}`);
    return `sessionId=${sessionId} verified`;
  });
}

// ===================================================================================================
// main
// ===================================================================================================
function printSummary() {
  console.log('\n--- PASS/FAIL/SKIP summary ---');
  for (const r of results) {
    const label = r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'SKIP' : 'FAIL';
    const extra = r.status === 'FAIL' ? `  <- ${r.error}` : r.status === 'SKIP' ? `  <- ${r.reason}` : '';
    console.log(`  [${label}] ${String(r.n).padStart(2, '0')}. ${r.name}${extra}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const passed = results.length - failed - skipped;
  console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed (of ${results.length}).`);
  return failed;
}

async function main() {
  console.log('=== Krishi-Verse STAGING smoke suite (Sprint S2) ===');
  console.log(`API base: ${API_BASE}`);
  console.log(`Tenant:   ${TENANT_ID}`);
  console.log(`Phone:    ${FOUNDER_PHONE}`);
  if (SKIP_MONEY) console.log('--skip-money passed: checks 5/6/7/8 will be skipped.');
  if (SKIP_EKYC_FLAG) console.log('--skip-ekyc passed: check 9 will be skipped.');

  await check1();
  await check2();
  await check3();
  await check4();

  if (SKIP_MONEY) {
    skipStep('₹1 LIVE payment', '--skip-money passed');
    skipStep('Webhook replay no-op check', '--skip-money passed');
    skipStep('Notification recorded', '--skip-money passed (no order was created, so there is nothing to notify about)');
    skipStep('Refund the ₹1 + reconciliation', '--skip-money passed');
  } else {
    await check5();
    await check6();
    await check7();
    await check8();
  }

  await check9();
}

main()
  .then(() => { const failed = printSummary(); rl.close(); process.exit(failed > 0 ? 1 : 0); })
  .catch((err) => {
    const failed = printSummary();
    console.error(`\nSTAGING SMOKE SUITE FAILED: ${err.message}`);
    rl.close();
    process.exit(failed > 0 ? 1 : 1);
  });
