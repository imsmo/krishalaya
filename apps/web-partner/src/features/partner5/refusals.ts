// apps/web-partner/src/features/partner5/refusals.ts · PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS (founder 5a-5 … 5a-8) — WHAT THE
// LENDER'S ARREARS PAGES DO NOT CLAIM, BY NAME. PURE. The shape of features/partner4/refusals.ts: each refused canon claim is listed ONCE
// with where the canon makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map,
// and the claims guard (test/claims-guard.spec.ts, the `partner5.` scope) keeps the canon's false words out of every value AND out of every
// key this registry prints (including the PARTNER-4 keys it reuses). The sentences word the refused claims generically: no canon person,
// place, institution, bank, loan or case reference, scheme, figure or avatar appears in any value.
//
// THE SURFACES `Partner5Surface`: `aging` (W223) · `writeoffs` (W222) — built in 5a as READS of the existing 4a/4b definers, with their four
// chain surfaces `aging_export` (W2929–W2930, DECOR + the mailbox line) · `aging_act` (W2931–W2933, PARITY-DECOR: Retry is a genuine re-read)
// · `writeoffs_export` (W3024–W3025, DECOR + the mailbox line) · `writeoffs_act` (W3026–W3028, PARITY-DECOR).
// PC-56 PARTNER-5b · COLLECTIONS THE PLATFORM DOES NOT DO (founder 5b-1 … 5b-7; doors Q4 + Q5) registers its six surfaces here: three
// HONEST PAGES THAT READ NOTHING (the W217 shape) — `collections` (W219, `/lender/collections`), `collections_case` (W220,
// `/lender/collections/[id]`, the `[id]` a LOAN id; its two canon inputs are never rendered) and `restructure` (W221,
// `/lender/collections/[id]/restructure`) — and their four DECOR chains: `collections_form` (W2914–W2917, `?form=` on the case page, NO
// mailbox), `collections_act` (W2918–W2920, `?act=` on `/lender/collections`), `case_act` (`?act=` on the case page, files listed on
// W219's chain) and `restructure_act` (W2999–W3001). A lender never collects, contacts, ranks or sees a borrower in arrears here (Q5), and
// nothing of any restructure proposal reaches this console (Q4).
// PC-56 PARTNER-5c · THE PROMISE THE PLATFORM SETS (founder 5c-1 / 5c-2; doors Q6 + Q7) uses the last three surfaces: `sla` (W214,
// `/lender/reports`) — a READ of PARTNER-1a's dashboard `sla` block (no new route, one audit row per read): the platform's published
// decision promise and the measured decision time as counts and durations, with the production-zero reason — and its two chains,
// `sla_export` (W3009–W3010, DECOR + the mailbox line) and `sla_act` (W3011–W3013, PARITY-DECOR: Retry is a genuine re-read). With 5c the
// PARTNER-5 registry decides all 31 files and no pending verdict value survives (the 4c-7 rule).
export type Partner5Surface =
  | 'aging' | 'writeoffs' | 'aging_export' | 'aging_act' | 'writeoffs_export' | 'writeoffs_act'
  // PARTNER-5b
  | 'collections' | 'collections_case' | 'restructure'
  | 'collections_form' | 'collections_act' | 'case_act' | 'restructure_act'
  // PARTNER-5c
  | 'sla' | 'sla_export' | 'sla_act';
export interface Partner5Refusal { id: string; canon: string; surfaces: readonly Partner5Surface[]; key: string; why: string }

/** The two export chains of 5a: DECOR, with the partners-mailbox line. */
const EXPORT: readonly Partner5Surface[] = ['aging_export', 'writeoffs_export'];
/** Every chain surface of 5a. */
const CHAINS: readonly Partner5Surface[] = ['aging_export', 'aging_act', 'writeoffs_export', 'writeoffs_act'];
/** The two pages of 5a. */
const PAGES: readonly Partner5Surface[] = ['aging', 'writeoffs'];
/** The three honest pages of 5b. */
const PAGES_5B: readonly Partner5Surface[] = ['collections', 'collections_case', 'restructure'];
/** The four DECOR chains of 5b. */
const CHAINS_5B: readonly Partner5Surface[] = ['collections_form', 'collections_act', 'case_act', 'restructure_act'];
/** PC-56 PARTNER-5c · the SLA page and its two chains. */
const SLA_ALL: readonly Partner5Surface[] = ['sla', 'sla_export', 'sla_act'];
/** The two collections pages (W219, W220) — where the canon's code of conduct and its contact promises are printed. */
const COLL: readonly Partner5Surface[] = ['collections', 'collections_case'];

