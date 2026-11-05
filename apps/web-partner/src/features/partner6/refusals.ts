// apps/web-partner/src/features/partner6/refusals.ts · PC-56 PARTNER-6a · WHERE A CLAIM IS NOT PAID (founder 6a-1 … 6a-4, 2026-11-05) — WHAT
// THE INSURER'S SETTLEMENT PAGES DO NOT CLAIM, BY NAME. PURE. The shape of features/partner5/refusals.ts: each refused canon claim is listed
// ONCE with where the canon makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this
// map, and the claims guard (test/claims-guard.spec.ts, SCOPE_6A) keeps the canon's false words out of every value AND out of every key this
// registry prints (including the PARTNER-3 and PARTNER-4 keys it reuses BY KEY). The sentences word the refused claims generically: no canon
// person, place, institution, claim reference, account tail, figure or avatar appears in any value.
//
// THE SURFACES `Partner6Surface` — PARTNER-6a builds four:
//   • `settlements` (W260, `/insurer/settlements`) — a READ of PARTNER-3a's audited `GET /v1/partner/insurance/claims/counts` (0230's
//     `partner_insurance_claim_counts`, the IST window answered by the database): the COUNTS of the insurer's claims FILED in the window that
//     are approved and partially approved — "awaiting a settlement this platform does not make" — and paid, which is 0 by construction,
//     beside "No claim is paid on this platform." Counts only: no rupee total, no claimant, no account, no run, no rail (founder 6a-1).
//   • `settlement` (W261, `/insurer/settlements/[id]`, the `[id]` a CLAIM id) — an HONEST PAGE THAT READS NOTHING: every id prints the same
//     page, the id only ever in an href (founder 6a-2, the 5b-3 rule).
//   • `settlement_act` (W2901–W2903 on W260, `?act=`) and `settlement_detail_act` (`?act=` on W261, `files: []`) — DECOR: the chain's lead
//     act is the refused settlement itself, so even W260's genuine re-read of the counts leaves the chain's verdict DECOR (brief E3).
// PC-56 PARTNER-6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE (founder 6b-1 … 6b-5, doors Q3-A / Q4-A / Q6-A, 2026-11-05) builds six
// more — the lender's two honest pages and their four DECOR chains:
//   • `consents` (W213, `/lender/consents`, a LENDING sidebar item between Portfolio and "SLA & reports") — AN HONEST PAGE THAT READS NOTHING
//     (Q3-A): how a farmer's consent works on this platform and that none is recorded yet; no registry, no person, no phone, no application
//     reference, no channel, no scope, no count. Never "revocable" / "time-boxed" / "within 60 seconds" / "logged on both sides" / "you never
//     hold standing access" (Q4-A: today a consent with no end date is admitted for ever — survey C-10).
//   • `regulatory` (W224, `/lender/reports/regulatory`, linked from W214) — AN HONEST PAGE THAT READS NOTHING (Q6-A): no regulatory extract,
//     no classification for a regulator, never a borrower's gender or landholding; the book's own figures are on Portfolio and DPD aging; the
//     organisation files its own returns; the partners mailbox for data a filing of its own needs.
//   • `consents_export` (W2921–W2922, DECOR + mailbox), `consents_act` (W2923–W2925, DECOR), `regulatory_form` (W2987–W2990, DECOR + mailbox,
//     no input, no confirm page claimed), `regulatory_act` (W2991–W2993, DECOR).
// PC-56 PARTNER-6c · WHAT THE PLATFORM TELLS A PARTNER PERSON (founder 6c-1 … 6c-6, doors Q5-A / Q7-A, 2026-11-05) builds the last five —
// every partner person's two account pages and their three chains. With it PARTNER-6 is 31 of 31 and the partner panel 222 of 222:
//   • `notifications` (W270, `/account/notifications`, FIRST in the Account group for every partner kind; `/notifications` answers 307 here) —
//     AN HONEST PAGE THAT READS NOTHING (Q5-A): the platform sends a partner person two kinds of message, by SMS — a sign-in code and a team
//     invitation — and nothing else in this console; the organisation's machine notifications are its webhooks (a real link to their delivery
//     log, `/account/webhooks`). No inbox, no item, no counter, no person, no place, no event code, no `<select>`.
//   • `notification_prefs` (W271, `/account/notifications/preferences`) — AN HONEST PAGE WITH NO CHECKBOX (Q5-A): the two messages cannot be
//     switched off and nothing else is sent, so there is nothing else to set — PLUS the one REAL act of PARTNER-6 (Q7-A): the console's
//     language, a radio group of `@krishalaya/i18n`'s live languages and one submit (features/partner6/language.ts).
//   • `notification_form` (W2960–W2963, `?form=`) — REAL: the language act (error = an unknown code, nothing set; review = the chosen language
//     named in itself; success = set and re-rendered; failure = could not be set). The canon's three other triggers (Change time, Change
//     window, Save preferences) print their refusals in the same states (the 1a W3006–W3008 precedent: one real trigger makes the chain REAL).
//   • `notification_act` (W2964–W2966) and `notifications_act` (W2967–W2969, "Mark all read") — DECOR, refused by name.
export type Partner6Surface =
  | 'settlements' | 'settlement' | 'settlement_act' | 'settlement_detail_act'
  // PARTNER-6b
  | 'consents' | 'regulatory' | 'consents_export' | 'consents_act' | 'regulatory_form' | 'regulatory_act'
  // PARTNER-6c
  | 'notifications' | 'notification_prefs' | 'notification_form' | 'notification_act' | 'notifications_act';
export interface Partner6Refusal { id: string; canon: string; surfaces: readonly Partner6Surface[]; key: string; why: string }

/** The surfaces PARTNER-6a builds. */
export const SURFACES_6A: readonly Partner6Surface[] = ['settlements', 'settlement', 'settlement_act', 'settlement_detail_act'];
/** The two pages of 6a. */
const PAGES_6A: readonly Partner6Surface[] = ['settlements', 'settlement'];
/** The two chain surfaces of 6a (one canon chain, W2901–W2903, opened from both pages). */
const CHAINS_6A: readonly Partner6Surface[] = ['settlement_act', 'settlement_detail_act'];
/** PC-56 PARTNER-6b — the surfaces it builds: two honest pages and four DECOR chains. */
export const SURFACES_6B: readonly Partner6Surface[] = ['consents', 'regulatory', 'consents_export', 'consents_act', 'regulatory_form', 'regulatory_act'];
/** The two pages of 6b. */
const PAGES_6B: readonly Partner6Surface[] = ['consents', 'regulatory'];
/** The two MUTATE chains of 6b (Retry on a page that reads nothing — nothing to re-read) and the regulatory FORM chain (no form). */
const ACTS_6B: readonly Partner6Surface[] = ['consents_act', 'regulatory_act'];
const STEPS_6B: readonly Partner6Surface[] = [...ACTS_6B, 'regulatory_form'];
/** PC-56 PARTNER-6c — the surfaces it builds: every partner person's two account pages, the REAL language form chain and two DECOR chains. */
export const SURFACES_6C: readonly Partner6Surface[] = ['notifications', 'notification_prefs', 'notification_form', 'notification_act', 'notifications_act'];
/** The two pages of 6c. */
const PAGES_6C: readonly Partner6Surface[] = ['notifications', 'notification_prefs'];
/** The two DECOR mutate chains of 6c (Retry on a page that reads nothing; "Mark all read" with nothing to read). */
const ACTS_6C: readonly Partner6Surface[] = ['notification_act', 'notifications_act'];

