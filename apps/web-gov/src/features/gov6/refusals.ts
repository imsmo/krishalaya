// apps/web-gov/src/features/gov6/refusals.ts · PC-56 GOV-6 — WHAT THIS CONSOLE COUNTS, AND WHAT IT DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov5/refusals.ts` shape (survey_gov6.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov6 claims guard (test/gov6-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov6.` value.
//
// GOV-6 is GOV-6a → GOV-6b (survey §4; GOV-6 Q1-A, Q4-A and Q5-A applied by the lead under the founder's instructions — 06_GOV.md "GOV-6
// SPLIT"; his to reopen). This registry carries ALL 35 canon files: GOV-6a decided its 16 and GOV-6b its 19
// (35 decided, none pending).
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
// GOV-6b · THE RECORD AND OUTSIDE BODIES (GOV-6 Q2-A, Q3-A applied by the lead under the founder's instructions; Q4-A reused) adds NO route
// either; `/access` (W359, GOV-1a; GOV-4b's "Sign-ins") gains two sections (GOV6_SECTIONS_6B), each READING NOTHING and GIVEN NOTHING:
//   • W334 (Audit & transparency) — BUILT (honest) as the section "The record": Q2's sentence (verified: an opening writes an
//     `audit_read_log` TENANT row of the application's organisation with the actor and the time — GCR recordRead; a step writes a
//     `scheme_application_events` row (actor, realm 'gov', time — 0240's DEFINER) and an `audit_log` row with the organisation's tenant id
//     (gov-applications.service.ts) — and no gov route or kv_gov grant reads any of it); what this console does not do; Q4's sentence (ONCE
//     on /access, here only). No row, count, name or time; nothing about how the record is sealed (audit_log has no hash chain, C-4).
//   • W351–W354 (the regulator's home, lending, insurance, data room) — BUILT (honest) as ONE section "Outside bodies": Q3's sentence
//     (verified: sessions.realm IN ('tenant','partner','gov') — 0239:340; three token types; no gov export, feed or file route); what
//     this console does not do; the refusals BY NAME (the supervisory user, access, figures across lenders and insurers, code names, a
//     person's real name, the file room, requests, downloads, the method).
//   • Their canon addresses (`/audit`, `/regulator/home|lending|insurance|exports`) have no route and answer not found.
//   • the chains (`/access?do=…&act=`; Back → `/access`): audit export (W3206–W3207, `do=record-file`) DECOR; audit mutate (W3208–W3210,
//     `do=record-reread`) PARITY-DECOR; regulator export (W3244–W3245, `do=outside-file`) DECOR; regulator form (W3246–W3249,
//     `do=outside-form`) DECOR — "New extract request" refused (Q3-A); regulator mutate (W3250–W3252, `do=outside-reread`) PARITY-DECOR.
//     Reached by address only; each re-read's confirm state has ONE extra link — a re-read of /access.
// GOV-6 is complete with GOV-6b: 35 files decided, none pending.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov6Surface =
  // GOV-6a · the two /dashboard sections and their chains
  | 'analytics' | 'reports' | 'analytics_file' | 'analytics_reread' | 'report_file' | 'report_form' | 'report_reread'
  // GOV-6b · the two /access sections and their chains
  | 'record' | 'outside' | 'record_file' | 'record_reread' | 'outside_file' | 'outside_form' | 'outside_reread';
export interface Gov6Refusal { id: string; canon: string; surfaces: readonly Gov6Surface[]; key: string; why: string }

