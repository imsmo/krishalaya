// apps/web-partner/src/features/partner3/refusals.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — FACTS, NEVER A CLAIMANT (survey E2) —
// WHAT THE CLAIMS CONSOLE DOES NOT CLAIM, BY NAME. PURE. The shape of features/partner2/refusals.ts: each refused canon claim is listed ONCE with
// where the canon makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the
// claims guard (test/claims-guard.spec.ts, the `partner3.` scope) keeps the canon's false words out of every value. The sentences word the
// refused claims generically: no canon person, place, institution, phone, claim number or figure appears in any value.
//
// THE SURFACES `Partner3Surface`: `claims` (W252) · `claim` (W253) · `claims_insights` (W264) — built in 3a; `evidence` (W255) ·
// `evidence_board` (W256) · `surveyors` (W257) · `surveys` (W258) · `survey_report` (W259) · `fraud` (W263) — PARTNER-3b's honest pages, whose
// refusals are registered now (the founder's doors Q4 / Q5 / Q6 are answered); the chain surfaces `claims_act` / `claim_act` / `insights_act`
// (the claim mutate chain W2857–W2859, PARITY-DECOR: Retry is a re-read; "Take next" is DECOR) and `insights_export` (the claim export chain
// W2855–W2856, DECOR: no partner export plane — the mailbox line).
export type Partner3Surface =
  | 'claims' | 'claim' | 'claims_insights'
  | 'evidence' | 'evidence_board' | 'surveyors' | 'surveys' | 'survey_report' | 'fraud'
  | 'claims_act' | 'claim_act' | 'insights_act' | 'insights_export';
export interface Partner3Refusal { id: string; canon: string; surfaces: readonly Partner3Surface[]; key: string; why: string }

const ACT: readonly Partner3Surface[] = ['claims_act', 'claim_act', 'insights_act'];
const BUILT: readonly Partner3Surface[] = ['claims', 'claim', 'claims_insights'];

