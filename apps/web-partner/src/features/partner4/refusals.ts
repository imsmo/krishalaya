// apps/web-partner/src/features/partner4/refusals.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — FACTS, NEVER A BORROWER (survey E4)
// — WHAT THE LENDING CONSOLE DOES NOT CLAIM, BY NAME. PURE. The shape of features/partner3/refusals.ts: each refused canon claim is listed
// ONCE with where the canon makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map,
// and the claims guard (test/claims-guard.spec.ts, the `partner4.` scope + the extended `loan.` prefix) keeps the canon's false words out of
// every value. The sentences word the refused claims generically: no canon person, place, institution, bank, account tail, Aadhaar tail,
// avatar, loan number or figure appears in any value.
//
// THE SURFACES `Partner4Surface`: `queue` (W206) · `application` (W207) · `portfolio` (W212) · `loan` (W215) — built in 4a; `disbursements`
// (W210) · `disbursement_batch` (W218) · `repayments` (W211) — PARTNER-4b's; `kcc` (W216) · `kcc_drawls` (W217) — PARTNER-4c's, whose
// refusals are NOT registered here (their founder doors Q2 / Q3 / Q4 / Q9 / Q10 are not answered yet — unlike 3a, which could register 3b's
// because its doors were already shut). The chain surfaces are `queue_act` / `application_act` / `loan_act` (the loan mutate chain
// W2878–W2880, PARITY-DECOR: Retry is a re-read, and the two REAL acts — approve and reject — keep their own forms on W207),
// `loan_export` (the loan export chain W2876–W2877, DECOR: no partner export plane — the mailbox line), `portfolio_export`
// (W2891–W2892, DECOR) and `portfolio_act` (W2893–W2895, PARITY-DECOR).
// PARTNER-4b adds the three surfaces of WHAT A LENDER DOES NOT DISBURSE — `disbursements` (W210, the cooling-off
// pipeline as counts), `repayments` (W211, the collected window and the arrears buckets) and `disbursement_batch`
// (W218, an HONEST PAGE about whose money moves and who signs) — with their four chain surfaces:
// `disbursements_act` (W2863–W2865, DECOR — the plural chain, donor W210), `disbursement_act` (W2860–W2862, DECOR —
// the singular chain, donor W218), `repayments_export` (W2994–W2995, DECOR + the mailbox line) and `repayments_act`
// (W2996–W2998, PARITY-DECOR — Retry is a re-read).
// PARTNER-4c closes PARTNER-4 with THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP (founder 4c-1 … 4c-7): `kcc` (W216, an
// HONEST PAGE beside that loan's own facts — there is no KCC account on this platform) and `kcc_drawls` (W217, an
// HONEST PAGE with NOTHING of the ledger on it, because a drawl entry moves no money), with three chain surfaces —
// `kcc_export` (W2951–W2952, DECOR + the mailbox line, triggered from W217), `kcc_form` (W2953–W2956, the panel's
// first FOUR-STATE FORM chain, DECOR + the mailbox line) and `kcc_act` (W2957–W2959, DECOR — W217 reads nothing and
// W216's own retry is a plain re-request of its page, so there is no act and nothing to re-read here).
export type Partner4Surface =
  | 'queue' | 'application' | 'portfolio' | 'loan' | 'disbursements' | 'repayments' | 'disbursement_batch'
  | 'kcc' | 'kcc_drawls'
  | 'queue_act' | 'application_act' | 'loan_act' | 'loan_export' | 'portfolio_export' | 'portfolio_act'
  | 'disbursements_act' | 'disbursement_act' | 'repayments_export' | 'repayments_act'
  | 'kcc_export' | 'kcc_form' | 'kcc_act';
export interface Partner4Refusal { id: string; canon: string; surfaces: readonly Partner4Surface[]; key: string; why: string }

/** The three pages the loan mutate chain (W2878–W2880) is triggered from. */
const ACT: readonly Partner4Surface[] = ['queue_act', 'application_act', 'loan_act'];
/** The four export chains (W2876–W2877, W2891–W2892, W2994–W2995, W2951–W2952): all DECOR, all with the partners-mailbox line. */
const EXPORT: readonly Partner4Surface[] = ['loan_export', 'portfolio_export', 'repayments_export', 'kcc_export'];
/** The two DECOR chains of the one act this console refuses by name (W2860–W2862 singular, W2863–W2865 plural). */
const PAY: readonly Partner4Surface[] = ['disbursements_act', 'disbursement_act'];
/** PC-56 PARTNER-4c — the three chains of the KCC pair: the export chain, the FORM chain and the mutate chain. */
const KCC_CHAINS: readonly Partner4Surface[] = ['kcc_export', 'kcc_form', 'kcc_act'];
/** Every chain surface of PARTNER-4 (4a, 4b and 4c). */
const CHAINS: readonly Partner4Surface[] = [...ACT, ...EXPORT, ...PAY, 'portfolio_act', 'repayments_act', 'kcc_form', 'kcc_act'];
/** The four real screens of PARTNER-4a. */
const BUILT: readonly Partner4Surface[] = ['queue', 'application', 'portfolio', 'loan'];
/** Every page of the lending console after PARTNER-4b — the seven screens a lender can open. */
const ALL_PAGES: readonly Partner4Surface[] = [...BUILT, 'disbursements', 'repayments', 'disbursement_batch'];
/** PC-56 PARTNER-4c — every page of the lending console at the close of PARTNER-4: the nine screens a lender can open. */
const ALL_PAGES_4C: readonly Partner4Surface[] = [...ALL_PAGES, 'kcc', 'kcc_drawls'];
/** The KCC pair (W216, W217) and the three chains they carry. */
const KCC_ALL: readonly Partner4Surface[] = ['kcc', 'kcc_drawls', ...KCC_CHAINS];