export const PARTNER6_REFUSALS: readonly Partner6Refusal[] = Object.freeze([
  // ══ W260 · Claim settlements (founder 6a-1: counts only) ══
  { id: 'approved_to_paid', canon: 'W260 lead "Approved → paid, in daily runs on platform rails. The distance from \'approved\' to money-in-account is measured in hours and displayed to the claimant — a kept promise has a timestamp."', surfaces: ['settlements'],
    key: 'partner6.refusal.approvedToPaid', why: 'FALSE ×4 (MONEY, survey F-1): no claim is paid (INS insurance-claim.service.ts:225-229 refuses settle by name; the entity\'s settle() has no caller), so no run, no rail and no measurement exist (C-9: no claim TAT is stored), and nothing is shown to a claimant (P3-B8)' },
  { id: 'release_run', canon: 'W260 "Release today\'s run (2 claims, checker)" (FM:284, `chain-mutate` → W2901–W2903)', surfaces: ['settlements', ...CHAINS_6A],
    key: 'partner3.refusal.payoutBatch', why: 'DECOR — refused by name (MONEY): no payout batch exists for claims (founder 3a Q1). PARTNER-3a\'s refusal, reused BY KEY (brief 6a-1)' },
  { id: 'paying_chip', canon: 'W260 "Approved → paid" and the canon\'s "approved · paying" reading of an approved claim', surfaces: ['settlements', 'settlement', ...CHAINS_6A],
    key: 'partner3.refusal.payingChip', why: 'founder 3a Q1: an approved claim stays approved; nobody pays it — PARTNER-3a\'s refusal, reused BY KEY (brief 6a-1)' },
  { id: 'ready_to_pay', canon: 'W260 KPI "Ready to pay ₹1,58,000 · 2 claims approved this morning"', surfaces: ['settlements'],
    key: 'partner6.refusal.readyToPay', why: 'the COUNT exists (0230:146-161, no amount); "ready to pay" is FALSE and the rupee total is refused — a summed payable figure is the money claim PARTNER-2b refused for premiums (founder 6a-1)' },
  { id: 'paid_year', canon: 'W260 KPI "Paid FY ₹41,80,000 · 64 claims · median approve → paid 5h"', surfaces: ['settlements'],
    key: 'partner6.refusal.paidYear', why: 'FALSE (MONEY): `paid` is unreachable (C-3), so the count is 0 by construction and is printed as such; the sum and the median have no source (C-9)' },
  { id: 'failed_transfers', canon: 'W260 KPI "Failed transfers 0 · verified accounts from platform KYC — the failure mode barely exists"', surfaces: ['settlements'],
    key: 'partner6.refusal.failedTransfers', why: 'FALSE + WALL: no transfer exists to fail; "verified accounts" names the claimant\'s bank account (`bank_accounts` is user / tenant owned, 0003:136-149) — never on the partner axis' },
  { id: 'disputes', canon: 'W260 KPI "Settlement disputes (FY) 1 · partial-approval appeal · resolved with re-survey"', surfaces: ['settlements'],
    key: 'partner6.refusal.disputes', why: 'FALSE: no settlement exists to dispute and no appeal path exists (P3-B9, named); the re-survey loop is not a dispute' },
  { id: 'claim_row', canon: 'W260 table rows "… · <claimant name> · 2nd approver ✓ (≥₹1L) · ₹… · verified a/c ••… · today 16:00" (Approved · Claim · Amount · Destination · Run)', surfaces: ['settlements'],
    key: 'partner6.refusal.claimRow', why: 'the claim facts already exist on `/insurer/claims` (3a) and are not duplicated; the claimant name is WALL (3a founder Q4); no maker-checker on a decision (P3-B5); the destination account is WALL + MONEY; no run exists' },
  { id: 'sums_verified', canon: 'W260 "2 of 2 in today\'s run · sums to ₹1,58,000 ✓ (server-verified)"', surfaces: ['settlements'],
    key: 'partner6.refusal.sumsVerified', why: 'FALSE: no run, no amount added up, nothing verified' },
  { id: 'payout_link', canon: 'W260 "Each payout links claim → payout_id → ledger — one chain, no side doors." · W261 "₹ paid → payout_id po-… → ledger txn"', surfaces: PAGES_6A,
    key: 'partner3.refusal.payoutLink', why: '`payout_id` is NULL by design and never on the partner axis (0230 definer comment) — PARTNER-3a\'s refusal, reused BY KEY; its wording now says no SETTLEMENT exists for a claim (this wave built the honest settlement page, so "no settlement page" would no longer be true)' },
  { id: 'public_check', canon: 'W260 "The claimant\'s SMS carries the amount AND the reference; a village can verify its own insurance money."', surfaces: ['settlements'],
    key: 'partner6.refusal.publicCheck', why: 'FALSE ×2: no claimant notification exists (P3-B8); a public-verification promise the platform does not make' },
  { id: 'daily_job', canon: 'W260 empty state "Nothing to settle — Approved claims appear here within minutes — the run fires daily at 16:00 regardless."', surfaces: ['settlements'],
    key: 'partner6.refusal.dailyJob', why: 'FALSE: no job exists; "Nothing to settle" is true in a sense the canon does not mean (nothing is ever settled), so the empty state says what is true instead' },
  { id: 'reassembles', canon: 'W260 error state "Couldn\'t load run — Approved claims cannot be lost; the run re-assembles."', surfaces: ['settlements', 'settlement_act'],
    key: 'partner6.refusal.reassembles', why: 'FALSE ×2: no run; nothing is gathered for payment. The page\'s own error state is a failed read of the COUNTS, and says so' },
  { id: 'finance_role', canon: 'W260 restricted state "Settlements restricted — Finance role at your insurer + checker; the run executes on platform rails." · W261 "Detail restricted — Finance + claims role"', surfaces: PAGES_6A,
    key: 'partner4.refusal.platformRoles', why: 'FALSE ×3: the partner realm has four roles (0225:20-21) and `partner.claims.read` covers the counts for all four (0230); no finance role, no checker on a payment, no rail — PARTNER-4\'s refusal, reused BY KEY' },
  { id: 'plan_settings', canon: 'W260 / W261 flagged-off state "Claim Settlements disabled / Settlement Detail disabled … See plan settings." · PC-56 PARTNER-6b: W213 "Flagged off — Consent Registry disabled … See plan settings." · W224 "Flagged off — Regulatory & PSL Reports disabled … See plan settings." · PC-56 PARTNER-6c: W270 / W271 "Flagged off — Notifications / Notification Preferences disabled … See plan settings."', surfaces: [...PAGES_6A, ...PAGES_6B, ...PAGES_6C],
    key: 'partner4.refusal.planSettings', why: 'OFF-as-OFF via `partner_console` (and the platform\'s `insurance`); no plan-settings surface exists for a partner organisation — PARTNER-4\'s refusal, reused BY KEY (brief E4)' },
  // ══ W261 · one claim's "settlement" (founder 6a-2: a readless honest page) ══
  { id: 'named_heading', canon: 'W261 heading "Settlement — <claimant name>, ₹1,10,000 · in today\'s 16:00 run"', surfaces: ['settlement'],
    key: 'partner3.refusal.namedHolders', why: 'WALL + FALSE (MONEY, survey F-2): never a claimant\'s name (3a founder Q4); no run — PARTNER-3a\'s refusal, reused BY KEY' },
  { id: 'decider_names', canon: 'W261 "approved today 10:20 (decider <name> + 2nd approver <name>, ≥₹1L rule)"', surfaces: ['settlement'],
    key: 'partner6.refusal.deciderNames', why: 'WALL: staff names; and the decider is the cooperative desk, not the insurer (3a "the insurer reads only"); "≥₹1L rule" FALSE (P3-B5)' },
  { id: 'claim_file', canon: 'W261 "Claim file (complete, hash-sealed)" (FM:288 — a dead `data-decor` button classed `nav-detail`)', surfaces: ['settlement'],
    key: 'partner6.refusal.claimFile', why: 'FALSE: no claim-file export, no hash, no seal (P3-B7, named); the claim\'s own facts are on its claim page' },
  { id: 'whole_chain', canon: 'W261 "The whole chain, one view": the paid row, the payout id, "lands ~16:15, SMS with reference"', surfaces: ['settlement'],
    key: 'partner6.refusal.wholeChain', why: 'FALSE (MONEY): no payment step, no payout reference, no message exists for any claim; the claim\'s timeline facts are 3a\'s page' },
  { id: 'survey_details', canon: 'W261 "surveyed · <surveyor> · ear-tag ••… verified · bloat, natural" and the decision note', surfaces: ['settlement'],
    key: 'partner6.refusal.surveyDetails', why: 'WALL (3b): the insurer sees the recorded damage percentage and nothing else of the report; the decision note is never on the axis (0230 comment)' },
  { id: 'event_to_money', canon: 'W261 "Event to money: 9 days. The FY median is 9 days too — this file is the system working, not an exception."', surfaces: ['settlement'],
    key: 'partner6.refusal.eventToMoney', why: 'FALSE: no payment, so no duration and no median (C-9)' },
  { id: 'claimant_message', canon: 'W261 "What she receives" — the Gujarati SMS addressed to the claimant by name, promising money tonight (never copied, never fixtured)', surfaces: ['settlement'],
    key: 'partner6.refusal.claimantMessage', why: 'FALSE + WALL (survey F-2): no claimant notification exists (P3-B8); the text names her and promises money that cannot move' },
  { id: 'credit_offer', canon: 'W261 "the vet desk follows up next week about a replacement animal (dairy loan pre-approved offer, HER choice, zero pressure)"', surfaces: ['settlement'],
    key: 'partner6.refusal.creditOffer', why: 'FALSE and a trust line: no vet desk; offering credit on the strength of an insurance claim is the cross-module reuse PARTNER-3 and -4 refused (S3 F-6, S4 F-7); no score exists to "pre-approve" anything (P4-B14)' },
  { id: 'recovery_notes', canon: 'W261 "Recovery & reinsurance notes — Claim tagged to your reinsurance treaty (cattle book) automatically; the hash-sealed file IS the cedant documentation." and the state "No recovery notes yet"', surfaces: ['settlement'],
    key: 'partner6.refusal.recoveryNotes', why: 'FALSE: no treaty, no tag, no file, no notes' },
  { id: 'recorded_end_to_end', canon: 'W261 "Settlement recorded end-to-end · claim → payout → ledger, one chain"', surfaces: ['settlement'],
    key: 'partner6.refusal.recordedEndToEnd', why: 'FALSE (MONEY): no settlement is recorded for any claim' },
  { id: 'retention', canon: 'W261 state "Settlement not found — Paid settlements keep their full chain (7 years)."', surfaces: ['settlement'],
    key: 'partner6.refusal.retention', why: 'a retention promise (refused, B2a); and the readless page has no not-found at all — every id prints the same page (founder 6a-2 / 5b-3)' },
  { id: 'not_at_risk', canon: 'W261 error state "Couldn\'t load settlement — The 16:00 run is server-side; her money is not at risk from this view."', surfaces: ['settlement', 'settlement_detail_act'],
    key: 'partner6.refusal.notAtRisk', why: 'FALSE: no money is moving at all; and the readless page has no error state' },
  { id: 'export_watermark', canon: 'W261 restricted state "Detail restricted — Finance + claims role; the claim file export is watermarked."', surfaces: ['settlement'],
    key: 'partner6.refusal.exportWatermark', why: 'FALSE: no claim-file export exists from this console, so nothing is watermarked' },
  // ══ the settlement chain (W2901–W2903; DECOR on both pages) ══
  { id: 'zero_sum', canon: 'W2902 "Money-adjacent actions reconcile zero-sum before this page ever shows" — on a SETTLEMENT chain: the most dangerous chain sentence in the panel (survey §1F)', surfaces: CHAINS_6A,
    key: 'partner6.refusal.zeroSum', why: 'refused BY NAME with its own sentence (brief E3): on a settlement chain the canon tells an insurer that money moved and balanced; nothing moved' },
  { id: 'chain_on_call', canon: 'W2903 "repeated failures page the on-call" · PC-56 PARTNER-6b: W2925 / W2990 / W2993 the same sentence · PC-56 PARTNER-6c: W2963 / W2966 / W2969', surfaces: [...CHAINS_6A, ...STEPS_6B, 'notification_form', ...ACTS_6C],
    key: 'partner4.refusal.chainOnCall', why: 'no paging from a partner page exists — the shared chain sentence, reused BY KEY (brief E3)' },
  { id: 'chain_audit', canon: 'W2901 "confirming writes an audit-trail entry with actor, time and reason" · W2902 "the audit trail has the entry (actor · time · reason · before/after)" and "View audit trail" · PC-56 PARTNER-6b: W2923 / W2991 (confirm), W2924 / W2989 / W2992 (success + "View audit trail") · PC-56 PARTNER-6c: W2964 / W2967 (confirm), W2965 / W2968 (success) — the two DECOR chains only (the REAL language act has its own sentence, `language_no_audit`)', surfaces: [...CHAINS_6A, ...STEPS_6B, ...ACTS_6C],
    key: 'partner6.refusal.chainAudit', why: 'nothing is done, so nothing is written; the console has no audit-trail page. PARTNER-4\'s `chainAudit` is NOT reused: its sentence names a lender\'s application decisions' },

  // ══ PC-56 PARTNER-6b · W213 the consent registry (founder 6b-1 / Q3-A: a page that reads nothing and shows no one; 6b-2 / Q4-A) ══
  { id: 'consent_adjectives', canon: 'W213 lead "Every data-sharing consent your bank holds (credit_score_consents): purpose-bound, time-boxed, revocable."', surfaces: ['consents'],
    key: 'partner6.refusal.consentAdjectives', why: 'founder 6b-2 (Q4-A, survey C-10 / F-3): `credit_score_consents` has NO revocation column and a NULLABLE `expires_at` the oracle admits for ever (0225:333) — "time-boxed" and "revocable" are FALSE today; "purpose-bound" is only true as "one application" and is said that way in the statement' },
  { id: 'bank_holds', canon: 'W213 "Every data-sharing consent your bank holds"', surfaces: ['consents'],
    key: 'partner6.refusal.bankHolds', why: 'founder 6b-1: the PLATFORM holds the record; kv_partner holds nothing on `credit_score_consents` (0231:307, 0232:190 — re-proved live, partner6b (2))' },
  { id: 'provably', canon: 'W213 "When a consent ends, your access ends — automatically, provably."', surfaces: ['consents'],
    key: 'partner6.refusal.provably', why: '"your access ends" is TRUE where an expiry exists (the oracle checks at every read — printed in the statement, pinned live in partner6b (1)); "provably" is UNPROVABLE to a lender, who cannot read the consent row' },
  { id: 'consent_registry_rows', canon: 'W213 table Borrower · Purpose · Granted · Expires · Covers and its three rows (a farmer\'s name and masked phone, an application reference, a date and a channel, an expiry, what the consent covers)', surfaces: ['consents', 'consents_export'],
    key: 'partner6.refusal.registryRows', why: 'WALL + FALSE (founder 6b-1, PARTNER-0 Q4): never a name; a masked phone only on an approved consented application; no channel column and no scope column exist (0011:47-52); the canon\'s persons, phones and references are never copied' },
  { id: 'status_chips', canon: 'W213 chips "active · expiring ≤ 7d · expired/revoked (90d)" (FM:124-126, `filter`)', surfaces: ['consents'],
    key: 'partner6.refusal.statusChips', why: 'founder 6b-1 (Q3-A, not Q3-B): no count of consents is read or printed (it would need a new definer and reads 0 in production); "revoked" cannot exist (no revocation)' },
  { id: 'standard_term', canon: 'W213 row note "(short-form consent — 7d standard)"', surfaces: ['consents'],
    key: 'partner6.refusal.standardTerm', why: 'FALSE: no standard consent term exists anywhere (0011:46-53; no writer at all — P4-B6)' },
  { id: 'covers_score', canon: 'W213 column "Covers" — "score + factors only" · "score + factors + statements + bank statement" · "score + factors + NWR valuation"', surfaces: ['consents'],
    key: 'partner4.refusal.creditScore', why: 'founder 4a-4: no rating exists and none is computed; the score is refused by name — PARTNER-4a\'s refusal, reused BY KEY (brief E3)' },
  { id: 'revocation_seconds', canon: 'W213 "A revocation takes effect within 60 seconds and is logged on both sides."', surfaces: ['consents'],
    key: 'partner6.refusal.revocationSeconds', why: 'FALSE ×2 (founder 6b-2 / Q4-A): no revocation exists — no column, no route, no writer — so nothing takes effect in any time and nothing is logged on either side' },
  { id: 'decision_record', canon: 'W213 "Data already used in a lawful decision stays in that decision\'s record; everything else goes dark."', surfaces: ['consents'],
    key: 'partner6.refusal.decisionRecord', why: 'PARTIAL (survey §1A, F-3): the oracle hides the application ROW once its consent lapses, so the lender\'s own decision on it goes dark to it too; whether a regulated lender must retain it is a lawyer\'s question (§7) — no promise is made' },
  { id: 'compliance_file', canon: 'W213 "This registry is exportable (signed) for your RBI compliance file."', surfaces: ['consents', 'consents_export'],
    key: 'partner6.refusal.complianceFile', why: 'FALSE: no registry, no export, no signature; and naming a regulator\'s file is a regulatory statement the platform does not make' },
  { id: 'will_appear', canon: 'W213 empty state "No consents recorded yet — Credit-score and data-sharing consents farmers grant you will appear here as they\'re given."', surfaces: ['consents'],
    key: 'partner6.refusal.willAppear', why: 'the first clause is TRUE and is the page\'s `noneYet` sentence; "will appear here" is FALSE under Q3-A (the page lists no one, ever) and "credit-score" consents are refused with the score' },
  { id: 'arrive_with_applications', canon: 'W213 empty state "No active consents — Consents arrive with applications — you never hold standing access to anyone."', surfaces: ['consents'],
    key: 'partner6.refusal.arriveWithApplications', why: 'FALSE ×2: no surface asks a farmer for this consent (P4-B6); and the schema PERMITS open-ended access (C-10) — the promise is binding on P4-B6 (founder 6b-2), not true today' },
  { id: 'consents_no_error', canon: 'W213 error state "Couldn\'t load registry — Consent enforcement is at the data layer, unaffected. Retry." (FM:122 → W2923–W2925)', surfaces: ['consents', 'consents_act'],
    key: 'partner6.refusal.consentsNoError', why: 'the readless page has NO error state (the W217 / 5b rule); "enforcement is at the data layer" is TRUE (the RLS policy + the oracle, 0225:339-345) and the statement says the platform checks every read' },
  { id: 'partner_roles_consents', canon: 'W213 restricted state "Registry restricted — Compliance role at your bank" · W224 "Regulatory restricted — Compliance role at your bank"', surfaces: PAGES_6B,
    key: 'partner2.refusal.partnerRoles', why: 'FALSE: the partner realm has four roles (0225:20-21) — no compliance role. PARTNER-2\'s refusal, reused BY KEY (brief E3)' },
  { id: 'audit_mirror', canon: 'W213 restricted state "… the platform audit team sees the mirror of this registry."', surfaces: ['consents'],
    key: 'partner6.refusal.auditMirror', why: 'FALSE: no registry exists, so no mirror of one exists for anyone' },
  { id: 'export_registry', canon: 'W213 "Export registry (signed)" (FM:119, `chain-export` → W2921–W2922)', surfaces: ['consents', 'consents_export'],
    key: 'partner6.refusal.exportRegistry', why: 'DECOR + the mailbox line (founder 6b-5, P2-B6 / 2b-1): no partner export plane; and a registry of farmers\' consents would be a file of named people — refused by its content as well as by the plane' },

  // ══ PC-56 PARTNER-6b · W224 regulatory reporting (founder 6b-3 / Q6-A: a page that reads nothing) ══
  { id: 'prepared_filings', canon: 'W224 lead "Your platform book, pre-shaped for the filings you already make: priority-sector lending (agri), weaker-section splits, DPD schedules. Extracts, signed — your compliance team files, we never file for you."', surfaces: ['regulatory'],
    key: 'partner6.refusal.preparedFilings', why: '"we never file for you" is TRUE and is in the statement; everything else FALSE (survey C-2): no classification, no extract, no signature exists; the DPD buckets are a book figure (Portfolio → DPD aging), not a regulatory schedule' },
  { id: 'generate_pack', canon: 'W224 "Generate Q1 pack" ×2 (FM:179-180, `chain-form` → W2987–W2990)', surfaces: ['regulatory', 'regulatory_form'],
    key: 'partner2.refusal.reportPack', why: 'DECOR — refused by name (founder 6b-5): no generator exists; PARTNER-2b\'s refusal, reused BY KEY (the W254 precedent)' },
  { id: 'target_classification', canon: 'W224 KPI "PSL-qualifying (agri) ₹… · 100% of platform book — every loan is direct agriculture"', surfaces: ['regulatory'],
    key: 'partner6.refusal.targetClassification', why: 'FALSE → refused (founder 6b-3): a classification under a regulator\'s directions the platform does not make (a lawyer\'s matter, §7); a percentage (the 5c rule); and product kinds include gold, bnpl, invoice discounting and working capital (0011:59)' },
  { id: 'land_kpi', canon: 'W224 KPI "Small & marginal farmers …% · landholding ≤ 2 ha, from verified land records — the sub-target that is hardest to source, sourced"', surfaces: ['regulatory'],
    key: 'partner6.refusal.landKpi', why: 'FALSE + WALL (survey F-5): `land_parcels` is the land module\'s record (0010:311-324), never on the partner axis (42501 — partner6b (2)); classifying borrowers for their lender by it is the cross-module reuse PARTNER-3 and -4 refused' },
  { id: 'gender_kpi', canon: 'W224 KPI "Women borrowers …% · … of … loans"', surfaces: ['regulatory'],
    key: 'partner6.refusal.genderKpi', why: 'FALSE + WALL (survey F-5): `users.gender` is a free, unverified, nullable varchar (0003:21) — "from KYC" is false; a borrower\'s gender is PII never on the axis (kv_partner holds nothing on `users` — partner6b (2))' },
  { id: 'extracts_table', canon: 'W224 table Extract · For · Period · Hash (three rows naming regulator returns with sha256 fragments) and the footer "… extracts · same signed-manifest format as everything else" (FM:176)', surfaces: ['regulatory'],
    key: 'partner6.refusal.extractsTable', why: 'FALSE: no extract and no hash exist; the canon\'s fragments are never copied; naming a regulator\'s return as a platform product is a regulatory statement' },
  { id: 'trace_to_evidence', canon: 'W224 "Classification claims trace to evidence: … from loan purpose + product kind; … from verified land records; … from KYC. Your auditor can walk every row back to its document — that is the pitch, and the protection."', surfaces: ['regulatory'],
    key: 'partner6.refusal.traceToEvidence', why: 'FALSE ×4 + WALL: no classification; a loan\'s purpose text is withheld until approval (0225:38); land and identity documents would reach a third party' },
  { id: 'packs_appear', canon: 'W224 empty state "No report packs generated yet — Quarterly regulatory and PSL packs will appear here once the first one is generated."', surfaces: ['regulatory'],
    key: 'partner6.refusal.packsAppear', why: 'FALSE: none will — no generator exists (C-2)' },
  { id: 'quarter_building', canon: 'W224 state "First quarter building — Extracts generate quarterly; live KPIs above accrue from day one." + "View portfolio" (FM:182, a dead `data-decor` button)', surfaces: ['regulatory'],
    key: 'partner6.refusal.quarterBuilding', why: 'FALSE ×2: nothing is generated or accrued for a filing; "View portfolio" is a REAL link on the built page' },
  { id: 'prior_packs', canon: 'W224 error state "Couldn\'t generate pack — Prior packs remain valid and re-downloadable. Retry." (FM:181 → W2991–W2993)', surfaces: ['regulatory', 'regulatory_act'],
    key: 'partner6.refusal.priorPacks', why: 'FALSE (no packs) and a retention promise (refused, B2a); the readless page has no error state and Retry re-reads nothing' },
  { id: 'extract_marks', canon: 'W224 restricted state "… extracts are signed and watermarked per download."', surfaces: ['regulatory'],
    key: 'partner6.refusal.extractMarks', why: 'FALSE: no extract is produced, so nothing is signed or marked per download' },

  // ══ PC-56 PARTNER-6b · the four chains (all DECOR) ══
  { id: 'export_file_6b', canon: 'W2921 "audit-stamped, checksummed, delivered by signed URL" · W2922 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged"', surfaces: ['consents_export'],
    key: 'partner4.refusal.exportFile', why: 'DECOR (founder 6b-5, 2b-1): no export plane for a partner (P2-B6); PARTNER-4\'s shared export refusal, reused BY KEY' },
  { id: 'chain_zero_sum_6b', canon: 'W2924 / W2989 / W2992 "Money-adjacent actions reconcile zero-sum before this page ever shows" · PC-56 PARTNER-6c: W2962 / W2965 / W2968 the same sentence', surfaces: [...STEPS_6B, 'notification_form', ...ACTS_6C],
    key: 'partner4.refusal.chainZeroSum', why: 'nothing reached from these pages moves money — PARTNER-4\'s lender-worded refusal, reused BY KEY (6a\'s `zeroSum` names a claim and is not reused)' },
  { id: 'form_without_form', canon: 'W2987–W2990 — a FOUR-STATE FORM chain opened by "Generate Q1 pack", a button with no input on W224; the four pages carry no `<input>`, `<label>` or `<select>`', surfaces: ['regulatory', 'regulatory_form'],
    key: 'partner6.refusal.formWithoutForm', why: 'DECOR (founder 6b-5; the 4c `kcc_form` precedent): there is no form, so nothing is entered, checked, saved or submitted' },
  { id: 'form_review_checker_6b', canon: 'W2988 "Review before submitting — Maker-checker friendly review step: everything you entered, shown read-only, with the diff against current values" · W2987 "every invalid field is listed with its reason, values you entered are preserved"', surfaces: ['regulatory_form'],
    key: 'partner5.refusal.formReviewChecker', why: 'nothing was entered and no second person checks anything — PARTNER-5b\'s refusal, reused BY KEY' },
  { id: 'no_confirm_page', canon: 'W2990 "Retry — back to confirm" (→ W224) — a form chain has no confirm page (the W2956 / W2963 defect) · PC-56 PARTNER-6c: W2963 "Retry — back to confirm" (→ W271)', surfaces: ['regulatory_form', 'notification_form'],
    key: 'partner6.refusal.noConfirmPage', why: 'canon defect (survey §1I, F-10): the built failure state claims no confirm page and offers only the way back to the triggering page' },

  // ══ PC-56 PARTNER-6c · W270 what the platform sends a partner person (founder 6c-1 / Q5-A: a page that reads nothing, no inbox) ══
  { id: 'same_engine', canon: 'W270 lead "Critical rings, informational waits, promotional asks permission — the same engine farmers get."', surfaces: ['notifications'],
    key: 'partner6.refusal.sameEngine', why: 'FALSE for a partner (survey C-12): the tiers are real on the tenant plane (0012:134), but no catalogue event (core/0007) and no event-map row reaches a partner person; the two messages a partner person gets (the sign-in code, the team invitation) bypass the engine entirely' },
  { id: 'inbox_counters', canon: 'W270 counters "all · unread · critical · digests · failed → fallback"', surfaces: ['notifications'],
    key: 'partner6.refusal.inboxCounters', why: 'FALSE (survey C-4): no partner inbox exists and the tenant inbox refuses a partner token (401, live partner6c (1)); "digests" is refused on the tenant side as well (COMM README :132)' },
  { id: 'inbox_items', canon: 'W270 the six items — a claim intimated (a policyholder, a village, "survey clock started — assign within 48h"), a survey report (a surveyor\'s name, "ready for decision"), a payout completed (a payee and a rupee amount, "confirmed by the ledger"), a consent expiring ("Renewal requests go out from the policies screen"), a failed text message and a grouped summary — each with its event code, channel and status; and their links "Open claim" / "Read report" / "View run" / "Review" / "Open"', surfaces: ['notifications'],
    key: 'partner6.refusal.inboxItems', why: 'WALL + FALSE (survey F-4): never a policyholder, surveyor or payee (2a / 3a / 3b); no claim is paid (6a); no insurance consent (P2-B3); none of those event codes is in the catalogue; the honest page lists nothing, so it draws none of the five item links' },
  { id: 'other_channels', canon: 'W270 item "SMS failed → push fallback sent · Your DND-registered number rejected the parametric-window reminder; the push copy was delivered instead. Fallback, never silence."', surfaces: ['notifications'],
    key: 'partner6.refusal.otherChannels', why: 'FALSE: no parametric product exists (2b); no partner push device exists (`notifications/devices` is tenant, guarded); no do-not-disturb registry lookup is made on a partner\'s phone' },
  { id: 'mark_all_read', canon: 'W270 "Mark all read" (FM:340, `chain-mutate` → W2967–W2969)', surfaces: ['notifications', 'notifications_act'],
    key: 'partner6.refusal.markAllRead', why: 'DECOR — refused by name (founder 6c-5): nothing to read; the tenant `read-all` is keyed and audited but refuses a partner token (live partner6c (1)); `POST /v1/partner/notifications/read-all` 404s (live (2))' },
  { id: 'expand_grouped', canon: 'W270 "Expand 9" (FM:339, a `data-decor` chip) and the grouped item "… batched … suppressed into tomorrow\'s digest per your quiet-hours rule"', surfaces: ['notifications'],
    key: 'partner6.refusal.expandGrouped', why: 'FALSE: the grouping engine is NOT built anywhere (COMM README :132; communication.module.ts:15 "DEFERRED"); nothing is held back for a partner person' },
  { id: 'page_list', canon: 'W270 footer "Showing 6 of 214 (90 days) · Page size [select 25/50/100] · Page 1 of 9" — the page\'s only live control', surfaces: ['notifications'],
    key: 'partner6.refusal.pageList', why: 'FALSE (no list); and a readless page renders NO input and NO `<select>` (the 4c / 5b rule) — pinned by account-notifications.render' },
  { id: 'phone_alerts', canon: 'W270 empty state "… Critical events will always break through regardless of filters." · error state "… Delivery isn\'t affected — critical alerts still reach your phone."', surfaces: ['notifications'],
    key: 'partner6.refusal.phoneAlerts', why: 'FALSE (survey C-12): the only things that reach a partner person\'s phone are the sign-in code and the team invitation — each sent once (live partner6c (3)); "always" is a promise' },
  { id: 'delivery_log_here', canon: 'W270 "Statuses come straight from the delivery log: queued → sent → delivered → read, or failed / suppressed. What you see here is what was actually sent — not what should have been."', surfaces: ['notifications'],
    key: 'partner6.refusal.deliveryLogHere', why: 'TRUE of the tenant engine and of the partner\'s WEBHOOK delivery log (PARTNER-1b), FALSE of this page: the principle survives ONLY as the statement\'s pointer to `/account/webhooks` (founder 6c-1)' },
  { id: 'notifications_no_error', canon: 'W270 error state "Couldn\'t load notifications … Retry." (FM:342 → W2967–W2969)', surfaces: ['notifications', 'notifications_act'],
    key: 'partner6.refusal.notificationsNoError', why: 'the readless page has NO error state (the W217 / 5b rule); Retry re-reads nothing' },
  { id: 'no_org_inbox', canon: 'W270 restricted state "Signed-in staff only — Notifications are per-person, scoped to your own account. There is no org-wide inbox to over-share into."', surfaces: ['notifications'],
    key: 'partner6.refusal.noOrgInbox', why: '"no org-wide inbox" is TRUE by absence (there is no inbox at all); "per-person" is TRUE of the tenant engine only — both said as absences (survey §1D-b)' },

  // ══ PC-56 PARTNER-6c · W271 preferences (founder 6c-2 / Q5-A: no checkbox; 6c-3 / Q7-A: the language act) ══
  { id: 'prefs_matrix', canon: 'W271 the matrix Event · Tier · In-app · Email · SMS — eight event rows and their 24 checkboxes (FM omits all 24)', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.prefsMatrix', why: 'FALSE ×7 (survey F-4): no partner event and no partner preference store; a checkbox that stores nothing is the 4c KCC-form lesson — NO checkbox is rendered (account-notification-prefs.render; mutant M1)' },
  { id: 'duty_lock', canon: 'W271 row note "Cannot be switched off — a farmer is waiting on this. Opt out of noise, never of duty."', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.dutyLock', why: 'FALSE: the insurer decides nothing on a claim (3a); no such message exists for any partner kind' },
  { id: 'security_channels', canon: 'W271 row note "Security events are locked on every channel."', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.securityChannels', why: 'NARROWED to the truth (survey §1E): the sign-in code is sent by SMS (`partner-auth.service.ts:53` → `AuthService.requestOtp(phone, \'sms\')`) and cannot be switched off — no email, no in-app copy' },
  { id: 'event_count', canon: 'W271 "8 of 31 events shown — grouped by what they interrupt · The remaining 23 informational events follow the same tier rules"', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.eventCount', why: 'FALSE: zero partner events exist' },
  { id: 'quiet_window', canon: 'W271 "Quiet hours — 22:00 – 07:00 · informational items wait and join the morning digest (status: suppressed → batched). Critical ignores quiet hours, by design." + "Change window" (FM:345, `chain-form`)', surfaces: ['notification_prefs', 'notification_form'],
    key: 'partner6.refusal.quietWindow', why: 'FALSE for a partner (the tenant default is 21:00–06:00 and a hold is `held_until`, not "batched"); "Change window" is DECOR — refused in the form chain\'s states (founder 6c-5)' },
  { id: 'daily_summary', canon: 'W271 "Daily digest — 07:00 · email · batches every event marked batchable. This morning it folded 9 separate pings into one email." + "Change time" (FM:344, `chain-form`)', surfaces: ['notification_prefs', 'notification_form'],
    key: 'partner6.refusal.dailySummary', why: 'FALSE: the grouping engine is not built anywhere (COMM README :132); "Change time" is DECOR — refused in the form chain\'s states' },
  { id: 'save_prefs', canon: 'W271 "Save preferences" (FM:348, `chain-form` → W2960–W2963)', surfaces: ['notification_prefs', 'notification_form'],
    key: 'partner6.refusal.savePrefs', why: 'DECOR — refused by name (founder 6c-5): nothing to save; the ONE thing this page sets is the console\'s language (a browser cookie)' },
  { id: 'defaults_state', canon: 'W271 state "Defaults active — You haven\'t customised anything yet — these are the platform defaults: critical everywhere, informational in-app only, promotional off."', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.defaultsState', why: 'FALSE for a partner: no defaults exist; nothing is sent but the two SMS' },
  { id: 'prefs_no_error', canon: 'W271 error state "Couldn\'t load preferences — Your saved preferences still apply to deliveries — only this view failed. Retry." (FM:347 → W2964–W2966)', surfaces: ['notification_prefs', 'notification_act'],
    key: 'partner6.refusal.prefsNoError', why: 'FALSE (no saved preferences); the readless page has NO error state and Retry re-reads nothing' },
  { id: 'colleague_reach', canon: 'W271 restricted state "Your preferences only — … Admins can view (not edit) team members\' critical-tier reachability for on-call planning."', surfaces: ['notification_prefs'],
    key: 'partner6.refusal.colleagueReach', why: 'FALSE: no such read exists; a partner admin sees its team through `GET /v1/partner/team` (names + roles, PARTNER-0) and nothing about anyone\'s phone' },
  { id: 'template_parity', canon: 'W271 "Language — English · every template also exists in हिन्दी and ગુજરાતી — switching is one click, not a support ticket." + "Change language" (FM:343, `chain-form`)', surfaces: ['notification_prefs', 'notification_form'],
    key: 'partner6.refusal.templateParity', why: 'PARTIAL (founder 6c-3): every key a wave added is at parity, but older text is English-only (en 2,217 vs hi / gu 1,838 before this wave) and falls back to English; "Change language" IS built — the REAL act' },

  // ══ PC-56 PARTNER-6c · the notification FORM chain (W2960–W2963, REAL for the language act) ══
  { id: 'language_review_checker', canon: 'W2961 "Review before submitting — Maker-checker friendly review step: everything you entered, shown read-only, with the diff against current values"', surfaces: ['notification_form'],
    key: 'partner6.refusal.languageReviewChecker', why: 'the review state names the chosen language in itself, and nobody else checks it: a browser preference of one person' },
  { id: 'language_no_audit', canon: 'W2962 "the audit trail has the entry (actor · time · reason · before/after)" and "View audit trail" — on the language act', surfaces: ['notification_form'],
    key: 'partner6.refusal.languageNoAudit', why: 'founder 6c-3: the act writes no audit row (no API call; a cookie of this browser, no person\'s data); the console has no trail page' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner6RefusalKeys(surface: Partner6Surface): string[] {
  return PARTNER6_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** PC-56 PARTNER-6a (founder 6a-3) — the old `/settlements` (a not-yet `common` nav item every partner kind saw) → the insurer's own page, a
 *  real 307 from next.config.js (pinned equal by test-render/not-yet.render.test.tsx). `insurerGate()` there sends a lender or any other kind
 *  to `/dashboard` — its own home — because no partner but an insurer has a claim on this platform. */
export const SETTLEMENTS_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/settlements': '/insurer/settlements',
});
/** PC-56 PARTNER-6b (founder 6b-4) — the old `/consents` (a not-yet `common` nav item every partner kind saw) → the lender's own honest page,
 *  a real 307 from next.config.js (pinned equal by test-render/not-yet.render.test.tsx). `lenderGate()` there sends an insurer to its own
 *  dashboard (there is no insurance consent on this platform — P2-B3). */
export const CONSENTS_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/consents': '/lender/consents',
});
/** PC-56 PARTNER-6c (founder 6c-4) — the old `/notifications` pair (not-yet pages in the `common` nav group every partner kind saw) → every
 *  partner person's own account pages, real 307s from next.config.js (pinned equal by test-render/not-yet.render.test.tsx). No gate: any
 *  partner kind may open both. */
export const NOTIFICATIONS_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/notifications': '/account/notifications',
  '/notifications/preferences': '/account/notifications/preferences',
});

/** The canon shapes PARTNER-6a builds differently — recorded DELTAs, not refusals (survey F-10 / F-11). */
export const PARTNER6_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'w252_links_nothing', canon: 'W260\'s crumb "… › Insurance › Claims › Settlements" — but W252 (Claims) links to nothing here; W260 / W261 are reachable only from W270 and from W253\'s "View settlement" (refused in 3a) (survey F-10)',
    built: 'the inbound edge the canon never drew: a Settlements row LAST in the claims sub-navigation (`CLAIMS_SUBNAV`), for an insurer only; no sidebar item for any kind' },
  { id: 'common_nav_removed', canon: 'the built chrome — `/settlements` a `common` nav item (live, every partner kind) that rendered "not yet available" (survey C-6, F-6)',
    built: '`/settlements` is in NO nav group; the address answers a real 307 to `/insurer/settlements`, and `insurerGate()` sends a lender or any other kind to its own home' },
  { id: 'not_yet_back', canon: 'the built not-yet pages\' "Go to the loan queue" — an insurer opening `/notifications` or `/consents` sent to a lender page (survey C-7)',
    built: 'every remaining not-yet page goes back to `/dashboard` ("Go to your dashboard"), which sends an insurer on to its own dashboard: kind-aware without a read' },
  { id: 'fm_omits_clm_anchor', canon: 'W260\'s real anchor "CLM-…" → W261 — FM omits it (survey F-11)',
    built: 'no claim row is drawn on W260 (the claims are on 3a\'s queue); the status counts link to the queue filtered by that status; W261 links to the claim\'s own page `/insurer/claims/[id]`' },
  { id: 'fm_avatar_pm', canon: 'FM:283 (W260) and FM:289 (W261) — the two-letter avatar "PM" `<span>` classed `filter`',
    built: 'no avatar is drawn; the platform\'s mark and the insurer\'s own name only' },
  { id: 'fm_dead_buttons', canon: 'FM:286 "View claims" and FM:287 "Back to settlements" — dead `<button … data-decor>` FM registers as `nav-detail`; FM:288 "Claim file (complete, hash-sealed)" a dead button classed `nav-detail`',
    built: '"View claims" a REAL link to `/insurer/claims` (W260); "Back to settlements" a REAL link to `/insurer/settlements` (W261); "Claim file" refused by name (`claim_file`) and not drawn' },
  { id: 'fm_chain_ids_6a', canon: 'FM names the settlement chains W1448–W1450 ("settlements-mutate") and W1451–W1453 ("settlement-mutate") — ids that exist nowhere (survey F-11)',
    built: 'the canon has ONE chain: W2901–W2903, recorded once on `/insurer/settlements` (`settlement_act`); `/insurer/settlements/[id]` carries the same chain with `files: []` (`settlement_detail_act`)' },
  { id: 'fm_entity_rsquo', canon: 'FM:284 "Release today&rsquo;s run" — the HTML entity left encoded',
    built: 'the canon label is never drawn; the control reads "Why no payment is released here" and opens the DECOR chain' },
  { id: 'id_is_claim', canon: 'W261 route `insurer/settlements/[id]` — the `[id]` a settlement id (crumb "… › Settlements › CLM-…")',
    built: 'the `[id]` is a CLAIM id (no settlement entity exists, survey C-3; the W217 / W220 precedent) and is used ONLY, encoded, in the link to `/insurer/claims/[id]`; it is never printed as text' },
  { id: 'every_id_same_page', canon: 'W261 state "Settlement not found — Paid settlements keep their full chain (7 years)." + "Back to settlements"',
    built: 'the page LOOKS NOTHING UP, so every id — known, foreign, unknown or malformed — prints the SAME page: no not-found, no existence oracle (founder 6a-2, the 5b-3 rule); the claim link then answers 3a\'s own not-found' },
  { id: 'chain_back_w260', canon: 'W2901–W2903 Cancel / Back → W260 even when opened from W261 ("Retry") (survey §1F, F-10)',
    built: '`settlement_act` on `/insurer/settlements` returns there; `settlement_detail_act` (`files: []`) on a claim\'s settlement page returns to THAT page, never to W260' },
  { id: 'detail_retry_no_trigger', canon: 'W261 "Retry" (FM:290 → W2901–W2903) — inside its error state',
    built: 'the readless page has no error state; `settlement_detail_act` is reachable only as a query state and no control on the page leads to it (the 5b `case_act` precedent)' },
  { id: 'counts_filed_window', canon: 'W260 "2 claims approved this morning" — a count read as approved IN a period',
    built: 'the counts definer windows on the claim\'s FILING day (0230:158-159, survey F-8): the page prints "the claims filed in this window that are approved now — not the claims approved in it", with the window label the database answered' },
  { id: 'split_personas', canon: 'the slice draws BOTH consoles: the lender persona on W213 / W224 and their chains, the insurer persona on W260 / W261 / W270 / W271 and theirs (survey F-10)',
    built: '6a builds the insurer\'s two pages only (`insurerGate()`); the lender\'s pages are 6b\'s, every partner person\'s account pages 6c\'s' },
  { id: 'chain_route', canon: 'the chain pages W2901–W2903 as separate files',
    built: 'query states of their parent pages: `?act=confirm|success|failure` on `/insurer/settlements` and on `/insurer/settlements/[id]`; Back returns to the triggering page' },
  // ── PC-56 PARTNER-6b ──
  { id: 'route_consents', canon: 'W213 route `lender/consents` — the built `/consents` was a `common` nav item (live, EVERY partner kind) rendering "not yet available" (survey C-5 / C-6)',
    built: 'built at the canon\'s own address `/lender/consents`; `/consents` answers a real 307 there (`CONSENTS_REDIRECTS`) and its page file is deleted' },
  { id: 'consents_nav_lender', canon: 'the canon gives Consents to the LENDER sidebar only (its Trust section: Consents · SLA & reports); the insurer sidebar has none',
    built: 'ONE `lending` group item between Portfolio and "SLA & reports" (the canon\'s order); an insurer, an asset manager, a 3PL and a person with no reads see no Consents at all (there is no insurance consent — P2-B3)' },
  { id: 'fm_named_rows_filter', canon: 'FM:120-121 — two farmers\' names (never copied) classed `filter` — they are `<td>` text, not clickable; FM omits the table\'s first row',
    built: 'no row is drawn (WALL); the refusal `consent_registry_rows` names the table without a person' },
  { id: 'fm_regulatory_td', canon: 'FM:178 "DPD / asset-quality schedule" classed `filter`, FM:183 "Weaker-section & women-borrower split" classed `nav-detail` — both `<td>` text; FM omits the first row "PSL classification schedule"',
    built: 'no extract row is drawn; the refusal `extracts_table` names the table without its fragments' },
  { id: 'fm_avatar_aj', canon: 'FM:118 (W213) and FM:177 (W224) — the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn' },
  { id: 'fm_static_footers_6b', canon: 'FM:115-117 W213 pagination "1" "2" and the bulkbar "… highlighted of … active consents"; FM:176 W224 "… highlighted of … extracts · same signed-manife…" (truncated)',
    built: 'nothing is listed, so nothing is paged or highlighted; the footer claims are refused by name (`status_chips`, `extracts_table`)' },
  { id: 'fm_dead_buttons_6b', canon: 'FM:123 "View queue" (W213) and FM:182 "View portfolio" (W224) — dead `<button … data-decor>` FM registers as `nav-detail`',
    built: 'REAL links: `/lender/queue` on the consents page; `/lender/portfolio` and `/lender/portfolio/aging` on the regulatory page' },
  { id: 'w214_links_nothing', canon: 'W224\'s crumb "… › Trust › SLA & reports › Regulatory" — but W214 links to nothing here; W224 is reachable only from its own seven chain pages (survey F-10: a total orphan)',
    built: 'the inbound edge the canon never drew: a REAL "Regulatory" link on `/lender/reports` (W214), and a real way back from W224 to it' },
  { id: 'regulatory_form_back_to_edit', canon: 'W2988 "Back to edit" → W224 (never W2987 — the W2915 / W2983 defect pair again)',
    built: 'every form state\'s ONE link is Back to the triggering page (`/lender/reports/regulatory`); no state claims an edit step' },
  { id: 'regulatory_form_retry_confirm', canon: 'W2990 "Retry — back to confirm" → W224 — a FORM chain has no confirm page (the W2917 / W2956 defect)',
    built: 'the failure state claims no confirm page (`no_confirm_page`) and offers only Back' },
  { id: 'fm_chain_ids_6b', canon: 'FM names W1353–W1354 (consents export), W1355–W1357 (consents mutate), W1397–W1400 (regulatory form), W1401–W1403 (regulatory mutate) — ids that exist nowhere (survey F-11)',
    built: 'the canon\'s files: W2921–W2922, W2923–W2925, W2987–W2990, W2991–W2993 — each recorded ONCE on the page its trigger lives on' },
  { id: 'mutate_no_trigger_6b', canon: 'W213 "Retry" (FM:122 → W2923–W2925) and W224 "Retry" (FM:181 → W2991–W2993) — each inside its page\'s error state',
    built: 'the two honest pages read nothing and have NO error state; `consents_act` and `regulatory_act` are reachable only as query states and no control leads to them (the 5b `case_act` precedent)' },
  { id: 'chain_route_6b', canon: 'the chain pages W2921–W2925 and W2987–W2993 as separate files',
    built: 'query states of their parent pages: `?export=queued|ready` and `?act=` on `/lender/consents`; `?form=error|review|success|failure` and `?act=` on `/lender/reports/regulatory`; Back returns to the triggering page' },
  // ── PC-56 PARTNER-6c ──
  { id: 'route_notifications', canon: 'W270 / W271 routes `account/notifications` and `account/notifications/preferences` — the built `/notifications` pair was a `common` nav item (live, EVERY partner kind) rendering "not yet available" (survey C-5 / C-6)',
    built: 'built at the canon\'s own addresses; `/notifications` and `/notifications/preferences` answer real 307s there (`NOTIFICATIONS_REDIRECTS`); the old page files AND the dead `app/notifications/actions.ts` (a mark-read / matrix / quiet-hours / consent action set with no importer, found by 6b) are deleted' },
  { id: 'notifications_nav_account', canon: 'the canon gives Notifications to the INSURER\'s Account section only (Notifications · Help); W270 / W271 are every partner person\'s pages, drawn for one persona (survey F-10)',
    built: 'ONE `account` group item, FIRST (the canon\'s order), for EVERY partner kind; the `common` group is then empty and is DELETED with its `visibleGroups` branch' },
  { id: 'fm_tabs_omitted', canon: 'W270 / W271 tabs "Inbox" · "Preferences" — real `<a>`s FM omits; W270\'s five item links and its "Page size" `<select>` — FM omits them too (survey F-11)',
    built: 'a real link from Notifications to Preferences and back; no item is drawn, so no item link; no `<select>`' },
  { id: 'fm_avatar_pm_6c', canon: 'FM:341 (W270) and FM:346 (W271) — the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn' },
  { id: 'fm_chain_ids_6c', canon: 'FM names W1490–W1492 (notifications mutate), W1493–W1496 (notification form) and W1497–W1499 (notification mutate) — ids that exist nowhere (survey F-11)',
    built: 'the canon\'s files: W2967–W2969, W2960–W2963, W2964–W2966 — each recorded ONCE on the page its trigger lives on' },
  { id: 'notification_form_back_to_edit', canon: 'W2961 "Back to edit" → W271 (skips W2960) and W2963 "Retry — back to confirm" → W271 (a form chain has no confirm page)',
    built: 'every form state\'s way back is the preferences page; the failure state claims no confirm page (`no_confirm_page`)' },
  { id: 'form_entry_review', canon: 'W271\'s "Change language" opens W2960–W2963 with no form drawn on any of the four pages',
    built: 'the form IS the page\'s radio group (the package\'s live languages) and ONE submit, which opens `?form=review&lang=<code>`; the review state names the chosen language in itself and its ONE button posts it to the Server Action; an unknown code in the URL prints the error state and sets nothing' },
  { id: 'mutate_no_trigger_6c', canon: 'W270 "Retry" (FM:342 → W2967–W2969) and W271 "Retry" (FM:347 → W2964–W2966) — each inside its page\'s error state',
    built: 'the two honest pages read nothing and have NO error state; `notification_act` is reachable only as a query state; `notifications_act` is reached from the refused "Mark all read" control' },
  { id: 'chain_route_6c', canon: 'the chain pages W2960–W2969 as separate files',
    built: 'query states of their parent pages: `?form=error|review|success|failure` and `?act=` on `/account/notifications/preferences`; `?act=` on `/account/notifications`; Back returns to the triggering page' },
  { id: 'viewer_name_omitted', canon: 'W271 "Per event, per channel — saved for you alone (<a person\'s name>), not your whole organisation."',
    built: 'no name is printed — the page makes no read at all (not even `/me`; the 5b honest-page precedent); the canon\'s person is never copied' },
]);

