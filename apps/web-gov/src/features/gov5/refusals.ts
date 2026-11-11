// apps/web-gov/src/features/gov5/refusals.ts · PC-56 GOV-5 — WHAT THE MGNREGA PAGE DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov4/refusals.ts` shape (survey_gov5.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov5 claims guard (test/gov5-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov5.` value.
//
// GOV-5 is HOTFIX-16 → GOV-5a → GOV-5b (survey §4; GOV-5 Q1-A, Q2-A, Q3-A and Q4-A applied by the lead under the founder's instructions —
// 06_GOV.md "GOV-5 SPLIT"; his to reopen). This registry carries ALL 33 canon files: GOV-5a decides its 23; GOV-5b's 10 stay `pending_5b`.
//
// WHAT MGNREGA IS ON THE PLATFORM (survey §1): an organisation's own notes (job-card claims, works, musters, demands — tenant realm, behind
// `labour` + `mgnrega` since HOTFIX-16). The government realm has NOTHING of it (no gov route, no kv_gov grant on any mgnrega_* table) and the
// NREGASoft provider is a placeholder (state-ledger.provider.ts: the noop is the only case). So this console reads nothing about MGNREGA.
//
// GOV-5a · MGNREGA, SAID TRULY builds ONE route (E1), `/mgnrega` ("MGNREGA"):
//   • W345 (the dashboard) — BUILT (honest): it READS NOTHING (E2: the shell's `gov.me()` only). Q3's, Q2's and Q1's sentences and the
//     download sentence; no row, no count, no clock, no card number, no person, no place, no figure.
//   • W346 (job cards), W347 (work demand), W348 (one muster), W440 (the muster list) — BUILT (honest) as the page's section "What this
//     console does not do" (GOV5_NOT_DONE): each canon feature named once, in plain words. Their own addresses (`/mgnrega/dashboard`,
//     `/mgnrega/job-cards`, `/mgnrega/demand`, `/mgnrega/musters`, `/mgnrega/musters/[id]`) have no route and answer not found.
//   • Q4-A's page sentence ("The organisation's MGNREGA records are switched off on this platform.") is NOT printed: the page reads nothing,
//     the gov realm has no flag read, and a flag can be ON for one organisation by its allowlist (flags.service.ts) — the page cannot know it.
//   • the chains (`?do=…&act=`; Back → `/mgnrega`): job export (W3224–W3225) DECOR; job re-read (W3226–W3228) PARITY-DECOR; the sync act
//     (W3233–W3235) DECOR — "Sync now" refused (Q3-A); muster re-read (W3236–W3238) PARITY-DECOR; the demand form (W3275–W3278) DECOR — no
//     demand is recorded here (Q3-A); work re-read (W3279–W3281) PARITY-DECOR. The page reads nothing, so it has no load-error state: the
//     re-read chains are reached by address only, and each one's confirm state has ONE extra link — a re-read of /mgnrega.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov5Surface =
  // GOV-5a · the page and its chains
  | 'mgnrega' | 'job_file' | 'job_reread' | 'sync_act' | 'muster_reread' | 'demand_form' | 'work_reread';
export interface Gov5Refusal { id: string; canon: string; surfaces: readonly Gov5Surface[]; key: string; why: string }

/** The surfaces GOV-5a builds. */
export const SURFACES_5A: readonly Gov5Surface[] = ['mgnrega', 'job_file', 'job_reread', 'sync_act', 'muster_reread', 'demand_form', 'work_reread'];
/** The surfaces GOV-5b builds (none yet: W349 and W350 are pending_5b). */
export const SURFACES_5B: readonly Gov5Surface[] = [];
const REREADS_5A: readonly Gov5Surface[] = ['job_reread', 'muster_reread', 'work_reread'];
const WRITE_CHAINS_5A: readonly Gov5Surface[] = ['sync_act', 'demand_form', 'job_reread', 'muster_reread', 'work_reread'];

