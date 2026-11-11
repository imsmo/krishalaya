// apps/web-gov/src/features/gov3/refusals.ts · PC-56 GOV-3 — WHAT THE BENEFIT PAYMENTS PAGE DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov2/refusals.ts` shape (survey_gov3.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov3 claims guard (test/gov3-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov3.` value.
//
// GOV-3 is GOV-3a → GOV-3b (survey §4; GOV-3 Q1-A, Q2-A and Q4-A applied by the lead under the founder's instructions — 06_GOV.md "GOV-3
// SPLIT"; his to reopen). This registry carries ALL 23 canon files: GOV-3a decides its 9; GOV-3b's 14 stay `pending_3b` until it decides them.
//
// GOV-3a · THE MONEY PAGE builds ONE route (E1), `/dbt`:
//   • `dbt` (W332) — BUILT (honest): `gov.overview()` ONLY (E2) — per scheme the authority runs, the server's counts of applications
//     `approved` and `disbursed` ("Marked disbursed by an officer", GOV-1b's one key — E6), the server's `computedAt`, all time. No money figure,
//     no single payment, no farmer (Q1-A); Q1's, Q2's and Q4's sentences.
//   • W339 (payment triggers), W340 (one payment batch), W344 (payment insights) — BUILT (honest) as `/dbt`'s section "What this console does
//     not do" (GOV3_NOT_DONE): each canon feature named once, in plain words, as not done here. Their own addresses (`/dbt/triggers`,
//     `/dbt/batches/[id]`, `/dbt/insights`) have no route and answer not found.
//   • the chains (`?do=…&act=`; Back → `/dbt`): the dbt file chain (W3167–W3168) DECOR (Q4-A); the dbt mutate chain (W3169–W3171) DECOR when
//     opened by the canon's "Pause" (refused BY NAME), PARITY-DECOR when opened by the error state's Retry (its one link IS the re-read).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov3Surface =
  // GOV-3a · the page and its chains
  | 'dbt' | 'dbt_file' | 'dbt_pause' | 'dbt_reread'
  // GOV-3b · named now so the registry is whole; nothing is built or printed for them until GOV-3b
  | 'dbt_pfms' | 'dbt_returns' | 'recon_ask' | 'returns_remind' | 'pfms_file' | 'pfms_reread';
export interface Gov3Refusal { id: string; canon: string; surfaces: readonly Gov3Surface[]; key: string; why: string }

/** The surfaces GOV-3a builds. */
export const SURFACES_3A: readonly Gov3Surface[] = ['dbt', 'dbt_file', 'dbt_pause', 'dbt_reread'];
/** The surfaces GOV-3b will build (pending). */
export const SURFACES_3B: readonly Gov3Surface[] = ['dbt_pfms', 'dbt_returns', 'recon_ask', 'returns_remind', 'pfms_file', 'pfms_reread'];
const CHAINS_3A: readonly Gov3Surface[] = ['dbt_file', 'dbt_pause', 'dbt_reread'];
const WRITE_CHAINS_3A: readonly Gov3Surface[] = ['dbt_file', 'dbt_pause'];

