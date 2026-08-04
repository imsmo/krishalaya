// ops/load-tests/k6-order-flow.js · buyer browse→checkout→pay happy path under load.
// PRD-scale SLO gate (default): p95<500ms, <1% err.
//   BASE=https://api.krishalaya.com k6 run ops/load-tests/k6-order-flow.js
//
// S5 PATCH (Sprint S5, pilot calibration — see ops/load-tests/pilot/README.md):
//   1. `GET /v1/market/pulse` was called anonymously with no `productId` — that route is actually
//      `@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard) @FeatureFlag('market_intel')` and
//      requires a `productId` query param (apps/api/src/modules/market-intel/controllers/v1/
//      mandi-prices.controller.ts) — an unauthenticated call 401s before the flag/404 path is ever
//      reached, so the old `r.status === 200 || r.status === 404` check was masking a real bug. The
//      `market_intel` flag also defaults OFF (db/seeds/core/0009_feature_flags.sql) and is not part
//      of the pilot thin slice. Fixed to be **opt-in** (`INCLUDE_MARKET_PULSE=true` + `TOKEN`/pool +
//      `MARKET_PRODUCT_ID`), skipped entirely by default so PRD-scale runs don't silently 401-pass.
//   2. Added the actual money-relevant flow the script's own filename promises but never implemented:
//      authenticated cart → checkout → payment-intent, gated by `PILOT_MODE`/`CHECKOUT_RATE` so it
//      only fires for a realistic fraction of iterations and NEVER calls the payment webhook (see
//      money-safety note below + ops/load-tests/pilot/README.md "Money safety").
//   3. Added `PILOT_MODE` stage/threshold overrides so this same script can run at pilot scale
//      (~10-30 VUs) without touching the PRD-scale (500 VU) defaults used elsewhere.
//   4. Added token-pool + refresh-on-401 support (`TOKENS` env, `accessToken:refreshToken:userId`
//      triples) since there is no shared session across VUs and the default JWT access-token TTL
//      (900s / 15 min, apps/api/src/core/config/env.validation.ts) is shorter than a 10min-sustain +
//      spike + soak run.
//
// MONEY SAFETY (read before running against any real staging environment):
//   This script calls at most `POST /v1/payments` (creates a `payment` row in status `initiated` +
//   a sandbox gateway "order" — apps/api/src/modules/payments/services/payment.service.ts:39-63).
//   NO LEDGER ENTRY IS CREATED until the payment.captured event is posted to
//   `POST /v1/payments/webhooks/sandbox`. This script NEVER calls that (or any) webhook endpoint —
//   grep this file: there is no `webhooks` string here. Never point `PAYMENTS_DEFAULT_PROVIDER` or
//   this script's `BASE` at anything other than a staging/sandbox environment with the sandbox
//   payment gateway registered (prod hard-fails if `PAYMENTS_DEFAULT_PROVIDER=sandbox`, so this is
//   structurally impossible against a real prod deploy, but a load test should still never be aimed
//   at prod).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const PILOT_MODE = (__ENV.PILOT_MODE || 'false') === 'true';
const TENANT_ID = __ENV.TENANT_ID || '';
const LISTING_ID = __ENV.LISTING_ID || '';
const CHECKOUT_RATE = Number(__ENV.CHECKOUT_RATE || 0.2);           // fraction of iterations that go all the way to checkout+payment
const INCLUDE_MARKET_PULSE = (__ENV.INCLUDE_MARKET_PULSE || 'false') === 'true';
const MARKET_PRODUCT_ID = __ENV.MARKET_PRODUCT_ID || '';

// TOKENS="accessToken1:refreshToken1:userId1,accessToken2:refreshToken2:userId2,..." — see
// ops/load-tests/pilot/provision-loadtest-identities.mjs, which mints this pool once before a run.
const TOKENS = (__ENV.TOKENS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => { const [accessToken, refreshToken, userId] = s.split(':'); return { accessToken, refreshToken, userId }; });

const errors = new Rate('flow_errors');
const serverErrors5xx = new Counter('server_errors_5xx');

function pilotStages() {
  const rampMin = Number(__ENV.PILOT_RAMP_MIN || 2);
  const sustainMin = Number(__ENV.PILOT_SUSTAIN_MIN || 10);
  const sustainVUs = Number(__ENV.PILOT_SUSTAIN_VUS || 20);
  const spikeMin = Number(__ENV.PILOT_SPIKE_MIN || 2);
  const spikeVUs = Number(__ENV.PILOT_SPIKE_VUS || 50);           // ~2.5x sustain — the 2-3x headroom margin
  const drainMin = Number(__ENV.PILOT_DRAIN_MIN || 1);
  return [
    { duration: `${rampMin}m`, target: sustainVUs },
    { duration: `${sustainMin}m`, target: sustainVUs },
    { duration: '30s', target: spikeVUs },
    { duration: `${spikeMin}m`, target: spikeVUs },
    { duration: `${drainMin}m`, target: 0 },
  ];
}

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: PILOT_MODE ? pilotStages() : [
        { duration: '2m', target: 200 },   // warm
        { duration: '5m', target: 500 },   // launch target
        { duration: '3m', target: 500 },   // hold
        { duration: '2m', target: 0 },     // drain
      ],
    },
  },
  thresholds: PILOT_MODE ? {
    http_req_duration: [`p(95)<${Number(__ENV.PILOT_P95_MS || 800)}`, `p(99)<${Number(__ENV.PILOT_P99_MS || 2000)}`],
    flow_errors: [`rate<${Number(__ENV.PILOT_ERR_RATE || 0.01)}`],
    server_errors_5xx: ['count==0'],
  } : {
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    flow_errors: ['rate<0.01'],
  },
};

