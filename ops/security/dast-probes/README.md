# ops/security/dast-probes — DEV-34 honest OWASP-baseline probe suite

## Why this directory exists (read before running anything)

DEV-34's binding brief required executing a real OWASP ZAP DAST baseline against the local full-stack
boot and triaging every finding to zero HIGHs. **A real ZAP binary was not obtainable in this sandbox**
within the bounded ~20-minute effort the brief allowed — see `dev34_report.md` §1 for the exact,
pasted evidence (no `zap.sh`/`docker` on PATH; `java` present but unused since no ZAP jar exists;
`https://api.github.com/repos/zaproxy/zaproxy/releases/latest` and the direct release-asset download
both returned connection failures / `403 Forbidden … X-Proxy-Error: blocked-by-allowlist` from this
sandbox's own egress proxy; the npm registry IS reachable, but no npm-installable package provides a
real DAST engine equivalent to ZAP's baseline scan — `retire` is a dependency-vulnerability scanner,
not an HTTP prober; `observatory-cli` calls a third-party hosted service and needs a publicly-reachable
target, not a localhost boot).

This directory is the honestly-labelled fallback the brief explicitly sanctioned for that case: a
hand-written probe suite covering the SAME finding classes ZAP's baseline scan actually checks
(`Development_Program/S5_ZAP_BASELINE_RUNBOOK.md` §4's predicted-findings list +
`krishalaya/docs/security/SECURITY-READINESS.md` §1's pen-test scope table), run against a real,
unmodified, locally-booted `apps/api` (the DEV-32 live-boot recipe).

**What this IS NOT:** a ZAP replacement, an active-scan fuzzer, a spider, or a claim of ZAP-equivalent
plugin coverage. It is 30 targeted, hand-authored checks with an explicit request/expected/actual/verdict
row each — see `dev34_report.md` for the full probe table and findings register.

## Files

- `probe-suite.mjs` — the real suite. Zero new npm dependencies (Node's built-in `fetch` only). Takes
  `BASE_URL` (target), optionally `TOKEN_A`/`TOKEN_B`/`OTHER_TENANT_LISTING_ID`/`ALLOWED_ORIGIN` env vars
  for the authenticated/cross-tenant checks, and `OUT_JSON` to write a machine-readable result file.
  Exit code is non-zero if any probe with a hard-requirement verdict FAILs — this is a real gate, not a
  suite that can only ever print PASS (see the negative-test below).
- `vulnerable-stub.mjs` — a DELIBERATELY-INSECURE local HTTP stub, used ONLY to negative-test
  `probe-suite.mjs` itself (DEV-33's own standing lesson: "a gate that can't fail is not a gate"). Never
  boot this anywhere real; it ships no route the real `apps/api` has and exists purely as a fixture.

## Usage

```bash
# against a real, already-booted apps/api (any boot method: docker, embedded-PG, staging):
BASE_URL=http://localhost:3910 \
  TOKEN_A=<tenant-A JWT> TOKEN_B=<tenant-B JWT> OTHER_TENANT_LISTING_ID=<a tenant-A listing id> \
  ALLOWED_ORIGIN=https://tenant.staging.krishalaya.com \
  OUT_JSON=/tmp/probe-result.json \
  node ops/security/dast-probes/probe-suite.mjs

# negative-test proof (no DB/API needed):
node ops/security/dast-probes/vulnerable-stub.mjs &
BASE_URL=http://localhost:9199 node ops/security/dast-probes/probe-suite.mjs --skip-db
```

If `TOKEN_A`/`TOKEN_B`/`OTHER_TENANT_LISTING_ID` are not supplied, the auth-dependent probes (JWT
tampering against a real token, cross-tenant IDOR, injection/mass-assignment on an authenticated write
route) are recorded as `ACCEPT`/skipped with an explicit reason, never silently omitted from the tally.

## Coverage map (probe id → what it proves)

| Probe ids | ZAP/DAST class | What it proves |
|---|---|---|
| HDR-1..8 | 10038 CSP, 10035 HSTS, 10020 anti-clickjacking, 10021 X-Content-Type-Options, banner disclosure | Security response headers |
| COOKIE-1 | 10054/10055 cookie flags | No non-HttpOnly/Secure/SameSite session cookie ever set |
| CORS-1..3 | CORS misconfiguration | Origin reflection, credentials+wildcard, correct allowlist echo |
| ERR-1..2 | verbose error/stack-trace leakage | No stack/path leak in error bodies |
| METHOD-1..2 | HTTP method tampering | TRACE/OPTIONS handled safely |
| TRAV-1 | path traversal | Encoded traversal in an id segment doesn't reach the filesystem |
| REDIR-1 | open redirect | Structural absence check (no `res.redirect` call site) |
| RATE-1 | rate-limit presence | `RateLimitGuard` genuinely enforces 5/60s/IP on `/v1/auth/otp` |
| PII-1 | PII leak (Law 10) | No Aadhaar/PAN/bank-shaped value in an OTP response body |
| JWT-1..4 | JWT tampering | alg:none, signature-strip, payload-tamper, expiry all rejected |
| AUTHZ-1..3 | auth bypass / IDOR / tenant-header spoofing | No-token 401; cross-tenant 404 not 200; spoofed `x-tenant-id` cannot override the JWT's own tenant claim |
| INJ-1..3 | SQLi / NoSQLi-shaped / XSS smoke | Parameterized queries, Zod schema rejection, stored-not-executed |
| MASS-1 | mass assignment | Zod `.strict()` rejects unrequested fields |

## Honesty notes carried from the real run (2026-07-29)

- Redis absent (`REDIS_URL=''`, the DEV-32 local-boot recipe) does **not** make `RateLimitGuard` fail
  open — `core/core.module.ts`'s cache factory falls back to a real, working `InMemoryCacheService`
  whose `.incr()` does not throw. RATE-1 passed genuinely (confirmed `429` after 5 requests). See
  `dev34_report.md` for the full correction of this probe suite's own first-draft assumption.
- Probe ORDER matters: `probeInjection` (which sends one `/v1/auth/otp` call for the NoSQLi-shaped
  check) must run before `probeRateLimit` (which deliberately exhausts that same endpoint's 5-req/60s
  budget) — the first execution of this suite got this wrong and produced a self-inflicted false-positive
  FAIL; fixed by reordering (`main()`'s call order), disclosed in `dev34_report.md`.

## Coverage gaps [QA-FIX 2026-07-29 — noted during DEV-34 QA, not fixed here]

- **Directory listing (ZAP 10033-class) has no probe here and no ACCEPT entry** — unlike REDIR-1 (open
  redirect), which carries an honest "structurally n/a" record, directory-browsing was simply absent from
  this suite and from the coverage map above. Verified by QA (grep, 2026-07-29): `apps/api` has zero
  `express.static`/`serveStatic` call sites, so there is no static-file-serving surface for a directory-
  listing finding to exist against — the omission carries no live risk, but the coverage map should say so
  explicitly rather than being silent. Recorded here rather than fixed as a new probe (nothing to assert
  against).
- **This suite only ever targets `apps/api`.** `apps/admin-api` (a separate deployable Nest app, its own
  `AdminConfig`/`assertProductionSecurity`, its own `admin-auth.guard.ts`/`hardware-key.guard.ts`/
  `step-up-reauth.guard.ts` — the highest-blast-radius "god-mode plane" per Law 11) and `apps/wallet-service`
  (a separate gRPC-only service, not an HTTP/ZAP-baseline target at all) were never probed by this batch, in
  any environment. `.zap/AUTH-CONTEXT.md`'s exclusion of `admin.staging` from a REAL, EXTERNAL ZAP scan
  (IP-allowlist making an external scanner low-signal) is a reasonable call for that specific context, but
  does not by itself justify admin-api's total absence from this LOCAL, hand-written probe pass, where no
  IP-allowlist applies. Escalated (not fixed here — would require its own local boot + fixture work): see
  `dev34_report.md`'s QA addendum / `DEV_TRACKER.md` DEV-34 QA STATE BLOCK for the full finding.
