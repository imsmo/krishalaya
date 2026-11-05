// apps/web-ops/src/features/ops1/refusals.ts · PC-56 OPS-1 — WHAT THE FIELD DESK'S PAGES DO NOT CLAIM, BY NAME. PURE. The shape of web-partner's
// features/partner6/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it and the surfaces that PRINT it (a sentence
// that says no — never an offer); the render tests read this map, and the claims guard (test/claims-guard.spec.ts, the `ops1.` scope) keeps the
// canon's false words out of every `ops1.` value. No canon person, member number, bill / receipt / booking reference, place or figure appears in
// any value.
//
// OPS-1a · THE MONEY DESKS (founder 1a-1 … 1a-4, 2026-11-05) builds:
//   • `payout` (W367, `/payout`) — a READ of the organisation's milk bills over the EXISTING `GET /v1/dairy/milk-bills` (keyset, one GET
//     page-size select): the server's gross / deductions / net per bill, the state verbatim, the member as the memberships read prints it
//     (the member code — never a canon name); no total (the list returns none). The ops console approves nothing and pays nothing (Q2-A).
//   • `payout_bill` (`/payout/[id]`) — the bill's own read (`GET /v1/dairy/milk-bills/:id`), the drill-in FM:18 names.
//   • `withdrawal` (W377, `/warehouse/withdrawal`) — an HONEST PAGE THAT READS NOTHING: how release works here, and that it is paused (Q3-A).
//   • `payout_act` (W3332–W3334) and `withdrawal_act` (W3369–W3371) — DECOR chains (`?act=`), Back → the triggering page.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops1Surface =
  // OPS-1a — built
  | 'payout' | 'payout_bill' | 'withdrawal' | 'payout_act' | 'withdrawal_act'
  // OPS-1b — declared, pending
  | 'aeps_home' | 'aeps_record' | 'aeps_exceptions' | 'aeps_receipt' | 'face_enroll' | 'face_attendance' | 'biometric_canon' | 'aeps_act'
  // OPS-1c — declared, pending
  | 'kiosk_home' | 'kiosk_start' | 'kiosk_profile' | 'kiosk_land' | 'kiosk_kyc' | 'kiosk_bank' | 'kiosk_listing' | 'kiosk_schemes'
  | 'kiosk_summary' | 'kiosk_earnings' | 'kiosk_act';
export interface Ops1Refusal { id: string; canon: string; surfaces: readonly Ops1Surface[]; key: string; why: string }

/** The surfaces OPS-1a builds. */
export const SURFACES_1A: readonly Ops1Surface[] = ['payout', 'payout_bill', 'withdrawal', 'payout_act', 'withdrawal_act'];
const PAYOUT: readonly Ops1Surface[] = ['payout', 'payout_act'];
const WITHDRAWAL: readonly Ops1Surface[] = ['withdrawal', 'withdrawal_act'];
const CHAINS_1A: readonly Ops1Surface[] = ['payout_act', 'withdrawal_act'];

