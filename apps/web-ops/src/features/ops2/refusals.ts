// apps/web-ops/src/features/ops2/refusals.ts · PC-56 OPS-2 — WHAT THE WAREHOUSE DESK'S PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops1/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it and the surfaces that PRINT it (a sentence that
// says no — never an offer); the render tests read this map, and the claims guard (test/claims-guard.spec.ts, the `ops2.` scope) keeps the canon's
// false words out of every `ops2.` value. No canon person, depositor, booking / receipt reference, registration, place or figure appears in any value.
//
// OPS-2 is three waves (founder Q15, 2026-11-06; `05_OPS.md` "OPS-2 SPLIT"): 2c → 2b → 2a. This registry carries ALL 45 canon files; the files of
// the waves not yet built stay `pending_2b` / `pending_2a` until their wave decides them (the 4c-7 rule: the value is deleted from the type when the
// last of its files is decided).
//
// OPS-2c · THE MONEY OF STORAGE (founder Q1-A, Q2-A, Q8-A, Q9-A, Q10-A, Q14-A, 2026-11-06) builds:
//   • `billing` (W378, `/warehouse/billing`) — a READ of the warehouses the signed-in person operates (`GET /v1/warehousing/warehouses?box=mine`)
//     and their storage rate ON FILE, a server minor string through the money formatter, labelled "on file now; the rate at release is used, not
//     the rate when the goods arrived"; the founder's Q1-A sentence (who would receive the fee TODAY: the operator's own wallet) and the Q2-A rule
//     in words, never a sum. No arithmetic, no depositor, no bill, no export (Q10-A).
//   • `wh_insights` (W379, `/warehouse/insights`) — HONEST, reads nothing: there are no warehouse insights here yet, and why.
//   • `storage_export` (W3350–W3351), `storage_act` (W3352–W3354), `wh_export` (W3360–W3361) — DECOR chains (query states), Back → the trigger.
//
// OPS-2b · RECEIPTS AND QUALITY (founder Q3-A, Q4-A, Q5-A, Q7-A, Q9-A, Q10-A, Q11-A, Q13-A, Q14-A, 2026-11-06) builds:
//   • `assay_lab` (W372, `/warehouse/assay?booking=<id>`) — a READ of one booking's assays + the record act (REAL), every entry labelled with the
//     founder's Q13-A words "the warehouse's own entry — not a lab certificate, and it sets no price"; the form only for that warehouse's named
//     operator, on a stored booking; `assay_act` (W3297–W3299) is the act's own states, Back → W372.
//   • `assay_record` (W373, `/warehouse/assay/certificate?booking=&assay=`) — a READ of one entry, titled "Assay record", never "certificate";
//     `assay_export` (W3295–W3296) DECOR, Back → W373 (the trigger).
//   • `enwr_issue` (W375, `/warehouse/enwr/issue`) — HONEST, reads nothing: "This platform does not issue an eNWR. No receipt is recorded here in
//     a depositor's name."; `enwr_act` (W3315–W3317) DECOR.
//   • `enwr_registry` (W376, `/warehouse/enwr/registry`) — a READ of the organisation's receipt records (`box=all`, keyset, a GET page-size select),
//     each "recorded, not confirmed"; no holder, no value; `enwr_export` (W3313–W3314) DECOR, Back → W376 (the trigger).
//   • `enwr_receipt` (`/warehouse/enwr/[id]`) — the drill-in, a READ of one record; zero inputs; no release or cancel button.
//
// OPS-2a · INTAKE (founder Q6-A, Q9-A, Q10-A, Q11-A, Q12-A, Q14-A 2026-11-06; D1–D3 2026-11-08) builds — the last of the three, so OPS-2 is 45/45:
//   • `wh_dashboard` (W370, `/warehouse/dashboard`; `/warehouse` answers a 307 here) — a READ of the bookings at the warehouses the signed-in person
//     operates (`warehouses({ box: 'mine' })`, then each one's `bookings({ box: 'warehouse', warehouseId })`), keyset, a GET status select (the only
//     input); reference, status, commodity (the product's own name), quantity with its unit, dates — no depositor; "New booking" refused with the
//     founder's Q12-A words; no figure without a server source; a row → `/warehouse/[id]`. `wh_form` (W3362–W3365) DECOR; `wh_act` (W3366–W3368)
//     PARITY-DECOR: its "Retry" re-reads the dashboard, Back → W370.
//   • `weighbridge` (W371, `/warehouse/weighbridge`) and `stacking` (W374, `/warehouse/stacking`) — HONEST, read nothing, zero inputs; their chains
//     (W3355–W3359, W3343–W3349) DECOR.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops2Surface =
  // the ten pages (survey E5)
  | 'wh_dashboard' | 'weighbridge' | 'assay_lab' | 'assay_record' | 'stacking' | 'enwr_issue' | 'enwr_registry' | 'enwr_receipt' | 'billing' | 'wh_insights'
  // the chains
  | 'wh_form' | 'wh_act' | 'wh_export' | 'weighbridge_act' | 'weighbridge_export' | 'assay_act' | 'assay_export' | 'stacking_form' | 'stacking_act'
  | 'enwr_act' | 'enwr_export' | 'storage_act' | 'storage_export';
export interface Ops2Refusal { id: string; canon: string; surfaces: readonly Ops2Surface[]; key: string; why: string }

/** The surfaces OPS-2a builds. */
export const SURFACES_2A: readonly Ops2Surface[] = ['wh_dashboard', 'wh_form', 'wh_act', 'weighbridge', 'weighbridge_export', 'weighbridge_act', 'stacking', 'stacking_form', 'stacking_act'];
/** The pages OPS-2a builds that READ NOTHING (E7, E11). */
export const HONEST_2A: readonly Ops2Surface[] = ['weighbridge', 'stacking'];
const INTAKE_CHAINS: readonly Ops2Surface[] = ['wh_form', 'wh_act', 'weighbridge_act', 'stacking_form', 'stacking_act'];
const INTAKE_PAGES: readonly Ops2Surface[] = ['wh_dashboard', 'weighbridge', 'stacking'];

/** The surfaces OPS-2b builds. */
export const SURFACES_2B: readonly Ops2Surface[] = ['assay_lab', 'assay_record', 'assay_act', 'assay_export', 'enwr_issue', 'enwr_registry', 'enwr_receipt', 'enwr_act', 'enwr_export'];
/** The pages OPS-2b builds that READ NOTHING (E7, E11). */
export const HONEST_2B: readonly Ops2Surface[] = ['enwr_issue'];
const RECEIPT_PAGES: readonly Ops2Surface[] = ['enwr_issue', 'enwr_registry', 'enwr_receipt'];
const RECEIPT_READS: readonly Ops2Surface[] = ['enwr_registry', 'enwr_receipt'];
/** The surfaces OPS-2c builds. */
export const SURFACES_2C: readonly Ops2Surface[] = ['billing', 'wh_insights', 'storage_export', 'storage_act', 'wh_export'];
/** The pages OPS-2c builds that READ NOTHING (E7, E11) — zero inputs, no API client, no error state. */
export const HONEST_2C: readonly Ops2Surface[] = ['wh_insights'];
const BILLING_ALL: readonly Ops2Surface[] = ['billing', 'storage_export', 'storage_act'];
const STORAGE_CHAINS: readonly Ops2Surface[] = ['storage_export', 'storage_act'];
const EXPORTS_2C: readonly Ops2Surface[] = ['storage_export', 'wh_export'];
const EXPORTS_ALL: readonly Ops2Surface[] = ['storage_export', 'wh_export', 'assay_export', 'enwr_export', 'weighbridge_export'];   // NAMED WIDENING (OPS-2b): the two 2b export chains; (OPS-2a): the weighbridge's

