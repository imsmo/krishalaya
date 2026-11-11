// apps/web-gov/src/features/gov5/refusals.ts · PC-56 GOV-5 — WHAT THE MGNREGA PAGE DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov4/refusals.ts` shape (survey_gov5.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov5 claims guard (test/gov5-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov5.` value.
//
// GOV-5 is HOTFIX-16 → GOV-5a → GOV-5b (survey §4; GOV-5 Q1-A, Q2-A, Q3-A and Q4-A applied by the lead under the founder's instructions —
// 06_GOV.md "GOV-5 SPLIT"; his to reopen). This registry carries ALL 33 canon files: GOV-5a decided its 23; GOV-5b decides its 10 (Q1-A,
// Q5-A) — 33 decided, 0 pending (`pending_5b` is deleted from the verdict type: the 4c-7 rule).
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
//
// GOV-5b · WAGES AND SOCIAL AUDIT adds no route; `/mgnrega` gains two sections (GOV5_SECTIONS_5B):
//   • W349 (Wages & FTO) — BUILT (honest) as the section "Wages" (Q1-A): GOV-5a's wage sentence (`gov5.q1`, moved into this section so it
//     is printed once) and each canon feature named once as not done here — the wage list, the payment order (FTO) and the watch on a bank
//     payment, compensation for late wages, the unemployment allowance, a date promised to a worker. No figure of any kind.
//   • W350 (Social audit & the public wall) — BUILT (honest) as the section "Social audit" (Q5-A): "This console publishes nothing, compiles
//     no social-audit pack and takes no complaints." — each clause verified at 8051ba28: the gov realm's controllers are auth / me / members /
//     applications / schemes / overview (no publish act — `published` there only READS a scheme's published version); no migration
//     creates a social-audit table; the only complaint table (`labour_grievances`, 0008) is the marketplace's, with no gov route and no
//     kv_gov grant (0239 / 0240 grant kv_gov nothing on it).
//   • Their canon addresses (`/mgnrega/wages`, `/mgnrega/audit`, `/mgnrega/social-audit`) have no route and answer not found.
//   • the chains (`?do=…&act=`; Back → `/mgnrega`): wage export (W3270–W3271, `do=wage-file`) DECOR; wage re-read (W3272–W3274,
//     `do=wage-reread`) PARITY-DECOR; social mutate (W3267–W3269, `do=publish`) DECOR — "Publish this month's wall" refused (Q5-A).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov5Surface =
  // GOV-5a · the page and its chains
  | 'mgnrega' | 'job_file' | 'job_reread' | 'sync_act' | 'muster_reread' | 'demand_form' | 'work_reread'
  // GOV-5b · the page's two sections and their chains
  | 'wages' | 'social_audit' | 'wage_file' | 'wage_reread' | 'publish_act';
export interface Gov5Refusal { id: string; canon: string; surfaces: readonly Gov5Surface[]; key: string; why: string }