export const OPS1_REFUSALS: readonly Ops1Refusal[] = Object.freeze([
  // ══ W367 · Cycle payout run (founder 1a-1, Q2-A: read only) ══
  { id: 'send_to_desk', canon: 'W367 "Send to tenant payout desk" (FM:50, `chain-mutate` → W3332–W3334)', surfaces: PAYOUT,
    key: 'ops1.refusal.sendToDesk', why: 'GAP-BE (survey C-4, OPS1-B12): no hand-off state exists between a collection centre and a payout desk — refused BY NAME (MONEY)' },
  { id: 'wage_lane', canon: 'W367 "payouts ride the WAGE LANE (W066 canon: milk money never queues behind commerce)"', surfaces: ['payout'],
    key: 'ops1.refusal.wageLane', why: 'FALSE: a paid bill is a wallet posting tenant → member (`milk-bill.service.ts` pay, `milk_payment`); the wage-priority flag concerns labour wages' },
  { id: 'computed_net', canon: 'W367 "Net to farmers ₹… = gross − deductions, to the paisa" and the cycle KPI sums', surfaces: ['payout', 'payout_bill'],
    key: 'ops1.refusal.computedNet', why: 'no client money math (Law 2, survey E3): every amount is the server\'s per-bill figure; the list returns no cycle total, so none is printed' },
  { id: 'page_count', canon: 'W367 "Showing 3 of 214 bills … Page 1 of 9"', surfaces: ['payout'],
    key: 'ops1.refusal.pageCount', why: 'the list is keyset-paged and returns no count (`meta` is `nextCursor` only — pinned live); a page total would be invented' },
  { id: 'sms_every_member', canon: 'W367 "Preview SMS went to every member Sat 11 (bill in Gujarati, line by line …)"', surfaces: ['payout'],
    key: 'ops1.refusal.smsDelivery', why: 'preview queues a member notice (outbox); delivery is the communication plane\'s and is not read by this page — never "went to every member"' },
  { id: 'early_close', canon: 'W367 "a member who confirms … closes their own window early and pays on the day-2 wage-lane run"', surfaces: ['payout'],
    key: 'ops1.refusal.earlyClose', why: 'FALSE: no member-confirm route exists; the window is closed by time only; no day-2 run exists' },
  { id: 'holes', canon: 'W367 "a payout run with holes pays nobody until it\'s whole (all-or-explain)"', surfaces: PAYOUT,
    key: 'ops1.refusal.holes', why: 'FALSE for the per-bill path: each bill is paid on its own' },
  { id: 'cross_org', canon: 'W367 "MCC prepares; the tenant dairy desk approves and pays (maker-checker across organisations)"', surfaces: PAYOUT,
    key: 'ops1.refusal.crossOrg', why: 'FALSE: one organisation; the cycle path\'s second signature is inside it (web-tenant W169); the per-bill path has none (§7 founder question)' },
  { id: 'names_forever', canon: 'W367 "Both names on the run forever."', surfaces: ['payout'],
    key: 'ops1.refusal.namesKept', why: 'a retention promise (the B2a rule): refused' },
  { id: 'disputed_mask', canon: 'W367 "disputed rows mask the member\'s name on shared screens until resolved — the rule, stated"', surfaces: ['payout'],
    key: 'ops1.refusal.disputedMask', why: 'UNPROVABLE (no masking rule found); this page prints the member code, never a name, in every state' },
  // ══ W377 · Withdrawal — a GOODS release against an e-NWR (survey C-3; founder 1a-2, Q3-A) ══
  { id: 'request_release', canon: 'W377 "Request release" (FM:87, `chain-mutate` → W3369–W3371)', surfaces: WITHDRAWAL,
    key: 'ops1.refusal.requestRelease', why: 'FALSE as the depositor\'s request: release is the operator\'s act, and it is PAUSED at the API (409 STORAGE_RELEASE_AWAITS_DEPOSITOR) until she confirms it herself (Q3-A)' },
  { id: 'partial_release', canon: 'W377 "Partial release preview 62.60 qtl − 20.00 qtl = 42.60 qtl … the receipt stays open at the reduced quantity"', surfaces: ['withdrawal'],
    key: 'ops1.refusal.partial', why: 'GAP-BE: `partially_released` has no transition (`nwr-receipt.state.ts`); release is whole-booking; the subtraction is refused regardless' },
  { id: 'lender_noc', canon: 'W377 "Rule: pledged receipts need lender NOC … both signatures or neither"', surfaces: ['withdrawal'],
    key: 'ops1.refusal.lenderNoc', why: 'GAP-BE: `pledged` has no transition and `pledged_loan_id` is never set — no receipt is pledged on this platform yet' },
  { id: 'out_weighment', canon: 'W377 "Weighbridge OUT ties the loop … within 0.5% before this withdrawal is confirmed"', surfaces: ['withdrawal'],
    key: 'ops1.refusal.outWeigh', why: 'GAP-BE: no out-weighment is read at release' },
  { id: 'depositor_only', canon: 'W377 state "Withdrawal request is depositor-only — Only the receipt\'s registered depositor (or their recorded nominee) can request a release"', surfaces: ['withdrawal'],
    key: 'ops1.refusal.depositorOnly', why: 'FALSE: no depositor request route and no nominee exist' },
  { id: 'receipt_balance', canon: 'W377 "Remaining on receipt" · "The receipt balance is unchanged"', surfaces: WITHDRAWAL,
    key: 'ops1.refusal.receiptBalance', why: 'no balance exists on a receipt' },
  { id: 'no_release_promise', canon: 'W377 failure state "nothing was released without confirmation"', surfaces: ['withdrawal'],
    key: 'ops1.refusal.releasePromise', why: 'a promise about a request that does not exist — refused as a promise (the release is paused, which the statement says)' },
  // ══ the two DECOR chains (W3332–W3334, W3369–W3371) ══
  { id: 'zero_sum', canon: 'W3333 / W3370 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: CHAINS_1A,
    key: 'ops1.refusal.zeroSum', why: 'FALSE on a DECOR chain: nothing happened, so nothing balanced — the panel\'s most dangerous chain sentence (survey §1I), refused BY NAME' },
  { id: 'on_call', canon: 'W3334 / W3371 "repeated failures page the on-call"', surfaces: CHAINS_1A,
    key: 'ops1.refusal.onCall', why: 'no paging exists for these pages' },
  { id: 'audit_trail', canon: 'W3332 / W3333 / W3369 / W3370 "confirming writes an audit-trail entry" · "View audit trail"', surfaces: CHAINS_1A,
    key: 'ops1.refusal.auditTrail', why: 'no act is taken, so nothing is audited; no ops audit surface exists' },
]);

