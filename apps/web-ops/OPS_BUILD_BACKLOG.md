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
- [x] **OW-2 · warehouse (18 rows)** ✅ 2026-08-05 — /warehouse (+/[id]): storage-booking lifecycle
      (requested→confirmed→stored→released + cancel, pure state-machine gates; release idempotent w/
      server-settled fee), assay reports (plain-text name=value → typed params), eNWR issue (stored-only,
      NERL/CCRL, float-free valuation, idempotent) + receipt register. SDK: NEW WarehousingResource.
      Canon-row notes: weighbridge = the confirm→store step (weighment precedes 'stored'); stacking +
      per-lot storage-billing detail + wh-insights = server read-models → PC-54 note; assay CERTIFICATE
      file rides reportMediaId (upload wiring with the shared MediaUploader when ops gets one).
- [x] **OW-3 · equipment/CHC + livestock (7 rows)** ✅ 2026-08-05 — /equipment (+/[id]): rental lifecycle
      requested→quoted(advance, float-free)→confirmed(RENTER's device — their consent, their wallet)→
      in_progress(renter's OTP = presence proof)→completed(actual usage)→settled(idempotent, money server-side);
      cancel pre-start; asset register. SDK: NEW EquipmentResource. Canon notes: chc-maintenance = asset
      status toggle (asset lifecycle depth = PC-54 note); chc-insights → OW-6; livestock EAR-TAG LOOKUP =
      API gap (animal registry has no tag-number query param) → PC-54 `livestock-tag-lookup`.
- [x] **OW-4 · dairy POS (11 rows)** ✅ 2026-08-05 — /dairy: record collection (member+shift+weighment+FAT/SNF+
      adulteration flags; SERVER prices every slip from the rate card — POS never computes money; idempotent,
      409→same-slip honesty), member slip lookup (member+range → server-priced amounts), milk bills (generate
      per period → preview[dispute window]→approve→pay idempotent run, only the legal step shows), active rate
      charts. Canon rows pos-shift/slip/quality/exceptions/bmc/rate-chart/payout-run all BUILT (bmc = the MCC
      registry lives in tenant /dairy; ops POS records against memberships).
- [x] **OW-5 · assisted money (3 rows)** ✅ 2026-08-05 — DISPOSITIONED, no code (Ledger Appendix 3): AePS is an
      AMBASSADOR service (profiles.aeps_enabled); the aeps_service_events TABLE exists (0071, RLS-proven) but has
      NO endpoints — and by design it is a LOG only (money moves BANK-side via NPCI, never our ledger). → PC-54
      `aeps-service-events` (controller over the existing table + device/provider wiring at S2). Canon rules
      preserved in the appendix (₹10k bank-set cap, 3-finger retry, no OTP fallback, W392 exceptions taxonomy)
      so the future wave builds exactly to spec. Dashboard keeps 'money' honestly as coming.
- [x] **OW-6 · insights (2 rows)** ✅ 2026-08-05 — /insights: tenant analytics (tenancy/analytics 30-day
      server-computed; 403 → honest permission note) + operational snapshot (status breakdown of the LATEST 50
      per register, labeled as a snapshot never a total; true totals need read-models → PC-54 note).
      **OPS CANON FULLY DISPOSITIONED**: OW-0..6 built/resolved; OW-7 gated on PC-54.
- [ ] **OW-7 · READY** — IoT device fleet + ops alerting. Backend COMPLETE: W54-12 (fleet + breach feed + maintenance alerts) + PC-55 A6 (alert rules CRUD, cadence evaluator, fired feed, acknowledge). Console wave = PC-56 OPS-5.
