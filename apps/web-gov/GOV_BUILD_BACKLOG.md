# web-gov — build backlog (PC-40, government/regulator console)

**Status.** GW-0 ✅ (2026-08-05): Next.js 14 scaffold on the MAIN platform API (§C-3 ruling: gov-persona scoped
tokens — read + AUDIT-STAMPED-EXPORT heavy; never god-mode). Phone-OTP auth (kvg_* cookies + silent refresh),
i18n en/hi/gu (parity spec), built-routes-only sidebar, boundaries, DataTable, honest wave-map dashboard.
Timing law: waves activate at the FIRST GOVERNMENT/SCHEME PARTNERSHIP — pilot does not need them.

**CORRECTION (PC-56 GOV-1a, 2026-11-10 — survey_gov1.md C-1, C-6; the lines below are kept as written, this note corrects them).**
(1) There were no "gov-persona scoped tokens": until GOV-0 (`4e6937a2`) the console signed a phone into ONE organisation with an ordinary
tenant token, and anyone whose phone received a code signed in. GOV-0 built the government realm (`/v1/gov/*`, flag `gov_console` OFF);
GOV-1a moved this console onto it: `/login` signs in to an AUTHORITY (phone code, then the authenticator code), `requireGov()` gates every
page, `/access` reads the authority's people. (2) "THE GOV CONSOLE IS NOW 100%" below is FALSE: GW-0…GW-5 built FLOWMAP rows on the
organisation sign-in, not canon screens — 0 of 159 gov canon files were recorded when GOV-1 was surveyed. Those GW-1…GW-5 pages
(`/schemes`, `/registers`, `/verification`, `/mgnrega`) read an organisation and cannot work under an authority's session: GOV-1a deleted
them (307 → /dashboard); their pure logic (`features/schemes`, `features/verification`, `features/mgnrega`) and its unit specs are kept for
GOV-2…GOV-5. (PC-56 GOV-4a: `features/verification` and its spec are deleted — the KYC desk is the organisation's, and field visits are not
done through this platform; `/verification` is now the authority's "Field visits" page and its 307 is gone.) The PC-56 tracker (`Development_Program/PC56_WEB_PARITY_PROGRAM/06_GOV.md`) is the record of what is built.

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
- [x] **GW-5 · MGNREGA** ✅ **BUILT 2026-08-06 (PC-55 B2)** — **THE GOV CONSOLE IS NOW 100%: GW-0..GW-5 all built.** *(FALSE — see the PC-56 GOV-1a correction at the top.)*
      *(PC-56 GOV-5a, 2026-11-11 — survey_gov5.md C-8: every page this entry describes below (/mgnrega dashboard, /mgnrega/job-cards,
      /mgnrega/job-cards/[id], /mgnrega/demands) was deleted at GOV-1a and is described here in the past, not the present. Since GOV-5a
      `/mgnrega` is the AUTHORITY's page and reads nothing: MGNREGA's register is NREGASoft; this console records no work demand and does not
      connect to NREGASoft (GOV-5 Q3-A); it shows no job card, worker, household, attendance, worksite, wage or payment figure (Q2-A, Q1-A).
      Its builders (features/mgnrega/program.ts) are deleted. The organisation's MGNREGA routes are behind `labour` + `mgnrega` (HOTFIX-16).)*
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