export const GOV5_REFUSALS: readonly Gov5Refusal[] = Object.freeze([
  // ══ the console chrome on W345–W348, W440 ══
  { id: 'console_chrome_5a', canon: 'W345–W348, W440 "[initials]" avatar · "Search [cards / works / demands / musters]… ⌘K" · the bell', surfaces: ['mgnrega'],
    key: 'gov5.refusal.consoleChrome', why: 'DECOR (FM filter rows ×5): no search, person picker or bell exists' },
  { id: 'persona', canon: 'W345 "[panchayat] · GOV · [emblem] · [district] · panchayat" · "[programme] convergence · [register] is the record" · the slice\'s own sidebar "Panchayat console" · W347 "[village-level employment assistant] role" · W350 "[headman] + secretary"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.persona', why: 'FALSE: no panchayat body exists (0011 levels central / state / district / body); an authority has two roles, head and officer (0239:25-28); the sidebar is the console\'s own (GOV_NAV)' },
  { id: 'page_switch_5a', canon: 'W345–W348, W440 state "Flagged off — [page] disabled … See plan settings"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.pageSwitch', why: 'E6: no per-page switch exists; gov_console OFF sends the reader to the sign-in page, which says so (lib/session.ts); no plan' },
  // ══ W345 ══
  { id: 'sync_time', canon: 'W345 "Synced [time] today (as-of law)" · "observes, assists and never lets a clock run silently" · W346 "synced register · Mirrored from [register] (last full sync today [time])" · W440 "this mirror is read-only evidence"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noSyncTime', why: 'C-6: no sync exists (the state-ledger provider is a noop); the gov realm observes nothing' },
  { id: 'tiles', canon: 'W345 tiles "Job cards synced [n] · [n] exhausted" · "Persondays this FY [n] · avg [n]" · "Demands on the 15-day clock [n] · [n] overdue — allowance liability" · "Wages awaiting payment [money] · [n] musters"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noCounts', why: 'MONEY · TRUST, FALSE ×4: no gov read (Q2-A); no money figure (Q1-A); "allowance liability" is a statement of what the state owes' },
  { id: 'rates', canon: 'W345 "Deadlines and rates come from the Act and the notified rates table (versioned data with its source notification)" · W348 "rate [money]/day (from the notified rates table …)"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noRates', why: 'FALSE: no MGNREGA rate table exists (0084, 0091); the 15-day rule is a constant in the organisation\'s code' },
  { id: 'area_join', canon: 'W345 states "No [programme] convergence yet — … ask the programme officer; the console explains the enrolment path" · "Panchayat-scoped — This console sees [panchayat] only"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noArea', why: 'FALSE: no enrolment path; an authority has no area or panchayat link (0011:250)' },
  { id: 'ranking', canon: 'GOV-4 Q3-A applied: any order of panchayats, officials or workers by results', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noRanking', why: 'GOV-4 Q3-A (no rank, flag or score); GOV-1 Q1-A (no %, target or rank)' },
  // ══ W346 ══
  { id: 'card_rows', canon: 'W346 rows "[card no.] · [initials] (f) · [n] adults · [n] · [date] ([muster ref])" ×4 · "guarantee exhausted this FY" · "Card numbers masked on screen; full numbers exist only in [register]"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noCardRows', why: 'PII (Q2-A): a household head by initials, gender and size; the organisation\'s records store full card numbers (C-5), so "only in [register]" is false — none is shown here' },
  { id: 'marketplace', canon: 'W346 "households past 100 days route to the platform\'s own farm-labour marketplace (worker profiles carry over; two systems, one worker, no re-registration)"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noMarketplace', why: 'FALSE: mgnrega_job_cards has no link to worker_profiles' },
  { id: 'paging_5a', canon: 'W346 "Showing 1–25 of [n] job cards · Page size · Page 1 of [n]" · W347 "Showing 3 of [n] open demands" · row menus ×7 · filters "[card no.]" ×3, "due [date]" ×2', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noPaging', why: 'no rows are listed, so there is nothing to page or filter (FM :140-142, :145, :150-152 DECOR)' },
  { id: 'files_out_5a', canon: 'W346 "Export (audit-stamped)" (→ W3224)', surfaces: ['mgnrega', 'job_file'],
    key: 'gov5.refusal.noFile', why: 'applied from GOV-2/3/4 Q4-A: no gov file plane; the download sentence is printed' },
  { id: 'empty_means_nothing', canon: 'W346 "No cards synced — The register fills at first district sync" · W347 "No open demands — … The voice line and *123# stay open" · W440 "No musters yet — … within one sync cycle"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.emptyMeansNothing', why: 'FALSE as a claim: nothing is read here, so an empty page is not a state of the programme (the GOV-3 rule)' },
  // ══ W347 ══
  { id: 'channels', canon: 'W347 "Demand can arrive here by voice line, *123#, app or on paper at the office — every channel lands in one register"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noChannels', why: 'FALSE: apps/ivr-ussd-gateway is a placeholder (identity.errors.ts:43); no app calls recordDemand; no channel reaches the gov realm' },
  { id: 'clock', canon: 'W347 "every entry starts a legal clock" · "the clock runs from OUR receipt time (the earlier one), never the sync time" · rows "overdue [n] days … allowance accrues from day 16 (state liability)"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noDeadline', why: 'LEGAL (Q3-A): nothing is recorded on this console, so nothing here starts a deadline; the platform\'s record is not the state\'s' },
  { id: 'household_told', canon: 'W347 "the household is told this in [language], automatically" · "offer drafted — [work] (… the offer letter says so)" · "Dated receipt is issued on every channel"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noMessage', why: 'FALSE: no message, offer object or household receipt exists in any realm' },
  { id: 'forwarding', canon: 'W347 "Demands recorded here forward to [register] on sync" · state "Forwarding backlog — … forwarding retries" · "[delta]: demand/works sync tables"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noForwarding', why: 'C-6: no forward to the state system exists (the provider is a noop)' },
  // ══ W348 / W440 ══
  { id: 'match_chip', canon: 'W348 "Attendance — observed from sync, spot-verifiable on site" · "where the platform\'s geo-fenced dual-confirm attendance exists for the same worker-day, a match chip shows … disagreement opens a query"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noMatch', why: 'FALSE: mgnrega_musters has no link to the farm-labour attendance; no query to the state system exists' },
  { id: 'worksite_facts', canon: 'W348 "Worksite facts — Mate: [initials] (f) · creche + drinking water + shade recorded present · measurement book entry [ref] dated [date], ready for the wage list"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noWorksiteFacts', why: 'PII · LEGAL, FALSE: no facilities, measurement book or wage list exists; a named person (Q2-A)' },
  { id: 'read_forever', canon: 'W348 / W440 "Read for all, edit for none — Musters are [register]\'s to edit; here they are evidence" · "closed musters stay readable forever (social audit depends on it)"', surfaces: ['mgnrega'],
    key: 'gov5.refusal.noMusterKept', why: 'FALSE today: the organisation\'s admin writes musters (C-4); this console keeps none' },
  { id: 'other_pages', canon: 'W348 "Wage list & FTO" (→ W349) · W440 "Social audit view" (→ W350) · W440 row links (→ W348) ×3', surfaces: ['mgnrega'],
    key: 'gov5.refusal.onePage', why: 'E1: one route; the other MGNREGA addresses have no route and answer not found' },
  // ══ the acts refused by name (Q3-A) ══
  { id: 'sync_now', canon: 'W345 "Sync now" (→ W3233) · state "[register] sync failing — Showing the [time] sync … Clocks keep counting locally"', surfaces: ['mgnrega', 'sync_act'],
    key: 'gov5.refusal.noSync', why: 'Q3-A: nothing to sync (the provider is a noop); GBB already refused to draw it' },
  { id: 'record_demand', canon: 'W347 "Record a demand" ×2 (→ W3275) · state "Recording needs the [assistant] role — Anyone at the panchayat can VIEW the register"', surfaces: ['mgnrega', 'demand_form'],
    key: 'gov5.refusal.noDemandForm', why: 'Q3-A: an authority typing a household\'s demand would start a clock on the platform\'s record' },
  // ══ the chains' shared sentences (W3224–W3238, W3275–W3281) — refused BY NAME ══
  { id: 'chain_file_5a', canon: 'W3224 / W3225 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged"', surfaces: ['job_file'],
    key: 'gov5.refusal.chainFile', why: 'no file is queued, made or handed out in this realm (GOV-2 Q4-A)' },
  { id: 'chain_record_5a', canon: 'W3226 / W3233 / W3236 / W3279 "confirming writes an [record] entry with actor, time and reason" · W3227 / W3234 / W3237 / W3277 / W3280 "the [record] has the entry (actor · time · reason · before/after)" · "View [the record]"', surfaces: WRITE_CHAINS_5A,
    key: 'gov5.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view' },
  { id: 'chain_money_5a', canon: 'W3227 / W3234 / W3237 / W3277 / W3280 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: WRITE_CHAINS_5A,
    key: 'gov5.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_5a', canon: 'W3228 / W3235 / W3238 / W3278 / W3281 "repeated failures page the [duty person]" · "Retry — back to confirm"', surfaces: WRITE_CHAINS_5A,
    key: 'gov5.refusal.chainPaging', why: 'no paging exists; Back returns to /mgnrega' },
  { id: 'chain_review_5a', canon: 'W3276 "[two-person]-friendly review step … the diff against current values" · W3275 "values you entered are preserved"', surfaces: ['demand_form'],
    key: 'gov5.refusal.chainReview', why: 'no form exists, so there is nothing to keep, review or compare' },
  { id: 'chain_back_form_5a', canon: 'W3275 "Back to the form" (→ W347) · W3278 "Retry — back to confirm" (→ W347; the form chain has no confirm)', surfaces: ['demand_form'],
    key: 'gov5.refusal.chainBackForm', why: 'canon defect (survey §1, F-10): no form exists; Back returns to the page' },
  { id: 'reread_writes_5a', canon: 'W3226 / W3236 / W3279 "confirming writes an [record] entry" (opened by "Retry")', surfaces: REREADS_5A,
    key: 'gov5.refusal.rereadWrites', why: 'a re-read writes nothing' },
]);
export function gov5RefusalKeys(surface: Gov5Surface): string[] { return GOV5_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** `/mgnrega`'s section "What this console does not do" — W345's acts, W346, W347, W348 and W440 BUILT (honest): each feature named ONCE. */
export const GOV5_NOT_DONE: readonly { id: string; file: 'W345' | 'W346' | 'W347' | 'W348' | 'W440'; canon: string; key: string }[] = Object.freeze([
  { id: 'counts', file: 'W345', canon: 'W345 tiles and "Clocks that must not run out — the Act\'s deadlines, made visible" (demand clock, wage clock, compensation)', key: 'gov5.notDone.counts' },
  { id: 'job_cards', file: 'W346', canon: 'W346 "Job cards — synced register" (rows, "Export", "nothing to create here by hand, ever")', key: 'gov5.notDone.jobCards' },
  { id: 'demand', file: 'W347', canon: 'W347 "Work demand — the 15-day register" (rows, "Record a demand", channels, the clock)', key: 'gov5.notDone.demand' },
  { id: 'muster', file: 'W348', canon: 'W348 "Muster [ref] — [work], [place]" (the attendance grid, wages, totals, the worksite facts)', key: 'gov5.notDone.muster' },
  { id: 'musters', file: 'W440', canon: 'W440 "Muster rolls — [panchayat]" (rows: work, place, dates, workers, days, money, status)', key: 'gov5.notDone.musters' },
]);

/** What was built differently from the canon, and why (DELTAs). */
export const GOV5_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'one_route', canon: 'W345 /mgnrega/dashboard · W346 /mgnrega/job-cards · W347 /mgnrega/demand · W348 /mgnrega/musters/[id] · W440 /mgnrega/musters', built: 'E1: one route, /mgnrega; W346, W347, W348, W440 are its "does not do" section; the other addresses have no route (not found); the GOV-1a 307 for /mgnrega is removed' },
  { id: 'nav_mgnrega', canon: 'the canon gives MGNREGA its own sidebar (W345:24-32); the authority\'s sidebar has no MGNREGA entry', built: 'GOV_NAV gains "MGNREGA" (/mgnrega) so the page\'s sentences are reachable; no MGNREGA sub-menu' },
  { id: 'reads_nothing', canon: 'W345 tiles and clocks, W346 rows, W347 rows, W348 grid, W440 rows', built: 'Q1-A / Q2-A / Q3-A: the page reads nothing (the shell\'s gov.me only); no row, count, clock, card number, person, place or figure' },
  { id: 'q4_not_printed', canon: 'brief Q4-A "The organisation\'s MGNREGA records are switched off on this platform."', built: 'NOT printed: the page reads nothing and the gov realm has no flag read; a flag can be ON for one organisation (its allowlist) — the page cannot know the state, so it does not claim it' },
  { id: 'q1_own_sentence', canon: 'GOV-3\'s money sentence ("…Benefits are paid by PFMS and the banks…")', built: 'not reused: its PFMS clause is about scheme benefits and is not shown true for MGNREGA wages by any code here; Q1\'s own sentence is printed' },
  { id: 'no_retry_opener', canon: 'load-error "Retry" on W345–W348, W440 → the mutate-confirm pages', built: 'the page reads nothing, so it has no load-error state; the re-read chains (PARITY-DECOR) are reached by address; each confirm state\'s one extra link re-reads /mgnrega' },
]);