export const PARTNER5_REFUSALS: readonly Partner5Refusal[] = Object.freeze([
  // ── W223 · days past a recorded due date (founder 5a-6) ──
  { id: 'percent_of_book', canon: 'W223 column "% of book" and every cell of it ("95.4%" … "0.0%")', surfaces: ['aging', 'aging_export'],
    key: 'partner5.refusal.percentOfBook', why: 'founder 5a-6 / 4b-7 / survey E9: each row is a count and a bigint Σ of `outstanding_minor` (0232:112-130); a share of the book is a ratio and is not printed — and over a book whose due dates are all NULL it would mislead whichever way it rounded' },
  { id: 'missed_instalments', canon: 'W223 column "Arrears (missed inst.)" and the lead "arrears shown alongside (what collections works). Two numbers, labelled, never conflated."', surfaces: ['aging'],
    key: 'partner5.refusal.missedInstalments', why: 'GAP-BE (P4-B9): there is no instalment table (0011 has none; FIN/domain/loan-repayment.entity.ts:2-3 — a repayment row is created AT PAYMENT), so there is nothing missed to sum. The outstanding basis EXISTS and is the only one printed (survey §1F)' },
  { id: 'five_buckets', canon: 'W223 rows "current 1,110 …" · "1–15 DPD" · "16–30 DPD" · "31–90 DPD" · "90+ DPD"', surfaces: ['aging'],
    key: 'partner5.refusal.fiveBuckets', why: 'DELTA: the canon\'s five buckets are not the platform\'s six (`not_due` · `no_due_date` · 1-30 · 31-60 · 61-90 · 90+, 0232:115-123); "current" must not absorb `no_due_date` — a loan with no due date is undated, not on time, and today that is every loan (0232:117)' },
  { id: 'pre_review', canon: 'W223 row "90+ DPD (pre-NPA review)"', surfaces: ['aging'],
    key: 'partner5.refusal.preReview', why: 'FALSE: no review of any kind and no asset classification exists in FIN, PCON or any migration — the bucket is a count (survey §1F; §1 "No overdue")' },
  { id: 'cure_machinery', canon: 'W223 "Zero loans in 90+ — the cure machinery (auto-deduction, early vet-visit-style nudges, mediation) works upstream so the bottom bucket stays empty."', surfaces: ['aging'],
    key: 'partner5.refusal.cureMachinery', why: 'FALSE (survey F-6): 90+ is zero because no loan has a due date (`loan-application.service.ts:129` opens every loan with `nextDueDate: null`; 0232:117), not because anything cures; there is no contact engine (4b-5) and the "vet-visit" inference is the WALL. The canon\'s last sentence ("the day it doesn\'t, this table says so") becomes true only with P4-B9' },
  { id: 'computed_nightly', canon: 'W223 error state "Couldn\'t load aging — Bucket math is server-computed nightly + live-adjusted."', surfaces: ['aging', 'aging_act'],
    key: 'partner5.refusal.computedNightly', why: '"server-computed" is TRUE; "nightly + live-adjusted" is FALSE — no job exists; `partner_loan_dpd()` is a STABLE SQL function evaluated on every request (0232:112) and each answer carries `computedAt`' },
  { id: 'bucket_drilldown', canon: 'FM:32 drill-in "linkless table" on W223 — a bucket row opened to the loans in it', surfaces: ['aging'],
    key: 'partner5.refusal.bucketDrilldown', why: 'refused (founder 5a-5, WALL): a bucket drill-down would list the loans in arrears; a lender never names, ranks or contacts a borrower through this console, so a row is not a link (survey §1F)' },
  { id: 'aging_roles', canon: 'W223 restricted state "Aging restricted — Risk-committee view; needs credit-risk role." · W222 restricted state "Write-offs restricted — Board-level view …" · (PARTNER-5c) W214 restricted state "Reports restricted — Monthly packs need your bank\'s admin or compliance role."', surfaces: [...PAGES, 'sla'],
    key: 'partner4.refusal.platformRoles', why: 'FALSE: the partner realm has four roles (0225) and `partner.loans.read` covers both pages for all four (0231:142-164); no risk-committee, credit-risk or board role exists — PARTNER-4\'s refusal, reused by key' },
  { id: 'plan_settings', canon: 'W222 / W223 (and, PARTNER-5b, W219 / W220 / W221; PARTNER-5c, W214 "Flagged off — SLA & Reports disabled") flagged-off state "This module is switched off for this tenant/plan (feature flag) … See plan settings."', surfaces: [...PAGES, ...PAGES_5B, 'sla'],
    key: 'partner4.refusal.planSettings', why: 'OFF-as-OFF via `partner_console` (`lib/lender.ts:34-37`); no plan-settings surface exists for a partner organisation (the 2a / 2c / 3a / 4a precedent, reused by key)' },
  // ── W222 · written-off loans (founder 5a-3 / 5a-7) ──
  { id: 'written_off_share', canon: 'W222 "2 loans written off FY (₹1,10,000 · 0.16% of book)"', surfaces: ['writeoffs', 'writeoffs_export'],
    key: 'partner4.refusal.writtenOffShare', why: 'founder 4a-7 / survey E9: the count and the bigint sum are printed (`partner-loans.rules.ts:169`, :198); the share is a ratio and is not — PARTNER-4a\'s refusal, reused by key' },
  { id: 'writeoff_date', canon: 'W222 "2 loans written off FY" read as written off IN the year, and the column "Written off" read as a moment', surfaces: ['writeoffs'],
    key: 'partner5.refusal.writeoffDate', why: 'there is no write-off date: no `written_off_at` column exists and `updated_at` moves on any update (0001:45-74; survey C-4). The counts window is over loans OPENED (0231:262-263, `l.created_at`), so the page prints "of the loans opened in this window"' },
  { id: 'books_not_story', canon: 'W222 "A write-off closes your books, not the borrower\'s story — recovery stays open, humane, and logged."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.booksNotStory', why: 'FALSE ×3 (survey F-2): the loan is the cooperative\'s, not the lender\'s (FIN README :13-15); a `written_off` loan refuses every repayment (`loan.entity.ts:34`) and the milk deduction skips it (`loan.repository.ts:71`), so nothing stays open; and nothing is logged (C-5)' },
  { id: 'cause_column', canon: 'W222 table column "Cause" and the rows\' causes (a borrower\'s death, a lapsed policy, a herd\'s disease)', surfaces: ['writeoffs'],
    key: 'partner5.refusal.causeColumn', why: 'GAP-BE + WALL: the reason the write-off route demands is discarded (`servicing.service.ts:88-98`, survey C-4), and a cause would be a fact about a person and her family (survey F-4) — never copied into a fixture or a value' },
  { id: 'recovered_since', canon: 'W222 column "Recovered since" and the cell "₹18,000 (… claim, family-assisted)"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.recoveredSince', why: 'FALSE (MONEY): no recovery money can move — a written-off loan refuses every repayment (`loan.entity.ts:34`) and `ledger_txn_type` has no `recovery` code (seed core/0005:41). Recording a recovery is the money wave\'s (P5-B11, founder 5a-3 Q2-b)' },
  { id: 'causes_documented', canon: 'W222 footer "2 of 2 write-offs (FY) · both causes documented — neither is \'refused to pay\'" (FM:166, classed `filter`)', surfaces: ['writeoffs'],
    key: 'partner5.refusal.causesDocumented', why: 'FALSE: nothing is documented (C-4); and the footer is a static line FM mis-classed (F-15) — recorded as a DELTA too' },
  { id: 'writeoff_gates', canon: 'W222 "Write-off gate (hard)": "≥ 180 DPD · mediation attempted · restructure offered or inapplicable" · "Committee sign-off (your bank) + platform conduct check"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.writeoffGates', why: 'FALSE ×5 (survey §1 "Write-off rules, as coded"): one person, `overdue` only, no DPD threshold, no mediation check, no committee, no conduct check — and founder 5a-3 now refuses every write-off by name (`WRITE_OFF_NOT_LIVE`) until P5-B1 + P4-B12 ship together' },
  { id: 'post_writeoff_conduct', canon: 'W222 "Post-write-off: no recovery agents · family approached only for insurance/estate help"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.postWriteoffConduct', why: 'nothing enforces any of it: no contact engine, no agent register and no conduct check exist (founder 4b-5 / 5a-5; `features/partner4/refusals.ts` `code_of_conduct`). "marketplace access never blocked" is 5b\'s true line and is left to it' },
  { id: 'dairy_case', canon: 'W222 "The dairy case, honestly — Herd loss with a disease-outbreak record (animal health file) — insurance would have covered it, but the enrolment lapsed."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.dairyCase', why: 'WALL: an animal-health record is dairy data on the other side of the wall (survey §1E), and a case narrative is a family\'s; no lender is told one' },
  { id: 'cattle_insurance_rule', canon: 'W222 "The platform lesson shipped already: livestock-loan disbursal now requires active insurance (product rule since Apr 2026)."', surfaces: ['writeoffs'],
    key: 'partner4.refusal.cattleInsuranceRule', why: 'FALSE — S4 already refused the identical claim on W218 (`features/partner4/refusals.ts` `cattle_insurance_rule`): `eligibility_rules` is evaluated by nothing. Reused BY KEY (brief §E)' },
  { id: 'recorded_with_evidence', canon: 'W222 "Write-offs recorded with cause evidence · recoveries post to the ledger like any money"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.recordedWithEvidence', why: 'FALSE ×2 (MONEY): no cause, no evidence (C-4); no `write_off` / `recovery` `ledger_txn_type` (seed core/0005:41)' },
  { id: 'gate_exists', canon: 'W222 empty state "No write-offs — A clean book — the gate exists for the years that are not like this one."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.gateExists', why: '"the gate exists" is FALSE (survey §1E); "none have reached that point" is TRUE for a STRUCTURAL reason — nothing ever becomes `overdue` (C-6) — so the empty state says the reason, not the virtue' },
  { id: 'records_immutable', canon: 'W222 error state "Couldn\'t load write-offs — Records are immutable. Retry."', surfaces: ['writeoffs', 'writeoffs_act'],
    key: 'partner5.refusal.recordsImmutable', why: 'FALSE: there is no write-off record at all, and `loans` is an ordinary updatable table with no trigger (survey §1E; founder 4c-5 / 5a-8: the word is never printed about any table here)' },
  { id: 'board_committee', canon: 'W222 restricted state "Board-level view; initiating needs committee workflow, never a single officer."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.boardCommittee', why: 'FALSE ×2 (survey F-2): no board role exists, and initiating needed EXACTLY a single officer (`servicing.service.ts:88-98`) — the canon\'s sentence is the precise inverse of the code; founder 5a-3 refuses the act by name now' },
  // ── the four chains (W2929–W2930, W2931–W2933, W3024–W3025, W3026–W3028) ──
  { id: 'board_pack', canon: 'W222 "Export (board pack)" (FM:168, `chain-export` → W3024–W3025) and the module sentence of W3024 / W3025', surfaces: ['writeoffs', 'writeoffs_export'],
    key: 'partner5.refusal.boardPack', why: 'DECOR (founder 5a-8, 2b-1): no partner export plane exists (P2-B6), and the lender\'s board is not a platform surface — nothing is prepared for one' },
  { id: 'export_file', canon: 'W2929 / W3024 "audit-stamped, checksummed, delivered by signed URL" · W2930 / W3025 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged" · W223 "Export (signed)"', surfaces: [...EXPORT, ...PAGES, ...SLA_ALL.filter((x) => x !== 'sla_act')],
    key: 'partner4.refusal.exportFile', why: 'founder 5a-8 / 4a-7 (2b-1): there is no partner export plane in Phase 1 (P2-B6); the console names the partners mailbox instead — PARTNER-4\'s refusal, reused by key' },
  { id: 'chain_zero_sum', canon: 'W2932 / W3027 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: [...CHAINS, ...CHAINS_5B, 'sla_act'],
    key: 'partner4.refusal.chainZeroSum', why: 'nothing reached from these pages moves a rupee (survey §1 rupee 6), so there is nothing to reconcile — reused by key' },
  { id: 'chain_on_call', canon: 'W2933 / W3028 "repeated failures page the on-call"', surfaces: [...CHAINS, ...CHAINS_5B, 'sla_act'],
    key: 'partner4.refusal.chainOnCall', why: 'no paging from a partner page exists (survey §1, the shared chain sentences refused by PARTNER-1…4) — reused by key' },
  { id: 'chain_audit', canon: 'W2931 / W3026 "confirming writes an audit-trail entry with actor, time and reason" · W2932 / W3027 "View audit trail" · "the audit trail has the entry (actor · time · reason · before/after)"', surfaces: [...CHAINS, ...CHAINS_5B, 'sla_act'],
    key: 'partner4.refusal.chainAudit', why: 'a re-read writes only its own partner-realm read row (one per dpd / counts / list read, counts only — survey E10; PCON partner-console.controller.ts:294-331 are GETs) and the console has no audit-trail page — reused by key' },
  // ══ PC-56 PARTNER-5b · COLLECTIONS THE PLATFORM DOES NOT DO (founder 5b-1 … 5b-5) ══
  // ── the code of conduct, REUSED BY KEY from PARTNER-4b (founder 4b-5: recorded as intent, never as something the platform enforces) ──
  { id: 'code_of_conduct', canon: 'W219 "worked with the code of conduct on every screen" · W220 "Contact log (every touch, code-of-conduct)" and "per the code-of-conduct"', surfaces: COLL,
    key: 'partner4.refusal.codeOfConduct', why: 'founder 4b-5 / 5b-2 (survey F-4): the platform enforces none of it — no contact engine, no log, no hours window, no mediation gate, no prohibition, no suspension (features/partner4/refusals.ts `code_of_conduct`). Reused BY KEY, never re-worded' },
  { id: 'contact_hours', canon: 'W219 "hours 08:00–19:00 · Gujarati first" · W220 "all within 08:00–19:00 · zero visits" and "any contact 19:00–08:00"', surfaces: COLL,
    key: 'partner4.refusal.contactHours', why: 'founder 4b-5: no hours window is evaluated anywhere because no contact happens through this platform (survey §1 "Collections, contact and conduct") — reused BY KEY' },
  { id: 'contact_log', canon: 'W219 "every contact logged" and the restricted state "every borrower contact is logged with time + channel + summary" · W220 "Contact log (every touch …)" and its three entries', surfaces: COLL,
    key: 'partner4.refusal.contactLog', why: 'founder 4b-5: there is no contact table, record or tool anywhere (survey C-12; `grep -rn promise_to_pay` → none) — reused BY KEY' },
  { id: 'mediation_first', canon: 'W219 "FPO mediation before escalation" and the KPI "> 30 DPD (mediation)" · W220 header "FPO mediation Thu 16 Jul" · W221 header "for Thu mediation"', surfaces: PAGES_5B,
    key: 'partner4.refusal.mediationFirst', why: 'founder 4b-5: `loan_restructures.mediation_at` exists (0069:154) and nothing writes it; nothing schedules a meeting with anybody (survey §1C/§1D) — reused BY KEY' },
  { id: 'third_party_agents', canon: 'W219 the code of conduct carried from W211 ("no third-party agents on platform-originated loans")', surfaces: ['collections'],
    key: 'partner4.refusal.thirdPartyAgents', why: 'founder 4b-5: nothing on this platform knows who collects a debt, so nothing can prohibit anybody — reused BY KEY' },
  { id: 'partner_suspension', canon: 'W219 the code of conduct carried from W211 ("Violation = partner suspension.")', surfaces: ['collections'],
    key: 'partner4.refusal.partnerSuspension', why: 'founder 4b-5: no suspension mechanism, violation record or process exists — reused BY KEY' },
  { id: 'collections_roles', canon: 'W219 "Named cases need collections role" · W220 "Named case files need collections role" · W221 "Proposing needs collections lead"', surfaces: PAGES_5B,
    key: 'partner4.refusal.platformRoles', why: 'FALSE: the partner realm has four roles (0225) and none is a collections role or lead (survey F-11) — PARTNER-4\'s refusal, reused BY KEY' },
  // ── W219 · the collections workbench (founder 5b-2) ──
  { id: 'take_next_case', canon: 'W219 "Take next case" (FM:154, `chain-mutate` → W2918–W2920)', surfaces: ['collections', 'collections_act'],
    key: 'partner5.refusal.takeNextCase', why: 'DECOR, refused by name (founder 5b-2, survey §1H): there is no case, no assignment and no lender act; the cooperative services its own book on the tenant plane' },
  { id: 'named_cases', canon: 'W219 table "DPD ▾ · Case · Arrears · Last contact · Stage", its three rows (each a case reference and a loan kind, "name in case view — logged"), the links "Open" → W220, and the footer "3 highlighted of 14 named cases (≥16 DPD)" (FM:151, `bulkbar`)', surfaces: ['collections'],
    key: 'partner5.refusal.namedCases', why: 'WALL (founder 5b-1 / Q5; PARTNER-0 Q4 — never a name): no case entity exists (`loan_restructures.case_ref` is free text, survey C-12), 0231:130-137 removed `borrower_user_id` from the axis so a name cannot be joined, and a ranked list of borrowers behind on a loan is exactly what a lender is never shown' },
  { id: 'arrears_kpis', canon: 'W219 KPIs "38 loans past due" · "1–15 DPD (gentle nudge) … voice reminders only" · "16–30 DPD (named cases) … promise-to-pay tracking" · "> 30 DPD (mediation) … outstanding at risk"', surfaces: ['collections'],
    key: 'partner5.refusal.arrearsKpis', why: 'founder 5b-2: NO FIGURE ON THIS PAGE. The six buckets already exist as counts on /lender/repayments and /lender/portfolio/aging (0232:112-130), linked instead of duplicated; "arrears" as missed instalments is GAP-BE (P4-B9); the reminders, stages and tracking are FALSE (no engine, survey §1B)' },
  { id: 'recovery_measure', canon: 'W219 KPI "Cure rate (90d) 83% — most arrears cure within one season — patience is a strategy"', surfaces: ['collections'],
    key: 'partner5.refusal.recoveryMeasure', why: 'FALSE: a rate (E9) over a status nothing sets — `cure()` has no caller (`loan.entity.ts:44`), nothing calls `markOverdue()` (survey C-6)' },
  { id: 'dairy_inference', canon: 'W219 row "… SMS reminder · milk volume dip — vet visit suggested" and the paragraph "The dairy case shows the platform difference: the system noticed her milk volumes dipped BEFORE the missed instalment … Fix the cow, fix the loan."', surfaces: ['collections'],
    key: 'partner5.refusal.dairyInference', why: 'FALSE and WALL — refused for its REASONING (founder 5b-1, survey F-4): no such detection exists, and a cooperative member\'s dairy, crop and rental records are never a lender\'s; using them to brief her lender is a purpose change (DPDP) the platform does not make' },
  { id: 'auto_threshold', canon: 'W219 empty state "Queue clear — … Cases enter this queue automatically past the DPD threshold."', surfaces: ['collections'],
    key: 'partner5.refusal.autoThreshold', why: 'FALSE: there is no queue and no job (survey §1B); nothing becomes `overdue` (C-6)' },
  { id: 'all_loans_up_to_date', canon: 'W219 empty state "No cases — All loans current — the auto-deduction channels are doing their quiet work." + "View repayments" (FM:155, a dead `data-decor` button)', surfaces: ['collections'],
    key: 'partner5.refusal.allLoansUpToDate', why: 'FALSE as a claim — with no due date on any loan (`loan-application.service.ts:129`) the platform cannot know; the auto-deduction sentence is S4\'s true line and lives on /lender/repayments, which this page links to (survey §1B)' },
  { id: 'logs_server_side', canon: 'W219 error state "Couldn\'t load workbench — Contact logs and promises are server-side. Retry." (FM:153)', surfaces: ['collections', 'collections_act'],
    key: 'partner5.refusal.logsServerSide', why: 'FALSE: no contact or promise is stored anywhere; and the page reads nothing, so it has no error state at all (founder 5b-1, the W217 shape)' },
  // ── W220 · the collections case (founder 5b-3) ──
  { id: 'case_identity', canon: 'W220 "<the borrower\'s name> · <a masked phone> (name visible in case view only — this access is logged)" and the restricted state "Named case files need collections role"', surfaces: ['collections_case'],
    key: 'partner5.refusal.caseIdentity', why: 'WALL (founder 5b-1; PARTNER-0 Q4: a masked phone only on an approved consented APPLICATION, never on a loan in arrears, and never a name; survey F-4). The page looks nothing up, so there is nothing to log either' },
  { id: 'case_entity', canon: 'W220 header "CASE-… — tractor loan, 34 DPD · FPO mediation Thu 16 Jul" and the crumb "… › Collections › CASE-…"', surfaces: ['collections_case'],
    key: 'partner5.refusal.caseEntity', why: 'DELTA + FALSE: no case entity exists (survey C-12); the `[id]` is a LOAN id (founder 5b-3); "34 DPD" is GAP-BE (no due date) and the meeting is FALSE (`mediation_at` never written, 0069:154)' },
  { id: 'case_narrative', canon: 'W220 "What happened (the honest picture)" — the family\'s business story and "Platform data: his own kharif sowing completed, custom-hiring bookings resuming"', surfaces: ['collections_case'],
    key: 'partner5.refusal.caseNarrative', why: 'FALSE + WALL (founder 5b-1, survey F-4): cross-module reuse of a member\'s crop and equipment-rental records for her lender — the reuse PARTNER-3 refused for claims (S3 F-6) and PARTNER-4 for scores (S4 F-7)' },
  { id: 'reconsent_recording', canon: 'W220 "Consented context only: he re-consented to share booking data for this mediation — the case file says so, with the recording reference."', surfaces: ['collections_case'],
    key: 'partner5.refusal.reconsentRecording', why: 'FALSE, refused by name (founder 5b-1): no purpose-bound consent for collections exists; `credit_score_consents` has no writer (P4-B6) and its purpose is an application; there is no recording column' },
  { id: 'contact_entries', canon: 'W220 contact log rows ("… voice (gu) · answered · \'hiring resumes next week, mediation agreed\'", "SMS reminder (gu) · delivered", "first-miss courtesy call, no pressure language (transcript scored ✓)") and "3 contacts in 34 days"', surfaces: ['collections_case'],
    key: 'partner5.refusal.contactEntries', why: 'FALSE ×3 + WALL: no contact table, call record, transcript or scoring exists (survey §1C); quoting a farmer\'s words to his bank is the most identifying thing on the canon page' },
  { id: 'mediation_meeting', canon: 'W220 "Mediation (Thu, at the cooperative) — Present: borrower, FPO coordinator (his own federation), your field officer. Agenda drafted … His choice, documented."', surfaces: ['collections_case'],
    key: 'partner5.refusal.mediationMeeting', why: 'FALSE (survey §1C, Q5): no mediation record or attendee list; the platform does not place a bank\'s staff at a cooperative\'s meeting with its member and must not imply it' },
  { id: 'promise_form', canon: 'W220 form "Promise-to-pay" — `Amount promised (INR)` and `By date`, the canon\'s TWO real `<input>`s — and "Record promise (he gets it in Gujarati, in writing)" (FM:160, `chain-form`)', surfaces: ['collections_case', 'collections_form'],
    key: 'partner5.refusal.promiseForm', why: 'DECOR, refused by name (founder 5b-3, survey F-4): no promise table, route or permission; no notification (S4 F-19). NO INPUT IS RENDERED — a field that accepts a farmer\'s promise and stores nothing is the 4c KCC-form lesson made worse' },
  { id: 'log_contact', canon: 'W220 "Log contact" ×2 (FM:158 action bar, FM:159 empty state, `chain-form` → W2914–W2917)', surfaces: ['collections_case', 'collections_form'],
    key: 'partner5.refusal.logContact', why: 'DECOR, refused by name (founder 5b-3): no contact log, no lender contact role — and NO MAILBOX LINE, because the platform must not offer to relay a lender\'s contact with a cooperative\'s member (survey §1G, E4)' },
  { id: 'promise_ladder', canon: 'W220 "Promises recorded · a kept promise resets the tone; a missed one escalates one step, never three"', surfaces: ['collections_case'],
    key: 'partner5.refusal.promiseLadder', why: 'FALSE: no promise record and no escalation ladder exist (survey §1C)' },
  { id: 'off_the_table', canon: 'W220 "What is off the table (platform-enforced)" ✕ "Asset seizure before mediation + 90 DPD + committee sign-off" ✕ "Contacting family/neighbours · visits without notice · any contact 19:00–08:00" ✕ "Blocking his marketplace access…"', surfaces: ['collections_case'],
    key: 'partner5.refusal.offTheTable', why: 'FALSE as "platform-enforced" (founder 5b-3, survey F-4): nothing enforces any of the three; the first two are conduct rules for a lender\'s own staff off the platform, which a lawyer must read against the fair-practices code. The THIRD is true only as an ABSENCE and is printed as `partner5.collections.noSellingBlock`, never as a rule the platform keeps' },
  { id: 'case_archive', canon: 'W220 state "Case not found — Cured cases archive with their full contact history." + "Back to workbench" (FM:157)', surfaces: ['collections_case'],
    key: 'partner5.refusal.caseArchive', why: 'FALSE + a retention promise (refused — B2a :12). And there is no not-found at all: the page looks nothing up, so every id prints the same page and it is never an existence oracle (founder 5b-3). "Back to workbench" is a real link' },
  { id: 'contact_log_safe', canon: 'W220 error state "Couldn\'t load case — Contact log is append-only and safe. Retry." (FM:161 → W2918–W2920)', surfaces: ['collections_case', 'case_act'],
    key: 'partner5.refusal.contactLogSafe', why: 'FALSE: no log exists; "append-only" is reserved for tables with a trigger (founder 4c-5); and the page has no error state (it reads nothing)' },
  { id: 'every_open_logged', canon: 'W220 restricted state "Case access restricted — Named case files need collections role; every open is logged — including yours, just now."', surfaces: ['collections_case'],
    key: 'partner5.refusal.everyOpenLogged', why: 'FALSE here: the console writes one audit row per BOOK read (P4aR §1 case 7), but this page makes no read, so it writes no audit row (founder 5b-1; survey E10)' },
  // ── W221 · the restructure proposal (founder 5b-4, Q4) ──
  { id: 'stale_banner', canon: 'W221 banner "Backend pending (DELTA-033): `loan_restructures` terms table … today restructure is a status flip with terms in notes. Design leads."', surfaces: ['restructure'],
    key: 'partner5.refusal.staleBanner', why: 'STALE — never copied (survey C-3): the terms table exists (0069:130-169) and activation applies none of it; the canon file is not edited, the banner is recorded as a DELTA and refused here' },
  { id: 'terms_comparison', canon: 'W221 "Proposed terms (side by side)" — instalment, holiday ("interest accrues, no penalty"), tenor, rate ("unchanged, restructure is not a repricing"), total interest delta — "shown to him in ₹, in Gujarati, before he signs" · "Arrears fold into the new schedule … Penal interest … waived"', surfaces: ['restructure'],
    key: 'partner5.refusal.termsComparison', why: 'WALL + FALSE (founder 5b-4): every value is typed by the caller (`servicing.controller.ts:47-58`), none reaches the loan, and kv_partner holds NOTHING on `loan_restructures` (0231:306, 0232:189) and keeps holding nothing — so not one term is printed' },
  { id: 'weather_clause', canon: 'W221 "Weather-linked distress (monsoon clause qualifies: a monsoon-deficit figure, district notification attached)" and "credit record notes the weather cause"', surfaces: ['restructure'],
    key: 'partner5.refusal.weatherClause', why: 'FALSE (survey §1D, F-7): `evidence_media_id` is optional (`servicing.controller.ts:50`) and nothing evaluates a clause, a weather figure or a notice; no credit record exists (P4-B14 refused)' },
  { id: 'npa_discipline', canon: 'W221 "NPA discipline (honest books)": "90+ DPD without cure or restructure → NPA per your RBI norms — the platform never helps hide it" · "A restructure entered to dodge NPA recognition fails the weather-evidence gate" · "One restructure per loan per cause — serial restructuring is a red flag"', surfaces: ['restructure'],
    key: 'partner5.refusal.npaDiscipline', why: 'FALSE ×2, PARTIAL ×1 (survey §1D, F-1): no asset classification exists, no evidence gate, and `uq_loan_restructures_loan_open` (0069:168-169) is one open proposal per loan, not per cause; a regulatory statement is a lawyer\'s, and this console makes none' },
  { id: 'acceptance_flow', canon: 'W221 "Borrower acceptance flow": "Terms in Gujarati, ₹ figures, voice read-out at mediation" · "24h think-it-over window" · "Acceptance by OTP + voice · your checker countersigns · status → restructured"', surfaces: ['restructure'],
    key: 'partner5.refusal.acceptanceFlow', why: 'FALSE ×3 and a P0 trust line (founder 5b-4 / 5a-2): `accepted` is REFUSED from every session (`RESTRUCTURE_ACCEPTANCE_NOT_LIVE`, 409) until P5-B4; the OTP, window and document columns are never written (0069:155-161); "your checker" puts the lender\'s officer in the cooperative\'s maker-checker, which is false' },
  { id: 'comparison_forever', canon: 'W221 "Restructures recorded with full old→new terms · borrower gets the comparison PDF forever"', surfaces: ['restructure'],
    key: 'partner5.refusal.comparisonForever', why: 'FALSE + a retention promise: `comparison_pdf_media_id` is never written (0069:161); the terms half is true of the proposal ROW, which a lender never reads' },
  { id: 'versioned_draft', canon: 'W221 error state "Couldn\'t load proposal — The draft is versioned server-side. Retry." (FM:164)', surfaces: ['restructure', 'restructure_act'],
    key: 'partner5.refusal.versionedDraft', why: 'FALSE: `loan_restructures.version` exists (0069:162) and nothing increments it; and this page reads nothing, so it has no error state' },
  { id: 'restructure_people', canon: 'W221 restricted state "Proposing needs collections lead; activation needs borrower acceptance + your checker — three humans, always."', surfaces: ['restructure'],
    key: 'partner5.refusal.restructurePeople', why: 'FALSE ×3 (survey F-11): one `loan.manage` covers every step; the borrower never accepts on the platform; activation is REFUSED by name since 5a (`RESTRUCTURE_ACTIVATION_NOT_LIVE`)' },
  { id: 'take_to_mediation', canon: 'W221 "Take to mediation (checker after borrower accepts)" (FM:165, `chain-mutate` → W2999–W3001)', surfaces: ['restructure', 'restructure_act'],
    key: 'partner5.refusal.takeToMediation', why: 'DECOR for a lender, refused by name (founder 5b-4): `draft → mediation` is the cooperative\'s act on the tenant plane; and the chain sentence must never repeat the canon\'s order, because the borrower cannot accept on the platform (F-1, 5a-2)' },
  { id: 'no_acceptance_state', canon: 'W221 state "No acceptance recorded yet — The borrower\'s acceptance of these proposed terms will be recorded here once given."', surfaces: ['restructure'],
    key: 'partner5.refusal.noAcceptanceState', why: 'refused (founder 5b-4, Q4): nothing of a proposal is shown here, and an acceptance cannot be recorded at all until P5-B4' },
  { id: 'starts_from_case', canon: 'W221 state "No restructure in draft — Restructure starts from a collections case — context first, terms second." + "Back to case"', surfaces: ['restructure'],
    key: 'partner5.refusal.startsFromCase', why: 'FALSE: there is no case; a restructure starts from a loan id on the tenant plane (`servicing.controller.ts:90-94`)' },
  // ══ PC-56 PARTNER-5c · THE PROMISE THE PLATFORM SETS (founder 5c-1, door Q7 option A) ══
  // ── W214 · the lead line and the KPI tiles ──
  { id: 'your_contract', canon: 'W214 lead "Your contract with the platform, measured (financial_partners.sla): decision 72h …"', surfaces: ['sla'],
    key: 'partner5.refusal.yourContract', why: 'founder 5c-1 (survey C-13, §1A): the platform stores no commercial agreement; `sla` is a jsonb with ONE key anybody reads or writes, `decision_hours`, set by the admin realm alone (ADM partner-ops.service.ts:48-63). The page says what the platform PUBLISHED, never "your contract"' },
  { id: 'disbursal_promise', canon: 'W214 lead "disbursal 48h post-cooling-off" and the KPI "Disbursal SLA 99% — median 6h post-cooling-off"', surfaces: ['sla'],
    key: 'partner5.refusal.disbursalPromise', why: 'FALSE (survey C-13, P5-B10 refused): no such key exists, and paying a loan out is the cooperative\'s act, never the lender\'s (PARTNER_CANNOT_DISBURSE, founder 4b-4); nothing measures it' },
  { id: 'data_handling', canon: 'W214 lead "claim-free data handling"', surfaces: ['sla'],
    key: 'partner5.refusal.dataHandling', why: 'FALSE (survey C-13): not a field of `sla`; nothing publishes or measures a data-handling promise' },
  { id: 'same_scoreboard', canon: 'W214 "Both sides see the same scoreboard." and the footer "The same SLA numbers appear on the platform\'s provider-health console — one scoreboard, no arguments"', surfaces: ['sla'],
    key: 'partner5.refusal.sameScoreboard', why: 'FALSE (survey §1A): the admin realm stores and shows the promise (partner-ops) but no admin read computes a partner\'s measured decision time; `providers-ops` is the integration-provider registry' },
  { id: 'decision_rate', canon: 'W214 KPI "Decision SLA (30d)" printed as a share of decisions', surfaces: ['sla'],
    key: 'partner5.refusal.decisionRate', why: 'founder 5c-1 / 4b-7 (survey E9): the dashboard read gives counts and whole-second durations (partner-dashboard.service.ts `sla`); a share is a ratio and is not printed — "N of M" instead' },
  { id: 'surge_weeks', canon: 'W214 KPI "4 breaches — all volume-surge weeks"', surfaces: ['sla'],
    key: 'partner5.refusal.surgeWeeks', why: 'founder 5c-1: a late decision is printed only as the count decided − withinPromise, labelled "decided after the promise"; nothing records why a decision took the time it did, so no cause is attributed (survey §1A)' },
  { id: 'docs_pause', canon: 'W214 KPI "docs_pending pause honoured on every one"', surfaces: ['sla'],
    key: 'partner5.refusal.docsPause', why: 'FALSE (survey §1A, S4 C-9): `docs_pending` is unreachable and no pause exists; the latency is `decision_at − created_at` (partner-dashboard.rules.ts)' },
  { id: 'borrower_satisfaction', canon: 'W214 KPI "Borrower CSAT 4.6 / 5 — post-disbursal survey, in Gujarati"', surfaces: ['sla'],
    key: 'partner5.refusal.borrowerSatisfaction', why: 'FALSE (survey §1A): no borrower survey and no score; the only satisfaction table is the support desk\'s (0099), about tickets, not loans' },
  { id: 'conduct_count', canon: 'W214 KPI "Conduct flags 0 — collections code — clean quarter"', surfaces: ['sla'],
    key: 'partner5.refusal.conductCount', why: 'FALSE and a trust line (survey §1A; founder 4b-5): there is no conduct check to produce a zero, so "clean" would assert a monitoring that does not exist' },
  // ── W214 · the monthly packs ──
  { id: 'report_packs', canon: 'W214 table "Monthly report packs (signed exports)", "Download monthly pack (signed)" (FM:129) and the state "No report packs yet"', surfaces: SLA_ALL,
    key: 'partner2.refusal.reportPack', why: 'DECOR (founder 5c-1, 2b-1): no pack generator exists (P2-B6) — PARTNER-2b\'s W254 packs refusal (features/partner2/refusals.ts `report_pack`), reused BY KEY' },
  { id: 'pack_contents', canon: 'W214 rows "Originations · repayments · PAR · SLA · consent registry" with a hash column of sha256 fragments', surfaces: ['sla', 'sla_export'],
    key: 'partner5.refusal.packContents', why: 'FALSE (survey §1A): no pack, no hash, no generator; the portfolio-at-risk figure is a rate (E9) and the "consent registry" has no writer (P4-B6). The canon\'s hash fragments are never copied' },
  { id: 'pack_schedule', canon: 'W214 states "Signed monthly performance packs will appear here once the first month closes." · "Your first monthly pack generates on the 1st"', surfaces: ['sla'],
    key: 'partner5.refusal.packSchedule', why: 'FALSE: no job exists (survey §1A); "SLA numbers accrue live" is TRUE only in the narrow sense that the read is computed on every request — printed as `partner5.sla.liveNote`' },
  { id: 'packs_kept', canon: 'W214 error state "Couldn\'t load reports — Generated packs are immutable and re-downloadable. Retry."', surfaces: ['sla', 'sla_act'],
    key: 'partner5.refusal.packsKept', why: 'FALSE: no pack was ever produced, so none is kept or offered again; the word for a record the database refuses to change is reserved for tables with a trigger (founder 4c-5)' },
  { id: 'manifest_format', canon: 'W214 footer "2 highlighted of 14 monthly packs · same manifest format as the auditor console" (FM:127, `bulkbar`)', surfaces: ['sla'],
    key: 'partner5.refusal.manifestFormat', why: 'DECOR + FALSE (survey §1A): a static footer, and no file layout is shared with any console because no file is produced' },
  // ── W214 · the escalation list ──
  { id: 'escalations', canon: 'W214 "Escalations & contacts": integration issues to a partner desk with a response time; data and consent questions to platform compliance the same day; commercial terms to a named manager at a scheduled review', surfaces: ['sla'],
    key: 'partner5.refusal.escalations', why: 'FALSE ×3 (survey §1A; S1 B10 named, not built): no partner desk, no response-time promise of the platform\'s, no named manager. PARTNER-1a\'s honest line — the partners mailbox from the platform\'s published facts — is printed instead (`partner1.ops.mailbox`, lib/partners-mailbox.ts)' },
  // ── W3009–W3010 · the SLA export chain ──
  { id: 'sla_export_file', canon: 'W3009 "audit-stamped, checksummed, delivered by signed URL" · W3010 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged"', surfaces: ['sla_export'],
    key: 'partner5.refusal.slaExportFile', why: 'DECOR (founder 5c-1, 2b-1): no export plane exists for a partner (P2-B6); nothing is queued, stamped, fingerprinted or delivered' },
  // ── the collections form chain (W2914–W2917) ──
  { id: 'form_review_checker', canon: 'W2915 "Review before submitting — Maker-checker friendly review step … with the diff against current values" · W2914 "every invalid field is listed with its reason, values you entered are preserved"', surfaces: ['collections_form'],
    key: 'partner5.refusal.formReviewChecker', why: 'DECOR (survey §1G): there is no form, nothing was entered and no second person checks anything; the four canon pages carry no input themselves' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner5RefusalKeys(surface: Partner5Surface): string[] {
  return PARTNER5_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** The canon shapes PARTNER-5a builds differently — recorded DELTAs, not refusals (survey F-15 / F-16). */
export const PARTNER5_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'fm_footer_filter', canon: 'FM:166 — W222\'s static footer "2 of 2 write-offs (FY) · both causes documented…" classed `filter`',
    built: 'no footer is drawn; the claim in it is refused by name (`causes_documented`), and nothing on the page is a filter' },
  { id: 'fm_td_filter', canon: 'FM:169 — W222\'s `<td>` holding a canon loan number (a reference cell) classed `filter`',
    built: 'each row\'s loan reference is a REAL LINK to that loan\'s own page (`/lender/portfolio/[id]`, the 4a read) — the reference is the id\'s short form, never a loan number' },
  { id: 'fm_avatar_filter', canon: 'FM:167 (W222) and FM:172 (W223) — the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn; the header carries the platform\'s mark and the lender\'s own name (founder 5a-8)' },
  { id: 'fm_dead_nav_detail', canon: 'FM:171 (W222) and FM:175 (W223) — "View portfolio", a dead `<button … data-decor>` FM registers as `nav-detail` "sibling detail by context (build resolves)"',
    built: 'a REAL link to `/lender/portfolio` on both pages' },
  { id: 'fm_chain_ids', canon: 'FM names the four chains by W13xx ids that exist nowhere: W1387/W1388, W1389–W1391, W1392/W1393, W1394–W1396 (`ls CANON | grep -cE "^W1(38[7-9]|39[0-6])-"` → 0)',
    built: 'the canon\'s own files: W1387/W1388 → W3024/W3025, W1389–W1391 → W3026–W3028, W1392/W1393 → W2929/W2930, W1394–W1396 → W2931–W2933. The HTML was right; FM is stale (survey F-15)' },
  { id: 'orphans_subnav', canon: 'W222 and W223 are TOTAL ORPHANS — reachable only from their own five chain pages; W212, their crumb parent, links to neither (survey F-16)',
    built: 'the inbound edge the canon never drew is the lending sub-navigation: two LIVE rows (`/lender/portfolio/writeoffs`, `/lender/portfolio/aging`) on every lending page. Neither is a sidebar item (the canon has none either)' },
  { id: 'drill_ins', canon: 'FM:31 (W222) and FM:32 (W223) — the two "linkless tables"',
    built: 'W222\'s rows link to the loan page (the 4a read); W223\'s bucket table stays linkless — a drill-down would list the loans in arrears (refused, `bucket_drilldown`)' },
  { id: 'six_buckets', canon: 'W223\'s five buckets — current / 1–15 / 16–30 / 31–90 / 90+ — with a "% of book" column',
    built: 'the platform\'s SIX (0232:115-123): no due date recorded FIRST (with the reason beside it), then not yet due, then 1–30 · 31–60 · 61–90 · more than 90 days past a recorded due date — each a count and a bigint sum; the days spelled out, never the acronym; no "current", no share' },
  { id: 'sum_check_both', canon: 'W223 "5 buckets · 1,148 loans · ₹6,84,20,000 total outstanding ✓ (sums server-verified)"',
    built: 'the sentence prints BOTH figures — the BigInt sum of the six rows and the dpd read\'s servicing outstanding — never a tick alone; restructured loans sit outside both and their count is printed beside it (founder 5a-6, survey F-1)' },
  { id: 'two_windows', canon: 'W222 "written off FY" and W223 "As of 13 Jul" over one book',
    built: 'the dpd read is NOT windowed (every servicing loan); the counts read IS (loans OPENED in the IST window); the written-off list is NOT (every written-off loan, whenever opened). Each figure carries the label of its own window and its own as-of' },
  { id: 'chain_routes', canon: 'the chain pages W2929–W2933 and W3024–W3028 as separate files',
    built: 'query states of their parent pages: `?export=queued|ready` and `?act=confirm|success|failure` on `/lender/portfolio/aging` and `/lender/portfolio/writeoffs`; Back returns to the triggering page' },
  // ── PC-56 PARTNER-5b ──
  { id: 'case_id_is_loan', canon: 'W220 / W221 routes `lender/collections/[id]` and `lender/collections/[id]/restructure` — the `[id]` a CASE id (crumb "… › CASE-…")',
    built: 'the `[id]` is a LOAN id (no case entity exists, survey C-12; the W217 precedent) and is used ONLY, encoded, in links — to the loan page `/lender/portfolio/[id]` and between the case and restructure pages; it is never printed as text' },
  { id: 'every_id_same_page', canon: 'W220 state "Case not found" (and survey E2\'s "an unknown or foreign id → the 4a not-found shape")',
    built: 'the case and restructure pages LOOK NOTHING UP, so every id — known, foreign, unknown or malformed — prints the SAME page: no not-found, no existence oracle (founder 5b-3 deliberately overrides E2, which would need a read)' },
  { id: 'fm150_pagination', canon: 'FM:150 — W219 "18" classed `pagination`',
    built: 'it is the third row\'s DPD `<td>`, mis-classed as a page number (survey F-15); nothing is listed or paged on the honest page' },
  { id: 'fm_bulkbar_footer', canon: 'FM:151 — W219 "3 highlighted of 14 named cases (≥16 DPD)" classed `bulkbar`',
    built: 'a static footer, not a selection bar; its claim is refused by name (`named_cases`)' },
  { id: 'fm_avatar_5b', canon: 'FM:152 (W219), FM:156 (W220) and FM:162 (W221) — the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn; the header carries the platform\'s mark and the lender\'s own name' },
  { id: 'fm_dead_nav_5b', canon: 'FM:155 "View repayments", FM:157 "Back to workbench", FM:163 "Back to case" — dead `<button … data-decor>` FM registers as `nav-detail`',
    built: 'REAL links: `/lender/repayments` (and `/lender/portfolio/aging`) from W219; `/lender/collections` from W220; the case page `/lender/collections/[id]` from W221' },
  { id: 'fm_omits_cluster_links', canon: 'FM omits W219\'s two anchors to W220 ("CASE-…", "Open"), W220\'s real "Propose restructure" → W221 and the crumb links among W211 / W219 / W220 / W221 (survey F-15)',
    built: 'W219 → W220 has no edge (a list of cases would name borrowers — refused); W220 → W221 is a real link ("Propose restructure" → the honest restructure page) and W221 → W220 a real "Back to case"; W211 (`/lender/repayments`) gains a real link to W219 and the sub-navigation gains ONE Collections row — never a case or restructure row' },
  { id: 'fm_chain_ids_5b', canon: 'FM names the 5b chains by W13xx ids that exist nowhere: W1377–W1379, W1380–W1383, W1384–W1386',
    built: 'the canon\'s own files: W1377–W1379 → W2918–W2920, W1380–W1383 → W2914–W2917, W1384–W1386 → W2999–W3001 (survey F-15)' },
  { id: 'form_chain_names_w219', canon: 'W2914–W2917: the donor in the route comment, the crumb and every Back name W219, though both triggers ("Log contact", "Record promise") are W220\'s; W2915 "Back to edit" → W219 skips W2914',
    built: 'one `collections_form` entry on the TRIGGERING page (`/lender/collections/[id]?form=`), every state\'s Back → that case page; no state offers an earlier step' },
  { id: 'form_retry_to_confirm', canon: 'W2917 "Retry — back to confirm" → W219 on a FORM chain',
    built: 'a form chain has no confirm page; the failure state claims none and links back to the case page only (the W2956 precedent, 4c)' },
  { id: 'mutate_back_w219', canon: 'W2918–W2920 Cancel / Back → W219 even when opened from W220 ("Retry")',
    built: '`collections_act` (files W2918–W2920) on `/lender/collections` returns there; `case_act` (`files: []`, the 4a `application_act` precedent) on the case page returns to THAT case page' },
  { id: 'case_act_no_trigger', canon: 'W220 "Retry" (FM:161) — the canon\'s only trigger of the mutate chain from the case page, inside its error state',
    built: 'the case page reads nothing and so has no error state; `case_act` is reachable only as a query state and no control on the page leads to it (the 4c `kcc_act` precedent)' },
  { id: 'stale_delta_033', canon: 'W221\'s banner "Backend pending (DELTA-033) …" (survey C-3)',
    built: 'never copied; the honest gap is the opposite — the terms table exists and nothing of it is applied or shown' },
  { id: 'view_repayments_dead', canon: 'W219 "View repayments" — a dead `data-decor` button inside the "No cases" state',
    built: 'a REAL link to `/lender/repayments`, beside a real link to `/lender/portfolio/aging`, on the page itself (there is no "No cases" state)' },
  // ── PC-56 PARTNER-5c ──
  { id: 'canon_contract', canon: 'W214 "Your contract with the platform, measured (financial_partners.sla)"',
    built: 'the promise the platform PUBLISHED, in its own sentence (`partner5.sla.promise` / `partner5.sla.promiseNone`) beside "the platform sets this promise; it is not changed from this console" — never "your contract"' },
  { id: 'fm127_bulkbar', canon: 'FM:127 — W214 "2 highlighted of 14 monthly packs · same manifes…" classed `bulkbar` (truncated)',
    built: 'a static footer, not a selection bar; no table, no selection, no footer is drawn; its claim is refused (`manifest_format`)' },
  { id: 'fm128_avatar', canon: 'FM:128 — W214 the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn; the page carries the lender\'s own name from `/me`' },
  { id: 'fm130_td_filter', canon: 'FM:130 — W214 "May 2026", a `<td>` of the packs table, classed `filter`',
    built: 'there is no packs table and no month filter; nothing on the page filters' },
  { id: 'fm132_view_dashboard', canon: 'FM:132 — W214 "View dashboard", a dead `<button … data-decor>` FM registers as `nav-detail`',
    built: 'a REAL link to `/dashboard`' },
  { id: 'row_kebabs_5c', canon: 'W214 row kebabs "Actions for mp 1/2" (aria) — FM omits both',
    built: 'no rows, so no kebabs' },
  { id: 'fm_chain_ids_5c', canon: 'FM:129 / FM:131 name the chains by W13xx ids that exist nowhere: W1358/W1359 and W1360–W1362',
    built: 'the canon\'s own files: W1358/W1359 → W3009/W3010, W1360–W1362 → W3011–W3013 (survey F-15)' },
  { id: 'chain_routes_5c', canon: 'the chain pages W3009–W3013 as separate files',
    built: 'query states of `/lender/reports`: `?export=queued|ready` (DECOR + the mailbox line) and `?act=confirm|success|failure` (PARITY-DECOR re-read); Back returns to `/lender/reports`' },
  { id: 'sidebar_item', canon: 'the canon\'s ten-item lender sidebar, "SLA & reports" under Trust (survey C-15)',
    built: 'ONE sidebar item "SLA & reports" in the LENDING group, after Portfolio, for a lender only; an insurer never sees it and `lenderGate()` sends an insurer to its own dashboard' },
]);

/** Every canon file of PARTNER-5 (31), each with ONE verdict. 5a decided its 12; 5b decides its 13; 5c's 6 wait for their own wave. */
/** PC-56 PARTNER-5b (the 4c-7 rule): the 5b-pending value is DELETED now that 5b decides its 13. PC-56 PARTNER-5c: the last pending value is
 *  DELETED too — all 31 are decided and the type keeps only the four verdicts. */
export type Partner5Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR';
export const PARTNER5_CANON_FILES: readonly { file: string; wave: '5a' | '5b' | '5c'; verdict: Partner5Verdict; note: string }[] = Object.freeze([
  // ── 5a · THE BOOK IN ARREARS, AS COUNTS (12) ──
  { file: 'W223-partner-dpd-aging.html', wave: '5a', verdict: 'BUILT (read)', note: '/lender/portfolio/aging over GET /v1/partner/loans/dpd + GET /v1/partner/loans/counts (two audit rows, counts only): the platform\'s SIX rows — no due date recorded first, with the statement beside it, then not yet due and the four rows past a recorded due date — each a count and a bigint sum; the sum-check sentence with BOTH figures; the restructured count from the windowed counts read with the restructured note; computedAt. Every percentage, "arrears (missed inst.)", the five buckets and "current", "pre-NPA review", the cure-machinery paragraph, "nightly + live-adjusted", the credit-risk role and "plan settings" are refused by name. Export is DECOR + mailbox; Retry is the PARITY-DECOR re-read; "View portfolio" is a real link' },
  { file: 'W222-partner-writeoffs.html', wave: '5a', verdict: 'BUILT (read)', note: '/lender/portfolio/writeoffs over GET /v1/partner/loans/counts + GET /v1/partner/loans?status=written_off (keyset; two audit rows): the written-off count and outstanding over the loans OPENED in the window, with the window label and that caveat; the statement and the lockdown note (founder 5a-7); every written-off loan as LOAN FACTS (reference → the loan page, kind, the cooperative\'s public name, principal, outstanding, status, opened). Never a cause, reason, write-off date, actor, person, scheme, animal or death. "0.16% of book", "closes your books…", the Cause and Recovered-since columns, "both causes documented", the five gates, the post-write-off conduct, the dairy case and the insurance product rule, "recorded with cause evidence", "the gate exists", "Records are immutable", the board/committee view and "plan settings" are refused by name. Export is DECOR + mailbox; Retry is the PARITY-DECOR re-read; "View portfolio" is real' },
  { file: 'W2929-partner-dpd-export-queued.html', wave: '5a', verdict: 'DECOR', note: '/lender/portfolio/aging?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox' },
  { file: 'W2930-partner-dpd-export-ready.html', wave: '5a', verdict: 'DECOR', note: '?export=ready — no file, no row count, no checksum, no signed link' },
  { file: 'W2931-partner-dpd-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/lender/portfolio/aging?act=confirm — the module\'s only trigger is Retry, a genuine re-read of partner_loan_dpd(): no confirm step, no audit row of its own, no money' },
  { file: 'W2932-partner-dpd-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=success — the rows were read again; nothing was written' },
  { file: 'W2933-partner-dpd-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  { file: 'W3024-partner-writeoffs-export-queued.html', wave: '5a', verdict: 'DECOR', note: '/lender/portfolio/writeoffs?export=queued — no partner export plane; nothing is prepared for a board; write to the partners mailbox' },
  { file: 'W3025-partner-writeoffs-export-ready.html', wave: '5a', verdict: 'DECOR', note: '?export=ready — no file, no checksum, no signed link' },
  { file: 'W3026-partner-writeoffs-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/lender/portfolio/writeoffs?act=confirm — Retry is a genuine re-read of partner_loan_counts + partner_loans(status => written_off): no confirm step, no audit row of its own, no money' },
  { file: 'W3027-partner-writeoffs-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=success — the figures and the list were read again' },
  { file: 'W3028-partner-writeoffs-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  // ── 5b · COLLECTIONS THE PLATFORM DOES NOT DO (13) — decided by 5b (founder 5b-1 … 5b-5) ──
  { file: 'W219-partner-collections.html', wave: '5b', verdict: 'BUILT (honest)', note: '/lender/collections — an HONEST PAGE THAT READS NOTHING (the W217 shape: no partner read, no audit row, no error state; the state is the public flag map, `partner_console` OFF as OFF). The statement: a lender does not collect on this platform; the organisation that serves the farmer is the lender of record and services its own book; no borrower in arrears is named, contacted or ranked here. Beside it: where arrears are COUNTED (real links to /lender/repayments and /lender/portfolio/aging) with 5a\'s zero reasons reused by key and no figure printed; PARTNER-4b\'s code-of-conduct refusals reused by key; and the one true line as an ABSENCE — nothing on this platform restricts a borrower\'s selling because of a loan. "Take next case" is DECOR → W2918–W2920. The KPI tiles, the recovery rate, the named-case table, the bulk bar, the dairy inference, "collections role", "every contact is logged", "automatically past the DPD threshold" and "plan settings" are refused by name' },
  { file: 'W220-partner-collections-case.html', wave: '5b', verdict: 'BUILT (honest)', note: '/lender/collections/[id] — an HONEST PAGE THAT READS NOTHING; the `[id]` is a LOAN id and EVERY id prints the same page (no not-found, no existence oracle). There is no collections case on this platform; nothing about a borrower is shown or looked up — no name, phone, reason, contact, promise or meeting; the loan\'s own facts are on its loan page (a real link). The canon\'s TWO inputs are NEVER rendered: no input, select, textarea, label-for or form in the DOM. "Log contact" and "Record promise" are DECOR → W2914–W2917 with NO mailbox line; "Propose restructure" is a real link to W221. The name and phone, the case header, the family narrative and the cross-module "platform data", the re-consent and recording, the contact entries, the meeting with the lender\'s staff, the promise ladder, "what is off the table (platform-enforced)", the archive promise, "append-only and safe" and "every open is logged" are refused by name' },
  { file: 'W221-partner-restructure.html', wave: '5b', verdict: 'BUILT (honest)', note: '/lender/collections/[id]/restructure — an HONEST PAGE THAT READS NOTHING: a restructure is proposed and decided by the organisation that serves the farmer, not from this console; the lender is not a party to it on this platform and nothing of any proposal is shown; a restructure cannot yet be accepted or activated on the platform; the loan\'s status appears on its own page (a real link). "restructure ≠ default" kept as the platform\'s doctrine. "Take to mediation" is DECOR → W2999–W3001 and never repeats the canon\'s acceptance order. The stale backend banner, the terms comparison, the weather clause and the credit-record note, the asset-classification block, the acceptance flow, the comparison document, "versioned server-side", the three-people promise, the no-acceptance and starts-from-a-case states and the canon\'s role names are refused by name' },
  { file: 'W2914-partner-collections-form-form-error.html', wave: '5b', verdict: 'DECOR', note: '/lender/collections/[id]?form=error — the collections FORM chain, ONE entry on its triggering page (the 4c `kcc_form` shape) with NO mailbox line: there are no fields to put right, because no field exists' },
  { file: 'W2915-partner-collections-form-review.html', wave: '5b', verdict: 'DECOR', note: '?form=review — nothing was entered, nothing is shown back, no second person checks anything; the canon\'s "Back to edit" → W219 is a DELTA' },
  { file: 'W2916-partner-collections-form-success.html', wave: '5b', verdict: 'DECOR', note: '?form=success — nothing was recorded and the borrower is told nothing; the canon\'s mutate-chain body (audit trail · zero-sum) is refused' },
  { file: 'W2917-partner-collections-form-failure.html', wave: '5b', verdict: 'DECOR', note: '?form=failure — nothing was attempted; the canon\'s "Retry — back to confirm" is a DELTA (a form chain has no confirm page)' },
  { file: 'W2918-partner-collections-mutate-confirm.html', wave: '5b', verdict: 'DECOR', note: '/lender/collections?act=confirm — "Take next case" is a refused act and the page reads nothing, so there is nothing to confirm or re-read (the case page carries the same chain with `files: []`)' },
  { file: 'W2919-partner-collections-mutate-success.html', wave: '5b', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded' },
  { file: 'W2920-partner-collections-mutate-failure.html', wave: '5b', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed' },
  { file: 'W2999-partner-restructure-mutate-confirm.html', wave: '5b', verdict: 'DECOR', note: '/lender/collections/[id]/restructure?act=confirm — moving a proposal is the cooperative\'s act on the tenant plane, not a lender\'s; nothing is confirmed here' },
  { file: 'W3000-partner-restructure-mutate-success.html', wave: '5b', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded' },
  { file: 'W3001-partner-restructure-mutate-failure.html', wave: '5b', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed' },
  // ── 5c · THE PROMISE THE PLATFORM SETS (6) — decided by 5c (founder 5c-1 / 5c-2) ──
  { file: 'W214-partner-sla-reports.html', wave: '5c', verdict: 'BUILT (read)', note: '/lender/reports (a LENDING sidebar item for a lender only) over PARTNER-1a\'s GET /v1/partner/dashboard — its `sla` block only, one audit row per read, no new route: the platform\'s published decision promise in its own sentence (or that none is published) and "the platform sets this promise; it is not changed from this console"; the measured decision time over the last 30 days as COUNTS (decided; within the promise; after the promise) and two DURATIONS (median, nine in ten); the production-zero reason verbatim; the partners mailbox line in place of packs and escalations; "View dashboard" a real link. "Your contract", the disbursal and data-handling promises, the shared scoreboard, the decision share, the surge weeks and the documents pause, the satisfaction score, the conduct count, the monthly packs with their contents, schedule and keeping, the manifest footer, the three escalation lines, the role names and "plan settings" are refused by name. Export is DECOR + mailbox; Retry is the PARITY-DECOR re-read' },
  { file: 'W3009-partner-sla-export-queued.html', wave: '5c', verdict: 'DECOR', note: '/lender/reports?export=queued — no partner export plane and no pack: exports are not available, write to the partners mailbox' },
  { file: 'W3010-partner-sla-export-ready.html', wave: '5c', verdict: 'DECOR', note: '?export=ready — no file, no row count, no fingerprint, no signed link' },
  { file: 'W3011-partner-sla-mutate-confirm.html', wave: '5c', verdict: 'PARITY-DECOR', note: '/lender/reports?act=confirm — the only trigger is Retry, a genuine re-read of the promise and the decision times: no confirm step, no audit row of its own beyond the read, no money' },
  { file: 'W3012-partner-sla-mutate-success.html', wave: '5c', verdict: 'PARITY-DECOR', note: '?act=success — the figures were read again; nothing was written' },
  { file: 'W3013-partner-sla-mutate-failure.html', wave: '5c', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
]);

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain5Id = 'aging_export' | 'aging_act' | 'writeoffs_export' | 'writeoffs_act'
  | 'collections_form' | 'collections_act' | 'case_act' | 'restructure_act'
  | 'sla_export' | 'sla_act';
export interface Chain5Def {
  id: Chain5Id; wave: '5a' | '5b' | '5c'; param: string; page: string; surface: Partner5Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[];
  /** An export chain prints "exports are not available … write to the partners mailbox" + the mailbox FACT (founder 5a-8, 2b-1). */
  mailbox?: boolean;
  /** PC-56 PARTNER-5b (the 4c precedent): a chain of an HONEST page prints that page's founder-approved statement first. */
  statement?: string;
}
export const PARTNER5_CHAINS: readonly Chain5Def[] = Object.freeze([
  { id: 'aging_export', wave: '5a', mailbox: true, param: 'export', page: '/lender/portfolio/aging', surface: 'aging_export', states: ['queued', 'ready'],
    key: (s: string) => `partner5.chain.agingExport.${s}`, files: ['W2929', 'W2930'] },
  { id: 'aging_act', wave: '5a', param: 'act', page: '/lender/portfolio/aging', surface: 'aging_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.agingAct.${s}`, files: ['W2931', 'W2932', 'W2933'] },
  { id: 'writeoffs_export', wave: '5a', mailbox: true, param: 'export', page: '/lender/portfolio/writeoffs', surface: 'writeoffs_export', states: ['queued', 'ready'],
    key: (s: string) => `partner5.chain.writeoffsExport.${s}`, files: ['W3024', 'W3025'] },
  { id: 'writeoffs_act', wave: '5a', param: 'act', page: '/lender/portfolio/writeoffs', surface: 'writeoffs_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.writeoffsAct.${s}`, files: ['W3026', 'W3027', 'W3028'] },
  // ── PC-56 PARTNER-5b · the four DECOR chains of the three honest pages (founder 5b-5). All DECOR: the pages read nothing, so no Retry is a
  // re-read. Files are listed ONCE, on the page the canon's trigger lives on; each state's Back is the TRIGGERING page (never the canon's
  // W219 for a chain opened from the case page). The collections FORM chain carries NO `mailbox`: the platform must not offer to relay a
  // lender's contact with a cooperative's member (survey E4) — unlike 4c's `kcc_form`, which does.
  { id: 'collections_form', wave: '5b', param: 'form', page: '/lender/collections/[id]', surface: 'collections_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner5.chain.collectionsForm.${s}`, files: ['W2914', 'W2915', 'W2916', 'W2917'], statement: 'partner5.case.statement' },
  { id: 'collections_act', wave: '5b', param: 'act', page: '/lender/collections', surface: 'collections_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.collectionsAct.${s}`, files: ['W2918', 'W2919', 'W2920'], statement: 'partner5.collections.statement' },
  { id: 'case_act', wave: '5b', param: 'act', page: '/lender/collections/[id]', surface: 'case_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.caseAct.${s}`, files: [], statement: 'partner5.case.statement' },
  { id: 'restructure_act', wave: '5b', param: 'act', page: '/lender/collections/[id]/restructure', surface: 'restructure_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.restructureAct.${s}`, files: ['W2999', 'W3000', 'W3001'], statement: 'partner5.restructure.statement' },
  // ── PC-56 PARTNER-5c · the SLA page's two chains (founder 5c-1): the export is DECOR with the mailbox line; Retry is a genuine re-read ──
  { id: 'sla_export', wave: '5c', mailbox: true, param: 'export', page: '/lender/reports', surface: 'sla_export', states: ['queued', 'ready'],
    key: (s: string) => `partner5.chain.slaExport.${s}`, files: ['W3009', 'W3010'] },
  { id: 'sla_act', wave: '5c', param: 'act', page: '/lender/reports', surface: 'sla_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.slaAct.${s}`, files: ['W3011', 'W3012', 'W3013'] },
]);
export function chain5ById(id: Chain5Id): Chain5Def { return PARTNER5_CHAINS.find((c) => c.id === id) as Chain5Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain5State(id: Chain5Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain5ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