export const OPS2_REFUSALS: readonly Ops2Refusal[] = Object.freeze([
  // ══ W378 · Storage billing (founder Q1-A, Q2-A, Q9-A, Q10-A) ══
  { id: 'billed_arithmetic', canon: 'W378 lead "Storage is rent on trust — billed with its arithmetic."', surfaces: ['billing'],
    key: 'ops2.refusal.billedArithmetic', why: 'FALSE: nothing is billed (the fee is computed once, at release, and release is refused by name); the page may do no arithmetic (E3)' },
  { id: 'export_month_to_date', canon: 'W378 "Export month-to-date" (FM:89, `chain-export` → W3350–W3351)', surfaces: ['billing', 'storage_export'],
    key: 'ops2.refusal.exportMonthToDate', why: 'GAP-BE + founder Q10-A: no export in OPS-2; nothing is billed, and no warehousing dataset is registered on the export plane' },
  { id: 'depositor_line', canon: 'W378 "Ramesh Patel — SB-2026-0871" (a depositor and her booking reference)', surfaces: ['billing'],
    key: 'ops2.refusal.depositorLine', why: 'WALL (founder Q9-A): no depositor name on any page; the page lists warehouses and rates only' },
  { id: 'lot_arithmetic', canon: 'W378 "62.60 qtl stored quantity × ₹9 rate/qtl/month = ₹563.40"', surfaces: ['billing'],
    key: 'ops2.refusal.lotArithmetic', why: 'client money math refused (E3); no server fee preview exists (OPS2-B9) and the quantity is the requested one, never weighed (F-4)' },
  { id: 'monthly_arrears', canon: 'W378 "Billed monthly in arrears at the versioned tariff on file."', surfaces: ['billing'],
    key: 'ops2.refusal.monthlyArrears', why: 'FALSE (survey C-13): the fee is computed once, at release — no monthly bill, no arrears' },
  { id: 'versioned_tariff', canon: 'W378 "the versioned tariff on file" · "Tariff ₹9/qtl/mo · versioned rate card"', surfaces: ['billing'],
    key: 'ops2.refusal.versionedTariff', why: 'FALSE: `warehouses.rate_per_qtl_month_minor` is ONE mutable column; release reads it as it stands then (founder Q2-A: the lock on the storage day is the money wave\'s)' },
  { id: 'free_promo', canon: 'W378 "First 14 days are free under the current tenant promo (feature flag)" · "Free-storage promo first 14 days · tenant policy flag · currently ON" · state "Free-storage promo is off"', surfaces: ['billing'],
    key: 'ops2.refusal.freePromo', why: 'FALSE: no promo flag exists in 0009 and no free period exists; the minimum is one whole 30-day period' },
  { id: 'month_revenue', canon: 'W378 "Month-to-date revenue ₹1,84,230.00 across 341 receipts + non-NWR lots"', surfaces: ['billing'],
    key: 'ops2.refusal.monthRevenue', why: 'GAP-BE / FALSE: no storage fee has ever been collected (release paused since OPS-1a); a sum would be invented' },
  { id: 'accrual', canon: 'W378 state "No storage charges yet — Daily storage charges for stored lots will appear here once accrual begins."', surfaces: ['billing'],
    key: 'ops2.refusal.accrual', why: 'FALSE: nothing accrues; the fee is computed once, at release' },
  { id: 'disputed_line', canon: 'W378 state "Disputed line frozen" · "Dispute resolution is finance-desk-restricted"', surfaces: ['billing'],
    key: 'ops2.refusal.disputedLine', why: 'GAP-BE: no bill line, no dispute and no finance-desk role exist (0004 roles)' },
  { id: 'billing_run', canon: 'W378 state "Billing compute failed … nothing is charged twice and nothing is silently skipped" + "Retry run" (FM:91 → W3352–W3354)', surfaces: BILLING_ALL,
    key: 'ops2.refusal.billingRun', why: 'GAP-BE: no billing run exists; "nothing is charged twice" is true only of the paused release\'s `storagefee:<booking>` key, and moot' },
  // NAMED WIDENING (OPS-2a): W370 "Search bookings… ⌘K" and W371 "Search weighbridge slips…" are the same refusal (no warehouse search route).
  { id: 'search_invoices', canon: 'W378 "Search invoices… ⌘K" · W379 "Search metrics… ⌘K" · W370 "Search bookings… ⌘K" · W371 "Search weighbridge slips…"', surfaces: ['billing', 'wh_insights', 'wh_dashboard', 'weighbridge'],
    key: 'ops2.refusal.search', why: 'DECOR: no warehouse search route; no input is built (E7)' },
  // NAMED WIDENING (OPS-2a): the same flagged-off state on W370, W371 and W374.
  { id: 'wh_plan_settings', canon: 'W378 / W379 / W370 / W371 / W374 flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: ['billing', 'wh_insights', ...INTAKE_PAGES],
    key: 'ops2.refusal.planSettings', why: 'the S1…S6 precedent: no settings page is pointed to; a switched-off module says it is switched off' },
  // ══ W379 · Warehouse insights — HONEST, reads nothing ══
  { id: 'occupancy', canon: 'W379 "Occupancy 3,812 MT of 5,000 MT — 76.2% occupied."', surfaces: ['wh_insights'],
    key: 'ops2.refusal.occupancy', why: 'GAP-BE (OPS2-B21): no weighed quantity (F-4), units not normalised before B5 (F-3), capacity operator-typed; a percentage refused (E3/E6)' },
  { id: 'intake_month', canon: 'W379 "Intake this month 214 lots"', surfaces: ['wh_insights'],
    key: 'ops2.refusal.intakeMonth', why: 'GAP-BE: no insights read-model; a count would be computed on the page' },
  { id: 'assay_turnaround', canon: 'W379 "Assay median turnaround 3.1h"', surfaces: ['wh_insights'],
    key: 'ops2.refusal.assayTurnaround', why: 'GAP-BE: no sample, no queue and no lab clock exist; an assay record carries its own date only' },
  { id: 'pledge_rate', canon: 'W379 "e-NWR pledge rate 41% of receipts"', surfaces: ['wh_insights'],
    key: 'ops2.refusal.pledgeRate', why: 'FALSE: `pledged` has no transition and `pledged_loan_id` is never set — nothing can be pledged; a percentage refused' },
  { id: 'reassay_due', canon: 'W379 "Re-assay due (30 days) 28 · View list" (→ W372)', surfaces: ['wh_insights'],
    key: 'ops2.refusal.reassayDue', why: 'GAP-BE: no query over `valid_until`; the page links the assay page (W372, built in OPS-2b), where assays are read one booking at a time' },
  { id: 'overnight_compute', canon: 'W379 states "No data yet" · "First month of data" · "Stale compute — as of last night (as-of law)"', surfaces: ['wh_insights'],
    key: 'ops2.refusal.overnightCompute', why: 'FALSE: no compute exists, overnight or otherwise' },
  { id: 'aggregate_view', canon: 'W379 "Aggregate-only view — Gate and lab staff see aggregate insights only; per-farmer drill-down is the centre manager\'s (Paresh V.), recorded."', surfaces: ['wh_insights'],
    key: 'ops2.refusal.aggregateView', why: 'FALSE + WALL: no gate, lab or centre-manager role exists, and no per-depositor view is offered (Q9-A)' },
  { id: 'insights_export', canon: 'W379 "Export (audit-stamped)" (FM:92, `chain-export` → W3360–W3361)', surfaces: ['wh_insights', 'wh_export'],
    key: 'ops2.refusal.insightsExport', why: 'GAP-BE + founder Q10-A: no warehouse dataset, no export in OPS-2' },
  { id: 'insights_retry', canon: 'W379 "Couldn\'t load warehouse insights … Retry" (FM:94, `chain-mutate` → the wh mutate chain)', surfaces: ['wh_insights'],
    key: 'ops2.refusal.insightsRetry', why: 'this page reads nothing, so it cannot fail and has nothing to retry; the wh mutate chain is OPS-2a\'s (a re-read on W370)' },
  // ══ the three DECOR chains (W3350–W3354, W3360–W3361) ══
  { id: 'storage_zero_sum', canon: 'W3353 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['storage_act'],
    key: 'ops2.refusal.storageZeroSum', why: 'FALSE on a DECOR chain, and on a BILLING page the panel\'s most dangerous chain sentence: nothing ran, no money moved, nothing balanced — refused BY NAME' },
  { id: 'storage_on_call', canon: 'W3354 "repeated failures page the on-call"', surfaces: ['storage_act'],
    key: 'ops2.refusal.storageOnCall', why: 'no paging exists for these pages' },
  { id: 'storage_audit_trail', canon: 'W3352 "confirming writes an audit-trail entry with actor, time and reason" · W3353 "View audit trail"', surfaces: ['storage_act'],
    key: 'ops2.refusal.storageAuditTrail', why: 'no act is taken, so nothing is recorded; no ops audit surface exists' },
  { id: 'export_receipt', canon: 'W3350 / W3360 / W3355 "audit-stamped, checksummed, delivered by signed URL" · W3351 / W3361 / W3356 "Audit-stamped receipt: file name, row count, sha256 … 15-min signed URL, every fetch logged"', surfaces: EXPORTS_ALL,
    key: 'ops2.refusal.exportReceipt', why: 'TRUE of CORE\'s export plane in mechanism, but no warehousing dataset is registered (OPS2-B20) — refused on these pages' },
  { id: 'export_queue', canon: 'W3350 / W3360 / W3295 / W3313 / W3355 "this job is queued with a position and ETA"', surfaces: EXPORTS_ALL,
    key: 'ops2.refusal.exportQueue', why: 'no job is created' },

  // ══ OPS-2b · W372 Assay lab (founder Q13-A, Q11-A) ══
  { id: 'sample_object', canon: 'W372 heading "Assay lab — sample [ref]" · state "Sample queue empty — Samples queue here the moment a weighbridge slip is closed"', surfaces: ['assay_lab'],
    key: 'ops2.refusal.sampleObject', why: 'FALSE: no sample object or queue exists; an assay belongs to a booking, and no weighbridge record exists (F-4)' },
  { id: 'accredited_lab', canon: 'W372 "[lab] Labs (accredited — per certificate face)" · W373 "Issuing lab [lab] (accredited …)"', surfaces: ['assay_lab', 'assay_record'],
    key: 'ops2.refusal.accreditedLab', why: 'FALSE, LEGAL: `assayer_name` is free text; no lab registry, no accreditation (survey C-10, F-7)' },
  { id: 'price_birth', canon: 'W372 "the assay is the price\'s birth certificate"', surfaces: ['assay_lab', 'assay_record'],
    key: 'ops2.refusal.priceBirth', why: 'FALSE (MONEY): no price, valuation or fee reads `assay_reports` (C-10); founder Q13-A: "it sets no price"' },
  { id: 'percent_added', canon: 'W372 "Moisture [n]% · Foreign matter [n]% · Damaged [n]% · Oil content [n]%"', surfaces: ['assay_lab', 'assay_record'],
    key: 'ops2.refusal.percentAdded', why: 'E3/E6: `parameters` holds name and value as entered; the "%" is the canon\'s, never added' },
  { id: 'validity_rule', canon: 'W372 "valid for 90 days … a fresh sample is required after …" · W373 "90-day re-assay rule" · W372 state "Re-assay due (90-day) — … required to keep issuing or pledging against it"', surfaces: ['assay_lab', 'assay_record'],
    key: 'ops2.refusal.validityRule', why: 'FALSE: `valid_until` is optional, typed, and checked by nothing; nothing is issued or pledged against an assay' },
  { id: 'analyzer', canon: 'W372 state "Analyzer under maintenance" + "View maintenance log" (FM:67) · "Couldn\'t reach the analyzer … Retry" (FM:66)', surfaces: ['assay_lab'],
    key: 'ops2.refusal.analyzer', why: 'FALSE: no analyzer; FM:66 "Retry" becomes the record act\'s own states (E4, REAL chain W3297–W3299)' },
  { id: 'technician_only', canon: 'W372 state "Certificate issuance is technician-only — … only the certified lab technician can issue or sign a certificate"', surfaces: ['assay_lab'],
    key: 'ops2.refusal.technicianOnly', why: 'FALSE: no technician role (0004); the warehouse\'s named operator records the entry (Q11-A, strict on this act)' },
  // ══ W373 Assay record (never "certificate") ══
  { id: 'certificate_title', canon: 'W373 heading "Assay certificate — [ref]"; "Document-of-record … a certificate that can\'t be verified is a rumour with a border."', surfaces: ['assay_record'],
    key: 'ops2.refusal.certificateTitle', why: 'FALSE, LEGAL: no certificate number, issuer or verification exists — the page is titled "Assay record" (Q13-A)' },
  { id: 'certificate_number', canon: 'W373 "Certificate no. [ref]"', surfaces: ['assay_record'],
    key: 'ops2.refusal.certificateNumber', why: 'FALSE: no certificate number exists' },
  { id: 'verify_code', canon: 'W373 "verified · QR · verify at [platform]/c/[ref]"', surfaces: ['assay_record'],
    key: 'ops2.refusal.verifyCode', why: 'FALSE, LEGAL: no verification route, no QR, no public page (pinned live: GET /c/:certNo → 404)' },
  { id: 'depositor_kyc', canon: 'W373 "Depositor [name] · [FPO] KYC verified"', surfaces: ['assay_record', 'assay_lab'],
    key: 'ops2.refusal.depositorKyc', why: 'WALL (founder Q9-A): no depositor name and no identity check at a warehouse desk' },
  { id: 'expiry_revoke', canon: 'W373 states "Certificate expired — re-assay required …" · "Pending verification … against [lab]\'s issued-certificates register" · "Revoked, with reason" · "Revocation is lab-authority-only"', surfaces: ['assay_record'],
    key: 'ops2.refusal.expiryRevoke', why: 'FALSE: no expiry rule, no register, no revoke route' },
  { id: 'download_pdf', canon: 'W373 "Download PDF" (FM:68 → W3295–W3296)', surfaces: ['assay_record', 'assay_export'],
    key: 'ops2.refusal.downloadPdf', why: 'GAP-BE + Q10-A: no PDF producer; `report_media_id` has no writer from the console (pinned live: …/certificate.pdf → 404)' },
  { id: 'issuer_retry', canon: 'W373 state "Couldn\'t confirm with the issuer … Retry" (FM:70)', surfaces: ['assay_record'],
    key: 'ops2.refusal.issuerRetry', why: 'FALSE: no issuer is called; the assay act chain lives on W372' },
  // ══ the assay act chain (W3297–W3299, REAL) ══
  { id: 'assay_zero_sum', canon: 'W3298 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['assay_act'],
    key: 'ops2.refusal.assayZeroSum', why: 'FALSE: recording an assay moves no money — refused BY NAME' },
  { id: 'assay_on_call', canon: 'W3299 "repeated failures page the on-call"', surfaces: ['assay_act'],
    key: 'ops2.refusal.assayOnCall', why: 'no paging exists for these pages' },
  { id: 'assay_audit_view', canon: 'W3298 "View audit trail"', surfaces: ['assay_act'],
    key: 'ops2.refusal.assayAuditView', why: 'TRUE that the act writes one audit row (B4); no ops audit surface exists to view it' },
  // ══ W375 eNWR issue — HONEST (founder Q3-A, Q4-A, Q9-A) ══
  { id: 'issue_act', canon: 'the built "Issue eNWR receipt" form on `/warehouse/[id]` (survey C-5, F-2) · "eNWR receipt issued."', surfaces: ['enwr_issue'],
    key: 'ops2.refusal.issueAct', why: 'founder Q3-A: the form is removed; the API refuses issue BY NAME (ENWR_ISSUE_NOT_ON_PLATFORM)' },
  { id: 'send_otp', canon: 'W375 "Send OTP to farmer" (FM:77 → W3315–W3317) · state "Consent pending (OTP) …"', surfaces: ['enwr_issue', 'enwr_act'],
    key: 'ops2.refusal.sendOtp', why: 'GAP-BE (OPS2-B25): no depositor code primitive exists (pinned live: …/nwr/:id/otp → 404)' },
  { id: 'prepared_steps', canon: 'W375 state "No status updates yet — Steps … prepared, OTP sent, signed …" · "The platform prepares the receipt; NERL issues it"', surfaces: ['enwr_issue'],
    key: 'ops2.refusal.preparedSteps', why: 'FALSE of the code: nothing is prepared, sent or signed; the platform records a number at most' },
  { id: 'holder_name', canon: 'W375 table Holder "[name] · [FPO]" · W376 column "Holder"', surfaces: RECEIPT_PAGES,
    key: 'ops2.refusal.holderName', why: 'WALL (founder Q9-A): the API body carries `holderUserId`; no page prints it or any name' },
  { id: 'receipt_value', canon: 'W375 "[n] qtl × ₹[n]/qtl = ₹[n]" (the valuation) · W376 "sanction … vs valuation …"', surfaces: RECEIPT_PAGES,
    key: 'ops2.refusal.receiptValue', why: 'founder Q4-A: no valuation anywhere on the ops console; the API body carries `valuationMinor` and the SDK type omits it' },
  { id: 'grade_link', canon: 'W375 "Grade A · certificate [ref]" (as linked to the receipt)', surfaces: ['enwr_issue', 'enwr_receipt'],
    key: 'ops2.refusal.gradeLink', why: 'FALSE: issue never read an assay; no receipt is linked to one' },
  { id: 'market_reference', canon: 'W375 "Haircut note — … the assay-grade market reference … Any lender applies its own margin … (see KCC/loan pledge flow)"', surfaces: ['enwr_issue'],
    key: 'ops2.refusal.marketReference', why: 'FALSE, LEGAL: no market reference and no pledge flow (C-11; founder Q7-A refuses `nwrId` on a loan application)' },
  { id: 'repository_link', canon: 'W375 state "Repository down — queued, not issued … a receipt is never marked issued until NERL confirms it." + "Retry connection" (FM:76)', surfaces: ['enwr_issue', 'enwr_act'],
    key: 'ops2.refusal.repositoryLink', why: 'FALSE: no repository is called anywhere (README deferral); nothing is queued' },
  { id: 'value_stale', canon: 'W375 state "Valuation stale — assay over 90 days … Issue is blocked"', surfaces: ['enwr_issue'],
    key: 'ops2.refusal.valueStale', why: 'FALSE: nothing is valued or issued here' },
  { id: 'manager_restricted', canon: 'W375 state "Issuing the e-NWR is manager-restricted — … only the warehouse manager can trigger issuance once the depositor\'s OTP is confirmed."', surfaces: ['enwr_issue'],
    key: 'ops2.refusal.managerRestricted', why: 'FALSE: no manager role; issue is refused for everyone' },
  { id: 'repository_confirmed', canon: 'W376 "once NERL confirms issue" · "Pledges and releases already confirmed with NERL" · W375 "Prepared receipt … \'prepared\' is not yet \'issued\'"', surfaces: RECEIPT_PAGES,
    key: 'ops2.refusal.repositoryConfirmed', why: 'FALSE: no record here was confirmed with any repository — each is labelled "recorded, not confirmed" (founder Q3-A)' },
  // ══ W376 eNWR registry + the drill-in (founder Q4-A, Q5-A, Q9-A, Q10-A) ══
  { id: 'pledged_loan', canon: 'W376 row "[ref] · pledged · [bank] loan · sanction ₹[n] vs valuation ₹[n] — LTV [n]%" (FM:82)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.pledgedLoan', why: 'FALSE: `pledged` has no transition and `pledged_loan_id` is never set; a ratio refused (E3)' },
  { id: 'partly_released', canon: 'W376 row "[ref] · partially_released · [n] qtl released, [n] qtl remain" (FM:81)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.partlyReleased', why: 'FALSE: unreachable state; page subtraction refused (pinned live: …/partial-release → 404)' },
  { id: 'goods_withdrawn', canon: 'W376 row "[ref] · released · fully withdrawn [date]" (FM:80)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.goodsWithdrawn', why: 'C-7: a receipt\'s status was never tied to its goods; and standalone release is now refused (founder Q5-A)' },
  { id: 'default_auction', canon: 'W376 row "[ref] · defaulted · lender-initiated auction path opened — quiet review, not public listing" (FM:79)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.defaultAuction', why: 'FALSE, LEGAL: unreachable state; no auction exists' },
  { id: 'register_total', canon: 'W376 "Showing 5 of 341 receipts · Page size · Page 1 of 14" (FM:85)', surfaces: ['enwr_registry'],
    key: 'ops2.refusal.registerTotal', why: 'E3: no total exists in the API answer; the register is keyset-paged (the GET page-size select is REAL)' },
  { id: 'repository_feed', canon: 'W376 state "Registry feed degraded — Showing the register as of the last successful NERL sync …" + "Retry" (FM:84 → W3315–W3317)', surfaces: ['enwr_registry'],
    key: 'ops2.refusal.repositoryFeed', why: 'FALSE: no sync exists; "Retry" is a plain re-read of this page' },
  { id: 'lender_scope', canon: 'W376 state "Lender scope — pledged-only — A lender partner sees only the receipts pledged to them, never the full registry"', surfaces: ['enwr_registry'],
    key: 'ops2.refusal.lenderScope', why: 'FALSE as stated; the truth is stricter: no lender reads any receipt (0225:318)' },
  { id: 'export_register', canon: 'W376 "Export register" (FM:78 → W3313–W3314)', surfaces: ['enwr_registry', 'enwr_export'],
    key: 'ops2.refusal.exportRegister', why: 'GAP-BE + founder Q10-A: no export in OPS-2; no warehousing dataset is registered' },
  { id: 'receipt_acts', canon: 'W376 five row kebabs "Actions for receipt …" (release / cancel)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.receiptActs', why: 'founder Q5-A: release refused BY NAME at the API; cancel is the named operator\'s keyed, audited API act and no console button calls it in OPS-2b (deviation)' },
  { id: 'holding_transfer', canon: 'survey §1G "transfer of holding" (no route changes `holder_user_id`)', surfaces: RECEIPT_READS,
    key: 'ops2.refusal.holdingTransfer', why: 'GAP-BE: no transfer route (pinned live: …/transfer → 404)' },
  // ══ the enwr act chain (W3315–W3317, DECOR) ══
  { id: 'enwr_zero_sum', canon: 'W3316 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['enwr_act'],
    key: 'ops2.refusal.enwrZeroSum', why: 'FALSE on a DECOR chain over a document of title: nothing was sent or recorded — refused BY NAME' },
  { id: 'enwr_on_call', canon: 'W3317 "repeated failures page the on-call"', surfaces: ['enwr_act'],
    key: 'ops2.refusal.enwrOnCall', why: 'no paging exists for these pages' },
  { id: 'enwr_audit_trail', canon: 'W3315 "confirming writes an audit-trail entry with actor, time and reason" · W3316 "View audit trail"', surfaces: ['enwr_act'],
    key: 'ops2.refusal.enwrAuditTrail', why: 'no act is taken, so nothing is recorded; no ops audit surface exists' },
  // ══ OPS-2a · W370 Warehouse dashboard (founder Q9-A, Q11-A, Q12-A, Q14-A) ══
  { id: 'new_booking', canon: 'W370 "New booking" (FM:57, `chain-form:wh` → W3362–W3365)', surfaces: ['wh_dashboard', 'wh_form'],
    key: 'ops2.refusal.newBooking', why: 'founder Q12-A: a booking is the depositor\'s own request (`warehouse.store`, depositor = the caller, storage-booking.service.ts request); no desk books in her name, and no app lets her book (survey F-10)' },
  { id: 'farmer_column', canon: 'W370 table "Farmer" — "[name] · [FPO] #[member]" · KPI "… [name], [commodity]"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.farmerColumn', why: 'WALL (founder Q9-A): the API body carries `depositorUserId`; the SDK type omits it and no page prints it or any name' },
  { id: 'booking_today', canon: 'W370 KPI "Booking today [ref] stored [time] today"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.bookingToday', why: 'GAP-BE: no "today" filter exists (query-storage-booking.dto.ts: status / warehouse / cursor only); the rows are the newest first' },
  { id: 'net_received', canon: 'W370 KPI "Net received today [n] qtl · weighbridge slip [ref] · [n] kg net"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.netReceived', why: 'GAP-BE / FALSE: no weighment and no slip (F-4); a sum over rows is client arithmetic (E3)' },
  { id: 'enwr_pending', canon: 'W370 KPI "e-NWR pending issue [n] · assay complete, grade A — ready to prepare for NERL"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.enwrPending', why: 'FALSE: no count route; issue is refused by name (OPS-2b, Q3-A); an assay sets nothing; no repository' },
  { id: 'weighed_stacked', canon: 'W370 lead "a warehouse is a promise with a roof: what is booked, weighed, assayed and stacked, as of now."', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.weighedStacked', why: 'FALSE: nothing is weighed or stacked on this platform (no object, F-4, §1E); the page names what it shows' },
  { id: 'weighed_in', canon: 'W370 state "No intake today — … Bookings appear the moment a farmer\'s lot is weighed in"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.weighedIn', why: '"weighed in" FALSE (no weighment); the empty state says only that there are no bookings' },
  { id: 'as_of_summary', canon: 'W370 state "Dashboard figures as of [time] — This summary lags … (as-of law)" + "Retry" (FM:59)', surfaces: ['wh_dashboard', 'wh_act'],
    key: 'ops2.refusal.asOfSummary', why: 'FALSE: no summary or read-model — the page reads live rows; "Retry" is a plain re-read (PARITY-DECOR W3366–W3368)' },
  { id: 'gate_manager', canon: 'W370 states "Gate staff vs manager — … releasing stock, revising the rate card and viewing storage revenue are the centre manager\'s ([name]), recorded." · "Releasing stock is manager-restricted"', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.gateManager', why: 'FALSE: no gate or manager role (0004); release is paused for everyone (OPS-1a); the rate is the named operator\'s alone (D1)' },
  { id: 'page_total', canon: 'W370 "Showing 1 of 1 booking today · Page 1 of 1" (FM:60)', surfaces: ['wh_dashboard'],
    key: 'ops2.refusal.pageTotal', why: 'E3: no total exists in the API answer; keyset paging (a next link) is REAL' },
  // ══ W3362–W3368 (the wh form and act chains) ══
  { id: 'maker_checker', canon: 'W3363 / W3344 "Maker-checker friendly review step … diff against current values"', surfaces: ['wh_form', 'stacking_form'],
    key: 'ops2.refusal.makerChecker', why: 'FALSE: no maker-checker exists on any warehouse act' },
  { id: 'intake_zero_sum', canon: 'W3364 / W3367 / W3358 / W3345 / W3348 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: INTAKE_CHAINS,
    key: 'ops2.refusal.intakeZeroSum', why: 'FALSE on these chains — on the weighbridge\'s, the weight that would set a fee — nothing ran and no money moved: refused BY NAME' },
  { id: 'intake_on_call', canon: 'W3365 / W3368 / W3359 / W3346 / W3349 "repeated failures page the on-call"', surfaces: INTAKE_CHAINS,
    key: 'ops2.refusal.intakeOnCall', why: 'no paging exists for these pages' },
  { id: 'intake_audit_trail', canon: 'W3366 / W3357 / W3347 "confirming writes an audit-trail entry with actor, time and reason" · "View audit trail"', surfaces: INTAKE_CHAINS,
    key: 'ops2.refusal.intakeAuditTrail', why: 'no act is taken on these chains, so nothing is recorded; no ops audit surface exists (confirm / store / cancel ARE audited on the booking page, B4)' },
  // ══ W371 Weighbridge — HONEST (founder Q6-A) ══
  { id: 'weighbridge_slip', canon: 'W371 heading "Weighbridge — [vehicle]"; "Slip [ref] · booking [ref] · [name] …"', surfaces: ['weighbridge'],
    key: 'ops2.refusal.weighbridgeSlip', why: 'FALSE: no vehicle, no slip, no weighbridge object (0151; 0196 "Weighbridge slips: not recorded on this platform")' },
  { id: 'print_slip', canon: 'W371 "Print slip" (FM:63, `chain-export` → W3355–W3356)', surfaces: ['weighbridge', 'weighbridge_export'],
    key: 'ops2.refusal.printSlip', why: 'GAP-BE + Q10-A: no slip and no export producer' },
  { id: 'gross_tare_net', canon: 'W371 "Gross − tare = net: [n] kg gross · [time] − [n] kg tare · [time] = [n] kg"', surfaces: ['weighbridge'],
    key: 'ops2.refusal.grossTareNet', why: 'GAP-BE (MONEY, founder Q6-A — the money wave): no reading is recorded; a subtraction on the page is refused regardless (E3)' },
  { id: 'net_carries', canon: 'W371 "Net = [n] qtl — the quantity that carries forward to assay, stacking and the e-NWR, unchanged."', surfaces: ['weighbridge'],
    key: 'ops2.refusal.netCarries', why: 'FALSE as stated: what carries forward unchanged is the REQUESTED quantity (nwr-receipt.service.ts, storage-booking.entity.ts) — the page says so' },
  { id: 'calibration', canon: 'W371 "Calibration — Stamping cert ref [ref], valid to [date]. Legal Metrology framing: calibration is the law\'s, the record is ours."', surfaces: ['weighbridge'],
    key: 'ops2.refusal.calibration', why: 'FALSE, LEGAL: no calibration record; Legal Metrology is for a lawyer to read (Q6)' },
  { id: 'dual_confirm', canon: 'W371 state "Bridge offline — … enter both readings with a second staff member\'s dual-confirm" + "Enter manual reading" (FM:61)', surfaces: ['weighbridge'],
    key: 'ops2.refusal.dualConfirm', why: 'FALSE: no reading and no second-person rule exist; FM calls a `data-decor` button `nav-detail` (DELTA)' },
  { id: 'vehicle_mismatch', canon: 'W371 state "Vehicle mismatch — blocked …"', surfaces: ['weighbridge'],
    key: 'ops2.refusal.vehicleMismatch', why: 'FALSE: no vehicle is recorded' },
  { id: 'supervisor_reprint', canon: 'W371 state "Reprint needs supervisor — … only the centre manager ([name]) … every reprint is logged" · "Reprint is supervisor-restricted"', surfaces: ['weighbridge'],
    key: 'ops2.refusal.supervisorReprint', why: 'FALSE: no slip, no reprint, no supervisor role' },
  { id: 'indicator_retry', canon: 'W371 state "Couldn\'t reach the digital indicator … Retry" (FM:64 → W3357–W3359)', surfaces: ['weighbridge', 'weighbridge_act'],
    key: 'ops2.refusal.indicatorRetry', why: 'FALSE: no device integration; the page reads nothing, so it cannot fail' },
  // ══ W374 Stacking — HONEST ══
  { id: 'bay_stack', canon: 'W374 heading "Stacking — bay [ref], stack [n]"; "location is part of the receipt" · "Location Bay [ref] · stack [n]"', surfaces: ['stacking'],
    key: 'ops2.refusal.bayStack', why: 'FALSE: no location column on any table; a receipt has none (0010:174-187)' },
  { id: 'bag_arithmetic', canon: 'W374 "[n] bags × [n] kg = [n] kg + 1 bag × [n] kg = [n] kg total — … the sum matches the weighbridge net exactly."', surfaces: ['stacking'],
    key: 'ops2.refusal.bagArithmetic', why: 'FALSE; page arithmetic refused (E3); no weighbridge (1B)' },
  { id: 'pest_log', canon: 'W374 "Log pest-control check" ×2 (FM:71-72 → W3343–W3346) · "Pest control View bay log" (#pest-log) · state "No pest-control checks logged yet"', surfaces: ['stacking', 'stacking_form'],
    key: 'ops2.refusal.pestLog', why: 'GAP-BE (OPS2-B18): no pest-control object; FM duplicates the row (the button is drawn twice)' },
  { id: 'ambient', canon: 'W374 "Ambient moisture-safe last check [time]"', surfaces: ['stacking'],
    key: 'ops2.refusal.ambient', why: 'FALSE: no ambient reading is recorded' },
  { id: 'quarantine', canon: 'W374 state "Pest alert — bay quarantined"', surfaces: ['stacking'],
    key: 'ops2.refusal.quarantine', why: 'FALSE: no quarantine state exists' },
  { id: 'bay_suggestion', canon: 'W374 state "Bay full — alternative suggested … The system suggests bay [ref]"', surfaces: ['stacking'],
    key: 'ops2.refusal.baySuggestion', why: 'FALSE: no bay and no suggestion engine' },
  { id: 'audit_hold', canon: 'W374 states "Audit count variance … Movement out is held until a supervisor reconciles" · "Movement release is supervisor-restricted"', surfaces: ['stacking'],
    key: 'ops2.refusal.auditHold', why: 'FALSE: no count, no hold, no supervisor role; release is paused for everyone (OPS-1a)' },
  { id: 'bay_retry', canon: 'W374 state "Couldn\'t confirm the bay assignment … Retry" (FM:74 → W3347–W3349)', surfaces: ['stacking', 'stacking_act'],
    key: 'ops2.refusal.bayRetry', why: 'FALSE: no bay assignment exists; the page reads nothing, so it cannot fail' },
]);
export function ops2RefusalKeys(surface: Ops2Surface): string[] { return OPS2_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS2_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_billing', canon: 'W378 canon route `warehouse/billing`', built: '`/warehouse/billing` at the canon address, a WAREHOUSE sidebar item under Warehouse (survey E2: built routes only)' },
  { id: 'route_insights', canon: 'W379 canon route `warehouse/insights`', built: '`/warehouse/insights` at the canon address, a WAREHOUSE sidebar item under Warehouse; distinct from the console\'s `/insights` (OW-6)' },
  { id: 'f9_box_mine', canon: 'survey F-9 / C-3: the SDK sends no `box`, so `GET …/warehouses` answers the API default `browse` (the tenant\'s warehouses + platform-global ones), never "the ones I operate"',
    built: 'MINIMAL SDK FIX (a recorded deviation; OPS2-B7 stays OPS-2a\'s): `warehousing.warehouses()` gains `box` and the `Warehouse` type gains `ratePerQtlMonthMinor`, `operatorUserId`, `wdraRegNo`, `capacityMt`; W378 reads `box=mine` (the API\'s `operator_user_id = caller`). The bookings / receipts `box` (C-3) is untouched here' },
  { id: 'wh_export_back', canon: 'W3360 / W3361 "Back" → W370 (the donor), though the trigger is W379 "Export (audit-stamped)" (survey §1J, F-17)',
    built: 'Back returns to the TRIGGERING page, `/warehouse/insights` — never `/warehouse/dashboard`, which is not built yet' },
  { id: 'storage_chain_back', canon: 'W3350–W3354 Back / "Back to the screen" → W378; W3354 "Retry — back to confirm" → W3352', built: 'Back → `/warehouse/billing`; the failure state\'s retry is not offered (there is no run to retry)' },
  { id: 'fm_chain_ids_2', canon: 'FM :89-94 name W1793–W1831-range chain targets (survey C-15)', built: 'those files do not exist; the real chains are W3350–W3354 (storage) and W3360–W3361 (wh export)' },
  { id: 'fm_filter_spans_2', canon: 'FM :90, :93 "PV" as `filter`', built: 'avatar `<span>`s, not filters — not built (DECOR, DELTA)' },
  { id: 'w379_assay_link', canon: 'W379 "View list" → W372 (FM omits it)', built: 'OPS-2c: a SENTENCE only (W372 not built). NAMED UPDATE (OPS-2b): W372 is built, so the sentence carries a REAL link to `/warehouse/assay`' },
  { id: 'w378_payee_today', canon: 'W378 (missing from canon, true and binding — survey §1H) who receives the fee',
    built: 'the founder\'s Q1-A sentence: today the fee would go from the depositor\'s wallet into the warehouse operator\'s OWN wallet (`storage-booking.service.ts` release legs; by default the administrator who listed it); release is paused' },
  // ── OPS-2b ──
  { id: 'route_assay', canon: 'W372 canon route `warehouse/assay` (a sample page)', built: '`/warehouse/assay?booking=<id>` — an assay belongs to a booking; the booking travels in the URL as an id only (a UUID, else dropped); the record act moved here from `/warehouse/[id]`' },
  { id: 'route_assay_record', canon: 'W373 canon route `warehouse/assay/certificate`', built: 'the canon address, titled "Assay record"; one entry picked from the booking\'s list (`?booking=&assay=`) — no read-by-id exists' },
  { id: 'route_enwr', canon: 'W375 `warehouse/enwr/issue`, W376 `warehouse/enwr/registry`, FM:22 drill-in', built: 'the canon addresses + `/warehouse/enwr/[id]` over the existing `GET …/nwr/:id` (the register\'s rows link it)' },
  { id: 'assay_export_back', canon: 'W3295 / W3296 Back → W372 (the donor), though the trigger is W373 "Download PDF" (survey §1L)', built: 'Back returns to the TRIGGERING page, W373 (`/warehouse/assay/certificate?booking=&assay=`)' },
  { id: 'enwr_export_back', canon: 'W3313 / W3314 Back → W375 (the donor), though the trigger is W376 "Export register" (survey §1N)', built: 'Back returns to the TRIGGERING page, W376 (`/warehouse/enwr/registry`)' },
  { id: 'w372_retry', canon: 'FM:66 W372 "Retry" (`chain-mutate` → W3297–W3299)', built: 'the record act\'s own confirm / success / failure states (`?booking=&act=`), REAL (E4); failure names the server\'s reason' },
  { id: 'enwr_cancel_not_offered', canon: 'survey §1G / brief §E: cancel by the operator (founder Q5-A)', built: 'DEVIATION (brief): the API act exists, hardened (named operator, key, reason, one audit row); NO console button calls it in OPS-2b' },
  { id: 'receipt_quantity_unit', canon: 'brief §E "quantity (quintals)"; survey F-11 (the receipt has no unit column)', built: 'PREMISE NOT PROVEN for every record: a receipt copies the booking\'s number with no unit, and bookings in other units were accepted before OPS-2c B5 — the register prints the quantity as recorded, labelled "the receipt stores no unit"; the drill-in prints its booking\'s unit from the booking\'s own read' },
  { id: 'issue_form_removed', canon: 'the built `/warehouse/[id]` "Issue eNWR receipt" form + assay form (PC-32 OW-2)', built: 'the issue form is removed (founder Q3-A); the assay table and form moved to W372 (a link from the booking); `/warehouse` prints no valuation column (founder Q4-A, "anywhere")' },
  { id: 'fm_filter_cells_2b', canon: 'FM :79-82 four receipt numbers as `filter`', built: 'table cells — each row\'s number links the receipt\'s own read (the drill-in)' },
  // ── OPS-2a ──
  { id: 'route_dashboard', canon: 'W370 canon route `warehouse/dashboard`; the built `/warehouse` (PC-32 OW-2)', built: '`/warehouse/dashboard` at the canon address; `/warehouse` answers a REAL 307 there (next.config.js, OPS2A_REDIRECTS); `/warehouse/[id]` stays the drill-in' },
  { id: 'route_weighbridge_stacking', canon: 'W371 `warehouse/weighbridge`, W374 `warehouse/stacking` (W374 an orphan: inbound only from its own chains)', built: 'the canon addresses, HONEST; the dashboard links both — the inbound edges the canon never drew (E2); Stacking joins the sidebar under Intake' },
  { id: 'c3_box_warehouse', canon: 'survey C-3 / F-9: the old `/warehouse` sent no `box`, so the API answered `depositor` — the operator\'s OWN deposits — and its hint said "across your warehouses"',
    built: 'the SDK `bookings()` gains `box` and `warehouseId` (OPS2-B7); W370 reads `warehouses({ box: \'mine\' })` then `bookings({ box: \'warehouse\', warehouseId })` per warehouse (wh-dashboard.render pins it: a fixture where a dropped `box` shows the operator\'s own deposit)' },
  { id: 'commodity_name', canon: 'W370 "Commodity" ([commodity name])', built: 'the product\'s own `defaultName` from the existing `GET /v1/products/:id` (the SDK gains `catalogue.product(id)`); a product that cannot be read prints "not available" — never its id' },
  { id: 'dashboard_per_warehouse', canon: 'W370 one table for "the warehouse" (the canon draws one)', built: 'one section per warehouse the person operates (up to 100), each keyset-paged on its own (`?warehouse=<id>&cursor=`); the status filter applies to all' },
  { id: 'wh_act_reread', canon: 'W3366–W3368 confirm / success / failure (FM:59 "Retry")', built: 'PARITY-DECOR: the dashboard\'s error state offers "Retry", whose confirm state links a plain re-read of `/warehouse/dashboard`; Back → W370' },
  { id: 'wh_form_back', canon: 'W3365 "Retry — back to confirm" → W370 (survey §1J defect)', built: 'no retry is offered (nothing was attempted); Back → W370' },
  { id: 'fm_chain_ids_2a', canon: 'FM :57-74 name W1793–W1831-range chain targets (survey C-15)', built: 'those files do not exist; the real chains are W3362–W3368 (wh), W3355–W3359 (weighbridge), W3343–W3349 (stacking)' },
  { id: 'fm_filter_spans_2a', canon: 'FM :58, :62, :73 "PV" as `filter`; FM:61 "Enter manual reading" as `nav-detail` (a `data-decor` button)', built: 'not built (DECOR, DELTA)' },
  { id: 'drill_in_operator', canon: 'survey §1A: the drill-in\'s confirm / store / cancel', built: 'offered only when the booking\'s warehouse is one the signed-in person operates (`warehouses({ box: \'mine\' })`, the 2b approach); the operator\'s cancel has a REQUIRED reason; the bare "←" is removed (E9)' },
]);