export function ops1RefusalKeys(surface: Ops1Surface): string[] {
  return OPS1_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** Route and canon DELTAs recorded by OPS-1a (the built address vs the canon's; the canon's own defects). */
export const OPS1_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_payout', canon: 'W367 canon route `apps/web-ops/src/app/payout`; the console\'s dairy desk was `/dairy`',
    built: '`/payout` is built at the canon address (a DAIRY sidebar item under Dairy); `/dairy` keeps its read (collections, slips, bill list, preview, generate) and LINKS to `/payout` for the run — no 307, because `/dairy` holds acts `/payout` does not' },
  { id: 'route_withdrawal', canon: 'W377 canon route `apps/web-ops/src/app/warehouse/withdrawal`',
    built: '`/warehouse/withdrawal` at the canon address (a WAREHOUSE sidebar item under Warehouse); inbound edges drawn from `/warehouse/[id]` (the paused-release sentence) and the sidebar' },
  { id: 'w377_goods_release', canon: 'LEDGER :930-931 "fintech/payments api · OW-5 assisted money"; 05_OPS.md places W377 with kiosk/AePS by its slug',
    built: 'W377 is a WAREHOUSE GOODS release against an e-NWR (survey C-3) — this registry files it under the warehouse module, never "assisted money"' },
  { id: 'payout_no_cycle_filter', canon: 'W367 "Cycle payout run — 01–10 Jul bills" (one cycle\'s bills)',
    built: '`GET /v1/dairy/milk-bills` has no cycle filter, so the page lists the organisation\'s bills newest first and says so; "no cycle" is answered by `GET /v1/dairy/bill-cycles?limit=1` (an existing read)' },
  { id: 'payout_member_code', canon: 'W367 "Meera Ben D. · #0781 · MB-0781-0701"',
    built: 'the bill list carries no name; the member prints as the memberships read prints it (the member code — what web-tenant\'s `/dairy/console` prints); never a canon name or number' },
  { id: 'fm_chain_ids', canon: 'FM :49-50, :87-88 name W1780–W1782 / W1822–W1824', built: 'those files do not exist (survey C-16); the real chains are W3332–W3334 and W3369–W3371' },
  { id: 'fm_filter_spans', canon: 'FM :48 "MM", :86 "PV" as `filter`', built: 'avatar `<span>`s, not filters — not built (DECOR, DELTA)' },
  { id: 'chain_back', canon: 'W3332–W3334 / W3369–W3371 "Back to the screen" → W367 / W377', built: 'Back returns to the triggering page (`/payout`, `/warehouse/withdrawal`)' },
]);