export const GOV3_REFUSALS: readonly Gov3Refusal[] = Object.freeze([
  // ══ the console chrome on W332 ══
  { id: 'console_chrome_3a', canon: 'W332 "[initials]" avatar · "Search [payment references]… ⌘K" · the bell', surfaces: ['dbt'],
    key: 'gov3.refusal.consoleChrome', why: 'DECOR (FM filter rows): no search, person picker or bell exists; no payment-reference search exists in any realm' },
  { id: 'page_switch_3a', canon: 'W332 / W339 / W340 / W344 state "Flagged off — [page] disabled … [plan settings]"', surfaces: ['dbt'],
    key: 'gov3.refusal.pageSwitch', why: 'no per-page switch exists; gov_console OFF is stated' },
  // ══ W332 ══
  { id: 'seen_from_pfms', canon: 'W332 "[payments] — observed from [payment system]" · "The platform observes and reconciles credits … a [payment reference] + a credited_on date, or an honest failure"', surfaces: ['dbt'],
    key: 'gov3.refusal.notSeen', why: 'F-2 / C-7: nothing is received from PFMS (the port is a noop, pfms.provider.ts:43-51); the records that exist were typed by a person' },
  { id: 'money_tiles', canon: 'W332 tiles "Credited this [period] [money] · [n] credits · avg [money]" · "In [pipeline] [money] · [n] approved awaiting credit … median [n] days" · "Failed / returned [money] · [n] credits …"', surfaces: ['dbt'],
    key: 'gov3.refusal.noMoney', why: 'Q1-A / F-9: no money figure — the sums that exist are over typed records, with no currency, each on its own window' },
  { id: 'payment_rows', canon: 'W332 table Credit · Application · Instalment · [sum] · [payment reference] · Status ("credited", "returned — [reason]", "queued … pending approval")', surfaces: ['dbt'],
    key: 'gov3.refusal.noRows', why: 'Q1-A: no single payment, farmer, figure or reference is shown; dbt_transfers has no status column' },
  { id: 'paging_filters', canon: 'W332 "Showing 1–25 of [n] transfer records · Page size · Page 1 of [n]" · filters "bounced [date]", "queued" · three row menus', surfaces: ['dbt'],
    key: 'gov3.refusal.noPaging', why: 'no rows are listed, so there is nothing to page or filter (FM :86-88 DECOR)' },
  { id: 'farmer_message', canon: 'W332 "A [returned payment] never dead-ends: the farmer gets an [text message] naming the exact bank issue in their language … the credit [is sent again] automatically on fix"', surfaces: ['dbt'],
    key: 'gov3.refusal.noMessage', why: 'F-7: no outbox event on a returned payment, no consumer of schemes.dbt_recorded, no message registration; nothing is resent' },
  { id: 'arrival_days', canon: 'W332 state "No transfers yet — Credits appear as [the payment system confirms] them — approvals today usually show here within [n] days"', surfaces: ['dbt'],
    key: 'gov3.refusal.noArrival', why: 'FALSE: approving pays nothing (GOV-2 Q1-A); no arrival is seen; no time is promised' },
  { id: 'feed_state', canon: 'W332 state "[payment system] feed degraded … as of [time]" + Retry', surfaces: ['dbt'],
    key: 'gov3.refusal.noFeed', why: 'there is no feed to be working or degraded; the Retry re-reads this page (PARITY-DECOR)' },
  { id: 'finance_role', canon: 'W332 state "[finance] scope — Transfer [sums] are visible to all authority staff; [bank-level] details need the finance role — masked otherwise"', surfaces: ['dbt'],
    key: 'gov3.refusal.noFinanceRole', why: 'no authority finance role exists (0239, 0240: two roles); no bank detail is shown to any role (Q3 binds 3b; never printed here)' },
  { id: 'files_out', canon: 'W332 "Export recon (audit-stamped)" · W340 "Download payment file copy" · W344 "Export deck (audit-stamped)" (→ W3167)', surfaces: ['dbt', 'dbt_file'],
    key: 'gov3.refusal.noFile', why: 'Q4-A: no payment, matching or report file is made in this realm; Q4\'s sentence is printed' },
  // ══ W339 / W340 / W344 — the claims beyond the features named in "What this console does not do" ══
  { id: 'instalment_rule', canon: 'W339 "Instalment 1 — [share] of approved [area] × [money]" · "Instalment 2 — recomputed on measured [area], minus inst-1" · W340 lines "[area] × [money] × [share]"', surfaces: ['dbt'],
    key: 'gov3.refusal.noInstalmentRule', why: 'MONEY, FALSE: no payment figure is computed anywhere (benefit_summary carries a type and an instalment count only)' },
  { id: 'named_signers', canon: 'W339 "[releasing] is two humans\' job ([finance officer] prepares → [senior officer] …)" · W340 "prepared by [person] · … by [person] [time]" · "[two-key] — … both names on every [group], forever"', surfaces: ['dbt'],
    key: 'gov3.refusal.noSigners', why: 'FALSE: no person signs off a payment in any realm, so no name is shown for one; persons named in the canon are never copied' },
  { id: 'visit_code', canon: 'W339 guard "farmer [one-time code] on visit record · measured ≤ approved" · W340 "measured [area] (visit + [one-time code] …)"', surfaces: ['dbt'],
    key: 'gov3.refusal.noVisitCode', why: 'FALSE: a field visit records geotags and measures, no code; no visit result changes any payment (the field-visit pages are GOV-4\'s)' },
  { id: 'bank_check', canon: 'W340 pre-flight "Account verified ([bank check] or prior credit) — [n]/[n]; [n] lines … HELD OUT"', surfaces: ['dbt'],
    key: 'gov3.refusal.noBankCheck', why: 'PII, FALSE: DBT never reads bank_accounts; the platform holds no farmer bank detail for a benefit' },
  { id: 'publish_gate', canon: 'W339 state "No [rules] configured — A scheme publishes with its [rules] or it doesn\'t pay — the definition tool blocks publish without them"', surfaces: ['dbt'],
    key: 'gov3.refusal.noPublishGate', why: 'FALSE: publishing a scheme (admin realm, two people) depends on no payment setting' },
  // ══ the chains' shared sentences (W3167–W3171) — refused BY NAME ══
  { id: 'chain_money_3a', canon: 'W3170 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: CHAINS_3A,
    key: 'gov3.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_3a', canon: 'W3171 "repeated failures page the [duty person]"', surfaces: CHAINS_3A,
    key: 'gov3.refusal.chainPaging', why: 'no paging exists' },
  { id: 'chain_record_3a', canon: 'W3169 / W3170 "confirming writes an [record] entry with actor, time and reason" · "View [the record]" · "the [record] has the entry (actor · time · reason · before/after)"', surfaces: WRITE_CHAINS_3A,
    key: 'gov3.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view' },
  { id: 'chain_file_delivery', canon: 'W3167 / W3168 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged"', surfaces: ['dbt_file'],
    key: 'gov3.refusal.chainFile', why: 'Q4-A: no file is queued, made or handed out in this realm (GOV-2 Q4-A: no gov file plane)' },
  { id: 'chain_back_confirm_3a', canon: 'W3171 "Retry — back to confirm"', surfaces: ['dbt_pause'],
    key: 'gov3.refusal.chainBackConfirm', why: 'canon defect (survey §1): Back returns to the page that opened it, never a confirm step' },
  { id: 'reread_writes_3a', canon: 'W3169 "confirming writes an [record] entry with actor, time and reason" (opened by "Retry" on W332 / W339 / W340 / W344)', surfaces: ['dbt_reread'],
    key: 'gov3.refusal.rereadWrites', why: 'reading the counts again writes nothing (the overview records no read)' },
]);
export function gov3RefusalKeys(surface: Gov3Surface): string[] { return GOV3_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** `/dbt`'s section "What this console does not do" — W339, W340 and W344 BUILT (honest): each canon feature named ONCE, in plain words. */
export const GOV3_NOT_DONE: readonly { id: string; file: 'W339' | 'W340' | 'W344'; canon: string; key: string }[] = Object.freeze([
  { id: 'start', file: 'W339', canon: 'W339 "Payment triggers — what fires money, exactly" · the [rule] registry (application.approved → Instalment 1 …)', key: 'gov3.notDone.start' },
  { id: 'stop', file: 'W339', canon: 'W339 "[Stop] all [rules]" (→ W3169) · "the [stop] button … never claws back released money"', key: 'gov3.notDone.stop' },
  { id: 'group', file: 'W340', canon: 'W340 "[Group of payments] [ref] · … · Composed today [time] · [n] lines · [money]" · W339 "Tomorrow\'s [group] preview" · "Download payment file copy"', key: 'gov3.notDone.group' },
  { id: 'limit', file: 'W340', canon: 'W340 pre-flight "Sum within remaining [allotment]: [money] ≤ remaining [money] (= [allotted] [money] − [money] committed …)"', key: 'gov3.notDone.limit' },
  { id: 'timing', file: 'W344', canon: 'W344 "[Payment] performance — the promise, measured" · approval → credit buckets, [middle] and [90th] days · return rate, last year, [goal] · verification → inst-2 lag', key: 'gov3.notDone.timing' },
]);

/** What was built differently from the canon, and why (DELTAs). */
export const GOV3_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'one_route', canon: 'W332 /dbt · W339 /dbt/triggers · W340 /dbt/batches/[id] · W344 /dbt/insights', built: 'E1: one route, /dbt; W339, W340, W344 are its "does not do" section; the other addresses have no route (not found)' },
  { id: 'nav_dbt', canon: 'canon sidebar "DBT transfers" (W332)', built: 'GOV_NAV gains "Benefit payments" (/dbt)' },
  { id: 'q1_counts', canon: 'W332 money tiles and the transfer table', built: 'Q1-A: per scheme the server\'s counts of approved and of marked-disbursed applications (gov.overview), with the time the server counted; no money figure, no row' },
  { id: 'q2_not_recorded', canon: 'W332 "credited / returned / pending" display states', built: 'Q2-A: nobody records a payment (the tenant DBT routes refuse DBT_IS_NOT_RECORDED_HERE); an approved application stays approved; a marked-disbursed count is said to be from before' },
  { id: 'q4_no_file', canon: 'W332 / W340 / W344 file offers', built: 'Q4-A: no offer of any kind on the page; its sentence printed; the file chain (W3167–W3168) is DECOR, reached by address only' },
  { id: 'disbursed_one_key', canon: 'the applications page\'s "Disbursed"', built: 'B4 / E6: both pages word `disbursed` with GOV-1b\'s key "Marked disbursed by an officer"; `gov2.status.disbursed` deleted ×3' },
  { id: 'retry_reread', canon: 'load-error "Retry" on W332 / W339 / W340 / W344 → the mutate-confirm page W3169', built: 'the error state\'s Retry opens the re-read chain (`?do=reread&act=confirm`); its one link IS the re-read; nothing is written' },
  { id: 'six_groups', canon: 'brief / survey "5 chain groups"', built: 'the canon\'s own route comments name SIX groups (dbt × export, dbt × mutate, recon × mutate, bounce × mutate, pfms × export, pfms × mutate) over the 16 files; the registry records six' },
]);

