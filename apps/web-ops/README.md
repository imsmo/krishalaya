# @krishalaya/web-ops — field-operations console (PC-30)

The ops console for PLATFORM FIELD STAFF: kiosk-assisted farmer onboarding, warehouse (eNWR) operations,
CHC equipment hire, dairy collection POS, assisted payments, and field insights.

**Realm ruling (§C-2, founder-delegated):** ops staff authenticate against the MAIN platform API with
ops-scoped permissions via `@krishalaya/sdk-js`. They NEVER hold admin-api (god-mode) tokens — least
privilege scales to thousands of field staff per country.

Foundation (OW-0): phone-OTP login → httpOnly `kvo_access`/`kvo_refresh` + silent refresh; i18n en/hi/gu
(parity spec-gated — field staff are vernacular-first); sidebar links only to built routes; root
loading/error/not-found boundaries; degrade-never-die reads; money (when waves add it) bigint-minor via
formatMoneyMinor; mutations Server Actions + Idempotency-Key. Build order: `OPS_BUILD_BACKLOG.md`;
binding row-level spec: `Development_Program/CANON_VS_CODE_LEDGER.md` Part 3.

Dev: `pnpm dev` (port 3006) · test: `pnpm test` · env: see `src/lib/env.ts` (fail-closed).