/** The verdict values. `pending_2b` / `pending_2a` are deleted from the type by the wave that decides the last of their files. */
// NAMED UPDATE (PC-56 OPS-2b): `pending_2b` is deleted from the type — 2b decides the last of its files (the 4c-7 rule).
// NAMED UPDATE (PC-56 OPS-2a): `pending_2a` is deleted too — 2a decides the last 22; OPS-2 is 45 decided / 0 pending.
export type Ops2Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR';
export type Ops2Wave = '2a' | '2b' | '2c';
/** Every canon file of OPS-2 (45), each with ONE verdict: 2c decides its 9, 2b its 14, 2a its 22. */
export const OPS2_CANON_FILES: readonly { file: string; wave: Ops2Wave; module: string; verdict: Ops2Verdict; note: string }[] = Object.freeze([
  // ── 2c · THE MONEY OF STORAGE (9) — decided (founder Q1-A, Q2-A, Q8-A, Q9-A, Q10-A, Q14-A) ──
  { file: 'W378-ops-storage-billing.html', wave: '2c', module: 'warehouse', verdict: 'BUILT (read)', note: '/warehouse/billing — a READ of the warehouses the signed-in person operates (GET /v1/warehousing/warehouses?box=mine) and each one\'s rate on file (a server minor string, formatMoneyMinor), labelled "on file now; the rate at release is used, not the rate when the goods arrived"; the warehouse\'s own name; a WDRA number "as entered, not checked with WDRA"; Q1-A: "Today, if release were switched on, the fee would be paid from the depositor\'s wallet into the warehouse operator\'s own wallet. …"; the Q2-A rule in words; no arithmetic, no depositor, no input' },
  { file: 'W379-ops-wh-insights.html', wave: '2c', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/insights — HONEST, reads nothing: no warehouse insights here yet — no quantity is weighed and quantities were not always in one unit; occupancy, %, intake, turnaround, pledge rate and re-assay counts refused by name; the assay page named in a sentence (not built — no link)' },
  { file: 'W3350-ops-storage-export-queued.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/billing?export=queued — "Export month-to-date" refused (Q10-A): nothing queued' },
  { file: 'W3351-ops-storage-export-ready.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused' },
  { file: 'W3352-ops-storage-mutate-confirm.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/billing?act=confirm — "Retry run" refused: no billing run exists, nothing to confirm' },
  { file: 'W3353-ops-storage-mutate-success.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing ran, no money moved; the "reconcile zero-sum" sentence refused BY NAME (`storage_zero_sum`)' },
  { file: 'W3354-ops-storage-mutate-failure.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted; nobody is paged; Back → /warehouse/billing' },
  { file: 'W3360-ops-wh-export-queued.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/insights?export=queued — "Export (audit-stamped)" refused (Q10-A); Back → W379, the trigger (the canon\'s Back → W370 is a defect, DELTA `wh_export_back`)' },
  { file: 'W3361-ops-wh-export-ready.html', wave: '2c', module: 'warehouse', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused' },
  // ── 2b · RECEIPTS AND QUALITY (14) — decided (founder Q3-A, Q4-A, Q5-A, Q7-A, Q9-A, Q10-A, Q11-A, Q13-A) ──
  { file: 'W372-ops-assay-lab.html', wave: '2b', module: 'warehouse', verdict: 'REAL', note: 'BUILT (read) + REAL: /warehouse/assay?booking=<id> — a READ of one booking\'s assays (GET …/storage-bookings/:id/assays), each labelled "the warehouse\'s own entry — not a lab certificate, and it sets no price" (Q13-A), parameters "name = value" as entered; the record form (POST …/:id/assays, audited) only for that warehouse\'s named operator, on a stored booking' },
  { file: 'W373-ops-assay-certificate.html', wave: '2b', module: 'warehouse', verdict: 'BUILT (read)', note: '/warehouse/assay/certificate?booking=&assay= — a READ of one recorded entry from the booking\'s list, titled "Assay record", never "certificate"; the Q13-A label first; no number, lab, QR, PDF, verification or price; zero inputs' },
  { file: 'W3295-ops-assay-export-queued.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/assay/certificate?…&export=queued — "Download PDF" refused (Q10-A): nothing queued; Back → W373, the trigger (DELTA `assay_export_back`)' },
  { file: 'W3296-ops-assay-export-ready.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused; Back → W373' },
  { file: 'W3297-ops-assay-mutate-confirm.html', wave: '2b', module: 'warehouse', verdict: 'REAL', note: '/warehouse/assay?booking=&act=confirm — the record form under the confirm sentence (Q13-A label); its submit IS the act' },
  { file: 'W3298-ops-assay-mutate-success.html', wave: '2b', module: 'warehouse', verdict: 'REAL', note: '?act=success — "Recorded as the warehouse\'s own entry" (the API answered 201; one audit row); the zero-sum sentence refused BY NAME; Back → W372' },
  { file: 'W3299-ops-assay-mutate-failure.html', wave: '2b', module: 'warehouse', verdict: 'REAL', note: '?act=failure&reason=… — "Nothing was recorded" with the server\'s named reason (409 not stored · 403 not the named operator · 404 · 400/422) or the console\'s pre-check; Back → W372, never W373' },
  { file: 'W375-ops-enwr-issue.html', wave: '2b', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/enwr/issue — HONEST, reads nothing: "This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name."; zero inputs; the issue form, "Send OTP to farmer", the valuation and "repository confirmed" refused by name' },
  { file: 'W376-ops-enwr-registry.html', wave: '2b', module: 'warehouse', verdict: 'BUILT (read)', note: '/warehouse/enwr/registry — a READ of the organisation\'s receipt records (GET …/nwr?box=all, keyset, a GET page-size select): number → /warehouse/enwr/[id], repository as recorded, quantity as recorded, status verbatim, dates, each "recorded, not confirmed"; no holder, no value' },
  { file: 'W3313-ops-enwr-export-queued.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/enwr/registry?export=queued — "Export register" refused (Q10-A); Back → W376, the trigger (DELTA `enwr_export_back`)' },
  { file: 'W3314-ops-enwr-export-ready.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused' },
  { file: 'W3315-ops-enwr-mutate-confirm.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/enwr/issue?act=confirm — "Send OTP to farmer" and "Retry connection" refused: nothing to confirm' },
  { file: 'W3316-ops-enwr-mutate-success.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing was sent or recorded; the zero-sum sentence refused BY NAME (`enwr_zero_sum`)' },
  { file: 'W3317-ops-enwr-mutate-failure.html', wave: '2b', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted; nobody is paged; Back → /warehouse/enwr/issue' },
  // ── 2a · INTAKE (22) — decided (founder Q6-A, Q9-A, Q10-A, Q11-A, Q12-A, Q14-A; D1–D3) ──
  { file: 'W370-ops-wh-dashboard.html', wave: '2a', module: 'warehouse', verdict: 'BUILT (read)', note: '/warehouse/dashboard (`/warehouse` answers a 307 here) — a READ of the bookings at the warehouses the signed-in person operates (GET …/warehouses?box=mine, then GET …/storage-bookings?box=warehouse&warehouseId= for each), keyset, a GET status select the only input: reference, status (translated), commodity (the product\'s own name), quantity with its unit, dates — no depositor name or id; Q12-A "A booking is the depositor\'s own request. She cannot yet make one on this platform."; "Release is paused for everyone."; net received, slip, eNWR pending, "of N" and "Page 1 of 1" refused; links to the weighbridge and stacking pages; a row → /warehouse/[id]' },
  { file: 'W3362-ops-wh-form-form-error.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/dashboard?form=error — "New booking" refused (Q12-A): there is no form, so nothing to correct' },
  { file: 'W3363-ops-wh-form-review.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=review — nothing to review; "maker-checker" refused' },
  { file: 'W3364-ops-wh-form-success.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=success — no booking was made; the zero-sum sentence refused BY NAME (`intake_zero_sum`)' },
  { file: 'W3365-ops-wh-form-failure.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=failure — nothing was attempted; nobody is paged; Back → W370 (the canon\'s "Retry — back to confirm" is a defect)' },
  { file: 'W3366-ops-wh-mutate-confirm.html', wave: '2a', module: 'warehouse', verdict: 'PARITY-DECOR', note: '/warehouse/dashboard?act=confirm — "Retry": reading the dashboard again changes nothing; the link IS a re-read of /warehouse/dashboard' },
  { file: 'W3367-ops-wh-mutate-success.html', wave: '2a', module: 'warehouse', verdict: 'PARITY-DECOR', note: '?act=success — the dashboard is read afresh each time it opens; nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3368-ops-wh-mutate-failure.html', wave: '2a', module: 'warehouse', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → W370 reads it again; nobody is paged' },
  { file: 'W371-ops-weighbridge.html', wave: '2a', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/weighbridge — HONEST, reads nothing, zero inputs: "This platform records no weighment." "Marking goods stored records no weight." "The quantity on a booking and on its receipt is the quantity the depositor asked to store."; slip, print, gross/tare/net, calibration, Legal Metrology, dual-confirm, manual reading, vehicle and supervisor reprint refused by name' },
  { file: 'W3355-ops-weighbridge-export-queued.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/weighbridge?export=queued — "Print slip" refused (no slip, Q10-A): nothing queued' },
  { file: 'W3356-ops-weighbridge-export-ready.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused' },
  { file: 'W3357-ops-weighbridge-mutate-confirm.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/weighbridge?act=confirm — "Retry" (the indicator) refused: no device, nothing to confirm' },
  { file: 'W3358-ops-weighbridge-mutate-success.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing was weighed or recorded; the zero-sum sentence refused BY NAME (on a weighbridge, the weight that would set a fee)' },
  { file: 'W3359-ops-weighbridge-mutate-failure.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted; nobody is paged; Back → /warehouse/weighbridge' },
  { file: 'W374-ops-stacking.html', wave: '2a', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/stacking — HONEST, reads nothing, zero inputs: "Where goods sit in the warehouse is not recorded on this platform, and neither is pest control." "No receipt on this platform carries a location."; bay, stack, bag arithmetic, pest-control log, quarantine, the bay suggestion and the audit-count hold refused by name; linked from the dashboard' },
  { file: 'W3343-ops-stacking-form-form-error.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/stacking?form=error — "Log pest-control check" refused: there is no form' },
  { file: 'W3344-ops-stacking-form-review.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=review — nothing to review; "maker-checker" refused' },
  { file: 'W3345-ops-stacking-form-success.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=success — nothing was logged; the zero-sum sentence refused BY NAME' },
  { file: 'W3346-ops-stacking-form-failure.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?form=failure — nothing was attempted; nobody is paged; Back → W374' },
  { file: 'W3347-ops-stacking-mutate-confirm.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/stacking?act=confirm — "Retry" (the bay assignment) refused: no bay exists' },
  { file: 'W3348-ops-stacking-mutate-success.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing was assigned; the zero-sum sentence refused BY NAME' },
  { file: 'W3349-ops-stacking-mutate-failure.html', wave: '2a', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted; Back → /warehouse/stacking' },
]);

/** The six canon chain groups (survey §1J–§1O, 36 files, each exactly once) and the wave that owns each. */
export const OPS2_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Ops2Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'wh_export', donor: 'W370 (trigger W379)', wave: '2c', files: ['W3360', 'W3361'] },
  { id: 'wh_form_act', donor: 'W370', wave: '2a', files: ['W3362', 'W3363', 'W3364', 'W3365', 'W3366', 'W3367', 'W3368'] },
  { id: 'weighbridge', donor: 'W371', wave: '2a', files: ['W3355', 'W3356', 'W3357', 'W3358', 'W3359'] },
  { id: 'assay', donor: 'W372', wave: '2b', files: ['W3295', 'W3296', 'W3297', 'W3298', 'W3299'] },
  { id: 'stacking', donor: 'W374', wave: '2a', files: ['W3343', 'W3344', 'W3345', 'W3346', 'W3347', 'W3348', 'W3349'] },
  { id: 'enwr', donor: 'W375', wave: '2b', files: ['W3313', 'W3314', 'W3315', 'W3316', 'W3317'] },
  { id: 'storage', donor: 'W378', wave: '2c', files: ['W3350', 'W3351', 'W3352', 'W3353', 'W3354'] },
]);

// ── THE BUILT CHAINS: each is a query state of its parent page (the OPS-1 `Ops1Chain` shape). All three of 2c's are DECOR; of 2b's four, the assay
// act chain is REAL (the record act's own states) and the other three DECOR; of 2a's six, the wh act chain is PARITY-DECOR (its "Retry" is a plain
// re-read of the dashboard) and the other five DECOR. NAMED WIDENING (OPS-2a): `kind` gains 'PARITY-DECOR' and `param` gains 'form'. ──
export type Chain2Id = 'storage_export' | 'storage_act' | 'wh_export' | 'assay_act' | 'assay_export' | 'enwr_export' | 'enwr_act'
  | 'wh_form' | 'wh_act' | 'weighbridge_export' | 'weighbridge_act' | 'stacking_form' | 'stacking_act';
export interface Chain2Def {
  id: Chain2Id; wave: Ops2Wave; kind: 'DECOR' | 'REAL' | 'PARITY-DECOR'; param: 'act' | 'export' | 'form'; page: string; surface: Ops2Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS2_CHAINS: readonly Chain2Def[] = Object.freeze([
  { id: 'storage_export', wave: '2c', kind: 'DECOR', param: 'export', page: '/warehouse/billing', surface: 'storage_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.storageExport.${s}`, files: ['W3350', 'W3351'], statement: 'ops2.billing.payee' },
  { id: 'storage_act', wave: '2c', kind: 'DECOR', param: 'act', page: '/warehouse/billing', surface: 'storage_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.storageAct.${s}`, files: ['W3352', 'W3353', 'W3354'], statement: 'ops2.billing.payee' },
  { id: 'wh_export', wave: '2c', kind: 'DECOR', param: 'export', page: '/warehouse/insights', surface: 'wh_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.whExport.${s}`, files: ['W3360', 'W3361'], statement: 'ops2.insights.statement' },
  { id: 'assay_act', wave: '2b', kind: 'REAL', param: 'act', page: '/warehouse/assay', surface: 'assay_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.assayAct.${s}`, files: ['W3297', 'W3298', 'W3299'], statement: 'ops2.assay.label' },
  { id: 'assay_export', wave: '2b', kind: 'DECOR', param: 'export', page: '/warehouse/assay/certificate', surface: 'assay_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.assayExport.${s}`, files: ['W3295', 'W3296'], statement: 'ops2.assay.label' },
  { id: 'enwr_export', wave: '2b', kind: 'DECOR', param: 'export', page: '/warehouse/enwr/registry', surface: 'enwr_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.enwrExport.${s}`, files: ['W3313', 'W3314'], statement: 'ops2.enwrIssue.statement' },
  { id: 'enwr_act', wave: '2b', kind: 'DECOR', param: 'act', page: '/warehouse/enwr/issue', surface: 'enwr_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.enwrAct.${s}`, files: ['W3315', 'W3316', 'W3317'], statement: 'ops2.enwrIssue.statement' },
  // ── OPS-2a ──
  { id: 'wh_form', wave: '2a', kind: 'DECOR', param: 'form', page: '/warehouse/dashboard', surface: 'wh_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `ops2.chain.whForm.${s}`, files: ['W3362', 'W3363', 'W3364', 'W3365'], statement: 'ops2.whDash.newBooking' },
  { id: 'wh_act', wave: '2a', kind: 'PARITY-DECOR', param: 'act', page: '/warehouse/dashboard', surface: 'wh_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.whAct.${s}`, files: ['W3366', 'W3367', 'W3368'], statement: 'ops2.whDash.lead' },
  { id: 'weighbridge_export', wave: '2a', kind: 'DECOR', param: 'export', page: '/warehouse/weighbridge', surface: 'weighbridge_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.weighbridgeExport.${s}`, files: ['W3355', 'W3356'], statement: 'ops2.weighbridge.statement' },
  { id: 'weighbridge_act', wave: '2a', kind: 'DECOR', param: 'act', page: '/warehouse/weighbridge', surface: 'weighbridge_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.weighbridgeAct.${s}`, files: ['W3357', 'W3358', 'W3359'], statement: 'ops2.weighbridge.statement' },
  { id: 'stacking_form', wave: '2a', kind: 'DECOR', param: 'form', page: '/warehouse/stacking', surface: 'stacking_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `ops2.chain.stackingForm.${s}`, files: ['W3343', 'W3344', 'W3345', 'W3346'], statement: 'ops2.stacking.statement' },
  { id: 'stacking_act', wave: '2a', kind: 'DECOR', param: 'act', page: '/warehouse/stacking', surface: 'stacking_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.stackingAct.${s}`, files: ['W3347', 'W3348', 'W3349'], statement: 'ops2.stacking.statement' },
]);
export function chain2ById(id: Chain2Id): Chain2Def { return OPS2_CHAINS.find((c) => c.id === id) as Chain2Def; }
/** The chain state a page was opened in (`?act=confirm`, `?export=queued` …), or null for the page itself / an unknown state. */
export function chain2State(id: Chain2Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain2ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
