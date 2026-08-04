#!/usr/bin/env node
// scripts/demo-seed/run.mjs
//
// THE FOUNDER'S ASK ("add dummy data so the app displays like a real application") — done the ONLY
// safe way, given the invariant-protected money tables (db/local/demo-design-data.sql's header now
// explains why that file can't be trusted for this): drive the REAL HTTP APIs, exactly as
// scripts/pilot-e2e/flow.mjs proved for the pilot slice. Every row this script produces is genuinely
// valid — real wallet ledger entries (hash-chained + zero-sum, reconciled by the recon job), real
// uuidv7 order ids (PRUNE-checked against the orders partitions), real escrow release, real eKYC
// state. Nothing here is hand-inserted.
//
// WHAT THIS SCRIPT REUSES FROM scripts/pilot-e2e/ (not re-invented):
//   - the api()/idempotency-key/OTP-devCode login pattern from flow.mjs + provision-loadtest-identities.mjs
//   - relay-tick.mjs verbatim (spawned as a child process) — the outbox relay still isn't wired to run
//     on its own for `payment_succeeded -> order confirmed` / `order_completed -> escrow release`; see
//     scripts/pilot-e2e/README.md "Why a manual relay tick" for the full explanation. Nothing new was
//     added to make relaying work — this script shells out to the exact same file.
//
// WHAT IS DIFFERENT FROM flow.mjs (on purpose):
//   - flow.mjs creates a BRAND NEW tenant/farmer/buyer every run (a disposable pilot proof). This
//     script targets the FOUNDER'S OWN demo tenant (demo-fpo, 88888888-0000-7000-8000-000000000001 —
//     the same tenant apps/mobile/.env's EXPO_PUBLIC_TENANT_ID points at, and the same tenant the
//     founder already logs into as +91 9900000101 per docs/local-setup/08-make-the-demo-work.md) so
//     what this script creates is what the founder actually sees when they open the app.
//   - flow.mjs bootstraps its tenant/users/roles via a privileged `pg` Pool (there was no self-serve
//     onboarding endpoint when it was written). That gap is closed now (KV-BL-066): this script never
//     opens a database connection at all — onboarding goes through POST /v1/onboarding/roles, and
//     users are auto-created by POST /v1/auth/verify. Zero new npm dependencies, zero direct SQL.
//
// See scripts/demo-seed/README.md for prerequisites, the one command to run, the three login phones,
// and troubleshooting.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const API_BASE = process.env.DEMO_API_BASE || process.env.PILOT_API_BASE || 'http://localhost:3000';
// db/seeds/demo/0901_demo_tenants.sql — "demo-fpo". Same id apps/mobile/.env's EXPO_PUBLIC_TENANT_ID
// points at (docs/local-setup/08-make-the-demo-work.md). Override only if your local setup diverged.
const TENANT_ID = process.env.DEMO_TENANT_ID || '88888888-0000-7000-8000-000000000001';

// apps/api/src/modules/identity/gateway/sandbox-ekyc.provider.ts SANDBOX_EKYC_OTP — re-declared here
// (a plain .mjs can't import the TS source); kept in lockstep by the literal value, not a guess.
const SANDBOX_EKYC_OTP = '123456';
// Verhoeff-valid 12-digit Aadhaar sample used by the repo's OWN eKYC integration test
// (apps/api/src/modules/identity/__tests__/ekyc-cycle.integration.spec.ts VALID_AADHAAR) — reused
// verbatim so this script's validity is provable against the same fixture the test suite trusts.
const VALID_AADHAAR = '999999990019';

// ---------------------------------------------------------------------------------------------
// The three personas (design-canon names/phones — see README for the full table).
// ---------------------------------------------------------------------------------------------
const RAMESH = { key: 'ramesh', phone: '+919900000101', fullName: 'Ramesh Patel', role: 'farmer' };
const ANAND = { key: 'anand', phone: '+919900000201', fullName: 'Anand Stores', role: 'customer' };
const MEERA = { key: 'meera', phone: '+919900000301', fullName: 'Meera Ben Patel', role: 'farmer' };
const PERSONAS = [RAMESH, ANAND, MEERA];