/** The verdict values (the 4c-7 rule: no pending value survives its wave — PARTNER-6b deleted `pending_6b`, PARTNER-6c `pending_6c`). */
export type Partner6Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR';
/** Every canon file of PARTNER-6 (31), each with ONE verdict: 6a decided its 5, 6b its 14, 6c its 12 — PARTNER-6 is closed. */
export const PARTNER6_CANON_FILES: readonly { file: string; wave: '6a' | '6b' | '6c'; verdict: Partner6Verdict; note: string }[] = Object.freeze([
  // ── 6a · WHERE A CLAIM IS NOT PAID (5) — decided by 6a (founder 6a-1 … 6a-3) ──
  { file: 'W260-partner-settlements.html', wave: '6a', verdict: 'BUILT (read)', note: '/insurer/settlements (a CLAIMS SUB-NAVIGATION row, insurer only) over PARTNER-3a\'s GET /v1/partner/insurance/claims/counts — ONE audit row per read, counts only: of the claims on the insurer\'s products FILED in the IST window, how many are approved and partially approved ("awaiting a settlement this platform does not make", each linked to the queue filtered by that status) and paid — 0 — beside "No claim is paid on this platform." No rupee total, no claimant, no account, no run, no rail' },
  { file: 'W261-partner-settlement-detail.html', wave: '6a', verdict: 'BUILT (honest)', note: '/insurer/settlements/[id] — an HONEST PAGE THAT READS NOTHING; the `[id]` is a CLAIM id and EVERY id prints the same page (no not-found, no existence oracle, no error state); "No settlement exists for any claim on this platform. This claim\'s own facts are on its claim page." + a real link to /insurer/claims/[id]' },
  { file: 'W2901-partner-settlement-mutate-confirm.html', wave: '6a', verdict: 'DECOR', note: '/insurer/settlements?act=confirm — "Release today\'s run" is a refused act (no claim is paid on the platform): nothing to confirm. The same state opens on a claim\'s settlement page (`settlement_detail_act`) and returns THERE' },
  { file: 'W2902-partner-settlement-mutate-success.html', wave: '6a', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded; the canon\'s "reconcile zero-sum" sentence is refused BY NAME (`zero_sum`)' },
  { file: 'W2903-partner-settlement-mutate-failure.html', wave: '6a', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; going back to W260 reads the counts again (a genuine re-read), and the chain stays DECOR because its own trigger is the refused act' },
  // ── 6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE (14) — decided by 6b (founder 6b-1 … 6b-5) ──
  { file: 'W213-partner-consents.html', wave: '6b', verdict: 'BUILT (honest)', note: '/lender/consents (a LENDING sidebar item between Portfolio and "SLA & reports"; `/consents` answers 307 here) — AN HONEST PAGE THAT READS NOTHING (Q3-A): a consent is given for one application, the platform checks it on every read and access ends when it expires; the lender never sees who consented, when, how or what it covers; no consent is recorded yet because the step that asks the farmer does not exist. No registry, no person, no phone, no reference, no channel, no scope, no count; never "revocable" (Q4-A). No error state, no audit row' },
  { file: 'W2921-partner-consents-export-queued.html', wave: '6b', verdict: 'DECOR', note: '/lender/consents?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox; a registry of farmers\' consents would be a file of named people in any case' },
  { file: 'W2922-partner-consents-export-ready.html', wave: '6b', verdict: 'DECOR', note: '?export=ready — no file, no row count, no checksum, no signed link' },
  { file: 'W2923-partner-consents-mutate-confirm.html', wave: '6b', verdict: 'DECOR', note: '/lender/consents?act=confirm — the only trigger is Retry inside an error state the readless page does not have; nothing is read, so nothing is re-read (DELTA `mutate_no_trigger_6b`)' },
  { file: 'W2924-partner-consents-mutate-success.html', wave: '6b', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded; the zero-sum and audit-trail sentences refused BY NAME' },
  { file: 'W2925-partner-consents-mutate-failure.html', wave: '6b', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; nobody is paged' },
  { file: 'W224-partner-regulatory.html', wave: '6b', verdict: 'BUILT (honest)', note: '/lender/reports/regulatory (a REAL link from W214 `/lender/reports` — the inbound edge the canon never drew) — AN HONEST PAGE THAT READS NOTHING (Q6-A): the platform produces no regulatory extract and classifies nothing for a regulator, never gives the organisation a borrower\'s gender or landholding, and never files for it; the book\'s own figures are on Portfolio and DPD aging (real links); the partners mailbox for data a filing of its own needs. No figure, no percentage, no extract, no hash; no error state, no audit row' },
  { file: 'W2987-partner-regulatory-form-form-error.html', wave: '6b', verdict: 'DECOR', note: '/lender/reports/regulatory?form=error — the 4c `kcc_form` shape: ONE four-state entry, files listed once, with the mailbox line; there is no form and no field, so nothing to correct' },
  { file: 'W2988-partner-regulatory-form-review.html', wave: '6b', verdict: 'DECOR', note: '?form=review — nothing was entered, so nothing is shown back and nobody checks it; the canon\'s "Back to edit" → W224 is a DELTA' },
  { file: 'W2989-partner-regulatory-form-success.html', wave: '6b', verdict: 'DECOR', note: '?form=success — no pack was generated and nothing was recorded; the canon\'s body is the mutate chain\'s (zero-sum, audit trail) — refused' },
  { file: 'W2990-partner-regulatory-form-failure.html', wave: '6b', verdict: 'DECOR', note: '?form=failure — nothing was attempted; the canon\'s "Retry — back to confirm" names a page a form chain does not have (DELTA) — the built state claims no confirm page' },
  { file: 'W2991-partner-regulatory-mutate-confirm.html', wave: '6b', verdict: 'DECOR', note: '/lender/reports/regulatory?act=confirm — Retry on a page that reads nothing re-reads nothing; no control leads here' },
  { file: 'W2992-partner-regulatory-mutate-success.html', wave: '6b', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded' },
  { file: 'W2993-partner-regulatory-mutate-failure.html', wave: '6b', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed' },
  // ── 6c · WHAT THE PLATFORM TELLS A PARTNER PERSON (12) — decided by 6c (founder 6c-1 … 6c-5) ──
  { file: 'W270-partner-notifications.html', wave: '6c', verdict: 'BUILT (honest)', note: '/account/notifications (FIRST in the Account group, every partner kind; `/notifications` answers 307 here) — AN HONEST PAGE THAT READS NOTHING (Q5-A): the platform sends a partner person two kinds of message, by SMS — a sign-in code and a team invitation — and nothing else in this console; the organisation\'s machine notifications are its webhooks, with a REAL link to their delivery log (`/account/webhooks`). No inbox, no item, no counter, no person, no place, no event code, no `<select>`, no error state, no audit row' },
  { file: 'W271-partner-notification-preferences.html', wave: '6c', verdict: 'BUILT (honest)', note: '/account/notifications/preferences (`/notifications/preferences` answers 307 here) — AN HONEST PAGE WITH NO CHECKBOX (Q5-A): the sign-in code and the team invitation cannot be switched off and nothing else is sent, so there is nothing else to set; PLUS the one REAL act of PARTNER-6 (Q7-A): the console\'s language — a radio group of `@krishalaya/i18n`\'s live languages, each in its own script, and one submit; the English-fallback note. No read, no error state' },
  { file: 'W2960-partner-notification-form-form-error.html', wave: '6c', verdict: 'REAL', note: '?form=error — the language act: an unknown, empty or injected code (in the review URL or posted to the Server Action) sets NOTHING; the three other canon triggers (Change time, Change window, Save preferences) print their refusals in this state' },
  { file: 'W2961-partner-notification-form-review.html', wave: '6c', verdict: 'REAL', note: '?form=review&lang=<code> — the chosen language named in itself before anything is set, and ONE button that posts it to the Server Action; no second person checks it; the canon\'s "Back to edit" → W271 is a DELTA (Back is the page)' },
  { file: 'W2962-partner-notification-form-success.html', wave: '6c', verdict: 'REAL', note: '?form=success — the `kv_lang` cookie IS set (path `/`, SameSite=Lax, one year) and the page re-renders in the chosen language, which it names; no audit row (a browser preference — `language_no_audit`)' },
  { file: 'W2963-partner-notification-form-failure.html', wave: '6c', verdict: 'REAL', note: '?form=failure — the cookie could not be set, so nothing changed; no confirm page is claimed (`no_confirm_page`)' },
  { file: 'W2964-partner-notification-mutate-confirm.html', wave: '6c', verdict: 'DECOR', note: '/account/notifications/preferences?act=confirm — Retry on a page that reads nothing re-reads nothing; no control leads here (DELTA `mutate_no_trigger_6c`)' },
  { file: 'W2965-partner-notification-mutate-success.html', wave: '6c', verdict: 'DECOR', note: '?act=success — nothing happened, so nothing succeeded; the zero-sum and audit-trail sentences refused BY NAME' },
  { file: 'W2966-partner-notification-mutate-failure.html', wave: '6c', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; nobody is paged' },
  { file: 'W2967-partner-notifications-mutate-confirm.html', wave: '6c', verdict: 'DECOR', note: '/account/notifications?act=confirm — "Mark all read" is refused by name: there is nothing to read' },
  { file: 'W2968-partner-notifications-mutate-success.html', wave: '6c', verdict: 'DECOR', note: '?act=success — nothing was marked, so nothing succeeded' },
  { file: 'W2969-partner-notifications-mutate-failure.html', wave: '6c', verdict: 'DECOR', note: '?act=failure — nothing was attempted and nothing changed; nobody is paged' },
]);

// ── THE DECOR CHAINS: each is a query state of its parent page ──
export type Chain6Id = 'settlement_act' | 'settlement_detail_act' | 'consents_export' | 'consents_act' | 'regulatory_form' | 'regulatory_act'
  | 'notification_form' | 'notification_act' | 'notifications_act';
export interface Chain6Def {
  id: Chain6Id; wave: '6a' | '6b' | '6c'; param: string; page: string; surface: Partner6Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[];
  /** The chain of an honest / counts page prints that page's founder-approved statement first (the 4c / 5b precedent). */
  statement: string;
  /** PC-56 PARTNER-6b: an export / form chain prints a sentence + the partners mailbox FACT (founder 6b-5, 2b-1). */
  mailbox?: boolean;
  /** The chain's own sentence above the mailbox FACT (the 4c `kcc_form` precedent); without one, `partner4.export.notAvailable`. */
  mailboxKey?: string;
  /** PC-56 PARTNER-6c: the chain whose lead act is REAL — `language`, the console's language (founder 6c-3 / 6c-5). Absent = DECOR. */
  real?: 'language';
}
export const PARTNER6_CHAINS: readonly Chain6Def[] = Object.freeze([
  // ONE canon chain (W2901–W2903), opened from BOTH pages. Files are listed ONCE, on the page the canon's trigger ("Release today's run") lives
  // on; each state's Back is the TRIGGERING page (W261 → W261, never the canon's W260 — DELTA `chain_back_w260`). DECOR on both: the lead act
  // is the refused settlement, so W260's re-read of the counts (on going back) does not make the chain PARITY-DECOR.
  { id: 'settlement_act', wave: '6a', param: 'act', page: '/insurer/settlements', surface: 'settlement_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.settlementAct.${s}`, files: ['W2901', 'W2902', 'W2903'], statement: 'partner6.settlements.statement' },
  { id: 'settlement_detail_act', wave: '6a', param: 'act', page: '/insurer/settlements/[id]', surface: 'settlement_detail_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.settlementDetailAct.${s}`, files: [], statement: 'partner6.settlement.statement' },
  // PC-56 PARTNER-6b (founder 6b-5) · the four chains of the lender's two honest pages, ALL DECOR. Each prints its page's statement first and
  // returns to its page. The consents EXPORT chain and the regulatory FORM chain print the mailbox line; the form chain is the 4c `kcc_form`
  // shape (one entry, four states, no input) and no state claims a confirm page.
  { id: 'consents_export', wave: '6b', mailbox: true, param: 'export', page: '/lender/consents', surface: 'consents_export', states: ['queued', 'ready'],
    key: (s: string) => `partner6.chain.consentsExport.${s}`, files: ['W2921', 'W2922'], statement: 'partner6.consents.statement' },
  { id: 'consents_act', wave: '6b', param: 'act', page: '/lender/consents', surface: 'consents_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.consentsAct.${s}`, files: ['W2923', 'W2924', 'W2925'], statement: 'partner6.consents.statement' },
  { id: 'regulatory_form', wave: '6b', mailbox: true, mailboxKey: 'partner6.regulatory.mailboxAsk', param: 'form', page: '/lender/reports/regulatory', surface: 'regulatory_form',
    states: ['error', 'review', 'success', 'failure'], key: (s: string) => `partner6.chain.regulatoryForm.${s}`, files: ['W2987', 'W2988', 'W2989', 'W2990'],
    statement: 'partner6.regulatory.statement' },
  { id: 'regulatory_act', wave: '6b', param: 'act', page: '/lender/reports/regulatory', surface: 'regulatory_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.regulatoryAct.${s}`, files: ['W2991', 'W2992', 'W2993'], statement: 'partner6.regulatory.statement' },
  // PC-56 PARTNER-6c (founder 6c-5) · the three chains of every partner person's two account pages. The notification FORM chain is REAL (the
  // language act; no confirm state); the two mutate chains are DECOR. Each prints its page's statement first and returns to its page.
  { id: 'notification_form', wave: '6c', real: 'language', param: 'form', page: '/account/notifications/preferences', surface: 'notification_form',
    states: ['error', 'review', 'success', 'failure'], key: (s: string) => `partner6.chain.notificationForm.${s}`, files: ['W2960', 'W2961', 'W2962', 'W2963'],
    statement: 'partner6.notificationPrefs.statement' },
  { id: 'notification_act', wave: '6c', param: 'act', page: '/account/notifications/preferences', surface: 'notification_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.notificationAct.${s}`, files: ['W2964', 'W2965', 'W2966'], statement: 'partner6.notificationPrefs.statement' },
  { id: 'notifications_act', wave: '6c', param: 'act', page: '/account/notifications', surface: 'notifications_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner6.chain.notificationsAct.${s}`, files: ['W2967', 'W2968', 'W2969'], statement: 'partner6.notifications.statement' },
]);
export function chain6ById(id: Chain6Id): Chain6Def { return PARTNER6_CHAINS.find((c) => c.id === id) as Chain6Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain6State(id: Chain6Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain6ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
