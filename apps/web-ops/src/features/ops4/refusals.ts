// apps/web-ops/src/features/ops4/refusals.ts · PC-56 OPS-4 — WHAT THE HIRE, UPKEEP, ANIMAL AND SENSOR PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops3/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it (persons, places, machines and figures
// anonymised) and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// (test/claims-guard.spec.ts, the `ops4.` scope) keeps the canon's false words out of every `ops4.` value.
//
// OPS-4 is three screen waves after HOTFIX-13 (founder, 2026-11-09; `05_OPS.md` "OPS-4 SPLIT"): 4a → 4b → 4c. This registry carries ALL 30 canon
// files; the files of the waves not yet built stay `pending_4b` / `pending_4c` until their wave decides them (the 4c-7 rule).
//
// OPS-4a · THE HIRE (founder Q1-A — built in HOTFIX-13 —, Q2-A, 2026-11-09; Q3-A applied by the lead from OPS-1 Q2-A) builds:
//   • `chc_dashboard` (W405, `/chc/dashboard`) — a READ of the signed-in person's machines (`GET /v1/equipment/assets?box=mine`, each by its
//     category's name and registration number, linked to W406) and the hires on them counted by the status the server gave (`GET
//     /v1/equipment/rentals?box=owner`, the latest 100, said so); no revenue, no %, no utilisation; the Q2 words.
//   • `chc_equipment` (W406, `/chc/equipment-detail?id=`) — a READ of ONE of the signed-in person's machines (found in her own `box=mine`
//     list — another person's machine is the page's not-found state): its facts, "engine hours as entered by the owner", its rate lines in
//     words with their days (`GET …/rates?assetId=`), its maintenance entries as typed; no calendar, no "next service", no GPS.
//   • `chc_bookings` (W407, `/chc/bookings`) — a READ of the hires on the signed-in person's machines (`box=owner`, keyset, a status filter):
//     booking number, status, the rate basis, the server's figures, whether the renter confirmed the hours, the dates; NO renter name, NO
//     money button; the Q1 words + the no-renter-app fact, the Q2 words, the Q3 words.
//   • `chc_insights` (W409, `/chc/insights`) — HONEST: reads nothing; says what is not built.
//   • `chc_act` (W3304–W3306) and `equipment_act` (W3318–W3320) — PARITY-DECOR: their only trigger is "Retry" on a read; the confirm state links a
//     plain re-read of the page that opened it (W409's Retry is DECOR: that page reads nothing). Query states of their parent (`?act=`).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops4Surface =
  // the eleven pages (survey E5)
  | 'chc_dashboard' | 'chc_equipment' | 'chc_bookings' | 'chc_maintenance' | 'chc_insights' | 'iot_dashboard' | 'iot_device' | 'iot_health'
  | 'eartag' | 'animal_register' | 'animal_transfer'
  // the chains
  | 'chc_form' | 'chc_act' | 'equipment_act' | 'device_act' | 'iot_act' | 'eartag_act';
export interface Ops4Refusal { id: string; canon: string; surfaces: readonly Ops4Surface[]; key: string; why: string }

/** The surfaces OPS-4a builds. */
export const SURFACES_4A: readonly Ops4Surface[] = ['chc_dashboard', 'chc_equipment', 'chc_bookings', 'chc_insights', 'chc_act', 'equipment_act'];
/** The surfaces OPS-4b builds (pending). */
export const SURFACES_4B: readonly Ops4Surface[] = ['chc_maintenance', 'chc_form', 'eartag', 'animal_register', 'animal_transfer', 'eartag_act'];
/** The surfaces OPS-4c builds (pending). */
export const SURFACES_4C: readonly Ops4Surface[] = ['iot_dashboard', 'iot_device', 'iot_health', 'iot_act', 'device_act'];
const CHC_PAGES: readonly Ops4Surface[] = ['chc_dashboard', 'chc_equipment', 'chc_bookings', 'chc_insights'];

