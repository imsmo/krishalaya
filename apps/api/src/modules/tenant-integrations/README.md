# tenant-integrations (tenant provider connections · P1-11 → PC-56 TENANT-13c)

A tenant admin connects its **own** credential for a provider the platform lets a tenant own (`integration_providers.tenant_ownable`:
razorpay, gupshup, inaph). Platform-managed providers (agmarknet, pfms, pmkisan, ikhedut, msg91, razorpayx, sandbox) are refused by
name. The platform-wide catalogue and god-mode provisioning live in `apps/admin-api` providers-ops (Law 11).

**What is true today:** a connection is stored, verified and re-verified daily — and read by **no** platform path. Payments run on
the platform's Razorpay account and SMS on the platform's route (`domain/provider-rules.ts` `INTEGRATION_CONSUMERS` is empty for every
provider, and a unit spec pins the only files that may inject `SECRET_READER`). The console never says "active"; "direct settlement to
your own account" is refused by name (a payments change, Law 9, its own wave).

## Routes (`/v1/integrations`, `tenancy` flag; every route — reads included — needs `api.manage` OR `tenant.settings`)
- `GET /providers` — the catalogue, each provider `ownable` or `managed`, `verifiable` when a verification endpoint is configured.
- `GET /` — connections (status `verified` / `verify_failed` / `disconnected` / `unverified`, masked ref `…••41`, non-secret config,
  Health (24 h) = count of verification checks + last OK, consumers), providers, open proposals, the count.
- `POST /preview` — the review (no provider call, nothing stored).
- `GET /proposals`, `GET /proposals/:id` — µs keyset.
- `POST /proposals` (Idempotency-Key, reason 20–500) — connect / rotate / disconnect. A credential is **verified in shadow at once**; a
  failure stores nothing anywhere (`INTEGRATION_VERIFY_FAILED` with its class auth / network / unknown). On success it is held
  **envelope-sealed on the proposal row** (bound to it; wiped when the proposal closes) — not vaulted.
- `POST /proposals/:id/confirm` (Idempotency-Key) — a DIFFERENT active tenant_admin (0193 `trg_ip_moves`). The credential is verified
  **again**; only then vaulted as a new versioned secret; the connection written in the transaction that closes the proposal `applied`
  (0193 `trg_tenant_integrations_gate` refuses any other write); the old secret retired after commit (zero-downtime rotation). A failed
  verify closes it `verify_failed`: nothing vaulted, nothing written, the old credential still serving.
- `POST /proposals/:id/refuse` (Idempotency-Key, reason).

## Jobs
- `tenant-integrations-daily-reverify` (hourly tick; connections last checked ≥ 24 h ago) — the only reader of the vault.
- `tenant-integration-proposals-clock` — 7-day expiry; a confirmation not applied within 15 minutes closes `verify_failed` ("interrupted").

## Security
- Raw credentials are NEVER stored in our DB in clear, logged, audited or returned. The vault (`core/secrets`) is AWS Secrets Manager in
  production (boot fails closed otherwise) and an in-process store in development.
- The verifier (`infra/provider-verifier.ts`) uses the 13a transport discipline: the SSRF guard, the socket pinned to the vetted
  address, no redirects, 10 s, a 64 KiB read cap; wrapped in core/resilience. INAPH has no configured verification endpoint, so an INAPH
  credential cannot be verified and is refused by name.
- Schema: 0002 + 0193 (`integration_proposals`, `integration_verify_checks`, the provider allow-list columns, the connection gate).
