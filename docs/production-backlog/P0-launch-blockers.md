# P0 — Launch blockers (MUST be done before real users)

These are the things that stand between "runs on my laptop" and "serves real users in production." They split into
**infra/ops** (P0-1…P0-7, can run in parallel, mostly not new code) and **code** (P0-8…P0-13, the missing GA
endpoints + provider adapters). **Paste `00-PRODUCTION-CONTRACT.md` above any code task.**

Legend: **Track** = which part of the system · **Why pending** = the honest reason · **Done when** = acceptance.

---

## Infra, secrets & ops (P0-1 … P0-7)

### P0-1 · Provision production cloud infrastructure
- **Status:** ✅ **BUILT end-to-end** (foundation + deploy + edge). The IaC was scaffold-only; it is now real:
  - **Foundation** — VPC, EKS, Aurora PG16 (writer+reader+PITR), Redis, OpenSearch, S3, KMS+Secrets
    (`infra/terraform/modules/*` + `envs/prod`) → `APPLY-RUNBOOK-prod.md`.
  - **Deploy** — `.dockerignore`, canonical Dockerfiles + `build-and-push.sh`, Helm library chart + 8 service
    charts, IRSA roles (`modules/irsa`) → `DEPLOY-RUNBOOK.md`.
  - **Edge** — Route 53 (krishalaya.com), wildcard ACM TLS, WAF, ALB-controller/external-dns IAM, Helm Ingresses
    (`modules/{dns,acm,waf,alb-edge-iam}` + `_ingress.tpl`) → `EDGE-RUNBOOK.md`.
  - **You run** the three runbooks (apply → deploy → edge) with your AWS account; `curl https://api.krishalaya.com/healthz`
    = 200 closes the "Done when". Remaining optional/deferred items (CloudFront, ESO manifests, dev/staging,
    Phase-2 service charts) are listed in `infra/terraform/PROGRESS-P0-1.md`.
- **Track:** `infra/terraform`, `infra/helm`, `infra/docker`
- **Scope:** Apply Terraform to a real account: managed Postgres 16 (primary + read replica + PITR backups),
  Redis, OpenSearch, S3 buckets, secret manager, VPC/networking, the API gateway. Deploy services via Helm to the
  cluster. Wire DNS + TLS certs. Set `SHARD_COUNT` and cell config for launch size (start at 1/1).
- **Done when:** `terraform apply` is clean and idempotent; all services report healthy in the cluster; a public
  HTTPS health check passes; backups + PITR verified by a test restore.

### P0-2 · Wire real secrets + pass `assertProductionSecurity`
- **Status:** ✅ **BUILT.** (a) Hardened `apps/api` `assertProductionSecurity` — now fails boot on weak JWT/pepper,
  OTP exposure, localhost/superuser/dev-password/non-TLS DB, missing/non-TLS Redis, S3 static keys (IRSA-only),
  non-TLS/unauth OpenSearch, unconfigured/weak payment + provider webhook secrets (22 regression tests, green).
  (b) Closed two real fail-open bugs: the payout webhook + payments gateway no longer fall back to a shared
  `sandbox-secret`, and no sandbox gateway is registered in prod (all gateway env now flows through `AppConfig`).
  (c) External Secrets Operator manifests (`infra/k8s/external-secrets/`) sync Secrets Manager → the k8s Secrets the
  charts consume, via a dedicated ESO IRSA role. (d) `db/prod/{bootstrap-roles.sql,create-roles.sh}` grant the app
  roles LOGIN with strong passwords from Secrets Manager (prod-safe replacement for `local-login-roles.sql`).
  (e) `security-scan.yml` (was a stub) now runs gitleaks + no-tracked-`.env` guard + `pnpm audit`. Full flow in
  `infra/SECRETS-RUNBOOK.md`.
- **Track:** all services, `infra`
- **Why pending:** Local uses dev secrets and `db/local/local-login-roles.sql` (weak passwords, DEV-ONLY). Prod must
  fail closed on any of that. — Now enforced at boot + in CI.
