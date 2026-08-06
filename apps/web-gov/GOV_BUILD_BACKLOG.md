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
- [x] **GW-3 · regulator (12 rows)** ✅ 2026-08-05 — /registers: read-only IRDAI insurance partners/products +
      lending partners/loan-products. Export files: api `exports` = EXPORT TRADE (not reports); admin-api
      regulator-export = god-mode realm → audit-stamped export files = PC-54 `gov-report-exports` (Ledger
      Appendix 5); honest note in console, no fake downloads. DBT register (GW-2) noted Live on dashboard.
- [x] **GW-4 · verification (9 rows)** ✅ **BUILT 2026-08-06 (PC-55 B1)** — /verification: KYC reviewer QUEUE
      (status boxes pending/verified/rejected/expired, keyset) + CASE page reading `kyc/review/:id` (W54-1), with
      EVIDENCE BEFORE DECISION enforced in the UI: Verify is unavailable without an attached document and the page
      says why; Reject always demands a reason. Evidence opens through a server route that mints a short-lived
      presigned URL at click time (never embedded in page HTML, bytes never touch this console); document numbers
      stay masked. `verified → rejected` is offered as a REVOCATION because the API's state machine allows it.
      Field visits (W54-3, canon W337) on the application page: schedule (you become officer of record) + submit
      findings with photo evidence as MEDIA IDS via a gov MediaUploader (VisitEvidence), one recorded location
      stamped per photo, measurements as `name: value` lines refused rather than silently dropped.
      HONEST GAP KEPT VISIBLE: the farmer-side OTP sign-off is NOT built (field-verification.service.ts says so),
      so W337's "Send OTP"/"needs farmer OTP" buttons are NOT drawn — the form states that the record carries the
      officer's attestation, not the farmer's confirmation. Dashboard: verification is now Live; nav links it.
- [x] **GW-5 · MGNREGA** ✅ **BUILT 2026-08-06 (PC-55 B2)** — **THE GOV CONSOLE IS NOW 100%: GW-0..GW-5 all built.**
      /mgnrega dashboard (job cards, works by status, attendance days observed, demand counts incl. OVERDUE — all
      counted in SQL over the whole register, never over a page) · /mgnrega/job-cards register + **audit-stamped
      exports** (job_cards | works | demands: receipt id + row count + time written to the audit ledger in the same
      transaction, Appendix 5 law) · /mgnrega/job-cards/[id] the 100-day ledger with BOTH counts side by side (ours
      vs the state's, higher one charged against the cap) + the muster day rows as its evidence ·
      /mgnrega/demands the **work-demand register** with the statutory 15-day clock (dueBy, days left, OVERDUE →
      "allowance payable by the state"), allot-a-real-work, withdraw, close-with-reason.
      **B2 ABSORBED THE MISSING BACKEND** A4 left gated (recorded in 0091's header, not drift): migration 0091
      `mgnrega_work_demands` + the §3 clock in pure rules + service/controller/SDK, because a console form that
      recorded a household's demand nowhere would destroy the only evidence their legal clock ever started.
      **FOUND + FIXED (Law 1):** `mgnrega_job_cards` has no tenant_id (a card is national, belongs to a person), so
      the W54-3 oversight list was returning EVERY tenant's cardholders — now scoped by tenant membership
      (user_tenant_roles) on list, cardById, counts and export.
      HONEST GAPS KEPT VISIBLE: canon W345's "Sync now" is NOT drawn (STATE_LEDGER_PROVIDER is a documented no-op —
      there is no sync to run); every page says the numbers are the platform's own observations with the state
      register as authoritative; wages/allowances are named as state-paid, never platform-paid.
