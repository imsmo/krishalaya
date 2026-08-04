# Security readiness — pen-test scope, coverage map, findings register (P0-7)

The external pen-test is a process step (commission a firm against the deployed staging stack). This document is
the **readiness package** that makes that engagement fast and verifiable: the scope, the automated coverage that
already proves the high-risk controls, the DAST that runs continuously, and the register to track findings.

> Internal evidence (run any time): the security regression subset is **green** — 258 tests across 39 suites
> (`tenant-isolation` ×N, `rbac-security`, `app-config.security`, `otp.service`, `razorpay-gateway`, `sms-provider`).
> Command: `cd apps/api && pnpm test:unit --testPathPattern "tenant-isolation|rbac-security|app-config.security|otp.service|razorpay-gateway|sms-provider"`.

---

## 1. Pen-test scope (give this to the firm)

Target: the deployed **staging** stack (identical IaC to prod) at `https://api.krishalaya.com` (staging host) + the
web apps + the admin plane. Test as: anonymous, a normal tenant user, a second tenant's user, and a tenant admin.

| Area | What to probe |
|------|---------------|
| **AuthN** | OTP brute force / enumeration, JWT forgery (alg-confusion, iss/aud), refresh-token theft/rotation, session fixation |
| **AuthZ / RBAC** | privilege escalation, assigning platform/owner roles via the tenant API (Law 11), `*` grant, staff overrides granting money/god perms |
| **Tenant isolation / IDOR** | access another tenant's order/listing/payment by id; confirm **404 not 403** (no enumeration) |
| **Payments/webhooks** | forged webhook signature, replay, amount/currency tamper, race double-capture |
| **Input** | mass-assignment (extra keys), SQLi, ReDoS in regexes, oversized payloads |
| **Abuse/DoS** | rate-limit bypass, unbounded lists, write-amplification |
| **PII** | leakage of Aadhaar/PAN/bank (must be masked / vault-ref only), PII in logs/errors |
| **Edge** | WAF bypass, TLS config, security headers, CORS |

## 2. Automated coverage map (already proven — the pen-test confirms, doesn't discover)

| Control | Proven by |
|---------|-----------|
| Tenant isolation / RLS denial | 107 `*/__tests__/tenant-isolation.spec.ts` + `verify-rls-coverage.js` (zero unprotected tenant tables) |
| RBAC no-escalation, no `*`, platform roles not tenant-assignable | `identity/__tests__/rbac-security.spec.ts` |
| Fail-closed prod config (weak secret/DB/Redis/S3/payment/SMS) | `core/config/__tests__/app-config.security.spec.ts` (22) |
| OTP throttle / lockout / enumeration-safe | `identity/__tests__/otp.service.spec.ts` |
| Webhook signature fail-closed + amount/currency tamper + replay | `payments/__tests__/razorpay-gateway.spec.ts` + `payments.integration.spec.ts` |
| No raw OTP/SMS code logged | `core/auth/__tests__/sms-provider.spec.ts` |
| Valid, non-leaking metrics exposition | `core/observability/__tests__/metrics.prom.spec.ts` |
| Mass-assignment closed | every DTO is `zod.strict()` (module unit suites) |

## 3. Continuous DAST
`.github/workflows/dast-zap.yml` runs an OWASP ZAP baseline scan against staging on a schedule + before each
prod deploy. It's a non-blocking signal that complements (not replaces) the commissioned pen-test.

## 4. Findings register (fill during/after the engagement)

| ID | Date | Severity | Area | Finding | Status | Fix / PR | Re-tested |
|----|------|----------|------|---------|--------|----------|-----------|
| _PT-001_ | | | | | open | | |

**Go-live gate:** every **critical/high** finding is fixed + re-tested (with a regression test added to the suite
above), and mediums are triaged with owners/dates. Record the firm's sign-off (date, scope, report link) here.
