// apps/web-gov/src/features/gov3/refusals.ts · PC-56 GOV-3 — WHAT THE BENEFIT PAYMENTS PAGE DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov2/refusals.ts` shape (survey_gov3.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov3 claims guard (test/gov3-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov3.` value.
//
// GOV-3 is GOV-3a → GOV-3b (survey §4; GOV-3 Q1-A, Q2-A and Q4-A applied by the lead under the founder's instructions — 06_GOV.md "GOV-3
// SPLIT"; his to reopen; GOV-3b adds Q3-A and Q5-A, the same way). This registry carries ALL 23 canon files, each decided: GOV-3a its 9,
// GOV-3b its 14 (23 decided, 0 pending — the 4c-7 rule: the pending value is gone from the verdict type).
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
//
// GOV-3b · RETURNS AND MATCHING adds NO route and NO read (E1, E2 — `/dbt` still reads only `gov.overview()`):
//   • W341 (PFMS reconciliation) and W342 (one recon case) — BUILT (honest) as `/dbt`'s section "PFMS": Q5's sentence (the port is a noop —
//     pfms.provider.ts `NoopPfmsProvider`, `providerAvailable: false`, `records: []`; no consumer of `schemes.dbt_recorded` exists, so nothing
//     messages a farmer about a payment); matching, cases, certificate requests and taking a payment back each named ONCE as not done here.
//   • W343 (the bounce desk) — BUILT (honest) as `/dbt`'s section "Returned payments": no row, no count; Q3's sentence (no account, IFSC, bank
//     or PFMS reference, name or village, to anyone, in any role); sending a payment again and contacting a farmer each named ONCE.
//   • Their own addresses (`/dbt/recon`, `/dbt/recon/[id]`, `/dbt/bounces`) have no route and answer not found.
//   • the chains: recon mutate (W3179–W3181) DECOR — "Ask PFMS…" refused BY NAME (Q5-A); bounce mutate (W3211–W3213) DECOR — "Send fix-…"
//     refused BY NAME (Q5-A); pfms export (W3239–W3240) DECOR (Q4-A); pfms mutate (W3241–W3243) PARITY-DECOR — its one link IS a re-read.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov3Surface =
  // GOV-3a · the page and its chains
  | 'dbt' | 'dbt_file' | 'dbt_pause' | 'dbt_reread'
  // GOV-3b · the page's two sections and the four 3b chains
  | 'dbt_pfms' | 'dbt_returns' | 'recon_ask' | 'returns_remind' | 'pfms_file' | 'pfms_reread';
export interface Gov3Refusal { id: string; canon: string; surfaces: readonly Gov3Surface[]; key: string; why: string }