/** The verdict values (`pending_5b` until GOV-5b decides W349, W350 and their chains — the 4c-7 rule deletes it then). */
export type Gov5Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_5b';
export type Gov5Wave = '5a' | '5b';
/** Every canon file of GOV-5 (33), each with ONE verdict: 5a decides its 23; 5b's 10 are pending. */
export const GOV5_CANON_FILES: readonly { file: string; wave: Gov5Wave; verdict: Gov5Verdict; note: string }[] = Object.freeze([
  // ── 5a · MGNREGA, SAID TRULY (23) — decided (Q1-A, Q2-A, Q3-A lead-applied; Q4-A's sentence not printed) ──
  { file: 'W345-gov-mgnrega-dashboard.html', wave: '5a', verdict: 'BUILT (honest)', note: '/mgnrega — reads nothing; Q3, Q2, Q1 and the download sentence verbatim; no row, count, clock, card, person, place or figure' },
  { file: 'W346-gov-job-cards.html', wave: '5a', verdict: 'BUILT (honest)', note: '/mgnrega "What this console does not do" (gov5.notDone.jobCards); /mgnrega/job-cards has no route' },
  { file: 'W347-gov-work-demand.html', wave: '5a', verdict: 'BUILT (honest)', note: '/mgnrega "What this console does not do" (gov5.notDone.demand) and Q3\'s sentence; /mgnrega/demand has no route' },
  { file: 'W348-gov-muster-roll.html', wave: '5a', verdict: 'BUILT (honest)', note: '/mgnrega "What this console does not do" (gov5.notDone.muster); /mgnrega/musters/[id] has no route' },
  { file: 'W440-gov-musters.html', wave: '5a', verdict: 'BUILT (honest)', note: '/mgnrega "What this console does not do" (gov5.notDone.musters); /mgnrega/musters has no route' },
  { file: 'W3224-gov-job-export-queued.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=job-file&act=queued — no file is made; reached by address only' },
  { file: 'W3225-gov-job-export-ready.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=job-file&act=ready — no file exists to hand out' },
  { file: 'W3226-gov-job-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=job-reread&act=confirm — the one extra link IS a re-read of /mgnrega' },
  { file: 'W3227-gov-job-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=job-reread&act=success — nothing changed' },
  { file: 'W3228-gov-job-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=job-reread&act=failure — nothing changed; Back → /mgnrega' },
  { file: 'W3233-gov-mgnrega-mutate-confirm.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=sync&act=confirm — "Sync now" refused BY NAME (Q3-A)' },
  { file: 'W3234-gov-mgnrega-mutate-success.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=sync&act=success — nothing was brought in' },
  { file: 'W3235-gov-mgnrega-mutate-failure.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=sync&act=failure — nothing was sent; Back → /mgnrega' },
  { file: 'W3236-gov-muster-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=muster-reread&act=confirm — the one extra link IS a re-read of /mgnrega' },
  { file: 'W3237-gov-muster-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=muster-reread&act=success — nothing changed' },
  { file: 'W3238-gov-muster-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=muster-reread&act=failure — nothing changed; Back → /mgnrega' },
  { file: 'W3275-gov-work-form-form-error.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=demand&act=form-error — no form exists (Q3-A)' },
  { file: 'W3276-gov-work-form-review.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=demand&act=review — nothing to review' },
  { file: 'W3277-gov-work-form-success.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=demand&act=success — no demand was recorded' },
  { file: 'W3278-gov-work-form-failure.html', wave: '5a', verdict: 'DECOR', note: '/mgnrega?do=demand&act=failure — nothing was sent' },
  { file: 'W3279-gov-work-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=work-reread&act=confirm — the one extra link IS a re-read of /mgnrega' },
  { file: 'W3280-gov-work-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=work-reread&act=success — nothing changed' },
  { file: 'W3281-gov-work-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/mgnrega?do=work-reread&act=failure — nothing changed; Back → /mgnrega' },
  // ── 5b · WAGES AND THE WALL (10) — pending (Q1's wage section, Q5) ──
  { file: 'W349-gov-wage-tracking.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W350-gov-social-audit.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3267-gov-social-mutate-confirm.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3268-gov-social-mutate-success.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3269-gov-social-mutate-failure.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3270-gov-wage-export-queued.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3271-gov-wage-export-ready.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3272-gov-wage-mutate-confirm.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3273-gov-wage-mutate-success.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
  { file: 'W3274-gov-wage-mutate-failure.html', wave: '5b', verdict: 'pending_5b', note: 'GOV-5b' },
]);

/** The canon chain groups (survey §1H–§1R; the canon's route comments "B2 shared chain: <m> × chain-<x>"), 26 files, each exactly once. */
export const GOV5_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov5Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'job_export', donor: 'W346', wave: '5a', files: ['W3224', 'W3225'] },
  { id: 'job_mutate', donor: 'W346', wave: '5a', files: ['W3226', 'W3227', 'W3228'] },
  { id: 'mgnrega_mutate', donor: 'W345', wave: '5a', files: ['W3233', 'W3234', 'W3235'] },
  { id: 'muster_mutate', donor: 'W348', wave: '5a', files: ['W3236', 'W3237', 'W3238'] },
  { id: 'work_form', donor: 'W347', wave: '5a', files: ['W3275', 'W3276', 'W3277', 'W3278'] },
  { id: 'work_mutate', donor: 'W347', wave: '5a', files: ['W3279', 'W3280', 'W3281'] },
  { id: 'social_mutate', donor: 'W350', wave: '5b', files: ['W3267', 'W3268', 'W3269'] },
  { id: 'wage_export', donor: 'W349', wave: '5b', files: ['W3270', 'W3271'] },
  { id: 'wage_mutate', donor: 'W349', wave: '5b', files: ['W3272', 'W3273', 'W3274'] },
]);

