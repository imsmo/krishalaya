// apps/web-partner/src/features/partner2/refusals.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK (survey E1) — WHAT THE INSURER CONSOLE
// DOES NOT CLAIM, BY NAME. PURE. The shape of features/partner1/refusals.ts: each refused canon claim is listed ONCE with where the canon
// makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// (test/claims-guard.spec.ts, the `partner2.` scope) keeps the canon's false words out of every value. The sentences word the refused claims
// generically: no scheme, regulator, institution or person of the canon is named in any value.
//
// THE SURFACES `Partner2Surface`: `ins_dashboard` (W245) · `ins_products` (W246) · `ins_product` (W247) · `ins_policies` (W248) · `ins_policy`
// (W250) · `ins_form` (W2869–W2872) · `ins_retry` (W2873–W2875) · `policies_export` (W2881–W2882) · `policies_retry` (W2883–W2885) ·
// `policy_export` (W2886–W2887) · `policy_act` (W2888–W2890).
// PC-56 PARTNER-2b · WHERE THE MONEY IS NOT (founder Q1 / Q2 / Q3 / Q5, 2b-1…2b-4): `ins_issuance` (W249) · `ins_premiums` (W251) · `ins_reports`
// (W254) · `ins_parametric` (W262) · `issuance_form` (W2944–W2947) · `issuance_act` (W2948–W2950) · `premiums_export` (W2896–W2897) ·
// `premiums_act` (W2898–W2900) · `reports_form` (W254's "Generate Q1 pack" — the canon gives it the PRODUCT form chain, F-18: no files of its
// own) · `parametric_act` (W2977–W2979). The 2b sentences word every refused money, regulatory and payout claim generically: no figure, no
// scheme, no regulator, no person — the claims guard's `partner2.` scope keeps the canon's words out.
export type Partner2Surface =
  | 'ins_dashboard' | 'ins_products' | 'ins_product' | 'ins_policies' | 'ins_policy'
  | 'ins_form' | 'ins_retry' | 'policies_export' | 'policies_retry' | 'policy_export' | 'policy_act'
  | 'ins_issuance' | 'ins_premiums' | 'ins_reports' | 'ins_parametric'
  | 'issuance_form' | 'issuance_act' | 'premiums_export' | 'premiums_act' | 'reports_form' | 'parametric_act';
export interface Partner2Refusal { id: string; canon: string; surfaces: readonly Partner2Surface[]; key: string; why: string }

const BOOK: readonly Partner2Surface[] = ['ins_dashboard', 'ins_products', 'ins_product', 'ins_policies', 'ins_policy'];
/** PC-56 PARTNER-2b — the four honest pages. */
const HONEST: readonly Partner2Surface[] = ['ins_issuance', 'ins_premiums', 'ins_reports', 'ins_parametric'];
/** Every chain page that shares the canon's chain template sentences ("reconcile zero-sum", "page the on-call", "the audit trail has the entry"). */
const CHAIN_TEMPLATE: readonly Partner2Surface[] = ['ins_form', 'ins_retry', 'policies_retry', 'policy_act', 'issuance_form', 'issuance_act', 'premiums_act', 'reports_form', 'parametric_act'];