/** The surfaces GOV-3a builds. */
export const SURFACES_3A: readonly Gov3Surface[] = ['dbt', 'dbt_file', 'dbt_pause', 'dbt_reread'];
/** The surfaces GOV-3b builds: `/dbt`'s sections "PFMS" and "Returned payments", and the four 3b chains. */
export const SURFACES_3B: readonly Gov3Surface[] = ['dbt_pfms', 'dbt_returns', 'recon_ask', 'returns_remind', 'pfms_file', 'pfms_reread'];
const CHAINS_3A: readonly Gov3Surface[] = ['dbt_file', 'dbt_pause', 'dbt_reread'];
const WRITE_CHAINS_3A: readonly Gov3Surface[] = ['dbt_file', 'dbt_pause'];
/** Every chain of GOV-3 (the canon's shared chain sentences are the same on all 16 files). */
const CHAINS_ALL: readonly Gov3Surface[] = [...CHAINS_3A, 'recon_ask', 'returns_remind', 'pfms_file', 'pfms_reread'];
const WRITE_CHAINS_ALL: readonly Gov3Surface[] = [...WRITE_CHAINS_3A, 'recon_ask', 'returns_remind', 'pfms_file'];

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
  { id: 'files_out', canon: 'W332 "Export recon (audit-stamped)" · W340 "Download payment file copy" · W344 "Export deck (audit-stamped)" (→ W3167) · W341 "Export recon (audit-stamped)" (→ W3239)', surfaces: ['dbt', 'dbt_file', 'pfms_file'],
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
  { id: 'chain_money_3a', canon: 'W3170 · W3180 · W3212 · W3242 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: CHAINS_ALL,
    key: 'gov3.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_3a', canon: 'W3171 · W3181 · W3213 · W3243 "repeated failures page the [duty person]"', surfaces: CHAINS_ALL,
    key: 'gov3.refusal.chainPaging', why: 'no paging exists' },
  { id: 'chain_record_3a', canon: 'W3169 / W3170 "confirming writes an [record] entry with actor, time and reason" · "View [the record]" · "the [record] has the entry (actor · time · reason · before/after)" · the same on W3179–W3180, W3211–W3212, W3239–W3240', surfaces: WRITE_CHAINS_ALL,
    key: 'gov3.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view' },
  { id: 'chain_file_delivery', canon: 'W3167 / W3168 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged" · the same on W3239 / W3240', surfaces: ['dbt_file', 'pfms_file'],
    key: 'gov3.refusal.chainFile', why: 'Q4-A: no file is queued, made or handed out in this realm (GOV-2 Q4-A: no gov file plane)' },
  { id: 'chain_back_confirm_3a', canon: 'W3171 · W3181 · W3213 "Retry — back to confirm"', surfaces: ['dbt_pause', 'recon_ask', 'returns_remind'],
    key: 'gov3.refusal.chainBackConfirm', why: 'canon defect (survey §1): Back returns to the page that opened it, never a confirm step' },
  { id: 'reread_writes_3a', canon: 'W3169 / W3241 "confirming writes an [record] entry with actor, time and reason" (opened by "Retry" on W332 / W339 / W340 / W344 / W341)', surfaces: ['dbt_reread', 'pfms_reread'],
    key: 'gov3.refusal.rereadWrites', why: 'reading the counts again writes nothing (the overview records no read)' },
  // ══ GOV-3b · W341 / W342 — `/dbt`'s section "PFMS" (Q5-A; Q3-A) ══
  { id: 'pfms_figures', canon: 'W341 tiles "Matched [money] · [n] of [n]" · "Missing [acknowledgements] [money] · [n] lines" · "Mismatched [money] · [n] lines · opened as cases"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsFigures', why: 'MONEY, FALSE: no comparison is run (the port returns no records); Q1-A: no money figure' },
  { id: 'pfms_zero_line', canon: 'W341 "The [total] line — must be zero … If this line ever isn\'t zero … the next [group] will not [be put together] until it is explained"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsZeroLine', why: 'FALSE: nothing is put together, so nothing waits on a line of figures' },
  { id: 'pfms_requery', canon: 'W341 "PFMS re-query at [time]" · "Missing-[acknowledgement] lines re-query automatically; they become exceptions only after [n] silent cycles"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsRequery', why: 'F-5: no schedule asks PFMS anything; the port has no live branch (pfmsProviderFromEnv → noop)' },
  { id: 'pfms_states', canon: 'W341 states "No [matching] lines yet … once this run\'s data arrives" · "Fully [matched] … Close is automatic" · "PFMS feed down — [matching] pauses rather than guesses" · W342 "No case open — Exceptions open cases automatically"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsStates', why: 'Q5-A: PFMS is not connected; no state may say payments match, data is coming or cases open themselves' },
  { id: 'pfms_bank', canon: 'W341 exceptions "[account]-tail mismatch … → [account] ••[n] · credited → [account] ••[n]" · W342 "our record: [account] ••[n] ([small test credit] verified [date])" · "both resolve to the same [identity]-seeded beneficiary per [national] mapper"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsBank', why: 'PII · LEGAL, Q3-A: the platform holds no bank detail for a benefit; none is ever shown, to any role' },
  { id: 'pfms_farmer', canon: 'W342 "Recon case — [application] · … farmer [name], [village]"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsFarmer', why: 'PII, Q3-A (and GOV-2 Q3-A): no farmer\'s name or village reaches this console' },
  { id: 'pfms_guess', canon: 'W342 "Working hypothesis (not a verdict): … the FARMER HAS THE MONEY, our record is what\'s stale … correct our [record of the bank] as a new entry"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsGuess', why: 'FALSE: no case and no farmer bank record exist; nothing is guessed or changed' },
  { id: 'pfms_escalate', canon: 'W342 "wrong beneficiary — … escalation to the [senior officer] SAME DAY" · "unresolved [n] days — auto-escalates"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsEscalate', why: 'FALSE: no escalation and no timer exist' },
  { id: 'pfms_finance', canon: 'W341 state "[Matching] is finance-officer work — Everyone can read the [total] line" · W342 "Finance + supervisor" · "Case actions are finance-restricted"', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsFinance', why: 'no authority finance role exists (0239, 0240: two roles)' },
  { id: 'pfms_paging', canon: 'W341 "Showing [n] of [n] exceptions (this [group])" (FM :125) · filter "[sum] echo differs" (FM :126) · the row link to W342', surfaces: ['dbt_pfms'],
    key: 'gov3.refusal.pfmsPaging', why: 'no difference is listed, so there is nothing to open, page or filter (DECOR)' },
  // ══ GOV-3b · W343 — `/dbt`'s section "Returned payments" (Q2-A, Q3-A, Q5-A) ══
  { id: 'returns_count', canon: 'W343 "[Returns] desk — [n] farmers not yet paid · The desk\'s only [measure] is reaching zero"', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsCount', why: 'Q2-A: nothing is recorded, so a count would be a permanent zero presented as a fact (B1 not built)' },
  { id: 'returns_reasons', canon: 'W343 "By reason — [n] [returned] credits · [money] · [n] fixed & [sent again] this week" · reasons outside the ten codes · every farmer-side fix ([branch] visit, in-app [change of account], "two taps", "we re-map the [bank code] ourselves")', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsReasons', why: 'MONEY · PII, FALSE: no in-app change of bank, no re-mapping, no fix path; no reason is listed (Q3-A)' },
  { id: 'returns_age', canon: 'W343 "Aging — [n] < [n] days · [n] at [n]–[n] days ([message] cadence running) · [n] older than [n] days → [home visit] ordered; [n] are elderly farmers with [inactive] [accounts]"', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsAge', why: 'PII, FALSE: no cadence, no visit order; no farmer\'s age or bank state is shown' },
  { id: 'returns_silence', canon: 'W343 states "No [returned] credits found yet … None have [come back]" · "Zero [returns] — Every credit landed. This desk exists to be empty"', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsSilence', why: 'Q5-A / F-5: nothing is recorded, so silence is not success; the page never claims every payment arrived' },
  { id: 'returns_feed', canon: 'W343 state "Return feed lagging — [return] statuses shown as-of the last bank file" + Retry', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsFeed', why: 'FALSE: no bank file is read anywhere on the platform' },
  { id: 'returns_unmask', canon: 'W343 state "[Account]-detail masking — [account] tails unmask only for the finance role (logged reveal)" (×2)', surfaces: ['dbt_returns'],
    key: 'gov3.refusal.returnsUnmask', why: 'PII, Q3-A: never shown to any role; there is nothing to reveal' },
  // ══ GOV-3b · the 3b chains' own openers — refused BY NAME ══
  { id: 'ask_pfms', canon: 'W342 "Ask PFMS for credit [certificate]" (→ W3179) · W3179–W3181', surfaces: ['recon_ask'],
    key: 'gov3.refusal.askPfms', why: 'Q5-A / F-5: the port has no request method and no live provider; nothing can be sent to PFMS' },
  { id: 'remind_farmers', canon: 'W343 "Send fix-[messages] (this week\'s [n] unfixed)" (→ W3211) · W3211–W3213', surfaces: ['returns_remind'],
    key: 'gov3.refusal.remindFarmers', why: 'Q5-A / F-7: no message path exists (no consumer, no DLT registration); a message about a payment is LEGAL (DLT, consent)' },
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

/** `/dbt`'s GOV-3b sections (W341 and W342 → "PFMS"; W343 → "Returned payments"): their sentence, and each canon feature named ONCE as not done. */
export type Gov3Section = 'pfms' | 'returns';
export const GOV3_SECTIONS: readonly { id: Gov3Section; files: readonly ('W341' | 'W342' | 'W343')[]; surface: Gov3Surface; titleKey: string; statement: string; bodyKey: string | null }[] = Object.freeze([
  { id: 'pfms', files: ['W341', 'W342'], surface: 'dbt_pfms', titleKey: 'gov3.pfms.title', statement: 'gov3.q5', bodyKey: null },
  { id: 'returns', files: ['W343'], surface: 'dbt_returns', titleKey: 'gov3.returns.title', statement: 'gov3.q3', bodyKey: 'gov3.returns.body' },
]);
export const GOV3_NOT_DONE_3B: readonly { id: string; file: 'W341' | 'W342' | 'W343'; section: Gov3Section; canon: string; key: string }[] = Object.freeze([
  { id: 'match', file: 'W341', section: 'pfms', canon: 'W341 "PFMS reconciliation — … Our file vs PFMS acknowledgement, to the rupee. A [matching] that doesn\'t [add up] doesn\'t close"', key: 'gov3.notDone.match' },
  { id: 'case', file: 'W342', section: 'pfms', canon: 'W342 "Recon case — [application] · investigating" · resolution actions "confirmed-received …" · "unresolved [n] days"', key: 'gov3.notDone.case' },
  { id: 'certificate', file: 'W342', section: 'pfms', canon: 'W342 "Ask PFMS for credit [certificate]" · state "[Certificate] request failed … Nothing about the money changed"', key: 'gov3.notDone.certificate' },
  { id: 'take_back', file: 'W342', section: 'pfms', canon: 'W342 "wrong beneficiary — recall via PFMS process"', key: 'gov3.notDone.takeBack' },
  { id: 'resend', file: 'W343', section: 'returns', canon: 'W343 "Every [return] has a named reason, a farmer-side fix, and an automatic re-queue" · W342 "… re-queues"', key: 'gov3.notDone.resend' },
  { id: 'contact', file: 'W343', section: 'returns', canon: 'W343 "SMS + ambassador follow-up" · "the SMS names the branch" · "[home visit] ordered" · W342 "the farmer hears it in their language the same hour"', key: 'gov3.notDone.contact' },
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
  { id: 'sections_3b', canon: 'W341 /dbt/recon · W342 /dbt/recon/[id] · W343 /dbt/bounces', built: 'E1: `/dbt`\'s sections "PFMS" (W341, W342) and "Returned payments" (W343); the three addresses have no route (not found); no row, no count, no read' },
  { id: 'q3_q5', canon: 'W341–W343 account tails, the farmer\'s name and village, PFMS matching, cases, certificate requests, fix messages', built: 'Q3-A and Q5-A (lead-applied): their two sentences printed on /dbt and on the 3b chains; each canon feature named once as not done' },
  { id: 'pfms_reread_address', canon: 'W341 load-error "Retry" → W3241', built: 'the PFMS section reads nothing and cannot fail on its own, so nothing on /dbt opens the pfms re-read; it is reached by address (`?do=pfms_reread&act=`) and its one link IS the re-read of /dbt' },
  { id: 'six_groups', canon: 'brief / survey "5 chain groups"', built: 'the canon\'s own route comments name SIX groups (dbt × export, dbt × mutate, recon × mutate, bounce × mutate, pfms × export, pfms × mutate) over the 16 files; the registry records six' },
]);

/** The verdict values (GOV-3b decided its 14, so the pending value is gone — the 4c-7 rule). */
export type Gov3Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR';
export type Gov3Wave = '3a' | '3b';
/** Every canon file of GOV-3 (23), each with ONE verdict: 3a decided its 9, 3b its 14. */
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
  // ── 3b · RETURNS AND MATCHING (14) — decided (Q3-A, Q5-A lead-applied; Q4-A for the pfms file) ──
  { file: 'W341-gov-pfms-recon.html', wave: '3b', verdict: 'BUILT (honest)', note: '/dbt section "PFMS" — Q5 verbatim; no comparison, figure, line or difference; matching named as not done; /dbt/recon has no route' },
  { file: 'W342-gov-recon-case.html', wave: '3b', verdict: 'BUILT (honest)', note: '/dbt section "PFMS" — no case, no farmer, no bank detail (Q3); cases, certificate requests, taking a payment back named as not done; /dbt/recon/[id] has no route' },
  { file: 'W343-gov-bounce-desk.html', wave: '3b', verdict: 'BUILT (honest)', note: '/dbt section "Returned payments" — no row, no count; Q3 verbatim; sending again and contacting a farmer named as not done; /dbt/bounces has no route' },
  { file: 'W3179-gov-recon-mutate-confirm.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=ask&act=confirm — "Ask PFMS…" refused BY NAME (Q5-A); reached by address only' },
  { file: 'W3180-gov-recon-mutate-success.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=ask&act=success — nothing was asked' },
  { file: 'W3181-gov-recon-mutate-failure.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=ask&act=failure — nothing was sent; Back → /dbt (never a confirm step)' },
  { file: 'W3211-gov-bounce-mutate-confirm.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=remind&act=confirm — "Send fix-…" refused BY NAME (Q5-A); reached by address only' },
  { file: 'W3212-gov-bounce-mutate-success.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=remind&act=success — no farmer was contacted' },
  { file: 'W3213-gov-bounce-mutate-failure.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=remind&act=failure — nothing was sent; Back → /dbt (never a confirm step)' },
  { file: 'W3239-gov-pfms-export-queued.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=pfms_file&act=queued — Q4-A: no file is made; reached by address only' },
  { file: 'W3240-gov-pfms-export-ready.html', wave: '3b', verdict: 'DECOR', note: '/dbt?do=pfms_file&act=ready — Q4-A: no file exists to hand out' },
  { file: 'W3241-gov-pfms-mutate-confirm.html', wave: '3b', verdict: 'PARITY-DECOR', note: '/dbt?do=pfms_reread&act=confirm — the one link IS the re-read of /dbt; PFMS is not asked' },
  { file: 'W3242-gov-pfms-mutate-success.html', wave: '3b', verdict: 'PARITY-DECOR', note: '/dbt?do=pfms_reread&act=success — read again; nothing written' },
  { file: 'W3243-gov-pfms-mutate-failure.html', wave: '3b', verdict: 'PARITY-DECOR', note: '/dbt?do=pfms_reread&act=failure — not read; nothing changed; Back → /dbt' },
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

// ── THE BUILT CHAINS: each is a query state (`?do=…&act=`) of /dbt; Back → /dbt. GOV-3a: the dbt mutate group is built TWICE, by its two
// kinds of opener: the canon's "Pause" (DECOR — refused BY NAME) and the error state's Retry (PARITY-DECOR — a re-read). GOV-3b: the recon
// mutate (DECOR, Q5-A), bounce mutate (DECOR, Q5-A), pfms export (DECOR, Q4-A) and pfms mutate (PARITY-DECOR, a re-read) groups — all six
// groups built, each file in exactly one. ──
export type Chain3Id = 'dbt_file' | 'dbt_pause' | 'dbt_reread' | 'recon_ask' | 'returns_remind' | 'pfms_file' | 'pfms_reread';
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
  { id: 'recon_ask', wave: '3b', kind: 'DECOR', group: 'recon_mutate', surface: 'recon_ask', states: MUTATE_STATES, doing: 'ask',
    key: (s: string) => `gov3.chain.ask.${s}`, statement: 'gov3.q5' },
  { id: 'returns_remind', wave: '3b', kind: 'DECOR', group: 'bounce_mutate', surface: 'returns_remind', states: MUTATE_STATES, doing: 'remind',
    key: (s: string) => `gov3.chain.remind.${s}`, statement: 'gov3.q5' },
  { id: 'pfms_file', wave: '3b', kind: 'DECOR', group: 'pfms_export', surface: 'pfms_file', states: ['queued', 'ready'], doing: 'pfms_file',
    key: (s: string) => `gov3.chain.pfmsFile.${s}`, statement: 'gov3.q4' },
  { id: 'pfms_reread', wave: '3b', kind: 'PARITY-DECOR', group: 'pfms_mutate', surface: 'pfms_reread', states: MUTATE_STATES, doing: 'pfms_reread',
    key: (s: string) => `gov3.chain.pfmsReread.${s}`, statement: 'gov3.q5' },
]);
export function chain3ById(id: Chain3Id): Chain3Def { return GOV3_CHAINS.find((c) => c.id === id) as Chain3Def; }
/** Every gov3 chain returns to the one page that opens it. */
export const DBT_BACK = '/dbt';

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which chain a query opens: `do=file` → the file chain, `do=pause` → the refused pause, `do=reread` → the re-read; GOV-3b: `do=ask` → the
 *  refused PFMS request, `do=remind` → the refused farmer message, `do=pfms_file` → the PFMS file chain, `do=pfms_reread` → its re-read;
 *  anything else → null. */
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