- **Scope:** Put every secret (JWT secrets ≥32 chars, DB URLs for `kv_app`/`kv_wallet`/`kv_relay` with strong
  passwords, `API_SHARED_SECRET`, provider keys) in AWS Secrets Manager; inject at boot. Roles stay least-privilege
  (NOT superuser). Confirm `AUTH_EXPOSE_OTP` is unset and `assertProductionSecurity` refuses to boot on any
  weak/dev/default value. **Never** run `local-login-roles.sql` in prod.
- **Done when:** Services boot only from the secret manager; deliberately injecting a dev/weak secret makes boot
  **fail closed**; no secret is in git or env files; OTP/devCode never appears in any prod response or log.

### P0-3 · Real SMS / OTP provider (login works for real users)
- **Status:** ✅ **BUILT.** Two real adapters behind the `SMS_SENDER` port, selected by `SMS_PROVIDER`:
  `Msg91SmsSender` (Indian **DLT** — sends our self-generated code via a DLT-approved OTP template, so the OTP
  stays hashed-at-rest + single-use on our side) and `TwilioSmsSender` (global free-text fallback). Both are
  `core/resilience`-wrapped and **throw on failure** (no false "sent"); the OTP code is never logged. The port
  gained a templated `sendOtp` (default delegates to `send` for dev/Twilio); both OTP call sites (login +
  change-phone) now use it. `assertProductionSecurity` refuses to boot in prod on `SMS_PROVIDER=noop` or missing
  provider creds. Tests: MSG91 request shape + throw-on-failure + no-code-logged + Twilio + port default (all green).
  Provider keys via Secrets Manager (`infra/SECRETS-RUNBOOK.md`).
- **Track:** `apps/api` (auth) — provider adapter behind the existing SMS port
- **Why pending:** Local uses `NoopSmsSender` (logs `[dev SMS]`). Real users need real texts. — Now wired + gated.
- **Scope:** Implement a real SMS adapter (e.g. an Indian DLT-registered gateway / Twilio) behind the existing SMS
  port, wrapped in `core/resilience`. DLT template registration for OTP. Keep the OTP hashed-at-rest, single-use,
  rate-limited, enumeration-safe behaviour. WhatsApp/voice OTP fallback optional.
- **Done when:** A real phone receives the OTP and completes `verify`; throttle/lockout still enforced; the dev
  noop path is impossible in prod (P0-2).

### P0-4 · Real payment gateway (live Razorpay) + webhook verification
- **Status:** ✅ **Code hardened + provable; live flip is operational.** The pay-in path was already complete
  (signature fail-closed, idempotent, ledger-only, refund reversal). This wave added: a **currency** tamper guard
  (alongside the existing amount guard), idempotency keyed on Razorpay's canonical **`x-razorpay-event-id`** header
  (threaded controller→service; most robust replay dedup), and `currencyCode` on the gateway event (parsed by both
  Razorpay + sandbox adapters). Proof: new `razorpay-gateway.spec.ts` (parse + constant-time signature) and
  integration assertions (capture→zero-sum, **replay-noop via event-id**, **currency-mismatch reject**, **whole-
  ledger nets to zero**). The actual live ₹1 run / webhook registration is operational — fully scripted in
  `apps/api/PAYMENTS-GO-LIVE.md`. `assertProductionSecurity` already blocks boot without live keys / with a weak
  webhook secret, and no sandbox gateway is registered in prod (P0-2).
- **Track:** `apps/api` payments + `wallet-service`
- **Why pending:** Built against Razorpay but never run on **live** keys/webhooks. — Code is now hardened + tested;
  remaining step is the operational live run (runbook).
- **Scope:** Live Razorpay keys in the secret manager; register + signature-verify the live webhook; confirm
  pay-in → wallet ledger credit → settlement → payout (RazorpayX) round-trips with the reconciliation jobs
  (zero-sum). Test refunds/reversals. Verify idempotency on webhook replays.
- **Done when:** A live ₹1 order pays, captures, settles, and reconciles to zero; a forced webhook replay is a
  no-op; refund reverses cleanly; recon job reports balanced.

