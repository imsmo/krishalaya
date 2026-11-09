// apps/web-ops/src/features/ops3/refusals.ts · PC-56 OPS-3 — WHAT THE DAIRY COUNTER'S PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops2/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it and the surfaces that PRINT it (a sentence that
// says no — never an offer); the render tests read this map, and the claims guard (test/claims-guard.spec.ts, the `ops3.` scope) keeps the canon's
// false words out of every `ops3.` value. No canon person, member, centre, card number, place or figure appears in any value.
//
// OPS-3 is three waves (founder, 2026-11-08; `05_OPS.md` "OPS-3 SPLIT"): 3c → 3a → 3b. This registry carries ALL 23 canon files; the files of the
// waves not yet built stay `pending_3a` / `pending_3b` until their wave decides them (the 4c-7 rule: the value is deleted from the type when the
// last of its files is decided).
//
// OPS-3c · THE PRICE (founder Q1-A — built in HOTFIX-12 —, Q8-A, Q10-A, Q14-A, Q15-A, 2026-11-08) builds:
//   • `rates` (W368, `/rates`) — a READ of the organisation's APPROVED milk rate cards (`GET /v1/dairy/rate-cards?activeOnly=true`, which since
//     HOTFIX-12 means approved and active), each with its name, milk type, pricing model in words, the fat / SNF / base rates through the money
//     formatter ("per kg of fat", "per kg of SNF", "per kg of milk" — Q8-A), the days it covers, its approval state and its premium slabs; whether
//     premium slabs are being paid (the `dairy_bonus_slabs` switch, read from `GET /v1/config/flags`); the rule in WORDS, never a sum; two
//     approved cards covering one day for one milk type raised as an ERROR; the change sentence (only clauses the code proves at merge). No
//     ready-reckoner, no worked example, no poster, no change button, no input.
//   • `rate_export` (W3338–W3339) — DECOR (Q15-A: the poster is refused; no producer).
//   • `rate_act` (W3340–W3342) — PARITY-DECOR: its only trigger is "Retry" on a read; the confirm state links a plain re-read of `/rates`.
//
// OPS-3a · THE COUNTER (founder Q2-A, Q3-A, Q4-A, Q5-A, Q9-A, Q9b-A, Q10-A, Q11-A, Q14-A, Q8-A, 2026-11-08) builds:
//   • `pos_home` (W360, `/pos/home`) — a READ of the counter's centre (the active centres in the signed-in person's OPEN custody,
//     `GET /v1/dairy/mccs/mine`) and its day sheet per shift (`GET …/d2c/mccs/:mccId/day-summary` for the organisation's today): pours, kg,
//     the priced sum labelled, the server's split by hold state (OPS3-B15 — payable / held / rejected), the flagged count; the centre's
//     recorded shift hours or "not recorded"; links to record, problems and the shift totals.
//   • `pos_collect` (W361, `/pos/collect`) → `pos_quality` (W362, `/pos/quality`) — THE RECORD ACT, REAL: the centre's roll by member code
//     (box=mcc, keyset, a code search — OPS3-B14), shift, date (the organisation's today by default, never after it), weight, fat, SNF,
//     flags, typed; then the check step ("typed by the person at this counter — not read from a scale or an analyser; her pay is computed
//     from them and they cannot be changed afterwards") → "Record this pour" → the pos chain (W3335–W3337).
//   • `pos_slip` (W363, `/pos/slip`) — "What was recorded": the server's answer to the record act (member code, the readings, the server's
//     price, the card's name and start date, the hold), where she sees it (her milk diary) and how she objects (her bill's window).
//   • `pos_exceptions` (W364, `/pos/exceptions`) — HONEST: reads nothing; what this counter cannot do and what she can do.
//   • `pos_shift` (W365, `/pos/shift-close`) — a READ of the shift's server totals, labelled, and the cooler's last STATED level and its
//     latest reading with their times; "Close shift" refused by name; no difference worked out on the page.
//   • `pos_act` (W3335–W3337) — REAL: confirm = the check step; success = the record's answer on `/pos/slip`; failure = "Nothing was
//     recorded" + the server's named reason. "Retry" on W363 / W365 is a re-read (PARITY-DECOR); W364's Retry is DECOR (it reads nothing).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops3Surface =
  // the eight pages (survey E5)
  | 'pos_home' | 'pos_collect' | 'pos_quality' | 'pos_slip' | 'pos_exceptions' | 'pos_shift' | 'bmc' | 'rates'
  // the chains
  | 'pos_act' | 'bmc_form' | 'bmc_act' | 'rate_export' | 'rate_act';
export interface Ops3Refusal { id: string; canon: string; surfaces: readonly Ops3Surface[]; key: string; why: string }

/** The surfaces OPS-3c builds. */
export const SURFACES_3C: readonly Ops3Surface[] = ['rates', 'rate_export', 'rate_act'];
/** The surfaces OPS-3a builds. */
export const SURFACES_3A: readonly Ops3Surface[] = ['pos_home', 'pos_collect', 'pos_quality', 'pos_slip', 'pos_exceptions', 'pos_shift', 'pos_act'];
const RATE_ALL: readonly Ops3Surface[] = ['rates', 'rate_export', 'rate_act'];
const POS_PAGES: readonly Ops3Surface[] = ['pos_home', 'pos_collect', 'pos_quality', 'pos_slip', 'pos_exceptions', 'pos_shift'];