// ---------------------------------------------------------------------------------------------
// Canon listing data — SCREEN-DATA-CATALOG.json / demo-dataset.json prices (docs/design-data/),
// the same figures the Phase-1 mockups show for Ramesh's catalogue. `productTerm` is what we search
// the REAL catalogue for (GET /v1/products?q=...), never a hardcoded id — if the crop isn't in the
// launch-30 catalogue (db/seeds/catalogue/0103_launch_crops_30.sql only ships
// wheat/groundnut/cumin/tomato/onion), we degrade to the nearest category match and say so loudly.
// ---------------------------------------------------------------------------------------------
const LISTINGS = [
  {
    key: 'wheat',
    title: 'Premium Wheat — Lokwan',
    description: 'Grade A Lokwan wheat, Anand. Premium quality, freshly harvested.',
    productTerm: 'wheat',
    priceMinor: '288000', // ₹2,880/qtl
    quantityTotal: 50,
    unitCode: 'quintal',
    organicClaim: 'none',
  },
  {
    key: 'groundnut',
    title: 'GG-20 Groundnut',
    description: 'GG-20 variety groundnut, Junagadh belt. Bold seed, low moisture.',
    productTerm: 'groundnut',
    priceMinor: '618000', // ₹6,180/qtl
    quantityTotal: 25,
    unitCode: 'quintal',
    organicClaim: 'none',
  },
  {
    key: 'onion',
    title: 'Onion — Medium Grade',
    description: 'Red onion, medium size, Grade B.',
    productTerm: 'onion',
    priceMinor: '145000', // ₹1,450/qtl
    quantityTotal: 10,
    unitCode: 'quintal',
    organicClaim: 'none',
  },
  {
    key: 'chilli',
    title: 'Red Chilli — Teja (Organic)',
    description: 'Organic Teja red chilli. Sun-dried, premium grade.',
    productTerm: 'chilli',
    // db/seeds/catalogue/0101_category_tree.sql — crops.spices (id ...016) is the nearest real
    // category if "chilli" isn't in the launch-30 product master; cumin (...113) sits under it.
    degradeCategoryId: '44444444-0000-7000-8000-000000000016',
    priceMinor: '1450000', // ₹14,500/qtl
    quantityTotal: 2,
    unitCode: 'quintal',
    organicClaim: 'certified',
  },
];

// ---------------------------------------------------------------------------------------------
// tiny step runner (mirrors scripts/pilot-e2e/flow.mjs)
// ---------------------------------------------------------------------------------------------
const results = [];
let stepNo = 0;
const notes = []; // non-fatal degrade/skip notes surfaced in the final summary

async function step(name, fn) {
  stepNo += 1;
  process.stdout.write(`\n[${String(stepNo).padStart(2, '0')}] ${name}\n`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ n: stepNo, name, ok: true, ms });
    process.stdout.write(`     OK (${ms}ms)${detail ? '  ' + detail : ''}\n`);
    return detail;
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ n: stepNo, name, ok: false, ms, error: err.message });
    process.stdout.write(`     FAIL (${ms}ms)\n`);
    process.stderr.write(`     ${err.stack || err.message}\n`);
    throw err;
  }
}

function note(msg) {
  notes.push(msg);
  process.stdout.write(`     NOTE: ${msg}\n`);
}

const uuid = () => crypto.randomUUID();

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

