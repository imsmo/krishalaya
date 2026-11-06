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
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops2Surface =
  // the ten pages (survey E5)
  | 'wh_dashboard' | 'weighbridge' | 'assay_lab' | 'assay_record' | 'stacking' | 'enwr_issue' | 'enwr_registry' | 'enwr_receipt' | 'billing' | 'wh_insights'
  // the chains
  | 'wh_form' | 'wh_act' | 'wh_export' | 'weighbridge_act' | 'weighbridge_export' | 'assay_act' | 'assay_export' | 'stacking_form' | 'stacking_act'
  | 'enwr_act' | 'enwr_export' | 'storage_act' | 'storage_export';
export interface Ops2Refusal { id: string; canon: string; surfaces: readonly Ops2Surface[]; key: string; why: string }

/** The surfaces OPS-2c builds. */
export const SURFACES_2C: readonly Ops2Surface[] = ['billing', 'wh_insights', 'storage_export', 'storage_act', 'wh_export'];
/** The pages OPS-2c builds that READ NOTHING (E7, E11) — zero inputs, no API client, no error state. */
export const HONEST_2C: readonly Ops2Surface[] = ['wh_insights'];
const BILLING_ALL: readonly Ops2Surface[] = ['billing', 'storage_export', 'storage_act'];
const STORAGE_CHAINS: readonly Ops2Surface[] = ['storage_export', 'storage_act'];
const EXPORTS_2C: readonly Ops2Surface[] = ['storage_export', 'wh_export'];

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
  { id: 'search_invoices', canon: 'W378 "Search invoices… ⌘K" · W379 "Search metrics… ⌘K"', surfaces: ['billing', 'wh_insights'],
    key: 'ops2.refusal.search', why: 'DECOR: no warehouse search route; no input is built (E7)' },
  { id: 'wh_plan_settings', canon: 'W378 / W379 flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: ['billing', 'wh_insights'],
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
    key: 'ops2.refusal.reassayDue', why: 'GAP-BE: no query over `valid_until`; W372 is not built yet (OPS-2b), so the link is a sentence, never an href to an unbuilt route' },
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
  { id: 'export_receipt', canon: 'W3350 / W3360 "audit-stamped, checksummed, delivered by signed URL" · W3351 / W3361 "Audit-stamped receipt: file name, row count, sha256 … 15-min signed URL, every fetch logged"', surfaces: EXPORTS_2C,
    key: 'ops2.refusal.exportReceipt', why: 'TRUE of CORE\'s export plane in mechanism, but no warehousing dataset is registered (OPS2-B20) — refused on these pages' },
  { id: 'export_queue', canon: 'W3350 / W3360 "this job is queued with a position and ETA"', surfaces: EXPORTS_2C,
    key: 'ops2.refusal.exportQueue', why: 'no job is created' },
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
  { id: 'w379_assay_link', canon: 'W379 "View list" → W372 (FM omits it)', built: 'a SENTENCE only: W372 (`/warehouse/assay`) is OPS-2b\'s and not built, and no link goes to an unbuilt route' },
  { id: 'w378_payee_today', canon: 'W378 (missing from canon, true and binding — survey §1H) who receives the fee',
    built: 'the founder\'s Q1-A sentence: today the fee would go from the depositor\'s wallet into the warehouse operator\'s OWN wallet (`storage-booking.service.ts` release legs; by default the administrator who listed it); release is paused' },
]);