export const PARTNER3_REFUSALS: readonly Partner3Refusal[] = Object.freeze([
  // ── W252 · the claims queue ──
  { id: 'paying_chip', canon: 'W252 status chip "approved · paying" (FM:237 — classed chain-mutate, linked to W2857)', surfaces: ['claims', 'claims_insights'],
    key: 'partner3.refusal.payingChip', why: 'founder Q1: claim settlement is refused from the tenant realm by name — an approved claim stays approved; nobody pays it (survey F-1)' },
  { id: 'payout_batch', canon: 'W252 "approved 10:20 · 16:00 run" · W253 "in 16:00 settlement run"', surfaces: ['claims', 'claim'],
    key: 'partner3.refusal.payoutBatch', why: 'no payout run exists for claims (survey §1 rupee 1–3); founder Q1' },
  { id: 'named_holders', canon: 'W252 rows "… Kesar Ben V." · "3 holders, same village" · W253 header "Cattle death — <claimant>"', surfaces: ['claims', 'claim'],
    key: 'partner3.refusal.namedHolders', why: 'founder Q4: claim facts only — never a claimant, a village or a group of holders (survey F-5)' },
  { id: 'hour_counts', canon: 'W252 "✓ 14h" / "✗ 91h" · W253 "intimated within 14h"', surfaces: ['claims', 'claim'],
    key: 'partner3.refusal.hourCounts', why: 'no hour count is stored: `intimated_within_72h` is a boolean computed once at filing (insurance-claim.entity.ts:35-38)' },
  { id: 'late_review', canon: 'W252 "late, NOT auto-rejected: cause reviewed first"', surfaces: ['claims', 'claim'],
    key: 'partner3.refusal.lateReview', why: 'TRUE by absence that nothing reads the flag (survey §1 reference data); no cause review is recorded anywhere' },
  { id: 'response_timers', canon: 'W252 error "SLA clocks and survey schedules are server-side" · W253 "The decision clock is server-side; her claim is safe"', surfaces: BUILT,
    key: 'partner3.refusal.responseTimers', why: 'no claim response timer exists on the platform' },
  { id: 'claims_roles', canon: 'W252 / W253 / W264 restricted states "Claims role" · "Claims lead + actuarial roles; loss-ratio detail adds finance scope"', surfaces: BUILT,
    key: 'partner3.refusal.claimsRoles', why: 'the partner realm has four roles (0225), all of which read claims (0230 `partner.claims.read`)' },
  { id: 'two_person_rule', canon: 'W252 / W253 "decisions above ₹1,00,000 add a second approver" · "R. Shah + 2nd approver M. Iyer (≥₹1L rule)"', surfaces: ['claims', 'claim'],
    key: 'partner3.refusal.twoPersonRule', why: 'founder Q3: no decision is made from the console; the desk\'s `decide` is one actor (the maker-checker is P3-B5, a money wave)' },
  { id: 'weather_absorbs', canon: 'W252 empty state "A quiet claims queue in monsoon season is earned, not lucky — parametric covers absorb the weather"', surfaces: ['claims'],
    key: 'partner3.refusal.weatherAbsorbs', why: 'founder 2b Q3: a parametric product is a label; nothing is armed or paid' },
  { id: 'take_next', canon: 'W252 "Take next" (FM:235) → the claim mutate chain', surfaces: ['claims', 'claims_act'],
    key: 'partner3.refusal.takeNext', why: 'no assignment or lock model exists for claims (survey §1A); nothing to take' },
  { id: 'plan_settings', canon: 'W252–W264 flagged-off state "See plan settings"', surfaces: BUILT,
    key: 'partner3.refusal.planSettings', why: 'no plan settings page exists in the partner console (the 2a precedent)' },
  // ── W253 · one claim ──
  { id: 'claimant_contact', canon: 'W253 "claimant +91 94••• ••229" · "(one voice call, gu)"', surfaces: ['claim'],
    key: 'partner3.refusal.claimantContact', why: 'founder Q4: never a phone; no calling channel exists' },
  { id: 'survey_block', canon: 'W253 survey block "Ear-tag ••2764 verified on-site" · cause "vet post-mortem" · "Health file coherent: vaccinated" · "Surveyor: Dr. A. Rathod"', surfaces: ['claim'],
    key: 'partner3.refusal.surveyBlock', why: 'founder Q4: the damage percentage is the ONE survey figure an insurer sees; never the notes, an animal or health record, or the surveyor' },
  { id: 'claim_timeline', canon: 'W253 timeline (four steps with a named surveyor, "purchase invoice pulled from platform", "voice call, Gujarati")', surfaces: ['claim'],
    key: 'partner3.refusal.claimTimeline', why: 'survey E5: per-step times live only in audit_log (FORCE RLS; the production owner\'s BYPASSRLS unconfirmed) — filed / last changed / closed are printed' },
  { id: 'decision_pays', canon: 'W253 Decide "Full approval pays ₹1,10,000 to her verified account via platform rails — she gets the money … the same hour"', surfaces: ['claim', 'claim_act'],
    key: 'partner3.refusal.decisionPays', why: 'founder Q1: no money moves from a claim decision (settlement refused by name)' },
  { id: 'payout_link', canon: 'W253 "payout_id links claim → money, always" · "View settlement" → W261', surfaces: ['claim'],
    key: 'partner3.refusal.payoutLink', why: '`payout_id` is NULL by design (insurance-claim.service history; entity :114-118); no settlement exists for a claim' },
  { id: 'pay_rate', canon: 'W253 "94% of surveyed claims pay" · W263 "94% of claims pay BECAUSE the 6% … are caught"', surfaces: ['claim', 'claims_insights', 'fraud'],
    key: 'partner3.refusal.payRate', why: 'a fabricated figure; founder E10: counts, never a rate' },
  { id: 'contest_route', canon: 'W253 "If rejecting (rare, reasoned) — clause + evidence + appeal path"', surfaces: ['claim', 'claims_insights'],
    key: 'partner3.refusal.contestRoute', why: 'no appeal status in the claim state machine (insurance-claim.state.ts :21-24); `note` is free text, no clause mapping (P3-B9)' },
  { id: 'claimant_told', canon: 'W253 "What she\'s been told, throughout" + a Gujarati message · "Every state change reached her"', surfaces: ['claim'],
    key: 'partner3.refusal.claimantTold', why: 'no consumer of `insurance.claim_*` notifies the claimant (survey F-9, P3-B8); founder Q4: never a message' },
  { id: 'record_kept', canon: 'W253 "Closed claims keep their full survey + decision record (7 years)"', surfaces: ['claim'],
    key: 'partner3.refusal.recordKept', why: 'founder Q8 (P2-Q8): no retention promise is printed until a policy is set' },
  { id: 'claim_media', canon: 'W253 "photos + report attached" · W255 media counts "3 photos · 1 video (0:42)" · W256 the media board', surfaces: ['claim', 'evidence', 'evidence_board'],
    key: 'partner3.refusal.claimMedia', why: 'founder Q4: no media reaches an insurer — not even a count in 3a; only the uploader can fetch a claim\'s media (media.repository.ts:63-66)' },
  // ── W264 · claims insights ──
  { id: 'claims_to_premium', canon: 'W264 KPI "Loss ratio (FY, non-parametric) 61% · ₹41.8L paid / ₹68.4L earned premium — healthy for agri"', surfaces: ['claims_insights'],
    key: 'partner3.refusal.claimsToPremium', why: 'founder Q1 (2a/2b): no insurer paid any claim; premiums sit in the platform\'s escrow — the platform\'s money is not the insurer\'s loss' },
  { id: 'event_to_payment', canon: 'W264 KPI "Median event → paid 9 days · industry agri median ~30 — the gap IS the pitch"', surfaces: ['claims_insights'],
    key: 'partner3.refusal.eventToPayment', why: 'nothing is paid by an insurer on the platform; no industry figure is held' },
  { id: 'approval_headline', canon: 'W264 KPI "Approval rate (surveyed) 94% · full or partial"', surfaces: ['claims_insights'],
    key: 'partner3.refusal.approvalHeadline', why: 'founder E10: the decided claims are printed as COUNTS (approved, partially approved, rejected), never a rate' },
  { id: 'complaints_count', canon: 'W264 KPI "Repudiation complaints 0 to ombudsman, FY"', surfaces: ['claims_insights'],
    key: 'partner3.refusal.complaintsCount', why: 'no grievance model for claims; a regulatory claim (the 2b W254 precedent)' },
  { id: 'funded_programme', canon: 'W264 "the vet network\'s preventive rounds … are now jointly funded"', surfaces: ['claims_insights'],
    key: 'partner3.refusal.fundedProgramme', why: 'MONEY: no programme is funded through the platform' },
  { id: 'outcome_stories', canon: 'W264 "What the numbers changed": bloat campaign "death claims down 22% QoQ" · hail → parametric add-on · pump-house checklist', surfaces: ['claims_insights'],
    key: 'partner3.refusal.outcomeStories', why: 'three fabricated outcomes: no such campaign, offer or checklist exists' },
  // ── the claim export chain (W2855–W2856) and the claim mutate chain (W2857–W2859) ──
  { id: 'claims_file', canon: 'W2855 "audit-stamped, checksummed, delivered by signed URL" · W2856 "file name, row count, sha256 … 15-min signed URL, every fetch logged"', surfaces: ['claims_insights', 'insights_export'],
    key: 'partner3.refusal.claimsFile', why: 'founder 2b-1: no partner export plane in Phase 1 (P2-B6) — the mailbox line' },
  { id: 'chain_zero_sum', canon: 'W2858 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: ACT,
    key: 'partner3.refusal.chainZeroSum', why: 'nothing on these pages moves money' },
  { id: 'chain_on_call', canon: 'W2859 "repeated failures page the on-call"', surfaces: ACT,
    key: 'partner3.refusal.chainOnCall', why: 'no paging from a partner page exists' },
  { id: 'chain_audit', canon: 'W2858 "View audit trail" · "the audit trail has the entry"', surfaces: ACT,
    key: 'partner3.refusal.chainAudit', why: 'a re-read writes nothing but its own read row; the console has no audit-trail page' },
  // ── PARTNER-3b's surfaces (registered now; the pages are 3b's) ──
  { id: 'machine_checks', canon: 'W255 "Machines pre-check, humans decide" · "Auto-verified … geotag ✓ + EXIF fresh ✓ + tag match ✓" · "tag legible 0.9410" · W256 confidence scores', surfaces: ['evidence', 'evidence_board'],
    key: 'partner3.refusal.machineChecks', why: 'no pre-check code exists; location and capture metadata are stripped from stored images (exif-stripper.ts:1-4; media-links.service.ts:86-97)' },
  { id: 'image_match', canon: 'W255 "duplicate-image signal" · "1 photo matches an older claim" · W263 "1 photo hash-matches a Feb claim"', surfaces: ['evidence', 'evidence_board', 'fraud'],
    key: 'partner3.refusal.imageMatch', why: 'no duplicate or perceptual-hash check; `sha256` is client-declared and stale after the strip (survey F-8)' },
  { id: 'new_photos', canon: 'W255 "Re-shoot requests (7d) 4 · farmer guided by voice" · W256 "Request re-shoot (guided)" · "calls her, in Gujarati"', surfaces: ['evidence', 'evidence_board'],
    key: 'partner3.refusal.newPhotos', why: 'no request-for-photos or calling channel exists' },
  { id: 'sealed_files', canon: 'W256 "evidence board frozen into the claim file (hash-sealed)" · "Originals are stored durably with hashes" · "media downloads are watermarked + recorded"', surfaces: ['evidence_board'],
    key: 'partner3.refusal.sealedFiles', why: 'no freeze, no seal, no media mark (watermarks exist only in the exports plane / insights)' },
  { id: 'surveyor_roster', canon: 'W257 "drawn from the platform\'s own professional network" · "Start with the vet network" · W253 "the vet network makes surveys fast AND credible"', surfaces: ['surveyors', 'surveys', 'claim'],
    key: 'partner3.refusal.surveyorRoster', why: 'founder Q5: no roster or network exists; a surveyor is a member the organisation\'s desk names' },
  { id: 'surveyor_people', canon: 'W257 table "Dr. A. Rathod · +91 98••• ••442 · vet (livestock) · Junagadh belt · 2 slots this week" · W258 / W259 named surveyors', surfaces: ['surveyors', 'surveys', 'survey_report', 'claim'],
    key: 'partner3.refusal.surveyorPeople', why: 'founder Q4 / Q5: never a surveyor\'s identity; no coverage, turnaround or availability data exists' },
  { id: 'surveyor_join', canon: 'W257 "Empanel surveyor" ×3 · "empanelment checks qualifications + conflict declarations"', surfaces: ['surveyors'],
    key: 'partner3.refusal.surveyorJoin', why: 'founder Q5: the console manages nobody\'s staff' },
  { id: 'surveyor_pay', canon: 'W257 "Surveyors are paid per completed report through platform rails (professional-services lane)"', surfaces: ['surveyors'],
    key: 'partner3.refusal.surveyorPay', why: 'MONEY: no code pays a surveyor' },
  { id: 'stepping_aside', canon: 'W257 "conflicts (treating vet, kin, selling agent) auto-recuse" · W253 "independent — not the treating vet"', surfaces: ['surveyors', 'claim'],
    key: 'partner3.refusal.steppingAside', why: 'founder Q5: the desk\'s scheduler checks only membership and that the surveyor is not the claimant (PARTNER-3a)' },
  { id: 'grouped_visits', canon: 'W258 "hail cluster — Wed 15 Jul … same village + same event = one visit" · "Confirm Wednesday cluster"', surfaces: ['surveys'],
    key: 'partner3.refusal.groupedVisits', why: 'no grouping, booking or availability model exists; a village is location data (founder Q4)' },
  { id: 'survey_deadlines', canon: 'W258 rules "Livestock surveys ≤ 48h from verification" · "claim clock keeps running against US"', surfaces: ['surveys'],
    key: 'partner3.refusal.surveyDeadlines', why: 'nothing enforces a survey deadline' },
  { id: 'farmer_messages', canon: 'W258 "What the farmer is told" + a Gujarati sentence · "both holders notified in Gujarati the moment you confirm"', surfaces: ['surveys', 'survey_report'],
    key: 'partner3.refusal.farmerMessages', why: 'no farmer message exists for a claim step (survey F-9)' },
  { id: 'survey_method', canon: 'W259 "5 sample quadrats per plot, GPS-pinned" · "Farmers present + signed the field sheet" · "Reference undamaged plot photographed"', surfaces: ['survey_report'],
    key: 'partner3.refusal.surveyMethod', why: 'the report records `{damagePercent, notes, surveyedAt}` only (dto :15-19)' },
  { id: 'payout_formula', canon: 'W259 "Indicated payout" column · "Indicated = damage% × sum insured (policy formula)"', surfaces: ['survey_report'],
    key: 'partner3.refusal.payoutFormula', why: 'MONEY: no formula and no payout path (founder Q1)' },
  { id: 'report_accept', canon: 'W259 "Accept report — to decision" · "reviewer ≠ surveyor" · "survey_report hash-sealed"', surfaces: ['survey_report'],
    key: 'partner3.refusal.reportAccept', why: 'the state machine has no acceptance step (`surveyed` → a decision); the desk records the survey' },
  { id: 'fraud_flags', canon: 'W263 "Signals, not verdicts: duplicate media, ear-tag reuse, event-date clustering, serial claimants" · the flag rows · "flag rate 4.1% · false-flag rate 33%"', surfaces: ['fraud'],
    key: 'partner3.refusal.fraudFlags', why: 'founder Q6: refused by name in Phase 1 — no flag table, no partner act' },
  { id: 'cross_signal', canon: 'W263 "insurance signals and marketplace signals live in one ecosystem … route through the platform risk desk" · "FIR guidance to us"', surfaces: ['fraud'],
    key: 'partner3.refusal.crossSignal', why: 'founder Q6: never built from a farmer\'s marketplace activity; no risk desk for claims; no police referral' },
  { id: 'hidden_records', canon: 'W263 restricted state "flags never appear on the claimant\'s own screens"', surfaces: ['fraud'],
    key: 'partner3.refusal.hiddenRecords', why: 'founder Q6: an adverse record a person never learns of is the opposite of the appeal precedent (appeals.controller.ts:1-7)' },
  { id: 'auto_flagging', canon: 'W263 "Suspicious claim patterns are flagged automatically for review" · "Signal evaluation is server-side"', surfaces: ['fraud'],
    key: 'partner3.refusal.autoFlagging', why: 'founder Q6: no signal engine exists' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner3RefusalKeys(surface: Partner3Surface): string[] {
  return PARTNER3_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** The canon shapes PARTNER-3a builds differently — recorded DELTAs, not refusals. */
export const PARTNER3_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'nine_routes', canon: 'W252 `insurer/claims` · W253 `insurer/claims/[id]` · W255 `insurer/claims/evidence` · W256 `insurer/claims/evidence/[id]` · W257 `insurer/surveyors` · W258 `insurer/surveys` · W259 `insurer/surveys/[id]/report` · W263 `insurer/claims/fraud` · W264 `insurer/claims/insights`',
    built: 'the canon\'s own paths: 3a builds `insurer/claims`, `insurer/claims/[id]`, `insurer/claims/insights`; the other six are PARTNER-3b\'s honest pages (recorded now); the old `/insurance-claims(/[id])` answer 307 to `/insurer/claims(/[id])`' },
  { id: 'claims_chain_routes', canon: 'the chain pages W2855–W2856 (export) and W2857–W2859 (mutate) as separate files',
    built: 'query states of their parent pages: `/insurer/claims/insights?export=queued|ready`; `?act=confirm|success|failure` on the queue, the claim and the insights page' },
  { id: 'chain_returns', canon: 'W2857–W2859 Cancel / Back → W252 even from W253 and W264; W2855–W2856 Back → W252 though the trigger is W264 (F-17)', built: 'every chain state links back to the page it was opened from' },
  { id: 'fm_numbering', canon: 'FLOWMAP chain targets W1433–W1461 (two "claim(s)" mutate chains, a "claims" export) — survey C-16', built: 'none exist; mapped by module + pattern to the canon\'s ONE claim mutate chain W2857–W2859 and ONE claim export chain W2855–W2856' },
  { id: 'fm_misclass', canon: 'FLOWMAP W252 "2d" (a row cell) and "PM" (the notifications avatar) as `filter`; "approved · paying" (a status chip) as chain-mutate; W255 "2h"; W257 "Empanel surveyor" ×3 and two surveyor-name cells as `filter`; W259 "Query surveyor" as `filter` (F-16)',
    built: 'the waiting days are a column; no avatar is drawn; the approved chip is a COUNT (approved + partially approved) and the status filter is the machine\'s nine statuses; 3b records the rest' },
  { id: 'fm_omissions', canon: 'FLOWMAP omits W252\'s claim drill-ins (the claim number, "View") and row buttons, W253 "View settlement", W255 "Review" drill-ins, W257 "Actions for sv 1/2/3" (F-16)', built: 'every queue row links to its claim; "View settlement" is refused (no settlement exists); no row act is drawn' },
  { id: 'claim_reference', canon: 'claim numbers `CLM-2026-0084` and policy numbers `BKI-CTL-…3319`', built: 'the claim\'s id as its reference (its short form printed, the link carries the full id); the policy number, or "no policy number yet"' },
  { id: 'decide_unwired', canon: 'W253 "Decide" (the canon never wires it to any chain)', built: 'DECOR with the founder\'s sentence `partner3.claim.decideStatement` (Q3): the organisation that serves the farmer records the decision today' },
  { id: 'counts_window', canon: 'W252 chips "awaiting decision 0 · in survey 4 · docs_pending 3 · intimated 2 · approved · paying 2 · paid/closed (FY) 64"', built: 'COUNTS of the claims filed in the FY window (April–March, Asia/Kolkata, answered by the database) by status: intimated · documents pending · survey scheduled · surveyed · approved (incl. partially) · rejected · paid or closed' },
  { id: 'other_event', canon: 'W264 chart "Claims by event": death · hail · pest · fire · flood · other', built: 'the platform\'s eight `claim_event` codes + "not recorded" — "other" is not a code' },
  { id: 'w259_claim_id', canon: 'W259 `insurer/surveys/[id]/report`', built: 'PARTNER-3b: the `[id]` is a CLAIM id — no survey entity exists (the report is a column of the claim)' },
  { id: 'claims_sub_nav', canon: 'the canon insurer sidebar has ONE claims item for nine screens; W255, W257, W258, W263 are reachable only from their own chains, W264 from nothing (F-17)',
    built: 'one nav item (Claims) between Premiums and Reports + a claims sub-navigation on the claims pages: Queue · Insights now; PARTNER-3b adds Evidence · Surveyors · Surveys · Fraud' },
  { id: 'subject_type_only', canon: 'W252 / W253 "cattle death", "hailstorm", the animal, the breed', built: 'the subject TYPE and the event type CODE only (founder Q4)' },
]);

/** Every canon file of PARTNER-3 (26): 3a's 8 decided, 3b's 18 pending their wave. */
export type Partner3Verdict = 'BUILT' | 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR' | 'pending_3b';
export const PARTNER3_CANON_FILES: readonly { file: string; wave: '3a' | '3b'; verdict: Partner3Verdict; note: string }[] = Object.freeze([
  // ── 3a · THE INSURER READS ITS OWN CLAIMS (8) ──
  { file: 'W252-partner-claims.html', wave: '3a', verdict: 'BUILT', note: '/insurer/claims over GET /v1/partner/insurance/claims + /counts: the counts by status in the FY window with as-of; the queue of claim facts OLDEST first (waiting days, reference, event code, subject type, sum insured, reported within 72 hours yes/no, status), the status filter, keyset; Take next DECOR; "paying", the run, names, villages, hours, timers, roles, the two-person rule refused' },
  { file: 'W253-partner-claim-detail.html', wave: '3a', verdict: 'BUILT', note: '/insurer/claims/[id] over GET /v1/partner/insurance/claims/:id: the claim facts, "no policy number yet", the damage percentage when recorded, filed / last changed / closed; Decide DECOR with the founder\'s sentence; no claimant, survey notes, surveyor, media, message or timeline block (each refused by name)' },
  { file: 'W264-partner-claims-insights.html', wave: '3a', verdict: 'BUILT', note: '/insurer/claims/insights over GET /v1/partner/insurance/claims/counts: the FY window label; counts by status and by the eight event codes + not recorded; decided COUNTS; no ratio, no rate, no money headline; Export DECOR with the mailbox line' },
  { file: 'W2855-partner-claim-export-queued.html', wave: '3a', verdict: 'DECOR', note: '/insurer/claims/insights?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox' },
  { file: 'W2856-partner-claim-export-ready.html', wave: '3a', verdict: 'DECOR', note: '/insurer/claims/insights?export=ready — no file, no signed link' },
  { file: 'W2857-partner-claim-mutate-confirm.html', wave: '3a', verdict: 'PARITY-DECOR', note: '?act=confirm on the queue, the claim and the insights page — Retry is a re-read; "Take next" is DECOR (nothing to take)' },
  { file: 'W2858-partner-claim-mutate-success.html', wave: '3a', verdict: 'PARITY-DECOR', note: '?act=success — read again; nothing written' },
  { file: 'W2859-partner-claim-mutate-failure.html', wave: '3a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  // ── 3b · WHAT THE INSURER DOES NOT HOLD (18) — pending their wave ──
  { file: 'W255-partner-evidence-review.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: an honest page (evidence stays with the farmer and the organisation that serves them)' },
  { file: 'W256-partner-evidence-board.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: an honest page' },
  { file: 'W257-partner-surveyors.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: an honest page (no surveyor roster on the platform)' },
  { file: 'W258-partner-survey-scheduling.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: claim facts by survey status (0230\'s read); the act DECOR' },
  { file: 'W259-partner-survey-report.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: an honest page (+ the recorded damage percentage); the [id] is a claim id' },
  { file: 'W263-partner-fraud-flags.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b: an honest page — refused by name (founder Q6)' },
  { file: 'W2866-partner-evidence-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2867-partner-evidence-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2868-partner-evidence-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2904-partner-surveyors-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2905-partner-surveyors-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2906-partner-surveyors-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2934-partner-fraud-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2935-partner-fraud-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W2936-partner-fraud-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W3014-partner-survey-mutate-confirm.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W3015-partner-survey-mutate-success.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
  { file: 'W3016-partner-survey-mutate-failure.html', wave: '3b', verdict: 'pending_3b', note: 'PARTNER-3b' },
]);

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain3Id = 'claims_act' | 'claim_act' | 'insights_act' | 'insights_export';
export interface Chain3Def {
  id: Chain3Id; wave: '3a'; param: string; page: string; surface: Partner3Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[];
  /** An export chain prints "exports are not available … write to the partners mailbox" + the mailbox FACT (founder 2b-1, Q8). */
  mailbox?: boolean;
}
export const PARTNER3_CHAINS: readonly Chain3Def[] = Object.freeze([
  // the ONE canon claim mutate chain (W2857–W2859) serves three pages; its files are recorded once, on the queue (the canon's own return page)
  { id: 'claims_act', wave: '3a', param: 'act', page: '/insurer/claims', surface: 'claims_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner3.chain.act.${s}`, files: ['W2857', 'W2858', 'W2859'] },
  { id: 'claim_act', wave: '3a', param: 'act', page: '/insurer/claims/[id]', surface: 'claim_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner3.chain.act.${s}`, files: [] },
  { id: 'insights_act', wave: '3a', param: 'act', page: '/insurer/claims/insights', surface: 'insights_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner3.chain.act.${s}`, files: [] },
  { id: 'insights_export', wave: '3a', mailbox: true, param: 'export', page: '/insurer/claims/insights', surface: 'insights_export', states: ['queued', 'ready'],
    key: (s: string) => `partner3.chain.export.${s}`, files: ['W2855', 'W2856'] },
]);
export function chain3ById(id: Chain3Id): Chain3Def { return PARTNER3_CHAINS.find((c) => c.id === id) as Chain3Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain3State(id: Chain3Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain3ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}

/** PC-56 PARTNER-3a (survey F-13 / E7) — the DEV-24 claims pair answers a real HTTP 307 to the canon's `insurer/claims` paths (next.config.js
 *  `redirects()`, pinned equal to INSURANCE_REDIRECTS + LENDER_REDIRECTS + this map by the not-yet render test — their page files are gone). */
export const CLAIMS_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/insurance-claims': '/insurer/claims',
  '/insurance-claims/:id': '/insurer/claims/:id',
});

/** The claims sub-navigation (survey E3 / F-17): one nav item, and the claims pages' own tabs. 3a: Queue · Insights. PARTNER-3b adds Evidence ·
 *  Surveyors · Surveys · Fraud — they are NOT drawn until their pages exist (built routes only). */
export const CLAIMS_SUBNAV: readonly { href: string; key: string; wave: '3a' | '3b'; live: boolean }[] = Object.freeze([
  { href: '/insurer/claims', key: 'partner3.subnav.queue', wave: '3a', live: true },
  { href: '/insurer/claims/insights', key: 'partner3.subnav.insights', wave: '3a', live: true },
  { href: '/insurer/claims/evidence', key: 'partner3.subnav.evidence', wave: '3b', live: false },
  { href: '/insurer/surveyors', key: 'partner3.subnav.surveyors', wave: '3b', live: false },
  { href: '/insurer/surveys', key: 'partner3.subnav.surveys', wave: '3b', live: false },
  { href: '/insurer/claims/fraud', key: 'partner3.subnav.fraud', wave: '3b', live: false },
]);
