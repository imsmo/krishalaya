#!/usr/bin/env node
// ops/load-tests/pilot/local-vu-runner.mjs — DEV-33 deliverable.
//
// WHY THIS FILE EXISTS: the k6 binary (https://k6.io) is a Go executable, not an npm package —
// the npm package literally named "k6" is an unrelated placeholder (confirmed: `npm view k6
// version` -> 0.0.0). k6's own release channels (dl.k6.io, github release-assets) are blocked by
// this sandbox's egress allowlist (confirmed: dl.k6.io -> 403 "blocked-by-allowlist"; the GitHub
// release-asset redirect target -> 403 as well, even though github.com itself is reachable).
// `run-pilot-gate.sh` in this same directory is therefore NOT runnable in any agent sandbox — it
// remains exactly what it always was: the script the FOUNDER runs against real staging with a
// real k6 binary. This file is the local-execution substitute, translating the SAME scenarios and
// the SAME PILOT_* thresholds (see README.md "Thresholds chosen") into a dependency-free Node
// script so the gate's logic can be exercised locally (real HTTP, real embedded-Postgres-backed
// apps/api, per DEV-30/32's proven local-full-stack boot recipe) when k6 itself cannot run.
//
// WHY NOT autocannon ALONE: autocannon (an npm-installable real load tool, used from a throwaway
// /tmp install per contract — never added to this repo's package.json/pnpm-lock) hammers a target
// at max throughput from N connections with NO think-time. Real pilot traffic is 25-50 distinct
// farmer PHONES, each pacing requests with idle time between actions (exactly what the k6 scripts'
// own `sleep(Math.random()*2)` models) — not one process blasting thousands of req/s. Because all
// of that traffic looks like ONE source IP to `core/http/rate-limit.guard.ts`'s DEFAULT policy
// (300 req/60s per IP, global, every route), an autocannon max-throughput run trips 429 almost
// immediately — a real, disclosed finding (see dev33_report.md), but NOT a measurement of real
// per-request service latency. This script paces per-VU with think-time AND gives each VU its own
// synthetic source IP via `X-Forwarded-For` (trusted because `TRUST_PROXY_HOPS`/`trust proxy` is
// configured, exactly as a real ALB/nginx in front of staging would present distinct farmer IPs) so
// the rate limiter sees 20-50 distinct low-rate clients, matching the real pilot topology instead
// of a single synthetic firehose.
//
// Zero new dependencies: built-in fetch only.
//
// Usage:
//   BASE_URL=http://127.0.0.1:3100 TOKEN=<jwt> TENANT_ID=<uuid> PRODUCT_ID=<uuid> \
//     VUS=20 DURATION_S=22 SCENARIO=mixed node local-vu-runner.mjs
//
// SCENARIO one of: health | listings | wallet | create | flagoff | mixed (random pick of the first three)
//   health   -> GET  /v1/healthz                (unauthenticated baseline)
//   listings -> GET  /v1/listings                (browse journey, tenant-scoped, authenticated)
//   wallet   -> GET  /v1/wallet/balance           (wallet-read journey, authenticated)
//   create   -> POST /v1/listings                 (listing-create/write journey; body matches the
//                                                   real CreateListingSchema — quantityTotal/unitCode/
//                                                   priceMinor-as-string — a `.strict()` Zod schema,
//                                                   apps/api/src/modules/listings/dto/create-listing.dto.ts)
//   flagoff  -> GET  /v1/insurance/products        (flag-OFF honesty journey; `insurance` defaults OFF
//                                                   for the pilot slice — expects 404, never 500)
//
// Prints one JSON object: { scenario, vus, duration_s, wall_ms, total_requests, ok, non2xx, err,
// error_rate, rps, p50_ms, p95_ms, p99_ms, max_ms, statusCounts }. Compare rps/p95_ms/p99_ms/
// error_rate against the SAME PILOT_P95_MS/PILOT_P99_MS/PILOT_ERR_RATE thresholds `run-pilot-gate.sh`
// uses (800ms / 2000ms / 1%) — see profile.env.example and README.md's threshold table.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const TOKEN = process.env.TOKEN;
const TENANT = process.env.TENANT_ID;
const VUS = parseInt(process.env.VUS || '20', 10);
const DURATION_S = parseInt(process.env.DURATION_S || '20', 10);
const SCENARIO = process.env.SCENARIO || 'mixed';
// db/seeds/catalogue/0101_category_tree.sql — fixed id for the top-level "crops" category
// (same fixed id scripts/local-smoke/smoke.mjs's provisioning uses).
const CATEGORY_ID = '44444444-0000-7000-8000-000000000001';

