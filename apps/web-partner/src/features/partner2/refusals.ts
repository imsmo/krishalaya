// apps/web-partner/src/features/partner2/refusals.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK (survey E1) — WHAT THE INSURER CONSOLE
// DOES NOT CLAIM, BY NAME. PURE. The shape of features/partner1/refusals.ts: each refused canon claim is listed ONCE with where the canon
// makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// (test/claims-guard.spec.ts, the `partner2.` scope) keeps the canon's false words out of every value. The sentences word the refused claims
// generically: no scheme, regulator, institution or person of the canon is named in any value.
//
// THE SURFACES `Partner2Surface`: `ins_dashboard` (W245) · `ins_products` (W246) · `ins_product` (W247) · `ins_policies` (W248) · `ins_policy`
// (W250) · `ins_form` (W2869–W2872) · `ins_retry` (W2873–W2875) · `policies_export` (W2881–W2882) · `policies_retry` (W2883–W2885) ·
// `policy_export` (W2886–W2887) · `policy_act` (W2888–W2890).
export type Partner2Surface =
  | 'ins_dashboard' | 'ins_products' | 'ins_product' | 'ins_policies' | 'ins_policy'
  | 'ins_form' | 'ins_retry' | 'policies_export' | 'policies_retry' | 'policy_export' | 'policy_act';
export interface Partner2Refusal { id: string; canon: string; surfaces: readonly Partner2Surface[]; key: string; why: string }

const BOOK: readonly Partner2Surface[] = ['ins_dashboard', 'ins_products', 'ins_product', 'ins_policies', 'ins_policy'];

