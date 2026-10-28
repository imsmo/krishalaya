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
export type Partner4Surface =
  | 'queue' | 'application' | 'portfolio' | 'loan'
  | 'queue_act' | 'application_act' | 'loan_act' | 'loan_export' | 'portfolio_export' | 'portfolio_act';
export interface Partner4Refusal { id: string; canon: string; surfaces: readonly Partner4Surface[]; key: string; why: string }

/** The three pages the loan mutate chain (W2878–W2880) is triggered from. */
const ACT: readonly Partner4Surface[] = ['queue_act', 'application_act', 'loan_act'];
/** The two export chains (W2876–W2877, W2891–W2892): both DECOR, both with the partners-mailbox line. */
const EXPORT: readonly Partner4Surface[] = ['loan_export', 'portfolio_export'];
/** Every chain surface of this wave. */
const CHAINS: readonly Partner4Surface[] = [...ACT, ...EXPORT, 'portfolio_act'];
/** The four real screens of PARTNER-4a. */
const BUILT: readonly Partner4Surface[] = ['queue', 'application', 'portfolio', 'loan'];

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
  { id: 'platform_income', canon: 'W207 "Verified platform income (12mo) ₹4,73,460 — crops + dairy, from settlement statements, not self-declared" · W216 "His consented platform income supports it"', surfaces: ['application'],
    key: 'partner4.refusal.platformIncome', why: 'founder 4a-2 / 4a-4: no such aggregate exists on any axis, and a farmer\'s settlement history across modules is not a lender\'s to read' },
  { id: 'score_explained', canon: 'W207 "The farmer sees this same breakdown in Gujarati (right-to-explanation). You never see raw transactions — only the score and factors the consent covers."', surfaces: ['application'],
    key: 'partner4.refusal.scoreExplained', why: 'the principle is right and is the shape any future score must take; the claim is false — there is no score and no farmer-facing breakdown of one (founder 4a-4)' },
  { id: 'collateral_column', canon: 'W206 column "Collateral" and the cells "none (KCC)" / "nwr (wheat, LTV 68%)" / "group_guarantee" · W215 "The cow is the collateral logic"', surfaces: ['queue', 'loan'],
    key: 'partner4.refusal.collateralColumn', why: '`collateral_kind` is a field of the PRODUCT, not of an application or a loan (0011:69); the commodity, the live loan-to-value figure and the guarantee instrument are stored nowhere' },
  { id: 'borrower_identity', canon: 'W206 rows "<reference> <a person> · <an organisation>" · W207 header "<product> ₹3,00,000 — <a person>" · W215 header "Dairy cattle loan — <a person>" · W206 "group · 14 members"', surfaces: BUILT,
    key: 'partner4.refusal.borrowerIdentity', why: 'founder 4a-2: loan facts only — never the borrower\'s user id or name, and never a group\'s member count (no partner policy reaches `finance_group_members`). The cooperative appears by its PUBLIC name, never its id (survey F-5, F-10)' },
  { id: 'document_rows', canon: 'W207 the documents table — a masked identity-number tail "verified", a land record "4.2 acre · 2 parcels · <a district>", "8 settlement statements (signed exports — verify offline anytime)", "via account-aggregator rails, purpose-bound"', surfaces: ['application'],
    key: 'partner4.refusal.documentRows', why: 'there is no per-application document table, no verification status, no identity-number tail, no land record and no account-aggregator integration anywhere; the product\'s required document TYPES are the only honest content (2c\'s shape)' },
  { id: 'voice_consent', canon: 'W207 "Granted 10 Jul 14:20 by <a person> — voice consent in Gujarati, recording on file" · "banker-desk pre-filled, member confirmed by voice"', surfaces: ['application'],
    key: 'partner4.refusal.voiceConsent', why: 'no consent artefact exists: no recording column, no media link, no assisted-application flow and no voice record — and nothing in the product writes the consent row at all (founder 4a-3, survey F-6)' },
  { id: 'effective_rate', canon: 'W207 "7.0% APR − 3.0% subvention = 4.0% effective (prompt-repayment)" · W215 "@ 10.5% APR" · W216 "7% APR (4% effective with prompt-repayment subvention)"', surfaces: ['application', 'loan', 'portfolio'],
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
  { id: 'platform_roles', canon: 'W206 "Deciding needs credit-officer role" · W212 "Risk analytics need your bank\'s credit-risk role" · W215 "Needs servicing role" · W210/W218 "disbursal officer role" · W211 "collections role"', surfaces: BUILT,
    key: 'partner4.refusal.platformRoles', why: 'the partner realm has FOUR roles (0225) — administrator, checker, maker, viewer — and none of the canon\'s role names is one of them' },
  { id: 'bulk_select', canon: 'W206 footer "3 highlighted of 14 under_review" (FM:57, classed `bulkbar`) and the row kebabs "Actions for lq 2" / "Actions for lq 3"', surfaces: ['queue'],
    key: 'partner4.refusal.bulkSelect', why: 'the footer is a static line of text, not a selection bar: nothing on this screen can be selected and no bulk route exists on any realm of the platform (survey §1A, F-21)' },
  { id: 'plan_settings', canon: 'W206–W215 flagged-off state "This module is switched off for this tenant/plan (feature flag) … See plan settings."', surfaces: BUILT,
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
  { id: 'par_rate', canon: 'W212 "PAR > 30 1.9% outstanding basis (≈ ₹13,00,000), not arrears" · W211 "outstanding at risk ≈ ₹13,00,000 (PAR basis, see Portfolio)"', surfaces: ['portfolio', 'loan'],
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
  { id: 'next_due', canon: 'W215 "next due Fri 17 Jul" · W211 "Due this week ₹18,42,000 · 312 instalments"', surfaces: ['loan', 'portfolio'],
    key: 'partner4.refusal.nextDue', why: 'founder 4a-5: `next_due_date` is NULL on every loan, and there is no instalment plan anywhere — a repayment row is created AT PAYMENT (loan-repayment.entity.ts:2-3)' },
  { id: 'repayment_plan', canon: 'W215 section "Schedule & repayment history" with four future rows · "4 highlighted of 11 instalments to date"', surfaces: ['loan'],
    key: 'partner4.refusal.repaymentPlan', why: 'founder 4a-5: there is no pre-generated plan on this platform — the page prints the RECORDED history and nothing it has not been told' },
  { id: 'on_time', canon: 'W215 "11/11 on time" and the rows "paid on time" · W211 "Collected (7d) … 96.4% on-time"', surfaces: ['loan', 'portfolio'],
    key: 'partner4.refusal.onTime', why: 'a repayment row\'s due date IS the moment it was paid (loan.service.ts:51), so every repayment would be trivially punctual and the figure would mean nothing (survey §1D, E9)' },
  { id: 'milk_bill_figure', canon: 'W215 "deduction ₹4,180 ≈ 23% of her avg fortnightly milk bill (cap 25%)" · "The cow is the collateral logic: milk volume up 18% since purchase — the asset performs"', surfaces: ['loan'],
    key: 'partner4.refusal.milkBillFigure', why: 'founder 4a-2: a farmer\'s milk income, her animals and her production are on the other side of the wall — and the same screen\'s own consent block promises a lender does not see them (survey F-5)' },
  { id: 'destination', canon: 'W215 "disbursed 09 Feb 2026 (supplier-direct, cattle purchase)" · W210 column "Destination" and the bank / account strings · W216 "Drawl — drip top-up (supplier-direct)"', surfaces: ['loan'],
    key: 'partner4.refusal.destination', why: 'a loan has no destination on this platform: the wallet rail credits the borrower\'s platform wallet and the payout rail never executes; a bank account is a table this console holds NO privilege on (0231 asserts it)' },
  { id: 'ledger_anchors', canon: 'W215 "Ledger anchors — disbursal LTX-…71204 · fee LTX-…71205 · 11 repayment txns — every rupee traceable both sides"', surfaces: ['loan'],
    key: 'partner4.refusal.ledgerAnchors', why: 'a ledger transaction id is the PLATFORM\'s own money record — `ledger_entries`, `ledger_transactions` and `wallet_accounts` are excluded from every RLS pass and this console holds nothing on them. And there is no fee transaction at all' },
  { id: 'origination_fee', canon: 'W215 "fee LTX-…71205" · W210 "Platform origination fee posts to ledger (origination_fee_txn_id) — your bank pays it, itemised" · W218 "Origination fees pre-computed: ₹4,600 total (charged to bank)"', surfaces: ['loan', 'portfolio'],
    key: 'partner4.refusal.originationFee', why: 'founder 4a-5: `loans.origination_fee_txn_id` is written by NOTHING, the revenue leg is listed as deferred, and no fee posting exists on either rail — so nothing is charged to a lender today and the console does not say it is (survey F-8)' },
  { id: 'foreclosure_fee', canon: 'W215 "early-closure allowed, zero foreclosure fee (anti-predatory)"', surfaces: ['loan'],
    key: 'partner4.refusal.foreclosureFee', why: 'TRUE BY ABSENCE, and printed as the absence it is: nothing on this platform charges a fee for closing a loan early — a loan simply closes when its outstanding reaches zero (loan.entity.ts:38-41)' },
  { id: 'retention_promise', canon: 'W215 "Loan not found — Closed loans stay viewable for 7 years."', surfaces: ['loan'],
    key: 'partner4.refusal.retentionPromise', why: 'founder 4a-7 (carried from 2a / 2b / 3b): no retention promise is printed until a policy is set' },
  { id: 'contact_tools', canon: 'W215 "borrower contact tools live in Collections with their own logging" · W211 "every borrower contact is logged" and the whole collections code of conduct', surfaces: ['loan', 'portfolio'],
    key: 'partner4.refusal.contactTools', why: 'there is no contact engine, no contact log, no contact-hours window, no mediation gate and no suspension mechanism anywhere on this platform (survey F-22)' },
  { id: 'disbursal_act', canon: 'W206 / W207 the disbursal path after approval · W210 "Disburse ready batch" · W218 "Co-approve — disburse now" and "funds leave YOUR bank rails"', surfaces: ['queue', 'application', 'portfolio', 'loan'],
    key: 'partner4.refusal.disbursalAct', why: 'founder 4a-1 and the PARTNER-0 rule: the money is the cooperative\'s own, it is the lender of record, and it acts from its own console — the API refuses a partner\'s attempt by name and there is no route here that could try' },
  // ── the chains (W2876–W2877 export, W2878–W2880 mutate, W2891–W2892 export, W2893–W2895 mutate) ──
  { id: 'export_file', canon: 'W2876 / W2891 "audit-stamped, checksummed, delivered by signed URL" · W2877 / W2892 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged"', surfaces: [...EXPORT, 'loan', 'portfolio'],
    key: 'partner4.refusal.exportFile', why: 'founder 4a-7 (2b-1): there is no partner export plane in Phase 1 (P2-B6) — the receipt is true only of the tenant exports plane. The console names the partners mailbox instead' },
  { id: 'chain_zero_sum', canon: 'W2878 / W2893 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: CHAINS,
    key: 'partner4.refusal.chainZeroSum', why: 'nothing reached from these pages moves a rupee, so there is nothing to reconcile' },
  { id: 'chain_on_call', canon: 'W2880 / W2895 "repeated failures page the on-call"', surfaces: CHAINS,
    key: 'partner4.refusal.chainOnCall', why: 'no paging from a partner page exists' },
  { id: 'chain_audit', canon: 'W2879 / W2894 "View audit trail" · "the audit trail has the entry (actor · time · reason · before/after)"', surfaces: CHAINS,
    key: 'partner4.refusal.chainAudit', why: 'a re-read writes nothing but its own read row, and the console has no audit-trail page; the two REAL acts (approve, reject) do write a trail, and they are on the application page, not here' },
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
  { id: 'dead_lending_console', canon: '— (not a canon claim: the repository\'s own residue, survey F-14)',
    built: 'the dead lending console is deleted: `app/servicing/**` (a `\'use server\'` file imported by nothing, whose four server actions called TENANT fintech routes with a partner token), `features/lending/{servicing,loan,product}.ts`, their three specs, `canDisburse`, the dead i18n families and the two dead `NotYetSurface` members. Its absence is pinned' },
]);

/** Every canon file of PARTNER-4 (39), each with ONE verdict. PARTNER-4a decides its 14; the other 25 are flipped by their own waves. */
export type Partner4Verdict = 'BUILT' | 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR' | 'pending_4b' | 'pending_4c';
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
  // ── 4b · WHAT A LENDER DOES NOT DISBURSE (14) — decided in its own wave ──
  { file: 'W210-partner-disbursements.html', wave: '4b', verdict: 'pending_4b', note: 'the cooling-off pipeline as counts; every act DECOR with PARTNER_CANNOT_DISBURSE — founder doors Q3 / Q5 / Q9' },
  { file: 'W211-partner-repayments.html', wave: '4b', verdict: 'pending_4b', note: 'collected-in-window sums and the DPD buckets as counts and bigint sums (P4-B2); the collections code of conduct refused — founder door Q10' },
  { file: 'W218-partner-disbursement-batch.html', wave: '4b', verdict: 'pending_4b', note: 'an honest page about whose money moves and who signs — founder doors Q2 / Q3 / Q9' },
  { file: 'W2860-partner-disbursement-mutate-confirm.html', wave: '4b', verdict: 'pending_4b', note: 'the singular disbursement mutate chain, donor W218' },
  { file: 'W2861-partner-disbursement-mutate-success.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2862-partner-disbursement-mutate-failure.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2863-partner-disbursements-mutate-confirm.html', wave: '4b', verdict: 'pending_4b', note: 'the plural disbursements mutate chain, donor W210' },
  { file: 'W2864-partner-disbursements-mutate-success.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2865-partner-disbursements-mutate-failure.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2994-partner-repayments-export-queued.html', wave: '4b', verdict: 'pending_4b', note: 'the repayments export chain, donor W211' },
  { file: 'W2995-partner-repayments-export-ready.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2996-partner-repayments-mutate-confirm.html', wave: '4b', verdict: 'pending_4b', note: 'the repayments mutate chain, donor W211' },
  { file: 'W2997-partner-repayments-mutate-success.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  { file: 'W2998-partner-repayments-mutate-failure.html', wave: '4b', verdict: 'pending_4b', note: 'as above' },
  // ── 4c · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP (11) — decided in its own wave ──
  { file: 'W216-partner-kcc-account.html', wave: '4c', verdict: 'pending_4c', note: 'there is no KCC account on this platform — an honest page; founder door Q4' },
  { file: 'W217-partner-kcc-drawls.html', wave: '4c', verdict: 'pending_4c', note: 'the drawl ledger records debt with no money moving — an honest page by default; founder doors Q4 / Q6' },
  { file: 'W2951-partner-kcc-export-queued.html', wave: '4c', verdict: 'pending_4c', note: 'the kcc export chain, donor W216, triggered from W217' },
  { file: 'W2952-partner-kcc-export-ready.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
  { file: 'W2953-partner-kcc-form-form-error.html', wave: '4c', verdict: 'pending_4c', note: 'the kcc FORM chain, donor W216 — four states and, in the canon, no form at all' },
  { file: 'W2954-partner-kcc-form-review.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
  { file: 'W2955-partner-kcc-form-success.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
  { file: 'W2956-partner-kcc-form-failure.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
  { file: 'W2957-partner-kcc-mutate-confirm.html', wave: '4c', verdict: 'pending_4c', note: 'the kcc mutate chain, donor W216, triggered from W216 and W217' },
  { file: 'W2958-partner-kcc-mutate-success.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
  { file: 'W2959-partner-kcc-mutate-failure.html', wave: '4c', verdict: 'pending_4c', note: 'as above' },
]);

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain4Id = 'queue_act' | 'application_act' | 'loan_act' | 'loan_export' | 'portfolio_export' | 'portfolio_act';
export interface Chain4Def {
  id: Chain4Id; wave: '4a'; param: string; page: string; surface: Partner4Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[];
  /** An export chain prints "exports are not available … write to the partners mailbox" + the mailbox FACT (founder 4a-7, 2b-1). */
  mailbox?: boolean;
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
 *  PARTNER-4c's W216 / W217 CANNOT be sub-navigation rows at all — their canon routes are `lender/kcc/[id]` and `lender/kcc/[id]/drawls`,
 *  which need a loan id, so 4c must create its own inbound edge from the loan page. Recorded here so the next wave reads it. */
export const LENDING_SUBNAV: readonly { href: string; key: string; wave: '4a' | '4b'; live: boolean }[] = Object.freeze([
  { href: '/lender/queue', key: 'partner4.subnav.queue', wave: '4a', live: true },
  { href: '/lender/portfolio', key: 'partner4.subnav.portfolio', wave: '4a', live: true },
  { href: '/lender/disbursements', key: 'partner4.subnav.disbursements', wave: '4b', live: false },
  { href: '/lender/repayments', key: 'partner4.subnav.repayments', wave: '4b', live: false },
]);
/** The sub-navigation row a page is on (`aria-current="page"`), or null for a page outside the tabs (an application, a loan). */
export type LendingSubNavHref = (typeof LENDING_SUBNAV)[number]['href'];