/** Every gov5 chain returns to the one page that opens it. */
export const MGNREGA_BACK = '/mgnrega';

// ── THE BUILT CHAINS: each is a query state (`?do=…&act=`) of /mgnrega (Back → /mgnrega). ──
export type Chain5Id = 'job_file' | 'job_reread' | 'sync_act' | 'muster_reread' | 'demand_form' | 'work_reread';
export interface Chain5Def {
  id: Chain5Id; wave: Gov5Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov5Surface; states: readonly string[];
  back: string; doing: string; key: (state: string) => string; statement: string;
}
export const GOV5_CHAINS: readonly Chain5Def[] = Object.freeze([
  { id: 'job_file', wave: '5a', kind: 'DECOR', group: 'job_export', surface: 'job_file', states: ['queued', 'ready'], back: MGNREGA_BACK, doing: 'job-file',
    key: (s: string) => `gov5.chain.jobFile.${s}`, statement: 'gov5.download' },
  { id: 'job_reread', wave: '5a', kind: 'PARITY-DECOR', group: 'job_mutate', surface: 'job_reread', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'job-reread',
    key: (s: string) => `gov5.chain.jobReread.${s}`, statement: 'gov5.q2' },
  { id: 'sync_act', wave: '5a', kind: 'DECOR', group: 'mgnrega_mutate', surface: 'sync_act', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'sync',
    key: (s: string) => `gov5.chain.sync.${s}`, statement: 'gov5.q3' },
  { id: 'muster_reread', wave: '5a', kind: 'PARITY-DECOR', group: 'muster_mutate', surface: 'muster_reread', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'muster-reread',
    key: (s: string) => `gov5.chain.musterReread.${s}`, statement: 'gov5.q2' },
  { id: 'demand_form', wave: '5a', kind: 'DECOR', group: 'work_form', surface: 'demand_form', states: ['form-error', 'review', 'success', 'failure'], back: MGNREGA_BACK, doing: 'demand',
    key: (s: string) => `gov5.chain.demand.${s}`, statement: 'gov5.q3' },
  { id: 'work_reread', wave: '5a', kind: 'PARITY-DECOR', group: 'work_mutate', surface: 'work_reread', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'work-reread',
    key: (s: string) => `gov5.chain.workReread.${s}`, statement: 'gov5.q3' },
]);
export function chain5ById(id: Chain5Id): Chain5Def { return GOV5_CHAINS.find((c) => c.id === id) as Chain5Def; }

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which chain a query opens on /mgnrega: `do=job-file` / `job-reread` / `sync` / `muster-reread` / `demand` / `work-reread`; anything else → null. */
export function chain5For(searchParams: Params): Chain5Id | null {
  const d = one(searchParams?.do);
  const c = GOV5_CHAINS.find((x) => x.doing === d);
  return c ? c.id : null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain5State(id: Chain5Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain5ById(id).states.includes(v) ? v : null;
}
