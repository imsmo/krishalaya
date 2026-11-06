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
//
// OPS-1b · AePS AND BIOMETRICS THE PLATFORM DOES NOT RUN (founder Q1-A, Q5-A, Q7-A 2026-11-05) builds:
//   • `aeps_home` (W390, `/aeps/home`) — HONEST, reads nothing: AePS here is a LOG, said as a log; links to W391, W392, W393, W399.
//   • `aeps_record` (W391, `/aeps/withdrawal`) — the record form moved from `/money` and reframed: REAL over the EXISTING keyed
//     `POST /v1/ambassadors/aeps/events`; the device box unticked; NO Aadhaar box, NO customer box (Q7-A; the API refuses either by name).
//   • `aeps_act` (W3289–W3291) — the record act's own states (`?act=confirm|success|failure`), REAL; Back → W391, never W393.
//   • `aeps_exceptions` (W392, `/aeps/exceptions`) — a READ of the operator's own events that did not go straight through; `?view=all` the
//     supervisor read (audited server-side, one row per read). No farmer or customer column; no row drill-in.
//   • `aeps_receipt` (W393, `/aeps/receipt`) — HONEST: there is no receipt here; the bank's device prints the bank's slip.
//   • `face_enroll` (W397), `face_attendance` (W398), `biometric_canon` (W399) — HONEST, read nothing (Q5-A: no face capture in Phase 1).
//
// OPS-1c · THE KIOSK (founder Q4-A′ 2026-11-06; Q6-A, Q8-A, Q9-A, Q10-A, Q11-A 2026-11-05) builds — and closes OPS-1 at 31 of 31:
//   • `kiosk_home` (W380, `/kiosk/home`; `/kiosk` answers a REAL 307 there) — a READ of her own ambassador profile (two separate facts: kiosk
//     mode; training recorded) and her newest earning rows; the honest "no ambassador profile here" and "switched off" states.
//   • `kiosk_start` (W381, `/kiosk/session-start`) — THE ONE FORM: create an account for a new number over the EXISTING keyed `POST /v1/users`;
//     `kiosk_act` (W3329–W3331) is its own confirm / success / failure states, REAL; Back → W381, never W380.
//   • `kiosk_profile` … `kiosk_schemes` (W382–W387), `kiosk_summary` (W388) — HONEST, read nothing, zero inputs.
//   • `kiosk_earnings` (W389, `/kiosk/ambassador`) — a READ of her own earning rows; no total, no rate; no pay-run read (none is hers).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops1Surface =
  // OPS-1a — built
  | 'payout' | 'payout_bill' | 'withdrawal' | 'payout_act' | 'withdrawal_act'
  // OPS-1b — built
  | 'aeps_home' | 'aeps_record' | 'aeps_exceptions' | 'aeps_receipt' | 'face_enroll' | 'face_attendance' | 'biometric_canon' | 'aeps_act'
  // OPS-1c — built
  | 'kiosk_home' | 'kiosk_start' | 'kiosk_profile' | 'kiosk_land' | 'kiosk_kyc' | 'kiosk_bank' | 'kiosk_listing' | 'kiosk_schemes'
  | 'kiosk_summary' | 'kiosk_earnings' | 'kiosk_act';
export interface Ops1Refusal { id: string; canon: string; surfaces: readonly Ops1Surface[]; key: string; why: string }

