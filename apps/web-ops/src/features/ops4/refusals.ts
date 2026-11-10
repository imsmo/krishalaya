// apps/web-ops/src/features/ops4/refusals.ts · PC-56 OPS-4 — WHAT THE HIRE, UPKEEP, ANIMAL AND SENSOR PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops3/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it (persons, places, machines and figures
// anonymised) and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// (test/claims-guard.spec.ts, the `ops4.` scope) keeps the canon's false words out of every `ops4.` value.
//
// OPS-4 is three screen waves after HOTFIX-13 (founder, 2026-11-09; `05_OPS.md` "OPS-4 SPLIT"): 4a → 4b → 4c. This registry carries ALL 30 canon
// files. NAMED UPDATE (PC-56 OPS-4c): every file is decided (30 / 30); the `pending_*` verdicts are deleted from the type (the 4c-7 rule).
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
//
// OPS-4b · THE RECORDS: UPKEEP AND ANIMALS (founder Q4-A, Q5-A applied by the lead from HOTFIX-10 and OPS-1c Q8-A; the 4b first commit's API
// fixes) builds:
//   • `chc_maintenance` (W408, `/chc/maintenance`) — a READ of the signed-in person's machines' maintenance entries (type in words, day, cost "as
//     entered", engine hours as typed — never the typed note) and the server's two alerts for HER machines, in words; and ONE REAL act, "Record
//     a maintenance entry" (never "Log completion") on one of her machines, over `POST …/maintenance-logs` (owner only, keyed, not after the
//     organisation's today, recorded — the first commit). No days down, no %, no "real rent", no odometer, no technician.
//   • `chc_form` (W3300–W3303) — REAL: form-error = the refusal with the values kept; review = the entry as typed, "Recorded by you, as typed —
//     not a measurement."; success = the SERVER's id and entry; failure = the named refusal. Back → `/chc/maintenance` (never W405).
//   • `eartag` (W394), `animal_register` (W395), `animal_transfer` (W396) — HONEST in the OPS-1c kiosk chrome: read nothing, zero inputs; the Q4 /
//     Q5 words. Q4's second sentence ("An owner sees her animals and their tags in her own app.") is NOT printed — its premise is false at
//     merge: the owner's app shows only the last four digits of each tag (`(pashupalak)/animals/index.tsx`, `[id].tsx`) — reported, not reworded.
//   • `eartag_act` (W3310–W3312) — DECOR: its trigger is "Retry" on a page that reads nothing.
//
// OPS-4c · THE SENSORS (founder door Q6-A, applied by the lead from OPS-3 Q13-A and the OPS-3b lesson; the 4c first commit — OPS4-B8 / E13:
// the device fleet and the `device_silent` rule read registered loggers and their SIGNED readings only) builds:
//   • `iot_dashboard` (W400, `/iot/dashboard`) — a READ of the monitored subjects by type (`GET …/cold-chain/subjects`), each with its latest
//     reading, ITS SOURCE ("from the logger" / "typed by a person"), its own time, its age and the server's status; the breaches in 7 days and
//     the last breach as the server returns them; the registered loggers (`GET …/loggers`); soil pods and weather masts "registered: N ·
//     readings: none" from the twin registry's own counts when that read is on. No sum, no "online", no battery, no "right now".
//   • `iot_device` (W401, `/iot/device?type=&id=&hours=`) — a READ of one subject's trail over the server's hours window (a GET filter): each
//     point by its source with both times named, the band, its breaches, its logger's serial, the breach rule as the server implements it;
//     nothing drawn between points; no battery, calibration, cadence or annotation.
//   • `iot_health` (W404, `/iot/device-health`) — a READ of the loggers the server has flagged silent, each with its last signed reading's
//     receipt time and the alert state; the silence threshold is the server's own number (`silenceMinutes`), never written in the page.
//   • `iot_act` (W3326–W3328, on W400 and W401) and `device_act` (W3307–W3309, on W404) — PARITY-DECOR: "Retry" re-reads ("sync" refused by
//     name); query states of their parent (`?act=`); Back → the page that opened it.
//   Q6-A's FIRST sentence ("… signed by a registered device and timed by the server.") is NOT printed — its premise is false at merge: a signed
//   reading's `recorded_at` is the DEVICE's own clock (bounded by the server: refused if more than a minute ahead or a day old); the server
//   only records when it received it (`server_recorded_at`). Reported, not reworded.
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
/** The surfaces OPS-4b builds. */
export const SURFACES_4B: readonly Ops4Surface[] = ['chc_maintenance', 'chc_form', 'eartag', 'animal_register', 'animal_transfer', 'eartag_act'];
/** The surfaces OPS-4c builds. */
export const SURFACES_4C: readonly Ops4Surface[] = ['iot_dashboard', 'iot_device', 'iot_health', 'iot_act', 'device_act'];
// NAMED UPDATE (PC-56 OPS-4b): the console chrome refusals also print on the maintenance page (W408 carries the same chrome).
const CHC_PAGES: readonly Ops4Surface[] = ['chc_dashboard', 'chc_equipment', 'chc_bookings', 'chc_insights', 'chc_maintenance'];
const ANIMAL_PAGES: readonly Ops4Surface[] = ['eartag', 'animal_register', 'animal_transfer', 'eartag_act'];
const IOT_PAGES: readonly Ops4Surface[] = ['iot_dashboard', 'iot_device', 'iot_health'];

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
  // ══ OPS-4b · W408 · upkeep ══
  { id: 'days_down', canon: 'W408 rows "[machine] … breakdown · ₹[n] repair · [n] days down"', surfaces: ['chc_maintenance'],
    key: 'ops4.refusal.daysDown', why: 'FALSE: an entry has one day and no end; no downtime is recorded or worked out' },
  { id: 'preventive_pct', canon: 'W408 "Preventive vs breakdown — [n]% … [n]%"', surfaces: ['chc_maintenance'],
    key: 'ops4.refusal.preventivePct', why: 'a client percentage — refused (E3)' },
  { id: 'real_rent', canon: 'W408 "Downtime is the real rent" · "every booking it could not take that week is the real rent"', surfaces: ['chc_maintenance'],
    key: 'ops4.refusal.realRent', why: 'FALSE: no refused hire is recorded and no downtime is worked out' },
  { id: 'off_calendar', canon: 'W408 state "Breakdown open — A breakdown log with no completed_at keeps the asset off the booking calendar — no new booking can be confirmed against it"', surfaces: ['chc_maintenance', 'chc_form'],
    key: 'ops4.refusal.offCalendar', why: 'FALSE (pinned live, ops4b-records): an entry has no completion and does not change the machine\'s status; only the owner\'s status toggle does' },
  { id: 'log_completion', canon: 'W408 "Log completion" (FM:123 → W3300–W3303)', surfaces: ['chc_maintenance', 'chc_form'],
    key: 'ops4.refusal.logCompletion', why: 'no completion concept exists; the real act is "Record a maintenance entry"' },
  { id: 'odometer_sync', canon: 'W408 state "next-service list stale — Engine-hours haven\'t synced from a booking\'s odometer step"', surfaces: ['chc_maintenance'],
    key: 'ops4.refusal.odometerSync', why: 'FALSE: no odometer step, no sync; engine hours are typed' },
  { id: 'technician_only', canon: 'W408 state "Logging completion is technician-restricted — Any operator can report a breakdown; only the maintenance technician can log its completion"', surfaces: ['chc_maintenance'],
    key: 'ops4.refusal.technicianOnly', why: 'FALSE (C-15): no such role; after the first commit only the machine\'s owner records its maintenance' },
  // ══ the chc form chain (W3300–W3303) ══
  { id: 'form_maker_checker', canon: 'W3301 "Maker-checker friendly review step: everything you entered, shown read-only, with the diff against current values where applicable."', surfaces: ['chc_form'],
    key: 'ops4.refusal.formMakerChecker', why: 'no second person checks an entry; the review echoes what was typed' },
  { id: 'form_zero_sum', canon: 'W3302 "… Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['chc_form'],
    key: 'ops4.refusal.formZeroSum', why: 'FALSE: an entry moves no money — refused BY NAME (the entry IS recorded: one audit row)' },
  { id: 'form_view_audit', canon: 'W3302 "View audit trail"', surfaces: ['chc_form'],
    key: 'ops4.refusal.formViewAudit', why: 'no ops page shows the recorded changes' },
  { id: 'form_on_call', canon: 'W3303 "repeated failures page the on-call"', surfaces: ['chc_form'],
    key: 'ops4.refusal.formOnCall', why: 'no paging exists' },
  // ══ the animal pages (W394–W396) and the eartag chain (W3310–W3312) — kiosk chrome ══
  { id: 'kiosk_ambassador', canon: 'kiosk chrome "Ambassador: [name] · ✓ synced 2 min ago · Assisted session — every action recorded as assisted"', surfaces: ANIMAL_PAGES,
    key: 'ops4.refusal.kioskAmbassador', why: 'OPS-1c: her own sign-in; no name; nothing syncs; no assisted-act record exists for animals' },
  { id: 'tag_scanned', canon: 'W394 "Scanned · Pashu-Aadhaar [n] (12-digit INAPH) — [owner\'s name]\'s buffalo"', surfaces: ['eartag'],
    key: 'ops4.refusal.tagScanned', why: 'no scanner (a tag number is typed); the owner\'s name — WALL; Q4-A' },
  { id: 'tag_facts', canon: 'W394 "Breed [breed] · [n] years · lactation: mid · Yield [n] L/day · status: active"', surfaces: ['eartag'],
    key: 'ops4.refusal.tagFacts', why: 'Q4-A: a tag reveals nothing at the desk' },
  { id: 'tag_photo', canon: 'W394 state "Tag unreadable — manual 12-digit entry plus a photo"', surfaces: ['eartag'],
    key: 'ops4.refusal.tagPhoto', why: 'FALSE: no animal photo field exists' },
  { id: 'tag_query', canon: 'W394 states "tag-mismatch-species … opens a query" · "a query, not an accusation"', surfaces: ['eartag'],
    key: 'ops4.refusal.tagQuery', why: 'FALSE: no query exists' },
  { id: 'merge_desk', canon: 'W394 states "Duplicate tag … routed to the merge desk" · "Merge resolution is merge-desk-only"', surfaces: ['eartag', 'eartag_act'],
    key: 'ops4.refusal.mergeDesk', why: 'FALSE: a duplicate is refused at registration (PASHU_AADHAAR_EXISTS, no longer saying an animal exists); no merge desk' },
  { id: 'tag_new_registration', canon: 'W394 state "No tag yet — routes straight into new registration (W395)"', surfaces: ['eartag'],
    key: 'ops4.refusal.tagNewRegistration', why: 'Q5-A: registration is the owner\'s, in her own app' },
  { id: 'paravet', canon: 'W395 "Tag application · Applied by a licensed paravet (vet canon record)"', surfaces: ['animal_register'],
    key: 'ops4.refusal.paravet', why: 'FALSE: no paravet, no tag-applied record; LEGAL (INAPH)' },
  { id: 'photo_standard', canon: 'W395 "Photos MUST show the tag in the ear … the same photo standard the insurance desk trusts"', surfaces: ['animal_register'],
    key: 'ops4.refusal.photoStandard', why: 'FALSE: no animal photo field' },
  { id: 'inaph_linked', canon: 'W395 "Species, breed, approximate age, owner — captured once, straight into the INAPH-linked record; a new Pashu-Aadhaar issues from the registry, not from this kiosk"', surfaces: ['animal_register'],
    key: 'ops4.refusal.inaphLinked', why: 'FALSE: no INAPH integration; the owner types the tag number' },
  { id: 'register_drafts', canon: 'W395 states "Paravet unavailable … draft" · "Photo missing tag-in-ear" · "Breed uncertain … revisit flag"', surfaces: ['animal_register'],
    key: 'ops4.refusal.registerDrafts', why: 'FALSE ×3: no draft, photo or flag' },
  { id: 'transfer_order', canon: 'W396 "Via marketplace order [ref] · from [seller] to [buyer] · price ₹[n] (stored as price_minor, INR)"', surfaces: ['animal_transfer'],
    key: 'ops4.refusal.transferOrder', why: 'GAP-BE (C-10): `animal_ownership_transfers` has no writer; names — WALL' },
  { id: 'inaph_handshake', canon: 'W396 "inaph_synced: false — recorded here instantly; INAPH re-registration queues … ownership is real from the handshake"', surfaces: ['animal_transfer'],
    key: 'ops4.refusal.inaphHandshake', why: 'FALSE: no record, no queue, no handshake' },
  { id: 'insurance_follows', canon: 'W396 "Insurance follows ownership — a policy tied to [seller] prompts a re-assignment here"', surfaces: ['animal_transfer'],
    key: 'ops4.refusal.insuranceFollows', why: 'FALSE: `animals.insurance_policy_id` has no writer' },
  { id: 'transfer_states', canon: 'W396 states "INAPH sync delayed" · "Insurance not yet re-assigned" · "Price dispute … reopens the order" · "Buyer\'s first animal … owner profile created alongside"', surfaces: ['animal_transfer'],
    key: 'ops4.refusal.transferStates', why: 'FALSE ×4; the last would create an account for another person at a desk (OPS-1c Q9-A)' },
  { id: 'eartag_confirm_audit', canon: 'W3310 "Confirming writes an audit-trail entry with actor, time and reason."', surfaces: ['eartag_act'],
    key: 'ops4.refusal.eartagConfirmAudit', why: 'the page reads nothing and writes nothing' },
  { id: 'eartag_zero_sum', canon: 'W3311 "The change is applied and the audit trail has the entry (actor · time · reason). Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['eartag_act'],
    key: 'ops4.refusal.eartagZeroSum', why: 'FALSE: nothing was changed — refused BY NAME' },
  { id: 'eartag_on_call', canon: 'W3312 "repeated failures page the on-call"', surfaces: ['eartag_act'],
    key: 'ops4.refusal.eartagOnCall', why: 'no paging exists' },
  // ══ OPS-4c · the sensor pages (W400, W401, W404) — console chrome ══
  { id: 'iot_chrome_counts', canon: 'console chrome "[org] · Field Ops · IoT & machinery · sensors [n] · assets [n]"', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotChromeCounts', why: 'FALSE as counts (survey shared chrome): the pages list what the server returns; nothing is totalled' },
  { id: 'iot_centre_manager', canon: 'W400–W404 states "Operator vs centre manager — only the centre manager (MM) edits alert thresholds on W402 — maker-checker and versioned" · "only the centre manager can log a manual thermometer reading against this device or acknowledge a breach" · "only the centre manager can page the vet desk"', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotCentreManager', why: 'FALSE (C-15; OPS-3 Q14-A "signed in as you"): thresholds, breach acts and manual readings are `logistics.manage`\'s (`setThreshold` and `breachAct` recorded with a reason) — one person, no second checker' },
  { id: 'iot_search', canon: 'console chrome "Search devices/assets/insights… ⌘K" · "MM"', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotSearch', why: 'DECOR: no search route; no input but W401\'s hours window (E7)' },
  { id: 'iot_plan_settings', canon: 'flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotPlanSettings', why: 'the S1…S6 precedent: a switched-off module says it is switched off' },
  // ══ W400 · the dashboard ══
  { id: 'iot_fleet_sum', canon: 'W400 "[n] devices · [n] online · [n] silent over an hour · [n] battery-critical ([n] + [n] + [n] = [n])"', surfaces: ['iot_dashboard'],
    key: 'ops4.refusal.iotFleetSum', why: 'client sum refused (E3); "online" is not a state the server has; battery FALSE' },
  { id: 'iot_right_now', canon: 'W400 "[cooler] … is reading [n]°C right now"', surfaces: ['iot_dashboard'],
    key: 'ops4.refusal.iotRightNow', why: 'a reading is shown with its source, its own time and its age — never as "right now"' },
  { id: 'iot_soil_readings', canon: 'W400 "Soil-moisture pods [n] / Weather masts [n] — generic device registry … readings shown here, the table underneath still to be built"', surfaces: ['iot_dashboard', 'iot_health'],
    key: 'ops4.refusal.iotSoilReadings', why: 'FALSE (C-17, founder TENANT-12 "device registry only, readings refused"): registered only; no reading is received' },
  { id: 'iot_incident_file', canon: 'W400 "✓ 0 active breaches. Last breach [day] — resolved. View the incident file (→ W403)"', surfaces: ['iot_dashboard'],
    key: 'ops4.refusal.iotIncidentFile', why: 'W403 is OPS-5\'s and not built: no link until it is' },
  { id: 'iot_sync', canon: 'W400 state "Device registry sync error … Retry sync" (FM:106 → W3326)', surfaces: ['iot_dashboard', 'iot_act'],
    key: 'ops4.refusal.iotSync', why: 'FALSE: nothing syncs; Retry re-reads the page (PARITY-DECOR)' },
  { id: 'iot_promise_keeper', canon: 'W400 "a sensor is a promise-keeper on battery"', surfaces: ['iot_dashboard'],
    key: 'ops4.refusal.iotPromiseKeeper', why: 'FALSE: no battery is recorded' },
  // ══ the three pages: battery, calibration ══
  { id: 'iot_battery', canon: 'W400 "[n] battery-critical" · W401 "Battery [n]% healthy" · W404 "[vaccine box] battery [n]%"', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotBattery', why: 'FALSE: no column anywhere records a battery (pinned: no route, no column)' },
  { id: 'iot_calibration', canon: 'W401 "Calibration due [date]" · state "Calibration overdue … readings … flagged unverified until a technician confirms the offset" · W404 "Calibration due within 30 days — [n] devices … Each date is recorded on the device record, never estimated"', surfaces: IOT_PAGES,
    key: 'ops4.refusal.iotCalibration', why: 'FALSE: no calibration date exists; no technician role (C-15)' },
  // ══ W401 · one subject ══
  { id: 'iot_cadence', canon: 'W401 "reading cadence every [n] min" · "Reading cadence [n] min · recorded_at, cold_chain_logs"', surfaces: ['iot_device'],
    key: 'ops4.refusal.iotCadence', why: 'FALSE: no cadence is set or recorded' },
  { id: 'iot_alarm_minutes', canon: 'W401 "Alarm fires at [n] minutes above [n]°C after fill stabilises"', surfaces: ['iot_device'],
    key: 'ops4.refusal.iotAlarmMinutes', why: 'FALSE: the breach rule is two consecutive signed readings outside the band (0201 cold_chain_breach_on_reading)' },
  { id: 'iot_annotation', canon: 'W401 "Evidence rule: raw readings are immutable … a correction is a new annotation on the reading"', surfaces: ['iot_device'],
    key: 'ops4.refusal.iotAnnotation', why: '"immutable" TRUE (kv_app holds no UPDATE); "annotation" FALSE — no annotation table' },
  { id: 'iot_line', canon: 'W401 "Temperature trail — last [n] hours" (a line drawn through the readings)', surfaces: ['iot_device'],
    key: 'ops4.refusal.iotLine', why: 'the server\'s points only; nothing between two readings is drawn or estimated' },
  { id: 'iot_manual_protocol', canon: 'W401 / W404 "manual thermometer protocol active"', surfaces: ['iot_device', 'iot_health'],
    key: 'ops4.refusal.iotManualProtocol', why: 'FALSE: no protocol switch exists; a typed reading is labelled typed by a person' },
  // ══ W404 · device health ══
  { id: 'iot_own_threshold', canon: 'W404 "A silent sensor is a question, not an answer — [n] devices silent past their own threshold + [n] battery-critical, out of [n]"', surfaces: ['iot_health'],
    key: 'ops4.refusal.iotOwnThreshold', why: 'FALSE: one platform number (`COLD_CHAIN_SILENCE_MINUTES`) decides a server-flagged silence; "out of [n]" is a total' },
  { id: 'iot_likely_cause', canon: 'W404 table "Likely cause" · "signal / telecom outage"', surfaces: ['iot_health'],
    key: 'ops4.refusal.iotLikelyCause', why: 'FALSE: no cause is recorded or guessed; no signal is measured' },
  { id: 'iot_field_visit', canon: 'W404 "Action: field visit queued" · state "Field visit overdue … until a technician logs the visit"', surfaces: ['iot_health'],
    key: 'ops4.refusal.iotFieldVisit', why: 'FALSE: no visit, queue or technician exists' },
  { id: 'iot_paged', canon: 'W404 "vet desk paged" · state "only the centre manager can page the vet desk or close a battery-critical flag"', surfaces: ['iot_health'],
    key: 'ops4.refusal.iotPaged', why: 'FALSE: nothing pages; a silence is alerted to the people named on the organisation\'s rules ("alerted, not called")' },
  // ══ the two mutate chains (W3326–W3328 iot, W3307–W3309 device) ══
  { id: 'iot_confirm_audit', canon: 'W3326 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['iot_act'],
    key: 'ops4.refusal.iotConfirmAudit', why: 'reading a page again writes nothing' },
  { id: 'iot_zero_sum', canon: 'W3327 "The change is applied and the audit trail has the entry (actor · time · reason · before/after). Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['iot_act'],
    key: 'ops4.refusal.iotZeroSum', why: 'FALSE on a re-read — refused BY NAME' },
  { id: 'iot_on_call', canon: 'W3328 "repeated failures page the on-call"', surfaces: ['iot_act'],
    key: 'ops4.refusal.iotOnCall', why: 'no paging exists' },
  { id: 'device_confirm_audit', canon: 'W3307 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['device_act'],
    key: 'ops4.refusal.deviceConfirmAudit', why: 'reading a page again writes nothing' },
  { id: 'device_zero_sum', canon: 'W3308 "The change is applied and the audit trail has the entry … Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['device_act'],
    key: 'ops4.refusal.deviceZeroSum', why: 'FALSE on a re-read — refused BY NAME' },
  { id: 'device_on_call', canon: 'W3309 "repeated failures page the on-call"', surfaces: ['device_act'],
    key: 'ops4.refusal.deviceOnCall', why: 'no paging exists' },
]);
export function ops4RefusalKeys(surface: Ops4Surface): string[] { return OPS4_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS4_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_chc', canon: 'W405 / W406 / W407 / W409 canon routes `chc/dashboard`, `chc/equipment-detail`, `chc/bookings`, `chc/insights`', built: 'the four at their canon addresses; W406 takes `?id=` (one machine)' },
  { id: 'equipment_redirect', canon: 'OW-3 `/equipment` (the hire queue, the asset table, the tag lookup) and `/equipment/[id]` (quote, start, complete, settle, cancel)', built: 'REAL 307s (next.config.js, permanent: false): `/equipment` → `/chc/dashboard`, `/equipment/:id` → `/chc/bookings`; both OW-3 pages and their server action are deleted' },
  { id: 'money_acts_removed', canon: 'OW-3 `/equipment/[id]` quote · start · complete · settle (a live owner money desk on this console, over the wrong list — survey F-5)', built: 'founder Q3-A: removed. The owner\'s mobile app has all four (`apps/mobile/src/app/(equipment)/rentals/[id].tsx`). No web-ops source calls settleRental, quoteRental, startRental, completeRental, confirmRental or confirmRentalUsage (source assertion)' },
  // NAMED UPDATE (PC-56 OPS-4b): the leftover normaliser is now deleted too.
  { id: 'tag_lookup_removed', canon: 'OW-3 / PC-55 B5 ear-tag lookup on `/equipment` (`livestock.animals({ box: \'all\', pashuAadhaar })`)', built: 'gone with its route: `/equipment` is a 307 (survey Q4-A, applied by the lead: "This desk does not look up animals by tag"); its `tag.` keys are deleted; OPS-4b deleted `features/equipment/ear-tag.ts` and its tests (no caller remained)' },
  { id: 'owner_list_box', canon: 'survey C-13 — the SDK left `box` undefined, so `/equipment` listed the signed-in person\'s OWN hires as a renter', built: 'the SDK makes `box` required (typed and checked); `/chc/*` read `box=owner`; `/insights`\'s rentals snapshot reads `box=owner` too (a NAMED change: it had read the renter list)' },
  { id: 'w406_edges', canon: 'W406 is reached only by its own chain (survey §1B)', built: 'drawn: each machine row on W405 and each hire\'s machine on W407 links `/chc/equipment-detail?id=`' },
  // NAMED UPDATE (PC-56 OPS-4b): Maintenance joined the group when W408 was built.
  { id: 'sidebar_built_only', canon: 'console sidebar "Machinery (CHC) · CHC dashboard · Bookings · Maintenance" · "Insight · CHC insights"', built: 'a Machinery group of the BUILT routes only: hire dashboard, hires, maintenance (OPS-4b, W408), hire insights (E2)' },
  { id: 'fm_chain_ids_4', canon: 'FM :102-127 name W1838–W1859 as chain targets (survey C-14)', built: 'those files do not exist; the real chains are W3304–W3306 (chc mutate) and W3318–W3320 (equipment mutate) for 4a' },
  { id: 'chain_back', canon: 'W3305 / W3306 "Back to the screen" (no screen named)', built: 'Back → the page that opened the chain (`?act=` on W405, W407, W409 or W406)' },
  { id: 'insights_retry_decor', canon: 'FM:127 W409 "Retry" (`chain-mutate:chc`)', built: 'DECOR: W409 reads nothing, so its chain states say there is nothing to read again and offer no re-read' },
  { id: 'statuses_seven', canon: 'W405 "rental_status (verbatim, 8 values)"', built: 'the seven the machine moves through; "disputed" refused by name' },
  { id: 'counts_latest_n', canon: 'survey §1A "counts only as \'of the latest N shown\', the OW-6 snapshot rule"', built: 'the dashboard counts the latest 100 hires on your machines by the server\'s status and says how many it counted; older hires are said not to be counted' },
  { id: 'currency_inr', canon: 'survey E3 / brief §E2 "`formatMoneyMinor`, the tenant\'s currency"', built: 'the console\'s house shape (OPS-1a payout, OPS-2c billing, OPS-3c rates): `formatMoneyMinor(minor, \'INR\', lang)` — no read on these pages carries the organisation\'s currency' },
  { id: 'rate_days_text', canon: 'brief §E2 "its rate lines in words, with their dates"', built: 'FOUND ON THE WAY and fixed in the API: `equipment-rate.repository.ts` printed every line\'s day one day EARLY under an IST process (node-pg parses `date` at local midnight); the days are now read as text (pinned live, IST and UTC)' },
  { id: 'times_utc', canon: 'W407 "confirmed for [day]"', built: 'an instant is printed as the server\'s own date and minute, labelled UTC (the OPS-3b `atText`); a rate line\'s day as its own `YYYY-MM-DD`' },
  // ── OPS-4b ──
  { id: 'route_4b', canon: 'W408 `chc/maintenance`; W394 `animals/eartag-scan`, W395 `animals/register`, W396 `animals/transfer`', built: 'the four at their canon addresses' },
  { id: 'record_entry', canon: 'W408 "Log completion" (FM:123, `chain-form:chc`)', built: 'REAL as "Record a maintenance entry": `POST /v1/equipment/assets/:id/maintenance-logs` — the owner only, keyed (a key minted when the review is shown, so a double submit replays), not after the organisation\'s today, one audit row (the 4b first commit)' },
  { id: 'chc_form_back', canon: 'W3300 "Back to the form", W3303 "Retry — back to confirm" / "Back" → W405 (survey §1L canon defect)', built: 'every state\'s Back → `/chc/maintenance`, the page that opened the form' },
  { id: 'form_fields', canon: 'survey §1L "log type, date, typed cost as a minor string, engine hours one decimal"', built: 'the form takes the machine (one of hers), the log type, the day, the cost in rupees as typed (turned into a minor-unit string by moving the decimal point — no arithmetic), engine hours to one decimal; the API\'s free-text note is NOT offered and NOT printed on this console (a typed note may carry a person\'s name)' },
  { id: 'maint_scope', canon: 'W408 the fleet\'s entries', built: 'the entries of the first 20 of her machines (one read per machine; said so when she lists more); the alerts for her machines only (`GET maintenance/alerts`, the 4b API fix)' },
  { id: 'maintenance_status_truth', canon: 'W408 "keeps the asset off the booking calendar"', built: 'the page prints what the code proves: an entry does not change the machine\'s status; while its status is "in maintenance" no hire can be requested for it (`isBookable`)' },
  { id: 'animals_kiosk_chrome', canon: 'W394–W396 kiosk chrome "[org] · [kiosk] · Ambassador: [name] · ✓ synced …"', built: 'the OPS-1c kiosk statement (`KioskStatement`: the desk creates an account for a new number; everything after that she does herself) — no name, no sync, no assisted-act claim' },
  { id: 'animals_edges', canon: 'W395 and W396 have 0 inbound links; W394 only its own chain (survey §0 header)', built: 'drawn: the kiosk home (W380) links all three animal pages; each animal page links the other two and the kiosk home' },
  { id: 'eartag_decor', canon: 'FM:102 W394 "Retry" (`chain-mutate:eartag`)', built: 'DECOR: W394 reads nothing; `?act=` states say there is nothing to read again, offer no re-read, and go Back to W394' },
  { id: 'q4_second_sentence', canon: 'brief §D Q4-A "An owner sees her animals and their tags in her own app."', built: 'PREMISE FALSE — NOT PRINTED: the owner\'s app lists her animals but shows only the last four digits of each tag ("••••" + 4). Only "This desk does not look up animals by tag." is printed; the lead / founder owns the replacement words' },
  // ── OPS-4c ──
  { id: 'route_4c', canon: 'W400 `iot/dashboard`, W401 `iot/device`, W404 `iot/device-health`', built: 'the three at their canon addresses; W401 takes `?type=&id=` (one monitored subject — the canon\'s "device" is a subject with a logger mounted on it) and `?hours=` (a GET filter)' },
  { id: 'devices_redirect', canon: 'OW-7 `/devices` "sensors we have heard from" (survey C-12: built on typed `device_ref`s)', built: 'a REAL 307 (next.config.js, permanent: false): `/devices` → `/iot/dashboard`; the OW-7 fleet page is deleted with its superseded `iot.` keys; `/devices/rules` and `/devices/alerts` stay for OPS-5 (their back link now names `/iot/dashboard`)' },
  { id: 'device_truth', canon: 'survey F-4 / E13 — the fleet and `device_silent` grouped `device_ref`, which only a MANUAL reading writes', built: 'the 4c first commit (OPS4-B8): both read registered loggers and their SIGNED readings only (`source = \'device\'`, by `device_id`); the typed list is retired; the alert names the logger by its serial (pinned live, ops4c-sensors)' },
  { id: 'q6_first_sentence', canon: 'brief §D Q6-A "Readings marked \'from the logger\' were signed by a registered device and timed by the server."', built: 'PREMISE FALSE — NOT PRINTED: a signed reading\'s time is the DEVICE\'s own clock (0201: refused if more than 1 minute ahead or 24 hours old); the server records when it received it. The other two Q6 sentences are printed; the lead / founder owns the replacement words' },
  { id: 'soil_registry_counts', canon: 'W400 "Soil-moisture pods [n] / Weather masts [n]"', built: 'the twin registry\'s OWN counts (`GET /v1/twin/overview` `devices.soilPods` / `weatherMasts`, behind `digital_twin`) with "readings: none"; when that read is off or refused, nothing is said about them beyond the Q6 sentence' },
  { id: 'w401_edges', canon: 'W401 is reached from W400 only (survey §1G)', built: 'drawn: each subject row on W400 links `/iot/device?type=&id=`; W404 links its logger\'s subject when the server names it' },
  { id: 'sidebar_sensors', canon: 'console sidebar "Sensors · IoT dashboard · Device health · Alert rules"', built: 'a Sensors group of the BUILT routes only: the sensor dashboard and device health (Alert rules, W402, is OPS-5\'s — `/devices/rules` keeps its own link)' },
  { id: 'cooler_label', canon: 'brief §D PII "a cooler by its centre code"', built: 'a subject is printed by the SERVER\'s label (`subjects`: a shipment by its AWB number or reference, a cooler by its serial or model or reference) and its type; the subjects read carries no centre code — no person, no farmer, ever' },
  { id: 'iot_chains_back', canon: 'W3327 / W3328 / W3308 / W3309 "Back to the screen" (no screen named)', built: 'Back → the page that opened the chain (`?act=` on W400, W401 — keeping its subject — or W404); never another page' },
  { id: 'times_utc_4c', canon: 'W401 "recorded_at, cold_chain_logs"', built: 'each instant is printed as the server\'s own date and minute, labelled UTC (the OPS-3b `atText`); a reading\'s age is whole minutes before the page was read' },
]);

