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
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops1Surface =
  // OPS-1a — built
  | 'payout' | 'payout_bill' | 'withdrawal' | 'payout_act' | 'withdrawal_act'
  // OPS-1b — built
  | 'aeps_home' | 'aeps_record' | 'aeps_exceptions' | 'aeps_receipt' | 'face_enroll' | 'face_attendance' | 'biometric_canon' | 'aeps_act'
  // OPS-1c — declared, pending
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
    key: 'ops1.refusal.aepsAuditView', why: 'the record DOES write one audit entry (actor, time; no reason is asked — HOTFIX-10); no ops audit surface shows it' },
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
]);

/** The verdict values. `pending_1c` is deleted by the wave that decides it (the 4c-7 rule; OPS-1b deleted `pending_1b`). */
export type Ops1Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'pending_1c';
/** Every canon file of OPS-1 (31), each with ONE verdict: 1a decided its 8, 1b its 10; 1c's 13 are pending. */
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
  // ── 1c · the kiosk (13) — pending ──
  { file: 'W380-ops-kiosk-home.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (read)' },
  { file: 'W381-ops-kiosk-session-start.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (the create act)' },
  { file: 'W382-ops-kiosk-profile.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (the create act)' },
  { file: 'W383-ops-kiosk-land-crops.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W384-ops-kiosk-kyc.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W385-ops-kiosk-bank.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W386-ops-kiosk-first-listing.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W387-ops-kiosk-schemes.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W388-ops-kiosk-summary.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (honest)' },
  { file: 'W389-ops-kiosk-ambassador.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (read)' },
  { file: 'W3329-ops-kiosk-mutate-confirm.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
  { file: 'W3330-ops-kiosk-mutate-success.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
  { file: 'W3331-ops-kiosk-mutate-failure.html', wave: '1c', module: 'kiosk', verdict: 'pending_1c', note: 'OPS-1c (kiosk chain)' },
]);

// ── THE CHAINS: each is a query state of its parent page. 1a's two are DECOR; 1b's aeps chain is REAL (the record act's own states) ──
export type Chain1Id = 'payout_act' | 'withdrawal_act' | 'aeps_act';
export interface Chain1Def {
  id: Chain1Id; wave: '1a' | '1b'; kind: 'DECOR' | 'REAL'; param: string; page: string; surface: Ops1Surface; states: readonly string[];
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
]);
export function chain1ById(id: Chain1Id): Chain1Def { return OPS1_CHAINS.find((c) => c.id === id) as Chain1Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain1State(id: Chain1Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain1ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