function note5xx(res) { if (res.status >= 500) serverErrors5xx.add(1); }

function authHeaders(token) {
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` };
  if (TENANT_ID) h['x-tenant-id'] = TENANT_ID;
  return h;
}

// One-shot refresh-then-retry on 401 — access tokens (15min TTL) can expire mid-soak; refresh
// tokens (30-day TTL) don't. Mutates the VU-local token copy in place (each k6 VU is an isolated
// JS runtime with its own copy of TOKENS, so this never races another VU).
function refresh(token) {
  if (!token.refreshToken || !TENANT_ID) return false;
  const res = http.post(`${BASE}/v1/auth/refresh`, JSON.stringify({ refreshToken: token.refreshToken, tenantId: TENANT_ID }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'auth_refresh' } });
  if (res.status !== 200) return false;
  const body = res.json();
  token.accessToken = body?.data?.accessToken;
  token.refreshToken = body?.data?.refreshToken || token.refreshToken;
  return !!token.accessToken;
}

function authedRequest(method, path, token, body, tags) {
  const opts = { headers: authHeaders(token), tags };
  let res = method === 'GET' ? http.get(`${BASE}${path}`, opts) : http.post(`${BASE}${path}`, body, opts);
  if (res.status === 401 && refresh(token)) {
    opts.headers = authHeaders(token);
    res = method === 'GET' ? http.get(`${BASE}${path}`, opts) : http.post(`${BASE}${path}`, body, opts);
  }
  return res;
}

export default function () {
  // public browse (no auth) — the hottest read path
  const list = http.get(`${BASE}/v1/listings`, { tags: { name: 'listings' } });
  note5xx(list);
  check(list, { 'listings 200': (r) => r.status === 200 }) || errors.add(1);

  if (INCLUDE_MARKET_PULSE && TOKENS.length && MARKET_PRODUCT_ID) {
    const token = TOKENS[(__VU - 1) % TOKENS.length];
    const pulse = authedRequest('GET', `/v1/market/pulse?productId=${MARKET_PRODUCT_ID}`, token, undefined, { name: 'market_pulse' });
    note5xx(pulse);
    check(pulse, { 'pulse ok/off': (r) => r.status === 200 || r.status === 404 }) || errors.add(1);
  }

  if (TOKENS.length) {
    const token = TOKENS[(__VU - 1) % TOKENS.length];

    if (LISTING_ID) {
      const detail = authedRequest('GET', `/v1/listings/${LISTING_ID}`, token, undefined, { name: 'listing_detail' });
      note5xx(detail);
      check(detail, { 'listing detail 200': (r) => r.status === 200 }) || errors.add(1);
    }

    // Only a realistic slice of sessions go all the way to checkout — mirrors real buyer behaviour
    // (most opens are just browsing) and avoids exhausting the seeded listing's stock during a
    // sustained run. See ops/load-tests/pilot/README.md "VU-model math" for the CHECKOUT_RATE choice.
    if (LISTING_ID && Math.random() < CHECKOUT_RATE) {
      const add = authedRequest('POST', '/v1/cart/items', token, JSON.stringify({ listingId: LISTING_ID, quantity: 1 }), { name: 'cart_add' });
      note5xx(add);
      const added = check(add, { 'cart add ok': (r) => [200, 201].includes(r.status) });
      if (!added) errors.add(1);

      if (added) {
        const idemKey = `k6-checkout-${__VU}-${__ITER}-${Date.now()}`;
        const checkoutHeaders = { ...authHeaders(token), 'idempotency-key': idemKey };
        const checkout = http.post(`${BASE}/v1/checkout`, JSON.stringify({}), { headers: checkoutHeaders, tags: { name: 'checkout' } });
        note5xx(checkout);
        const checkedOut = check(checkout, { 'checkout ok': (r) => [200, 201].includes(r.status) });
        if (!checkedOut) errors.add(1);

        if (checkedOut) {
          const order = checkout.json('data.orders.0');
          if (order && order.id && order.totalMinor) {
            // MONEY SAFETY: creates a payment INTENT only (no ledger entry — see file header).
            // This script does NOT call POST /v1/payments/webhooks/sandbox or any other webhook,
            // so no payment ever actually "completes" and no wallet/ledger balance moves.
            const payKey = `k6-pay-${__VU}-${__ITER}-${Date.now()}`;
            const payHeaders = { ...authHeaders(token), 'idempotency-key': payKey };
            const pay = http.post(`${BASE}/v1/payments`, JSON.stringify({
              purpose: 'direct_order', amountMinor: order.totalMinor, currencyCode: 'INR',
              referenceType: 'order', referenceId: order.id,
            }), { headers: payHeaders, tags: { name: 'payment_intent' } });
            note5xx(pay);
            check(pay, { 'payment intent ok': (r) => [200, 201].includes(r.status) }) || errors.add(1);
          }
        }
      }
    }
  }

  sleep(Math.random() * 2);
}
