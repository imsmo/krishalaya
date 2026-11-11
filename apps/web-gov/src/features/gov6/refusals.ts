// apps/web-gov/src/features/gov6/refusals.ts · PC-56 GOV-6 — WHAT THIS CONSOLE COUNTS, AND WHAT IT DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov5/refusals.ts` shape (survey_gov6.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov6 claims guard (test/gov6-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov6.` value.
//
// GOV-6 is GOV-6a → GOV-6b (survey §4; GOV-6 Q1-A, Q4-A and Q5-A applied by the lead under the founder's instructions — 06_GOV.md "GOV-6
// SPLIT"; his to reopen). This registry carries ALL 35 canon files: GOV-6a decides its 16; GOV-6b's 19 stay `pending_6b`.
//
// WHAT THE GOVERNMENT REALM COUNTS (survey §1): ONE aggregate — `GET /v1/gov/overview` — the number of applications to each scheme the
// authority runs IN EACH STATUS NOW, all time, drafts not counted, with the oldest wait in the two queues only a person clears; the server's
// time. kv_gov reads no caste, gender, landholding, district, reason code or eligibility result (0239:353). There is no report, schedule,
// recipient, file or publish act in the gov realm (GC :147), and no rupee figure (GOV-2 Q1-A; no grant on dbt_transfers).
//
// GOV-6a · WHAT THIS CONSOLE COUNTS adds NO route (E1); `/dashboard` (W325, GOV-1b) gains two sections (GOV6_SECTIONS_6A):
//   • W333 (Scheme analytics) — BUILT (honest) as the section "Analytics": Q1's sentence; in words, that each count above is of applications
//     in that state NOW (F-5: the canon's cumulative funnel is never computed) and that the server counts afresh each time; "What this
//     console does not count" (steps over time, typical waits, rejection reasons — caste, gender, landholding, district and ranking are Q1's);
//     Q5's sentence. It READS NOTHING beyond what /dashboard already reads, and is GIVEN nothing: it prints no number at all.
//   • W357 (Reports library) — BUILT (honest) as the section "Reports": Q4's sentence; schedules and recipients, the office pack, the village
//     wall (GOV-5 Q5-A), the information-request extract and the late-wage register (GOV-5 Q1-A) named once as not done here.
//   • Their canon addresses (`/analytics`, `/reports`) have no route and answer not found.
//   • the chains (`?do=…&act=` on /dashboard; Back → `/dashboard`): analytics export (W3201–W3202, `do=analytics-file`) DECOR; analytics
//     mutate (W3203–W3205, `do=analytics-reread`) PARITY-DECOR; report export (W3253–W3254, `do=report-file`) DECOR; report form
//     (W3255–W3258, `do=report-form`) DECOR — "New report" refused (Q4-A); report mutate (W3259–W3261, `do=report-reread`) PARITY-DECOR.
//     The sections read nothing, so the dashboard's own load-error Retry stays GOV-1b's re-read; these re-read chains are reached by
//     address only, and each one's confirm state has ONE extra link — a re-read of /dashboard.
//
// GOV-6b · THE RECORD AND OUTSIDE BODIES (W334, W351–W354 and their chains) — pending; it adds its surfaces and chains to this file.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov6Surface =
  // GOV-6a · the two /dashboard sections and their chains
  | 'analytics' | 'reports' | 'analytics_file' | 'analytics_reread' | 'report_file' | 'report_form' | 'report_reread';
export interface Gov6Refusal { id: string; canon: string; surfaces: readonly Gov6Surface[]; key: string; why: string }

/** The surfaces GOV-6a builds: the sections "Analytics" (W333) and "Reports" (W357) of /dashboard, and their five chains. */
export const SURFACES_6A: readonly Gov6Surface[] = ['analytics', 'reports', 'analytics_file', 'analytics_reread', 'report_file', 'report_form', 'report_reread'];
/** The surfaces GOV-6b builds (none yet: W334 and W351–W354 are pending_6b). */
export const SURFACES_6B: readonly Gov6Surface[] = [];
const REREADS_6A: readonly Gov6Surface[] = ['analytics_reread', 'report_reread'];
const WRITE_CHAINS_6A: readonly Gov6Surface[] = ['report_form', 'analytics_reread', 'report_reread'];