/** The verdict values. `pending_2b` / `pending_2a` are deleted from the type by the wave that decides the last of their files. */
export type Ops2Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR' | 'pending_2b' | 'pending_2a';
export type Ops2Wave = '2a' | '2b' | '2c';
/** Every canon file of OPS-2 (45), each with ONE verdict: 2c decides its 9; 2b's 14 and 2a's 22 are pending until their waves. */
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
  // ── 2b · RECEIPTS AND QUALITY (14) — pending ──
  ...['W372-ops-assay-lab.html', 'W373-ops-assay-certificate.html', 'W3295-ops-assay-export-queued.html', 'W3296-ops-assay-export-ready.html',
    'W3297-ops-assay-mutate-confirm.html', 'W3298-ops-assay-mutate-success.html', 'W3299-ops-assay-mutate-failure.html', 'W375-ops-enwr-issue.html',
    'W376-ops-enwr-registry.html', 'W3313-ops-enwr-export-queued.html', 'W3314-ops-enwr-export-ready.html', 'W3315-ops-enwr-mutate-confirm.html',
    'W3316-ops-enwr-mutate-success.html', 'W3317-ops-enwr-mutate-failure.html']
    .map((file) => ({ file, wave: '2b' as const, module: 'warehouse', verdict: 'pending_2b' as const, note: 'OPS-2b · RECEIPTS AND QUALITY (founder Q3-A, Q4-A, Q5-A, Q7-A, Q9-A, Q13-A) — not yet built' })),
  // ── 2a · INTAKE (22) — pending ──
  ...['W370-ops-wh-dashboard.html', 'W3362-ops-wh-form-form-error.html', 'W3363-ops-wh-form-review.html', 'W3364-ops-wh-form-success.html',
    'W3365-ops-wh-form-failure.html', 'W3366-ops-wh-mutate-confirm.html', 'W3367-ops-wh-mutate-success.html', 'W3368-ops-wh-mutate-failure.html',
    'W371-ops-weighbridge.html', 'W3355-ops-weighbridge-export-queued.html', 'W3356-ops-weighbridge-export-ready.html', 'W3357-ops-weighbridge-mutate-confirm.html',
    'W3358-ops-weighbridge-mutate-success.html', 'W3359-ops-weighbridge-mutate-failure.html', 'W374-ops-stacking.html', 'W3343-ops-stacking-form-form-error.html',
    'W3344-ops-stacking-form-review.html', 'W3345-ops-stacking-form-success.html', 'W3346-ops-stacking-form-failure.html', 'W3347-ops-stacking-mutate-confirm.html',
    'W3348-ops-stacking-mutate-success.html', 'W3349-ops-stacking-mutate-failure.html']
    .map((file) => ({ file, wave: '2a' as const, module: 'warehouse', verdict: 'pending_2a' as const, note: 'OPS-2a · INTAKE (founder Q6-A, Q11-A, Q12-A, Q14-A) — not yet built' })),
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

// ── THE BUILT CHAINS: each is a query state of its parent page (the OPS-1 `Ops1Chain` shape). All three of 2c's are DECOR. ──
export type Chain2Id = 'storage_export' | 'storage_act' | 'wh_export';
export interface Chain2Def {
  id: Chain2Id; wave: Ops2Wave; kind: 'DECOR' | 'REAL'; param: 'act' | 'export'; page: string; surface: Ops2Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS2_CHAINS: readonly Chain2Def[] = Object.freeze([
  { id: 'storage_export', wave: '2c', kind: 'DECOR', param: 'export', page: '/warehouse/billing', surface: 'storage_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.storageExport.${s}`, files: ['W3350', 'W3351'], statement: 'ops2.billing.payee' },
  { id: 'storage_act', wave: '2c', kind: 'DECOR', param: 'act', page: '/warehouse/billing', surface: 'storage_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops2.chain.storageAct.${s}`, files: ['W3352', 'W3353', 'W3354'], statement: 'ops2.billing.payee' },
  { id: 'wh_export', wave: '2c', kind: 'DECOR', param: 'export', page: '/warehouse/insights', surface: 'wh_export', states: ['queued', 'ready'],
    key: (s: string) => `ops2.chain.whExport.${s}`, files: ['W3360', 'W3361'], statement: 'ops2.insights.statement' },
]);
export function chain2ById(id: Chain2Id): Chain2Def { return OPS2_CHAINS.find((c) => c.id === id) as Chain2Def; }
/** The chain state a page was opened in (`?act=confirm`, `?export=queued` …), or null for the page itself / an unknown state. */
export function chain2State(id: Chain2Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain2ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