export const OPS4_REFUSALS: readonly Ops4Refusal[] = Object.freeze([
  // ══ the console chrome on every hire page (W405–W409) ══
  { id: 'chrome_counts', canon: 'console chrome "[org] · Field Ops · IoT & machinery · sensors [n] · assets [n]"', surfaces: CHC_PAGES,
    key: 'ops4.refusal.chromeCounts', why: 'FALSE as counts (survey shared chrome): no organisation-wide machine count is read; the pages list the signed-in person\'s machines' },
  { id: 'chc_manager', canon: 'W405–W409 states "Operator vs CHC manager — only the CHC manager edits rate cards (W406) or resolves a disputed booking (W407)" · "maintenance technician"', surfaces: CHC_PAGES,
    key: 'ops4.refusal.chcManager', why: 'FALSE (survey C-15; founder OPS-3 Q14-A "signed in as you"): no CHC, centre, roster, manager, operator or technician exists; a machine belongs to the user who listed it (`equipment_assets.owner_user_id`)' },
  { id: 'search', canon: 'console chrome "Search assets… ⌘K"', surfaces: CHC_PAGES,
    key: 'ops4.refusal.search', why: 'DECOR: no search route; no input is built but the status filter (E7)' },
  { id: 'plan_settings', canon: 'flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: CHC_PAGES,
    key: 'ops4.refusal.planSettings', why: 'the S1…S6 precedent: a switched-off module says it is switched off; no settings page is pointed to' },
  // ══ W405 · the dashboard ══
  { id: 'fleet_sum', canon: 'W405 "Shared iron, private harvests — [n] assets ([n] tractors + [n] rotavators + … = [n])"', surfaces: ['chc_dashboard'],
    key: 'ops4.refusal.fleetSum', why: 'client sum refused (E3): each machine is listed as the server lists it' },
  { id: 'revenue_mtd', canon: 'W405 "Revenue MTD ₹[n] across all rate_basis lines"', surfaces: ['chc_dashboard'],
    key: 'ops4.refusal.revenueMtd', why: 'GAP-BE (survey §1A): no revenue read-model; a page sum of `totalMinor` is client money math (E3); and the money is the lister\'s (founder Q2-A)' },
  { id: 'utilisation', canon: 'W405 "Utilization MTD Tractors — [n]% …" · "Off-season honesty … [n]%"', surfaces: ['chc_dashboard'],
    key: 'ops4.refusal.utilisation', why: 'GAP-BE: no capacity, no measured working time; a percentage is refused (E3)' },
  { id: 'disputed', canon: 'W405 "Status legend … disputed" · "rental_status (verbatim, 8 values)"', surfaces: ['chc_dashboard', 'chc_bookings'],
    key: 'ops4.refusal.disputed', why: '`disputed` is in the database enum (0010:12) but no route or transition reaches it (`RENTAL_STATUSES`, seven values)' },
  { id: 'create_booking', canon: 'W405 state "No bookings yet this month … See Bookings to create one"', surfaces: ['chc_dashboard'],
    key: 'ops4.refusal.createBooking', why: 'FALSE (survey C-4): no desk booking exists, and no client anywhere requests a hire' },
  { id: 'feed_delayed', canon: 'W405 state "Utilization feed delayed … stale-as-of"', surfaces: ['chc_dashboard'],
    key: 'ops4.refusal.feedDelayed', why: 'FALSE: there is no utilisation feed' },
  // ══ W406 · one machine ══
  { id: 'next_service', canon: 'W406 "Next service [n] hrs · [n] hours away ([n] − [n] = [n])"', surfaces: ['chc_equipment'],
    key: 'ops4.refusal.nextService', why: 'FALSE: no service interval exists anywhere; the subtraction is client math (E3)' },
  { id: 'calendar', canon: 'W406 "Booking calendar — this week Mon avail / Tue booked …"', surfaces: ['chc_equipment'],
    key: 'ops4.refusal.calendar', why: 'GAP-BE: no availability read; the hires list has no machine filter; double hires are not prevented (F-9)' },
  { id: 'machine_diary', canon: 'W406 "The machine\'s diary is the fair-price argument — engine-hours, rate card, and booking log sit on one asset record, so a bill never needs a second story"', surfaces: ['chc_equipment'],
    key: 'ops4.refusal.machineDiary', why: 'FALSE (survey F-1): every hour is typed; the hours on a bill are the owner\'s word until the renter confirms them (HOTFIX-13)' },
  { id: 'handover_hours', canon: 'W406 state "Operators … log engine-hours at handover; only the CHC manager edits the rate card or marks maintenance"', surfaces: ['chc_equipment'],
    key: 'ops4.refusal.handoverHours', why: 'FALSE: no handover act; engine hours are a field the owner types on the machine' },
  { id: 'gps', canon: 'W406 / W407 "live GPS ref attached" · the machine\'s GPS', surfaces: ['chc_equipment', 'chc_bookings'],
    key: 'ops4.refusal.gps', why: 'FALSE: `gps_device_ref` is a typed string (not even returned); `area_gps_trace` has no writer' },
  // ══ W407 · the hires ══
  { id: 'renter_name', canon: 'W407 row "BK-[n] · [renter\'s name] · rotavator · …"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.renterName', why: 'WALL (founder OPS-2 Q9-A, OPS-3 Q10-A): booking numbers only; the API returns `renterUserId`, never printed' },
  { id: 'rate_times_qty', canon: 'W407 "[n]h × ₹[n] = ₹[n] est"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.rateTimesQty', why: 'client money math refused (E3): the rate, the quantities, the deposit and the bill are each the server\'s own figure' },
  { id: 'otp_hash', canon: 'W407 "confirmed for [day] · start_otp_hash set"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.otpHash', why: 'the start code reaches only the renter (HOTFIX-13 B4); its hash is never returned' },
  { id: 'hours_vs_billed', canon: 'W407 "hours logged [n] vs billed [n] · disputed · the tractor\'s own GPS trail decides — freeze only the disputed part"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.hoursVsBilled', why: 'FALSE ×3: hours typed by the owner; no dispute; no GPS trail' },
  { id: 'page_of', canon: 'W407 "Showing 4 of 87 this month … Page 1 of 4"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.pageOf', why: 'FALSE: keyset paging has no total (the pagination law)' },
  { id: 'waitlist', canon: 'W407 state "Conflict — double request, same slot — first-come holds the slot, the second is offered the waitlist"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.waitlist', why: 'FALSE (survey F-9, pinned live): no overlap check, no waiting list — both requests are accepted' },
  { id: 'gps_missing', canon: 'W407 states "GPS trail missing on a disputed row … manual reconciliation" · "Couldn\'t resolve the GPS trail"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.gpsMissing', why: 'FALSE: no GPS trail is read' },
  { id: 'cancel_restricted', canon: 'W407 state "Cancelling is renter-or-manager-restricted — … no one else can cancel on their behalf"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.cancelRestricted', why: 'PARTIAL: the renter, the machine\'s owner or a `booking.manage` holder may cancel a requested, quoted or confirmed hire (`equipment-booking.service.ts` cancel); not on this console (Q3-A)' },
  { id: 'otp_starts', canon: 'W407 "Work starts when the farmer\'s OTP says so"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.otpStarts', why: 'TRUE in mechanism (HOTFIX-13 B4), but starting is the owner\'s act in the owner\'s app (Q3-A), not this console\'s' },
  { id: 'money_buttons', canon: '(not canon — built OW-3) web-ops `/equipment/[id]` "Send quote" · "Start job (renter\'s OTP)" · "Record usage" · "Settle"', surfaces: ['chc_bookings'],
    key: 'ops4.refusal.moneyButtons', why: 'founder Q3-A (applied from OPS-1 Q2-A "the ops console only READS" money): removed in this wave; the owner\'s mobile app has them' },
  // ══ W409 · insights ══
  { id: 'insights_math', canon: 'W409 "[machine] · [n]h × ₹[n] = ₹[n]"', surfaces: ['chc_insights'],
    key: 'ops4.refusal.insightsMath', why: 'client money math refused (E3); hours typed' },
  { id: 'target_pct', canon: 'W409 "Utilization vs target … % of target"', surfaces: ['chc_insights'],
    key: 'ops4.refusal.targetPct', why: 'FALSE: no target exists' },
  { id: 'refusal_log', canon: 'W409 "Booking-refusal log … each refusal names the asset type and the week"', surfaces: ['chc_insights'],
    key: 'ops4.refusal.refusalLog', why: 'FALSE: no refused hire is recorded' },
  { id: 'smam', canon: 'W409 "This CHC was established under SMAM assistance. Machinery-subsidy claims are the FPO\'s own filing … we track hours; the subsidy file quotes them"', surfaces: ['chc_insights'],
    key: 'ops4.refusal.smam', why: '"we track hours" FALSE (typed); LEGAL — no statement about a subsidy filing is made here' },
  { id: 'rollup_delayed', canon: 'W409 states "First month" · "Revenue roll-up delayed"', surfaces: ['chc_insights'],
    key: 'ops4.refusal.rollupDelayed', why: 'FALSE: no roll-up exists' },
  // ══ the two mutate chains (W3304–W3306 chc, W3318–W3320 equipment) ══
  { id: 'chc_confirm_audit', canon: 'W3304 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['chc_act'],
    key: 'ops4.refusal.chcConfirmAudit', why: 'reading a page again writes nothing' },
  { id: 'chc_zero_sum', canon: 'W3305 "The change is applied and the audit trail has the entry (actor · time · reason · before/after). Money-adjacent actions reconcile zero-sum before this page ever shows." · "View audit trail"', surfaces: ['chc_act'],
    key: 'ops4.refusal.chcZeroSum', why: 'FALSE on a re-read: nothing was changed or balanced — refused BY NAME; no ops audit surface exists' },
  { id: 'chc_on_call', canon: 'W3306 "repeated failures page the on-call"', surfaces: ['chc_act'],
    key: 'ops4.refusal.chcOnCall', why: 'no paging exists' },
  { id: 'eq_confirm_audit', canon: 'W3318 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['equipment_act'],
    key: 'ops4.refusal.eqConfirmAudit', why: 'reading the machine again writes nothing' },
  { id: 'eq_zero_sum', canon: 'W3319 "The change is applied and the audit trail has the entry … Money-adjacent actions reconcile zero-sum before this page ever shows." · "View audit trail"', surfaces: ['equipment_act'],
    key: 'ops4.refusal.eqZeroSum', why: 'FALSE on a re-read — refused BY NAME' },
  { id: 'eq_on_call', canon: 'W3320 "repeated failures page the on-call"', surfaces: ['equipment_act'],
    key: 'ops4.refusal.eqOnCall', why: 'no paging exists' },
]);
export function ops4RefusalKeys(surface: Ops4Surface): string[] { return OPS4_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS4_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_chc', canon: 'W405 / W406 / W407 / W409 canon routes `chc/dashboard`, `chc/equipment-detail`, `chc/bookings`, `chc/insights`', built: 'the four at their canon addresses; W406 takes `?id=` (one machine)' },
  { id: 'equipment_redirect', canon: 'OW-3 `/equipment` (the hire queue, the asset table, the tag lookup) and `/equipment/[id]` (quote, start, complete, settle, cancel)', built: 'REAL 307s (next.config.js, permanent: false): `/equipment` → `/chc/dashboard`, `/equipment/:id` → `/chc/bookings`; both OW-3 pages and their server action are deleted' },
  { id: 'money_acts_removed', canon: 'OW-3 `/equipment/[id]` quote · start · complete · settle (a live owner money desk on this console, over the wrong list — survey F-5)', built: 'founder Q3-A: removed. The owner\'s mobile app has all four (`apps/mobile/src/app/(equipment)/rentals/[id].tsx`). No web-ops source calls settleRental, quoteRental, startRental, completeRental, confirmRental or confirmRentalUsage (source assertion)' },
  { id: 'tag_lookup_removed', canon: 'OW-3 / PC-55 B5 ear-tag lookup on `/equipment` (`livestock.animals({ box: \'all\', pashuAadhaar })`)', built: 'gone with its route: `/equipment` is a 307 (survey Q4-A, applied by the lead: "This desk does not look up animals by tag"); its `tag.` keys are deleted; `features/equipment/ear-tag.ts` stays for OPS-4b' },
  { id: 'owner_list_box', canon: 'survey C-13 — the SDK left `box` undefined, so `/equipment` listed the signed-in person\'s OWN hires as a renter', built: 'the SDK makes `box` required (typed and checked); `/chc/*` read `box=owner`; `/insights`\'s rentals snapshot reads `box=owner` too (a NAMED change: it had read the renter list)' },
  { id: 'w406_edges', canon: 'W406 is reached only by its own chain (survey §1B)', built: 'drawn: each machine row on W405 and each hire\'s machine on W407 links `/chc/equipment-detail?id=`' },
  { id: 'sidebar_built_only', canon: 'console sidebar "Machinery (CHC) · CHC dashboard · Bookings · Maintenance" · "Insight · CHC insights"', built: 'a Machinery group of the BUILT routes only: hire dashboard, hires, hire insights (E2); Maintenance (W408) waits for OPS-4b' },
  { id: 'fm_chain_ids_4', canon: 'FM :102-127 name W1838–W1859 as chain targets (survey C-14)', built: 'those files do not exist; the real chains are W3304–W3306 (chc mutate) and W3318–W3320 (equipment mutate) for 4a' },
  { id: 'chain_back', canon: 'W3305 / W3306 "Back to the screen" (no screen named)', built: 'Back → the page that opened the chain (`?act=` on W405, W407, W409 or W406)' },
  { id: 'insights_retry_decor', canon: 'FM:127 W409 "Retry" (`chain-mutate:chc`)', built: 'DECOR: W409 reads nothing, so its chain states say there is nothing to read again and offer no re-read' },
  { id: 'statuses_seven', canon: 'W405 "rental_status (verbatim, 8 values)"', built: 'the seven the machine moves through; "disputed" refused by name' },
  { id: 'counts_latest_n', canon: 'survey §1A "counts only as \'of the latest N shown\', the OW-6 snapshot rule"', built: 'the dashboard counts the latest 100 hires on your machines by the server\'s status and says how many it counted; older hires are said not to be counted' },
  { id: 'currency_inr', canon: 'survey E3 / brief §E2 "`formatMoneyMinor`, the tenant\'s currency"', built: 'the console\'s house shape (OPS-1a payout, OPS-2c billing, OPS-3c rates): `formatMoneyMinor(minor, \'INR\', lang)` — no read on these pages carries the organisation\'s currency' },
  { id: 'rate_days_text', canon: 'brief §E2 "its rate lines in words, with their dates"', built: 'FOUND ON THE WAY and fixed in the API: `equipment-rate.repository.ts` printed every line\'s day one day EARLY under an IST process (node-pg parses `date` at local midnight); the days are now read as text (pinned live, IST and UTC)' },
  { id: 'times_utc', canon: 'W407 "confirmed for [day]"', built: 'an instant is printed as the server\'s own date and minute, labelled UTC (the OPS-3b `atText`); a rate line\'s day as its own `YYYY-MM-DD`' },
]);