// Same one-shot outbox relay drain scripts/pilot-e2e/flow.mjs uses — see that file's header comment
// for WHY this exists (the relay has no permanent timer wired yet). Reused verbatim, not duplicated.
function relayTick() {
  const r = spawnSync('node', [path.join(repoRoot, 'scripts', 'pilot-e2e', 'relay-tick.mjs')], {
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

// ---------------------------------------------------------------------------------------------
// Step 1 — login-or-onboard a persona.
//   POST /v1/auth/otp -> devCode (requires AUTH_EXPOSE_OTP=true) -> POST /v1/auth/verify (auto-creates
//   the `users` row on first login, per AuthService.verifyOtp — see identity/services/auth.service.ts)
//   -> POST /v1/onboarding/roles (KV-BL-066, self-serve, idempotent no-op if already granted).
// ---------------------------------------------------------------------------------------------
async function loginOrOnboard(persona) {
  const otp = await api('POST', '/v1/auth/otp', { body: { phone: persona.phone, channel: 'sms' }, expect: [200, 201] });
  const devCode = otp.body?.data?.devCode;
  if (!devCode) {
    throw new Error(
      `No devCode in /v1/auth/otp response for ${persona.phone} — the api must be started with ` +
      `AUTH_EXPOSE_OTP=true for this script to log in without real SMS (see README prerequisites).`,
    );
  }
  const verify = await api('POST', '/v1/auth/verify', {
    body: { phone: persona.phone, code: devCode, tenantId: TENANT_ID, fullName: persona.fullName },
    expect: [200, 201],
  });
  const accessToken = verify.body?.data?.accessToken;
  const userId = verify.body?.data?.user?.id;
  if (!accessToken || !userId) throw new Error(`verify did not return accessToken/user for ${persona.phone}`);

  const grant = await api('POST', '/v1/onboarding/roles', {
    token: accessToken, tenantId: TENANT_ID, idemKey: uuid(),
    body: { role: persona.role }, expect: [200, 201],
  });
  const roles = grant.body?.data?.roles ?? [];
  if (!roles.includes(persona.role)) {
    throw new Error(`onboarding/roles did not confirm '${persona.role}' for ${persona.phone} (roles=${roles.join(',')})`);
  }
  return { ...persona, userId, accessToken };
}

// ---------------------------------------------------------------------------------------------
// Step 2 — Ramesh's sandbox eKYC (Aadhaar) + a payout bank account. Both are prerequisites for the
// KYC gate PayoutService.requestPayout / BankAccountService.add enforce (S3 review findings —
// apps/api/src/modules/payments/__tests__/payout-kyc-gate.spec.ts,
// apps/api/src/modules/identity/__tests__/bank-account-kyc-gate.spec.ts). Requires EKYC_PROVIDER_KIND=
// sandbox on the api (apps/api/src/modules/identity/gateway/ekyc-provider.provider.ts) so
// POST /v1/kyc/ekyc/verify accepts the fixed SANDBOX_EKYC_OTP instead of a live provider callback.
// ---------------------------------------------------------------------------------------------
async function ensureKycAndBankAccount(ramesh) {
  const sessions = await api('GET', '/v1/kyc/ekyc/sessions', { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
  const already = (sessions.body?.data ?? []).some((s) => s.status === 'verified' && s.docType === 'aadhaar');
  if (already) {
    note('Ramesh already has a verified aadhaar eKYC session — skipping start/verify.');
  } else {
    const started = await api('POST', '/v1/kyc/ekyc/start', {
      token: ramesh.accessToken, tenantId: TENANT_ID, idemKey: uuid(),
      body: { docType: 'aadhaar', idNumber: VALID_AADHAAR, fullName: ramesh.fullName }, expect: [200, 201],
    });
    const sessionId = started.body?.data?.id;
    if (!sessionId) throw new Error('ekyc/start did not return a session id');
    const verified = await api('POST', '/v1/kyc/ekyc/verify', {
      token: ramesh.accessToken, tenantId: TENANT_ID, idemKey: uuid(),
      body: { sessionId, otp: SANDBOX_EKYC_OTP }, expect: [200, 201],
    });
    if (verified.body?.data?.status !== 'verified') throw new Error(`eKYC did not verify: ${JSON.stringify(verified.body)}`);
  }

  const existing = await api('GET', '/v1/bank-accounts', { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
  const list = existing.body?.data ?? [];
  if (list.length > 0) {
    note(`Ramesh already has ${list.length} bank account(s) on file — reusing the first one.`);
    return list[0].id;
  }
  const added = await api('POST', '/v1/bank-accounts', {
    token: ramesh.accessToken, tenantId: TENANT_ID, idemKey: uuid(),
    body: {
      accountKind: 'upi', upiId: 'ramesh.patel@upi',
      vaultRef: `vault_demo_ramesh_${crypto.randomBytes(6).toString('hex')}`,
      isPrimary: true,
    },
    expect: [200, 201],
  });
  const id = added.body?.data?.id;
  if (!id) throw new Error('bank-accounts add did not return an id');
  return id;
}

// ---------------------------------------------------------------------------------------------
// Product lookup — "search the catalogue like the app does" (GET /v1/products?q=..., @Public,
// apps/api/src/modules/catalogue/controllers/v1/products.controller.ts). Degrades to the nearest
// category match (never invents a product row) and returns a note when it does.
// ---------------------------------------------------------------------------------------------
async function findProduct(term, degradeCategoryId) {
  const q1 = new URLSearchParams({ q: term, activeOnly: 'true', limit: '5' });
  const r1 = await api('GET', `/v1/products?${q1}`, { tenantId: TENANT_ID, expect: 200 });
  const hits1 = r1.body?.data ?? [];
  if (hits1.length > 0) return { productId: hits1[0].id, categoryId: hits1[0].categoryId, degraded: false };

  if (degradeCategoryId) {
    const q2 = new URLSearchParams({ categoryId: degradeCategoryId, activeOnly: 'true', limit: '5' });
    const r2 = await api('GET', `/v1/products?${q2}`, { tenantId: TENANT_ID, expect: 200 });
    const hits2 = r2.body?.data ?? [];
    if (hits2.length > 0) {
      return { productId: hits2[0].id, categoryId: hits2[0].categoryId, degraded: true, degradedTo: hits2[0].name };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Step 3 — ensure ONE of Ramesh's canon listings exists + is published. Idempotent by TITLE:
// GET /v1/listings?mine=true&q=<title> before creating anything (running the seeder twice must not
// duplicate listings).
// ---------------------------------------------------------------------------------------------
async function ensureListing(ramesh, spec) {
  const q = new URLSearchParams({ mine: 'true', q: spec.title, limit: '20' });
  const existing = await api('GET', `/v1/listings?${q}`, { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
  const found = (existing.body?.data ?? []).find((l) => l.title === spec.title);
  if (found) {
    if (found.status === 'draft') {
      await api('POST', `/v1/listings/${found.id}/publish`, { token: ramesh.accessToken, tenantId: TENANT_ID, expect: [200, 201] });
      found.status = 'published';
    }
    note(`Listing "${spec.title}" already exists (${found.id}, status=${found.status}) — reusing.`);
    return { id: found.id, status: found.status, quantityAvailable: found.quantityAvailable, priceMinor: found.priceMinor };
  }

  const prod = await findProduct(spec.productTerm, spec.degradeCategoryId);
  if (!prod) {
    note(`No catalogue product found for "${spec.productTerm}" (and no degrade match) — SKIPPING listing "${spec.title}".`);
    return null;
  }
  if (prod.degraded) {
    note(`"${spec.productTerm}" is not in the launch catalogue (db/seeds/catalogue/0103) — degraded to the nearest ` +
      `category match ("${prod.degradedTo}") for listing "${spec.title}". Title/price/qty stay as specified; only ` +
      `the underlying productId/categoryId are a substitute.`);
  }

  const create = await api('POST', '/v1/listings', {
    token: ramesh.accessToken, tenantId: TENANT_ID, idemKey: uuid(),
    body: {
      productId: prod.productId, categoryId: prod.categoryId,
      title: spec.title, description: spec.description,
      quantityTotal: spec.quantityTotal, minOrderQty: 0, unitCode: spec.unitCode,
      priceMinor: spec.priceMinor, currencyCode: 'INR',
      saleType: 'direct', organicClaim: spec.organicClaim, visibility: 'public',
    },
    expect: [200, 201],
  });
  const id = create.body?.data?.id;
  if (!id) throw new Error(`listing create did not return an id for "${spec.title}"`);
  await api('POST', `/v1/listings/${id}/publish`, { token: ramesh.accessToken, tenantId: TENANT_ID, expect: [200, 201] });
  return { id, status: 'published', quantityAvailable: spec.quantityTotal, priceMinor: spec.priceMinor };
}

// ---------------------------------------------------------------------------------------------
// Order helpers — buyer adds to cart -> checkout (ONE order per seller per checkout; the cart is
// marked converted afterwards, so back-to-back add+checkout cycles never merge into one order — see
// CheckoutService.checkout / carts.markConverted).
// ---------------------------------------------------------------------------------------------
async function placeOrder(buyer, listingId, desiredQty) {
  const detail = await api('GET', `/v1/listings/${listingId}`, { token: buyer.accessToken, tenantId: TENANT_ID, expect: 200 });
  const available = Number(detail.body?.data?.quantityAvailable ?? 0);
  const qty = Math.min(desiredQty, available);
  if (qty <= 0) return null; // sold out — caller decides what to do

  await api('POST', '/v1/cart/items', {
    token: buyer.accessToken, tenantId: TENANT_ID,
    body: { listingId, quantity: qty }, expect: [200, 201],
  });
  const co = await api('POST', '/v1/checkout', {
    token: buyer.accessToken, tenantId: TENANT_ID, idemKey: uuid(), body: {}, expect: [200, 201],
  });
  const order = co.body?.data?.orders?.[0];
  if (!order?.id) throw new Error('checkout did not return an order');
  return { ...order, qty };
}

// Pay via the sandbox gateway (HMAC-signed webhook, same as scripts/pilot-e2e/flow.mjs) + relay tick
// so the order flips payment_pending -> confirmed and escrow is credited.
async function payAndConfirm(order) {
  const pay = await api('POST', '/v1/payments', {
    token: ANAND_TOKEN(), tenantId: TENANT_ID, idemKey: uuid(),
    body: { purpose: 'direct_order', amountMinor: order.totalMinor, currencyCode: 'INR', referenceType: 'order', referenceId: order.id },
    expect: [200, 201],
  });
  const gatewayOrderId = pay.body?.data?.gatewayOrderId;
  const secret = process.env.SANDBOX_WEBHOOK_SECRET || process.env.RAZORPAYX_WEBHOOK_SECRET || 'sandbox-secret';
  const payload = JSON.stringify({
    id: `evt_${uuid()}`, event: 'payment.captured', tenant_id: TENANT_ID,
    order_id: gatewayOrderId, payment_id: `pay_${uuid()}`, amount: Number(order.totalMinor), method: 'upi',
  });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const res = await fetch(`${API_BASE}/v1/payments/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    body: payload,
  });
  if (res.status !== 200) throw new Error(`payment webhook -> HTTP ${res.status}`);
  const tick = relayTick();
  if (tick.ok === false) throw new Error('relay tick reported failure after payment webhook');
}

// module-scope holder so payAndConfirm (defined before main() assigns tokens) can reach Anand's
// token without threading it through every call — set once in main() before any order is placed.
let _anandToken = null;
function ANAND_TOKEN() { if (!_anandToken) throw new Error('Anand not logged in yet'); return _anandToken; }

async function advanceOrder(sellerToken, orderId, steps) {
  for (const s of steps) {
    await api('POST', `/v1/orders/${orderId}/${s}`, { token: sellerToken, tenantId: TENANT_ID, expect: [200, 201] });
  }
}

async function completeOrder(buyerToken, orderId) {
  await api('POST', `/v1/orders/${orderId}/complete`, { token: buyerToken, tenantId: TENANT_ID, expect: [200, 201] });
  const tick = relayTick();
  if (tick.ok === false) throw new Error('relay tick reported failure after order complete');
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
async function main() {
  console.log('=== Krishalaya demo seed (drives the REAL APIs — see scripts/demo-seed/README.md) ===');
  console.log(`API base: ${API_BASE}`);
  console.log(`Tenant:   ${TENANT_ID}`);

  let ramesh, anand, meera;

  await step('Login-or-onboard Ramesh Patel (farmer, +91 9900000101)', async () => {
    ramesh = await loginOrOnboard(RAMESH);
    return `userId=${ramesh.userId}`;
  });

  await step('Login-or-onboard Anand Stores (buyer/customer, +91 9900000201)', async () => {
    anand = await loginOrOnboard(ANAND);
    _anandToken = anand.accessToken;
    return `userId=${anand.userId}`;
  });

  await step('Login-or-onboard Meera Ben Patel (second farmer, +91 9900000301)', async () => {
    meera = await loginOrOnboard(MEERA);
    return `userId=${meera.userId}`;
  });

  let bankAccountId;
  await step('Ramesh: sandbox eKYC (Aadhaar) + a payout bank account (KYC-gated)', async () => {
    bankAccountId = await ensureKycAndBankAccount(ramesh);
    return `bankAccountId=${bankAccountId}`;
  });

  const listings = {};
  for (const spec of LISTINGS) {
    await step(`Ramesh: ensure listing "${spec.title}" exists + is published`, async () => {
      listings[spec.key] = await ensureListing(ramesh, spec);
      if (!listings[spec.key]) return 'SKIPPED (see note above)';
      return `id=${listings[spec.key].id} status=${listings[spec.key].status}`;
    });
  }

  // --- Order (a): payment_pending only (checkout, no payment) ---------------------------------
  let orderA;
  await step('Anand orders 5 qtl of "Premium Wheat — Lokwan" — checkout only, LEFT payment_pending', async () => {
    if (!listings.wheat) { note('wheat listing missing — skipping order (a).'); return 'SKIPPED'; }
    orderA = await placeOrder(anand, listings.wheat.id, 5);
    if (!orderA) { note('wheat listing is sold out — skipping order (a).'); return 'SKIPPED'; }
    if (orderA.status !== 'payment_pending') throw new Error(`expected payment_pending, got ${orderA.status}`);
    return `orderId=${orderA.id} orderNo=${orderA.orderNo} totalMinor=${orderA.totalMinor} qty=${orderA.qty}qtl`;
  });

  // --- Order (b): paid + confirmed, driven to mid-lifecycle (packed -> ready) ------------------
  let orderB;
  await step('Anand orders 2 qtl of "GG-20 Groundnut" — pays, driven to packed -> ready (in-transit)', async () => {
    if (!listings.groundnut) { note('groundnut listing missing — skipping order (b).'); return 'SKIPPED'; }
    orderB = await placeOrder(anand, listings.groundnut.id, 2);
    if (!orderB) { note('groundnut listing is sold out — skipping order (b).'); return 'SKIPPED'; }
    await payAndConfirm(orderB);
    const check = await api('GET', `/v1/orders/${orderB.id}`, { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
    if (check.body?.data?.status !== 'confirmed') throw new Error(`expected confirmed after payment, got ${check.body?.data?.status}`);
    // packed -> ready. NOTE: there is no literal "shipped"/"in_transit" transition endpoint in this
    // codebase (apps/api/.../orders/controllers/v1/orders.controller.ts only exposes packed/ready/
    // delivered/complete) — 'ready' (ready for pickup/dispatch, pre-delivery) is the closest real
    // state to "in transit" and is where this order is deliberately left.
    await advanceOrder(ramesh.accessToken, orderB.id, ['packed', 'ready']);
    return `orderId=${orderB.id} orderNo=${orderB.orderNo} totalMinor=${orderB.totalMinor} qty=${orderB.qty}qtl status=ready`;
  });

  // --- Order (c): full lifecycle -> completed -> escrow released -> wallet credited -----------
  let orderC;
  await step('Anand orders 10 qtl of "Onion — Medium Grade" — full lifecycle to COMPLETED', async () => {
    if (!listings.onion) { note('onion listing missing — skipping order (c).'); return 'SKIPPED'; }
    orderC = await placeOrder(anand, listings.onion.id, 10);
    if (!orderC) { note('onion listing is sold out — skipping order (c) (reruns exhaust its 10qtl stock by design; see README).'); return 'SKIPPED'; }
    await payAndConfirm(orderC);
    await advanceOrder(ramesh.accessToken, orderC.id, ['packed', 'ready', 'delivered']);
    await completeOrder(anand.accessToken, orderC.id);
    const check = await api('GET', `/v1/orders/${orderC.id}`, { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
    if (check.body?.data?.status !== 'completed') throw new Error(`expected completed, got ${check.body?.data?.status}`);
    return `orderId=${orderC.id} orderNo=${orderC.orderNo} totalMinor=${orderC.totalMinor} qty=${orderC.qty}qtl status=completed`;
  });

  await step('Verify Ramesh\'s wallet shows real earnings (GET /v1/wallet/balance + /ledger)', async () => {
    const bal = await api('GET', '/v1/wallet/balance', { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
    const ledger = await api('GET', '/v1/wallet/ledger?limit=10', { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
    const availableMinor = bal.body?.data?.availableMinor ?? '0';
    const entries = ledger.body?.data?.length ?? 0;
    if (orderC && BigInt(availableMinor) <= 0n) throw new Error('expected a positive wallet balance after order (c) completed');
    return `availableMinor=${availableMinor} ledgerEntries=${entries}`;
  });

  await step('Ramesh requests a payout of the full available wallet balance (KYC-gated)', async () => {
    const bal = await api('GET', '/v1/wallet/balance', { token: ramesh.accessToken, tenantId: TENANT_ID, expect: 200 });
    const availableMinor = bal.body?.data?.availableMinor ?? '0';
    if (BigInt(availableMinor) <= 0n) { note('Ramesh has no available wallet balance — skipping payout request.'); return 'SKIPPED'; }
    const payout = await api('POST', '/v1/payouts', {
      token: ramesh.accessToken, tenantId: TENANT_ID, idemKey: uuid(),
      body: { amountMinor: availableMinor, bankAccountId, purpose: 'settlement', currencyCode: 'INR' },
      expect: [200, 201],
    });
    const payoutId = payout.body?.data?.payoutId;
    const status = payout.body?.data?.status;
    if (status !== 'queued') throw new Error(`expected payout queued, got ${status}`);
    note(
      'Payout is QUEUED, not yet paid — PayoutExecutionCadenceJob runs every 5 minutes inside the api ' +
      'process (apps/api/src/modules/payments/jobs/payout-execution.cadence-job.ts) and will disburse ' +
      'it via the sandbox payout gateway automatically as long as the api keeps running. Poll ' +
      `GET /v1/payouts/${payoutId} (or the app\'s payout history screen) to watch it flip to processing/paid.`,
    );
    return `payoutId=${payoutId} amountMinor=${availableMinor} status=queued`;
  });

  console.log('\n=== DEMO SEED COMPLETE ===');
}

function printSummary() {
  console.log('\n--- STEP SUMMARY ---');
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${mark}] ${String(r.n).padStart(2, '0')}. ${r.name}${r.ok ? '' : `  <- ${r.error}`}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps ok.`);
  if (notes.length) {
    console.log('\n--- NOTES (degrades / skips — not failures) ---');
    for (const n of notes) console.log(`  - ${n}`);
  }
  console.log('\nLogin phones (dev OTP — devCode read back automatically by this script; AUTH_EXPOSE_OTP=true required):');
  console.log('  Ramesh Patel   (farmer)          +91 9900000101');
  console.log('  Anand Stores   (buyer/customer)  +91 9900000201');
  console.log('  Meera Ben Patel (second farmer)  +91 9900000301');
}

main()
  .then(() => {
    printSummary();
    process.exit(0);
  })
  .catch((err) => {
    printSummary();
    console.error(`\nDEMO SEED FAILED: ${err.message}`);
    process.exit(1);
  });