/** The surfaces GOV-5a builds. */
export const SURFACES_5A: readonly Gov5Surface[] = ['mgnrega', 'job_file', 'job_reread', 'sync_act', 'muster_reread', 'demand_form', 'work_reread'];
/** The surfaces GOV-5b builds: the sections "Wages" (W349) and "Social audit" (W350) of /mgnrega, and their three chains. */
export const SURFACES_5B: readonly Gov5Surface[] = ['wages', 'social_audit', 'wage_file', 'wage_reread', 'publish_act'];
const REREADS_5A: readonly Gov5Surface[] = ['job_reread', 'muster_reread', 'work_reread'];
const WRITE_CHAINS_5A: readonly Gov5Surface[] = ['sync_act', 'demand_form', 'job_reread', 'muster_reread', 'work_reread'];
const WRITE_CHAINS_5B: readonly Gov5Surface[] = ['publish_act', 'wage_reread'];

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
  // ══ GOV-5b · W349 (the section "Wages", Q1-A) ══
  { id: 'wage_rows', canon: 'W349 rows "[n] days left (due [date]) · [muster ref] · [money] · wage list generated · FTO pending signature" · "[n] days late … FTO signed · credit pending at bank · [money] ([money] × [rate] × [n] days — accrues daily until credit)" · "paid on day [n] … credited [date] (day [n]) · [n] pd × [money]"', surfaces: ['wages'],
    key: 'gov5.refusal.noPayRows', why: 'MONEY · LEGAL, FALSE ×3 (Q1-A): no payment stage, bank credit or late-pay sum exists in any realm (grep fto|compensation → 0)' },
  { id: 'late_rule', canon: 'W349 "Compensation ([rate] of unpaid wages per day of delay) is the Act\'s rule, not ours — this console computes it in the open so a worker never has to argue arithmetic" · title "the 15-day promise, tracked … late means compensation, computed automatically, not claimed"', surfaces: ['wages'],
    key: 'gov5.refusal.noLateRule', why: 'LEGAL: the rate is a statement of law not verified here and not printed; nothing is computed' },
  { id: 'worker_promise', canon: 'W349 "Workers see the same clock in their own app/[text message] in [language]: [a promise of the date wages will arrive]"', surfaces: ['wages'],
    key: 'gov5.refusal.noPayMessage', why: 'FALSE: no app shows MGNREGA and no message exists (survey §1); a payment promise on the platform\'s behalf' },
  { id: 'pay_empty', canon: 'W349 states "No wage payments tracked yet" · "No open wage cycles — Every muster credited within its window … nothing was late, which is the win"', surfaces: ['wages'],
    key: 'gov5.refusal.emptyNotPaid', why: 'FALSE as a claim: nothing is tracked, so empty is not success (the GOV-3 rule)' },
  { id: 'stage_mirror', canon: 'W349 states "Stage feed stale — Stages shown as-of the last sync; the [late-pay] accrual runs on OUR clock from muster closure" · "Observed, not operated — [payment order] signing happens in [register] with its own signatories; this page is the [panchayat]\'s honest mirror plus the arithmetic nobody else shows"', surfaces: ['wages'],
    key: 'gov5.refusal.noStages', why: 'FALSE: no stage feed, sync or observation exists (the state-ledger provider is a noop); who signs in the state system is not shown by code' },
  { id: 'pay_paging', canon: 'W349 "Showing 3 of [n] wage cycles this FY · Page size · Page 1 of [n]" · filter "paid on day [n]" · "[n] days late" (no target) · row menus ×3', surfaces: ['wages'],
    key: 'gov5.refusal.noPayPaging', why: 'no rows, so nothing to page, filter or open (FM :155, :159, :160 DECOR)' },
  { id: 'pay_file', canon: 'W349 "Export (audit-stamped)" (→ W3270)', surfaces: ['wages', 'wage_file'],
    key: 'gov5.refusal.noPayFile', why: 'applied from GOV-2/3/4 Q4-A: no gov file plane; the download sentence is printed' },
  // ══ GOV-5b · W350 (the section "Social audit", Q5-A) ══
  { id: 'public_wall', canon: 'W350 "Social audit & the public wall — … everything here is also on the physical wall and the public page, in [language] first" · "Printed [size], pasted at the [panchayat] office and the [place] worksite, [scan code] to the same page online"', surfaces: ['social_audit'],
    key: 'gov5.refusal.noWall', why: 'FALSE: no wall, public page or code exists; Q5-A' },
  { id: 'publish', canon: 'W350 "Publish this month\'s wall" (→ W3267) · state "Publishing is the [headman] + secretary — Two-person publish (maker-checker)"', surfaces: ['social_audit', 'publish_act'],
    key: 'gov5.refusal.noPublish', why: 'Q5-A: nothing is published; no such roles (0239:25-28)' },
  { id: 'wall_contents', canon: 'W350 "The wall — what the village sees: Works in progress ([n]) with [budget] vs [spend] · every muster, worker-by-worker, wages and dates · the demand register with its clocks · [late pay] paid for delays ([money] accruing is PUBLIC — embarrassment is the enforcement mechanism the Act intended)"', surfaces: ['social_audit'],
    key: 'gov5.refusal.noShowing', why: 'PII · MONEY · LEGAL, FALSE: named workers\' days and pay put on public show; a budget figure from a typed number (F-7)' },
  { id: 'audit_pack', canon: 'W350 "[village assembly] audit — next: [date] · Audit pack auto-compiles: all musters, wage lists, [payment orders], delay [late pay], photos with dates. Findings … land back here with owners and due dates" · state "Couldn\'t compile the pack — … Retry"', surfaces: ['social_audit'],
    key: 'gov5.refusal.noMeeting', why: 'FALSE: no pack, photo, meeting date or findings object exists' },
  { id: 'grievance_rows', canon: 'W350 "Grievances — open register · any channel · dated receipt · public status" · rows "[a worker\'s own words] · [date] · voice line · [muster ref] attendance (worker [masked]) · query opened with [register] record — worker keeps the receipt" · "[a worksite facility] absent … fixed [date]"', surfaces: ['social_audit'],
    key: 'gov5.refusal.noComplaintRows', why: 'PII · TRUST, FALSE: no complaint route in the gov realm; a worker\'s words and card digits in a "public status" register' },
  { id: 'held_line', canon: 'W350 "One worker\'s dispute never delays [n] colleagues\' wages — the disputed line holds, the muster pays. The same freeze-only-the-disputed-value rule the marketplace uses ([screen])"', surfaces: ['social_audit'],
    key: 'gov5.refusal.noHeldPay', why: 'FALSE for MGNREGA: no wage list exists; the marketplace rule is not verified here' },
  { id: 'complaints_empty', canon: 'W350 states "No grievances open — Concerns raised at the [village assembly] or on the public wall will appear here" · "No open grievances — The register being empty is only good news if the channels are genuinely open"', surfaces: ['social_audit'],
    key: 'gov5.refusal.emptyNotHeard', why: 'FALSE as a claim: nothing is taken here, so an empty section says nothing about complaints' },
  // ══ GOV-5b · the chains' shared sentences (W3267–W3274) — refused BY NAME ══
  { id: 'chain_file_5b', canon: 'W3270 / W3271 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged"', surfaces: ['wage_file'],
    key: 'gov5.refusal.chainFile', why: 'no file is queued, made or handed out in this realm (GOV-2 Q4-A)' },
  { id: 'chain_record_5b', canon: 'W3267 / W3272 "confirming writes an [record] entry with actor, time and reason" · W3268 / W3273 "the [record] has the entry (actor · time · reason · before/after)" · "View [the record]"', surfaces: WRITE_CHAINS_5B,
    key: 'gov5.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view' },
  { id: 'chain_money_5b', canon: 'W3268 / W3273 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: WRITE_CHAINS_5B,
    key: 'gov5.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_paging_5b', canon: 'W3269 / W3274 "repeated failures page the [duty person]" · "Retry — back to confirm"', surfaces: WRITE_CHAINS_5B,
    key: 'gov5.refusal.chainPaging', why: 'no paging exists; Back returns to /mgnrega' },
  { id: 'reread_writes_5b', canon: 'W3272 "confirming writes an [record] entry" (opened by "Retry")', surfaces: ['wage_reread'],
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

/** GOV-5b · `/mgnrega`'s two sections — W349 "Wages" (Q1-A; GOV-5a's wage sentence) and W350 "Social audit" (Q5-A): each canon feature
 *  named ONCE as not done here. Each section prints its statement, its items and its own refusals (surface). */
export interface Gov5Section { id: 'wages' | 'social_audit'; file: 'W349' | 'W350'; surface: Gov5Surface; title: string; statement: string; items: readonly { id: string; canon: string; key: string }[] }
export const GOV5_SECTIONS_5B: readonly Gov5Section[] = Object.freeze([
  { id: 'wages', file: 'W349', surface: 'wages', title: 'gov5.wages.title', statement: 'gov5.q1', items: [
    { id: 'wage_list', canon: 'W349 "wage list generated"', key: 'gov5.notDone.wageList' },
    { id: 'payment_order', canon: 'W349 "FTO pending signature" · "FTO signed · credit pending at bank" · "credited [date]"', key: 'gov5.notDone.paymentOrder' },
    { id: 'compensation', canon: 'W349 "late means compensation, computed automatically" · "[money] (… accrues daily until credit)"', key: 'gov5.notDone.compensation' },
    { id: 'allowance', canon: 'W345 / W347 "unemployment allowance … state liability" (the wage-side figure W349 sits beside)', key: 'gov5.notDone.allowance' },
    { id: 'pay_date', canon: 'W349 "[n] days left (due [date])" · the worker-facing promise of a pay date', key: 'gov5.notDone.payDate' },
  ] },
  { id: 'social_audit', file: 'W350', surface: 'social_audit', title: 'gov5.social.title', statement: 'gov5.q5', items: [
    { id: 'public_notice', canon: 'W350 "the physical wall and the public page" · "Publish this month\'s wall"', key: 'gov5.notDone.publicNotice' },
    { id: 'audit_papers', canon: 'W350 "Audit pack auto-compiles … photos with dates" · "Findings … with owners and due dates"', key: 'gov5.notDone.auditPapers' },
    { id: 'complaints', canon: 'W350 "Grievances — open register · any channel · dated receipt · public status"', key: 'gov5.notDone.complaints' },
  ] },
]);

/** What was built differently from the canon, and why (DELTAs). */
export const GOV5_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'one_route', canon: 'W345 /mgnrega/dashboard · W346 /mgnrega/job-cards · W347 /mgnrega/demand · W348 /mgnrega/musters/[id] · W440 /mgnrega/musters', built: 'E1: one route, /mgnrega; W346, W347, W348, W440 are its "does not do" section; the other addresses have no route (not found); the GOV-1a 307 for /mgnrega is removed' },
  { id: 'nav_mgnrega', canon: 'the canon gives MGNREGA its own sidebar (W345:24-32); the authority\'s sidebar has no MGNREGA entry', built: 'GOV_NAV gains "MGNREGA" (/mgnrega) so the page\'s sentences are reachable; no MGNREGA sub-menu' },
  { id: 'reads_nothing', canon: 'W345 tiles and clocks, W346 rows, W347 rows, W348 grid, W440 rows', built: 'Q1-A / Q2-A / Q3-A: the page reads nothing (the shell\'s gov.me only); no row, count, clock, card number, person, place or figure' },
  { id: 'q4_not_printed', canon: 'brief Q4-A "The organisation\'s MGNREGA records are switched off on this platform."', built: 'NOT printed: the page reads nothing and the gov realm has no flag read; a flag can be ON for one organisation (its allowlist) — the page cannot know the state, so it does not claim it' },
  { id: 'q1_own_sentence', canon: 'GOV-3\'s money sentence ("…Benefits are paid by PFMS and the banks…")', built: 'not reused: its PFMS clause is about scheme benefits and is not shown true for MGNREGA wages by any code here; Q1\'s own sentence is printed' },
  { id: 'no_retry_opener', canon: 'load-error "Retry" on W345–W348, W440 → the mutate-confirm pages', built: 'the page reads nothing, so it has no load-error state; the re-read chains (PARITY-DECOR) are reached by address; each confirm state\'s one extra link re-reads /mgnrega' },
  { id: 'two_sections', canon: 'W349 /mgnrega/wages · W350 /mgnrega/audit (each its own page in the slice\'s own sidebar)', built: 'GOV-5b: no route; the sections "Wages" and "Social audit" of /mgnrega; /mgnrega/wages, /mgnrega/audit and /mgnrega/social-audit answer not found' },
  { id: 'q1_moved', canon: 'GOV-5a printed Q1\'s sentence among the page\'s opening statements', built: 'GOV-5b moves it (same key, same words) to the head of the "Wages" section, so it is printed ONCE (Q1-A: reuse GOV-5a\'s wage sentence)' },
  { id: 'chrome_5b', canon: 'W349 / W350 "[initials]" avatar · "Search [wage cycles / grievances]… ⌘K" · bell · state "Flagged off — [page] disabled … See plan settings"', built: 'covered by the page\'s own refusals (gov5.refusal.consoleChrome, gov5.refusal.pageSwitch) — one page, not printed twice' },
  { id: 'no_retry_opener_5b', canon: 'W349 "Stage feed stale … Retry" (→ W3272) · W350 "Couldn\'t compile the pack … Retry" (→ W3267)', built: 'no load-error state (the page reads nothing); the wage re-read chain is reached by address; the social chain is DECOR (Publish refused)' },
]);