export const PARTNER2_REFUSALS: readonly Partner2Refusal[] = Object.freeze([
  // ── founder Q1 / Q2 / Q4 — money the insurer console never claims (every insurer page) ──
  { id: 'premium_yours', canon: 'W245 / W249 / W251 "premium collects at issuance" · "settles T+1 to your account" (2b\'s W251 carries the full page)', surfaces: BOOK,
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
  { id: 'parametric_watch', canon: 'W245 "Parametric weather watch … would pay 412 policies" · W247 "triggers pay … from certified weather data"', surfaces: ['ins_dashboard', 'ins_product'],
    key: 'partner2.refusal.parametricWatch', why: 'founder Q3: no index feed, no trigger evaluation, no batch payout — refused for Phase 1 (survey F-6)' },
  { id: 'camp_batch', canon: 'W245 "batch of 82 enrolments (camp) reviewed & ready to issue … issuance slots reserved"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.campBatch', why: 'no batch, no camp, no slot model; issuance is not on the platform (founder Q5)' },
  { id: 'enrolment_checks', canon: 'W245 "land records + animal registries … 72h intimation by phone … Claims pay through platform rails to verified accounts"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.enrolmentChecks', why: 'the sum insured is trusted at enrolment (insurance-policy.service.ts:58-61); no calling channel; claims credit a wallet from the platform\'s own account' },
  { id: 'claim_clocks', canon: 'W245 error state "Claims SLA clocks are server-side and safe"', surfaces: ['ins_dashboard'],
    key: 'partner2.refusal.claimClocks', why: 'no claim response clock exists' },
  { id: 'plan_settings', canon: 'W245–W250 flagged-off state "See plan settings"', surfaces: BOOK,
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
  { id: 'farmer_gauge', canon: 'W247 "Junagadh sits at 61% of normal today … Policyholders see this same gauge" · the farmer-facing payout display', surfaces: ['ins_product'],
    key: 'partner2.refusal.farmerGauge', why: 'founder Q3: no index reading, no farmer gauge, no generated payout promise' },
  { id: 'batch_payout', canon: 'W247 "If it triggers, 412 policies pay in one batch within 72h"', surfaces: ['ins_product'],
    key: 'partner2.refusal.batchPayout', why: 'founder Q3: no batch payout exists' },
  { id: 'changes_recorded', canon: 'W247 "Product changes recorded · trigger terms are immutable per policy once issued" · "platform compliance review"', surfaces: ['ins_product'],
    key: 'partner2.refusal.changesRecorded', why: 'products are not changed from the console; `parametric_triggers` was written only by the refused issue route; no review exists' },
  // ── W248 / W250 (the policies) ──
  { id: 'holder_identity', canon: 'W248 "Holder <a person> · <a masked phone>" · W250 "Cattle cover — <a person>"', surfaces: ['ins_policies', 'ins_policy'],
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
    surfaces: ['ins_form', 'ins_retry', 'policies_retry', 'policy_act'], key: 'partner2.refusal.chainZeroSum', why: 'nothing on these pages moves money' },
  { id: 'chain_on_call', canon: 'W2872 / W2875 / W2885 / W2890 "repeated failures page the on-call"',
    surfaces: ['ins_form', 'ins_retry', 'policies_retry', 'policy_act'], key: 'partner2.refusal.chainOnCall', why: 'no paging from a partner page exists' },
  { id: 'chain_audit', canon: 'W2871 / W2874 "View audit trail" · "the audit trail has the entry"',
    surfaces: ['ins_form', 'ins_retry', 'policies_retry', 'policy_act'], key: 'partner2.refusal.chainAudit', why: 'a re-read writes nothing; each read of the book is recorded as a read' },
  { id: 'report_pack', canon: 'W2869–W2872 the same form chain also serves W254 "Generate Q1 pack"', surfaces: ['ins_form'],
    key: 'partner2.refusal.reportPack', why: 'no report pack is generated on the platform (W254 is 2b\'s honest page)' },
  { id: 'export_link', canon: 'W2881 / W2882 / W2886 / W2887 "queued" · "ready — signed link, expires in 15 min"', surfaces: ['policies_export', 'policy_export'],
    key: 'partner2.refusal.exportLink', why: 'no partner export job, receipt or signed link exists (P2-B6)' },
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
]);

/** Every canon file of PARTNER-2 (50): 2a's 22 decided; 2b's 19 and 2c's 9 pending their waves. */
export type Partner2Verdict = 'BUILT' | 'BUILT (read-only)' | 'PARITY-DECOR' | 'DECOR' | 'pending_2b' | 'pending_2c';
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
  { file: 'W249-partner-issuance.html', wave: '2b', verdict: 'pending_2b', note: 'the issuance desk — PARTNER-2b (founder Q5)' },
  { file: 'W251-partner-premiums.html', wave: '2b', verdict: 'pending_2b', note: 'premiums — PARTNER-2b (founder Q1)' },
  { file: 'W254-partner-ins-reports.html', wave: '2b', verdict: 'pending_2b', note: 'reports — PARTNER-2b' },
  { file: 'W262-partner-parametric-run.html', wave: '2b', verdict: 'pending_2b', note: 'the parametric run — PARTNER-2b (founder Q3: refused)' },
  { file: 'W2896-partner-premiums-export-queued.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2897-partner-premiums-export-ready.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2898-partner-premiums-mutate-confirm.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2899-partner-premiums-mutate-success.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2900-partner-premiums-mutate-failure.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2944-partner-issuance-form-form-error.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2945-partner-issuance-form-review.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2946-partner-issuance-form-success.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2947-partner-issuance-form-failure.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2948-partner-issuance-mutate-confirm.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2949-partner-issuance-mutate-success.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2950-partner-issuance-mutate-failure.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2977-partner-parametric-mutate-confirm.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2978-partner-parametric-mutate-success.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
  { file: 'W2979-partner-parametric-mutate-failure.html', wave: '2b', verdict: 'pending_2b', note: 'PARTNER-2b' },
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
export type Chain2Id = 'ins_form' | 'ins_retry' | 'policies_export' | 'policies_retry' | 'policy_export' | 'policy_act';
export interface Chain2Def { id: Chain2Id; param: string; page: string; surface: Partner2Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[] }
export const PARTNER2_CHAINS: readonly Chain2Def[] = Object.freeze([
  { id: 'ins_form', param: 'form', page: '/insurer/products', surface: 'ins_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner2.chain.form.${s}`, files: ['W2869', 'W2870', 'W2871', 'W2872'] },
  { id: 'ins_retry', param: 'retry', page: '/insurer/dashboard', surface: 'ins_retry', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2873', 'W2874', 'W2875'] },
  { id: 'policies_export', param: 'export', page: '/insurer/policies', surface: 'policies_export', states: ['queued', 'ready'],
    key: (s: string) => `partner2.chain.booksExport.${s}`, files: ['W2881', 'W2882'] },
  { id: 'policies_retry', param: 'retry', page: '/insurer/policies', surface: 'policies_retry', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.retry.${s}`, files: ['W2883', 'W2884', 'W2885'] },
  { id: 'policy_export', param: 'export', page: '/insurer/policies/[id]', surface: 'policy_export', states: ['queued', 'ready'],
    key: (s: string) => `partner2.chain.document.${s}`, files: ['W2886', 'W2887'] },
  { id: 'policy_act', param: 'act', page: '/insurer/policies/[id]', surface: 'policy_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner2.chain.act.${s}`, files: ['W2888', 'W2889', 'W2890'] },
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