let seq = 0;
function scenarioReq(vuIp) {
  const headers = { 'x-forwarded-for': vuIp, 'content-type': 'application/json' };
  if (TOKEN) headers['authorization'] = `Bearer ${TOKEN}`;
  if (TENANT) headers['x-tenant-id'] = TENANT;
  const pick = SCENARIO === 'mixed'
    ? ['health', 'listings', 'wallet'][Math.floor(Math.random() * 3)]
    : SCENARIO;
  if (pick === 'health') return { path: '/v1/healthz', method: 'GET', headers };
  if (pick === 'wallet') return { path: '/v1/wallet/balance', method: 'GET', headers };
  if (pick === 'flagoff') return { path: '/v1/insurance/products', method: 'GET', headers };
  if (pick === 'create') {
    seq += 1;
    headers['idempotency-key'] = `pilot-load-${vuIp}-${seq}-${Date.now()}`;
    return {
      path: '/v1/listings', method: 'POST', headers,
      body: JSON.stringify({
        productId: process.env.PRODUCT_ID,
        categoryId: CATEGORY_ID,
        quantityTotal: 10 + (seq % 40),
        unitCode: 'kg',
        priceMinor: String(550000 + (seq % 100) * 100),
        currencyCode: 'INR',
        title: `Pilot load-gate listing ${seq}`,
      }),
    };
  }
  return { path: '/v1/listings', method: 'GET', headers };
}

const latencies = [];
let ok = 0, non2xx = 0, err = 0;
const statusCounts = {};
const expected404 = SCENARIO === 'flagoff';

async function vu(idx) {
  // Synthetic per-VU IP (10.x.x.x) — one distinct simulated farmer device per VU, so the API's
  // per-IP rate limiter (core/http/rate-limit.guard.ts) sees 20-50 low-rate clients, not one firehose.
  const vuIp = `10.${Math.floor(idx / 250) % 250}.${idx % 250}.${1 + (idx % 200)}`;
  const t0 = Date.now();
  while (Date.now() - t0 < DURATION_S * 1000) {
    const { path, method, headers, body } = scenarioReq(vuIp);
    const start = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, { method, headers, body });
      await res.text();
      const ms = performance.now() - start;
      latencies.push(ms);
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      const good = expected404 ? res.status === 404 : (res.status >= 200 && res.status < 300);
      if (good) ok++; else non2xx++;
    } catch {
      err++;
    }
    // Think-time: mirrors the k6 pilot scripts' own `sleep(Math.random()*2)` between iterations.
    await new Promise((r) => setTimeout(r, Math.random() * 2000));
  }
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

const t0 = Date.now();
await Promise.all(Array.from({ length: VUS }, (_, i) => vu(i)));
const wallMs = Date.now() - t0;
const total = ok + non2xx + err;
const errorRate = total ? (non2xx + err) / total : null;
const p95Ms = pct(latencies, 95);
const p99Ms = pct(latencies, 99);

// [QA-FIX 2026-07-29] Threshold enforcement + non-zero exit code, added by independent QA re-run
// (DEV-33 QA pass). Without this block the script only ever PRINTED metrics — every "PASS" verdict
// in dev33_report.md was a manual eyeball comparison by the builder against ops/load-tests/pilot/
// README.md's own thresholds, not something this tool computed or could fail on. Per the binding
// brief's own negative-test requirement ("a gate that can't fail is not a gate"): this now reads the
// SAME PILOT_P95_MS/PILOT_P99_MS/PILOT_ERR_RATE env-var names run-pilot-gate.sh already uses (see
// that script's own `-e PILOT_P95_MS=...` invocation), compares this run's real p95/p99/error-rate
// against them, prints a `thresholds` block, and sets a non-zero process exit code on failure —
// exactly like k6's own threshold engine (and summarize.mjs's `allThresholdsOk` read of a real k6
// summary), so this substitute script can genuinely fail a gate, not just report numbers.
const PILOT_P95_MS = Number(process.env.PILOT_P95_MS || 800);
const PILOT_P99_MS = Number(process.env.PILOT_P99_MS || 2000);
const PILOT_ERR_RATE = Number(process.env.PILOT_ERR_RATE || 0.01);
const p95Ok = p95Ms === null || p95Ms <= PILOT_P95_MS;
const p99Ok = p99Ms === null || p99Ms <= PILOT_P99_MS;
const errOk = errorRate === null || errorRate <= PILOT_ERR_RATE;
const thresholdsOk = p95Ok && p99Ok && errOk;

console.log(JSON.stringify({
  scenario: SCENARIO, vus: VUS, duration_s: DURATION_S, wall_ms: wallMs,
  total_requests: total, ok, non2xx, err,
  error_rate: errorRate,
  rps: total ? +(total / (wallMs / 1000)).toFixed(2) : null,
  p50_ms: pct(latencies, 50), p95_ms: p95Ms, p99_ms: p99Ms,
  max_ms: latencies.length ? Math.max(...latencies) : null,
  statusCounts,
  thresholds: {
    p95_budget_ms: PILOT_P95_MS, p99_budget_ms: PILOT_P99_MS, err_rate_budget: PILOT_ERR_RATE,
    p95_ok: p95Ok, p99_ok: p99Ok, err_rate_ok: errOk, ok: thresholdsOk,
  },
}, null, 2));
if (!thresholdsOk) {
  console.error(`THRESHOLD FAIL: p95=${p95Ms}ms(budget ${PILOT_P95_MS}) p99=${p99Ms}ms(budget ${PILOT_P99_MS}) err_rate=${errorRate}(budget ${PILOT_ERR_RATE})`);
  process.exitCode = 1;
}