export const PARTNER4_REFUSALS: readonly Partner4Refusal[] = Object.freeze([
  // ── W206 · the loan queue ──
  { id: 'docs_pending_state', canon: 'W206 lead "9-state machine: draft → submitted → docs_pending → under_review → …" and the chip "docs_pending 22"', surfaces: ['queue', 'application'],
    key: 'partner4.refusal.docsPendingState', why: 'the enum holds nine values but the machine wires SEVEN, and its own header reserves `docs_pending` and `closed` for deferred flows with no edge into either (loan-application.state.ts:4, :10-18) — the chip can never be non-zero (survey C-9)' },
  { id: 'sla_clock', canon: 'W206 column "SLA left ▴" and the cells "6h" / "31h" / "58h" · W207 header "SLA 6h" · the error reassurances "SLA clocks run server-side" and "SLA clock pauses on platform errors — never on you"', surfaces: ['queue', 'application', 'queue_act', 'application_act'],
    key: 'partner4.refusal.slaClock', why: 'nothing computes time left per application: `financial_partners.sla` is a PUBLISHED PROMISE read only by the dashboard (partner-dashboard.rules.ts:39-43) — no clock, no pause, no breach exists (survey §1A)' },
  { id: 'take_next', canon: 'W206 "Take next (SLA order)" (FM:61, chain-mutate)', surfaces: ['queue', 'queue_act'],
    key: 'partner4.refusal.takeNext', why: 'no assignment, lock or claim model exists for applications — there is nothing to take, and the list is newest-first, not by any order of waiting' },
  { id: 'credit_score', canon: 'W206 column "Score" and the cells "good · 742" / "good · 718" · W207 "Credit score — explainable, consent-shared. Score (300–900) 742 · good, model v2.4, computed 10 Jul" · W212 "Verified income underwriting — scores from real settlements"', surfaces: ['queue', 'application', 'portfolio'],
    key: 'partner4.refusal.creditScore', why: 'founder 4a-4: refused by name in Phase 1 — `credit_scores` has NO writer anywhere, zero rows, and `loan_applications.credit_score_id` is never set; scoring is listed as deferred (survey F-7, C-21)' },
  { id: 'score_factors', canon: 'W207 the four weighted factors (income consistency "24 on-time dairy cycles", sales history "42 orders, 20 months", dispute record "4/4 resolved clean", existing debt "utilisation data via consent") and "Base 400 + … = 742 — the arithmetic closes"', surfaces: ['application'],
    key: 'partner4.refusal.scoreFactors', why: 'founder 4a-4: no score exists, and the factors would disclose a farmer\'s whole platform life to a lender — the same cross-module reuse refused by name for claims (PARTNER-3 Q6)' },
  { id: 'platform_income', canon: 'W207 "Verified platform income (12mo) ₹4,73,460 — crops + dairy, from settlement statements, not self-declared" · W216 "His consented platform income supports it"', surfaces: ['application', 'kcc'],
    key: 'partner4.refusal.platformIncome', why: 'founder 4a-2 / 4a-4: no such aggregate exists on any axis, and a farmer\'s settlement history across modules is not a lender\'s to read' },
  { id: 'score_explained', canon: 'W207 "The farmer sees this same breakdown in Gujarati (right-to-explanation). You never see raw transactions — only the score and factors the consent covers."', surfaces: ['application'],
    key: 'partner4.refusal.scoreExplained', why: 'the principle is right and is the shape any future score must take; the claim is false — there is no score and no farmer-facing breakdown of one (founder 4a-4)' },
  { id: 'collateral_column', canon: 'W206 column "Collateral" and the cells "none (KCC)" / "nwr (wheat, LTV 68%)" / "group_guarantee" · W215 "The cow is the collateral logic"', surfaces: ['queue', 'loan'],
    key: 'partner4.refusal.collateralColumn', why: '`collateral_kind` is a field of the PRODUCT, not of an application or a loan (0011:69); the commodity, the live loan-to-value figure and the guarantee instrument are stored nowhere' },
  { id: 'borrower_identity', canon: 'W206 rows "<reference> <a person> · <an organisation>" · W207 header "<product> ₹3,00,000 — <a person>" · W215 header "Dairy cattle loan — <a person>" · W206 "group · 14 members" · W210 and W218 rows naming a person beside an amount · W211 rows "<a person> · ₹4,180"', surfaces: ALL_PAGES_4C,
    key: 'partner4.refusal.borrowerIdentity', why: 'founder 4a-2: loan facts only — never the borrower\'s user id or name, and never a group\'s member count (no partner policy reaches `finance_group_members`). The cooperative appears by its PUBLIC name, never its id (survey F-5, F-10)' },
  { id: 'document_rows', canon: 'W207 the documents table — a masked identity-number tail "verified", a land record "4.2 acre · 2 parcels · <a district>", "8 settlement statements (signed exports — verify offline anytime)", "via account-aggregator rails, purpose-bound"', surfaces: ['application'],
    key: 'partner4.refusal.documentRows', why: 'there is no per-application document table, no verification status, no identity-number tail, no land record and no account-aggregator integration anywhere; the product\'s required document TYPES are the only honest content (2c\'s shape)' },
  { id: 'voice_consent', canon: 'W207 "Granted 10 Jul 14:20 by <a person> — voice consent in Gujarati, recording on file" · "banker-desk pre-filled, member confirmed by voice"', surfaces: ['application'],
    key: 'partner4.refusal.voiceConsent', why: 'no consent artefact exists: no recording column, no media link, no assisted-application flow and no voice record — and nothing in the product writes the consent row at all (founder 4a-3, survey F-6)' },
  { id: 'effective_rate', canon: 'W207 "7.0% APR − 3.0% subvention = 4.0% effective (prompt-repayment)" · W215 "@ 10.5% APR" · W216 "7% APR (4% effective with prompt-repayment subvention)"', surfaces: ['application', 'loan', 'portfolio', 'kcc'],
    key: 'partner4.refusal.effectiveRate', why: 'founder 4a-7 (the 2c rule): rates are the lender\'s own stored INTEGERS in basis points, never a float; and no subvention condition is evaluated anywhere, so no net rate is earned by anything a borrower does' },
  { id: 'note_mandatory', canon: 'W207 "Decision recorded (`decision_note` mandatory)"', surfaces: ['application', 'application_act'],
    key: 'partner4.refusal.noteMandatory', why: 'the reject note is `.optional()` in the DTO and approve stores no note at all (create-loan-application.dto.ts); this wave prints the truth rather than changing a live tenant-plane contract — the DTO change is a question for the founder and the fintech owner (survey E7)' },
  { id: 'clarification', canon: 'W207 "Request clarification" (FM:75) · W206 "the borrower gets the exact list in Gujarati with photo examples"', surfaces: ['application', 'queue'],
    key: 'partner4.refusal.clarification', why: 'there is no document-request or clarification route on any realm, and `docs_pending` — the state it would move an application to — is unreachable' },
  { id: 'reason_delivered', canon: 'W207 "Reject (reason reaches him in Gujarati, with the fix)" (FM:74)', surfaces: ['application', 'application_act'],
    key: 'partner4.refusal.reasonDelivered', why: 'the note is stored on the application and NOTHING notifies the applicant — no consumer of any `fintech.loan_*` event exists (survey F-19)' },
  { id: 'predisclosure', canon: 'W207 anti-predatory rail "APR + every fee shown to the borrower in ₹ terms before consent — no surprises at disbursal"', surfaces: ['application'],
    key: 'partner4.refusal.predisclosure', why: 'I found no borrower-facing pre-consent disclosure surface in this platform, so the console does not claim one either way — an unproven promise is not printed as a fact' },
  { id: 'recovery_cap', canon: 'W207 anti-predatory rail "Recovery caps: deductions from milk bills/harvests never exceed the consented %" · W215 "deduction ≈ 23% of her avg fortnightly milk bill (cap 25%)"', surfaces: ['application', 'loan'],
    key: 'partner4.refusal.recoveryCap', why: 'the cap is the DAIRY module\'s gate, not this console\'s (loan.service.ts:82-84), and that file states it cannot verify the amount is the instalment due — a lender\'s screen must not claim a cap it does not enforce' },
  { id: 'documents_awaited', canon: 'W207 empty state "No documents uploaded yet — Documents the applicant submits for this loan will appear here as they\'re uploaded."', surfaces: ['application'],
    key: 'partner4.refusal.documentsAwaited', why: 'no document surface exists for an application, so nothing will ever appear there' },
  { id: 'routed', canon: 'W206 empty state "Queue clear — Every routed application is decided" · the queue lead "Applications routed to your institution"', surfaces: ['queue'],
    key: 'partner4.refusal.routed', why: 'nothing routes an application to a lender: the oracle admits what the APPLICANT consented to share with this lender for this application (0225) — a different thing, and the honest one' },
  { id: 'platform_roles', canon: 'W206 "Deciding needs credit-officer role" · W212 "Risk analytics need your bank\'s credit-risk role" · W215 "Needs servicing role" · W210/W218 "disbursal officer role" · W211 "collections role"', surfaces: ALL_PAGES_4C,
    key: 'partner4.refusal.platformRoles', why: 'the partner realm has FOUR roles (0225) — administrator, checker, maker, viewer — and none of the canon\'s role names is one of them' },
  { id: 'bulk_select', canon: 'W206 footer "3 highlighted of 14 under_review" (FM:57, classed `bulkbar`) and the row kebabs "Actions for lq 2" / "Actions for lq 3"', surfaces: ['queue'],
    key: 'partner4.refusal.bulkSelect', why: 'the footer is a static line of text, not a selection bar: nothing on this screen can be selected and no bulk route exists on any realm of the platform (survey §1A, F-21)' },
  { id: 'plan_settings', canon: 'W206–W215 flagged-off state "This module is switched off for this tenant/plan (feature flag) … See plan settings."', surfaces: ALL_PAGES_4C,
    key: 'partner4.refusal.planSettings', why: 'no plan-settings surface exists for a partner organisation (the 2a / 2c / 3a precedent); the console says it is switched off and that nothing is broken' },
  { id: 'terms_snapshot', canon: 'W207 "Product: <kind> · <rate> · limit ₹3,00,000 of ₹5,00,000 product max · repayment harvest_aligned" printed as the terms of the day she applied', surfaces: ['application'],
    key: 'partner4.refusal.termsSnapshot', why: 'founder 4a-6: a filed application stores NO rate or term — only a disbursed loan stamps its rate — so a re-priced product silently re-prices every open application\'s displayed terms (survey C-14). The page says the terms are the product\'s today, not a snapshot' },
  { id: 'consent_written', canon: 'W207 the consent panel printed as a live fact ("Granted 10 Jul … expires 09 Aug") and W212 "borrower-level drill-down stays consent-gated even here"', surfaces: ['application', 'portfolio'],
    key: 'partner4.refusal.consentWritten', why: 'founder 4a-3: the consent row that admits an application is written by NOTHING in the product (survey F-6) — so the page says no consent has been recorded for this application yet rather than showing an empty panel as news. And a LOAN is not consent-gated at all: `partner_own_book_loans` gates on `partner_id` alone (0090:146-147)' },
  // ── W212 · the portfolio ──
  { id: 'transferred_state', canon: 'W212 "6-state machine (active · overdue · restructured · closed · written_off · transferred)"', surfaces: ['portfolio', 'loan'],
    key: 'partner4.refusal.transferredState', why: '`transferred` is in the enum and NOTHING writes it; who owns a transferred loan is an open question (SEC §5 residual 5), so the console does not offer it as a state this platform supports' },
  { id: 'off_platform_book', canon: 'W212 "PAR > 30 1.9% … vs 4.8% your off-platform agri book"', surfaces: ['portfolio'],
    key: 'partner4.refusal.offPlatformBook', why: 'a figure about the lender\'s own business away from this platform, which the platform cannot know and will not invent' },
  { id: 'par_rate', canon: 'W212 "PAR > 30 1.9% outstanding basis (≈ ₹13,00,000), not arrears" · W211 "outstanding at risk ≈ ₹13,00,000 (PAR basis, see Portfolio)"', surfaces: ['portfolio', 'loan', 'repayments'],
    key: 'partner4.refusal.parRate', why: 'founder 4a-5: the numerator needs loans past a due date, and EVERY loan both rails open has its due date NULL (survey F-8) — so the figure is structurally zero and a rate over it would mislead either way. The console prints counts and bigint sums, never a share of the book' },
  { id: 'kind_chart', canon: 'W212 chart "Book by product kind" with five buckets and the aria "KCC 42%, crop 24%, WHR 14%, dairy 12%, SHG and others 8%"', surfaces: ['portfolio'],
    key: 'partner4.refusal.kindChart', why: 'the five buckets are a designer\'s grouping, not a vocabulary: the platform holds NINE `loan_kind` codes (and the schema comment\'s four extra are never seeded). The console prints the nine, an unresolved kind as "not recorded", and counts and sums rather than shares' },
  { id: 'written_off_share', canon: 'W212 "written_off (FY) 2 · ₹1,10,000 · 0.16% of book"', surfaces: ['portfolio'],
    key: 'partner4.refusal.writtenOffShare', why: 'founder 4a-7 / survey E9: the count and the bigint sum are printed; the share of the book is a ratio and is not' },
  { id: 'honest_attribution', canon: 'W212 "Why PAR stays low (honest attribution)": "Cash-flow-matched repayment (68% auto-deduction) — design, not luck" · "Verified income underwriting — scores from real settlements" · "Monsoon clause + FPO mediation keep temporary distress from becoming permanent default"', surfaces: ['portfolio'],
    key: 'partner4.refusal.honestAttribution', why: 'three claims, none true: the channel share needs an instalment plan that does not exist, there is no underwriting score at all, and nothing requires mediation before anything. The block titled "honest attribution" is the least honest on the screen' },
  { id: 'board_numbers', canon: 'W212 "Numbers your risk committee can take to the board." · "A 2025 drought year would test these numbers"', surfaces: ['portfolio'],
    key: 'partner4.refusal.boardNumbers', why: 'the figures on this page are counts and bigint sums of what the platform recorded in one window — they are not an analytics product, and the console does not tell a risk committee what it may conclude' },
  // ── W215 · one loan ──
  { id: 'maturity_term', canon: 'W215 "principal ₹1,60,000 @ <rate> · disbursed 09 Feb 2026 · 36 months" and "Maturity Feb 2029 · early-closure allowed"', surfaces: ['loan'],
    key: 'partner4.refusal.maturityTerm', why: 'founder 4a-5: `maturity_date` is NULL on every loan both rails open and a tenure is a RANGE on the product, not a term on a loan — so the page says no maturity date is recorded rather than printing a month it computed' },
  { id: 'next_due', canon: 'W215 "next due Fri 17 Jul" · W211 "Due this week ₹18,42,000 · 312 instalments"', surfaces: ['loan', 'portfolio', 'repayments'],
    key: 'partner4.refusal.nextDue', why: 'founder 4a-5: `next_due_date` is NULL on every loan, and there is no instalment plan anywhere — a repayment row is created AT PAYMENT (loan-repayment.entity.ts:2-3)' },
  { id: 'repayment_plan', canon: 'W215 section "Schedule & repayment history" with four future rows · "4 highlighted of 11 instalments to date"', surfaces: ['loan', 'repayments'],
    key: 'partner4.refusal.repaymentPlan', why: 'founder 4a-5: there is no pre-generated plan on this platform — the page prints the RECORDED history and nothing it has not been told' },
  { id: 'on_time', canon: 'W215 "11/11 on time" and the rows "paid on time" · W211 "Collected (7d) … 96.4% on-time"', surfaces: ['loan', 'portfolio', 'repayments'],
    key: 'partner4.refusal.onTime', why: 'a repayment row\'s due date IS the moment it was paid (loan.service.ts:51), so every repayment would be trivially punctual and the figure would mean nothing (survey §1D, E9)' },
  { id: 'milk_bill_figure', canon: 'W215 "deduction ₹4,180 ≈ 23% of her avg fortnightly milk bill (cap 25%)" · "The cow is the collateral logic: milk volume up 18% since purchase — the asset performs"', surfaces: ['loan'],
    key: 'partner4.refusal.milkBillFigure', why: 'founder 4a-2: a farmer\'s milk income, her animals and her production are on the other side of the wall — and the same screen\'s own consent block promises a lender does not see them (survey F-5)' },
  { id: 'destination', canon: 'W215 "disbursed 09 Feb 2026 (supplier-direct, cattle purchase)" · W210 column "Destination" and the bank / account strings · W216 "Drawl — drip top-up (supplier-direct)"', surfaces: ['loan', 'disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.destination', why: 'a loan has no destination on this platform: the wallet rail credits the borrower\'s platform wallet and the payout rail never executes; a bank account is a table this console holds NO privilege on (0231 asserts it)' },
  { id: 'ledger_anchors', canon: 'W215 "Ledger anchors — disbursal LTX-…71204 · fee LTX-…71205 · 11 repayment txns — every rupee traceable both sides"', surfaces: ['loan'],
    key: 'partner4.refusal.ledgerAnchors', why: 'a ledger transaction id is the PLATFORM\'s own money record — `ledger_entries`, `ledger_transactions` and `wallet_accounts` are excluded from every RLS pass and this console holds nothing on them. And there is no fee transaction at all' },
  { id: 'origination_fee', canon: 'W215 "fee LTX-…71205" · W210 "Platform origination fee posts to ledger (origination_fee_txn_id) — your bank pays it, itemised" · W218 "Origination fees pre-computed: ₹4,600 total (charged to bank)"', surfaces: ['loan', 'portfolio', 'disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.originationFee', why: 'founder 4a-5: `loans.origination_fee_txn_id` is written by NOTHING, the revenue leg is listed as deferred, and no fee posting exists on either rail — so nothing is charged to a lender today and the console does not say it is (survey F-8)' },
  { id: 'foreclosure_fee', canon: 'W215 "early-closure allowed, zero foreclosure fee (anti-predatory)"', surfaces: ['loan'],
    key: 'partner4.refusal.foreclosureFee', why: 'TRUE BY ABSENCE, and printed as the absence it is: nothing on this platform charges a fee for closing a loan early — a loan simply closes when its outstanding reaches zero (loan.entity.ts:38-41)' },
  { id: 'retention_promise', canon: 'W215 "Loan not found — Closed loans stay viewable for 7 years."', surfaces: ['loan'],
    key: 'partner4.refusal.retentionPromise', why: 'founder 4a-7 (carried from 2a / 2b / 3b): no retention promise is printed until a policy is set' },
  { id: 'contact_tools', canon: 'W215 "borrower contact tools live in Collections with their own logging" · W211 "every borrower contact is logged" and the whole collections code of conduct', surfaces: ['loan', 'portfolio', 'repayments'],
    key: 'partner4.refusal.contactTools', why: 'there is no contact engine, no contact log, no contact-hours window, no mediation gate and no suspension mechanism anywhere on this platform (survey F-22)' },
  { id: 'disbursal_act', canon: 'W206 / W207 the disbursal path after approval · W210 "Disburse ready batch" · W218 "Co-approve — disburse now" and "funds leave YOUR bank rails"', surfaces: [...ALL_PAGES, ...PAY],
    key: 'partner4.refusal.disbursalAct', why: 'founder 4a-1 and the PARTNER-0 rule: the money is the cooperative\'s own, it is the lender of record, and it acts from its own console — the API refuses a partner\'s attempt by name and there is no route here that could try' },
  // ── the chains (W2876–W2877 export, W2878–W2880 mutate, W2891–W2892 export, W2893–W2895 mutate) ──
  { id: 'export_file', canon: 'W2876 / W2891 "audit-stamped, checksummed, delivered by signed URL" · W2877 / W2892 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged"', surfaces: [...EXPORT, 'loan', 'portfolio', 'repayments'],
    key: 'partner4.refusal.exportFile', why: 'founder 4a-7 (2b-1): there is no partner export plane in Phase 1 (P2-B6) — the receipt is true only of the tenant exports plane. The console names the partners mailbox instead' },
  { id: 'chain_zero_sum', canon: 'W2878 / W2893 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: CHAINS,
    key: 'partner4.refusal.chainZeroSum', why: 'nothing reached from these pages moves a rupee, so there is nothing to reconcile' },
  { id: 'chain_on_call', canon: 'W2880 / W2895 "repeated failures page the on-call"', surfaces: CHAINS,
    key: 'partner4.refusal.chainOnCall', why: 'no paging from a partner page exists' },
  { id: 'chain_audit', canon: 'W2879 / W2894 "View audit trail" · "the audit trail has the entry (actor · time · reason · before/after)"', surfaces: CHAINS,
    key: 'partner4.refusal.chainAudit', why: 'a re-read writes nothing but its own read row, and the console has no audit-trail page; the two REAL acts (approve, reject) do write a trail, and they are on the application page, not here' },
  // ══ PC-56 PARTNER-4b · W210 · the cooling-off pipeline (founder 4b-4 / 4b-6 / 4b-7) ══════════════════════════════════════════════════════
  { id: 'money_destination', canon: 'W210 "Approved → cooling-off lapsed → disburse. Money goes to the borrower\'s verified account (or supplier-direct for input loans) — never to intermediaries."', surfaces: ['disbursements', 'disbursement_batch', ...PAY],
    key: 'partner4.refusal.moneyDestination', why: 'founder 4b-4 (MONEY): whichever of the two rails is used, the money is the cooperative\'s own. The wallet rail credits the borrower\'s PLATFORM WALLET, not a bank account (loan-application.service.ts:127); the bank rail queues a payout that nothing executes (jobs/loan-disbursement-execute.handler.ts:33-38); and "supplier-direct" exists only as a label on a KCC drawl entry with no money attached (survey §1C)' },
  { id: 'ready_batch_act', canon: 'W210 "Disburse ready batch (8 · ₹9,20,000)" (FM:92, classed `filter` — the worst mis-class in the register, because a `filter` is licensed to stay a dead button)', surfaces: ['disbursements', 'disbursements_act'],
    key: 'partner4.refusal.readyBatchAct', why: 'founder 4b-4 and the PARTNER-0 rule: there is no partner route that pays anybody, and the one a partner could reach is refused by name by the API itself (PARTNER_CANNOT_DISBURSE). The control on this page leads to a sentence, never to money' },
  { id: 'borrower_destination_columns', canon: 'W210 columns "Borrower" and "Destination" and the cells "<a bank> ••<four digits> (verified)" / "supplier-direct (cattle purchase, dairy loan)" · W218 the same two columns', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.borrowerDestinationColumns', why: 'founder 4b-6: the borrower is the wall, and a bank account is a table this console holds NOTHING on — not a table privilege, not one column (0232 asserts it over nine tables). There is no destination model for a payment on this platform at all' },
  { id: 'auto_moves_to_ready', canon: 'W210 row "lapses today 17:05 / auto-moves to ready" · W218 state "Batches assemble automatically as cooling-off windows lapse"', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.autoMovesToReady', why: 'nothing moves and nothing assembles: the cooling-off instant is a stored timestamp that a QUERY compares with now(), and a batch is written only when a person at the cooperative calls for one (survey §1C, §1I)' },
  { id: 'loan_with_schedule', canon: 'W210 "On disbursal (atomic) 1 Application → disbursed ; servicing loan record created (loans) with schedule"', surfaces: ['disbursements', 'repayments'],
    key: 'partner4.refusal.loanWithSchedule', why: 'the flip and the servicing row are real and happen in ONE transaction; "with schedule" is not — there is no instalment plan on this platform and the new loan is opened with its next due date and its maturity date both empty (survey F-8, founder 4b-7)' },
  { id: 'sanction_letter', canon: 'W210 "Borrower gets the sanction letter PDF + first-due date, in Gujarati, same minute (outbox)" · W218 "sanction letters + first-due dates go out in Gujarati per confirmation"', surfaces: ['disbursements', 'disbursement_batch', ...PAY],
    key: 'partner4.refusal.sanctionLetter', why: 'three claims, none true: there is no such document anywhere on the platform, there is no first due date (it is empty on every loan), and NOTHING consumes the lending events to tell a borrower anything (survey F-19)' },
  { id: 'double_funding_absolute', canon: 'W210 "Idempotency — Batch disbursal is idempotent per application — a retried batch skips already-disbursed loans. Double-funding is impossible, not just unlikely." · W218 "double-funding impossible by idempotency, not by care"', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.doubleFundingAbsolute', why: 'founder 4b-2: it was NOT impossible and idempotency was never what made it so. One rail refused an application the other had taken; the other consulted nothing, so a borrower could be paid twice and owe once. THIS WAVE shut that second door by name in the tenant plane — and the console still does not print an absolute, because what is guaranteed is one application, one rail, refused by name (survey F-3)' },
  { id: 'bank_maker_checker', canon: 'W210 "Disbursals recorded · maker-checker at your bank\'s side honoured via partner API"', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.bankMakerChecker', why: 'the machine interface has NOT ONE mutation by design (partner-api.controller.ts:8-10), so there is no route by which a lender\'s own approval could reach this platform or be honoured by it (survey F-2)' },
  { id: 'preflight_not_yours', canon: 'W210 empty state "Approved loans awaiting disbursal will appear here as a batch once they clear pre-flight checks"', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.preflightNotYours', why: 'the pre-flight is REAL and it is the cooperative\'s, run on its own plane when it prepares a batch: not approved, still cooling off, no approved amount, no verified account, already taken. A lender\'s console cannot run it and does not pretend to (survey §1C, §1I)' },
  { id: 'bank_limit_delegation', canon: 'W210 "batches over your bank\'s limit need co-approval" · W218 "amounts over your delegation escalate automatically"', surfaces: ['disbursements', 'disbursement_batch'],
    key: 'partner4.refusal.bankLimitDelegation', why: 'no limit, no delegation and no escalation exists anywhere on this platform — not per organisation, not per person, not per amount' },
  { id: 'pipeline_bulk_select', canon: 'W210 footer "3 highlighted of 14 in pipeline" and the row kebabs "Actions for db 1" / "Actions for db 2" (both omitted by FLOWMAP)', surfaces: ['disbursements'],
    key: 'partner4.refusal.pipelineBulkSelect', why: 'nothing on this page can be selected and there is no bulk route on any realm of the platform: the canon\'s footer is a static line of text (survey F-21)' },
  // ══ PC-56 PARTNER-4b · W211 · the repayments a lender is told about (founder 4b-5 / 4b-6 / 4b-7) ═════════════════════════════════════════
  { id: 'channel_vocabulary', canon: 'W211 lead "Channels that match farm cash flow: upi · milk_bill_deduction · harvest_settlement · cash_partner" and the per-row channel cells', surfaces: ['repayments'],
    key: 'partner4.refusal.channelVocabulary', why: 'founder 4b-6: HOW a repayment was taken is not on this axis at all — the column was revoked from the lending grant in 0231 and 0232 re-asserts it, because it alone would say that this borrower is a dairy member of a cooperative and that her cheque was tapped. And the vocabulary is not one: the column has no constraint and no registered set, and two of the canon\'s four values are written by nothing (survey F-5, F-24)' },
  { id: 'due_this_week', canon: 'W211 KPI "Due this week ₹18,42,000 · 312 instalments" and the column "Due ▴" with a per-row instalment', surfaces: ['repayments'],
    key: 'partner4.refusal.dueThisWeek', why: 'founder 4b-7: nothing on this platform is due, ever, because no loan carries a next due date and no instalment plan exists. The honest figure is what was RECORDED as paid in a window, and that is what this page prints (survey F-8)' },
  { id: 'auto_deduction_share', canon: 'W211 "68% via auto-deduction channels" · W212 "Cash-flow-matched repayment (68% auto-deduction) — design, not luck"', surfaces: ['repayments'],
    key: 'partner4.refusal.autoDeductionShare', why: 'founder 4b-7 / survey E9: a share needs a plan to be a share OF, and the way each repayment was taken is off this axis — so the figure has neither a numerator nor a denominator here' },
  { id: 'nudge_stage', canon: 'W211 KPI "Overdue 1–30 · 31 loans · ₹4,86,000 · gentle-nudge stage (Gujarati voice)"', surfaces: ['repayments'],
    key: 'partner4.refusal.nudgeStage', why: 'founder 4b-5: there is no contact engine, no stage, no voice call and no message of any kind on this platform — nobody is nudged, gently or otherwise' },
  { id: 'mediation_first', canon: 'W211 "FPO-mediated restructure talks first" and the row "FPO mediation scheduled 16 Jul" · W212 "Monsoon clause + FPO mediation keep temporary distress from becoming permanent default"', surfaces: ['repayments'],
    key: 'partner4.refusal.mediationFirst', why: 'a restructure can carry a mediation STATUS and nothing requires it before anything else, and nothing schedules a meeting with anybody (0069:152; survey §1D)' },
  { id: 'collections_privacy_rule', canon: 'W211 row "(name withheld — collections privacy applies beyond 15 DPD)"', surfaces: ['repayments'],
    key: 'partner4.refusal.collectionsPrivacyRule', why: 'founder 4b-6: there is no such rule, and the canon breaks its own on the next two rows by naming two borrowers. The rule here is the opposite and it is absolute: a borrower is never named on a lender\'s screen, on any day, at any number of days late' },
  { id: 'reminder_sent', canon: 'W211 row "reminder T-3 sent" · empty state "Between cycles the book breathes — reminders are already scheduled"', surfaces: ['repayments', 'repayments_act'],
    key: 'partner4.refusal.reminderSent', why: 'founder 4b-5: no reminder is sent and none is scheduled — there is no reminder job, no template and no consumer of any lending event that would notify a borrower (survey F-19)' },
  { id: 'code_of_conduct', canon: 'W211 "Collections code of conduct (platform-enforced)" — the block as a whole, printed to a lender as a thing the platform ENFORCES', surfaces: ['repayments', 'repayments_act', 'repayments_export'],
    key: 'partner4.refusal.codeOfConduct', why: 'founder 4b-5, and this is the P0 trust line of the wave: the platform enforces NONE of it. There is no contact engine, no log, no hours window, no mediation gate, no prohibition and no suspension anywhere in the codebase. It is a promise made to the FARMER through the lender\'s screen, so it is refused by name and recorded as something the platform intends to build rather than something it claims (survey F-22)' },
  { id: 'contact_hours', canon: 'W211 code of conduct: "contact hours 08:00–19:00 only · Gujarati first"', surfaces: ['repayments'],
    key: 'partner4.refusal.contactHours', why: 'founder 4b-5: no hours window is evaluated anywhere because no contact of any kind happens through this platform — there is nothing for a window to govern' },
  { id: 'contact_log', canon: 'W211 code of conduct: "every borrower contact is logged" · W215 "borrower contact tools live in Collections with their own logging"', surfaces: ['repayments'],
    key: 'partner4.refusal.contactLog', why: 'founder 4b-5: there is no contact log table, no contact record and no contact tool — so nothing is logged, and a lender must not be told that its conduct is being watched when it is not' },
  { id: 'third_party_agents', canon: 'W211 code of conduct: "no third-party agents on platform-originated loans"', surfaces: ['repayments'],
    key: 'partner4.refusal.thirdPartyAgents', why: 'founder 4b-5: nothing on this platform knows who collects a debt, so nothing can prohibit anybody from doing it — the prohibition the canon prints does not exist as code, as a term or as a check' },
  { id: 'partner_suspension', canon: 'W211 code of conduct: "Violation = partner suspension."', surfaces: ['repayments'],
    key: 'partner4.refusal.partnerSuspension', why: 'founder 4b-5: there is no suspension mechanism for a partner organisation on this platform, no violation record to trigger one and no process behind it' },
  { id: 'rides_dairy_cycle', canon: 'W211 row "<a person> · ₹4,180 · milk_bill_deduction · rides Friday cycle"', surfaces: ['repayments'],
    key: 'partner4.refusal.ridesDairyCycle', why: 'the dairy cycle genuinely does take an instalment inside its own transaction — but WHICH borrower was tapped and on which day is exactly what a lender is not shown (founder 4b-6). The truth it rests on is printed as a statement about the platform, never as a row about a family' },
  { id: 'repayments_bulk_select', canon: 'W211 footer "3 highlighted of 312 due this week" (FM:105, classed `bulkbar`) and the three row kebabs "Actions for rp 1/2/3" (all omitted by FLOWMAP)', surfaces: ['repayments'],
    key: 'partner4.refusal.repaymentsBulkSelect', why: 'a static line of text in the canon; nothing is selectable here and no bulk route exists on any realm (survey F-21)' },
  // ══ PC-56 PARTNER-4b · W218 · whose money moves and who signs (founder 4b-3 / 4b-4 / 4b-6) ═══════════════════════════════════════════════
  { id: 'awaiting_coapproval', canon: 'W218 header "Disbursement batch — 13 Jul awaiting your co-approval"', surfaces: ['disbursement_batch', ...PAY],
    key: 'partner4.refusal.awaitingCoApproval', why: 'nothing on this platform waits for a lender: a batch is prepared and confirmed in the SAME request, by the cooperative, on its own plane (survey §1I, F-2)' },
  { id: 'maker_checker_claim', canon: 'W218 "maker: platform (auto-assembled) · checker: your disbursal officer · funds leave YOUR bank rails, the platform orchestrates"', surfaces: ['disbursement_batch', 'disbursements'],
    key: 'partner4.refusal.makerCheckerClaim', why: 'founder 4b-3 / 4b-4: three claims, none true. Nothing assembles a batch; there is no such role and no lender person signs anything here; and the money that moves is the cooperative\'s own — this platform never moves a lender\'s money and a lender never moves the cooperative\'s' },
  { id: 'second_signature', canon: 'W218 "Co-approval recorded both sides" and the whole maker-checker claim of W210 and W218', surfaces: ['disbursement_batch', 'disbursements', ...PAY],
    key: 'partner4.refusal.secondSignature', why: 'founder 4b-3, and it is the hardest sentence in this wave: the "second signature" on a batch today is a user id TYPED INTO THE REQUEST by the one person making it, and the only check is that the id differs from their own. Nothing verifies that the colleague exists in that organisation, holds the permission, or was ever asked — and the audit row then records the name that was typed. A real two-session maker-checker is named as still owed (P4-B5), and until it ships this console says so rather than showing a signature nobody gave (survey F-2)' },
  { id: 'coapprove_act', canon: 'W218 "Co-approve — disburse now" (FM:146, classed `nav-detail` with the placeholder target "sibling detail by context")', surfaces: ['disbursement_batch', 'disbursement_act'],
    key: 'partner4.refusal.coApproveAct', why: 'founder 4b-4: there is nothing to co-approve, nobody to co-approve it with and no route that would accept it. The control leads to a sentence' },
  { id: 'batch_contents_table', canon: 'W218 "Batch contents" (Application · Borrower · Amount ▾ · Destination) and the rows "+ 6 more · all verified accounts · ₹5,60,000 · 4 bank · 2 supplier-direct"', surfaces: ['disbursement_batch'],
    key: 'partner4.refusal.batchContentsTable', why: 'founder 4b-6: the items of a batch carry the BORROWER\'S USER ID, which is precisely what the wall removes — and this console holds no privilege on the batch tables at all (0232 asserts it over nine tables). Counts and sentences are printed here; never a row of people' },
  { id: 'product_rule_engine', canon: 'W218 row "(2nd cattle loan — dairy product allows 2 active, herd-size-based)"', surfaces: ['disbursement_batch'],
    key: 'partner4.refusal.productRuleEngine', why: 'there is no product-rule engine: a product\'s eligibility rules are a JSON field that NOTHING evaluates (it is only ever selected and returned), and no rule about a family\'s animals exists anywhere' },
  { id: 'cattle_insurance_rule', canon: 'W218 pre-flight "2/2 livestock loans carry active cattle insurance (product rule since Apr 2026 — the write-off lesson, enforced)"', surfaces: ['disbursement_batch'],
    key: 'partner4.refusal.cattleInsuranceRule', why: 'nothing joins a loan to a policy when money moves, and no rule is evaluated at all — "enforced" is the word that turns an aspiration into a trust breach (survey §1I)' },
  { id: 'auto_retries', canon: 'W218 "A failed transfer auto-retries and never blocks its batch-mates."', surfaces: ['disbursement_batch', ...PAY],
    key: 'partner4.refusal.autoRetries', why: 'the second half is TRUE and is kept in the platform\'s own words (a line that cannot be written is listed and the rest continues); the first is not — the retry belongs to a payment pipeline that has never run, and nothing on this platform retries anything today' },
  { id: 'batch_added_to', canon: 'W218 empty state "No disbursements in this batch yet — Approved loans queued for disbursal will appear here as they\'re added to the batch."', surfaces: ['disbursement_batch'],
    key: 'partner4.refusal.batchAddedTo', why: 'a batch is never added to: it is written whole, in one transaction, or not at all — and if its totals disagree it is abandoned before a single row is written (survey §1I)' },
  // ══ PC-56 PARTNER-4c · W216 · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP (founder 4c-2 / 4c-3 / 4c-6) ═══════════════════════════════════
  { id: 'kcc_account_entity', canon: 'W216 header "KCC account — <a person> · active · **revolving**" and the reference "KCC-2026-0031" printed as an account number', surfaces: KCC_ALL,
    key: 'partner4.refusal.kccAccountEntity', why: 'founder 4c-2: there is NO KCC account on this platform — no table, no column and no line of code. A "KCC loan" is an ordinary `loans` row whose product\'s `loan_kind` code is `kcc`; there is no account reference anywhere (survey §1G, C-6)' },
  { id: 'credit_limit', canon: 'W216 "limit ₹4,00,000" · "Limit set from scale-of-finance …" · W217 "never on the unused limit"', surfaces: ['kcc', 'kcc_drawls', 'kcc_form', 'kcc_act'],
    key: 'partner4.refusal.creditLimit', why: 'founder 4c-2: `grep -rn \'kcc_limit|limit_review|credit_limit\' krishalaya` → 0. The nearest things are a PRODUCT ceiling (`loan_products.max_amount_minor`) and what a loan was opened with (`loans.principal_minor`) — neither is an account limit (survey §1G)' },
  { id: 'available_headroom', canon: 'W216 "available ₹1,80,000" · "Utilisation 55% healthy — headroom for emergencies"', surfaces: ['kcc'],
    key: 'partner4.refusal.availableHeadroom', why: 'the figure is limit − drawn, so it falls with the limit: there is nothing to subtract from and nothing to subtract (survey §1G)' },
  { id: 'renewal_concept', canon: 'W216 "renewal due Feb 2027" and lifecycle 4 "Annual renewal — one visit or fully remote if platform income data is consented; limit re-based on actual cropping"', surfaces: ['kcc'],
    key: 'partner4.refusal.renewalConcept', why: 'founder 4c-2: no renewal date, no renewal concept and no re-basing exists in any table, migration or line of code; a loan runs until its outstanding reaches zero and then closes (loan.entity.ts:38-41)' },
  { id: 'scale_of_finance', canon: 'W216 lifecycle 1 "Limit set from scale-of-finance × acreage (3.5 acre cotton + 1.0 acre summer cumin) + 10% escalation/yr — worksheet attached"', surfaces: ['kcc', 'kcc_form'],
    key: 'partner4.refusal.scaleOfFinance', why: 'founder 4c-2 and the WALL: no scale-of-finance table, no acreage input, no yearly escalation rule and no worksheet document exists — and a farmer\'s crops and land are not a lender\'s to read (survey §1G)' },
  { id: 'seasonal_drawls', canon: 'W216 lifecycle 2 "Seasonal drawls — kharif inputs drawn Jun–Jul (current ₹2,20,000), repaid at harvest sale via `harvest_settlement`"', surfaces: ['kcc'],
    key: 'partner4.refusal.seasonalDrawls', why: 'nothing on this platform marks a loan or a ledger entry as belonging to a season, and `harvest_settlement` is a bare string no code ever writes (survey §1D, F-24)' },
  { id: 'interest_engine', canon: 'W216 lifecycle 3 "Interest applied on drawn balance only, monthly" · "Interest accrued ₹917 June applied · July accrues daily on drawn balance only" · the error state "Drawl and interest engines run server-side"', surfaces: ['kcc', 'kcc_drawls'],
    key: 'partner4.refusal.interestEngine', why: 'founder 4c-1: NOTHING computes or applies interest. An `interest` entry is whatever amount a desk member types (servicing.service.ts:28-41) and `accrual_basis` — the jsonb column 0069:30-32 created so the arithmetic would be STORED — is never written (survey F-4)' },
  { id: 'subvention_credited', canon: 'W216 lifecycle 3 "subvention credited on prompt seasonal repayment" · "Repay-by for subvention 31 Jan 2027" · "Prompt seasonal repayment keeps him at 4% effective"', surfaces: ['kcc'],
    key: 'partner4.refusal.subventionCredited', why: 'founder 4c-6 (MONEY): nothing credits anything to anybody, and no condition about repaying early is evaluated anywhere. A product\'s subsidy figure is stored data in integer basis points and nothing acts on it (survey §1G)' },
  { id: 'utilisation_ratio', canon: 'W216 "Utilisation 55% healthy — headroom for emergencies"', surfaces: ['kcc'],
    key: 'partner4.refusal.utilisationRatio', why: 'founder 4c-6 / survey E9: no limit ⇒ no utilisation, and this console prints counts and bigint sums, never a share — and never a float percentage' },
  { id: 'limit_review_block', canon: 'W216 "Limit review (annual, maker-checker) — Proposed FY27: ₹4,40,000 (+10% escalation, cropping unchanged). His consented platform income supports it (12mo verified sales cover 1.4× the limit)."', surfaces: ['kcc', 'kcc_form'],
    key: 'partner4.refusal.limitReviewBlock', why: 'founder 4c-2: there is no limit, no review of one, no table, no route, no permission and no maker-checker for it — and the income claim is the same fabrication the application screen was refused for (survey F-7, §1G)' },
  { id: 'limit_change_notice', canon: 'W216 "Limit changes recorded · borrower notified in Gujarati with the worksheet · never reduced mid-season"', surfaces: ['kcc', 'kcc_form'],
    key: 'partner4.refusal.limitChangeNotice', why: 'three claims, none true: nothing is recorded, nobody is notified in any language (no consumer of any lending event exists — survey F-19), and no rule protects anything mid-season' },
  { id: 'limit_review_act', canon: 'W216 "Record limit review" (FM:138, `chain-form` → W2953–W2956)', surfaces: ['kcc', 'kcc_form'],
    key: 'partner4.refusal.limitReviewAct', why: 'founder 4c-6: DECOR, refused by name. There is no limit, so there is no review; there is no table, no route, no permission and no form — the four canon form pages carry no input, label or select at all (survey C-8, §1S)' },
  { id: 'kcc_accounts_opened', canon: 'W216 empty state "No KCC accounts — KCC applications approved in the queue open revolving accounts here." + "View queue"', surfaces: ['kcc'],
    key: 'partner4.refusal.kccAccountsOpened', why: 'an approved application opens an ordinary `loans` row when the money is paid, exactly like any other product (loan-application.service.ts:120-124); nothing opens an account of this kind (survey §1G)' },
  { id: 'drawn_balance', canon: 'W216 "drawn ₹2,20,000" and "This season — Drawn (kharif) ₹2,20,000"', surfaces: ['kcc', 'kcc_drawls'],
    key: 'partner4.refusal.drawnBalance', why: 'founder 4c-1: the drawn balance is the only REAL figure of the canon\'s KCC account — and it is the running balance of a ledger that moves no money, so no drawn amount and no balance reaches a lender in this wave (survey F-4, §1 rupee 6)' },
  { id: 'borrower_ledger_mirror', canon: 'W216 "the console shows HIM this too, in Gujarati, with the exact date and amount that preserves the subvention" · W217 "He sees this same ledger in Gujarati — one truth, two languages"', surfaces: ['kcc', 'kcc_drawls'],
    key: 'partner4.refusal.borrowerLedgerMirror', why: 'there is NO borrower-facing KCC surface anywhere: `grep -rn \'kcc\' apps/mobile/src` → nothing, and the only `kcc` in the tenant console is an i18n key. The promise is made to a farmer who would never be told (survey §1H, F-19)' },
  { id: 'no_limit_reviews_state', canon: 'W216 empty state "No limit reviews yet — Annual reviews of this account\'s credit limit will appear here once the first one is recorded."', surfaces: ['kcc', 'kcc_form'],
    key: 'partner4.refusal.noLimitReviewsState', why: 'DECOR: there is nothing to record a first one of, so the page says the thing is ABSENT rather than awaited (the 3b rule for an empty state with no table behind it)' },
  // ══ PC-56 PARTNER-4c · W217 · THE LEDGER THAT MOVES NO MONEY (founder 4c-1 — the drawl stays off the console) ═══════════════════════════
  { id: 'drawl_ledger_rows', canon: 'W217 the whole table — Date ▾ · Entry · Drawl · Repaid · Interest · Balance — and its four rows', surfaces: ['kcc_drawls', 'kcc_export', 'kcc_act'],
    key: 'partner4.refusal.drawlLedgerRows', why: 'founder 4c-1, taken under standing authority: a drawl entry records a farmer\'s DEBT and moves no money — no wallet posting, no `ledger_txn_id`, no idempotency key, no second person, no flag — so no entry kind, date, amount or running balance reaches a lender until it does (survey F-4)' },
  { id: 'drawl_narrative', canon: 'W217 rows "Drawl — drip top-up (supplier-direct)" / "Drawl — seed + fertiliser (kharif kit)" / "Repayment — rabi wheat sale (`harvest_settlement`)"', surfaces: ['kcc_drawls', 'kcc_export'],
    key: 'partner4.refusal.drawlNarrative', why: 'founder 4c-1 and the WALL: the narrative is free text about what a farmer bought and sold, written by the cooperative\'s desk — her business and the cooperative\'s, never a lender\'s (survey §1H)' },
  { id: 'accrual_arithmetic', canon: 'W217 row "Interest applied (Jun — daily accrual on drawn balance: ₹1,60,000 × 12d + ₹2,20,000 × 13d @ 7%)"', surfaces: ['kcc_drawls'],
    key: 'partner4.refusal.accrualArithmetic', why: 'the arithmetic is NOT stored: `accrual_basis` jsonb exists for exactly this and `insertKccEntry` writes nine columns and not that one — so the sum in the canon is free text a desk member typed (survey F-4, §1H)' },
  { id: 'interest_on_drawn_only', canon: 'W217 footer "interest accrues on drawn balance only — never on the unused limit"', surfaces: ['kcc_drawls', 'kcc'],
    key: 'partner4.refusal.interestOnDrawnOnly', why: 'nothing on this platform charges interest on any basis at all, and there is no unused remainder either because there is no limit (survey F-4, §1G)' },
  { id: 'drawl_purpose_check', canon: 'W217 "Drawls above ₹50,000 to non-supplier destinations get a purpose check — input finance that leaks to moneylender repayment helps no one. Supplier-direct drawls skip the friction entirely."', surfaces: ['kcc_drawls'],
    key: 'partner4.refusal.drawlPurposeCheck', why: 'refused BY NAME and FOR ITS REASONING. `purpose_check_status` is only ever written as its default `not_required`, no threshold is evaluated (0069 deliberately left the figure out of a CHECK) and no code reads the column; and the sentence makes an adverse inference about what a farmer might do with her own loan — the W263 lesson (survey §1H)' },
  { id: 'append_only_safe', canon: 'W217 error state "Couldn\'t load ledger — The ledger is append-only and safe."', surfaces: ['kcc_drawls'],
    key: 'partner4.refusal.appendOnlySafe', why: 'founder 4c-5 (F-13): the ledger cannot be mutated BY GRANT (0069:211, re-asserted 0078:259) but carries NO trigger, unlike `loan_repayments` (0079:227-230) — so a privileged connection could still change it, and the reassuring sentence becomes available only when P4-B7 adds the trigger' },
  { id: 'borrower_sees_always', canon: 'W217 restricted state "Needs servicing role; the borrower sees his own ledger always."', surfaces: ['kcc_drawls'],
    key: 'partner4.refusal.borrowerSeesAlways', why: 'there is no borrower-facing ledger on this platform at any time, so no promise of the kind is made (survey §1H)' },
  { id: 'entries_since_opening', canon: 'W217 footer "4 highlighted of 9 entries since opening"', surfaces: ['kcc_drawls'],
    key: 'partner4.refusal.entriesSinceOpening', why: 'nothing of this ledger reaches this console, so there is no count to print and nothing to highlight — and the canon\'s footer is a static line of text in any case (survey F-21)' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner4RefusalKeys(surface: Partner4Surface): string[] {
  return PARTNER4_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** The canon shapes PARTNER-4a builds differently — recorded DELTAs, not refusals. */
export const PARTNER4_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'four_routes', canon: 'W206 `lender/queue` · W207 `lender/queue/[id]` · W212 `lender/portfolio` · W215 `lender/portfolio/[id]`',
    built: 'the canon\'s own paths. The PARTNER-0 pages `/loan-queue(/[id])` and the two `<NotYet>` pages `/portfolio(/[id])` — plus `/servicing` — answer a real 307 to them (LENDER_BOOK_REDIRECTS); their page files are deleted' },
  { id: 'loan_chain_routes', canon: 'the chain pages W2876–W2877 (loan export), W2878–W2880 (loan mutate), W2891–W2892 (portfolio export) and W2893–W2895 (portfolio mutate) as separate files',
    built: 'query states of their parent pages: `?act=confirm|success|failure` on the queue, the application and the loan; `?export=queued|ready` on the loan and the portfolio' },
  { id: 'chain_returns', canon: 'W2878–W2880 Cancel / Back → W206 even from W207 and W215; W2876–W2877\'s donor, crumb and Back all name W206 though its ONLY trigger is W215\'s button (survey F-22)',
    built: 'every chain state links back to the page it was opened FROM — the application chain to that application, the loan chain and the loan export to that loan' },
  { id: 'w215_orphan', canon: 'W215 has ZERO inbound references in all 222 partner files — no sidebar item, no nav entry, and its own export and mutate chains return to W206 (survey F-22)',
    built: 'the build creates the inbound edge the canon never drew: every row of `/lender/portfolio` links to that loan, and the lending sub-navigation sits on both pages' },
  { id: 'fm_numbering', canon: 'FLOWMAP names 30 chain ids in the W14xx namespace for the nine lending screens and NONE exists (`ls CANON | grep -cE "^W14..-"` → 0) — survey C-16 / F-21',
    built: 'the canon\'s own ids: W1363-64 → W2876-77, W1323-25 → W2878-80, W1348-49 → W2891-92, W1350-52 → W2893-95. The HTML was already right; FLOWMAP is the stale artefact, and its own header calls each row the binding dev spec' },
  { id: 'fm_misclass', canon: 'FLOWMAP classes W206\'s three status chips "submitted" (:67), "approved (cooling-off)" (:63) and "rejected/withdrawn" (:66) as `chain-mutate` while classing three chips of the same row-set as `filter`; the avatar (:59, :69, :111, :133) and the `<td>` cells "58h" (:58) as `filter`; the static table footer as `bulkbar` (:57) — survey F-21',
    built: 'the status chips are FILTERS (a link that narrows the list, never an act); no avatar is drawn; the waiting figure is refused by name; no bulk bar exists because no bulk route does' },
  { id: 'fm_omissions', canon: 'FLOWMAP omits W206\'s only real drill-in (the application reference → W207) AND its "Decide" button, W206\'s two row kebabs, and the Notifications bell on all four screens; it registers the dead `data-decor` buttons (:62, :73, :114, :134) instead — survey F-21',
    built: 'every queue row links to its application and every portfolio row to its loan; the canon\'s four dead buttons ("View portfolio", "Back to queue", "View queue", "Back to portfolio") are built as REAL links; no row kebab is drawn' },
  { id: 'loan_reference', canon: 'application numbers `LA-2026-0710-08` and loan numbers `LN-2026-0114`',
    built: 'the ids as the references they are (the short form printed, the link carrying the full id). `loan_applications.partner_app_ref` is never written, so there is no human-readable number on this platform' },
  { id: 'status_chips_seven', canon: 'W206 chips "under_review 14 · docs_pending 22 · submitted 9 · approved (cooling-off) 6 · disbursed (30d) 61 · rejected/withdrawn"',
    built: 'the SEVEN statuses the application machine can produce as filters — with `draft` marked as a state this axis never shows (the oracle needs a consent keyed to the application) and `docs_pending` refused by name; and the COUNTS of the loans opened in the FY window beside them, server-computed with an as-of' },
  { id: 'counts_window', canon: 'W212 "FY 2026-27" over "Outstanding ₹6,84,20,000 · 1,148 active · avg ticket ₹59,600"',
    built: 'COUNTS and bigint SUMS of the loans OPENED in the FY window (April–March, Asia/Kolkata, answered by the database), labelled with the window and an as-of. A loan opened before 1 April is in the book and in the list, but NOT in these figures — the caveat is printed on the page' },
  { id: 'kind_mix_nine', canon: 'W212\'s chart over five buckets (kcc / crop / whr / dairy / shg+) with percentages',
    built: 'the NINE platform `loan_kind` codes + "not recorded", each with its count and its two bigint sums — no chart, no bucket, no share' },
  { id: 'lending_sub_nav', canon: 'the canon\'s own lender sidebar has FIVE lending items for NINE lending screens, and cannot reach W215, W216, W217 or W218 at all (survey F-22)',
    built: 'the lending group becomes Dashboard · Loan queue · Products · Portfolio, and the portfolio pages carry a lending sub-navigation: Queue · Portfolio now, with Disbursements and Repayments drawn only once PARTNER-4b builds them' },
  // ── PC-56 PARTNER-4b ──
  { id: 'three_4b_routes', canon: 'W210 `lender/disbursements` · W211 `lender/repayments` · W218 `lender/disbursements/[id]`',
    built: 'the canon\'s own paths, inside 4a\'s lending shell: both list pages are sub-navigation rows (live from this wave) and nav items, and the batch page is in NO nav — it is reached from the pay-outs page and the tabs only' },
  { id: 'w218_id_is_a_run', canon: 'W218\'s `[id]` is a disbursement BATCH id, and the screen is reachable in the canon from nothing but its own three chain pages (W210, its logical parent, links to nothing) — survey F-22',
    built: 'the inbound edge W210 → W218 the canon never drew, at `/lender/disbursements/pending`: a batch is a RUN on the tenant plane, this console holds no privilege on the run tables at all (0232 asserts nine of them), and the page makes NO read — so every id prints the same honest page, because there is nothing to look up' },
  { id: 'arrears_six_buckets', canon: 'W211 KPIs "Overdue 1–30 DPD · 31 loans · ₹4,86,000" and "Overdue > 30 DPD · 7 loans · ₹1,84,000 missed instalments · outstanding at risk ≈ ₹13,00,000 (PAR basis)"',
    built: 'SIX disjoint buckets over this lender\'s serviced loans — 1–30, 31–60, 61–90 and over 90 days past a recorded due date, plus the loans not yet due and THE LOANS WITH NO DUE DATE RECORDED — each as a count and a bigint sum, with the days spelled out instead of the canon\'s acronym. The four arrears buckets are ZERO on this platform and the page says why, with the count of loans that have no due date; no rate, no share and no portfolio-at-risk figure is printed (founder 4b-7)' },
  { id: 'collected_recorded_window', canon: 'W211 KPI "Collected (7d) ₹16,88,400 · 96.4% on-time" and "Due this week ₹18,42,000 · 312 instalments · 68% via auto-deduction channels"',
    built: 'what was RECORDED against this book in a window of IST days — a count of repayments, a bigint sum and the number of loans that paid — labelled as recorded rather than due, because a repayment row is written AT PAYMENT and no instalment plan exists. No punctuality figure and no channel share (survey F-8, E9)' },
  { id: 'pipeline_four_counts', canon: 'W210 chips "pipeline (all) 14 · ready (cooling-off lapsed) 8 · in cooling-off 6 · disbursed (30d) 61" and the table of named borrowers with their banks',
    built: 'the four counts, server-computed on the consent-gated application axis, with an as-of — and NO table at all: the canon\'s two row columns are the borrower and her bank account, which are the wall. "Ready" and "in cooling-off" are counted over every approved application of this book (an approval waits for its window wherever it was made); "disbursed" is counted inside the window' },
  { id: 'disbursal_word', canon: 'W210 is titled "Disbursements" and W218 "Disbursement batch"; the canon\'s sidebar item is "Disbursements"',
    built: 'the pages are named for what a lender can actually see — the pay-outs its approvals lead to, and what happens when a batch is prepared — because the claims guard bans the verb and the noun of the one act this console refuses by name in every `partner4.` value, and the past participle ("disbursed", a real state of an application) is deliberately still printable. 4a set this rule with the sub-navigation label; 4b keeps it' },
  // ── PC-56 PARTNER-4c ──
  { id: 'two_4c_routes', canon: 'W216 `lender/kcc/[id]` · W217 `lender/kcc/[id]/drawls` — and the canon\'s own lender sidebar cannot reach either (the two form a CLOSED TWO-CYCLE with no entry point, survey F-22)',
    built: 'the canon\'s own paths, inside 4a\'s lending shell. The inbound edge the canon never drew is the lending sub-navigation\'s KCC row, drawn wherever a LOAN ID is in scope — on the loan page (W215) and on the two KCC pages themselves; neither page is a nav item, because its route needs a loan id' },
  { id: 'w217_id_is_a_loan', canon: 'W216\'s and W217\'s `[id]` is drawn as a KCC ACCOUNT reference ("KCC-2026-0031") in the heading and the crumb',
    built: 'the `[id]` is a LOAN id — there is no KCC account entity to have an id — exactly as PARTNER-3b recorded W259\'s `[id]` being a claim id. W216 reads that loan through PARTNER-4a\'s own audited `partner_loan` read; W217 reads nothing at all' },
  { id: 'w217_stale_banner', canon: 'W217 prints its own backend banner: "Backend pending (DELTA-032): `kcc_drawl_ledger` table (drawl/repay/interest rows per revolving account) — today KCC servicing rides the loans + repayments tables awkwardly. Design leads." (survey C-7)',
    built: 'NEVER COPIED, and recorded as a correction: the table was built by 0069 with exactly the shape the note asks for — its header cites this very screen — and it is partitioned, under FORCE RLS and append-only by grant. The live gap is the OPPOSITE one: no partner grant, no definer, and no money behind an entry' },
  { id: 'fm_omits_kcc_links', canon: 'FLOWMAP omits W216\'s "Drawl ledger" → W217 and W217\'s "KCC-2026-0031" crumb → W216 — the only two real cross-links either screen has, and the only inbound edges between them; it registers the dead `data-decor` buttons "View queue" (:140) and "Back to account" (:142) instead (survey F-21)',
    built: 'both real links are built — the ledger link from the KCC page and the crumb back from the drawls page — and the two dead buttons are not drawn at all' },
  { id: 'kcc_form_without_form', canon: 'W2953–W2956 is a FOUR-STATE FORM chain whose four pages carry no `<input>`, no `<label>` and no `<select>` — and the act behind it ("Record limit review") has no table, route, permission or form (survey C-8)',
    built: 'ONE registry entry on the 2c `lender_form` precedent — `param: \'form\'`, four states, the four canon files listed ONCE on the triggering page, `mailbox: true` with its own mailbox line — and four states that each print the refusal. The partner panel has never built a form chain as a real form, and this one has nothing to put in one' },
  { id: 'w2956_two_defects', canon: 'W2956 (the form chain\'s failure page) links "Retry — back to confirm" → W216: a form chain has no CONFIRM page to go back to (the wording is the mutate chain\'s), and the link skips the review page entirely. 2c recorded the identical pair on W2983',
    built: 'the failure state claims no confirm page and offers no earlier step, because there is none: it says nothing was attempted and links back to the page it was opened from' },
  { id: 'w2954_back_to_edit', canon: 'W2954 (the form chain\'s review page) links "Back to edit" → W216, never to W2953, so the error page is unreachable from the chain it belongs to',
    built: 'every state of the chain is reached by its own query value and links back to the triggering page; no state claims an edit step, because there is no form to edit' },
  { id: 'kcc_chains_return_w216', canon: 'the KCC export chain is triggered from W217 and its donor, crumb and Back all name W216; the KCC mutate chain is triggered from W216 AND W217 and returns to W216 from both (survey F-22)',
    built: 'Back goes to the TRIGGERING page — the export chain to the drawls page, whose button is its only trigger. The export chain\'s files are recorded on the drawls page for the same reason (the 4a `loan_export` precedent)' },
  { id: 'kcc_mutate_no_trigger', canon: 'W2957–W2959 (`chain-mutate:kcc`) is wired to W216\'s "Retry" and W217\'s "Retry" (FM:139, FM:144)',
    built: 'DECOR, and reached from NO control: W217 makes no read, so it has no error state and no retry; and W216\'s error state asks for its own page again rather than opening a chain. The three canon files answer as query states with the truth — there is no act here and nothing to read again — which is why the chain is DECOR and not PARITY-DECOR' },
  { id: 'kcc_act_words', canon: 'W216\'s control is labelled "Record limit review" and W216 / W217 print "limit", "available", "renewal", "utilisation", "headroom", "accrual" and "subvention … effective" as figures of an account',
    built: 'the control is named for what a lender can honestly ask for, because the claims guard bans the canon\'s own noun in every `partner4.` value — the rule 4a set with the sub-navigation label and 4b kept for the pay-outs page. The refusals NAME the canon\'s words; no page value carries them' },
  { id: 'dead_lending_console', canon: '— (not a canon claim: the repository\'s own residue, survey F-14)',
    built: 'the dead lending console is deleted: `app/servicing/**` (a `\'use server\'` file imported by nothing, whose four server actions called TENANT fintech routes with a partner token), `features/lending/{servicing,loan,product}.ts`, their three specs, `canDisburse`, the dead i18n families and the two dead `NotYetSurface` members. Its absence is pinned' },
]);

/** Every canon file of PARTNER-4 (39), each with ONE verdict. 4a decided its 14, 4b its 14 and PARTNER-4c the last 11 —
 *  so PARTNER-4 CLOSES AT 39 DECIDED, 0 PENDING. The two verdict values that carried the waiting for 4b and for 4c are
 *  DELETED from the type with their last user (the 4a precedent: a verdict value with no users goes), and the registry's
 *  own spec asserts that neither string survives anywhere in THIS FILE — a comment naming them would pass for one. */
export type Partner4Verdict = 'BUILT' | 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR';
export const PARTNER4_CANON_FILES: readonly { file: string; wave: '4a' | '4b' | '4c'; verdict: Partner4Verdict; note: string }[] = Object.freeze([
  // ── 4a · THE LENDER READS ITS OWN BOOK (14) ──
  { file: 'W206-partner-loan-queue.html', wave: '4a', verdict: 'BUILT', note: '/lender/queue over GET /v1/partner/applications + GET /v1/partner/loans/counts: the consented applications newest first (reference, product, requested amount, purpose category, status, applied), the seven statuses the machine can produce as filters, keyset paging, and the FY counts of the lender\'s own book beside them with an as-of; "View portfolio" is a real link. The SLA column, the Score column, the Collateral column, "Take next", docs_pending, "routed", the borrower\'s name, the canon\'s role names and "plan settings" are refused by name' },
  { file: 'W207-partner-loan-application.html', wave: '4a', verdict: 'BUILT', note: '/lender/queue/[id] over GET /v1/partner/applications/:id + the three REAL decision routes: the application\'s facts, the purpose hidden until approval, the terms as the product\'s TODAY in integer basis points, the consent block kept almost verbatim with the "no consent recorded yet" state, and Approve / Reject as real idempotent acts for a checker. The whole credit-score half (score, band, model version, platform income, the four factors), every document row, the voice consent, "= 4.0% effective", "decision_note mandatory", "Request clarification" and the delivered-reason promise are refused by name' },
  { file: 'W212-partner-portfolio.html', wave: '4a', verdict: 'BUILT', note: '/lender/portfolio over GET /v1/partner/loans/counts + GET /v1/partner/loans: the FY window label with an as-of; outstanding and the active count as the two figures they are; the restructured count; the written-off count and sum; the kind mix over the nine platform codes + "not recorded" as counts and bigint sums; the book\'s newest loans, each linking to its own page (the inbound edge the canon never drew). PAR, every percentage, the five-bucket chart, the off-platform comparison, the whole "honest attribution" block and "transferred" are refused by name; Export is DECOR with the mailbox line' },
  { file: 'W215-partner-loan-detail.html', wave: '4a', verdict: 'BUILT', note: '/lender/portfolio/[id] over GET /v1/partner/loans/:id + GET …/:id/repayments: one loan\'s facts (reference, application reference, product and kind, the cooperative\'s public name, principal, the rate in integer basis points, disbursed, status, outstanding), "no maturity date recorded · no next due date recorded" as the truth, the RECORDED repayment history with no "on time" anywhere, the consent-status sentence kept and made TRUE by 0231\'s narrowing, and "no foreclosure fee is charged — nothing on this platform charges one" as the true sentence it is. The borrower, the milk-bill percentage, the herd claim, the ledger anchors, the fee, the term, the plan and the 7-year promise are refused by name' },
  { file: 'W2876-partner-loan-export-queued.html', wave: '4a', verdict: 'DECOR', note: '/lender/portfolio/[id]?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox. Its ONLY trigger is W215\'s "Borrower statement" button, though the canon\'s donor, crumb and Back all name W206 (a canon defect, recorded as a DELTA) — the built chain returns to the loan' },
  { file: 'W2877-partner-loan-export-ready.html', wave: '4a', verdict: 'DECOR', note: '/lender/portfolio/[id]?export=ready — no file, no checksum, no signed link' },
  { file: 'W2878-partner-loan-mutate-confirm.html', wave: '4a', verdict: 'PARITY-DECOR', note: '?act=confirm on the queue, the application and the loan — Retry is a re-read; "Take next" and "Request clarification" are DECOR. The canon wires approve and reject here too, and those two ARE real — they keep their own forms on the application page, where the idempotency key is minted at render' },
  { file: 'W2879-partner-loan-mutate-success.html', wave: '4a', verdict: 'PARITY-DECOR', note: '?act=success — read again; nothing written, and no audit trail to view' },
  { file: 'W2880-partner-loan-mutate-failure.html', wave: '4a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  { file: 'W2891-partner-portfolio-export-queued.html', wave: '4a', verdict: 'DECOR', note: '/lender/portfolio?export=queued — the mailbox line. The only lending export chain whose canon Back link is already right' },
  { file: 'W2892-partner-portfolio-export-ready.html', wave: '4a', verdict: 'DECOR', note: '/lender/portfolio?export=ready — no file, no signed link' },
  { file: 'W2893-partner-portfolio-mutate-confirm.html', wave: '4a', verdict: 'PARITY-DECOR', note: '/lender/portfolio?act=confirm — the module\'s only trigger is Retry, a re-read of the counts: no confirm step, no audit row, no money' },
  { file: 'W2894-partner-portfolio-mutate-success.html', wave: '4a', verdict: 'PARITY-DECOR', note: '?act=success — the counts were read again' },
  { file: 'W2895-partner-portfolio-mutate-failure.html', wave: '4a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed; the servicing data is intact' },
  // ── 4b · WHAT A LENDER DOES NOT DISBURSE (14) ──
  { file: 'W210-partner-disbursements.html', wave: '4b', verdict: 'BUILT (read)', note: '/lender/disbursements over GET /v1/partner/loans/pipeline: the cooling-off pipeline as FOUR server-computed counts (every approved application of this book, the ones whose cooling-off instant has passed, the ones still inside it, and the ones disbursed in the window) with an as-of, and "the cooling-off window is held by the server" KEPT because it is true. "Disburse ready batch" is DECOR → the W2863–W2865 chain, refused by name. The Borrower and Destination columns, the destination model, the fee, the sanction letter, "auto-moves to ready", "with schedule", the absolute double-funding promise, the bank-side maker-checker, the bank limit and the canon\'s role names are refused by name. "View queue" and the batch page are real links — the second is the inbound edge W210 → W218 the canon never drew' },
  { file: 'W211-partner-repayments.html', wave: '4b', verdict: 'BUILT (read)', note: '/lender/repayments over GET /v1/partner/loans/collected + GET /v1/partner/loans/dpd: what was RECORDED against this book in the window (a count, a bigint sum, the number of loans) and the SIX arrears buckets as counts and bigint sums — the four arrears buckets, the loans not yet due, and the loans with NO next due date recorded, which is the honest reason the first four are zero and is printed as a sentence with its own count. "A loan that repays itself from the dairy cycle never becomes a knock on the door" and "auto-deduction channels run regardless" are KEPT. Every borrower name, every due figure, every punctuality figure, the channel vocabulary, the share by channel, the nudge stage, the mediation promise, the reminders, the collections-privacy rule and THE WHOLE COLLECTIONS CODE OF CONDUCT — its hours, its log, its ban on third-party agents and its suspension — are refused by name (founder 4b-5). Export is DECOR → W2994–W2995 + the mailbox line; "View portfolio" is a real link' },
  { file: 'W218-partner-disbursement-batch.html', wave: '4b', verdict: 'BUILT (honest)', note: '/lender/disbursements/[id] — an HONEST PAGE with NO READ (and so no audit row and no error state of its own): a batch is prepared and confirmed by the organisation that serves the farmer, not from this console; this platform never moves a lender\'s money and a lender never moves the organisation\'s; and no second signature worth the name exists on the platform today (founder 4b-3). The three things that are TRUE are kept in the platform\'s own words: the total is verified before a single row is written, the pre-flight asks about the cooling-off window BEFORE the account so a protected borrower is told the real reason, and nothing was disbursed — a batch is written whole or not at all, never partial-mystery. "Co-approve — disburse now" is DECOR → W2860–W2862. The batch-contents table, the fee, the cattle-insurance product rule, "both sides", "funds leave YOUR bank rails", "awaiting your co-approval" and "batches assemble automatically" are refused by name' },
  { file: 'W2860-partner-disbursement-mutate-confirm.html', wave: '4b', verdict: 'DECOR', note: '/lender/disbursements/[id]?act=confirm — the singular chain, donor W218: no money is moved from this console and no control here could move any' },
  { file: 'W2861-partner-disbursement-mutate-success.html', wave: '4b', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded' },
  { file: 'W2862-partner-disbursement-mutate-failure.html', wave: '4b', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed' },
  { file: 'W2863-partner-disbursements-mutate-confirm.html', wave: '4b', verdict: 'DECOR', note: '/lender/disbursements?act=confirm — the plural chain, donor W210, whose trigger is the canon\'s primary money act (FLOWMAP classed it `filter`): refused by name' },
  { file: 'W2864-partner-disbursements-mutate-success.html', wave: '4b', verdict: 'DECOR', note: '?act=success — nothing happened' },
  { file: 'W2865-partner-disbursements-mutate-failure.html', wave: '4b', verdict: 'DECOR', note: '?act=failure — nothing was attempted' },
  { file: 'W2994-partner-repayments-export-queued.html', wave: '4b', verdict: 'DECOR', note: '/lender/repayments?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox' },
  { file: 'W2995-partner-repayments-export-ready.html', wave: '4b', verdict: 'DECOR', note: '?export=ready — no file, no row count, no checksum, no signed link' },
  { file: 'W2996-partner-repayments-mutate-confirm.html', wave: '4b', verdict: 'PARITY-DECOR', note: '/lender/repayments?act=confirm — the module\'s only trigger is Retry, a re-read of the counts: no confirm step, no audit row beyond the read\'s own, no money' },
  { file: 'W2997-partner-repayments-mutate-success.html', wave: '4b', verdict: 'PARITY-DECOR', note: '?act=success — the figures were read again' },
  { file: 'W2998-partner-repayments-mutate-failure.html', wave: '4b', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed, and the auto-deduction channels run regardless' },
  // ── 4c · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP (11) — PARTNER-4 CLOSES HERE, 39 of 39 ──
  { file: 'W216-partner-kcc-account.html', wave: '4c', verdict: 'BUILT (honest)', note: '/lender/kcc/[id] — an HONEST PAGE: there is no KCC account on this platform, and a Kisan Credit Card loan is an ordinary loan whose product kind is recorded as `kcc` (founder 4c-2 / 4c-3). Beside the statement the page prints THAT LOAN\'S OWN FACTS through PARTNER-4a\'s existing audited `partner_loan` read — the same wall, the same projection, ONE audit row — because the canon\'s `[id]` is a loan id; nothing is added to the API and no migration is made. "Drawl ledger" is a real link to W217 (the canon\'s own edge, which FLOWMAP omits); "Record limit review" is DECOR → the W2953–W2956 form chain. The account itself, the limit, the headroom, the renewal, the scale-of-finance worksheet, the seasonal drawls, the interest engine, the subsidy, the utilisation, the whole annual-review block, its notice promise and the canon\'s role names are refused by name. An unknown or another lender\'s id answers the 4a "not found" shape, never a 403' },
  { file: 'W217-partner-kcc-drawls.html', wave: '4c', verdict: 'BUILT (honest)', note: '/lender/kcc/[id]/drawls — an HONEST PAGE with NO READ (so no audit row and no error state of its own, the 3b rule): the drawl ledger is the organisation\'s own record of what it advanced and recovered against this loan, it is not a money movement on this platform, and it is not shown here (founder 4c-1, taken under the founder\'s standing authority). NOT ONE figure of the ledger is printed — no entry, no amount, no running balance, no narrative, no destination, no purpose-check status, no interest — and the canon\'s one TRUE sentence is kept ("a fresh KCC sits at zero until the season starts — no drawl, no interest, no cost"). The stale DELTA-032 banner is recorded as a correction and never printed; "the ledger is append-only and safe" is refused until P4-B7 adds the trigger (founder 4c-4 / 4c-5). "Export (signed)" is DECOR → W2951–W2952 + the mailbox line; the crumb back to W216 is the canon\'s own edge that FLOWMAP omits' },
  { file: 'W2951-partner-kcc-export-queued.html', wave: '4c', verdict: 'DECOR', note: '/lender/kcc/[id]/drawls?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox. Its ONLY trigger is W217\'s button, though the canon\'s donor, crumb and Back all name W216 — the built chain returns to the DRAWLS page (recorded as a DELTA)' },
  { file: 'W2952-partner-kcc-export-ready.html', wave: '4c', verdict: 'DECOR', note: '?export=ready — no file, no row count, no checksum, no signed link; and nothing of this ledger could be exported in any case' },
  { file: 'W2953-partner-kcc-form-form-error.html', wave: '4c', verdict: 'DECOR', note: '/lender/kcc/[id]?form=error — the panel\'s FIRST four-state FORM chain, recorded as ONE entry on the 2c `lender_form` precedent with its four files listed once and its own mailbox line. There are no fields to put right: the act behind the chain has no table, no route, no permission and no form' },
  { file: 'W2954-partner-kcc-form-review.html', wave: '4c', verdict: 'DECOR', note: '?form=review — nothing was entered, so nothing is shown back and there is nothing to compare against; and no second person waits to check it. The canon\'s "Back to edit" skips its own error page (a DELTA)' },
  { file: 'W2955-partner-kcc-form-success.html', wave: '4c', verdict: 'DECOR', note: '?form=success — nothing was recorded. The canon\'s body here is the MUTATE chain\'s ("the audit trail has the entry … Money-adjacent actions reconcile zero-sum"), which is refused twice over: it is the wrong chain\'s wording and neither claim is true of a non-act' },
  { file: 'W2956-partner-kcc-form-failure.html', wave: '4c', verdict: 'DECOR', note: '?form=failure — nothing was attempted. The canon page carries TWO defects in one link ("Retry — back to confirm" → W216): a form chain has no confirm page, and the link skips the review page. The built state claims no confirm page and offers no earlier step (a DELTA)' },
  { file: 'W2957-partner-kcc-mutate-confirm.html', wave: '4c', verdict: 'DECOR', note: '/lender/kcc/[id]?act=confirm — DECOR, not PARITY-DECOR: W217 reads nothing at all, so there is nothing to re-read, and W216\'s error state asks for its own page again rather than opening a chain. No control on either page leads here (recorded as a DELTA)' },
  { file: 'W2958-partner-kcc-mutate-success.html', wave: '4c', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded, and nothing was read again' },
  { file: 'W2959-partner-kcc-mutate-failure.html', wave: '4c', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed' },
]);

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain4Id = 'queue_act' | 'application_act' | 'loan_act' | 'loan_export' | 'portfolio_export' | 'portfolio_act'
  | 'disbursements_act' | 'disbursement_act' | 'repayments_export' | 'repayments_act'
  | 'kcc_export' | 'kcc_form' | 'kcc_act';
export interface Chain4Def {
  id: Chain4Id; wave: '4a' | '4b' | '4c'; param: string; page: string; surface: Partner4Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[];
  /** An export chain prints "exports are not available … write to the partners mailbox" + the mailbox FACT (founder 4a-7, 2b-1). */
  mailbox?: boolean;
  /** PC-56 PARTNER-4c (the 2c `lender_form` precedent): a chain whose own line replaces the export sentence above the mailbox FACT. */
  mailboxKey?: string;
  /** PC-56 PARTNER-4c (the 2b precedent): a chain of an HONEST page prints that page's founder-approved statement first. */
  statement?: string;
}
export const PARTNER4_CHAINS: readonly Chain4Def[] = Object.freeze([
  // the ONE canon loan mutate chain (W2878–W2880) serves three pages; its files are recorded once, on the queue (the canon's own return page)
  { id: 'queue_act', wave: '4a', param: 'act', page: '/lender/queue', surface: 'queue_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.act.${s}`, files: ['W2878', 'W2879', 'W2880'] },
  { id: 'application_act', wave: '4a', param: 'act', page: '/lender/queue/[id]', surface: 'application_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.act.${s}`, files: [] },
  { id: 'loan_act', wave: '4a', param: 'act', page: '/lender/portfolio/[id]', surface: 'loan_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.act.${s}`, files: [] },
  // the loan EXPORT chain's only trigger is W215's "Borrower statement" button, so its files are recorded on the LOAN page — not on W206,
  // which is where the canon's own donor line, crumb and Back all point (a canon defect, recorded as the DELTA `chain_returns`)
  { id: 'loan_export', wave: '4a', mailbox: true, param: 'export', page: '/lender/portfolio/[id]', surface: 'loan_export', states: ['queued', 'ready'],
    key: (s: string) => `partner4.chain.export.${s}`, files: ['W2876', 'W2877'] },
  { id: 'portfolio_export', wave: '4a', mailbox: true, param: 'export', page: '/lender/portfolio', surface: 'portfolio_export', states: ['queued', 'ready'],
    key: (s: string) => `partner4.chain.export.${s}`, files: ['W2891', 'W2892'] },
  { id: 'portfolio_act', wave: '4a', param: 'act', page: '/lender/portfolio', surface: 'portfolio_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.act.${s}`, files: ['W2893', 'W2894', 'W2895'] },
  // PC-56 PARTNER-4b · the two chains of the one act this console refuses by name. The canon keeps them SEPARATE (W2860–W2862 singular from
  // W218, W2863–W2865 plural from W210) and so does this registry; both are DECOR, and both print the refusal rather than a confirm step —
  // their `partner4.chain.pay.*` sentences are not the PARITY-DECOR "we read it again" of the `act` chains, because nothing was ever going to
  // happen here. FLOWMAP classed the two triggers `filter` and `nav-detail` (survey F-21); they are a money act, and it is not a partner's.
  { id: 'disbursements_act', wave: '4b', param: 'act', page: '/lender/disbursements', surface: 'disbursements_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.pay.${s}`, files: ['W2863', 'W2864', 'W2865'] },
  { id: 'disbursement_act', wave: '4b', param: 'act', page: '/lender/disbursements/[id]', surface: 'disbursement_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.pay.${s}`, files: ['W2860', 'W2861', 'W2862'] },
  // the repayments export chain (DECOR + the mailbox line) and the repayments mutate chain (PARITY-DECOR: Retry is a re-read of the counts)
  { id: 'repayments_export', wave: '4b', mailbox: true, param: 'export', page: '/lender/repayments', surface: 'repayments_export', states: ['queued', 'ready'],
    key: (s: string) => `partner4.chain.export.${s}`, files: ['W2994', 'W2995'] },
  { id: 'repayments_act', wave: '4b', param: 'act', page: '/lender/repayments', surface: 'repayments_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.act.${s}`, files: ['W2996', 'W2997', 'W2998'] },
  // PC-56 PARTNER-4c · the three chains of the KCC pair. The EXPORT chain's files sit on the DRAWLS page, whose "Export (signed)" button is
  // its only trigger, though the canon's donor, crumb and Back all name W216 (the 4a `loan_export` precedent for the same canon defect).
  { id: 'kcc_export', wave: '4c', mailbox: true, param: 'export', page: '/lender/kcc/[id]/drawls', surface: 'kcc_export', states: ['queued', 'ready'],
    key: (s: string) => `partner4.chain.export.${s}`, files: ['W2951', 'W2952'], statement: 'partner4.drawls.statement' },
  // THE PARTNER PANEL'S FIRST FOUR-STATE FORM CHAIN, recorded exactly as the 2c `lender_form` entry does it (survey §1S / C-8): one entry,
  // `param: 'form'`, four states, the four canon files listed ONCE on the triggering page, `mailbox: true` with its own line. No state claims
  // a confirm page (W2956's wording is the mutate chain's — a canon defect) and none carries the mutate chain's body (W2955's — refused).
  { id: 'kcc_form', wave: '4c', mailbox: true, mailboxKey: 'partner4.kcc.proposeLimitChange', param: 'form', page: '/lender/kcc/[id]', surface: 'kcc_form',
    states: ['error', 'review', 'success', 'failure'], key: (s: string) => `partner4.chain.kccForm.${s}`, files: ['W2953', 'W2954', 'W2955', 'W2956'],
    statement: 'partner4.kcc.statement' },
  // DECOR, NOT PARITY-DECOR (founder 4c-1): W217 reads nothing, so there is nothing to re-read; and W216's error state asks for its own page
  // again rather than opening a chain, so no control on either page leads here at all (recorded as the DELTA `kcc_mutate_no_trigger`).
  { id: 'kcc_act', wave: '4c', param: 'act', page: '/lender/kcc/[id]', surface: 'kcc_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner4.chain.kccAct.${s}`, files: ['W2957', 'W2958', 'W2959'], statement: 'partner4.kcc.statement' },
]);
export function chain4ById(id: Chain4Id): Chain4Def { return PARTNER4_CHAINS.find((c) => c.id === id) as Chain4Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain4State(id: Chain4Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain4ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}

/** PC-56 PARTNER-4a (survey F-15 / E2) — the five retired routes answer a real HTTP 307 to the canon's `lender/*` paths (next.config.js
 *  `redirects()`, pinned equal to INSURANCE_REDIRECTS + LENDER_REDIRECTS + CLAIMS_REDIRECTS + this map by the not-yet render test — their
 *  page files are gone). `/servicing` had no canon address of its own: the dead servicing console is deleted and its route now lands on the
 *  lender's own book, which is what a person who bookmarked it was looking for. */
export const LENDER_BOOK_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/loan-queue': '/lender/queue',
  '/loan-queue/:id': '/lender/queue/:id',
  '/portfolio': '/lender/portfolio',
  '/portfolio/:id': '/lender/portfolio/:id',
  '/servicing': '/lender/portfolio',
});

/** The lending sub-navigation (survey E2 / F-22): the canon's own lender sidebar has FIVE lending items for NINE lending screens and cannot
 *  reach W215, W216, W217 or W218 at all, so the lending pages carry their own tabs — the 3b `CLAIMS_SUBNAV` shape. 4a draws Queue ·
 *  Portfolio; the two PARTNER-4b rows are `live: false` until that wave builds them (a route that does not exist is never linked).
 *  PC-56 PARTNER-4c · W216 / W217 cannot be ORDINARY rows — their canon routes are `lender/kcc/[id]` and `lender/kcc/[id]/drawls`, which
 *  need a loan id — so the KCC row carries `needsLoanId` and is drawn ONLY where a loan id is in scope: on the loan page (W215), which is
 *  the inbound edge the canon never drew, and on the two KCC pages themselves. Everywhere else it is absent rather than dead. */
export const LENDING_SUBNAV: readonly { href: string; key: string; wave: '4a' | '4b' | '4c'; live: boolean; needsLoanId?: boolean }[] = Object.freeze([
  { href: '/lender/queue', key: 'partner4.subnav.queue', wave: '4a', live: true },
  { href: '/lender/portfolio', key: 'partner4.subnav.portfolio', wave: '4a', live: true },
  // PC-56 PARTNER-4b built both of these, so both are LIVE from this wave. `/lender/disbursements/[id]` (W218) is NOT a row: it is reached
  // from the pay-outs page and the sub-navigation only, which is the inbound edge the canon never drew (survey F-22).
  { href: '/lender/disbursements', key: 'partner4.subnav.disbursements', wave: '4b', live: true },
  { href: '/lender/repayments', key: 'partner4.subnav.repayments', wave: '4b', live: true },
  // PC-56 PARTNER-4c · LIVE, and drawn against the loan whose page you are on (`/lender/kcc/<that loan>`).
  { href: '/lender/kcc/[id]', key: 'partner4.subnav.kcc', wave: '4c', live: true, needsLoanId: true },
]);
/** The sub-navigation row a page is on (`aria-current="page"`), or null for a page outside the tabs (an application, a loan). */
export type LendingSubNavHref = (typeof LENDING_SUBNAV)[number]['href'];