export const PARTNER2_REFUSALS: readonly Partner2Refusal[] = Object.freeze([
  // ── founder Q1 / Q2 / Q4 — money the insurer console never claims (every insurer page) ──
  { id: 'premium_yours', canon: 'W245 / W249 / W251 "premium collects at issuance" · "settles T+1 to your account" (2b\'s W251 carries the full page)', surfaces: [...BOOK, 'ins_issuance', 'ins_premiums'],
    key: 'partner2.refusal.premiumYours', why: 'founder Q1: the remittance model is not chosen; premiums sit in platform escrow and nothing moves them (survey F-2)' },
  { id: 'claims_figures', canon: 'W245 KPI "Claims open 11 · 2 approved · paying (16:00 run) · median settle 9 days" · "Claim-paid ratio (FY) 94%" · "2 claims decided this morning"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.claimsFigures', why: 'founder Q2: no claims figure, no payout line, no run in PARTNER-2; kv_partner holds no grant on insurance_claims (PARTNER-3)' },
  { id: 'claim_reserve', canon: 'W245 / W262 "Reserves earmarked ✓" · "pays in the 16:00 run"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.claimReserve', why: 'founder Q2: claims are paid from the platform\'s own account today (survey F-2); no insurer funding leg exists' },
  { id: 'subsidy_commission', canon: 'W246 / W247 "commission to platform (our_commission_bps) itemised … never hidden in premium" · "Govt subsidy (40%) ₹320"', surfaces: ['ins_products', 'ins_product', 'ins_dashboard'],
    key: 'partner2.refusal.subsidyCommission', why: 'founder Q4: both are recorded on the product; nothing computes or charges either (survey §1 money 3–4)' },
  // ── W245 (the insurer dashboard) ──
  { id: 'consent_expiry', canon: 'W245 "Consent-gated … enrolment data arrives with the farmer\'s consent, expires with the policy decision, and claims data lives only as long as the claim"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.consentExpiry', why: 'survey F-4: no insurance consent exists; founder Q6 limits the read to policy facts instead; founder Q8: no retention promise' },
  { id: 'season_window', canon: 'W245 "Agri insurance desk · kharif window closes Fri 31 Jul — 18 days"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.seasonWindow', why: 'the window lives on `schemes`, never on an insurance product (survey §1A)' },
  { id: 'season_growth', canon: 'W245 "enrolments (this kharif) 1,214 · +38% vs last kharif — land records cut form time to 4 min"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.seasonGrowth', why: 'no season model on a policy; the comparison and the minutes are unprovable' },
  { id: 'parametric_watch', canon: 'W245 "Parametric weather watch … would pay 412 policies" · W247 "triggers pay … from certified weather data"', surfaces: ['ins_dashboard', 'ins_product', 'ins_parametric'],
    key: 'partner2.refusal.parametricWatch', why: 'founder Q3: no index feed, no trigger evaluation, no batch payout — refused for Phase 1 (survey F-6)' },
  { id: 'camp_batch', canon: 'W245 "batch of 82 enrolments (camp) reviewed & ready to issue … issuance slots reserved"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.campBatch', why: 'no batch, no camp, no slot model; issuance is not on the platform (founder Q5)' },
  { id: 'enrolment_checks', canon: 'W245 "land records + animal registries … 72h intimation by phone … Claims pay through platform rails to verified accounts"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.enrolmentChecks', why: 'the sum insured is trusted at enrolment (insurance-policy.service.ts:58-61); no calling channel; claims credit a wallet from the platform\'s own account' },
  { id: 'claim_clocks', canon: 'W245 error state "Claims SLA clocks are server-side and safe"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.claimClocks', why: 'no claim response clock exists' },
  { id: 'plan_settings', canon: 'W245–W262 flagged-off state "See plan settings"', surfaces: [...BOOK, ...HONEST],
    key: 'partner2.refusal.planSettings', why: 'an insurer has no plan; `insurance` and `partner_console` are the platform\'s switches' },
  // ── W246 / W247 (the products) ──
  { id: 'products_platform_authored', canon: 'W246 / W247 "New product" ×2 · "Choose kind" · "Save (new policies only)" → W2869–W2872', surfaces: ['ins_products', 'ins_product', 'ins_form'],
    key: 'partner2.refusal.productsPlatformAuthored', why: 'founder Q7: products are authored by the platform in the admin realm after a signed agreement; the tenant route is refused by name (INSURANCE_PRODUCT_PLATFORM_AUTHORED)' },
  { id: 'kinds_registry', canon: 'W246 "Your shelf: 11 kinds in the registry from crop to parametric weather"', surfaces: ['ins_products', 'ins_product'],
    key: 'partner2.refusal.kindsRegistry', why: 'survey F-13: the `insurance_kind` lookup type is not registered and has 0 values' },
  { id: 'rupees_only', canon: 'W246 "Premium calc is data … farmers see ₹ premiums, never percentages"', surfaces: ['ins_products'],
    key: 'partner2.refusal.rupeesOnly', why: 'survey F-8: the tenant catalogue still returns the stored terms raw (P2-B14, named for the insurance owner)' },
  { id: 'loan_linked', canon: 'W246 "The cattle product is loan-linked by rule (Apr 2026)" · W248 "cattle, loan-linked LN pending disb." · W250 "issued as the disbursement pre-flight condition"', surfaces: ['ins_products', 'ins_policies', 'ins_policy'],
    key: 'partner2.refusal.loanLinked', why: 'fintech has no insurance precondition (survey §1B)' },
  { id: 'same_week', canon: 'W246 empty state "FPO tenants route enrolments the same week"', surfaces: ['ins_products'],
    key: 'partner2.refusal.sameWeek', why: 'unprovable' },
  { id: 'snapshot_half', canon: 'W246 "premium changes apply to NEW policies only (snapshot law)"', surfaces: ['ins_products', 'ins_product'],
    key: 'partner2.refusal.snapshotHalf', why: 'survey F-11: only the farmer\'s premium is stored on the policy; subsidy, commission and the formula are not' },
  { id: 'farmer_gauge', canon: 'W247 "Junagadh sits at 61% of normal today … Policyholders see this same gauge" · W262 "Every policyholder sees this same gauge in Gujarati" · the farmer-facing payout display', surfaces: ['ins_product', 'ins_parametric'],
    key: 'partner2.refusal.farmerGauge', why: 'founder Q3: no index reading, no farmer gauge, no generated payout promise' },
  { id: 'batch_payout', canon: 'W247 "If it triggers, 412 policies pay in one batch within 72h" · W262 "this screen executes — 412 payouts, one batch, 72h, zero forms"', surfaces: ['ins_product', 'ins_parametric'],
    key: 'partner2.refusal.batchPayout', why: 'founder Q3: no batch payout exists' },
  { id: 'changes_recorded', canon: 'W247 "Product changes recorded · trigger terms are immutable per policy once issued" · "platform compliance review"', surfaces: ['ins_product'],
    key: 'partner2.refusal.changesRecorded', why: 'products are not changed from the console; `parametric_triggers` was written only by the refused issue route; no review exists' },
  // ── W248 / W250 (the policies) ──
  { id: 'holder_identity', canon: 'W248 "Holder <a person> · <a masked phone>" · W250 "Cattle cover — <a person>" · W249 the named proposals', surfaces: ['ins_policies', 'ins_policy', 'ins_issuance'],
    key: 'partner2.refusal.holderIdentity', why: 'founder Q6: policy facts only — never a name, a phone or a user id; anything more needs a per-policy consent (P2-B3)' },
  { id: 'policy_number', canon: 'W248 / W250 policy numbers of an insurer\'s own series', surfaces: ['ins_policies', 'ins_policy'],
    key: 'partner2.refusal.policyNumber', why: 'founder Q5: no insurer issues on the platform; policy_no is NULL on every activated policy' },
  { id: 'ending_notice', canon: 'W248 "A lapse warning reaches the holder at T-14 and T-3" · "lapse warnings fire regardless" · the "lapsing ≤ 14d" chip', surfaces: ['ins_policies'],
    key: 'partner2.refusal.endingNotice', why: 'survey F-10: no lifecycle job, no notice; nothing lapses (P2-B9)' },
  { id: 'book_export', canon: 'W248 "Export book (signed)" → W2881–W2882 · bulk bar "3 highlighted of 2,841 active"', surfaces: ['ins_policies', 'policies_export'],
    key: 'partner2.refusal.bookExport', why: 'survey F-14: no partner export plane (P2-B6); no bulk act' },
  { id: 'issuance_desk', canon: 'W248 empty state "your book builds from the issuance desk — proposals arrive daily in season"', surfaces: ['ins_policies'],
    key: 'partner2.refusal.issuanceDesk', why: 'founder Q5: the issuance desk is 2b\'s honest page; no arrival rate is provable' },
  { id: 'underwriting_role', canon: 'W248 "Policy detail needs underwriting role"', surfaces: ['ins_policies'],
    key: 'partner2.refusal.underwritingRole', why: 'no such role; every partner role reads the same policy facts (0228)' },
  { id: 'subject_record', canon: 'W250 subject block: registry id, animal tag, breed, health file, valuation "not self-declared"', surfaces: ['ins_policy'],
    key: 'partner2.refusal.subjectRecord', why: 'founder Q6: kv_partner has no grant on animals or land; the sum insured is trusted at enrolment' },
  { id: 'payment_reference', canon: 'W250 "payment_id pmt-…8845 · farmer-paid at issuance; the loan\'s ₹-terms reimburse it at disbursal"', surfaces: ['ins_policy'],
    key: 'partner2.refusal.paymentReference', why: 'founder Q6: premium_payment_id is never read; no loan reimbursement exists' },
  { id: 'milk_renewal', canon: 'W250 "Renewal Jul 2027 · deducted from milk bill with fresh consent"', surfaces: ['ins_policy'],
    key: 'partner2.refusal.milkRenewal', why: 'seed 0005: the insurance milk deduction has no destination; the autopay link is audit-only and OFF' },
  { id: 'holder_summary', canon: 'W250 "What the holder sees (gu)" with a toll-free number', surfaces: ['ins_policy'],
    key: 'partner2.refusal.holderSummary', why: 'no such summary; no helpline literal anywhere (the claims guard)' },
  { id: 'policy_acts', canon: 'W250 "Cancellation … requires the lender\'s acknowledgment" · Issue / Cancel / Endorse → W2888–W2890', surfaces: ['ins_policy', 'policy_act'],
    key: 'partner2.refusal.policyActs', why: 'founder Q5: nothing is issued, cancelled or endorsed from the partner console' },
  { id: 'partial_refund', canon: 'W250 "pro-rata refund on any cancellation, computed and shown before confirm"', surfaces: ['ins_policy', 'policy_act'],
    key: 'partner2.refusal.partialRefund', why: 'no refund code for a policy (MONEY)' },
  { id: 'retention', canon: 'W250 "Expired policies stay viewable for 7 years" · W245 "claims data lives only as long as the claim"', surfaces: ['ins_policy', 'ins_dashboard'],
    key: 'partner2.refusal.retention', why: 'founder Q8: no retention promise is printed until a policy is set' },
  { id: 'vet_desk', canon: 'W250 "the vet file shows summaries — full clinicals stay with the vet desk"', surfaces: ['ins_policy'],
    key: 'partner2.refusal.vetDesk', why: 'no veterinary desk exists' },
  { id: 'policy_document', canon: 'W250 "Policy PDF (bilingual)" → W2886–W2887', surfaces: ['ins_policy', 'policy_export'],
    key: 'partner2.refusal.policyDocument', why: 'P2-B7: no document generator; a policy with no number would be invented' },
  // ── the shared chain-template sentences ──
  { id: 'chain_zero_sum', canon: 'W2871 / W2874 / W2884 / W2889 "Money-adjacent actions reconcile zero-sum before this page ever shows"',
    surfaces: CHAIN_TEMPLATE, key: 'partner2.refusal.chainZeroSum', why: 'nothing on these pages moves money' },
  { id: 'chain_on_call', canon: 'W2872 / W2875 / W2885 / W2890 "repeated failures page the on-call"',
    surfaces: CHAIN_TEMPLATE, key: 'partner2.refusal.chainOnCall', why: 'no paging from a partner page exists' },
  { id: 'chain_audit', canon: 'W2871 / W2874 "View audit trail" · "the audit trail has the entry"',
    surfaces: CHAIN_TEMPLATE, key: 'partner2.refusal.chainAudit', why: 'a re-read writes nothing; each read of the book is recorded as a read' },
  { id: 'report_pack', canon: 'W2869–W2872 the same form chain also serves W254 "Generate Q1 pack" (×2)', surfaces: ['ins_form', 'ins_reports', 'reports_form'],
    key: 'partner2.refusal.reportPack', why: 'no report pack is generated on the platform (W254 is 2b\'s honest page)' },
  { id: 'export_link', canon: 'W2881 / W2882 / W2886 / W2887 / W2896 / W2897 "queued" · "ready — signed link, expires in 15 min"', surfaces: ['policies_export', 'policy_export', 'premiums_export'],
    key: 'partner2.refusal.exportLink', why: 'no partner export job, receipt or signed link exists (P2-B6)' },
  // ══ PC-56 PARTNER-2b · WHERE THE MONEY IS NOT ════════════════════════════════════════════════════════════════════════════════════════
  // ── W249 (the issuance desk — founder Q5: the insurer never issues on the platform; the queue is a READ) ──
  { id: 'pre_verified', canon: 'W249 "Camp batches arrive pre-verified (land records, Aadhaar, bank seeding from platform KYC) — your reviewers check the insurance facts" · "82/82 pre-verified"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.preVerified', why: 'no batch or camp model; enrolment verifies nothing about the subject — the sum insured is trusted (insurance-policy.service.ts:58-61)' },
  { id: 'issue_act', canon: 'W249 "Issue reviewed batch (82, checker)" → W2944–W2947 · "batch issuance adds a checker" · "Review batch"', surfaces: ['ins_issuance', 'issuance_form'],
    key: 'partner2.refusal.issueAct', why: 'founder Q5: a captured farmer payment activates cover by itself (survey F-5); there is no insurer act and no second approver (P2-B4, a money wave)' },
  { id: 'issue_idempotent', canon: 'W249 "Issuance is idempotent per proposal — a re-run … cannot double-issue"', surfaces: ['ins_issuance', 'issuance_form'],
    key: 'partner2.refusal.issueIdempotent', why: 'founder Q5: nothing is issued, so there is nothing to key — no act exists to repeat' },
  { id: 'reject_rate', canon: 'W249 KPI "Rejection rate 1.8%"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.rejectRate', why: 'an insurer cannot reject a proposal on the platform (no such transition for an insurer)' },
  { id: 'proposal_latency', canon: 'W249 KPI "Median proposal → policy 26h · SLA 72h"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.proposalLatency', why: 'computable later from the activation audit row (P2-B4\'s wave) — but the activation path has no insurer act to time, so a figure here would time the farmer\'s payment and call it yours' },
  { id: 'holder_document', canon: 'W249 KPI "Issued this kharif 1,214 — policy PDF + voice summary to every holder, same hour"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.holderDocument', why: 'no policy document generator (P2-B7), no spoken summary, no season count on a policy' },
  { id: 'parked_rows', canon: 'W249 rows "BATCH-0711-PMF …" · "PRP-2026-0713-02 <a person> … parked, holder informed" · "PRP-2026-0712-08 <a person> … AWS grid assignment pending"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.parkedRows', why: 'no batch, no hold state, no message to a farmer, no weather-station grid on a proposal; names refused (founder Q6)' },
  { id: 'clock_pause', canon: 'W249 error state "Couldn\'t load proposals — the 72h SLA pauses on platform errors"', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.clockPause', why: 'no response clock runs on a proposal' },
  { id: 'unissued_guarantee', canon: 'W249 "Premium collects at issuance (next screen); no policy activates unpaid, no farmer pays for an unissued policy. Both directions, guaranteed."', surfaces: ['ins_issuance'],
    key: 'partner2.refusal.unissuedGuarantee', why: 'the first half is true (no policy activates unpaid: premium-payment-succeeded.handler.ts:57-63); the second is false — the farmer pays and is covered with no insurer acting (F-2, F-5)' },
  { id: 'partner_roles', canon: 'W249 "Issuance restricted — Underwriting role" · W251 "Premiums restricted — Finance role" · W254 "Reports restricted — Compliance role"', surfaces: ['ins_issuance', 'ins_premiums', 'ins_reports'],
    key: 'partner2.refusal.partnerRoles', why: 'no such roles: the four partner roles (admin, checker, maker, viewer) all read the same facts (0228, founder 2b-2)' },
  // ── W251 (premiums — founder Q1: the remittance model is not chosen; nothing counted as the insurer\'s) ──
  { id: 'collected_sum', canon: 'W251 KPI "Collected this kharif (farmer share) ₹24,61,400"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.collectedSum', why: 'founder Q1: premiums sit in platform escrow and nothing moves them (F-2); a total would describe money the insurer does not hold' },
  { id: 'settles_next_day', canon: 'W251 "settles T+1 to your account"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.settlesNextDay', why: 'founder Q1: no remittance, settlement or payout to an insurer exists (P2-B10, a money wave with a lawyer)' },
  { id: 'subsidy_owed', canon: 'W251 KPI "Govt subsidy receivable ₹1,08,40,000 · claimed via scheme portal" · "Subsidy receivables are booked, not counted as cash … Optimism is not accounting"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.subsidyOwed', why: 'founder Q4: the government share is computed and discarded (premium-calc.ts:44-48), never stored, booked or claimed (P2-B5)' },
  { id: 'refunds_line', canon: 'W251 KPI "Refunds (pro-rata, FY) ₹18,400 · 11 cancellations · computed-shown-confirmed"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.refundsLine', why: 'no refund code exists for a policy (MONEY)' },
  { id: 'remit_batches', canon: 'W251 the settlement batches table "PMF-SETT-0712 … matched to policy IDs ✓"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.remitBatches', why: 'founder Q1: no batch of payments to an insurer exists' },
  { id: 'rupee_policy_no', canon: 'W251 "every rupee maps to a policy_no — orphan premiums cannot exist"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.rupeePolicyNo', why: 'founder Q5: policy_no is NULL on every activated policy; nothing reconciles a premium to an insurer' },
  { id: 'unpaid_zero', canon: 'W251 KPI "Unpaid issued policies 0 — structurally zero — payment gates issuance"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.unpaidZero', why: 'true in substance (no policy activates unpaid) but nothing is issued: the payment itself starts cover (F-5)' },
  { id: 'one_transaction', canon: 'W251 empty state "No collections yet — payment and policy are one transaction"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.oneTransaction', why: 'two transactions: the payment capture, then the relay-delivered activation (premium-payment-succeeded.handler.ts:18-24)' },
  { id: 'rails_unaffected', canon: 'W251 error state "Couldn\'t load collections — Settlement rails are unaffected"', surfaces: ['ins_premiums'],
    key: 'partner2.refusal.railsUnaffected', why: 'no payment route to an insurer exists to be affected' },
  { id: 'premiums_file', canon: 'W251 "Export (signed)" → W2896–W2897 · "recon detail adds platform-signed exports"', surfaces: ['ins_premiums', 'premiums_export'],
    key: 'partner2.refusal.premiumsFile', why: 'founder Q1 + 2b-1: a premiums file would publish figures about money the insurer has not received; no partner export plane (P2-B6)' },
  // ── W254 (reports — Q2/Q3: every regulatory and payout claim refused by name; "we never file for you" is true and stays) ──
  { id: 'rural_quota', canon: 'W254 KPI "Rural sector obligation 100% — every platform policy is rural by construction"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.ruralQuota', why: 'a regulatory claim the platform cannot vouch for (a lawyer\'s question)' },
  { id: 'claims_time', canon: 'W254 KPI "Claims settled ≤ 30d 96% · median 9 days · IRDAI TAT comfortably met"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.claimsTime', why: 'founder Q2: claims are PARTNER-3\'s; no turnaround read; a regulatory compliance claim' },
  { id: 'complaints', canon: 'W254 KPI "Grievances (FY) 3 … 0 escalated to ombudsman"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.complaints', why: 'no complaint model for insurance exists' },
  { id: 'extracts_table', canon: 'W254 the extracts table with `sha256:4e8a…71c9` · "same signed-manifest format as every platform export"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.extractsTable', why: 'the signed receipt exists for the TENANT export plane only (0169); no partner plane (P2-B6, founder 2b-1)' },
  { id: 'replay', canon: 'W254 "the parametric audit extract shows every trigger evaluation … the regulator can replay the exact computation" · W262 "the regulator can replay the computation"', surfaces: ['ins_reports', 'ins_parametric'],
    key: 'partner2.refusal.replay', why: 'founder Q3: no evaluation was ever made or kept (F-6)' },
  { id: 'schedule', canon: 'W254 state "First quarter building — Extracts generate quarterly"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.schedule', why: 'nothing generates on any schedule' },
  { id: 'download_mark', canon: 'W254 state "Reports restricted — … extracts watermark per download"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.downloadMark', why: 'the watermark exists only on the tenant report builder (dataset.registry.ts:25-27); no partner download exists' },
  { id: 'prior_packs', canon: 'W254 states "No report packs generated yet" · "Couldn\'t generate pack — Prior packs remain valid"', surfaces: ['ins_reports', 'reports_form'],
    key: 'partner2.refusal.priorPacks', why: 'no pack was ever generated' },
  { id: 'drill_ins', canon: 'W254 drill-ins "Claims TAT …" and "Parametric trigger audit"', surfaces: ['ins_reports'],
    key: 'partner2.refusal.drillIns', why: 'claims timing is PARTNER-3\'s; no trigger history exists (founder Q3)' },
  // ── W262 (the parametric run — founder Q3: refused for Phase 1; an honest page) ──
  { id: 'season_armed', canon: 'W262 "WBCIS kharif armed · window to 31 Jul" · "412 policies watch the same certified rainfall index"', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.seasonArmed', why: 'founder Q3: a parametric product is a label on a product; no window is watched' },
  { id: 'index_feed', canon: 'W262 "Index watch (certified feed, mirrored to policyholders)" · "Couldn\'t load index feed — evaluation continues server-side"', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.indexFeed', why: 'no index is ingested; `weather_alerts` (0010) are advisories, not an index' },
  { id: 'run_figures', canon: 'W262 "If trigger 1 fires": 412 policies · ₹6,000/acre · 1,286 acre · ₹77,16,000 batch', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.runFigures', why: 'fabricated figures over no engine (F-6)' },
  { id: 'set_aside', canon: 'W262 "Reserves earmarked ✓"', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.setAside', why: 'founder Q2: the platform holds no insurer money; claims are paid from the platform\'s own account today (F-2)' },
  { id: 'no_human', canon: 'W262 "execution is automatic on index certification + your CFO\'s standing release authority — no per-farmer decisions exist to slow it down" · "Run restricted — Execution: automatic — that is the design; only the standing authority is human"', surfaces: ['ins_parametric', 'parametric_act'],
    key: 'partner2.refusal.noHuman', why: 'founder Q3: never an automatic money-out; any future run needs a certified source, an evaluation log and a human release per batch (P2-B12, refused)' },
  { id: 'payout_promise', canon: 'W262 "The quiet promise … 412 families get money before they finish worrying"', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.payoutPromise', why: 'a payout promise (founder Q3)' },
  { id: 'run_states', canon: 'W262 states "No parametric products armed — runs arm automatically when a product with active policies enters its window"', surfaces: ['ins_parametric'],
    key: 'partner2.refusal.runStates', why: 'founder Q3: nothing arms, evaluates or runs' },
  { id: 'trigger_trail', canon: 'W262 "Trigger audit trail" → W2977–W2979 (FM chain-mutate, a read — F-17) · "Retry"', surfaces: ['ins_parametric', 'parametric_act'],
    key: 'partner2.refusal.triggerTrail', why: 'no trigger record exists to open (founder Q3)' },
]);

/** The canon shapes PARTNER-2a builds differently — recorded DELTAs, not refusals. */
export const PARTNER2_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'insurer_routes', canon: 'W245 `insurer/dashboard` · W246 `insurer/products` · W247 `insurer/products/[id]` · W248 `insurer/policies` · W250 `insurer/policies/[id]`',
    built: 'the canon\'s own paths, built; the old `/insurance-products`, `/insurance-policies(/[id])`, `/insurance-book` answer 307 to them; `/insurance-claims(/[id])` stay not-yet (PARTNER-3)' },
  { id: 'chain_routes', canon: 'the chain pages W2869–W2875, W2881–W2890 as separate files',
    built: 'query states of their parent page: `/insurer/products?form=` (and `/insurer/products/[id]?form=`), `?retry=` on the dashboard / products / product, `/insurer/policies?export=` / `?retry=`, `/insurer/policies/[id]?export=` / `?act=`' },
  { id: 'product_read_only', canon: 'W247 "Product Edit" (an editor with Save)', built: '`/insurer/products/[id]` READ-ONLY: every stored field as data; Choose kind / Save are DECOR (founder Q7)' },
  { id: 'fm_numbering', canon: 'FLOWMAP chain targets W1326… / W1404… / W1456… (survey C-14)', built: 'none exist; mapped by module + pattern to W2869–W2875 / W2881–W2890' },
  { id: 'fm_misclass', canon: 'FLOWMAP W248 "proposed" chip as chain-mutate, the policy-row drills as `filter`, the avatar as `filter` (F-17)', built: 'the chip is a status filter; the rows link to the policy; no avatar is drawn' },
  { id: 'chain_back_defect', canon: 'W2869 "Back to the form" / W2870 "Back to edit" → W245 (the dashboard); W2872 "Retry — back to confirm" on a form chain (F-18)', built: 'every chain page links back to its own page' },
  { id: 'lending_in_insurance', canon: '04_PARTNER "Insurance … 50 screens" (C-2)', built: '9 of the 50 are lending (W208, W209, W2980–W2986) — PARTNER-2c, `pending_2c` below' },
  { id: 'regulator_ref', canon: 'the insurer header "<regulator> ref ••118"', built: 'the masked `regulator_ref` from `/me` (last 4) with no regulator named — `financial_partners` carries no regulator name' },
  { id: 'kind_nav', canon: 'the canon insurer sidebar (Dashboard · Products · Policies · Issuance · Premiums · Claims · reports · Notifications · Help)',
    built: 'kind-aware nav: an insurer sees Dashboard · Products · Policies (2b adds Issuance · Premiums · Reports) and the Account group, never the lending group; built routes only' },
  { id: 'subject_type_only', canon: 'W248 subject "animal (buffalo ×2)"', built: 'the subject TYPE only (founder Q6)' },
  // ── PC-56 PARTNER-2b ──
  { id: 'honest_routes', canon: 'W249 `insurer/issuance` · W251 `insurer/premiums` · W254 `insurer/reports` · W262 `insurer/parametric`',
    built: 'the canon\'s own paths, built as a READ (issuance) and three honest pages; the chains are query states: `/insurer/issuance?form=` / `?act=`, `/insurer/premiums?export=` / `?act=`, `/insurer/reports?form=`, `/insurer/parametric?act=`' },
  { id: 'issuance_read', canon: 'W249 the issuance desk over the proposals', built: 'a dedicated read `GET /v1/partner/insurance/issuance` — `proposed` only by construction (no status parameter), the queue row\'s allow-list, keyset, one audit row (surface `issuance`)' },
  { id: 'report_pack_chain', canon: 'W254 "Generate Q1 pack" ×2 → the PRODUCT form chain W2869–W2872 (F-18)', built: '`/insurer/reports?form=` — the reports page\'s own query state with the refusal; it owns no canon file (W2869–W2872 stay 2a\'s DECOR)' },
  { id: 'form_retry_defect', canon: 'W2947 "Retry — back to confirm" on a FORM chain (F-18)', built: 'the issuance form chain links back to `/insurer/issuance`; a form has no confirm' },
  { id: 'trigger_trail_misclass', canon: 'FLOWMAP W262 "Trigger audit trail" (a read) as chain-mutate (F-17)', built: 'DECOR: `/insurer/parametric?act=confirm` says there is no run and no trigger record' },
  { id: 'date_cell_misclass', canon: 'FLOWMAP W249 "12 Jul" (a row cell) as `filter` (F-17)', built: 'no date filter: the queue is newest first with a keyset link only' },
  { id: 'mutate_as_act', canon: 'W2898–W2900, W2948–W2950 "Retry" (PARITY-DECOR) and W2977–W2979', built: 'the three mutate chains are `?act=` query states (2a used `?retry=` for its own two; 2b follows the brief)' },
  { id: 'parametric_not_in_nav', canon: 'the canon insurer sidebar has no Parametric item; W262 is reached from the run', built: '`/insurer/parametric` is linked from the insurer dashboard and the products page, NOT from the nav (founder 2b-4)' },
  { id: 'streamed_redirects', canon: '(engineering) every page-level `redirect()` of the console', built: 'arrives as HTTP 200 + a meta-refresh (app/loading.tsx streams the shell); accepted by the founder (2b-3) — a named item for the partner sweep; nothing changed' },
  { id: 'premiums_counts', canon: 'W251 the four money KPIs', built: 'two COUNTS from the 2a dashboard read (in force, proposed) labelled as counts — no rupee figure anywhere on the page (founder Q1)' },
]);

/** Every canon file of PARTNER-2 (50): 2a's 22 and 2b's 19 decided; 2c's 9 pending its wave. */
export type Partner2Verdict = 'BUILT' | 'BUILT (read-only)' | 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR' | 'pending_2b' | 'pending_2c';
export const PARTNER2_CANON_FILES: readonly { file: string; wave: '2a' | '2b' | '2c'; verdict: Partner2Verdict; note: string }[] = Object.freeze([
  // ── 2a · THE INSURER READS ITS OWN BOOK (22) ──
  { file: 'W245-partner-ins-dashboard.html', wave: '2a', verdict: 'BUILT', note: '/insurer/dashboard over GET /v1/partner/insurance/dashboard: in force + Σ sum insured, proposed (awaiting the farmer\'s payment), FPOs, products, with as-of; claims / reserves / payouts / runs refused' },
  { file: 'W246-partner-ins-products.html', wave: '2a', verdict: 'BUILT', note: '/insurer/products: own products — kind or "not registered", own terms in integer bps, subsidy and commission "recorded, not charged", parametric yes/no, policies by status; New product DECOR' },
  { file: 'W247-partner-ins-product-edit.html', wave: '2a', verdict: 'BUILT (read-only)', note: '/insurer/products/[id]: every stored field as data; Choose kind / Save DECOR (founder Q7); the trigger and payout copy refused' },
  { file: 'W248-partner-policies.html', wave: '2a', verdict: 'BUILT', note: '/insurer/policies: keyset list of policy facts (number or "none yet", FPO public name, subject type, sum insured, farmer premium, status, dates), status filter; no name or phone; Export DECOR' },
  { file: 'W250-partner-policy-detail.html', wave: '2a', verdict: 'BUILT', note: '/insurer/policies/[id]: the policy facts; no subject, health or holder block; Issue / Cancel / Endorse DECOR; the document refused' },
  { file: 'W2869-partner-ins-form-form-error.html', wave: '2a', verdict: 'DECOR', note: '/insurer/products?form=error — no product form: the platform authors products' },
  { file: 'W2870-partner-ins-form-review.html', wave: '2a', verdict: 'DECOR', note: '/insurer/products?form=review — nothing to review' },
  { file: 'W2871-partner-ins-form-success.html', wave: '2a', verdict: 'DECOR', note: '/insurer/products?form=success — nothing was saved' },
  { file: 'W2872-partner-ins-form-failure.html', wave: '2a', verdict: 'DECOR', note: '/insurer/products?form=failure — nothing changed; the "Retry → confirm" and "Back → W245" defects are DELTAs' },
  { file: 'W2873-partner-ins-mutate-confirm.html', wave: '2a', verdict: 'PARITY-DECOR', note: '?retry=confirm on the dashboard / products / product — a re-read needs no confirm' },
  { file: 'W2874-partner-ins-mutate-success.html', wave: '2a', verdict: 'PARITY-DECOR', note: '?retry=success — read again; nothing written' },
  { file: 'W2875-partner-ins-mutate-failure.html', wave: '2a', verdict: 'PARITY-DECOR', note: '?retry=failure — nothing changed' },
  { file: 'W2881-partner-policies-export-queued.html', wave: '2a', verdict: 'DECOR', note: '/insurer/policies?export=queued — no partner export plane (P2-B6)' },
  { file: 'W2882-partner-policies-export-ready.html', wave: '2a', verdict: 'DECOR', note: '/insurer/policies?export=ready — no file, no signed link' },
  { file: 'W2883-partner-policies-mutate-confirm.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies?retry=confirm — a re-read' },
  { file: 'W2884-partner-policies-mutate-success.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies?retry=success — read again' },
  { file: 'W2885-partner-policies-mutate-failure.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies?retry=failure — nothing changed' },
  { file: 'W2886-partner-policy-export-queued.html', wave: '2a', verdict: 'DECOR', note: '/insurer/policies/[id]?export=queued — no policy document (P2-B7)' },
  { file: 'W2887-partner-policy-export-ready.html', wave: '2a', verdict: 'DECOR', note: '/insurer/policies/[id]?export=ready — no document to download' },
  { file: 'W2888-partner-policy-mutate-confirm.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies/[id]?act=confirm — Retry is a re-read; issue / cancel / endorse are not done here' },
  { file: 'W2889-partner-policy-mutate-success.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies/[id]?act=success — read again; nothing written' },
  { file: 'W2890-partner-policy-mutate-failure.html', wave: '2a', verdict: 'PARITY-DECOR', note: '/insurer/policies/[id]?act=failure — nothing changed' },
  // ── 2b · WHERE THE MONEY IS NOT (19) ──
  { file: 'W249-partner-issuance.html', wave: '2b', verdict: 'BUILT (read)', note: '/insurer/issuance over GET /v1/partner/insurance/issuance: the `proposed` policies on own products (policy, product, FPO public name, subject type, sum insured, the premium the farmer will pay, proposed-at, the cover window), keyset; the statement "Cover starts when the farmer\'s premium payment is confirmed …"; the act DECOR; camp / pre-verified / checker / rejection / document / parked / grid / clock / roles / latency refused' },
  { file: 'W251-partner-premiums.html', wave: '2b', verdict: 'BUILT (honest)', note: '/insurer/premiums: the founder-approved statement (partner2.premiums.statement) and two COUNTS from the dashboard read (in force, proposed) — no rupee figure; collected / next-day settlement / subsidy owed / refunds / batches / policy-number matching refused; Export DECOR' },
  { file: 'W254-partner-ins-reports.html', wave: '2b', verdict: 'BUILT (honest)', note: '/insurer/reports: "Signed extracts for your filings are not available from the partner console yet"; "we never file for you" kept; View policies real; Generate pack DECOR (?form=, F-18); every regulatory and payout claim refused' },
  { file: 'W262-partner-parametric-run.html', wave: '2b', verdict: 'BUILT (honest)', note: '/insurer/parametric (linked from the dashboard and products, not the nav): "There is no parametric run …"; own products marked parametric and the policies in force on them, as COUNTS; Trigger audit trail DECOR; the whole run refused' },
  { file: 'W2896-partner-premiums-export-queued.html', wave: '2b', verdict: 'DECOR', note: '/insurer/premiums?export=queued — no premiums file (it would publish money the insurer has not received); exports not available, write to the partners mailbox' },
  { file: 'W2897-partner-premiums-export-ready.html', wave: '2b', verdict: 'DECOR', note: '/insurer/premiums?export=ready — no file, no signed link' },
  { file: 'W2898-partner-premiums-mutate-confirm.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/premiums?act=confirm — Retry is a re-read; nothing to confirm' },
  { file: 'W2899-partner-premiums-mutate-success.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/premiums?act=success — read again; nothing written' },
  { file: 'W2900-partner-premiums-mutate-failure.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/premiums?act=failure — nothing changed' },
  { file: 'W2944-partner-issuance-form-form-error.html', wave: '2b', verdict: 'DECOR', note: '/insurer/issuance?form=error — no issue form; the statement printed' },
  { file: 'W2945-partner-issuance-form-review.html', wave: '2b', verdict: 'DECOR', note: '/insurer/issuance?form=review — nothing to review; the statement printed' },
  { file: 'W2946-partner-issuance-form-success.html', wave: '2b', verdict: 'DECOR', note: '/insurer/issuance?form=success — nothing was issued' },
  { file: 'W2947-partner-issuance-form-failure.html', wave: '2b', verdict: 'DECOR', note: '/insurer/issuance?form=failure — nothing changed; the "Retry — back to confirm" defect is a DELTA' },
  { file: 'W2948-partner-issuance-mutate-confirm.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/issuance?act=confirm — Retry is a re-read' },
  { file: 'W2949-partner-issuance-mutate-success.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/issuance?act=success — read again' },
  { file: 'W2950-partner-issuance-mutate-failure.html', wave: '2b', verdict: 'PARITY-DECOR', note: '/insurer/issuance?act=failure — nothing changed' },
  { file: 'W2977-partner-parametric-mutate-confirm.html', wave: '2b', verdict: 'DECOR', note: '/insurer/parametric?act=confirm — no run and no trigger record exist (a confirm over a read that does not exist, F-17)' },
  { file: 'W2978-partner-parametric-mutate-success.html', wave: '2b', verdict: 'DECOR', note: '/insurer/parametric?act=success — nothing ran' },
  { file: 'W2979-partner-parametric-mutate-failure.html', wave: '2b', verdict: 'DECOR', note: '/insurer/parametric?act=failure — nothing ran, so nothing failed' },
  // ── 2c · THE LENDER'S SHELF (9) ──
  { file: 'W208-partner-products.html', wave: '2c', verdict: 'pending_2c', note: 'loan products — PARTNER-2c (lending, C-2)' },
  { file: 'W209-partner-product-edit.html', wave: '2c', verdict: 'pending_2c', note: 'loan product terms — PARTNER-2c' },
  { file: 'W2980-partner-product-form-form-error.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2981-partner-product-form-review.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2982-partner-product-form-success.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2983-partner-product-form-failure.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2984-partner-product-mutate-confirm.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2985-partner-product-mutate-success.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
  { file: 'W2986-partner-product-mutate-failure.html', wave: '2c', verdict: 'pending_2c', note: 'PARTNER-2c' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner2RefusalKeys(surface: Partner2Surface): string[] {
  return PARTNER2_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain2Id = 'ins_form' | 'ins_retry' | 'policies_export' | 'policies_retry' | 'policy_export' | 'policy_act'
  | 'issuance_form' | 'issuance_act' | 'premiums_export' | 'premiums_act' | 'reports_form' | 'parametric_act';
export interface Chain2Def {
  id: Chain2Id; wave: '2a' | '2b'; param: string; page: string; surface: Partner2Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[];
  /** PC-56 PARTNER-2b: a sentence the chain page prints above its own (the founder-approved statement of its page), if any. */
  statement?: string;
  /** PC-56 PARTNER-2b (founder 2b-1): an export / pack chain prints "exports are not available … write to the partners mailbox" + the mailbox fact. */
  mailbox?: boolean;
}
export const PARTNER2_CHAINS: readonly Chain2Def[] = Object.freeze([
  { id: 'ins_form', wave: '2a', param: 'form', page: '/insurer/products', surface: 'ins_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner2.chain.form.${s}`, files: ['W2869', 'W2870', 'W2871', 'W2872'] },
  { id: 'ins_retry', wave: '2a', param: 'retry', page: '/insurer/dashboard', surface: 'ins_retry', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2873', 'W2874', 'W2875'] },
  { id: 'policies_export', wave: '2a', mailbox: true, param: 'export', page: '/insurer/policies', surface: 'policies_export', states: ['queued', 'ready'],
    key: (s: string) => `partner2.chain.booksExport.${s}`, files: ['W2881', 'W2882'] },
  { id: 'policies_retry', wave: '2a', param: 'retry', page: '/insurer/policies', surface: 'policies_retry', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2883', 'W2884', 'W2885'] },
  { id: 'policy_export', wave: '2a', mailbox: true, param: 'export', page: '/insurer/policies/[id]', surface: 'policy_export', states: ['queued', 'ready'],
    key: (s: string) => `partner2.chain.document.${s}`, files: ['W2886', 'W2887'] },
  { id: 'policy_act', wave: '2a', param: 'act', page: '/insurer/policies/[id]', surface: 'policy_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.act.${s}`, files: ['W2888', 'W2889', 'W2890'] },
  // ── PC-56 PARTNER-2b ──
  { id: 'issuance_form', wave: '2b', param: 'form', page: '/insurer/issuance', surface: 'issuance_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner2.chain.issuanceForm.${s}`, files: ['W2944', 'W2945', 'W2946', 'W2947'], statement: 'partner2.issuance.statement' },
  { id: 'issuance_act', wave: '2b', param: 'act', page: '/insurer/issuance', surface: 'issuance_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2948', 'W2949', 'W2950'] },
  { id: 'premiums_export', wave: '2b', mailbox: true, param: 'export', page: '/insurer/premiums', surface: 'premiums_export', states: ['queued', 'ready'],
    key: (s: string) => `partner2.chain.premiumsExport.${s}`, files: ['W2896', 'W2897'], statement: 'partner2.premiums.statement' },
  { id: 'premiums_act', wave: '2b', param: 'act', page: '/insurer/premiums', surface: 'premiums_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2898', 'W2899', 'W2900'] },
  { id: 'reports_form', wave: '2b', mailbox: true, param: 'form', page: '/insurer/reports', surface: 'reports_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner2.chain.reportsForm.${s}`, files: [], statement: 'partner2.reports.statement' },
  { id: 'parametric_act', wave: '2b', param: 'act', page: '/insurer/parametric', surface: 'parametric_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.parametricAct.${s}`, files: ['W2977', 'W2978', 'W2979'], statement: 'partner2.parametric.statement' },
]);
export function chain2ById(id: Chain2Id): Chain2Def { return PARTNER2_CHAINS.find((c) => c.id === id) as Chain2Def; }
/** The chain state a page was opened in (`?form=review` …), or null for the page itself / an unknown state. */
export function chain2State(id: Chain2Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain2ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}

/** PC-56 PARTNER-2a (survey E3) — the six old `/insurance-*` routes: four answer a real HTTP 307 to the canon's `insurer/*` paths (next.config.js
 *  `redirects()`, pinned equal to this map by the not-yet render test — their page files are gone); the claims pair stays not-yet (PARTNER-3). */
export const INSURANCE_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/insurance-products': '/insurer/products',
  '/insurance-policies': '/insurer/policies',
  '/insurance-policies/:id': '/insurer/policies/:id',
  '/insurance-book': '/insurer/dashboard',
});
