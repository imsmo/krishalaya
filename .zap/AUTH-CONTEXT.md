# .zap/AUTH-CONTEXT.md — DEV-34: authenticated ZAP baseline config (target, auth flow, scope, CI proposal)

**Ties to:** `Development_Program/S5_ZAP_BASELINE_RUNBOOK.md` (the founder-facing runbook this file
extends, not duplicates — §0/§1/§3 there stay the source of truth for how to TRIGGER a scan),
`.zap/rules.tsv` (rule tuning), `.github/workflows/dast-zap.yml` (the existing, correctly-wired
workflow — **not modified this batch**, see §4 "CI-wiring proposal" below for why).

`zap-baseline.py` (and the `zaproxy/action-baseline` GitHub Action that wraps it) is an **unauthenticated**
passive+light-active baseline scanner by default — it browses/spiders the target as an anonymous visitor.
Everything it finds today (`.zap/rules.tsv`'s existing entries + this batch's additions) is genuinely
useful, but it structurally CANNOT reach anything behind `AuthGuard` (every `/v1/*` route except the small
`@Public()` set — browse/search, health, auth/otp+verify+refresh). That means ZAP's baseline scan alone
never exercises the IDOR/cross-tenant/mass-assignment/JWT-tampering surface this codebase's own security
posture actually depends on. This file documents how to point ZAP at an AUTHENTICATED session so the
baseline scan's spider can walk the real, RBAC-gated surface too.

## 1. Target URL (unchanged from the existing runbook)

`https://api.staging.krishiverse.ai` (default in `dast-zap.yml`, override via `workflow_dispatch` input
for the web apps — see the S5 runbook §1 for the exact host list). This file adds nothing here; it is
correct as-is.

## 2. Auth context — how ZAP authenticates as a tenant user (the real OTP → JWT flow)

This platform has **no password, ever** — the only login primitive is phone-OTP (`Development_Program`
canon: "phone-is-the-account... no-password-ever"). ZAP's built-in "form-based auth" and "JSON-based auth"
context types assume a username/password POST; neither fits this flow directly. The two real options,
both verified against the actual controller (`apps/api/src/modules/identity/controllers/v1/auth.controller.ts`):

### Option A (recommended for a staging DAST run) — pre-minted token via ZAP's Replacer

1. **Outside ZAP**, mint a real session the same way `scripts/staging-smoke/` does: a human (or a CI step
   with SMS access) requests an OTP for a dedicated, ALREADY-CONSENTING **test tenant user** seeded for
   this purpose (never a real farmer/buyer's phone), receives the real SMS code, and calls
   `POST /v1/auth/verify` to get a real `accessToken` (JWT, 15-min TTL by default —
   `JWT_ACCESS_TTL_SEC=900`). Store it as a CI secret (`ZAP_AUTH_TOKEN`), rotated per run (it's short-lived
   by design — a stale token just means the authenticated portion of the spider sees 401s, degrading
   gracefully to the same coverage as an unauthenticated run, never a false "still working" signal).
2. Add a ZAP **Replacer rule** via `-z` additional command-line options to `zap-baseline.py` (the same
   mechanism `dast-zap.yml`'s `cmd_options` already uses for `-I -a`):
   ```
   -z "-config replacer.full_list(0).description=auth
        -config replacer.full_list(0).enabled=true
        -config replacer.full_list(0).matchtype=REQ_HEADER
        -config replacer.full_list(0).matchstr=Authorization
        -config replacer.full_list(0).regex=false
        -config replacer.full_list(0).replacement=Bearer\ ${ZAP_AUTH_TOKEN}"
   ```
   This injects `Authorization: Bearer <token>` on every request ZAP makes, exactly the header shape
   `core/auth/token.service.ts`/`AuthGuard` expect — no ZAP "authentication script" plugin needed.
3. **Tenant header:** most routes resolve `tenant_id` from the JWT's own `tid` claim (Law 1 — never
   trusts a client-supplied tenant id alone), so no extra header is required for the token to work. Add
   a SECOND replacer entry only if you want to additionally exercise the `x-tenant-id` spoofing surface
   deliberately (see `ops/security/dast-probes/probe-suite.mjs`'s `AUTHZ-3` probe, which already does this
   HTTP-level check outside ZAP).

### Option B — a short-lived ZAP-driven login script (if CI can reach a real SMS provider)

If the staging environment's SMS provider IS reachable from the CI runner (unlike this sandbox), a ZAP
"Script-Based Authentication" script can call `POST /v1/auth/otp` then poll an SMS-retrieval side-channel
for the code and call `POST /v1/auth/verify` — genuinely more realistic, but adds an SMS-retrieval
dependency Option A avoids. Not implemented here (Option A is sufficient and simpler); flagged as a future
enhancement if the founder wants full auth-flow-in-ZAP fidelity.

**Never** use `AUTH_EXPOSE_OTP=true`'s `devCode` degrade path (this batch's own local-boot mechanism) against
a real staging/prod host — that flag is fail-closed in production by `AppConfig` (per `env.validation.ts`'s
own comment: "MUST be false in prod") and does not exist as an option there at all.

