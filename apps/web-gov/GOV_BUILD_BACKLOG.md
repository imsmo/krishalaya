# web-gov — build backlog (PC-40, government/regulator console)

**Status.** GW-0 ✅ (2026-08-05): Next.js 14 scaffold on the MAIN platform API (§C-3 ruling: gov-persona scoped
tokens — read + AUDIT-STAMPED-EXPORT heavy; never god-mode). Phone-OTP auth (kvg_* cookies + silent refresh),
i18n en/hi/gu (parity spec), built-routes-only sidebar, boundaries, DataTable, honest wave-map dashboard.
Timing law: waves activate at the FIRST GOVERNMENT/SCHEME PARTNERSHIP — pilot does not need them.

**Binding spec:** Ledger Part 3 (FLOWMAP_gov): 83 owed rows — 72 BACKEND-READY, 11 gated (`mgnrega-program`).
**Export law:** every export any GW wave ships must return an audit-stamped receipt (who/when/what-filter), never a bare file.

## Waves (`Yes start PC-4x`)
- [x] **GW-0 · foundation** ✅ 2026-08-05 — this scaffold (web-ops recipe: copy + kvg rename + fresh gov files).
- [x] **GW-1 · schemes (25 rows)** ✅ 2026-08-05 — /schemes (queue w/ status filter + active definitions;
      version note: applications stay bound to their scheme version) + /schemes/[id] (facts, form data, docs,
      DBT transfers, legal-step-only review: verify→clarify/approve[govtAppRef]/reject[REASON REQUIRED —
      'a farmer must always know why', appealable]→close). Eligibility-builder authoring = admin-side
      (schemes-registry rules POST, built); gov console reviews.
- [x] **GW-2 · DBT (14 rows)** ✅ 2026-08-05 — BUILT the API's real DBT surface: per-application credit
      recording on /schemes/[id] (approved|disbursed gate; float-free amount; instalment 1–60; pfmsRef ≤120;
      'the credit happens in PFMS/bank systems — this is the register') + transfers list (GW-1). Cross-app
      batches/monitor/bounce/triggers/insights + PFMS recon = read-models + provider → PC-54 `dbt-read-models`
      (Ledger Appendix 4).
- [ ] **GW-3 · regulator (12 rows)** — fintech/insurance reads + exports api w/ audit receipts.
- [ ] **GW-4 · verification (9 rows)** — kyc/ai-governance/audit reads; field-visit evidence via media ids.
- [ ] **GW-5 · GATED** — MGNREGA (PC-54 `mgnrega-program` first; musters partially via labour api).