/** The surfaces OPS-1a builds. */
export const SURFACES_1A: readonly Ops1Surface[] = ['payout', 'payout_bill', 'withdrawal', 'payout_act', 'withdrawal_act'];
/** The surfaces OPS-1b builds. */
export const SURFACES_1B: readonly Ops1Surface[] = ['aeps_home', 'aeps_record', 'aeps_exceptions', 'aeps_receipt', 'aeps_act', 'face_enroll', 'face_attendance', 'biometric_canon'];
/** The pages OPS-1b builds that READ NOTHING (E7, E11) — zero inputs, no API client, no error state. */
export const HONEST_1B: readonly Ops1Surface[] = ['aeps_home', 'aeps_receipt', 'face_enroll', 'face_attendance', 'biometric_canon'];
const PAYOUT: readonly Ops1Surface[] = ['payout', 'payout_act'];
const WITHDRAWAL: readonly Ops1Surface[] = ['withdrawal', 'withdrawal_act'];
const CHAINS_1A: readonly Ops1Surface[] = ['payout_act', 'withdrawal_act'];
const AEPS_PAGES: readonly Ops1Surface[] = ['aeps_home', 'aeps_record', 'aeps_exceptions', 'aeps_receipt'];
const FACE_PAGES: readonly Ops1Surface[] = ['face_enroll', 'face_attendance', 'biometric_canon'];
/** The surfaces OPS-1c builds. */
export const SURFACES_1C: readonly Ops1Surface[] = ['kiosk_home', 'kiosk_start', 'kiosk_profile', 'kiosk_land', 'kiosk_kyc', 'kiosk_bank', 'kiosk_listing', 'kiosk_schemes', 'kiosk_summary', 'kiosk_earnings', 'kiosk_act'];
/** The pages OPS-1c builds that READ NOTHING (E7, E11) — W382–W388: zero inputs, no API client, no error state. */
export const HONEST_1C: readonly Ops1Surface[] = ['kiosk_profile', 'kiosk_land', 'kiosk_kyc', 'kiosk_bank', 'kiosk_listing', 'kiosk_schemes', 'kiosk_summary'];

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
    key: 'ops1.refusal.crossOrg', why: 'FALSE: one organisation; the second person is inside it — since HOTFIX-11 (8529d5d4) the previewer cannot approve and the approver cannot pay, on every bill (`milk-bill.entity.ts` approve / assertPayer)' },
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
  // ══ OPS-1b · W390–W393 · AePS — a LOG, said as a log (founder Q1-A); the record keeps the least (Q7-A) ══
  { id: 'micro_atm_auth', canon: 'W390 "Kiran Ben V. holds the micro-ATM authorisation on her ambassador profile"', surfaces: ['aeps_home'],
    key: 'ops1.refusal.microAtmAuth', why: 'LEGAL: a bank / BC authorisation the platform neither holds nor checks; the profile carries only `aeps_enabled` (0013), which lets a person RECORD events' },
  { id: 'finger_travels', canon: 'W390 / W391 "Your fingerprint travels encrypted from this device to your bank via NPCI/UIDAI … could not replay it if it wanted to"', surfaces: ['aeps_home', 'aeps_record'],
    key: 'ops1.refusal.fingerTravels', why: 'LEGAL + UNPROVABLE: the bank\'s device chain is not the platform\'s; only the absence is true (no fingerprint is received or stored here — 0071, no column, no route)' },
  { id: 'kpi_figures', canon: 'W390 "118 AePS transactions · ₹2,86,400 cash disbursed — averaging ₹2,427.12 per transaction"', surfaces: ['aeps_home'],
    key: 'ops1.refusal.kpiFigures', why: 'GAP-BE (no aggregate read, OPS1-B8) + FALSE ("disbursed" — the platform disburses nothing) + page division refused (E3)' },
  { id: 'txn_cap', canon: 'W390 / W391 "Per-transaction cap ₹10,000 — cap set by NPCI/bank" · "the field simply won\'t accept more than ₹10,000"', surfaces: ['aeps_home', 'aeps_record'],
    key: 'ops1.refusal.txnCap', why: 'bank-set and LEGAL: never hard-coded (`features/aeps/service.ts` header) — no number is printed and the field takes what the bank reported' },
  { id: 'auto_retry', canon: 'W390 "Bank server down — … the kiosk retries on its own schedule"', surfaces: ['aeps_home'],
    key: 'ops1.refusal.autoRetry', why: 'FALSE: the platform calls no bank, so it retries nothing' },
  { id: 'legal_line', canon: 'W390 "Device not RD-certified — blocked … This is a legal line, not a preference, so there is no override here"', surfaces: ['aeps_home', 'aeps_record'],
    key: 'ops1.refusal.legalLine', why: 'LEGAL (until a lawyer reads it) + FALSE as a block: the platform cannot see a device; it records the operator\'s unticked-by-default box and lets an uncertified reader record only a blocked event (server rule)' },
  { id: 'backup_device', canon: 'W391 "This kiosk switches every AePS attempt to its backup RD-certified device automatically"', surfaces: ['aeps_record'],
    key: 'ops1.refusal.backupDevice', why: 'FALSE: there is no device integration; nothing switches automatically' },
  { id: 'balance_before', canon: 'W391 "balance before ₹8,214.37 → after ₹5,714.37"', surfaces: ['aeps_record', 'aeps_exceptions'],
    key: 'ops1.refusal.balanceBefore', why: 'no balance-before is recorded and any before − amount = after on a page is refused (E3); the one balance is the one the bank\'s device showed after, labelled so' },
  { id: 'free_stealing', canon: 'W391 "This service is FREE to you — the bank pays the kiosk a commission. Anyone charging you for AePS is stealing."', surfaces: ['aeps_home', 'aeps_record'],
    key: 'ops1.refusal.freeStealing', why: 'LEGAL + commercial (Q1-A: no commission or "free" lines): the platform does not know what a bank pays or charges' },
  { id: 'farmer_column', canon: 'W392 table "Time · Exception · Farmer · Outcome" with the farmers\' names and the anecdotes ("wet hands after morning milking …")', surfaces: ['aeps_exceptions'],
    key: 'ops1.refusal.farmerColumn', why: 'WALL (Q7-A): the record holds no person; no name, no customer column, no row drill-in (a row is a record of a person\'s failed withdrawal)' },
  { id: 'backup_switched', canon: 'W392 "device-not-RD-certified — BLOCKED — kiosk switched to backup certified reader"', surfaces: ['aeps_exceptions'],
    key: 'ops1.refusal.backupSwitched', why: 'FALSE: nothing switches readers; the operator records what she did' },
  { id: 'retried_resolved', canon: 'W392 "bank-server-down — retried automatically, resolved in 12 min"', surfaces: ['aeps_exceptions'],
    key: 'ops1.refusal.retriedResolved', why: 'FALSE: the platform retries nothing and measures no resolution time' },
  { id: 'grouped_farmer', canon: 'W392 "Repeated fails, same farmer — grouped as one entry across sessions"', surfaces: ['aeps_exceptions'],
    key: 'ops1.refusal.groupedFarmer', why: 'GAP-BE and WALL: grouping needs the person, which Q7-A no longer records' },
  { id: 'slip', canon: 'W393 the whole slip ("… Txn ref … AMOUNT … Balance … → … · 80 mm thermal · bilingual by layout · reprints free, numbered same")', surfaces: ['aeps_receipt', 'aeps_act'],
    key: 'ops1.refusal.slip', why: 'FALSE (MONEY, TRUST — survey F-4): no slip, no numbering, no printer; a document printed from the operator\'s typing is one the platform cannot stand behind' },
  { id: 'sms_mirror', canon: 'W393 "SMS mirror to +91 …" · "the SMS mirror covers the gap"', surfaces: ['aeps_receipt'],
    key: 'ops1.refusal.smsMirror', why: 'GAP-BE (OPS1-B18, refused): no notification event exists for an AePS record' },
  { id: 'bank_ledger', canon: 'W393 "The receipt carries the same numbers the bank\'s own ledger holds — a lost slip never means a lost claim"', surfaces: ['aeps_receipt', 'aeps_act'],
    key: 'ops1.refusal.bankLedger', why: 'FALSE (MONEY): the numbers are the operator\'s entry, checked against nothing — refused BY NAME' },
  { id: 'settled_with_bank', canon: 'W393 "Printer jam — the withdrawal is already settled with the bank"', surfaces: ['aeps_receipt'],
    key: 'ops1.refusal.settledWithBank', why: 'UNPROVABLE: the platform cannot know what the bank settled' },
  { id: 'reprint_by_name', canon: 'W393 "any slip reprints from history by name and date"', surfaces: ['aeps_receipt'],
    key: 'ops1.refusal.reprintByName', why: 'FALSE + WALL: there is no slip to reprint and no name on a record' },
  { id: 'family_phone', canon: 'W393 "No phone on record — adding a family phone for the mirror is offered"', surfaces: ['aeps_receipt'],
    key: 'ops1.refusal.familyPhone', why: 'WALL: no phone of a customer is recorded, nor a family member\'s' },
  { id: 'masked_ref', canon: 'W393 "Txn ref queried — a masked ref like this one still resolves against the bank\'s own statement"', surfaces: ['aeps_receipt'],
    key: 'ops1.refusal.maskedRef', why: 'UNPROVABLE: the bank reference is what the operator typed; the platform checks it against nothing' },
  { id: 'aeps_plan_settings', canon: 'W390–W393 / W397–W399 flagged-off state "… See plan settings."', surfaces: [...AEPS_PAGES, ...FACE_PAGES],
    key: 'ops1.refusal.planSettings', why: 'the S2…S6 precedent: no settings page is pointed to; a switched-off module says it is switched off' },
  // ══ OPS-1b · W397–W399 · faces and biometrics — none in Phase 1 (founder Q5-A) ══
  { id: 'face_template_device', canon: 'W397 / W399 "Your face template lives on THIS device, encrypted; delete it any time at the sardar\'s tablet or by calling 1800-419-0123"', surfaces: ['face_enroll', 'biometric_canon'],
    key: 'ops1.refusal.faceTemplateDevice', why: 'FALSE ×3: no template exists anywhere, no device store, no deletion route; the toll-free number is white-label and false' },
  { id: 'same_wage_same_day', canon: 'W397 "OTP, sardar-confirm and paper-backfill pay the same wage the same day"', surfaces: ['face_enroll', 'face_attendance'],
    key: 'ops1.refusal.sameWageSameDay', why: 'FALSE: there is no OTP clock-in (the worker\'s own clock-in is GPS); a day pays only after the employer confirms it and the wage run takes it (`wage-run.repository.ts` confirmed rows only)' },
  { id: 'face_consent_script', canon: 'W397 the face consent script ("હું મારી મરજીથી મારો ચહેરો હાજરી માટે નોંધાવું છું …") + 🔊 (FM:103) and "read aloud"', surfaces: ['face_enroll'],
    key: 'ops1.refusal.faceConsent', why: 'FALSE + LEGAL (biometric consent words): there is no capture, so no consent to it; the 🔊 is DECOR' },
  { id: 'template_travels', canon: 'W397 "Already enrolled at another site — the same template travels with his consent, not with the device"', surfaces: ['face_enroll'],
    key: 'ops1.refusal.templateTravels', why: 'FALSE + a canon self-contradiction (F-17): building it means a central template store; refused' },
  { id: 'face_otp_counts', canon: 'W398 "11 of 12 present · 8 face + 2 OTP + 1 paper_backfill = 11"', surfaces: ['face_attendance'],
    key: 'ops1.refusal.faceOtpCounts', why: '"face" and "OTP" are not methods here; the summary read gives no counts by method for a booking (verified: `attendance.repository.ts:151-167`); the sum is refused (E3)' },
  { id: 'wage_arithmetic', canon: 'W398 "Wage liability ₹4,180 — 11 × ₹380/day"', surfaces: ['face_attendance'],
    key: 'ops1.refusal.wageArithmetic', why: 'page arithmetic over money refused (E3, MONEY); no wage figure is printed' },
  { id: 'supervisor_biometric', canon: 'W398 / W399 "supervisor_biometric is the sardar confirming on his own device"', surfaces: ['face_attendance', 'biometric_canon'],
    key: 'ops1.refusal.supervisorBiometric', why: 'the enum value has no writer (survey C-12; OPS1-B11 refused); no supervisor biometric exists' },
  { id: 'regardless', canon: 'W398 "wages queue into tonight\'s run on the same schedule regardless"', surfaces: ['face_attendance'],
    key: 'ops1.refusal.regardless', why: 'FALSE: an unconfirmed day does not enter the wage run' },
  { id: 'lantern', canon: 'W398 state "face-low-light — a lantern tip appears"', surfaces: ['face_attendance'],
    key: 'ops1.refusal.lantern', why: 'FALSE: there is no face check-in, so no low-light state' },
  { id: 'delayed_payday', canon: 'W398 "Dual-confirm overdue — a delayed confirm never becomes a delayed payday"', surfaces: ['face_attendance'],
    key: 'ops1.refusal.delayedPayday', why: 'FALSE: an unconfirmed day is not paid until it is confirmed' },
  { id: 'never_face_itself', canon: 'W399 "What IS stored: the event, the method, the timestamp … — never the fingerprint or the face itself."', surfaces: ['biometric_canon'],
    key: 'ops1.refusal.neverFaceItself', why: 'FALSE as a platform statement: face PHOTOS are stored (profile photo `users.photo_media_id`; the KYC selfie filed as a KYC document) — the page lists them' },
  { id: 'biometric_trail', canon: 'W399 "Every biometric event — an AePS attempt, a face enrolment, a face check-in, a deletion — lands in the access trail (W356 pattern)"', surfaces: ['biometric_canon'],
    key: 'ops1.refusal.biometricTrail', why: 'FALSE (C-14): no biometric event exists; what IS logged is each AePS record and each supervisor read of the log (HOTFIX-10)' },
  { id: 'same_cap', canon: 'W399 alternatives "AePS fingerprint → Bank branch or bank mitra counter — same withdrawal, same ₹10,000 cap"', surfaces: ['biometric_canon'],
    key: 'ops1.refusal.sameCap', why: 'the cap is the bank\'s (LEGAL); no number is printed' },
  { id: 'both_switched_off', canon: 'W399 state "No biometric events yet — A tenant with AePS and face-attendance both switched off shows this"', surfaces: ['biometric_canon'],
    key: 'ops1.refusal.bothSwitchedOff', why: 'no AePS or face-attendance switch exists (C-2): AePS rides `ambassadors`, and face attendance does not exist' },
  // ══ OPS-1b · the aeps chain (W3289–W3291) — REAL: the record act's own states ══
  { id: 'aeps_zero_sum', canon: 'W3290 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['aeps_act'],
    key: 'ops1.refusal.aepsZeroSum', why: 'FALSE on a log: no money moved, so nothing balanced — what was kept is a record. Refused BY NAME' },
  { id: 'aeps_on_call', canon: 'W3291 "repeated failures page the on-call"', surfaces: ['aeps_act'],
    key: 'ops1.refusal.onCall', why: 'no paging exists for these pages' },
  { id: 'aeps_audit_view', canon: 'W3289 / W3290 "confirming writes an audit-trail entry with actor, time and reason" · "View audit trail"', surfaces: ['aeps_act'],
    key: 'ops1.refusal.aepsAuditView', why: 'the record DOES write one audit entry (actor, time; no reason is asked — HOTFIX-10); no ops audit surface shows it' },  // ══ OPS-1c · W380 · Kiosk home — her own profile and earnings, read (Q10-A: no "session" claim anywhere) ══
  { id: 'assisted_session', canon: 'W380 banner "Assisted session — … every action recorded as assisted" · W381 "Assisted access is consent, per-session, and it expires" · W388 "when this session closed"', surfaces: ['kiosk_home', 'kiosk_start', 'kiosk_summary'],
    key: 'ops1.refusal.kAssistedSession', why: 'FALSE (survey §1 "No assisted session exists"; founder Q10-A): the desk creates an account and hands over; no delegation opens, lasts or ends (OPS1-B4 refused for Phase 1)' },
  { id: 'session_schedule', canon: 'W380 "Today: <village> · schedule: 3 sessions done, next at 11:30" · "Today\'s sessions 3 done"', surfaces: ['kiosk_home'],
    key: 'ops1.refusal.kSchedule', why: 'GAP-BE: no session or schedule exists; the nearest real thing (the visit log) is not a schedule' },
  { id: 'sync_chip', canon: 'W380 "Sync ✓ all sessions synced" and the header chip "✓ synced 2 min ago"', surfaces: ['kiosk_home'],
    key: 'ops1.refusal.kSync', why: 'FALSE (survey C-13): no offline queue exists; the console is online-only' },
  { id: 'canon_rates', canon: 'W380 / W389 "onboarding.verified 42 × ₹60 = ₹2,520 · scheme.application.submitted 28 × ₹15 · first.listing.published 9 × ₹25 · … ₹4,665 month-to-date"', surfaces: ['kiosk_home', 'kiosk_earnings'],
    key: 'ops1.refusal.kCanonRates', why: 'FALSE ×3 event codes and rates (seed rules/0207: farmer_onboarded, listing_assist; no scheme stream) + every "×" and "=" is page arithmetic (E3): the server\'s rows only, no total (none is returned)' },
  { id: 'kiosk_flips', canon: 'W380 state "Kiosk disabled — training path … kiosk_enabled flips true only after training_completed_at is recorded"', surfaces: ['kiosk_home'],
    key: 'ops1.refusal.kFlips', why: 'FALSE: no rule links the two columns (0013:21-22); the page prints them as two facts. Since OPS-1c (OPS1-B7) the assisted acts require BOTH, by name' },
  { id: 'offline_queue', canon: 'W380 state "Offline-first, normal Tuesday — Sessions queue on this device …"', surfaces: ['kiosk_home'],
    key: 'ops1.refusal.kOffline', why: 'FALSE: nothing is queued or kept on a kiosk device' },
  { id: 'cluster_reassign', canon: 'W380 state "60-day inactivity warning … moves the village toward cluster reassignment" · W389 "The 60-day rule … a mentor ping"', surfaces: ['kiosk_home', 'kiosk_earnings'],
    key: 'ops1.refusal.kInactivity', why: 'the reassignment job and the mentor ping are deferred (AMB README "Deferred", OPS1-B19): refused as consequences' },
  { id: 'battery', canon: 'W380 state "Device battery — Below 20% …"', surfaces: ['kiosk_home'],
    key: 'ops1.refusal.kBattery', why: 'FALSE: no device telemetry exists for a kiosk' },
  { id: 'kiosk_plan_settings', canon: 'W380–W389 flagged-off state "… See plan settings."', surfaces: ['kiosk_home', 'kiosk_earnings'],
    key: 'ops1.refusal.planSettings', why: 'the S2…S6 precedent: a switched-off programme says it is switched off; no settings page is pointed to' },
  // ══ OPS-1c · W381 · Create an account for a new number (Q9-A: a known number reveals nothing) ══
  { id: 'otp_before_open', canon: 'W381 "If it matches a member, she confirms with her own OTP before anything opens"', surfaces: ['kiosk_start', 'kiosk_act'],
    key: 'ops1.refusal.kOtpFirst', why: 'FALSE: no assisted OTP exists; a number with an account is refused (409) and she signs in herself on her own phone' },
  { id: 'phone_found', canon: 'W381 card "Phone found · <masked phone> matches <name>, <village>"', surfaces: ['kiosk_start', 'kiosk_act'],
    key: 'ops1.refusal.kPhoneFound', why: 'WALL (founder Q9-A; HOTFIX-10 H10-1): a desk never learns who owns a number — the 409 carries nothing about the person' },
  { id: 'steps_back', canon: 'W381 "<the ambassador> steps back and does not see or touch the code. The session opens only once the farmer confirms it."', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kStepsBack', why: 'UNPROVABLE + FALSE: no code is shown at the desk and no session opens; she signs in on her own phone' },
  { id: 'voice_note_consent', canon: 'W381 state "No-phone farmer — a family member\'s phone plus a recorded voice-note consent stands in for the OTP"', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kVoiceNote', why: 'GAP-BE + refused (founder Q8-A sub-question: no, until a lawyer reads it)' },
  { id: 'voice_call_code', canon: 'W381 state "OTP fail … a voice call reads the code aloud"', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kVoiceCall', why: 'not verified: SMS is the only sign-in code channel seen' },
  { id: 'out_of_cluster', canon: 'W381 state "Existing member, different village … tagged out-of-cluster; no commission accrues"', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kOutOfCluster', why: 'FALSE: no such tagging exists; an existing number is refused, whatever village' },
  { id: 'attempt_log', canon: 'W381 state "Consent declined … nothing is stored beyond the attempt log"', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kAttemptLog', why: 'FALSE: no attempt log exists' },
  { id: 'ambassador_pin', canon: 'W381 state "Session start is ambassador-PIN-restricted"', surfaces: ['kiosk_start'],
    key: 'ops1.refusal.kPin', why: 'FALSE: no ambassador PIN exists; creating an account needs the user.approve permission' },
  // ══ OPS-1c · W382 · Name and language (the deviation: they live on W381's one form) ══
  { id: 'voice_capture', canon: 'W382 "Name — Voice capture 🎙 … transcribed … both kept side by side" (FM:97 🎙)', surfaces: ['kiosk_profile'],
    key: 'ops1.refusal.kVoiceCapture', why: 'GAP-BE (OPS1-B16): no voice capture or transcription; one name column (0003:18); the 🎙 is DECOR' },
  { id: 'photo_consent', canon: 'W382 "Photo — <consent line> · The photo-consent tap is hers alone"', surfaces: ['kiosk_profile'],
    key: 'ops1.refusal.kPhoto', why: 'GAP-BE + WALL (Q5/Q6): no assisted photo, no photo-consent purpose — a picture of her face is taken in her own app only' },
  { id: 'masked_candidates', canon: 'W382 state "Duplicate suspect — masked candidates are shown and she confirms \'that\'s not me\'"', surfaces: ['kiosk_profile', 'kiosk_start'],
    key: 'ops1.refusal.kCandidates', why: 'WALL (Q9-A, the F-1 lesson): a desk is shown nobody' },
  { id: 'transcription', canon: 'W382 state "Transcription wrong"', surfaces: ['kiosk_profile'],
    key: 'ops1.refusal.kTranscription', why: 'FALSE: nothing is transcribed' },
  // ══ OPS-1c · W383 · Land and crops (honest) ══
  { id: 'bigha_factor', canon: 'W383 "12 bigha ≈ 2.86 ha (converted at the district\'s own factor — conversion factors are DATA per district)"', surfaces: ['kiosk_land'],
    key: 'ops1.refusal.kBigha', why: 'GAP-BE (OPS1-B17): no district land-unit factors exist as data — no conversion is printed' },
  { id: 'seven_twelve', canon: 'W383 "7/12 photo capture … otherwise the parcel record stands unverified"', surfaces: ['kiosk_land'],
    key: 'ops1.refusal.kSevenTwelve', why: 'GAP-BE on the assisted path (OPS1-B17): a land record is hers, in her own app' },
  { id: 'read_back_aloud', canon: 'W383 "Read back aloud, confirmed by the farmer\'s own tap before anything saves"', surfaces: ['kiosk_land'],
    key: 'ops1.refusal.kReadBack', why: 'FALSE on the kiosk: no assisted land write and no read-aloud' },
  { id: 'revisit_list', canon: 'W383 / W387 "added to the revisit list" · "saved to the revisit list"', surfaces: ['kiosk_land', 'kiosk_schemes'],
    key: 'ops1.refusal.kRevisit', why: 'GAP-BE: no revisit list exists' },
  // ══ OPS-1c · W384 · Identity check (Q6-A: no Aadhaar capture at the desk; LEGAL) ══
  { id: 'aadhaar_capture', canon: 'W384 "Aadhaar capture · Masked on screen: <mask>"', surfaces: ['kiosk_kyc'],
    key: 'ops1.refusal.kAadhaar', why: 'refused for Phase 1 (founder Q6-A; OPS1-B5): eKYC is her own, in her own sign-in (`kyc.controller.ts` ekyc/start acts on the caller only)' },
  { id: 'kyc_consent_script', canon: 'W384 the KYC consent script + 🔊 "read aloud" (FM:99)', surfaces: ['kiosk_kyc'],
    key: 'ops1.refusal.kKycScript', why: 'FALSE + LEGAL: no such consent purpose or script is stored; the 🔊 is DECOR' },
  { id: 'never_touches', canon: 'W384 "Rule: the ambassador never touches the tablet during consent … taps \'I agree\' herself"', surfaces: ['kiosk_kyc'],
    key: 'ops1.refusal.kNeverTouches', why: 'UNPROVABLE: a tablet cannot know whose finger tapped' },
  { id: 'mask_policy', canon: 'W384 "Masking policy, stated: … Aadhaar strictest (2 digits, per UIDAI norms), bank account last 2 …"', surfaces: ['kiosk_kyc', 'kiosk_bank'],
    key: 'ops1.refusal.kMaskPolicy', why: 'LEGAL + FALSE vs code (survey C-11): the platform keeps and shows last 4; a lawyer reads the rule first' },
  { id: 'kept_on_device', canon: 'W384 "Anything already captured stays saved on this device" · W386 "Your entries are kept on this device"', surfaces: ['kiosk_kyc', 'kiosk_listing'],
    key: 'ops1.refusal.kOnDevice', why: 'FALSE: nothing is kept on a kiosk device' },
  // ══ OPS-1c · W385 · Bank account (MONEY; honest) ══
  { id: 'penny_drop', canon: 'W385 "Penny-drop · ₹1 sent with a narration code … The ₹1 stays yours."', surfaces: ['kiosk_bank'],
    key: 'ops1.refusal.kPennyDrop', why: 'GAP-BE (MONEY, OPS1-B6): `penny_verified_at` has no writer; no rupee is ever sent' },
  { id: 'bank_sms_code', canon: 'W385 "Hand the tablet … she reads the code from her own bank SMS and enters it herself"', surfaces: ['kiosk_bank'],
    key: 'ops1.refusal.kBankCode', why: 'FALSE: no code is sent to check an account' },
  { id: 'bank_mitra', canon: 'W385 state "No-account farmer — Jan Dhan guidance … the kiosk already knows the nearest bank mitra"', surfaces: ['kiosk_bank'],
    key: 'ops1.refusal.kBankMitra', why: 'GAP-BE: no bank-correspondent directory exists' },
  { id: 'family_account', canon: 'W385 state "Account in family name — Recorded exactly as such, with the relationship and her consent noted"', surfaces: ['kiosk_bank'],
    key: 'ops1.refusal.kFamilyAccount', why: 'WALL (a third party\'s account) + GAP-BE: no relationship or consent column exists' },
  // ══ OPS-1c · W386 · First listing (Q8-A: "list on my behalf" cannot be given at a desk) ══
  { id: 'bags_photo', canon: 'W386 "photo of her actual bags" · "Photo-of-stock-image caught — sent back for a retake with HER bags"', surfaces: ['kiosk_listing'],
    key: 'ops1.refusal.kBagsPhoto', why: 'GAP-BE: no stock-photo detection exists' },
  { id: 'mandi_figure', canon: 'W386 "Mandi reference for <crop> today: ₹6,240 — a reference, not a promise"', surfaces: ['kiosk_listing'],
    key: 'ops1.refusal.kMandi', why: 'the figure is the canon\'s; market prices are behind `market_intel` OFF and are not read on an honest page' },
  { id: 'publish_voice', canon: 'W386 state "Publish is consent-restricted — needs the member\'s own recorded confirmation (voice or app tap)"', surfaces: ['kiosk_listing'],
    key: 'ops1.refusal.kPublishVoice', why: 'the true rule the API lacks (Q8-A, OPS1-B3): since OPS-1c no route records an on-behalf consent with a helper named, so nobody lists for her; a voice confirmation is refused' },
  // ══ OPS-1c · W387 · Schemes (F-11) ══
  { id: 'assisted_by_tag', canon: 'W387 "<she> enters her own OTP to submit it — the application is tagged assisted_by <the ambassador>, but the OTP that sends it is only hers"', surfaces: ['kiosk_schemes'],
    key: 'ops1.refusal.kAssistedByTag', why: 'PARTIAL + FALSE as a guarantee (survey F-11, OPS1-B15): `assistedBy` is a UUID the client supplies; no submit code exists' },
  // ══ OPS-1c · W388 · Summary for her (Q4-A′, Q11-A) ══
  { id: 'member_created', canon: 'W388 "What we did today: Member created ✓ · KYC captured — pending verify · Bank seeded — pending penny-drop code · First listing — draft saved · <scheme> application submitted"', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kMemberCreated', why: '"Member" FALSE as worded (an account, no tenant role is written); every other line FALSE (none happens at the desk)' },
  { id: 'access_ended', canon: 'W388 SMS "This account is yours — <the ambassador>\'s access ended when this session closed"', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kAccessEnded', why: 'FALSE (Q10-A): no access existed to end; the desk holds no grant on her account' },
  { id: 'helpline_ussd', canon: 'W388 "Change anything anytime: app, *123#, or 1800-419-0123."', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kHelpline', why: 'FALSE + white-label (founder Q11-A): no USSD code; no organisation helpline field exists (no column on `tenants`), so "not published yet"' },
  { id: 'pay_amount', canon: 'W388 "Transparency — Your onboarding pays <the ambassador> ₹60 from the FPO — you pay nothing."', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kPayAmount', why: 'FALSE (founder Q4-A′, 2026-11-06): this desk\'s create (`POST /v1/users`) writes no referral and no earning — the summary says ₹0, truthfully; no plan is read and no amount printed' },
  { id: 'sms_receipt', canon: 'W388 "SMS receipt — …" · state "SMS failed — A printed paper fallback is handed over"', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kSmsReceipt', why: 'GAP-BE (OPS1-B18): no message is sent on account creation and nothing is printed' },
  { id: 'reversible_now', canon: 'W388 state "Farmer wants to undo — Anything from today is reversible right now"', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kReversible', why: 'FALSE: no desk deletes an account; consents are append-only; her data rights are her own (0107)' },
  { id: 'summary_only', canon: 'W388 state "Summary is session-ambassador-only"', surfaces: ['kiosk_summary'],
    key: 'ops1.refusal.kSummaryOnly', why: 'FALSE: the summary holds nothing about her — it is the same page for every visitor' },
  // ══ OPS-1c · W389 · Your earnings (read; E3) ══
  { id: 'weekday_wage_lane', canon: 'W389 "weekly payout batch runs Fri (wage-lane)"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kWeekday', why: 'FALSE: the run is prepared by the job on Thursday 23:00 IST and paid only when a DIFFERENT tenant administrator confirms it (0198:153) — a wallet transfer, not a bank lane' },
  { id: 'never_twice', canon: 'W389 "UNIQUE(ambassador,event,reference) — the same onboarding can never pay twice"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kNeverTwice', why: 'NARROWED: the guarantee is a service-level `existsFor` (the UNIQUE includes the partition key) plus the payout stamp — the page promises no more than that one earning is recorded once per event' },
  { id: 'pass_rate', canon: 'W389 "Verification pass-rate 97.6% — 41 of 42 verified first-pass"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kPassRate', why: 'FALSE + a percentage (the 5c rule): no first-pass metric exists' },
  { id: 'published_ladder', canon: 'W389 "Tier path — Senior → cluster_lead criteria are visible right here — the ladder is published, not whispered."', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kLadder', why: 'tier criteria are not data and auto-promotion is deferred (OPS1-B19)' },
  { id: 'never_at_risk', canon: 'W389 state "Payout failed — … the payout retries; the earned amount is never at risk"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kNeverAtRisk', why: 'a promise refused: an unfunded line can be paid again by an administrator; nothing retries on its own' },
  { id: 'earnings_dispute', canon: 'W389 state "Earnings dispute — Every event row links its own reference … settled by arithmetic"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kDispute', why: 'GAP-BE: no dispute route exists' },
  { id: 'ambassador_only', canon: 'W389 state "Earnings view is ambassador-only — Only this ambassador and the tenant finance desk can see"', surfaces: ['kiosk_earnings'],
    key: 'ops1.refusal.kAmbassadorOnly', why: 'FALSE: `ambassador.manage` holders (tenant_admin and support_agent, 0004:256) read `/:id/earnings` — the page says so' },
  // ══ OPS-1c · the kiosk chain (W3329–W3331) — REAL: the create act's own states ══
  { id: 'kiosk_zero_sum', canon: 'W3330 "Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['kiosk_act'],
    key: 'ops1.refusal.kioskZeroSum', why: 'FALSE: an account was created; no money moved, so nothing balanced. Refused BY NAME' },
  { id: 'kiosk_on_call', canon: 'W3331 "repeated failures page the on-call"', surfaces: ['kiosk_act'],
    key: 'ops1.refusal.onCall', why: 'no paging exists for these pages' },
  { id: 'kiosk_audit_view', canon: 'W3329 / W3330 "confirming writes an audit-trail entry with actor, time and reason" · "View audit trail"', surfaces: ['kiosk_act'],
    key: 'ops1.refusal.kioskAuditView', why: 'the create DOES write one audit entry (`user.created_assisted`, actor and time; no reason is asked); no ops audit surface shows it' },
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
  // ── OPS-1b ──
  { id: 'route_aeps_record', canon: 'W391 canon route `aeps/withdrawal`; the console\'s record form was `/money` (OW-5)',
    built: '`/aeps/withdrawal` at the canon address; `/money` answers a REAL 307 there (next.config.js, OPS1B_REDIRECTS); the form moved, minus the Aadhaar and customer boxes (Q7-A), device box unticked' },
  { id: 'route_aeps_exceptions', canon: 'W392 canon route `aeps/exceptions`; the supervisor view was `/money/oversight`',
    built: '`/aeps/exceptions` (own events that did not go straight through) and `?view=all` (the audited supervisor read); `/money/oversight` answers a REAL 307 to `/aeps/exceptions?view=all`' },
  { id: 'orphans_1b', canon: 'F-17: W390, W397, W398, W399 have 0 inbound links in the canon; W399 is drawn in the dairy MCC sidebar',
    built: 'inbound edges drawn: the sidebar (AePS → W390, Attendance → W397), W390 → W391 / W392 / W393 / W399, W397 ⇄ W398 → W399; W399 is a platform reference page under its own Attendance / AePS links, never a dairy page' },
  { id: 'aeps_chain_back', canon: 'W3289–W3291 Cancel / Back → W393 (the receipt), though the chain\'s donor is W390 (F-17)',
    built: 'Back returns to W391 (`/aeps/withdrawal`), the page whose act it is — never W393; W393\'s "Retry" (FM:101) opens the chain\'s confirm state' },
  { id: 'aeps_chain_confirm_is_form', canon: 'W3289 a confirm page with Proceed → W3290',
    built: 'the confirm state IS the record form under the confirm sentence (`?act=confirm`) — its one submit is the act; the form is the same single form W391 carries, so no second form exists' },
  { id: 'fm_aeps_chain_ids', canon: 'FM :101 names W1832–W1834 for W393\'s Retry', built: 'those files do not exist (C-16); the real chain is W3289–W3291' },
  { id: 'fm_face_decor', canon: 'FM :103 W397 "🔊" and :104 W399 "MM" as `filter`', built: 'a read-aloud button and an avatar — not built (DECOR, refused / DELTA)' },
  { id: 'w398_honest', canon: 'W398 "11 of 12 present · 8 face + 2 OTP + 1 paper_backfill" — a crew\'s counts by method',
    built: 'HONEST, not a read: `GET /v1/labour/attendance/summary` (attendance.controller.ts:43-44 → attendance.service.ts:189-192 → attendance.repository.ts:151-167) returns tenant-wide REVIEW tiles (clean · needs review · paper backfill · unconfirmed over 24 h · workers today · active jobs) — no booking parameter and no count by method' },
  { id: 'w399_not_dairy', canon: 'W399 drawn in the dairy MCC sidebar with the "MM" avatar', built: 'a platform policy page at `/canon/biometric`, linked from the AePS and Attendance pages' },
  // ── OPS-1c ──
  { id: 'route_kiosk_home', canon: 'W380 canon route `kiosk/home`; the console\'s OW-1 form + checklist was `/kiosk`',
    built: '`/kiosk/home` at the canon address; `/kiosk` answers a REAL 307 there (next.config.js, OPS1C_REDIRECTS); the OW-1 form moved to `/kiosk/session-start`' },
  { id: 'w382_on_w381', canon: 'survey §1D: W382 "name and language are REAL as fields of the create act" (a second page of the act)',
    built: 'DEVIATION (brief §E): the single form lives on W381 (phone, name, language) so no phone crosses a page boundary; W382 is HONEST — name and language are set when the account is created, and she changes them in her own app' },
  { id: 'kiosk_chain_back', canon: 'W3329–W3331 Cancel / Back → W380 even when triggered from W382 / W384 / W386 (F-17)',
    built: 'Back returns to W381 (`/kiosk/session-start`), the page whose act it is — never W380; the canon "Retry" on W380 / W382 / W384 / W386 is a plain re-read link to that page, never a write' },
  { id: 'fm_kiosk_chain_ids', canon: 'FM :95-100 name W1835–W1837 for the kiosk "Retry" rows (F-18 chain-target rot)', built: 'those files do not exist (C-16); the real chain is W3329–W3331' },
  { id: 'orphans_1c', canon: 'F-17: W382–W388 have 0 inbound links in the canon (the flow is described in text); W380\'s "Start new session" / "My earnings & quality" are absent from FM',
    built: 'inbound edges drawn: the sidebar (Kiosk → W380, New account → W381, My earnings → W389); W380 → each of W381–W389; every step page → W380; W389 → W388' },
  { id: 'fm_kiosk_decor', canon: 'FM :97 W382 "🎙" and :99 W384 "🔊" as `filter`', built: 'a voice-capture and a read-aloud button (`data-decor`) — not built (DECOR, refused by name)' },
  { id: 'w389_no_runs', canon: 'W389 "weekly payout batch" and the survey §1E "her runs"',
    built: 'no own pay-run read exists: `GET /v1/ambassadors/payout-runs` (payout-runs.controller.ts `assertRunReader`) needs `ambassador.payout.prepare` or `ambassador.payout` — so the runs are omitted and the page says so' },
  { id: 'kiosk_no_totals', canon: 'W380 / W389 month-to-date totals; brief §E "plus `/me/earnings` server totals"',
    built: '`GET /v1/ambassadors/me/earnings` returns rows and a cursor only — no total exists on the server, so none is printed (and none is computed: E3)' },
]);

/** The verdict values. OPS-1c deleted `pending_1c` (the 4c-7 rule; OPS-1b deleted `pending_1b`): every file is decided. */
export type Ops1Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR';
/** Every canon file of OPS-1 (31), each with ONE verdict: 1a decided its 8, 1b its 10, 1c its 13. */
export const OPS1_CANON_FILES: readonly { file: string; wave: '1a' | '1b' | '1c'; module: string; verdict: Ops1Verdict; note: string }[] = Object.freeze([
  // ── 1a · THE MONEY DESKS (8) — decided by 1a (founder 1a-1 … 1a-4) ──
  { file: 'W367-ops-payout-run.html', wave: '1a', module: 'dairy', verdict: 'BUILT (read)', note: '/payout — a READ of the organisation\'s milk bills over GET /v1/dairy/milk-bills (keyset; one GET page-size select 25/50/100): member code, period, litres, the server\'s gross / deductions / net, the state verbatim; a row → /payout/[id] (GET …/milk-bills/:id). No total, no page count, no approve, no pay — "Bills are approved and paid by your organisation\'s dairy desk, with two people, not from this console. Nothing is approved or paid here." ("with two people" RESTORED by the founder 2026-11-06 once HOTFIX-11 `8529d5d4` made it true: on every bill the previewer cannot approve and the approver cannot pay)' },
  { file: 'W377-ops-withdrawal.html', wave: '1a', module: 'warehouse', verdict: 'BUILT (honest)', note: '/warehouse/withdrawal — an HONEST PAGE THAT READS NOTHING: release is the whole booking, the operator\'s act, the storage fee settles from the depositor\'s wallet at release — and release is paused until she can confirm it herself; never a part of a booking; no receipt is pledged here yet; a link to the bookings list. "Request release" refused by name' },
  { file: 'W3332-ops-payout-mutate-confirm.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '/payout?act=confirm — "Send to tenant payout desk" is a refused act: nothing to confirm' },
  { file: 'W3333-ops-payout-mutate-success.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '?act=success — nothing was sent, approved or paid; the "reconcile zero-sum" sentence refused BY NAME (`zero_sum`)' },
  { file: 'W3334-ops-payout-mutate-failure.html', wave: '1a', module: 'dairy', verdict: 'DECOR', note: '?act=failure — nothing was attempted; Back re-reads the bills (a genuine re-read), the chain stays DECOR because its trigger is refused' },
  { file: 'W3369-ops-withdrawal-mutate-confirm.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '/warehouse/withdrawal?act=confirm — "Request release" is refused: nothing to confirm' },
  { file: 'W3370-ops-withdrawal-mutate-success.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '?act=success — nothing was released or charged; the "reconcile zero-sum" sentence refused BY NAME' },
  { file: 'W3371-ops-withdrawal-mutate-failure.html', wave: '1a', module: 'warehouse', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; nobody is paged' },
  // ── 1b · AePS and biometrics the platform does not run (10) — decided by 1b (founder Q1-A, Q5-A, Q7-A) ──
  { file: 'W390-ops-aeps-home.html', wave: '1b', module: 'aeps', verdict: 'BUILT (honest)', note: '/aeps/home — HONEST, reads nothing (no `/me` line was added): AePS here is a LOG — "Record what the bank\'s device showed. This platform did not move the money and cannot check it." No figure, no cap, no commission or "free" line; links to /aeps/withdrawal, /aeps/exceptions, /aeps/receipt, /canon/biometric' },
  { file: 'W391-ops-aeps-withdrawal.html', wave: '1b', module: 'aeps', verdict: 'REAL', note: '/aeps/withdrawal — the record form (moved from /money): POST /v1/ambassadors/aeps/events, keyed; the device box UNTICKED; no Aadhaar box and no customer box (Q7-A — the API refuses either by name); the balance is "as the bank\'s device showed it after", never a before → after' },
  { file: 'W392-ops-aeps-exceptions.html', wave: '1b', module: 'aeps', verdict: 'BUILT (read)', note: '/aeps/exceptions — the operator\'s own events that did not go straight through (GET …/events/mine); ?view=all the supervisor read (GET …/events, ambassador.manage, one audit row per read); no farmer or customer column, no bank or account column, no row drill-in' },
  { file: 'W393-ops-aeps-receipt.html', wave: '1b', module: 'aeps', verdict: 'BUILT (honest)', note: '/aeps/receipt — HONEST, reads nothing: there is no receipt here — the bank\'s device prints the bank\'s slip; this console keeps the operator\'s record. "Retry" (FM:101) opens the aeps chain\'s confirm state' },
  { file: 'W397-ops-face-enroll.html', wave: '1b', module: 'attendance', verdict: 'BUILT (honest)', note: '/attendance/face-enroll — HONEST, reads nothing (Q5-A): no face capture; attendance is recorded by the worker\'s own clock-in, a signed sheet or a reviewer\'s vouch' },
  { file: 'W398-ops-face-attendance.html', wave: '1b', module: 'attendance', verdict: 'BUILT (honest)', note: '/attendance/face-attendance — HONEST, reads nothing: the summary read (attendance.controller.ts:43 → attendance.repository.ts:151-167) gives tenant-wide review tiles, not a booking\'s counts by method, so no count is printed; no wage figure' },
  { file: 'W399-ops-biometric-canon.html', wave: '1b', module: 'canon', verdict: 'BUILT (honest)', note: '/canon/biometric — HONEST reference: what IS stored (the AePS record\'s fields after Q7-A, attendance GPS and method, face PHOTOS — profile photo and KYC selfie — and that erased photos are anonymised, not deleted), and that no fingerprint or face template is stored anywhere' },
  { file: 'W3289-ops-aeps-mutate-confirm.html', wave: '1b', module: 'aeps', verdict: 'REAL', note: '/aeps/withdrawal?act=confirm — "Record what the bank\'s device showed (nothing moves here)": the record form under the confirm sentence; its submit IS the act' },
  { file: 'W3290-ops-aeps-mutate-success.html', wave: '1b', module: 'aeps', verdict: 'REAL', note: '?act=success — "Recorded — a record, not a receipt" (the API answered 201); the zero-sum sentence refused BY NAME (`aeps_zero_sum`)' },
  { file: 'W3291-ops-aeps-mutate-failure.html', wave: '1b', module: 'aeps', verdict: 'REAL', note: '?act=failure&reason=… — "Nothing was recorded" with the server\'s named reason (403 not enabled · 404 switched off · 400 a rule or a Q7-A refusal by its code · 409 already recorded); Back → W391' },
  // ── 1c · the kiosk (13) — decided by 1c (founder Q4-A′, Q6-A, Q8-A, Q9-A, Q10-A, Q11-A) ──
  { file: 'W380-ops-kiosk-home.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (read)', note: '/kiosk/home (`/kiosk` → 307) — a READ of her own GET /v1/ambassadors/me (active; kiosk mode on/off and training recorded/not, printed as two separate facts, never "flips"; whether a tier is set) and her newest GET …/me/earnings rows as returned (no total — none exists); honest states "no ambassador profile here" (404 AMBASSADOR_NOT_FOUND) and "switched off" (the flag\'s 404); links to W381–W389. Session count, sync chip, battery, the 60-day consequence and the canon\'s event codes and rates refused by name' },
  { file: 'W381-ops-kiosk-session-start.html', wave: '1c', module: 'kiosk', verdict: 'REAL', note: '/kiosk/session-start — THE ONE FORM: create an account for a new number over the EXISTING keyed POST /v1/users (phone, name, language from the platform registry); 409 → "This number already has an account. She signs in herself, on her own phone." and nothing about the person (Q9-A); the phone never enters a URL; no "session" claim (Q10-A)' },
  { file: 'W382-ops-kiosk-profile.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/profile — DEVIATION from survey §1D (REAL as fields of the act): name and language are set on W381\'s one form so no phone crosses a page; she changes them in her own app. Voice capture, the photo and masked candidates refused by name; "Retry" is a plain re-read link' },
  { file: 'W383-ops-kiosk-land-crops.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/land-crops — she records her land and crops herself, in her own app; the bigha factor, the 7/12 capture and the read-aloud refused by name' },
  { file: 'W384-ops-kiosk-kyc.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/kyc — Q6-A: no Aadhaar capture at the desk; she checks her identity herself in her own sign-in; the masking rule and card pictures are a lawyer\'s question; "Retry" is a plain re-read link' },
  { file: 'W385-ops-kiosk-bank.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/bank — she adds her bank account herself; no test payment is ever sent to check an account (penny_verified_at has no writer) — refused by name' },
  { file: 'W386-ops-kiosk-first-listing.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/first-listing — Q8-A: she lists and publishes herself; "list on my behalf" cannot be given at a desk (no route records an on-behalf consent with a helper named, since OPS-1c); "Retry" is a plain re-read link' },
  { file: 'W387-ops-kiosk-schemes.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/schemes — she checks and applies herself; "tagged assisted_by" refused as a guarantee (F-11)' },
  { file: 'W388-ops-kiosk-summary.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (honest)', note: '/kiosk/summary — what this desk did (an account for a new number — never "member"); "Creating your account at this desk pays the helper nothing, and you pay nothing." (Q4-A′); "Your organisation\'s helpline is not published yet." (Q11-A); nothing done here can be undone from this desk' },
  { file: 'W389-ops-kiosk-ambassador.html', wave: '1c', module: 'kiosk', verdict: 'BUILT (read)', note: '/kiosk/ambassador — her own GET …/me/earnings rows as returned (amount through the money formatter; in a pay run / not yet paid); no total, no rate, no "×" or "="; no pay-run read (none is her own — the runs read needs a payout permission), said so; her organisation\'s ambassador managers can also read her earnings, said so' },
  { file: 'W3329-ops-kiosk-mutate-confirm.html', wave: '1c', module: 'kiosk', verdict: 'REAL', note: '/kiosk/session-start?act=confirm — "Create an account for this number": the one form under the confirm sentence; its submit IS the act' },
  { file: 'W3330-ops-kiosk-mutate-success.html', wave: '1c', module: 'kiosk', verdict: 'REAL', note: '?act=success — "An account exists for this number; she signs in on her own phone" (the API answered 201); the zero-sum sentence refused BY NAME (`kiosk_zero_sum`)' },
  { file: 'W3331-ops-kiosk-mutate-failure.html', wave: '1c', module: 'kiosk', verdict: 'REAL', note: '?act=failure&reason=… — "Nothing was created" with the server\'s named reason (409 → Q9-A\'s sentence · 400/422 a field rule · 403 not allowed) or the console\'s own pre-check; Back → W381, never W380' },
]);

// ── THE CHAINS: each is a query state of its parent page. 1a's two are DECOR; 1b's aeps chain and 1c's kiosk chain are REAL (their act's own states) ──
export type Chain1Id = 'payout_act' | 'withdrawal_act' | 'aeps_act' | 'kiosk_act';
export interface Chain1Def {
  id: Chain1Id; wave: '1a' | '1b' | '1c'; kind: 'DECOR' | 'REAL'; param: string; page: string; surface: Ops1Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS1_CHAINS: readonly Chain1Def[] = Object.freeze([
  { id: 'payout_act', wave: '1a', kind: 'DECOR', param: 'act', page: '/payout', surface: 'payout_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.payoutAct.${s}`, files: ['W3332', 'W3333', 'W3334'], statement: 'ops1.payout.statement' },
  { id: 'withdrawal_act', wave: '1a', kind: 'DECOR', param: 'act', page: '/warehouse/withdrawal', surface: 'withdrawal_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.withdrawalAct.${s}`, files: ['W3369', 'W3370', 'W3371'], statement: 'ops1.withdrawal.statement' },
  // REAL (founder Q1-A): confirm = the record form under "record what the bank's device showed (nothing moves here)"; success = the API
  // answered 201 ("recorded — a record, not a receipt"); failure = nothing was recorded, with the server's named reason. Back → W391.
  { id: 'aeps_act', wave: '1b', kind: 'REAL', param: 'act', page: '/aeps/withdrawal', surface: 'aeps_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.aepsAct.${s}`, files: ['W3289', 'W3290', 'W3291'], statement: 'ops1.aeps.statement' },
  // REAL (E4): confirm = the create form under "Create an account for this number"; success = the API answered 201 ("An account exists for this
  // number; she signs in on her own phone"); failure = "Nothing was created", with the server's named reason. Back → W381, never W380.
  { id: 'kiosk_act', wave: '1c', kind: 'REAL', param: 'act', page: '/kiosk/session-start', surface: 'kiosk_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops1.chain.kioskAct.${s}`, files: ['W3329', 'W3330', 'W3331'], statement: 'ops1.kiosk.statement' },
]);
export function chain1ById(id: Chain1Id): Chain1Def { return OPS1_CHAINS.find((c) => c.id === id) as Chain1Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain1State(id: Chain1Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain1ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