/** The verdict values. */
// NAMED UPDATE (PC-56 OPS-4b): `pending_4b` is deleted from the type — its last file is decided (the 4c-7 rule).
// NAMED UPDATE (PC-56 OPS-4c): `pending_4c` is deleted too — all 30 files are decided (the PARTNER-4c precedent).
export type Ops4Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR';
export type Ops4Wave = '4a' | '4b' | '4c';
/** Every canon file of OPS-4 (30), each with ONE verdict: 4a decides its 10, 4b its 11, 4c its 9. */
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
  // ── 4b · THE RECORDS: UPKEEP AND ANIMALS (11) — decided (founder Q4-A, Q5-A applied by the lead; the 4b first commit) ──
  { file: 'W408-ops-chc-maintenance.html', wave: '4b', module: 'equipment', verdict: 'REAL', note: '/chc/maintenance — a READ of your machines\' maintenance entries (type in words, day, cost "as entered", engine hours as typed; never the note) and the server\'s two alerts for your machines in words; "Record a maintenance entry" REAL (owner only, keyed, not after the organisation\'s today, recorded); no days down, no %, no real rent, no odometer, no technician; Retry PARITY-DECOR; the form\'s five inputs are the only inputs' },
  { file: 'W3300-ops-chc-form-form-error.html', wave: '4b', module: 'equipment', verdict: 'REAL', note: '?form=error — the refusal by name (a field rule, or the API\'s 422) with the values kept; Back → /chc/maintenance' },
  { file: 'W3301-ops-chc-form-review.html', wave: '4b', module: 'equipment', verdict: 'REAL', note: '?form=review — the entry as typed: "Recorded by you, as typed — not a measurement."; one submit (the key minted here); Back → /chc/maintenance' },
  { file: 'W3302-ops-chc-form-success.html', wave: '4b', module: 'equipment', verdict: 'REAL', note: '?form=success — the SERVER\'s id and the entry as it stored it; the zero-sum sentence refused BY NAME' },
  { file: 'W3303-ops-chc-form-failure.html', wave: '4b', module: 'equipment', verdict: 'REAL', note: '?form=failure — the named refusal (MAINTENANCE_NOT_YOUR_MACHINE, MAINTENANCE_DATE_IN_FUTURE, …); nothing was recorded; Back → /chc/maintenance (never W405)' },
  { file: 'W394-ops-eartag-scan.html', wave: '4b', module: 'livestock', verdict: 'BUILT (honest)', note: '/animals/eartag-scan — reads nothing, zero inputs, kiosk chrome; "This desk does not look up animals by tag." ×3 (Q4\'s second sentence NOT printed: premise false); Retry DECOR' },
  { file: 'W395-ops-animal-register.html', wave: '4b', module: 'livestock', verdict: 'BUILT (honest)', note: '/animals/register — reads nothing, zero inputs, kiosk chrome; "An animal is registered by its owner in her own app. This desk does not register animals." ×3; reached from the kiosk home' },
  { file: 'W396-ops-animal-transfer.html', wave: '4b', module: 'livestock', verdict: 'BUILT (honest)', note: '/animals/transfer — reads nothing, zero inputs, kiosk chrome; "Ownership transfer is not available on this platform yet. Nothing here changes who owns an animal." ×3; reached from the kiosk home' },
  { file: 'W3310-ops-eartag-mutate-confirm.html', wave: '4b', module: 'livestock', verdict: 'DECOR', note: '/animals/eartag-scan?act=confirm — W394 reads nothing: there is nothing to read again; no re-read; Back → W394' },
  { file: 'W3311-ops-eartag-mutate-success.html', wave: '4b', module: 'livestock', verdict: 'DECOR', note: '?act=success — nothing was changed; the zero-sum sentence refused BY NAME; Back → W394' },
  { file: 'W3312-ops-eartag-mutate-failure.html', wave: '4b', module: 'livestock', verdict: 'DECOR', note: '?act=failure — nothing was changed; nobody is paged; Back → W394' },
  // ── 4c · THE SENSORS (9) — decided (founder door Q6-A, applied by the lead; the 4c first commit, OPS4-B8 / E13) ──
  { file: 'W400-ops-iot-dashboard.html', wave: '4c', module: 'logistics', verdict: 'BUILT (read)', note: '/iot/dashboard — the monitored subjects by type (GET …/cold-chain/subjects), each with its latest reading, its source ("from the logger" / "typed by a person"), its own time, its age and the server\'s status, linked to W401; breaches in 7 days and the last breach as the server returns them; the registered loggers; soil pods and weather masts "registered: N · readings: none"; no sum, no online, no battery, no right now; Retry PARITY-DECOR ("sync" refused)' },
  { file: 'W401-ops-iot-device.html', wave: '4c', module: 'logistics', verdict: 'BUILT (read)', note: '/iot/device?type=&id=&hours= — one subject\'s trail over the server\'s hours window (a GET filter): each point by its source, "the device\'s time" / "the time the person recorded it" and "received by the server", the band, its breaches, its logger\'s serial, the breach rule as the server implements it (two signed readings in a row outside the band); nothing drawn between points; no battery, calibration, cadence or annotation' },
  { file: 'W404-ops-device-health.html', wave: '4c', module: 'logistics', verdict: 'BUILT (read)', note: '/iot/device-health — the loggers the server has flagged silent (GET …/loggers silences), each with its last signed reading\'s receipt time, when it was flagged and the alert state; the silence threshold is the server\'s own number (silenceMinutes), never written in the page; no cause, action, battery, calibration, field visit or paging' },
  { file: 'W3326-ops-iot-mutate-confirm.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '?act=confirm on W400 / W401 — "Retry sync" is refused: nothing syncs; the link IS a re-read of the page that opened it' },
  { file: 'W3327-ops-iot-mutate-success.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '?act=success — the page is read afresh each time it opens; nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3328-ops-iot-mutate-failure.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → the page that opened it (W400, or W401 with its subject); nobody is paged' },
  { file: 'W3307-ops-device-mutate-confirm.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '/iot/device-health?act=confirm — "Retry": the link IS a re-read of W404' },
  { file: 'W3308-ops-device-mutate-success.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '?act=success — nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3309-ops-device-mutate-failure.html', wave: '4c', module: 'logistics', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → /iot/device-health (W404); nobody is paged' },
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

// ── THE BUILT CHAINS: each is a query state of the page that opened it (the Ops3Chain shape): `?act=` for the mutate chains, `?form=` for the
// chc form (OPS-4b, REAL — the maintenance entry). ──
export type Chain4Id = 'chc_act' | 'equipment_act' | 'chc_form' | 'eartag_act' | 'iot_act' | 'device_act';
export interface Chain4Def { id: Chain4Id; wave: Ops4Wave; kind: 'PARITY-DECOR' | 'REAL' | 'DECOR'; param: 'act' | 'form'; surface: Ops4Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[]; statement: string }
export const OPS4_CHAINS: readonly Chain4Def[] = Object.freeze([
  { id: 'chc_act', wave: '4a', kind: 'PARITY-DECOR', param: 'act', surface: 'chc_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.chcAct.${s}`, files: ['W3304', 'W3305', 'W3306'], statement: 'ops4.readsOnly' },
  { id: 'equipment_act', wave: '4a', kind: 'PARITY-DECOR', param: 'act', surface: 'equipment_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.eqAct.${s}`, files: ['W3318', 'W3319', 'W3320'], statement: 'ops4.readsOnly' },
  { id: 'chc_form', wave: '4b', kind: 'REAL', param: 'form', surface: 'chc_form', states: ['error', 'review', 'success', 'failure'], key: (s: string) => `ops4.chain.chcForm.${s}`, files: ['W3300', 'W3301', 'W3302', 'W3303'], statement: 'ops4.upkeep.ownerOnly' },
  { id: 'eartag_act', wave: '4b', kind: 'DECOR', param: 'act', surface: 'eartag_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.eartagAct.${s}`, files: ['W3310', 'W3311', 'W3312'], statement: 'ops4.q4.words' },
  // PC-56 OPS-4c: the sensor pages' two mutate chains, PARITY-DECOR — "Retry" (W400's "Retry sync", W401's, W404's) re-reads the page that opened it.
  { id: 'iot_act', wave: '4c', kind: 'PARITY-DECOR', param: 'act', surface: 'iot_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.iotAct.${s}`, files: ['W3326', 'W3327', 'W3328'], statement: 'ops4.iot.readsOnly' },
  { id: 'device_act', wave: '4c', kind: 'PARITY-DECOR', param: 'act', surface: 'device_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops4.chain.deviceAct.${s}`, files: ['W3307', 'W3308', 'W3309'], statement: 'ops4.iot.readsOnly' },
]);
export function chain4ById(id: Chain4Id): Chain4Def { return OPS4_CHAINS.find((c) => c.id === id) as Chain4Def; }
/** The chain state a page was opened in (`?act=confirm`, `?form=review` …), or null for the page itself / an unknown state. */
export function chain4State(id: Chain4Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain4ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