/** The verdict values. `pending_4b` / `pending_4c` are deleted from the type when the last of their files is decided (the 4c-7 rule). */
export type Ops4Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR' | 'pending_4b' | 'pending_4c';
export type Ops4Wave = '4a' | '4b' | '4c';
/** Every canon file of OPS-4 (30), each with ONE verdict: 4a decides its 10; 4b's 11 and 4c's 9 are pending. */
export const OPS4_CANON_FILES: readonly { file: string; wave: Ops4Wave; module: 'equipment' | 'livestock' | 'logistics'; verdict: Ops4Verdict; note: string }[] = Object.freeze([
  // ── 4a · THE HIRE (10) — decided (founder Q1-A via HOTFIX-13, Q2-A; Q3-A applied from OPS-1 Q2-A) ──
  { file: 'W405-ops-chc-dashboard.html', wave: '4a', module: 'equipment', verdict: 'BUILT (read)', note: '/chc/dashboard — a READ of your machines (GET /v1/equipment/assets?box=mine; category + registration number, never a person) linked to W406, and the hires on them counted by the server\'s status (GET /v1/equipment/rentals?box=owner, the latest 100, said so); no revenue, no %, no utilisation; the Q2 words; zero inputs' },
  { file: 'W406-ops-equipment-detail.html', wave: '4a', module: 'equipment', verdict: 'BUILT (read)', note: '/chc/equipment-detail?id= — ONE of your machines (another person\'s → not found): its facts, "engine hours as entered by the owner", its rate lines in words with their days (GET …/rates?assetId=), its maintenance entries as typed; no calendar, no next service, no GPS; zero inputs' },
  { file: 'W407-ops-chc-bookings.html', wave: '4a', module: 'equipment', verdict: 'BUILT (read)', note: '/chc/bookings — the hires on your machines (box=owner, keyset, a status filter): booking number, status, rate basis, the server\'s figures, whether the renter confirmed the hours, the dates; no renter name, no money button; the Q1 words + "No app for renters to confirm hours exists on this platform yet, so a hire billed above its deposit cannot be settled.", the Q2 and Q3 words; one input (the status filter)' },
  { file: 'W409-ops-chc-insights.html', wave: '4a', module: 'equipment', verdict: 'BUILT (honest)', note: '/chc/insights — reads nothing: no revenue, utilisation, subsidy or month-to-date figure is computed for machine hire; hours are typed; Retry DECOR; zero inputs' },
  { file: 'W3304-ops-chc-mutate-confirm.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '?act=confirm on W405 / W407 — "Retry": reading the page again changes nothing; the link IS a re-read of the page that opened it (on W409: nothing to read again)' },
  { file: 'W3305-ops-chc-mutate-success.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '?act=success — the page is read afresh each time it opens; nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3306-ops-chc-mutate-failure.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → the page that opened it; nobody is paged' },
  { file: 'W3318-ops-equipment-mutate-confirm.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '/chc/equipment-detail?id=&act=confirm — "Retry": the link IS a re-read of the machine' },
  { file: 'W3319-ops-equipment-mutate-success.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '?act=success — nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3320-ops-equipment-mutate-failure.html', wave: '4a', module: 'equipment', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → the machine; nobody is paged' },
  // ── 4b · THE RECORDS: UPKEEP AND ANIMALS (11) — pending (founder Q4-A, Q5-A applied by the lead) ──
  { file: 'W408-ops-chc-maintenance.html', wave: '4b', module: 'equipment', verdict: 'pending_4b', note: 'survey §1D: READ of the owner\'s machines\' entries + "Record a maintenance entry" REAL (after OPS4-B7)' },
  { file: 'W3300-ops-chc-form-form-error.html', wave: '4b', module: 'equipment', verdict: 'pending_4b', note: 'survey §1L: the maintenance entry\'s form-error state' },
  { file: 'W3301-ops-chc-form-review.html', wave: '4b', module: 'equipment', verdict: 'pending_4b', note: 'survey §1L: review' },
  { file: 'W3302-ops-chc-form-success.html', wave: '4b', module: 'equipment', verdict: 'pending_4b', note: 'survey §1L: success' },
  { file: 'W3303-ops-chc-form-failure.html', wave: '4b', module: 'equipment', verdict: 'pending_4b', note: 'survey §1L: failure' },
  { file: 'W394-ops-eartag-scan.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1I: HONEST under Q4-A' },
  { file: 'W395-ops-animal-register.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1J: HONEST under Q5-A' },
  { file: 'W396-ops-animal-transfer.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1K: HONEST under Q5-A' },
  { file: 'W3310-ops-eartag-mutate-confirm.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1Q: DECOR' },
  { file: 'W3311-ops-eartag-mutate-success.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1Q: DECOR' },
  { file: 'W3312-ops-eartag-mutate-failure.html', wave: '4b', module: 'livestock', verdict: 'pending_4b', note: 'survey §1Q: DECOR' },
  // ── 4c · THE SENSORS (9) — pending (founder Q6) ──
  { file: 'W400-ops-iot-dashboard.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1F: READ of signed loggers and subjects (after OPS4-B8)' },
  { file: 'W401-ops-iot-device.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1G: READ of one subject\'s trail' },
  { file: 'W404-ops-device-health.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1H: READ of server-flagged silences' },
  { file: 'W3326-ops-iot-mutate-confirm.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1P: PARITY-DECOR' },
  { file: 'W3327-ops-iot-mutate-success.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1P: PARITY-DECOR' },
  { file: 'W3328-ops-iot-mutate-failure.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1P: PARITY-DECOR' },
  { file: 'W3307-ops-device-mutate-confirm.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1O: PARITY-DECOR' },
  { file: 'W3308-ops-device-mutate-success.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1O: PARITY-DECOR' },
  { file: 'W3309-ops-device-mutate-failure.html', wave: '4c', module: 'logistics', verdict: 'pending_4c', note: 'survey §1O: PARITY-DECOR' },
]);

/** The six canon chain groups (survey §1L–§1Q, 19 files, each exactly once) and the wave that owns each. */
export const OPS4_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Ops4Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'chc_form', donor: 'W405 (comment) / trigger W408', wave: '4b', files: ['W3300', 'W3301', 'W3302', 'W3303'] },
  { id: 'chc_mutate', donor: 'W405', wave: '4a', files: ['W3304', 'W3305', 'W3306'] },
  { id: 'device_mutate', donor: 'W404', wave: '4c', files: ['W3307', 'W3308', 'W3309'] },
  { id: 'eartag_mutate', donor: 'W394', wave: '4b', files: ['W3310', 'W3311', 'W3312'] },
  { id: 'equipment_mutate', donor: 'W406', wave: '4a', files: ['W3318', 'W3319', 'W3320'] },
  { id: 'iot_mutate', donor: 'W400', wave: '4c', files: ['W3326', 'W3327', 'W3328'] },
]);

// ── THE BUILT CHAINS: each is a query state (`?act=`) of the page that opened it (the Ops3Chain shape). ──
export type Chain4Id = 'chc_act' | 'equipment_act';
export interface Chain4Def { id: Chain4Id; wave: Ops4Wave; kind: 'PARITY-DECOR'; param: 'act'; surface: Ops4Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[]; statement: string }
export const OPS4_CHAINS: readonly Chain4Def[] = Object.freeze([
  { id: 'chc_act', wave: '4a', kind: 'PARITY-DECOR', param: 'act', surface: 'chc_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.chcAct.${s}`, files: ['W3304', 'W3305', 'W3306'], statement: 'ops4.readsOnly' },
  { id: 'equipment_act', wave: '4a', kind: 'PARITY-DECOR', param: 'act', surface: 'equipment_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.eqAct.${s}`, files: ['W3318', 'W3319', 'W3320'], statement: 'ops4.readsOnly' },
]);
export function chain4ById(id: Chain4Id): Chain4Def { return OPS4_CHAINS.find((c) => c.id === id) as Chain4Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain4State(id: Chain4Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain4ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