## 3. Scan scope / exclusions

- **In scope (active + passive):** all `/v1/*` browse/read/write routes reachable from the authenticated
  session above, EXACTLY the surface `SECURITY-READINESS.md` §1's pen-test scope table already names
  (AuthN, AuthZ/RBAC, tenant isolation/IDOR, input, abuse/DoS, PII, edge).
- **Excluded from ACTIVE scan (fuzzing), passive scan still runs:** `/v1/payments/**`, `/v1/payouts/**`,
  `/v1/wallet/**`, `/v1/invoices/**`, `/v1/settlement-statements/**`, `/v1/commission-rules/**` — the SAME
  route-prefix set `security-headers.middleware.ts`'s own `NO_STORE_PREFIX` regex already names as
  money-adjacent. **Justification (Law 2 — money is append-only, adversarial-test-not-fuzz):** ZAP's
  active scan sends malformed/boundary-value payloads at every discovered parameter; against a real
  payment-intent or payout-execution endpoint on a REAL staging environment (not this local-full-stack
  boot), that risks creating genuine ledger rows or triggering the sandbox-gateway webhook path
  repeatedly — safer, more targeted adversarial coverage of exactly this surface already exists as
  hand-written tests (`payments/__tests__/razorpay-gateway.spec.ts`, `payments.integration.spec.ts` per
  `SECURITY-READINESS.md` §2) and as this batch's own `ops/security/dast-probes/probe-suite.mjs` (INJ-1..3,
  MASS-1, run against a throwaway local boot where extra ledger rows cost nothing). A DAST *spider* still
  walks these routes (so a HIGH like "auth bypass on `/v1/wallet/balance`" would still be caught passively
  — AUTHZ-class alerts fire on the plain GET, no fuzzing required); only the ACTIVE (attack-payload) scan
  mode is excluded for this route set. Configure via `zap-baseline.py -e <exclusions-file>` (URL-regex list)
  or the `-c` context's own exclude-regex — not yet added to `.github/workflows/dast-zap.yml` (see §4).
- **Excluded entirely (per the existing S5 runbook §0, re-confirmed, not re-litigated):** `admin.staging`
  — sits behind IP-allowlist + hardware-key guards; an external scanner mostly gets 403s (low signal) and
  risks tripping the allowlist's own abuse detection. Leave to the commissioned pen-test (P0-7).

## 4. CI-wiring proposal (PROPOSAL ONLY — `.github/workflows/dast-zap.yml` NOT modified this batch)

The DEV-34 row does not instruct wiring a new CI step (it instructs executing the DAST baseline +
triaging + confirming the regression suite), so per the governing gate ("CI untouched unless the row says
wire it") this stays a proposal:

```yaml
# ADD to .github/workflows/dast-zap.yml's existing `zap-baseline` job, as a second step (not a replacement):
      - name: ZAP baseline scan (AUTHENTICATED pass)
        uses: zaproxy/action-baseline@v0.12.0
        with:
          target: ${{ github.event.inputs.target || 'https://api.staging.krishiverse.ai' }}
          rules_file_name: .zap/rules.tsv
          cmd_options: >-
            -I -a
            -z "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true
                -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization
                -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ ${{ secrets.ZAP_AUTH_TOKEN }}"
```

Requires a new repo secret `ZAP_AUTH_TOKEN` (a short-lived test-tenant JWT, rotated by whoever owns the
staging test-tenant credential — founder/infra decision, not made here per contract §8's "secrets" escalation
rule). Left as a proposal, not applied, exactly like DEV-33's own CI-wiring proposal (`dev33_report.md` §8)
for the same reason: adding a new CI secret + workflow step is an infra/founder decision this batch does not
make unilaterally.

## 5. What this batch actually executed (see `dev34_report.md` for the full account)

No real ZAP binary was obtainable (bounded effort, evidence in `dev34_report.md` §1) — this file documents
the config that a founder/CI WOULD run once a real ZAP binary/Action is reachable; it was verified for
internal consistency (the header/route names above are grep-true against the current codebase, not
invented) but not executed against a live ZAP process this batch. The EXECUTED DAST pass this batch used
`ops/security/dast-probes/probe-suite.mjs` against a real local-full-stack boot instead — see that
directory's README + `dev34_report.md` for the full probe table.