export const GOV6_REFUSALS: readonly Gov6Refusal[] = Object.freeze([
  // ══ the console chrome on W333 and W357 (printed once, in "Analytics") ══
  { id: 'console_chrome_6a', canon: 'W333 / W357 "[initials]" avatar · "Search [metrics / reports]… ⌘K" · the bell · W333 the sidebar\'s "[insight]" group', surfaces: ['analytics'],
    key: 'gov6.refusal.consoleChrome', why: 'DECOR (FM filter rows :89, :182): no search, person picker or bell exists; E1: no GOV_NAV change' },
  { id: 'page_switch_6a', canon: 'W333 / W357 state "Flagged off — [page] disabled … See plan settings"', surfaces: ['analytics'],
    key: 'gov6.refusal.pageSwitch', why: 'E6: no per-section switch; the console\'s own switch (gov_console) is the dashboard\'s "off" state; no plan' },
  // ══ W333 (the section "Analytics", Q1-A / Q5-A) ══
  { id: 'funnel', canon: 'W333 "The funnel — [n] applications · submitted · decided [n] · approved [n] · disbursed (inst. [n]) [n]" · "Scheme performance — [scheme] [window]"', surfaces: ['analytics'],
    key: 'gov6.refusal.noFunnel', why: 'F-5 / E4: the server counts status NOW, all time; "decided" would be a client sum; no instalment exists; no window' },
  { id: 'pay_gap', canon: 'W333 "The approved→disbursed gap ([n]) is the [payment system] pipeline, median [n] days"', surfaces: ['analytics'],
    key: 'gov6.refusal.noPayGap', why: 'MONEY, FALSE (Q5-A): the payment system is not connected (GOV-3 Q5-A); no payment timing is held' },
  { id: 'waits', canon: 'W333 "median [n] days of farmer time per round" (clarification)', surfaces: ['analytics'],
    key: 'gov6.refusal.noRounds', why: 'FALSE: the server gives the OLDEST wait in each queue (already printed), never a typical wait or rounds' },
  { id: 'rejection_mix', canon: 'W333 "[n] rejected · [n] ([share]) fixable — [reason] [n] · [reason] [n] … · [n] terminal — [reason] [n] …"', surfaces: ['analytics'],
    key: 'gov6.refusal.noRejectionMix', why: 'Q1-A: kv_gov has no grant on rejection_reason_code (0239:353); the platform\'s own split calls "duplicate" fixable, the canon terminal (F-11)' },
  { id: 'rules_change', canon: 'W333 "v[n] removes the [document]…"', surfaces: ['analytics'],
    key: 'gov6.refusal.noRulesChange', why: 'FALSE here: schemes are written by the platform\'s team (GOV-2 Q5-A)' },
  { id: 'reach', canon: 'W333 "[size class]: [share] of approvals ([forecast] predicted [share])" · "[category tier]: [share] of approvals vs [share] of eligible — concentrated in [places]" · "[group] applicants: [share] — up from [share] ([assisted] flow drives most of it)"', surfaces: ['analytics'],
    key: 'gov6.refusal.noReach', why: 'PII · TRUST, FALSE (Q1-A): no landholding, caste, gender or district column on the axis; eligibility_check never granted; the forecast is the platform registry\'s' },
  { id: 'camp', canon: 'W333 "the [place] camp calendar is already seeded from this card"', surfaces: ['analytics'],
    key: 'gov6.refusal.noCamp', why: 'FALSE: no camp or calendar exists' },
  { id: 'place_table', canon: 'W333 table "top [n] of [n] by volume": [place] · [n] · [share] · [n] d … · "slow + reach gap — support visit planned" · "A slow [area] gets help before it gets a memo — the flag opens a support plan, not a show-cause notice."', surfaces: ['analytics'],
    key: 'gov6.refusal.noPlaceTable', why: 'TRUST, FALSE (Q1-A; GOV-1 Q1-A; GOV-4 Q3-A): no place on the axis; no share, typical time, rank, flag, plan or notice' },
  { id: 'analytics_file', canon: 'W333 "Export deck ([stamped])" (→ W3201)', surfaces: ['analytics', 'analytics_file'],
    key: 'gov6.refusal.noDeck', why: 'Q4-A (from GOV-2/3/4 Q4-A): no gov file plane' },
  { id: 'snapshot', canon: 'W333 state "Couldn\'t compute — Yesterday\'s computed [copy] is shown with its date ([as-of] law)" + Retry (→ W3203)', surfaces: ['analytics'],
    key: 'gov6.refusal.noOldCopy', why: 'FALSE: the overview is computed live (computedAt); on failure the dashboard shows no count (GOV-1b error state)' },
  { id: 'drill', canon: 'W333 state "Aggregate-only role — … drilling to named applications needs the officer role — analytics never becomes a [watching] side-door"', surfaces: ['analytics'],
    key: 'gov6.refusal.noDrill', why: 'aggregate-only TRUE of the overview; the role clause FALSE — no count opens a list, and head and officer read the same' },
  // ══ W357 (the section "Reports", Q4-A) ══
  { id: 'library', canon: 'W357 "Reports — the library, not a jungle · Every report is [stamped] (who ran it, when, over what as-of data), reproducible, and speaks the recipient\'s language — a [office] pack in [language], the same pack\'s village annexure in [language]."', surfaces: ['reports'],
    key: 'gov6.refusal.noLibrary', why: 'FALSE: no report object exists in the gov realm (GC :147)' },
  { id: 'new_report', canon: 'W357 "New report" ×2 (→ W3255) · state "No reports configured — Start from a template — the [office] monthly and the public [wall] come pre-built"', surfaces: ['reports', 'report_form'],
    key: 'gov6.refusal.noNewReport', why: 'Q4-A: configuring a report sent on a timetable to an office is a publish act' },
  { id: 'office_pack', canon: 'W357 row "[office] monthly — scheme portfolio · [steps], [transfer] totals, pendency, appeals — the W333 numbers, [signed] · [day], [time] · [office] · [date] · [hash]" + its menu (→ W3253)', surfaces: ['reports', 'report_file'],
    key: 'gov6.refusal.noOfficePack', why: 'MONEY, FALSE: the steps (E4), transfer totals (GOV-3 Q1-A), signing (no key, 0181:54), a timetable and a recipient (none)' },
  { id: 'wall_file', canon: 'W357 row "[programme] public [wall] ([size] print file) · [language word] · auto-composed, [two-person] publish · monthly + on demand · [village boards]" + its menu', surfaces: ['reports'],
    key: 'gov6.refusal.noWallFile', why: 'FALSE — already refused (GOV-5 Q5-A)' },
  { id: 'request_extract', canon: 'W357 row "[information-request] response extract · parameterised; reproducible byte-[identical] ([W334] rule) · on demand · [information officer] desk" + its menu', surfaces: ['reports'],
    key: 'gov6.refusal.noRequestExtract', why: 'FALSE: no information-request path, no signing, no byte-level hash' },
  { id: 'late_register', canon: 'W357 row "[late-pay] register · every late wage + its computed [late pay] … · weekly · [officer] · public [wall] annexure" + its menu', surfaces: ['reports'],
    key: 'gov6.refusal.noLateRegister', why: 'MONEY, FALSE — already refused (GOV-5 Q1-A)' },
  { id: 'report_paging', canon: 'W357 "Showing 1–4 of [n] configured reports ([n] drawn in canon) · Page size · Page 1 of 1" · row menus ×3', surfaces: ['reports'],
    key: 'gov6.refusal.noReportRows', why: 'no rows (FM :183, :187, :189 DECOR)' },
  { id: 'paged', canon: 'W357 "A scheduled report that fails to compose pages a human the same morning — … should never learn at [time] that software shrugged."', surfaces: ['reports'],
    key: 'gov6.refusal.noTimetable', why: 'FALSE: no timetable and no paging exist' },
  { id: 'reports_role', canon: 'W357 state "Configuring needs the reports role — Reading finished reports follows each report\'s own audience — a public-[wall] [file] is public by definition."', surfaces: ['reports'],
    key: 'gov6.refusal.noReportsRole', why: 'FALSE: an authority has two roles, head and officer (0239:25-27)' },
  { id: 'old_edition', canon: 'W357 state "Compose failed — Yesterday\'s [signed] edition remains valid and downloadable; the failure already paged the [duty person]" + Retry (→ W3259)', surfaces: ['reports'],
    key: 'gov6.refusal.noOldEdition', why: 'FALSE: no edition exists; nothing is signed or downloadable' },
  // ══ the chains' shared sentences (W3201–W3205, W3253–W3261) — refused BY NAME ══
  { id: 'chain_file_6a', canon: 'W3201 / W3202 / W3253 / W3254 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged" · W3253 announced as "[programme] public [wall]" (C-6)', surfaces: ['analytics_file', 'report_file'],
    key: 'gov6.refusal.chainFile', why: 'no file is queued, made or handed out in this realm (Q4-A)' },
  { id: 'chain_record_6a', canon: 'W3203 / W3259 "confirming writes an [record] entry with actor, time and reason" · W3204 / W3257 / W3260 "the [record] has the entry (actor · time · reason · before/after)" · "View [the record]"', surfaces: WRITE_CHAINS_6A,
    key: 'gov6.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view (who reads the record is GOV-6b\'s Q2)' },
  { id: 'chain_money_6a', canon: 'W3204 / W3257 / W3260 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: WRITE_CHAINS_6A,
    key: 'gov6.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_6a', canon: 'W3205 / W3258 / W3261 "repeated failures page the [duty person]" · "Retry — back to confirm"', surfaces: WRITE_CHAINS_6A,
    key: 'gov6.refusal.chainPaging', why: 'no paging exists; Back returns to /dashboard' },
  { id: 'chain_review_6a', canon: 'W3256 "[two-person]-friendly review step … the diff against current values" · W3255 "values you entered are preserved"', surfaces: ['report_form'],
    key: 'gov6.refusal.chainReview', why: 'no form exists, so there is nothing to keep, review or compare' },
  { id: 'chain_back_form_6a', canon: 'W3255 "Back to the form" (→ W357) · W3258 "Retry — back to confirm" (→ W357; the form chain has no confirm)', surfaces: ['report_form'],
    key: 'gov6.refusal.chainBackForm', why: 'canon defect (survey §1, F-10): no form exists; Back returns to the page' },
  { id: 'reread_writes_6a', canon: 'W3203 / W3259 "confirming writes an [record] entry" (opened by "Retry")', surfaces: REREADS_6A,
    key: 'gov6.refusal.rereadWrites', why: 'a re-read writes nothing' },
]);
export function gov6RefusalKeys(surface: Gov6Surface): string[] { return GOV6_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** GOV-6a · `/dashboard`'s two sections — W333 "Analytics" (Q1-A, Q5-A) and W357 "Reports" (Q4-A). Each prints its title, its statement,
 *  its facts (said in words — never a number), its list of what is not counted / not done (each named ONCE), its closing statement (if any)
 *  and its own refusals (surface). */
export interface Gov6Section {
  id: 'analytics' | 'reports'; file: 'W333' | 'W357'; surface: Gov6Surface; title: string; statement: string; facts: readonly string[];
  listTitle: string; items: readonly { id: string; canon: string; key: string }[]; closing: string | null;
}
export const GOV6_SECTIONS_6A: readonly Gov6Section[] = Object.freeze([
  { id: 'analytics', file: 'W333', surface: 'analytics', title: 'gov6.analytics.title', statement: 'gov6.q1',
    facts: ['gov6.analytics.now', 'gov6.analytics.live'],
    listTitle: 'gov6.notCounted.title', items: [
      { id: 'steps', canon: 'W333 "The funnel — … submitted · decided · approved · disbursed"', key: 'gov6.notCounted.steps' },
      { id: 'waits', canon: 'W333 "median [n] days of farmer time per round" · the district table\'s "median decision"', key: 'gov6.notCounted.waits' },
      { id: 'reasons', canon: 'W333 "[n] rejected · … fixable — [reasons] · … terminal — [reasons]"', key: 'gov6.notCounted.reasons' },
    ], closing: 'gov6.q5' },
  { id: 'reports', file: 'W357', surface: 'reports', title: 'gov6.reports.title', statement: 'gov6.q4', facts: [],
    listTitle: 'gov6.notDone.title', items: [
      { id: 'timetable', canon: 'W357 "1st of month, [time]" · "weekly, [day] [time]" · "monthly + on demand" · the recipients', key: 'gov6.notDone.timetable' },
      { id: 'office_pack', canon: 'W357 "[office] monthly — scheme portfolio"', key: 'gov6.notDone.officePack' },
      { id: 'village_wall', canon: 'W357 "[programme] public [wall] ([size] print file)" (GOV-5 Q5-A)', key: 'gov6.notDone.villageWall' },
      { id: 'information_request', canon: 'W357 "[information-request] response extract"', key: 'gov6.notDone.informationRequest' },
      { id: 'late_wages', canon: 'W357 "[late-pay] register" (GOV-5 Q1-A)', key: 'gov6.notDone.lateWages' },
    ], closing: null },
]);

/** What was built differently from the canon, and why (DELTAs). */
export const GOV6_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'two_sections', canon: 'W333 /analytics · W357 /reports (each its own page; W333 in the sidebar\'s "[insight]" group, W357 in no sidebar)', built: 'E1: no route and no GOV_NAV change; the sections "Analytics" and "Reports" of /dashboard (W325\'s page, which already prints the overview); /analytics and /reports answer not found' },
  { id: 'given_nothing', canon: 'W333 tiles, the funnel, the reach cards, the place table · W357 rows', built: 'the sections take only the translator: they are given no count, so they can sum, relabel or derive none (F-5, E4); the counts stay GOV-1b\'s, printed as the server gave them' },
  { id: 'now_in_words', canon: 'W333 the cumulative funnel ("decided", "approved", "disbursed (inst. 1)")', built: 'F-5: said in words — each count above is of applications in that state now, all time; one marked disbursed is no longer counted as approved; no funnel, sum, share, typical time or window is computed' },
  { id: 'no_relabel', canon: 'survey E4 "each status printed with the server\'s status name and now"', built: 'GOV-1b\'s status labels are NOT changed (brief D: never relabel); the "now" is said once, in the Analytics section' },
  { id: 'review_meeting', canon: 'W333 "Numbers a review meeting can act on: where applications die, who the scheme is missing, which rejections were fixable."', built: 'FALSE in each clause; Q1\'s sentence is printed instead' },
  { id: 'honest_empty', canon: 'W333 state "No data yet — Analytics fill as applications arrive … honestly empty"', built: 'TRUE in shape: the overview gives zeros per scheme; GOV-1b\'s "no application yet" and "no scheme yet" already say so' },
  { id: 'no_retry_opener_6a', canon: 'W333 "Couldn\'t compute … Retry" (→ W3203) · W357 "Compose failed … Retry" (→ W3259)', built: 'the sections read nothing, so they have no load-error state of their own; the dashboard\'s Retry stays GOV-1b\'s re-read; the analytics and report re-read chains are reached by address; each confirm state\'s one extra link re-reads /dashboard' },
  { id: 'export_row', canon: 'FM :184 / W3253:45 announce the report export as "[programme] public [wall]"; the canon\'s link is the "[office] monthly" row\'s menu (W357:55)', built: 'C-6: the report export chain is DECOR whichever row opens it; no row exists' },
  { id: 'analytics_link', canon: 'W325 "Full analytics" (→ W333) — GOV-1b refused it "not built yet"', built: 'GOV-6a: the GOV-1b refusal (gov1.refusal.dashAnalytics) now says there is no separate analytics page and points to the section on this page' },
]);

