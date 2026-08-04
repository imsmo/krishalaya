# web-ops — build backlog (PC-30, ops console for platform field staff)

**Status today.** OW-0 ✅ (this scaffold): Next.js 14 App Router on the MAIN platform API via `@krishalaya/sdk-js`
(§C-2 ruling: ops staff hold ops-scoped permissions — NEVER admin-api / god-mode tokens). Phone-OTP login
(`kvo_access`/`kvo_refresh` httpOnly cookies + silent refresh + `requireSession`), full i18n en/hi/gu (35-key
parity, spec-gated), shell (sidebar links ONLY to built routes), root loading/error/not-found boundaries,
DataTable, jest (safe-next + parity). Dashboard shows the honest wave map.

**The binding spec** is `Development_Program/CANON_VS_CODE_LEDGER.md` Part 3 (FLOWMAP_ops register): 51 dev-owed
rows — 45 BACKEND-READY, 6 gated on PC-54 (`iot-device-fleet`, `ops-alerting`).

## Waves (one per session, `Yes start PC-3x`; each adds its sidebar entry when it ships)
- [x] **OW-0 · foundation** — this scaffold.
- [x] **OW-1 · kiosk (4 rows)** ✅ 2026-08-05 — /kiosk: create the farmer's account (users.create, idempotent,
      409→'already exists' honesty) + the GUIDED HANDOFF checklist. CONSENT RULING: KYC + first listing happen in
      the FARMER'S OWN session (assisted, never impersonated — no on-behalf writes; an `assisted-onboarding`
      on-behalf surface would be a PC-54 decision). Canon rows kiosk-home/profile → BUILT; kiosk-kyc/first-listing
      → resolved by the handoff design (farmer-session actions, mobile/storefront already built).
- [ ] **OW-2 · warehouse (18 rows)** — warehousing api: eNWR issue/registry, weighbridge, assay lab + certificate,
      stacking, storage billing, wh dashboard/insights.
- [ ] **OW-3 · equipment/CHC + livestock (7 rows)** — equipment api bookings/maintenance/insights; livestock ear-tag scan.
- [ ] **OW-4 · dairy POS (11 rows)** — dairy api: collection shifts, slips, quality, exceptions, rate charts, pay runs.
- [ ] **OW-5 · assisted money (3 rows)** — fintech AePS receipt + withdrawal (provider-wired at S2).
- [ ] **OW-6 · insights (2 rows)** — analytics reads.
- [ ] **OW-7 · GATED** — IoT device fleet + ops alerting (PC-54 modules first).