### P0-5 · Run prod migrations + seed lookups (NOT demo data)
- **Status:** ✅ **Tooling BUILT; the run is one operator command.** Added `db/prod/apply.sh` — a single
  fail-closed, idempotent prod bootstrap: migrate (owner) → partition runway → app-role logins (strong SM
  passwords, P0-2d) → seed **reference** data (core/rules/catalogue) → `verify-rls-coverage` gate → a kv_app probe
  asserting it connects as a non-superuser, non-BYPASSRLS role. Verified offline: 48 migrations plan clean, and the
  seed runner **skips demo under `NODE_ENV=production` even with `--demo`** (0 demo files in the prod plan). The
  `db-migrate.yml` CI gate (real, 51 lines) already proves the schema builds + is idempotent on every `db/**`
  change. Runbook: `db/prod/DB-BOOTSTRAP-RUNBOOK.md`. You run it against the provisioned Aurora (needs the DB).
- **Track:** `db/`, `.github/workflows/db-migrate.yml`
- **Why pending:** Migrations had only run locally. — Now a single controlled, RLS-gated, demo-free prod command.
- **Scope:** Run `pnpm migrate` as the owner role against prod; seed only the **lookup/reference** data
  (`db/seeds/*`, NOT `db/seeds/demo/*`). Create partition runway (`pnpm db:partitions`). Verify
  `verify-rls-coverage.js` reports zero unprotected tenant tables. Confirm the migrate workflow gates on CI.
- **Done when:** Prod DB is fully migrated, RLS-covered, partitioned, seeded with reference data only, and the
  `kv_app` role connects under RLS (not as owner/superuser).