/** The verdict values (`pending_6b` until GOV-6b decides W334, W351–W354 and their chains — the 4c-7 rule deletes it then). */
export type Gov6Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_6b';
export type Gov6Wave = '6a' | '6b';
/** Every canon file of GOV-6 (35), each with ONE verdict: 6a decides its 16; 6b's 19 are pending. */
export const GOV6_CANON_FILES: readonly { file: string; wave: Gov6Wave; verdict: Gov6Verdict; note: string }[] = Object.freeze([
  // ── 6a · WHAT THIS CONSOLE COUNTS (16) — decided (Q1-A, Q4-A, Q5-A lead-applied) ──
  { file: 'W333-gov-analytics.html', wave: '6a', verdict: 'BUILT (honest)', note: '/dashboard section "Analytics" — Q1\'s and Q5\'s sentences; "now" in words; steps over time, typical waits and rejection reasons named once as not counted; no number; /analytics has no route' },
  { file: 'W357-gov-reports.html', wave: '6a', verdict: 'BUILT (honest)', note: '/dashboard section "Reports" — Q4\'s sentence; timetables and recipients, the office pack, the village wall, the information-request extract and the late-wage register named once as not done; /reports has no route' },
  { file: 'W3201-gov-analytics-export-queued.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=analytics-file&act=queued — no file is made; reached by address only' },
  { file: 'W3202-gov-analytics-export-ready.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=analytics-file&act=ready — no file exists to hand out' },
  { file: 'W3203-gov-analytics-mutate-confirm.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=analytics-reread&act=confirm — the one extra link IS a re-read of /dashboard' },
  { file: 'W3204-gov-analytics-mutate-success.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=analytics-reread&act=success — nothing changed' },
  { file: 'W3205-gov-analytics-mutate-failure.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=analytics-reread&act=failure — nothing changed; Back → /dashboard' },
  { file: 'W3253-gov-report-export-queued.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-file&act=queued — no file is made' },
  { file: 'W3254-gov-report-export-ready.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-file&act=ready — no report file exists' },
  { file: 'W3255-gov-report-form-form-error.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-form&act=form-error — "New report" refused BY NAME (Q4-A); no form exists' },
  { file: 'W3256-gov-report-form-review.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-form&act=review — nothing to review' },
  { file: 'W3257-gov-report-form-success.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-form&act=success — no report was set up or sent' },
  { file: 'W3258-gov-report-form-failure.html', wave: '6a', verdict: 'DECOR', note: '/dashboard?do=report-form&act=failure — nothing was sent' },
  { file: 'W3259-gov-report-mutate-confirm.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=report-reread&act=confirm — the one extra link IS a re-read of /dashboard' },
  { file: 'W3260-gov-report-mutate-success.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=report-reread&act=success — nothing changed' },
  { file: 'W3261-gov-report-mutate-failure.html', wave: '6a', verdict: 'PARITY-DECOR', note: '/dashboard?do=report-reread&act=failure — nothing changed; Back → /dashboard' },
  // ── 6b · THE RECORD AND OUTSIDE BODIES (19) — pending (Q2, Q3, Q4) ──
  { file: 'W334-gov-audit.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W351-gov-regulator-home.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W352-gov-regulator-lending.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W353-gov-regulator-insurance.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W354-gov-regulator-exports.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3206-gov-audit-export-queued.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3207-gov-audit-export-ready.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3208-gov-audit-mutate-confirm.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3209-gov-audit-mutate-success.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3210-gov-audit-mutate-failure.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3244-gov-regulator-export-queued.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3245-gov-regulator-export-ready.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3246-gov-regulator-form-form-error.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3247-gov-regulator-form-review.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3248-gov-regulator-form-success.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3249-gov-regulator-form-failure.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3250-gov-regulator-mutate-confirm.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3251-gov-regulator-mutate-success.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
  { file: 'W3252-gov-regulator-mutate-failure.html', wave: '6b', verdict: 'pending_6b', note: 'GOV-6b' },
]);

/** The canon chain groups (survey §1H–§1S; the canon's route comments "B2 shared chain: <m> × chain-<x>"), 28 files, each exactly once. */
export const GOV6_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov6Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'analytics_export', donor: 'W333', wave: '6a', files: ['W3201', 'W3202'] },
  { id: 'analytics_mutate', donor: 'W333', wave: '6a', files: ['W3203', 'W3204', 'W3205'] },
  { id: 'report_export', donor: 'W357', wave: '6a', files: ['W3253', 'W3254'] },
  { id: 'report_form', donor: 'W357', wave: '6a', files: ['W3255', 'W3256', 'W3257', 'W3258'] },
  { id: 'report_mutate', donor: 'W357', wave: '6a', files: ['W3259', 'W3260', 'W3261'] },
  { id: 'audit_export', donor: 'W334', wave: '6b', files: ['W3206', 'W3207'] },
  { id: 'audit_mutate', donor: 'W334', wave: '6b', files: ['W3208', 'W3209', 'W3210'] },
  { id: 'regulator_export', donor: 'W354', wave: '6b', files: ['W3244', 'W3245'] },
  { id: 'regulator_form', donor: 'W354', wave: '6b', files: ['W3246', 'W3247', 'W3248', 'W3249'] },
  { id: 'regulator_mutate', donor: 'W351', wave: '6b', files: ['W3250', 'W3251', 'W3252'] },
]);