/** The verdict values (GOV-3b deletes `pending_3b` from the type when it decides its 14 — the 4c-7 rule). */
export type Gov3Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_3b';
export type Gov3Wave = '3a' | '3b';
/** Every canon file of GOV-3 (23), each with ONE verdict: 3a decides its 9; 3b's 14 are pending. */
export const GOV3_CANON_FILES: readonly { file: string; wave: Gov3Wave; verdict: Gov3Verdict; note: string }[] = Object.freeze([
  // ── 3a · THE MONEY PAGE (9) — decided (Q1-A, Q2-A, Q4-A lead-applied) ──
  { file: 'W332-gov-dbt-monitor.html', wave: '3a', verdict: 'BUILT (honest)', note: '/dbt — gov.overview only: per scheme approved and marked-disbursed counts, computedAt, all time; Q1, Q2, Q4 verbatim; no money, row, farmer or reference' },
  { file: 'W339-gov-dbt-triggers.html', wave: '3a', verdict: 'BUILT (honest)', note: '/dbt "What this console does not do": nothing starts a payment; nothing stops one (gov3.notDone.start / .stop); /dbt/triggers has no route' },
  { file: 'W340-gov-dbt-batch.html', wave: '3a', verdict: 'BUILT (honest)', note: '/dbt "What this console does not do": no list of payments is put together or sent, no payment file; no spending limit kept (gov3.notDone.group / .limit); /dbt/batches/[id] has no route' },
  { file: 'W344-gov-dbt-insights.html', wave: '3a', verdict: 'BUILT (honest)', note: '/dbt "What this console does not do": no measure of how long payments take or how many come back (gov3.notDone.timing); /dbt/insights has no route' },
  { file: 'W3167-gov-dbt-export-queued.html', wave: '3a', verdict: 'DECOR', note: '/dbt?do=file&act=queued — Q4-A: no file is made; reached by address only' },
  { file: 'W3168-gov-dbt-export-ready.html', wave: '3a', verdict: 'DECOR', note: '/dbt?do=file&act=ready — Q4-A: no file exists to hand out' },
  { file: 'W3169-gov-dbt-mutate-confirm.html', wave: '3a', verdict: 'DECOR', note: '/dbt?do=pause&act=confirm — the canon\'s "Pause" refused BY NAME (Q1-A); from the error Retry (`do=reread`): PARITY-DECOR, the link IS a re-read' },
  { file: 'W3170-gov-dbt-mutate-success.html', wave: '3a', verdict: 'DECOR', note: '/dbt?do=pause&act=success — nothing was stopped' },
  { file: 'W3171-gov-dbt-mutate-failure.html', wave: '3a', verdict: 'DECOR', note: '/dbt?do=pause&act=failure — nothing was sent; Back → /dbt (never a confirm step)' },
  // ── 3b · RETURNS AND MATCHING (14) — pending GOV-3b (Q3, Q5) ──
  { file: 'W341-gov-pfms-recon.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W342-gov-recon-case.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W343-gov-bounce-desk.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3179-gov-recon-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3180-gov-recon-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3181-gov-recon-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3211-gov-bounce-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3212-gov-bounce-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3213-gov-bounce-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3239-gov-pfms-export-queued.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3240-gov-pfms-export-ready.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3241-gov-pfms-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3242-gov-pfms-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
  { file: 'W3243-gov-pfms-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'GOV-3b' },
]);

/** The canon chain groups (survey §1H–§1N; the canon's route comments "B2 shared chain: <m> × chain-<x>"), 16 files, each exactly once. */
export const GOV3_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov3Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'dbt_export', donor: 'W332', wave: '3a', files: ['W3167', 'W3168'] },
  { id: 'dbt_mutate', donor: 'W332', wave: '3a', files: ['W3169', 'W3170', 'W3171'] },
  { id: 'recon_mutate', donor: 'W342', wave: '3b', files: ['W3179', 'W3180', 'W3181'] },
  { id: 'bounce_mutate', donor: 'W343', wave: '3b', files: ['W3211', 'W3212', 'W3213'] },
  { id: 'pfms_export', donor: 'W341', wave: '3b', files: ['W3239', 'W3240'] },
  { id: 'pfms_mutate', donor: 'W341', wave: '3b', files: ['W3241', 'W3242', 'W3243'] },
]);