/** The verdict values (GOV-5b deleted `pending_5b`: all 33 are decided — the 4c-7 rule). */
export type Gov5Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR';
export type Gov5Wave = '5a' | '5b';
/** Every canon file of GOV-5 (33), each with ONE verdict: 5a decided its 23; 5b decides its 10. */
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
  // ── 5b · WAGES AND SOCIAL AUDIT (10) — decided (Q1-A, Q5-A lead-applied) ──
  { file: 'W349-gov-wage-tracking.html', wave: '5b', verdict: 'BUILT (honest)', note: '/mgnrega section "Wages" — Q1\'s sentence (GOV-5a\'s, moved); wage list, payment order (FTO), compensation, allowance and pay date named once as not done; /mgnrega/wages has no route' },
  { file: 'W350-gov-social-audit.html', wave: '5b', verdict: 'BUILT (honest)', note: '/mgnrega section "Social audit" — Q5\'s sentence; notice and public page, audit papers, complaints named once as not done; /mgnrega/audit has no route' },
  { file: 'W3267-gov-social-mutate-confirm.html', wave: '5b', verdict: 'DECOR', note: '/mgnrega?do=publish&act=confirm — "Publish this month\'s wall" refused BY NAME (Q5-A)' },
  { file: 'W3268-gov-social-mutate-success.html', wave: '5b', verdict: 'DECOR', note: '/mgnrega?do=publish&act=success — nothing was published' },
  { file: 'W3269-gov-social-mutate-failure.html', wave: '5b', verdict: 'DECOR', note: '/mgnrega?do=publish&act=failure — nothing was sent; Back → /mgnrega' },
  { file: 'W3270-gov-wage-export-queued.html', wave: '5b', verdict: 'DECOR', note: '/mgnrega?do=wage-file&act=queued — no file is made; reached by address only' },
  { file: 'W3271-gov-wage-export-ready.html', wave: '5b', verdict: 'DECOR', note: '/mgnrega?do=wage-file&act=ready — no file exists to hand out' },
  { file: 'W3272-gov-wage-mutate-confirm.html', wave: '5b', verdict: 'PARITY-DECOR', note: '/mgnrega?do=wage-reread&act=confirm — the one extra link IS a re-read of /mgnrega' },
  { file: 'W3273-gov-wage-mutate-success.html', wave: '5b', verdict: 'PARITY-DECOR', note: '/mgnrega?do=wage-reread&act=success — nothing changed' },
  { file: 'W3274-gov-wage-mutate-failure.html', wave: '5b', verdict: 'PARITY-DECOR', note: '/mgnrega?do=wage-reread&act=failure — nothing changed; Back → /mgnrega' },
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
export type Chain5Id = 'job_file' | 'job_reread' | 'sync_act' | 'muster_reread' | 'demand_form' | 'work_reread' | 'wage_file' | 'wage_reread' | 'publish_act';
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
  // GOV-5b
  { id: 'wage_file', wave: '5b', kind: 'DECOR', group: 'wage_export', surface: 'wage_file', states: ['queued', 'ready'], back: MGNREGA_BACK, doing: 'wage-file',
    key: (s: string) => `gov5.chain.wageFile.${s}`, statement: 'gov5.download' },
  { id: 'wage_reread', wave: '5b', kind: 'PARITY-DECOR', group: 'wage_mutate', surface: 'wage_reread', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'wage-reread',
    key: (s: string) => `gov5.chain.wageReread.${s}`, statement: 'gov5.q1' },
  { id: 'publish_act', wave: '5b', kind: 'DECOR', group: 'social_mutate', surface: 'publish_act', states: ['confirm', 'success', 'failure'], back: MGNREGA_BACK, doing: 'publish',
    key: (s: string) => `gov5.chain.publish.${s}`, statement: 'gov5.q5' },
]);
export function chain5ById(id: Chain5Id): Chain5Def { return GOV5_CHAINS.find((c) => c.id === id) as Chain5Def; }

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which chain a query opens on /mgnrega: `do=job-file` / `job-reread` / `sync` / `muster-reread` / `demand` / `work-reread` (5a) /
 *  `wage-file` / `wage-reread` / `publish` (5b); anything else → null. */
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