/** The surfaces GOV-6a builds: the sections "Analytics" (W333) and "Reports" (W357) of /dashboard, and their five chains. */
export const SURFACES_6A: readonly Gov6Surface[] = ['analytics', 'reports', 'analytics_file', 'analytics_reread', 'report_file', 'report_form', 'report_reread'];
/** The surfaces GOV-6b builds: the sections "The record" (W334) and "Outside bodies" (W351–W354) of /access, and their five chains. */
export const SURFACES_6B: readonly Gov6Surface[] = ['record', 'outside', 'record_file', 'record_reread', 'outside_file', 'outside_form', 'outside_reread'];
const REREADS_6A: readonly Gov6Surface[] = ['analytics_reread', 'report_reread'];
const WRITE_CHAINS_6A: readonly Gov6Surface[] = ['report_form', 'analytics_reread', 'report_reread'];
const REREADS_6B: readonly Gov6Surface[] = ['record_reread', 'outside_reread'];
const WRITE_CHAINS_6B: readonly Gov6Surface[] = ['outside_form', 'record_reread', 'outside_reread'];
const OUTSIDE_CHAINS_6B: readonly Gov6Surface[] = ['outside_file', 'outside_form', 'outside_reread'];

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
  // ══ W334 (the section "The record" of /access, Q2-A; Q4-A) ══
  { id: 'record_menu', canon: 'W334 "[initials]" avatar · "Search the [record]… ⌘K" · the bell · the sidebar\'s "[insight]" group · state "Flagged off — [page] disabled"', surfaces: ['record'],
    key: 'gov6.refusal.noRecordMenu', why: 'DECOR (FM :92 filter); E1: no route and no GOV_NAV change; E6: no per-section switch' },
  { id: 'record_reader', canon: 'W334 "Everything this console does is written down; this page is where the writing is read." · state "[The record] is readable by design — All authority staff can READ the [record] (that\'s the point)."', surfaces: ['record'],
    key: 'gov6.refusal.noRecordReader', why: 'Q2-A: the first clause is TRUE (recordRead; the act\'s audit row and event); no gov route (GC :147) and no kv_gov grant (0181:171-174) reads any record, and Q2-A keeps it so (GOV-4 Q4-A, the same shape)' },
  { id: 'record_rows', canon: 'W334 rows "[time] · [official] ([role]) · [step] · [scheme] · [ref]" ×4', surfaces: ['record'],
    key: 'gov6.refusal.noRecordRows', why: 'PII · TRUST, FALSE: named officials in a list every colleague reads; Q2-A shows no row' },
  { id: 'record_acts', canon: 'W334 rows "draft v[n] edited — benefit field" · "approved application (v[n] rules, [sum])" · "system ([automatic router]) · routed [n] high-confidence applications to [a quick queue]" · "[trial run] viewed — exclusion review recorded"', surfaces: ['record'],
    key: 'gov6.refusal.noSuchSteps', why: 'FALSE (F-7): drafts are the platform team\'s (GOV-2 Q5-A); an approval carries no sum (GOV-2 Q1-A); no automatic router or quick queue exists; trial runs are the platform registry\'s' },
  { id: 'record_count', canon: 'W334 "Showing 1–25 of [n] recorded actions (this [year]) · Page size · Page 1 of [n]"', surfaces: ['record'],
    key: 'gov6.refusal.noRecordCount', why: 'no row, no count (FM omission; the page-size select DECOR)' },
  { id: 'record_seal', canon: 'W334 "Recent recorded actions · [unchangeable] trail · [chained] like the trace canon"', surfaces: ['record'],
    key: 'gov6.refusal.noSealClaim', why: 'C-4: audit_log has no hash column (0014:32; 0183:14-16) — the only chain is the money ledger\'s; the brief forbids any sealed or tamper claim, so nothing is said about it' },
  { id: 'public_page', canon: 'W334 "Public transparency page — A citizen-facing stats page [goes out] weekly without officer effort: …, [money] totals, rejection-reason mix … · enabled · last [put out] [date] · preview the public page"', surfaces: ['record'],
    key: 'gov6.refusal.noPublicPage', why: 'FALSE (Q4-A; GOV-5 Q5-A): no public scheme page exists; "preview" (#preview) DECOR' },
  { id: 'info_requests', canon: 'W334 "[information-request] & court requests — Signed [files] carry the record, its [digests], and the version of the rules in force at each decision … run it twice, byte-[identical] twice."', surfaces: ['record'],
    key: 'gov6.refusal.noInfoRequests', why: 'FALSE: no request path, no signing key (0181:54), no byte-level digest; the scheme version IS stored per application (a fact, not a file)' },
  { id: 'record_file', canon: 'W334 "Signed [file] ([information-request]-ready)" (→ W3206)', surfaces: ['record', 'record_file'],
    key: 'gov6.refusal.noRecordFile', why: 'Q4-A: no gov file plane; nothing is signed' },
  { id: 'record_retry', canon: 'W334 state "Couldn\'t load the [record] — The [record] itself is [add-only] storage; only the reader failed" + Retry (→ W3208)', surfaces: ['record'],
    key: 'gov6.refusal.noRecordRetry', why: 'the section reads nothing, so it has no load-error state; the re-read chain (W3208–W3210) is reached by address' },
  { id: 'record_enabled', canon: 'W334 state "No actions yet — even enabling this console was recorded"', surfaces: ['record'],
    key: 'gov6.refusal.noSwitchClaim', why: 'not verified (survey "What I did NOT open"), so not said' },
  // ══ W351–W354 (the section "Outside bodies" of /access, Q3-A; Q4-A) ══
  { id: 'outside_console', canon: 'W351–W354 chrome "[console name] · READ-ONLY · [supervisory user] · dual [grant]" · banner "READ-ONLY supervisory access — every view is logged with your identity …" · their own sidebar "Scope & home / Lending / Insurance / [file room]" · "[initials]" · "Search within scope… ⌘K"', surfaces: ['outside', ...OUTSIDE_CHAINS_6B],
    key: 'gov6.refusal.noOutsideConsole', why: 'Q3-A: no fifth realm — sessions.realm IN (tenant, partner, gov) (0239:340); three token types (token.service.ts)' },
  { id: 'outside_access', canon: 'W351 "Supervisory access — what you see, and why · Granted to [a banking body]\'s supervision team · scope … · valid to [date]" · state "No scope active — … expired [grants] …" · state "Scope is the permission — There is no \'request more access\' button here"', surfaces: ['outside'],
    key: 'gov6.refusal.noOutsideAccess', why: 'FALSE: no grant, scope or expiry object exists (F-2; GOV-1 refused W359\'s external grants the same way)' },
  { id: 'lending_figures', canon: 'W352 "Partner lending — supervisory view · [n] partner lenders · nightly compute" · tiles "Active loans [n] across [n] partners" · "[priority-sector]-classified [share]" · "[overdue] [share]" · "Collections cure rate [share]"', surfaces: ['outside'],
    key: 'gov6.refusal.noLendingFigures', why: 'MONEY · TRUST, FALSE: no read across lenders in any realm; overdue days exist only on a lender\'s own desk (PARTNER-5c)' },
  { id: 'insurance_figures', canon: 'W353 tiles "Claims settled ≤[n] days [share] · median event-to-money [n] days" · "Surveyed claims paying [share]" · "[complaints body] complaints [n]" · "[weather-index] readiness [n]" · "What supervision can replay — Any decided claim\'s full chain … payout ledger entry …"', surfaces: ['outside'],
    key: 'gov6.refusal.noInsuranceFigures', why: 'MONEY · TRUST, FALSE: claim settlement is not on the platform (INSURANCE_SETTLEMENT_NOT_ON_PLATFORM); no complaints record; no replay' },
  { id: 'code_names', canon: 'W352 "Anonymised drill — [sampling] · [code names] are stable across your sessions" · rows "[code] · [product] · [sum] · [evidence] ✓" ×3 · "Sample: [n] of [n] … Page size · Page 1 of [n]"', surfaces: ['outside'],
    key: 'gov6.refusal.noCodeNames', why: 'PII, FALSE: a stable code name with product, sum and farm facts identifies a person in a village; no such code exists (grep 0)' },
  { id: 'naming', canon: 'W351 "[naming] requires a formal request logged to both sides" · W352 state "[Naming] is a process …" · W354 row "[Naming]: [code] … awaiting platform [second signature] — both sides logged" · state "[Second-signature] flows — both signatures or neither"', surfaces: ['outside'],
    key: 'gov6.refusal.noNaming', why: 'PII · LEGAL, FALSE: no request, second-signature or privacy-officer flow exists; a lawyer must read any such design (survey "the law")' },
  { id: 'file_room', canon: 'W354 "[File room] — signed, reproducible, logged · Every [file]: platform-signed, [marked] with the requesting officer, [digest]-listed …" · rows "[time] · [file] · [officer] · ready · signed · [digest]" ×3 · "Showing [n] of [n] requests" · "Reproducibility is the [record] guarantee … backend-pending ([delta])" · the row menu', surfaces: ['outside'],
    key: 'gov6.refusal.noFileRoom', why: 'FALSE ×5 (C-5): no signing key (0181:54), no marking, no request log' },
  { id: 'data_request', canon: 'W354 "New [file] request" ×2 (→ W3246) · state "No requests yet — The first [file] defines its own precedent"', surfaces: ['outside', 'outside_form'],
    key: 'gov6.refusal.noDataRequest', why: 'Q3-A: no outside body asks this console for data' },
  { id: 'outside_file', canon: 'W354 "Download" ×2 (→ W3244) · W352 / W353 "Signed [file]" (→ W354)', surfaces: ['outside', 'outside_file'],
    key: 'gov6.refusal.noOutsideFile', why: 'Q3-A, Q4-A: nothing leaves this console for an outside body' },
  { id: 'method_claim', canon: 'W351 "Freshness & method — Figures compute nightly from the same ledger … ([balance] checked hourly) … reproducible [files]" · "In scope — … the same signed [files] the platform auditor gets"', surfaces: ['outside'],
    key: 'gov6.refusal.noMethodClaim', why: 'FALSE: no nightly compute for any outside body; the ledger check is not verified here and not printed; the auditor is an organisation\'s role, never the platform\'s (C-5)' },
  { id: 'joined_books', canon: 'W353 state "Scope boundaries — Cross-scope queries (a borrower who is also a policyholder) require both [grants] and a logged joint request"', surfaces: ['outside'],
    key: 'gov6.refusal.noJoinedBooks', why: 'the exact cross-book join the partner realm forbids' },
  { id: 'outside_retry', canon: 'W351–W354 states "Couldn\'t load" · "Nightly compute incomplete" · "Compute incomplete" · "[File] failed to build" + Retry (→ W3250)', surfaces: ['outside'],
    key: 'gov6.refusal.noOutsideRetry', why: 'the section reads nothing; the re-read chain (W3250–W3252) is reached by address' },
  // ══ the 6b chains' shared sentences (W3206–W3210, W3244–W3252) — refused BY NAME (6a's words, reused) ══
  { id: 'chain_file_6b', canon: 'W3206 / W3207 / W3244 / W3245 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file digest] … every fetch logged"', surfaces: ['record_file', 'outside_file'],
    key: 'gov6.refusal.chainFile', why: 'no file is queued, made or handed out in this realm (Q4-A)' },
  { id: 'chain_record_6b', canon: 'W3208 / W3250 "confirming writes an [record] entry with actor, time and reason" · W3209 / W3248 / W3251 "the [record] has the entry (actor · time · reason · before/after)" · "View [the record]"', surfaces: WRITE_CHAINS_6B,
    key: 'gov6.refusal.chainRecord', why: 'nothing is written from these pages; and under Q2-A the record is shown to no one' },
  { id: 'chain_money_6b', canon: 'W3209 / W3248 / W3251 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: WRITE_CHAINS_6B,
    key: 'gov6.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_6b', canon: 'W3210 / W3249 / W3252 "repeated failures page the [duty person]" · "Retry — back to confirm"', surfaces: WRITE_CHAINS_6B,
    key: 'gov6.refusal.chainPaging', why: 'no paging exists; Back returns to /access' },
  { id: 'chain_review_6b', canon: 'W3247 "[two-person]-friendly review step … the diff against current values" · W3246 "values you entered are preserved"', surfaces: ['outside_form'],
    key: 'gov6.refusal.chainReview', why: 'no form exists, so there is nothing to keep, review or compare' },
  { id: 'chain_back_form_6b', canon: 'W3246 "Back to the form" (→ W354) · W3249 "Retry — back to confirm" (→ W354; the form chain has no confirm)', surfaces: ['outside_form'],
    key: 'gov6.refusal.chainBackForm', why: 'canon defect (survey §1, F-10): no form exists; Back returns to the page' },
  { id: 'reread_writes_6b', canon: 'W3208 / W3250 "confirming writes an [record] entry" (opened by "Retry")', surfaces: REREADS_6B,
    key: 'gov6.refusal.rereadWrites', why: 'a re-read writes nothing' },
]);
export function gov6RefusalKeys(surface: Gov6Surface): string[] { return GOV6_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** GOV-6a · `/dashboard`'s two sections — W333 "Analytics" (Q1-A, Q5-A) and W357 "Reports" (Q4-A). Each prints its title, its statement,
 *  its facts (said in words — never a number), its list of what is not counted / not done (each named ONCE), its closing statement (if any)
 *  and its own refusals (surface). */
export interface Gov6Section {
  id: 'analytics' | 'reports' | 'record' | 'outside'; file: string; surface: Gov6Surface; title: string; statement: string; facts: readonly string[];
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

/** GOV-6b · `/access`'s two sections — W334 "The record" (Q2-A; Q4-A once, here) and W351–W354 "Outside bodies" (Q3-A). No facts: each
 *  prints its title, its statement, what this console does not do (each named ONCE), its closing statement (if any) and its refusals. */
export const GOV6_SECTIONS_6B: readonly Gov6Section[] = Object.freeze([
  { id: 'record', file: 'W334', surface: 'record', title: 'gov6.record.title', statement: 'gov6.q2', facts: [],
    listTitle: 'gov6.notDone.title', items: [
      { id: 'list', canon: 'W334 "Recent recorded actions" rows · "Showing 1–25 of [n] recorded actions"', key: 'gov6.recordNot.list' },
      { id: 'public', canon: 'W334 "Public transparency page — … [goes out] weekly"', key: 'gov6.recordNot.public' },
      { id: 'requests', canon: 'W334 "[information-request] & court requests"', key: 'gov6.recordNot.requests' },
    ], closing: 'gov6.q4' },
  { id: 'outside', file: 'W351–W354', surface: 'outside', title: 'gov6.outside.title', statement: 'gov6.q3', facts: [],
    listTitle: 'gov6.notDone.title', items: [
      { id: 'figures', canon: 'W352 / W353 tiles across [n] partner lenders and the insurers', key: 'gov6.outsideNot.figures' },
      { id: 'people', canon: 'W352 "Anonymised drill — … [code names] are stable across your sessions"', key: 'gov6.outsideNot.people' },
      { id: 'naming', canon: 'W351 / W352 / W354 "[naming] requires a formal request"', key: 'gov6.outsideNot.naming' },
      { id: 'files', canon: 'W354 "[File room]" · "New [file] request"', key: 'gov6.outsideNot.files' },
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
  // ── GOV-6b ──
  { id: 'two_sections_6b', canon: 'W334 /audit (the sidebar\'s "[insight]" group) · W351–W354 /regulator/home|lending|insurance|exports (a separate console with its own sidebar)', built: 'E1: no route and no GOV_NAV change; the sections "The record" and "Outside bodies" of /access (W359\'s page — GOV-4b\'s "Sign-ins" precedent); /audit and /regulator/* answer not found' },
  { id: 'four_pages_one_section', canon: 'W351 home · W352 lending · W353 insurance · W354 [file room] — four pages', built: 'one section: there is no outside body to give a page to, so one sentence (Q3) and one list of what is not done cover all four' },
  { id: 'given_nothing_6b', canon: 'W334 rows, count, public page · W352 / W353 tiles and drill · W354 rows', built: 'the sections take only the translator; /access still makes only GOV-1a\'s gov.members.list(); no record row, name, time, figure or code can reach them' },
  { id: 'q4_once_on_access', canon: 'W334 "Signed [file]" · W354 "Download" ×2', built: 'Q4\'s sentence (GOV-6a\'s key) is printed ONCE on /access, as the closing of "The record"; "Outside bodies" does not repeat it (Q3\'s sentence says nothing is received)' },
  { id: 'registers_gone', canon: 'GOV-1a 307 /registers → /dashboard (the deleted GW-3 "regulator" page; 13 dead "reg." keys)', built: 'GOV-6b (F-9, C-3): the redirect and the 13 keys ×3 deleted; /registers answers not found' },
  { id: 'no_retry_opener_6b', canon: 'W334 "Couldn\'t load the [record] … Retry" (→ W3208) · W351–W354 "… Retry" (→ W3250)', built: 'the sections read nothing, so they have no load-error state; /access\'s own Retry stays GOV-1a\'s re-read; the 6b re-read chains are reached by address; each confirm state\'s one extra link re-reads /access' },
  { id: 'record_seen_correction', canon: '0239:55-57 "the organisation sees it" (C-2)', built: 'not printed: Q2 says only that the record is kept in the organisation\'s records and that this console shows it to no one; C-2 is corrected in the records, never by editing 0239' },
]);

/** The verdict values (GOV-6b decided its 19 and deleted `pending_6b` — the 4c-7 rule). */
export type Gov6Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR';
export type Gov6Wave = '6a' | '6b';
/** Every canon file of GOV-6 (35), each with ONE verdict: 6a decided its 16, 6b its 19 — 35 decided, 0 pending. */
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
  // ── 6b · THE RECORD AND OUTSIDE BODIES (19) — decided (Q2-A, Q3-A lead-applied; Q4-A reused) ──
  { file: 'W334-gov-audit.html', wave: '6b', verdict: 'BUILT (honest)', note: '/access section "The record" — Q2\'s sentence; what is not done named once; Q4\'s sentence (once on /access); no row, count, name, time or seal claim; /audit has no route' },
  { file: 'W351-gov-regulator-home.html', wave: '6b', verdict: 'BUILT (honest)', note: '/access section "Outside bodies" — Q3\'s sentence; the supervisory user, access, method refused by name; /regulator/home has no route' },
  { file: 'W352-gov-regulator-lending.html', wave: '6b', verdict: 'BUILT (honest)', note: '/access section "Outside bodies" — no lending figure, code name or sample; /regulator/lending has no route' },
  { file: 'W353-gov-regulator-insurance.html', wave: '6b', verdict: 'BUILT (honest)', note: '/access section "Outside bodies" — no insurance figure, replay or joined books; /regulator/insurance has no route' },
  { file: 'W354-gov-regulator-exports.html', wave: '6b', verdict: 'BUILT (honest)', note: '/access section "Outside bodies" — no file room, request, naming or download; /regulator/exports has no route' },
  { file: 'W3206-gov-audit-export-queued.html', wave: '6b', verdict: 'DECOR', note: '/access?do=record-file&act=queued — no file is made; reached by address only' },
  { file: 'W3207-gov-audit-export-ready.html', wave: '6b', verdict: 'DECOR', note: '/access?do=record-file&act=ready — no file of the record exists' },
  { file: 'W3208-gov-audit-mutate-confirm.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=record-reread&act=confirm — the one extra link IS a re-read of /access' },
  { file: 'W3209-gov-audit-mutate-success.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=record-reread&act=success — nothing changed' },
  { file: 'W3210-gov-audit-mutate-failure.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=record-reread&act=failure — nothing changed; Back → /access' },
  { file: 'W3244-gov-regulator-export-queued.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-file&act=queued — nothing is made for an outside body' },
  { file: 'W3245-gov-regulator-export-ready.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-file&act=ready — no file exists to hand out' },
  { file: 'W3246-gov-regulator-form-form-error.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-form&act=form-error — "New [file] request" refused BY NAME (Q3-A); no form exists' },
  { file: 'W3247-gov-regulator-form-review.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-form&act=review — nothing to review' },
  { file: 'W3248-gov-regulator-form-success.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-form&act=success — no request was made or answered' },
  { file: 'W3249-gov-regulator-form-failure.html', wave: '6b', verdict: 'DECOR', note: '/access?do=outside-form&act=failure — nothing was sent' },
  { file: 'W3250-gov-regulator-mutate-confirm.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=outside-reread&act=confirm — the one extra link IS a re-read of /access' },
  { file: 'W3251-gov-regulator-mutate-success.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=outside-reread&act=success — nothing changed' },
  { file: 'W3252-gov-regulator-mutate-failure.html', wave: '6b', verdict: 'PARITY-DECOR', note: '/access?do=outside-reread&act=failure — nothing changed; Back → /access' },
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

/** Every gov6 chain returns to the one page that opens it: 6a's to /dashboard, 6b's to /access. */
export const DASHBOARD_BACK = '/dashboard';
export const ACCESS_BACK = '/access';
export type Chain6Page = 'dashboard' | 'access';

// ── THE BUILT CHAINS: each is a query state (`?do=…&act=`) of the page that opens it (6a: /dashboard; 6b: /access) — Back to that page. ──
export type Chain6Id = 'analytics_file' | 'analytics_reread' | 'report_file' | 'report_form' | 'report_reread'
  | 'record_file' | 'record_reread' | 'outside_file' | 'outside_form' | 'outside_reread';
export interface Chain6Def {
  id: Chain6Id; wave: Gov6Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov6Surface; states: readonly string[];
  page: Chain6Page; back: string; backKey: string; rereadKey: string; doing: string; key: (state: string) => string; statement: string;
}
export const GOV6_CHAINS: readonly Chain6Def[] = Object.freeze([
  { id: 'analytics_file', wave: '6a', kind: 'DECOR', group: 'analytics_export', surface: 'analytics_file', states: ['queued', 'ready'], page: 'dashboard', back: DASHBOARD_BACK, backKey: 'gov6.chain.back', rereadKey: 'gov6.chain.reread', doing: 'analytics-file',
    key: (s: string) => `gov6.chain.analyticsFile.${s}`, statement: 'gov6.q4' },
  { id: 'analytics_reread', wave: '6a', kind: 'PARITY-DECOR', group: 'analytics_mutate', surface: 'analytics_reread', states: ['confirm', 'success', 'failure'], page: 'dashboard', back: DASHBOARD_BACK, backKey: 'gov6.chain.back', rereadKey: 'gov6.chain.reread', doing: 'analytics-reread',
    key: (s: string) => `gov6.chain.analyticsReread.${s}`, statement: 'gov6.q1' },
  { id: 'report_file', wave: '6a', kind: 'DECOR', group: 'report_export', surface: 'report_file', states: ['queued', 'ready'], page: 'dashboard', back: DASHBOARD_BACK, backKey: 'gov6.chain.back', rereadKey: 'gov6.chain.reread', doing: 'report-file',
    key: (s: string) => `gov6.chain.reportFile.${s}`, statement: 'gov6.q4' },
  { id: 'report_form', wave: '6a', kind: 'DECOR', group: 'report_form', surface: 'report_form', states: ['form-error', 'review', 'success', 'failure'], page: 'dashboard', back: DASHBOARD_BACK, backKey: 'gov6.chain.back', rereadKey: 'gov6.chain.reread', doing: 'report-form',
    key: (s: string) => `gov6.chain.reportForm.${s}`, statement: 'gov6.q4' },
  { id: 'report_reread', wave: '6a', kind: 'PARITY-DECOR', group: 'report_mutate', surface: 'report_reread', states: ['confirm', 'success', 'failure'], page: 'dashboard', back: DASHBOARD_BACK, backKey: 'gov6.chain.back', rereadKey: 'gov6.chain.reread', doing: 'report-reread',
    key: (s: string) => `gov6.chain.reportReread.${s}`, statement: 'gov6.q4' },
  // ── GOV-6b · on /access ──
  { id: 'record_file', wave: '6b', kind: 'DECOR', group: 'audit_export', surface: 'record_file', states: ['queued', 'ready'], page: 'access', back: ACCESS_BACK, backKey: 'gov6.chain.backAccess', rereadKey: 'gov6.chain.rereadAccess', doing: 'record-file',
    key: (s: string) => `gov6.chain.recordFile.${s}`, statement: 'gov6.q4' },
  { id: 'record_reread', wave: '6b', kind: 'PARITY-DECOR', group: 'audit_mutate', surface: 'record_reread', states: ['confirm', 'success', 'failure'], page: 'access', back: ACCESS_BACK, backKey: 'gov6.chain.backAccess', rereadKey: 'gov6.chain.rereadAccess', doing: 'record-reread',
    key: (s: string) => `gov6.chain.recordReread.${s}`, statement: 'gov6.q2' },
  { id: 'outside_file', wave: '6b', kind: 'DECOR', group: 'regulator_export', surface: 'outside_file', states: ['queued', 'ready'], page: 'access', back: ACCESS_BACK, backKey: 'gov6.chain.backAccess', rereadKey: 'gov6.chain.rereadAccess', doing: 'outside-file',
    key: (s: string) => `gov6.chain.outsideFile.${s}`, statement: 'gov6.q3' },
  { id: 'outside_form', wave: '6b', kind: 'DECOR', group: 'regulator_form', surface: 'outside_form', states: ['form-error', 'review', 'success', 'failure'], page: 'access', back: ACCESS_BACK, backKey: 'gov6.chain.backAccess', rereadKey: 'gov6.chain.rereadAccess', doing: 'outside-form',
    key: (s: string) => `gov6.chain.outsideForm.${s}`, statement: 'gov6.q3' },
  { id: 'outside_reread', wave: '6b', kind: 'PARITY-DECOR', group: 'regulator_mutate', surface: 'outside_reread', states: ['confirm', 'success', 'failure'], page: 'access', back: ACCESS_BACK, backKey: 'gov6.chain.backAccess', rereadKey: 'gov6.chain.rereadAccess', doing: 'outside-reread',
    key: (s: string) => `gov6.chain.outsideReread.${s}`, statement: 'gov6.q3' },
]);
export function chain6ById(id: Chain6Id): Chain6Def { return GOV6_CHAINS.find((c) => c.id === id) as Chain6Def; }

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which gov6 chain a query opens on /dashboard: `do=analytics-file` / `analytics-reread` / `report-file` / `report-form` /
 *  `report-reread`; anything else (GOV-1b's `define` / `reread` included) → null. */
export function chain6For(searchParams: Params, page: Chain6Page = 'dashboard'): Chain6Id | null {
  const d = one(searchParams?.do);
  const c = GOV6_CHAINS.find((x) => x.page === page && x.doing === d);
  return c ? c.id : null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain6State(id: Chain6Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain6ById(id).states.includes(v) ? v : null;
}