// ── THE BUILT CHAINS (GOV-3a): each is a query state (`?do=…&act=`) of /dbt; Back → /dbt. The dbt mutate group is built TWICE, by its two
// kinds of opener: the canon's "Pause" (DECOR — refused BY NAME) and the error state's Retry (PARITY-DECOR — a re-read). ──
export type Chain3Id = 'dbt_file' | 'dbt_pause' | 'dbt_reread';
export interface Chain3Def {
  id: Chain3Id; wave: Gov3Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov3Surface; states: readonly string[];
  doing: string; key: (state: string) => string; statement: string;
}
const MUTATE_STATES = ['confirm', 'success', 'failure'] as const;
export const GOV3_CHAINS: readonly Chain3Def[] = Object.freeze([
  { id: 'dbt_file', wave: '3a', kind: 'DECOR', group: 'dbt_export', surface: 'dbt_file', states: ['queued', 'ready'], doing: 'file',
    key: (s: string) => `gov3.chain.file.${s}`, statement: 'gov3.q4' },
  { id: 'dbt_pause', wave: '3a', kind: 'DECOR', group: 'dbt_mutate', surface: 'dbt_pause', states: MUTATE_STATES, doing: 'pause',
    key: (s: string) => `gov3.chain.pause.${s}`, statement: 'gov3.q1' },
  { id: 'dbt_reread', wave: '3a', kind: 'PARITY-DECOR', group: 'dbt_mutate', surface: 'dbt_reread', states: MUTATE_STATES, doing: 'reread',
    key: (s: string) => `gov3.chain.reread.${s}`, statement: 'gov3.q1' },
]);
export function chain3ById(id: Chain3Id): Chain3Def { return GOV3_CHAINS.find((c) => c.id === id) as Chain3Def; }
/** Every gov3 chain returns to the one page that opens it. */
export const DBT_BACK = '/dbt';

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which chain a query opens: `do=file` → the file chain, `do=pause` → the refused pause, `do=reread` → the re-read; anything else → null. */
export function chain3For(searchParams: Params): Chain3Id | null {
  const d = one(searchParams?.do);
  const c = GOV3_CHAINS.find((x) => x.doing === d);
  return c ? c.id : null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain3State(id: Chain3Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain3ById(id).states.includes(v) ? v : null;
}