export const OPS3_REFUSALS: readonly Ops3Refusal[] = Object.freeze([
  // ══ W368 · the rate card (founder Q1-A, Q8-A, Q15-A) ══
  { id: 'card_number', canon: 'W368 heading "Rate card [ref] — public math, same for everyone"', surfaces: ['rates'],
    key: 'ops3.refusal.cardNumber', why: 'FALSE: a card has no number or code column (0009 `milk_rate_cards`); it is shown by its own name' },
  { id: 'versioned', canon: 'W368 "v3 effective 01 Jul (versioned — every pour stores its rate_card_id, so old slips recompute forever)"', surfaces: ['rates'],
    key: 'ops3.refusal.versioned', why: 'FALSE (survey C-9): no version column; "every pour stores its rate_card_id" is true (0009:301); a pour is never priced again — its stored amount is the money' },
  { id: 'never_quietly', canon: 'W368 "Version history — rates never change quietly · v3 … v2 … v1"', surfaces: ['rates'],
    key: 'ops3.refusal.neverQuietly', why: 'refused by the founder\'s wording rule (OPS-3 brief §D): only the HOTFIX-12 facts the code proves are said; there is no version history' },
  { id: 'announced_ahead', canon: 'W368 "Every change announced 7 days ahead on the counter poster, the app and SMS — a rate that surprises the queue is a rate done wrong."', surfaces: ['rates'],
    key: 'ops3.refusal.announcedAhead', why: 'FALSE: no notice period exists; a card starts on the organisation\'s tomorrow at the earliest (HOTFIX-12) and members are sent a push / in-app notice at approval' },
  { id: 'sms', canon: 'W368 "… the app and SMS"', surfaces: ['rates'],
    key: 'ops3.refusal.sms', why: 'FALSE: the approval notice is push and in-app only (seed 0007 `dairy.rate_card_approved` channels); no SMS is sent' },
  { id: 'board_minute', canon: 'W368 state "Rates are the FPO board\'s — … Changing needs the tenant dairy desk + board minute reference — recorded."', surfaces: ['rates'],
    key: 'ops3.refusal.boardMinute', why: 'FALSE: no board-minute field exists on a card (0009, 0234)' },
  { id: 'poster', canon: 'W368 "Print counter poster (A2, [lang])" (FM:52, `chain-export:rate` → W3338–W3339) · "Bonus slabs … print with the card … and the poster says that too."', surfaces: ['rates', 'rate_export'],
    key: 'ops3.refusal.poster', why: 'GAP-BE + founder Q15-A: nothing produces a poster; no `dairy.rate_card` dataset on the export plane' },
  { id: 'ready_reckoner', canon: 'W368 ready-reckoner "₹ per kg of milk · fat% \\ SNF% … = [n]" (FM:19 drill-in, the linkless table)', surfaces: ['rates'],
    key: 'ops3.refusal.readyReckoner', why: 'client money math refused (E3): the page computes no price' },
  { id: 'worked_example', canon: 'W368 "Formula on the poster too: ₹/kg = fat% × [n] + SNF% × [n]. Example the queue can check: [n] fat / [n] SNF → … = ₹[n] — exactly [member]\'s slip."', surfaces: ['rates'],
    key: 'ops3.refusal.workedExample', why: 'client money math refused (E3); the rule is printed in words; a member is never named (Q10-A)' },
  { id: 'cached_card', canon: 'W368 state "Card fetch failed — POS keeps pricing from its cached card (the version is printed on every slip) — a network blip never reprices milk."', surfaces: ['rates', 'rate_act'],
    key: 'ops3.refusal.cachedCard', why: 'FALSE: the server prices every pour (`milk-collection.service.ts` record); no device keeps a card; no slip is printed' },
  { id: 'change_here', canon: 'W368 state "Changing rates is dairy-desk-restricted — … tenant dairy desk plus a board minute reference, recorded."', surfaces: ['rates'],
    key: 'ops3.refusal.changeHere', why: 'founder Q1-A: this console only READS rates; no create, approve or close act is offered here' },
  { id: 'search', canon: 'W368 "Search rates… ⌘K"', surfaces: RATE_ALL,
    key: 'ops3.refusal.search', why: 'DECOR: no rate search route; no input is built (E7)' },
  { id: 'plan_settings', canon: 'W368 flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: ['rates'],
    key: 'ops3.refusal.planSettings', why: 'the S1…S6 precedent: no settings page is pointed to; a switched-off module says it is switched off' },
  { id: 'pourer_count', canon: 'console chrome "[org] · dairy ops · [n] member pourers · 2 shifts" · avatar "MM"', surfaces: RATE_ALL,
    key: 'ops3.refusal.pourerCount', why: 'no count is computed on this page (E3); no member is shown (Q10-A); "MM" is an avatar span, not a role (Q14-A)' },
  // ══ the two chains ══
  { id: 'export_queue', canon: 'W3338 "this job is queued with a position and ETA; you will find the file on the ready page"', surfaces: ['rate_export'],
    key: 'ops3.refusal.exportQueue', why: 'no job is created (Q15-A)' },
  { id: 'export_receipt', canon: 'W3338 "audit-stamped, checksummed, delivered by signed URL" · W3339 "Audit-stamped receipt: file name, row count, sha256 … 15-min signed URL, every fetch logged"', surfaces: ['rate_export'],
    key: 'ops3.refusal.exportReceipt', why: 'TRUE of CORE\'s export plane in mechanism, but no rate-card dataset is registered — refused here' },
  { id: 'rate_confirm_audit', canon: 'W3340 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateConfirmAudit', why: 'reading the cards again writes nothing' },
  { id: 'rate_zero_sum', canon: 'W3341 "The change is applied and the audit trail has the entry (actor · time · reason · before/after). Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateZeroSum', why: 'FALSE on a re-read, and on the page that sets a member\'s pay the most dangerous chain sentence: nothing was changed, nothing balanced — refused BY NAME' },
  { id: 'rate_audit_trail', canon: 'W3341 "View audit trail"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateAuditTrail', why: 'no ops audit surface exists; the card\'s own record is on the organisation\'s console' },
  { id: 'rate_on_call', canon: 'W3342 "repeated failures page the on-call"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateOnCall', why: 'no paging exists for these pages' },

  // ══ OPS-3a · THE COUNTER — the POS chrome (W360–W365) ══
  { id: 'pos_synced', canon: 'POS chrome "✓ synced [n] min ago" · W360 "Offline-first: every pour saves on this device and syncs when signal allows … Slips print locally"', surfaces: POS_PAGES,
    key: 'ops3.refusal.posSynced', why: 'FALSE (survey §1A): server-rendered forms; no device storage, no queue, no sync, no print' },
  { id: 'pos_operator_name', canon: 'POS chrome "Operator: [name]"', surfaces: POS_PAGES,
    key: 'ops3.refusal.posOperatorName', why: 'founder Q14-A: "signed in as you"; the pour is recorded under the signed-in person (`entered_by`); custody shows on the centre page only' },
  { id: 'pos_shift_object', canon: 'W360 state "Shift not open — One big button \'Open morning shift\'. Opening records operator + device + time — the shift is the audit boundary."', surfaces: ['pos_home', 'pos_shift'],
    key: 'ops3.refusal.posShiftObject', why: 'FALSE: no shift row, open or close exists (survey F-8; founder Q9-A)' },
  { id: 'pos_device', canon: 'W360 states "Device low battery … [n]% … [n] minutes left" · "saving on device — [n] pours queued"', surfaces: ['pos_home'],
    key: 'ops3.refusal.posDevice', why: 'FALSE: no device telemetry, no queue' },
  { id: 'pos_wrong_operator', canon: 'W360 state "Wrong operator — Shift belongs to [name]; another operator\'s card opens a handover flow (both recorded)"', surfaces: ['pos_home'],
    key: 'ops3.refusal.posWrongOperator', why: 'FALSE at the counter: custody handover is recorded on the organisation\'s console (6d-2), not here (Q14-A)' },
  { id: 'pos_denominator', canon: 'W360 "Collections so far [n] of ~[n] pourers"', surfaces: ['pos_home'],
    key: 'ops3.refusal.posDenominator', why: 'E3: no expected roll per shift exists; an estimate is a number nobody measured' },
  { id: 'pos_card_version', canon: 'W360 "computed per pour from rate card [ref] v3 · INR"', surfaces: ['pos_home', 'pos_slip'],
    key: 'ops3.refusal.posCardVersion', why: 'FALSE (survey C-9): a card has a name and a start date, no version' },
  { id: 'pos_test_hits', canon: 'W360 "Quality flags this shift [n] · retests · 0 adulteration hits" · W365 "Retests: [n] · adulteration hits: 0 · reprints: [n]"', surfaces: ['pos_home', 'pos_shift'],
    key: 'ops3.refusal.posTestHits', why: 'no test runs at this counter: a flag is ticked by a person; only the server\'s count of flagged pours is printed' },
  // ══ W361 · the record act ══
  { id: 'pos_tap_law', canon: 'W361 "New collection — the whole flow, tap-counted · law: ≤ 8 taps"', surfaces: ['pos_collect'],
    key: 'ops3.refusal.posTapLaw', why: 'DECOR as a law: the form has the fields the route needs' },
  { id: 'pos_card_scan', canon: 'W361 "Card scan identifies the farmer — RFID/QR card tap … appears with her photo — SHE confirms it\'s her by seeing it"', surfaces: ['pos_collect'],
    key: 'ops3.refusal.posCardScan', why: 'FALSE + Q10-A: no card reader; no photo; she is not asked; the member is chosen by member code' },
  { id: 'pos_milk_toggle', canon: 'W361 "Milk type — remembered from her profile … Different today? One toggle"', surfaces: ['pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posMilkToggle', why: 'GAP-BE: the pour has no milk-type field; the membership\'s milk type picks the card' },
  { id: 'pos_machine_read', canon: 'W361 "Pour → weigher + lactoscan read automatically … raw analyzer payload stored as evidence (device_payload)" · W362 "Analyzer (lactoscan) — read automatically" · "Raw device payload saved as evidence with every pour"', surfaces: ['pos_collect', 'pos_quality', 'pos_slip'],
    key: 'ops3.refusal.posMachineRead', why: 'FALSE (survey F-2, C-11; founder Q2-A): every reading is typed; `device_payload` has no writer' },
  { id: 'pos_joint_acceptance', canon: 'W361 "Tap \'Accept reading\' … acceptance is joint, not private (W362)" · "Her milk stays hers until she accepts a reading"', surfaces: ['pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posJointAcceptance', why: 'FALSE (founder Q3-A): she is not asked at the counter; the act is "Record this pour"' },
  { id: 'pos_confirm_math', canon: 'W361 "Tap \'Confirm ₹[n] — next farmer\' … amount computed at the counter — [kg] × ([fat]% × ₹[n]/kg-fat + [snf]% × ₹[n]/kg-SNF) = …"', surfaces: ['pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posConfirmMath', why: 'E3: no price is computed on the page; the server\'s price is shown after the pour is recorded' },
  { id: 'pos_farmer_display', canon: 'W361 / W362 the farmer-facing half "[name] · [milk] · [kg] · fat [n] · SNF [n] · ₹[n] — same numbers, her language"', surfaces: ['pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posFarmerDisplay', why: 'FALSE: no second display; she reads her pour in her own language in her milk diary' },
  { id: 'pos_live_reading_lock', canon: 'W361 state "Weigher disagrees … the screen never lets an operator type over a live reading (manual entry exists only in the analyzer-down lane, dual-confirmed — W364)"', surfaces: ['pos_collect'],
    key: 'ops3.refusal.posLiveReadingLock', why: 'FALSE: every entry is typed, by one person' },
  { id: 'pos_device_storage', canon: 'W361 state "Saving… Power cut mid-save? The pour is on device storage; the slip reprints from W364 — never a re-pour"', surfaces: ['pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posDeviceStorage', why: 'FALSE (device, slip, reprint); TRUE in mechanism that a retry with the same key records once' },
  { id: 'pos_retest', canon: 'W362 "Retest · [lang]" (FM:37) · W361 state "Farmer disputes the reading — One tap → retest (W362)"', surfaces: ['pos_quality'],
    key: 'ops3.refusal.posRetest', why: 'GAP-BE at the counter: a retest exists only for a flagged pour\'s open review, on the organisation\'s console' },
  { id: 'pos_retest_rule', canon: 'W362 "Retest rule: one free retest on request … beyond tolerance the analyzer gets flagged for calibration"', surfaces: ['pos_quality'],
    key: 'ops3.refusal.posRetestRule', why: 'FALSE: no free retest, tolerance or calibration flag exists' },
  { id: 'pos_analyzer_states', canon: 'W362 states "Analyzer warming up …" · "supervisor test follows" · "third reading + calibration flag … best-of-pair" · "Manual lane … operator + witness dual-entry … sampled for lab verification"', surfaces: ['pos_quality'],
    key: 'ops3.refusal.posAnalyzerStates', why: 'FALSE: no analyzer, no second reader; the person who flagged a pour may decide it (survey F-6)' },
  { id: 'pos_per_kg_rate', canon: 'W362 farmer card "rate: ₹[n] per kilo" · W363 "Rate ₹[n]/kg ([ref] v3)"', surfaces: ['pos_quality', 'pos_slip'],
    key: 'ops3.refusal.posPerKgRate', why: 'E3: a per-kg rate of milk is not a card field and is not worked out on the page' },
  { id: 'pos_screen_schedule', canon: 'W362 "Adulteration screens (urea / starch / detergent) run on sampling schedule + on any flag"', surfaces: ['pos_quality'],
    key: 'ops3.refusal.posScreenSchedule', why: 'FALSE: no test runs here; a flag is ticked by the person at the counter' },
  // ══ W363 · what was recorded ══
  { id: 'pos_printed_slip', canon: 'W363 "The slip — her proof, printed in seconds" · "80 mm thermal … reprints free, numbered same"', surfaces: ['pos_slip', 'pos_exceptions'],
    key: 'ops3.refusal.posPrintedSlip', why: 'FALSE (founder Q11-A): nothing is printed; the page is "What was recorded"' },
  { id: 'pos_slip_number', canon: 'W363 "slip [ref]"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posSlipNumber', why: 'FALSE: no slip number exists; the pour has an id, never printed as a number' },
  { id: 'pos_member_name', canon: 'W363 "[name] · #[code] · Buffalo"', surfaces: ['pos_slip', 'pos_collect', 'pos_quality'],
    key: 'ops3.refusal.posMemberName', why: 'founder Q10-A: member codes only — no name, photo or phone' },
  { id: 'pos_bill_cycle', canon: 'W363 "Cycle [dates] · pays with your 10-day bill" · "a promise note against the 10-day bill"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posBillCycle', why: 'FALSE: no 10-day cycle exists (0009:259); which bill carries a pour is decided when the cycle builds' },
  { id: 'pos_sms_mirror', canon: 'W363 "SMS mirror to +91 [masked]" · states "Out of paper — SMS-only mode"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posSmsMirror', why: 'FALSE (founder Q11-A): no dairy SMS is sent; no phone is taken at the counter' },
  { id: 'pos_qr', canon: 'W363 "QR → verify this slip online"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posQr', why: 'FALSE: no verification page exists' },
  { id: 'pos_helpline', canon: 'W363 "help · [number] · *[code]#"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posHelpline', why: 'S1 Q11-A (binding): no platform helpline is printed' },
  { id: 'pos_hear_aloud', canon: 'W363 "hear it aloud" (FM:39, a `data-decor` button)', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posHearAloud', why: 'GAP-BE: no voice read-out of a pour exists' },
  { id: 'pos_family_phone', canon: 'W363 state "No phone on record — … offers to add a family phone for the mirror — optional, her choice, recorded as consent"', surfaces: ['pos_slip'],
    key: 'ops3.refusal.posFamilyPhone', why: 'founder Q11-A: no phone is taken at the counter; a desk-recorded consent is the OPS-1 Q8-A class' },
  // ══ W364 · what this counter cannot do ══
  { id: 'pos_find_by_name', canon: 'W364 "Card won\'t scan … two letters of the name → photo list → pick" + "Find by name" (FM:40)', surfaces: ['pos_exceptions', 'pos_collect'],
    key: 'ops3.refusal.posFindByName', why: 'founder Q10-A: search is by member code; no name search, no photo list' },
  { id: 'pos_manual_witness', canon: 'W364 "Analyzer down — manual entry: Operator + one witness (any member) enter fat/SNF together; both identities on the record; slip printed MANUAL"', surfaces: ['pos_exceptions'],
    key: 'ops3.refusal.posManualWitness', why: 'FALSE (Q14-A): every reading is typed by one person; no witness column' },
  { id: 'pos_duplicate_override', canon: 'W364 "Duplicate-pour override — … needs reason + supervisor PIN, becomes TWO records with a link" · state "locked to supervisor PIN"', surfaces: ['pos_exceptions', 'pos_quality'],
    key: 'ops3.refusal.posDuplicateOverride', why: 'FALSE (founder Q9b-A): the one-pour-per-shift rule does not bend; nobody can record a second pour' },
  { id: 'pos_reprint', canon: 'W364 "Slip reprint — Member + date + shift → reprint (marked REPRINT). Free, always"', surfaces: ['pos_exceptions', 'pos_slip'],
    key: 'ops3.refusal.posReprint', why: 'FALSE: no slip, so no reprint' },
  { id: 'pos_correction_record', canon: 'W364 "Wrong entry caught after save — No edits: a correction record reverses and re-enters (both slips print, both link)."', surfaces: ['pos_exceptions', 'pos_quality', 'pos_slip'],
    key: 'ops3.refusal.posCorrectionRecord', why: 'FALSE (survey F-4; founder Q4-A): no correction exists anywhere; "no edits" is true' },
  { id: 'pos_rejection_without_amount', canon: 'W364 "Milk not accepted … The record notes rejection without amount; no penalty entry exists."', surfaces: ['pos_exceptions'],
    key: 'ops3.refusal.posRejectionWithoutAmount', why: '"without amount" FALSE (the amount is kept on purpose); the true half is said' },
  { id: 'pos_exception_log', canon: 'W364 states "Fetching today\'s exception log…" · "Couldn\'t sync exception log — … each card above still records locally. Retry to push the log"', surfaces: ['pos_exceptions'],
    key: 'ops3.refusal.posExceptionLog', why: 'FALSE: no exception log, no local record, no push — the page reads nothing' },
  { id: 'pos_lane_switch', canon: 'W364 flagged-off "manual-entry analyzer lane disabled — … switched off manual fat/SNF entry after a past incident"', surfaces: ['pos_exceptions'],
    key: 'ops3.refusal.posLaneSwitch', why: 'FALSE: no such switch exists' },
  // ══ W365 · the shift's totals ══
  { id: 'pos_close_shift', canon: 'W365 "Close morning shift — the counter\'s own recon" · "Close shift & hand to BMC" · "Close is idempotent and two-line signed"', surfaces: ['pos_shift', 'pos_home'],
    key: 'ops3.refusal.posCloseShift', why: 'founder Q9-A: "Close shift" refused by name; no shift record exists' },
  { id: 'pos_device_truth', canon: 'W365 "Shift totals (device truth) · Pours: [n] ([n] accepted · [n] rejected · [n] manual-lane)"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posDeviceTruth', why: 'the totals are the server\'s sums of what was typed; no manual lane exists' },
  { id: 'pos_average', canon: 'W365 "Counter value: ₹[n] (realized avg ₹[n]/kg × [kg] … equals the pool composite … can never disagree)"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posAverage', why: 'E3: no average or composite is worked out; "can never disagree" is FALSE under per-pour rounding' },
  { id: 'pos_load_cell', canon: 'W365 "BMC load-cell reads: [n] L (independent sensor — NOT derived from the counter)"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posLoadCell', why: 'FALSE: no load cell; the cooler\'s level is stated by a person' },
  { id: 'pos_variance', canon: 'W365 "Expected from counter: [kg] ÷ 1.030 = [L] → variance [kg] ([n]%) within 0.1%" · "Variance above 0.5% blocks close with a count-again prompt"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posVariance', why: 'founder Q9-A: no variance is worked out on the page; no density factor is held (F-7)' },
  { id: 'pos_agitator', canon: 'W365 "BMC temp at close: [n]°C · agitator ✓"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posAgitator', why: 'FALSE: no agitator column' },
  { id: 'pos_recount', canon: 'W365 "Recount" (FM:42)', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posRecount', why: 'FALSE: no recount act' },
  { id: 'pos_witness_sign', canon: 'W365 "two-line signed (operator + the member-witness of the day)" · states "Close locked until the member-witness signs" · "digital witness e-sign disabled … paper witness register"', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posWitnessSign', why: 'FALSE (Q14-A): no witness, signature or register exists' },
  { id: 'pos_cash', canon: 'W365 "the counter\'s own recon" (a cash counter\'s close)', surfaces: ['pos_shift'],
    key: 'ops3.refusal.posCash', why: 'this console records no cash; pours are paid by bill' },
  // ══ the pos chain (W3335–W3337) ══
  { id: 'pos_confirm_audit', canon: 'W3335 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['pos_act'],
    key: 'ops3.refusal.posConfirmAudit', why: 'a pour writes no audit row: the pour row is its own record (`entered_by`, `created_at`, no UPDATE grant on the readings — E10)' },
  { id: 'pos_zero_sum', canon: 'W3336 "The change is applied and the audit trail has the entry (actor · time · reason · before/after). Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['pos_act'],
    key: 'ops3.refusal.posZeroSum', why: 'FALSE: a pour posts no ledger entry; nothing was balanced — refused BY NAME' },
  { id: 'pos_audit_trail', canon: 'W3336 "View audit trail"', surfaces: ['pos_act'],
    key: 'ops3.refusal.posAuditTrail', why: 'no ops audit surface exists' },
  { id: 'pos_on_call', canon: 'W3337 "repeated failures page the on-call"', surfaces: ['pos_act'],
    key: 'ops3.refusal.posOnCall', why: 'no paging exists' },
]);
export function ops3RefusalKeys(surface: Ops3Surface): string[] { return OPS3_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS3_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_rates', canon: 'W368 canon route `rates`; the console sidebar "Centre · Rate card"', built: '`/rates` at the canon address, a sidebar entry "Rates" under a Dairy group with the built `/dairy` and `/payout` only (E2: built routes only)' },
  { id: 'fm_drill_in_reckoner', canon: 'FM:19 drill-in — the ready-reckoner grid on W368, the one linkless table', built: 'none: the grid is client money math and is refused by name (`ready_reckoner`)' },
  { id: 'fm_chain_ids_3', canon: 'FM :36-53 name W1770–W1779 and W1783–W1787 as chain targets (survey C-14)', built: 'those files do not exist; the real rate chains are W3338–W3339 (export) and W3340–W3342 (mutate)' },
  { id: 'no_prices_today_marker', canon: 'survey §1H: "the one `resolveActive` would pick today marked"', built: 'the server sends no such marker, so the page computes none (brief §E2): each card prints the days it covers' },
  { id: 'earlier_cards_premise', canon: 'brief §E2 "Earlier cards: `activeOnly:false`, labelled \'earlier cards\'; empty state \'No earlier card is on record.\'"',
    built: 'PREMISE WAS FALSE at first build: the API read `?activeOnly=false` as TRUE (`z.coerce.boolean()`). FIXED IN THIS WAVE (lead decision 2026-11-09): the query is the strict `queryBoolean()` and only a `dairy.manage` holder widens the list (`MilkRateCardService.list`). `/rates` keeps `activeOnly:true` as built and draws NO "earlier cards" section: the read carries no tenant "today", so telling which approved cards ended before today would need the page\'s own clock. The approved list already holds the closed cards, each with its dates' },
  { id: 'rate_act_reread', canon: 'W3340–W3342 confirm / success / failure (FM:53 "Retry")', built: 'PARITY-DECOR: the page\'s error state offers "Retry", whose confirm state links a plain re-read of `/rates`; Back → W368' },
  { id: 'rate_export_back', canon: 'W3338 / W3339 Back → W368', built: 'Back → `/rates` (the trigger and the donor are the same page)' },
  { id: 'slabs_paid_read', canon: 'W368 "Bonus slabs (bonus_rules) print with the card; there are none active this cycle"', built: 'each card\'s slabs printed; whether slabs are PAID from `GET /v1/config/flags` (`dairy_bonus_slabs` off for everyone ⇒ nobody is paid a premium; on ⇒ "not shown on this page"; unread ⇒ "could not be read")' },
  { id: 'rule_in_words', canon: 'brief §E2 "fat kg × the fat rate + SNF kg × the SNF rate, each rounded to the paisa"', built: 'the same rule with the words "times" and "plus" — no "×", "+" or "=" on the page (brief §C: no "×")' },
  { id: 'currency_inr', canon: 'survey E3 "the tenant\'s currency (never the \'INR\' literal)"', built: 'the console\'s house shape (OPS-1a payout, OPS-2c billing): `formatMoneyMinor(minor, \'INR\', lang)` — the console reads no tenant currency yet' },
  // ── OPS-3a ──
  { id: 'route_pos', canon: 'W360–W365 canon routes `pos/home`, `pos/collect`, `pos/quality`, `pos/slip`, `pos/exceptions`, `pos/shift-close`', built: 'the six at their canon addresses; the sidebar\'s Dairy group gains the four a person opens (`/pos/home`, `/pos/collect`, `/pos/shift-close`, `/pos/exceptions`); quality and slip are steps of the record act' },
  { id: 'pos_orphans', canon: 'W360, W363 0 inbound; W362 only from its own chain (survey F-17)', built: 'drawn: the sidebar opens W360; W361 opens W362 (the check step); recording opens W363' },
  { id: 'pos_chain_back', canon: 'W3335–W3337 crumb and Back → W362 whatever triggered them (survey C-15)', built: 'failure Back → the check step it came from (W362, the pour echoed); success Back → a fresh record form (W361) — going back to the check step after success would offer the same pour twice' },
  { id: 'pos_confirm_is_check_step', canon: 'W3335 confirm "Proceed / Cancel"', built: 'the confirm state IS the check step `/pos/quality` ("Record this pour"; Back to the form)' },
  { id: 'pos_success_on_slip', canon: 'W3336 success · W363 slip', built: 'one page: `/pos/slip?act=success` prints the chain\'s success sentence above "What was recorded"' },
  { id: 'slip_source', canon: 'survey §1D "the recorded pour\'s own read (the record response; GET …/collections?membershipId&from&to)"',
    built: 'PREMISE PARTLY FALSE: since OPS-3p a counter person (dairy.collect) cannot list a member\'s pours (`MilkCollectionService.list` — the member or dairy.manage only), so W363 shows the SERVER\'s answer to the record act, kept for this browser only (an httpOnly cookie on /pos, one hour); the card\'s name and start date are read from `GET /v1/dairy/rate-cards` by the answer\'s `rateCardId`. Retry re-reads it' },
  { id: 'pos_retry', canon: 'FM:38 / :41 / :43 "Retry" on W363 / W364 / W365 (`chain-mutate:pos`)', built: 'W363 / W365: a link that reads the page again (PARITY-DECOR); W364: none — the page reads nothing (DECOR)' },
  { id: 'pos_fm_unregistered', canon: 'FM has no row for W360 or W361; W361\'s confirm is prose (W361:58)', built: 'W360 links built; W361 is the record form; its confirm is the check step\'s "Record this pour"' },
  { id: 'pos_centre_from_custody', canon: 'survey E1 / brief OPS3-B14 "mccId from the signed-in person\'s custody"', built: '`GET /v1/dairy/mccs/mine` (new READ): the active centres in the caller\'s OPEN custody row and the organisation\'s today; none → the counter says so and offers no form. `?mcc=` picks among several; the record act re-checks it server-side before sending' },
  { id: 'pos_day_split', canon: 'brief OPS3-B15 "the day sheet split by hold state … or the pages carry the caveat"', built: 'BUILT as a pure read change: the day sheet returns payable / held / rejected sums and counts beside the total; the pages print the total labelled AND the split' },
  { id: 'dairy_record_moved', canon: '`/dairy` record form (PC-34 OW-4)', built: 'MOVED to `/pos/collect` (one write, one path — the 6d-4 rule); `/dairy` keeps the member\'s pours, the bills (generate, preview) and the active cards, and links the counter' },
]);

/** The verdict values. `pending_3b` is deleted from the type by the wave that decides the last of its files (OPS-3a deleted `pending_3a`). */
export type Ops3Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR' | 'pending_3b';
export type Ops3Wave = '3a' | '3b' | '3c';
/** Every canon file of OPS-3 (23), each with ONE verdict: 3c decides its 6 and 3a its 9; 3b's 8 wait for their wave. */
export const OPS3_CANON_FILES: readonly { file: string; wave: Ops3Wave; module: string; verdict: Ops3Verdict; note: string }[] = Object.freeze([
  // ── 3c · THE PRICE (6) — decided (founder Q1-A via HOTFIX-12, Q8-A, Q10-A, Q14-A, Q15-A) ──
  { file: 'W368-ops-rate-chart.html', wave: '3c', module: 'dairy', verdict: 'BUILT (read)', note: '/rates — a READ of the organisation\'s approved milk rate cards (GET /v1/dairy/rate-cards?activeOnly=true): name, milk type, pricing model in words, fat / SNF / base rates through the money formatter "per kg of fat / SNF / milk" (Q8-A), the days each covers, its approval state, its premium slabs and whether slabs are paid; the rule in words; two approved cards on one day for one milk type raised as an error; "Rates are changed on your organisation\'s dairy console, not here." + the HOTFIX-12 facts; no change button, no ready-reckoner, no poster, zero inputs' },
  { file: 'W3338-ops-rate-export-queued.html', wave: '3c', module: 'dairy', verdict: 'DECOR', note: '/rates?export=queued — "Print counter poster" refused (Q15-A): nothing queued' },
  { file: 'W3339-ops-rate-export-ready.html', wave: '3c', module: 'dairy', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused; Back → /rates' },
  { file: 'W3340-ops-rate-mutate-confirm.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '/rates?act=confirm — "Retry": reading the cards again changes nothing; the link IS a re-read of /rates' },
  { file: 'W3341-ops-rate-mutate-success.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=success — the cards are read afresh each time the page opens; nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3342-ops-rate-mutate-failure.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → /rates reads it again; nobody is paged' },
  // ── 3a · THE COUNTER (9) — decided (founder Q2-A, Q3-A, Q4-A, Q5-A, Q9-A, Q9b-A, Q10-A, Q11-A, Q14-A, Q8-A) ──
  { file: 'W360-ops-pos-home.html', wave: '3a', module: 'dairy', verdict: 'BUILT (read)', note: '/pos/home — a READ of the centre in your custody (GET /v1/dairy/mccs/mine) and its day sheet per shift for the organisation\'s today: pours, kg, the priced sum labelled "held or rejected pours are inside this figure" and the server\'s split (payable / held / rejected), the flagged count; the recorded shift hours or "not recorded"; links to record, problems and the shift totals; zero inputs' },
  { file: 'W361-ops-pos-collect.html', wave: '3a', module: 'dairy', verdict: 'REAL', note: '/pos/collect — the record form: the centre\'s roll by member code only (box=mcc, keyset, a code search), shift, date (today by default, never after it), weight, fat, SNF, flags, "typed here by you"; no name, photo or phone' },
  { file: 'W362-ops-pos-quality.html', wave: '3a', module: 'dairy', verdict: 'REAL', note: '/pos/quality — the check step: the numbers as typed, "typed by the person at this counter — not read from a scale or an analyser", "Her pay is computed from them, and they cannot be changed afterwards"; "Record this pour" (POST /v1/dairy/collections, keyed); no accept, no per-kg rate, no retest' },
  { file: 'W363-ops-pos-slip.html', wave: '3a', module: 'dairy', verdict: 'BUILT (read)', note: '/pos/slip — "What was recorded": the server\'s answer to the record act (member code, readings, the server\'s price, the card\'s name and start date, the hold); "She can check this pour in her milk diary and object to her bill in its window."; no slip number, QR, print or SMS; Retry re-reads (PARITY-DECOR)' },
  { file: 'W364-ops-pos-exceptions.html', wave: '3a', module: 'dairy', verdict: 'BUILT (honest)', note: '/pos/exceptions — reads nothing: a recorded pour cannot be corrected here; one pour per member per shift; every reading typed by one person, no witness; no slip, no reprint; what she can do; Retry DECOR; zero inputs' },
  { file: 'W365-ops-pos-shift.html', wave: '3a', module: 'dairy', verdict: 'BUILT (read)', note: '/pos/shift-close — the shift\'s server totals, labelled, with the split by hold state; the cooler\'s last stated level and its latest reading with their times (GET /v1/dairy/bmc/monitor); "Close shift" refused by name; no difference worked out; no /bmc link (not built); Retry re-reads (PARITY-DECOR)' },
  { file: 'W3335-ops-pos-mutate-confirm.html', wave: '3a', module: 'dairy', verdict: 'REAL', note: '/pos/quality — the confirm state IS the check step; its "Record this pour" is the act' },
  { file: 'W3336-ops-pos-mutate-success.html', wave: '3a', module: 'dairy', verdict: 'REAL', note: '/pos/slip?act=success — "This pour is recorded", priced by the server; the zero-sum sentence refused BY NAME; Back → a fresh record form' },
  { file: 'W3337-ops-pos-mutate-failure.html', wave: '3a', module: 'dairy', verdict: 'REAL', note: '/pos/quality?act=failure&reason=… — "Nothing was recorded" + the server\'s named reason (POUR_DATE_IN_FUTURE, POUR_WINDOW_ALREADY_BILLED, DUPLICATE_COLLECTION with the one-pour rule, NO_ACTIVE_RATE_CARD, POUR_NOT_AT_THIS_CENTRE …); Back → the check step' },
  // ── 3b · THE COOLER (8) — pending ──
  { file: 'W366-ops-bmc.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1G)' },
  { file: 'W3282-ops-bmc-form-form-error.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3283-ops-bmc-form-review.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3284-ops-bmc-form-success.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3285-ops-bmc-form-failure.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3286-ops-bmc-mutate-confirm.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
  { file: 'W3287-ops-bmc-mutate-success.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
  { file: 'W3288-ops-bmc-mutate-failure.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
]);

/** The five canon chain groups (survey §1I–§1M, 15 files, each exactly once) and the wave that owns each. */
export const OPS3_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Ops3Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'pos_mutate', donor: 'W360 (comment) / W362 (links)', wave: '3a', files: ['W3335', 'W3336', 'W3337'] },
  { id: 'bmc_form', donor: 'W366', wave: '3b', files: ['W3282', 'W3283', 'W3284', 'W3285'] },
  { id: 'bmc_mutate', donor: 'W366', wave: '3b', files: ['W3286', 'W3287', 'W3288'] },
  { id: 'rate_export', donor: 'W368', wave: '3c', files: ['W3338', 'W3339'] },
  { id: 'rate_mutate', donor: 'W368', wave: '3c', files: ['W3340', 'W3341', 'W3342'] },
]);

// ── THE BUILT CHAINS: each is a query state of its parent page (the OPS-1 `Ops1Chain` / OPS-2 `Ops2Chain` shape). ──
export type Chain3Id = 'rate_export' | 'rate_act' | 'pos_act';
export interface Chain3Def {
  id: Chain3Id; wave: Ops3Wave; kind: 'DECOR' | 'REAL' | 'PARITY-DECOR'; param: 'act' | 'export'; page: string; surface: Ops3Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS3_CHAINS: readonly Chain3Def[] = Object.freeze([
  { id: 'rate_export', wave: '3c', kind: 'DECOR', param: 'export', page: '/rates', surface: 'rate_export', states: ['queued', 'ready'],
    key: (s: string) => `ops3.chain.rateExport.${s}`, files: ['W3338', 'W3339'], statement: 'ops3.rates.notHere' },
  { id: 'rate_act', wave: '3c', kind: 'PARITY-DECOR', param: 'act', page: '/rates', surface: 'rate_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops3.chain.rateAct.${s}`, files: ['W3340', 'W3341', 'W3342'], statement: 'ops3.rates.notHere' },
  // OPS-3a: the record act's own states. confirm = the check step (/pos/quality); success is printed on /pos/slip; failure on /pos/quality.
  { id: 'pos_act', wave: '3a', kind: 'REAL', param: 'act', page: '/pos/quality', surface: 'pos_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops3.chain.posAct.${s}`, files: ['W3335', 'W3336', 'W3337'], statement: 'ops3.pos.typed' },
]);
export function chain3ById(id: Chain3Id): Chain3Def { return OPS3_CHAINS.find((c) => c.id === id) as Chain3Def; }
/** The chain state a page was opened in (`?act=confirm`, `?export=queued` …), or null for the page itself / an unknown state. */
export function chain3State(id: Chain3Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain3ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