/** Every gov6a chain returns to the one page that opens it. */
export const DASHBOARD_BACK = '/dashboard';

// ── THE BUILT CHAINS: each is a query state (`?do=…&act=`) of /dashboard (Back → /dashboard). ──
export type Chain6Id = 'analytics_file' | 'analytics_reread' | 'report_file' | 'report_form' | 'report_reread';
export interface Chain6Def {
  id: Chain6Id; wave: Gov6Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov6Surface; states: readonly string[];
  back: string; doing: string; key: (state: string) => string; statement: string;
}
export const GOV6_CHAINS: readonly Chain6Def[] = Object.freeze([
  { id: 'analytics_file', wave: '6a', kind: 'DECOR', group: 'analytics_export', surface: 'analytics_file', states: ['queued', 'ready'], back: DASHBOARD_BACK, doing: 'analytics-file',
    key: (s: string) => `gov6.chain.analyticsFile.${s}`, statement: 'gov6.q4' },
  { id: 'analytics_reread', wave: '6a', kind: 'PARITY-DECOR', group: 'analytics_mutate', surface: 'analytics_reread', states: ['confirm', 'success', 'failure'], back: DASHBOARD_BACK, doing: 'analytics-reread',
    key: (s: string) => `gov6.chain.analyticsReread.${s}`, statement: 'gov6.q1' },
  { id: 'report_file', wave: '6a', kind: 'DECOR', group: 'report_export', surface: 'report_file', states: ['queued', 'ready'], back: DASHBOARD_BACK, doing: 'report-file',
    key: (s: string) => `gov6.chain.reportFile.${s}`, statement: 'gov6.q4' },
  { id: 'report_form', wave: '6a', kind: 'DECOR', group: 'report_form', surface: 'report_form', states: ['form-error', 'review', 'success', 'failure'], back: DASHBOARD_BACK, doing: 'report-form',
    key: (s: string) => `gov6.chain.reportForm.${s}`, statement: 'gov6.q4' },
  { id: 'report_reread', wave: '6a', kind: 'PARITY-DECOR', group: 'report_mutate', surface: 'report_reread', states: ['confirm', 'success', 'failure'], back: DASHBOARD_BACK, doing: 'report-reread',
    key: (s: string) => `gov6.chain.reportReread.${s}`, statement: 'gov6.q4' },
]);
export function chain6ById(id: Chain6Id): Chain6Def { return GOV6_CHAINS.find((c) => c.id === id) as Chain6Def; }

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which gov6 chain a query opens on /dashboard: `do=analytics-file` / `analytics-reread` / `report-file` / `report-form` /
 *  `report-reread`; anything else (GOV-1b's `define` / `reread` included) → null. */
export function chain6For(searchParams: Params): Chain6Id | null {
  const d = one(searchParams?.do);
  const c = GOV6_CHAINS.find((x) => x.doing === d);
  return c ? c.id : null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain6State(id: Chain6Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain6ById(id).states.includes(v) ? v : null;
}