/** The verdict values. `pending_1b` / `pending_1c` are deleted by the wave that decides them (the 4c-7 rule). */
export type Ops1Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'pending_1b' | 'pending_1c';
/** Every canon file of OPS-1 (31), each with ONE verdict: 1a decides its 8; 1b's 10 and 1c's 13 are pending. */
export const OPS1_CANON_FILES: readonly { file: string; wave: '1a' | '1b' | '1c'; module: string; verdict: Ops1Verdict; note: string }[] = Object.freeze([
  // ── 1a · THE MONEY DESKS (8) — decided by 1a (founder 1a-1 … 1a-4) ──
  { file: 'W367-ops-payout-run.html', wave: '1a', module: 'dairy', verdict: 'BUILT (read)', note: '/payout — a READ of the organisation\'s milk bills over GET /v1/dairy/milk-bills (keyset; one GET page-size select 25/50/100): member code, period, litres, the server\'s gross / deductions / net, the state verbatim; a row → /payout/[id] (GET …/milk-bills/:id). No total, no page count, no approve, no pay — "Bills are approved and paid by your organisation\'s dairy desk, not from this console ("with two people" dropped by the founder 2026-11-06 — paying is one person today). Nothing is approved or paid here."' },
  { file: 'W377-ops-withdrawal.html', wave: '1a', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/withdrawal — an HONEST PAGE THAT READS NOTHING: release is the whole booking, the operator\'s act, the storage fee settles from the depositor\'s wallet at release — and release is paused until she can confirm it herself; never a part of a booking; no receipt is pledged here yet; a link to the bookings list. "Request release" refused by name' },
  { file: 'W3332-ops-payout-mutate-confirm.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '/payout?act=confirm — "Send to tenant payout desk" is a refused act: nothing to confirm' },
  { file: 'W3333-ops-payout-mutate-success.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '?act=success — nothing was sent, approved or paid; the "reconcile zero-sum" sentence refused BY NAME (`zero_sum`)' },
  { file: 'W3334-ops-payout-mutate-failure.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '?act=failure — nothing was attempted; Back re-reads the bills (a genuine re-read), the chain stays DECOR because its trigger is refused' },
  { file: 'W3369-ops-withdrawal-mutate-confirm.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/withdrawal?act=confirm — "Request release" is refused: nothing to confirm' },
  { file: 'W3370-ops-withdrawal-mutate-success.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing was released or charged; the "reconcile zero-sum" sentence refused BY NAME' },
  { file: 'W3371-ops-withdrawal-mutate-failure.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; nobody is paged' },
  // ── 1b · bank services and biometrics the platform does not run (10) — pending ──
  { file: 'W390-ops-aeps-home.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (Q1-A: honest)' },
  { file: 'W391-ops-aeps-withdrawal.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (Q1-A: the record act)' },
  { file: 'W392-ops-aeps-exceptions.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (read)' },
  { file: 'W393-ops-aeps-receipt.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (honest: no receipt)' },
  { file: 'W397-ops-face-enroll.html', wave: '1b', module: 'attendance', verdict: 'pending_1b', note: 'OPS-1b (Q5-A: honest)' },
  { file: 'W398-ops-face-attendance.html', wave: '1b', module: 'attendance', verdict: 'pending_1b', note: 'OPS-1b (read or honest)' },
  { file: 'W399-ops-biometric-canon.html', wave: '1b', module: 'canon', verdict: 'pending_1b', note: 'OPS-1b (honest reference)' },
  { file: 'W3289-ops-aeps-mutate-confirm.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (aeps chain)' },
  { file: 'W3290-ops-aeps-mutate-success.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (aeps chain)' },
  { file: 'W3291-ops-aeps-mutate-failure.html', wave: '1b', module: 'aeps', verdict: 'pending_1b', note: 'OPS-1b (aeps chain)' },
  // ── 1c · the kiosk (13) — pending ──
  { file: 'W380-ops-kiosk-home.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (read)' },
  { file: 'W381-ops-kiosk-session-start.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (the create act)' },
  { file: 'W382-ops-kiosk-profile.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (the create act)' },
  { file: 'W383-ops-kiosk-land-crops.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W384-ops-kiosk-kyc.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W385-ops-kiosk-bank.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W386-ops-kiosk-first-listing.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W387-ops-kiosk-schemes.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W388-ops-kiosk-summary.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W389-ops-kiosk-ambassador.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (read)' },
  { file: 'W3329-ops-kiosk-mutate-confirm.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
  { file: 'W3330-ops-kiosk-mutate-success.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
  { file: 'W3331-ops-kiosk-mutate-failure.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
]);

// ── THE DECOR CHAINS of 1a: each is a query state of its parent page ──
export type Chain1Id = 'payout_act' | 'withdrawal_act';
export interface Chain1Def {
  id: Chain1Id; wave: '1a'; param: string; page: string; surface: Ops1Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS1_CHAINS: readonly Chain1Def[] = Object.freeze([
  { id: 'payout_act', wave: '1a', param: 'act', page: '/payout', surface: 'payout_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.payoutAct.${s}`, files: ['W3332', 'W3333', 'W3334'], statement: 'ops1.payout.statement' },
  { id: 'withdrawal_act', wave: '1a', param: 'act', page: '/warehouse/withdrawal', surface: 'withdrawal_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.withdrawalAct.${s}`, files: ['W3369', 'W3370', 'W3371'], statement: 'ops1.withdrawal.statement' },
]);
export function chain1ById(id: Chain1Id): Chain1Def { return OPS1_CHAINS.find((c) => c.id === id) as Chain1Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain1State(id: Chain1Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain1ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