### P0-6 · Observability live + load/soak test at target scale
- **Status:** ✅ **Built; live wiring + soak are operational (cluster-run).** Real code fix: `metrics.prom.ts` now
  emits **valid Prometheus exposition** — names sanitised (dots→underscores), `# TYPE` lines, summary
  quantiles/`_count`/`_sum`, escaped labels (the old dotted names wouldn't scrape). 4 regression tests green.
  Filled every stub: 6 `ops/alerts/*.yml` (PrometheusRule — golden signals, DB, queues, **wallet invariants**, SMS
  budget, business KPIs) + `slo-recording-rules.yml` + `ops/slo.md` (auth/pay/bid/listings SLOs + burn-rate);
  7 real k6 scripts (`ops/load-tests/*` — order-flow, auction-burst, realtime-socket soak, payout-batch, MCC peak,
  72h soak, capacity model); 6 Grafana dashboards (`ops/dashboards/*.json`); `infra/k8s/observability/`
  (kube-prometheus-stack values + ServiceMonitor + Alertmanager→PagerDuty/Slack); filled oncall/capacity docs;
  `infra/OBSERVABILITY-RUNBOOK.md`. Observability TF module → explicit deferral note (lean tier = in-cluster stack).
  All YAML/JSON/JS verified; the install, alert-fire test, and 72h soak run on the cluster (can't be done here).
  Flagged: a few alerts need small `metrics.inc` counters in the jobs (`kv_recon_mismatches`, `kv_outbox_pending`,
  …) — wire as those jobs go live (runbook §"Required app counters").
- **Track:** `ops/dashboards`, `ops/alerts`, `ops/oncall`, `ops/load-tests`, `apps/realtime-gateway`,
  `apps/stream-processor`
- **Why pending:** Dashboards/alerts/load-test scripts were stubs + metrics weren't scrapeable. — Now real + valid.
- **Scope:** Ship metrics/logs/traces to your provider; import the dashboards; arm the alerts; connect on-call
  (PagerDuty). Run the `ops/load-tests` at projected launch load; run the realtime-gateway socket soak and the
  stream-processor broker/DB soak on the cluster. Define + verify SLOs for hot endpoints (auth, pay, bid, listings).
- **Done when:** A synthetic load run holds SLOs; alerts fire on injected faults and page on-call; the soak tests
  pass on the cluster; dashboards show real traffic.

### P0-7 · Security pen-test + DPDP sign-off + DR/backup drill
- **Status:** ✅ **Readiness package built; the engagements themselves are external/process.** Security:
  `docs/security/SECURITY-READINESS.md` (pen-test scope + a control→automated-test coverage map) backed by a
  **green internal pass — 258 security regression tests across 39 suites** (tenant-isolation/RBAC/config/webhook/
  SMS), plus a continuous `dast-zap.yml` OWASP baseline workflow. DPDP: `docs/security/DPDP-COMPLIANCE.md` dossier
  mapping consent/DSR/export/delete/erasure-cooling/retention to real endpoints+jobs+tables, + `db/prod/dpdp-verify.sh`
  live subject-rights check. DR: filled `infra/scripts/backup-verify.sh` (timed PITR restore = RTO evidence) +
  `dr-failover.sh` + `ops/runbooks/restore-drill.md` (RTO ≤60m / RPO ≤5m). Filled all 9 incident runbook stubs.
  The actual pen-test, timed prod DR restore, and legal sign-off are yours to run/commission (can't be done here).
- **Track:** whole platform, `ops/runbooks`
- **Why pending:** Needed an external pass + rehearsed DR + DPDP sign-off. — Readiness + automation now in place.

### P0-9 · Build the worker-runtime host (scheduler) — ⚠️ NEW, discovered during P0-7
- **Status:** 🟡 **Runtime BUILT for operational jobs; domain-handler jobs flagged.** `apps/worker` is now a real
  standalone process (pg, kv_relay, `/metrics`+`/healthz`): fail-closed config, a **pure scheduler core**
  (interval cron + **Postgres advisory leader-lock** so N replicas are safe + failure-isolated runner) with
  **30 unit tests green**, and **6 operational jobs** wired + scheduled — `recon-zero-sum`, `ensure-partitions`,
  `retention-enforcer`, `idempotency-purge`, `dpdp-erasure-cooling`, `outbox-gauge` — each emitting the `kv_*`
  gauges the P0-6 alerts reference. Worker typecheck clean. Doc: `apps/worker/WORKER-RUNTIME.md`. **Closes** the
  P0-5 "retention jobs scheduled" + P0-6 queue/wallet metrics + P0-7 retention/erasure enforcement gaps.
  ⛔ **Remaining (flagged, needs a decision):** the **domain-handler jobs** (outbox relay *execution*, notification
  dispatch/digest/push, settlement generation, mandi/weather ingest, KYC/scheme sync) run handler logic that lives
  in the `apps/api` Nest modules — the standalone worker can't import them. Decision: api runs them on a timer / a
  shared `@krishalaya/domain` lib / a bus consumer (see WORKER-RUNTIME.md). Tracked as **P0-9-follow-on**.
- **Original gap:** The job *logic* was real (in `apps/api` modules) but `apps/worker/` was entirely a scaffold —
  nothing fired on a cadence.
- **Track:** `apps/worker`
- **Scope:** Build the worker bootstrap + a cron/queue scheduler that invokes the existing api-module job classes
  (and the outbox dispatcher) with leader-election/locking (`FOR UPDATE SKIP LOCKED`), metrics, and the
  `kv_*` gauges the P0-6 alerts reference (`kv_recon_mismatches`, `kv_outbox_pending`, `kv_partition_days_ahead`, …).
- **Done when:** the worker runs all scheduled jobs + outbox relay in prod; retention/erasure/partition/recon fire
  on schedule; P0-6 queue/wallet alerts have live series. **Blocks**: P0-5 "retention jobs scheduled", P0-6 queue
  metrics, P0-7 DPDP retention enforcement. Should be done before GA.
- **Scope:** Commission/perform a pen-test against the deployed stack (auth, RBAC/no-escalation, tenant-isolation/
  IDOR, payment/webhook, rate-limits). Rehearse DR: restore from PITR into a fresh env within RTO/RPO. Complete
  DPDP: consent records, data-subject export/delete verified live, retention jobs scheduled, breach runbook.
- **Done when:** Pen-test findings triaged + criticals fixed; a timed DR restore succeeds; DPDP export/delete works
  on a real account and legal sign-off is recorded.

---

## Missing GA endpoints + provider adapters (P0-8 … P0-13)

These un-flag Phase-1 surfaces that are **already built on the client** but show "coming soon" because the backend
endpoint doesn't exist yet. Each is a normal `apps/api` wave (+ SDK + client un-flag). Paste the contract.

### P0-8 · Wallet money-insight endpoints (earnings / spending-insights / autopay) — ✅ DONE
- **Track:** `apps/api` wallet/payments + `packages/sdk-js` + `apps/mobile` (M-W1 screens 58/180/181/182)
- **Why pending:** ~~Mobile wallet screens (earnings, UPI-management, autopay, spending-insights) are built but
  flagged — "no endpoint yet (later API wave)."~~ RESOLVED.
- **Scope:** Read-models over the ledger for earnings aggregate + spending insights (float-free, keyset, replica);
  UPI-mandate / autopay setup via the payment gateway (money still moves only through the ledger). SDK methods +
  un-flag the mobile screens.
- **Done when:** ~~The four screens render real data behind their flag; integration test proves tenant-scoped reads
  and ledger-only money.~~ MET.
- **Delivered:**
  - **8a** — `WalletInsightsReadModel` (`earnings()` credits / `spending()` debits) aggregating the caller's OWN
    wallet ledger float-free (`SUM(...)::text`, replica, anti-IDOR join on `wallet_accounts.owner_user_id`),
    bounded by `resolveWindow` (default ~12mo, clamp ≤ 3y); `GET v1/wallet/earnings` + `v1/wallet/spending-insights`.
  - **8c** — migration `0049_upi_mandates` (tenant_id + RLS, tokenised `provider_mandate_ref` + MASKED `vpa_masked`,
    bigint `max_amount_minor`, status state-machine, optimistic `version`); `Mandate` aggregate + `mandate.state`
    (pending→active→paused→cancelled/expired) + `maskVpa` (raw VPA never stored/logged); `MandateRepository`
    (keyset, anti-IDOR, one-live-per-purpose); `MandateService` (UoW+outbox+idempotency+audit); `AutopayController`
    (`POST/GET/DELETE v1/wallet/autopay`, online_payments flag). **FLAGGED:** auto-debit *collection* still needs a
    UPI-AutoPay PSP + webhook + worker — registering records the standing instruction only.
  - **8b** — SDK `wallet.earnings()` / `spendingInsights()` + `AutopayResource` (register/list/get/cancel) + types
    (`WalletInsights`, `InsightBucket`, `AutopayMandate`); SDK URL-assertion tests (34 green).
  - **8d** — CI-gated integration spec (`wallet-autopay-insights.integration.spec.ts`: float-free earnings,
    anti-IDOR empty view, masked-VPA persistence, mandate cancel, RLS cross-tenant); mobile un-flagged
    (`features/wallet/wallet.api.ts` + new screens `earnings.tsx` 58/180 & `autopay.tsx` 181/182 + hub links +
    en/hi/gu i18n parity). Folded in the pre-existing `market-intel/price.service.spec.ts` fix (MandiPriceService
    7th `names` dep). **api unit: 163 suites / 1031 tests green; SDK: 34 green; tsc clean.**

### P0-9 · Labour clock-out / hours / overtime / work-history + employer dual-confirm — ✅ DONE
- **Track:** `apps/api` labour + SDK + `apps/mobile` (M-W8 screens 138 etc.)
- **Why pending:** ~~Clock-in exists; clock-out, hours/overtime computation, employer dual-confirmation, and worker
  work-history were deferred.~~ RESOLVED (no migration needed — 0008 already carries clock_out_at / break_minutes /
  hours_regular / hours_overtime / confirmed_by_employer).
- **Scope:** Extend the attendance state machine with clock-out + computed hours/overtime; employer confirmation
  step; work-history read-model. Wage settlement stays in the ledger.
- **Done when:** ~~A full attendance cycle (clock-in → clock-out → confirm → settle) works with the state machine
  enforced and unit + RLS integration tests green.~~ MET.
- **Delivered:**
  - **9a** — `attendance.state.ts` (derived state machine `clocked_in→clocked_out→confirmed`, terminal/immutable
    once confirmed) + pure `hours.ts` (`computeHours`: break-aware, 8h standard split into regular/overtime,
    clamped [0,24h], 2-dp rounding) + typed errors + `AttendanceClockedOut`/`AttendanceConfirmed` events.
    Unit-tested (hours edge cases + transitions).
  - **9b** — `AttendanceService.clockOut` (WORKER, own accepted assignment, SERVER-stamped time + computed hours,
    idempotent, guarded by clock_out_at IS NULL) + `confirmDay` (EMPLOYER dual-confirm — booking owner OR a
    booking.manage admin, Law 11; must be clocked-out first; audit row in-tx) + `workHistory` (caller's-OWN keyset
    read-model, anti-IDOR worker-resolve). `AttendanceRepository` extended (getDay / updateClockOut / updateConfirm
    / listForWorker). DTOs (ClockOut breakMinutes, ConfirmAttendance workDate). Routes `POST :id/attendance/clock-out`,
    `POST :id/attendance/confirm`, `GET attendance/history`.
  - **9c** — SDK `labour.clockOut` / `confirmAttendance` / `workHistory` + extended `LabourAttendance` type + URL tests
    (37 green). CI-gated integration spec (`attendance-cycle.integration.spec.ts`): full clock-in→out→confirm cycle,
    SERVER-computed hours persisted, anti-IDOR (foreign worker can't clock out; non-employer confirm → 404), state
    guards (no confirm-before-clock-out, no double clock-out), audit row, RLS cross-tenant. **api tsc clean; labour
    unit 51 green; SDK 37 green.** Wage settlement unchanged — `payWages` still moves money only through the ledger;
    the confirm flag is the gate it reads.

### P0-10 · Push device-token registration endpoint — ✅ DONE
- **Track:** `apps/api` (push) + SDK + `apps/mobile` core/push
- **Why pending:** ~~no device-token registration endpoint yet~~ — registration shipped in API-W3 (migration
  0045 push_devices + entity/repo/dto/`DeviceService`/`devices.controller` + SDK `registerDevice`/`revokeDevice`
  + mobile `syncPushToken`). The REMAINING gap (the real P0-10): the dispatch path delegated push to a generic
  external notifier that never read `push_devices`, so registered tokens were never consumed and no real push
  was sent. RESOLVED.
- **Scope:** Endpoint to register/refresh/revoke a device push token (user-scoped, idempotent), consumed by the
  notification spine. Wrap the push provider in resilience.
- **Done when:** ~~A device registers its token, receives a real push for an inbox notification, and revoke
  works.~~ MET.
- **Delivered:**
  - **10a** — first-party `push-sender.port` (`PUSH_SENDER`) + `ExpoPushSender` (resilience-wrapped: timeout +
    retry + breaker + bulkhead + **fallback** so a hung Expo never throws into the relay tx, Law 12; batches ≤100
    tokens; parses tickets → `DeviceNotRegistered` surfaced as `invalidTokens`) + `NoopPushSender` (dev/`PUSH_PROVIDER=none`).
    `AppConfig.push` (provider/expoBaseUrl/expoAccessToken — token is a provider secret, never logged) + env vars +
    config-bound `pushSenderProvider`.
  - **10b** — `NotificationService.deliver()` now routes the **push** channel through the push sender, reading the
    recipient's OWN active tokens (`push_devices.activeTokensForUser`), sending, and **deactivating dead tokens in
    the same tx** (hygiene); `no_device` → recorded failed (not an error). Other channels keep the generic gateway.
    Unit tests: Expo adapter (parse/batch/prune/degrade/empty) + dispatch branch (sent / no-device / token-prune /
    degraded-failed). **api tsc clean; full api unit 166 suites / 1050 green** (existing notification spec updated:
    its gateway-path assertions now use `sms`, since `push` is first-party). Mobile `syncPushToken` already calls
    the live register endpoint — no client change needed.

### P0-11 · Aadhaar / eKYC provider integration — ✅ DONE
- **Track:** `apps/api` identity (KYC) + SDK + `apps/mobile`/`web-tenant`/`web-partner` KYC surfaces
- **Scope:** eKYC provider adapter behind a port (resilience-wrapped); KYC doc-type lookup endpoint; tokenise
  bank/Aadhaar/PAN refs at the gateway (store only vault refs + last-4, masked). Wire the start/OTP/verify flow.
- **Done when:** A test identity completes eKYC; no raw Aadhaar/PAN/account is ever stored or returned (masked
  only); doc-type picker is populated from the catalogue.
- **Delivered:**
  - `EKYC_PROVIDER` port (`gateway/ekyc-provider.port.ts`): start(rawId)→{providerRef,otpRequired}; verify(ref,otp)→
    {verified, vaultRef, maskedId, nameMatch, validUntil}. Contract: the raw id goes NO further than the adapter —
    never persisted, never logged; the provider returns an opaque vault ref + masked id.
  - Adapters behind it: `HttpEkycProvider` (DigiLocker/UIDAI-aggregator HTTP, resilience-wrapped → timeout+retry+
    breaker+bulkhead, throws `EkycProviderError` 503 on exhaustion — degrade-never-hang, Law 12; verify is NOT
    auto-retried — an OTP submit is single-shot) and `SandboxEkycProvider` (deterministic, fixed OTP `123456`,
    dev/test ONLY). Config-bound via `ekycProviderProvider` from `AppConfig.ekyc` (EKYC_PROVIDER_KIND/URL/API_KEY).
  - **Fail-closed (contract):** `assertProductionSecurity` REFUSES to boot in production when EKYC_PROVIDER_KIND is
    `sandbox` (the fixed-OTP backdoor must never ship) and requires URL + strong API key for a real provider.
  - Pure `id-masking.ts`: Aadhaar **Verhoeff** checksum + PAN regex validation; `maskAadhaar`('XXXXXXXX'+last4),
    `maskPan` (edge-keep), `last4`. Raw ids rejected BEFORE any provider call (anti-abuse).
  - Migration `0050_ekyc_sessions.sql`: `ekyc_sessions` (tenant_id + RLS, masked_id + last4 + provider_ref + attempts
    + status pending→verified|failed|expired, **NO raw-id column**); relaxes `kyc_documents.media_id` NOT NULL (an
    eKYC verification has no uploaded image — the provider attestation is the proof).
  - `EkycService` start/verify: validate→provider→persist masked-only session (anti-IDOR: verify re-resolves by
    session id AND caller; non-owner → 404); on success writes the vault ref + last-4 to `users.*`, a VERIFIED
    `kyc_documents` row (verify_method=`ekyc:<provider>`, media-less), flips `utr.kyc_status`, audits + outboxes
    `identity.ekyc_verified` IN-TX; wrong OTP counts an attempt and locks at 3 (429). `kyc/ekyc/start|verify` routes
    (Idempotency-Key required, `kyc` flag) + `kyc/ekyc/sessions`. SDK `kyc.startEkyc/verifyEkyc/ekycSessions`.
  - **Tests:** id-masking + session-state unit; `EkycService` unit (happy/wrong-OTP/cap/IDOR); SDK URL-assertion;
    CI-gated integration `ekyc-cycle.integration.spec.ts` (sandbox: start→verify(123456)→user vault ref + last-4 set,
    KYC verified, anti-IDOR, wrong-OTP, **NO raw Aadhaar in users/sessions/kyc/audit/outbox**). api unit 169 suites /
    1072 tests green; api tsc + SDK tsc/jest green.

### P0-12 · Geocoded weather forecast provider — ✅ DONE
- **Track:** `apps/api` land-soil-weather + SDK + `apps/mobile` (M-W11)
- **Scope:** Weather/forecast provider adapter behind a port (resilience-wrapped, cached); geocoded forecast
  endpoint; advisory-push job. Un-flag the mobile weather forecast surface.
- **Done when:** A lat/long returns a real forecast through the cached, resilient adapter; degrades to regional
  advisory if the provider is down (never fabricates).
- **Delivered:**
  - `WEATHER_FORECAST` port (`land-soil-weather/gateway/weather-forecast.port.ts`): `fetch(lat,lng,days)` →
    normalised `ForecastDay[]` (temps °C, precip mm, prob 0-100, wind km/h, normalised condition).
  - Adapters: `HttpWeatherForecastProvider` (Open-Meteo by default — free, no key; an IMD/Skymet aggregator drops in
    via URL + key), resilience-wrapped (timeout+retry+breaker+bulkhead) → throws `WeatherProviderUnavailableError`
    (503) on exhaustion, NEVER invents numbers; `NoopWeatherForecastProvider` (always throws → forces advisory
    fallback). Config-bound via `weatherForecastProvider` from `AppConfig.weather` (WEATHER_PROVIDER_KIND/URL/API_KEY
    + cache TTL + days).
  - Pure `domain/forecast.ts`: lat/lng validation, grid-rounded GLOBAL cache key (shared across tenants — weather at
    a coord is reference data, caps provider cost), WMO→condition map, Open-Meteo daily normaliser, agronomy-signal
    derivation. Unit-tested.
  - `ForecastService` (cache-aside read-through; caches only successes): `GET land/weather-forecast?lat&lng[&days]
    [&regionId]`. On provider-down it **degrades to the region's real advisories** (`degraded:true`) when a regionId
    is given, else surfaces 503 — a forecast is NEVER fabricated.
  - `WeatherAdvisoryPushJob` (worker, Nest-injectable): emits one `land.weather_advisory_active` outbox event per
    newly-active alert, idempotent (dedups against existing outbox rows) + bounded (LIMIT). The communication
    pipeline fans it out per the region's users.
  - SDK `weather.forecast(lat,lng[,regionId])` + `ForecastResult/ForecastDay/NormalisedForecast` types. Mobile:
    `weatherForecast`/`defaultLatLng` data layer + the weather screen now shows the real 5-day forecast (with a
    degrade-to-advisory note) under the `mandi_weather` flag.
  - **Tests:** pure forecast helpers + `ForecastService` (cache hit / fetch+cache / degrade-to-advisory / 503-no-
    region) unit; SDK URL-assertion; CI-gated integration `weather-forecast.integration.spec.ts` (real Postgres:
    degrade-to-advisory + advisory-push idempotency). api unit 170 suites / 1081 tests green; api+mobile tsc + SDK
    tsc/jest green.

### P0-13 · Decommission all dev-only affordances for prod — ✅ DONE
- **Track:** whole platform
- **Scope:** Audit every dev/no-op/degrade path; ensure each is gated by `NODE_ENV`/config and fails closed in
  prod; remove demo seed loading from prod pipelines; confirm `assertProductionSecurity` covers them.
- **Done when:** A prod-config boot with any dev affordance enabled **refuses to start**, and a clean prod boot
  exposes none of them (verified by a test).
- **Delivered:**
  - Full audit → `docs/production-backlog/P0-13-dev-affordances-checklist.md` (one row per affordance + how each
    fails-closed + which guard enforces it). Most were already covered (OTP-expose, sandbox pay-in/payout, eKYC
    sandbox, SMS-noop + dev-SMS log, S3 static keys/LocalStack, DB/Redis localhost, demo-seed `NODE_ENV` gate).
  - **Closed two boot-time gaps** in `assertProductionSecurity`: `MEDIA_SCAN_SECRET` must be strong (else the AV
    scan-result webhook can never clear a file — now caught at boot, not first upload) and `PAYMENTS_DEFAULT_PROVIDER`
    must not be `sandbox` (no fake money rail as default).
  - **Hardened demo-seed loading**: `seed.js` now skips `--demo` not only when `NODE_ENV=production` but ALSO when
    `DATABASE_URL` looks like a managed/cloud endpoint (amazonaws/rds/azure/cloudsql/neon/supabase/render) — demo
    data can never land in a prod DB even if `NODE_ENV` is mis-set.
  - **Tests:** `app-config.security.spec` gains a case per gap (prod boot throws) + retains the clean-boot-OK case;
    full api unit suite **170 suites / 1084 tests green**, api tsc green.

---

## What P0 deliberately excludes
- SDK/read-model polish that only hides a button → **P1**.
- Insurance, role apps, IVR/WhatsApp → **P2**.
- Sharding/cells execution + Phase-3 → **P3**.

> When P0-1…P0-13 are all done, you can serve real users. Do **P1** next for a clean, fully un-flagged GA.
