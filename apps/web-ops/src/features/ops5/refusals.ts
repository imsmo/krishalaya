// apps/web-ops/src/features/ops5/refusals.ts · PC-56 OPS-5 — WHAT THE ALERT AND INSIGHT PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops4/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it (persons, places, devices and figures
// anonymised) and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// (test/claims-guard.spec.ts, the `ops5.` scope) keeps the canon's false words out of every `ops5.` value.
//
// OPS-5 is HOTFIX-14 then two screen waves (`05_OPS.md` "OPS-5 SPLIT"; OPS-5 Q1-A and Q3-A applied by the lead under the founder's instruction of
// 2026-11-10 "if you need any help please select recommended option or choose as per your thinking" — his to reopen): 5a → 5b. This registry
// carries ALL 11 canon files. NAMED UPDATE (PC-56 OPS-5b): 5b decides its 6 — all 11 are decided, none pending, and the `pending_5b` verdict
// value is deleted from the type (the 4c-7 rule). Q2-A and Q4-A applied by the lead under the same instruction.
//
// OPS-5a · THE ALERTS builds:
//   • `alert_rules` (W402, `/iot/alert-rules`) — a READ of each alert rule as it is (kind, threshold in words, how many people it names, cooldown,
//     on or paused, last evaluated, its last recorded change — when, and whether it was you), its open proposal (the fields and which way, when,
//     proposed by you or not — never the reason), what each rule fired (when, how many were told, acknowledged or not), the breaches' own alerts
//     linked to W403; Q3-A's sentence verbatim (HOTFIX-14's `iot.secondPersonNotice`, renamed `ops5.alerts.secondPersonNotice`); the true
//     "no rule" sentence when no active breach rule exists. The change act REAL (`alert_act`).
//   • `alert_act` (W3292–W3294, `?act=` on W402) — REAL: propose a change to a rule (or make a new one), confirm another person's proposal,
//     withdraw your own — exactly as the API allows (HOTFIX-14); the success state says what the SERVER did; the failure state names the refusal.
//   • `alert_incident` (W403, `/iot/alert-incident?id=`) — a READ of one breach: its subject by the server's short reference, band, peak, the
//     server's timeline with times, duration, the alert's state and how many were told, which acts are recorded and when (never their text),
//     the outcome in words, a recorded loss as the server's amount in its own currency; Q1-A's sentence; no act.
//   • `incident_act` (the same W3292–W3294 files, opened by W403's "Retry") — PARITY-DECOR: a re-read; Back → W403 (never W402: canon defect).
//
// OPS-5b · THE ORGANISATION'S MILK, IN NUMBERS builds:
//   • `insights` (W369, `/insights`) — a READ of `GET /v1/dairy/insights` (TENANT-6e-1, `dairy.manage`, behind `dairy` + `dairy_insights`):
//     every figure the server returns, as the server words it — kg a day and in total, the counter rate per kg (through formatMoneyMinor with
//     the read's own currency, never a fallback), pourers (active, new, back, continuing) as counts, payment cycles closed and with every bill
//     approved beside the server's own refusal of a payout record, the weekly table by shift, the premium band in words, the rate cards in
//     force, the bonus paid, the spoilage refusal; a 30/90/180-day window (links, GET); labelled the whole organisation on every group; Q2-A's
//     and Q4-A's sentences verbatim; its states (ok, empty, not enough history, money shape unavailable, switched off, refused, error).
//     Replaces OW-6's tenant analytics page (survey C-8 / F-9, E16).
//   • `insights_export` (W3321–W3322, `/insights?export=<job>`) — REAL on the tenant export plane: the job queued (position, an ETA called an
//     estimate) and ready (the receipt in words — file name, rows, sha256, generated-at, requester as you), the download route minting the
//     audited 15-minute link and piping the logged fetch; the plane switched off is its own sentence.
//   • `insights_act` (W3323–W3325, `?act=` on W369, opened by "Retry") — PARITY-DECOR: a re-read; no scheduled computation is retried; Back → W369.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops5Surface =
  // the three pages
  | 'insights' | 'alert_rules' | 'alert_incident'
  // the chains
  | 'alert_act' | 'incident_act' | 'insights_export' | 'insights_act';
export interface Ops5Refusal { id: string; canon: string; surfaces: readonly Ops5Surface[]; key: string; why: string }

/** The surfaces OPS-5a builds. */
export const SURFACES_5A: readonly Ops5Surface[] = ['alert_rules', 'alert_incident', 'alert_act', 'incident_act'];
/** The surfaces OPS-5b builds (pending until it does). */
export const SURFACES_5B: readonly Ops5Surface[] = ['insights', 'insights_export', 'insights_act'];
const ALERT_PAGES: readonly Ops5Surface[] = ['alert_rules', 'alert_incident'];
// NAMED UPDATE (PC-56 OPS-5b): `search` also names W369 (its chrome carries the same search box and "MM" filter); the chains' shared zero-sum
// and on-call sentences are refused on the insights re-read too (W3324, W3325).
const SEARCH_PAGES: readonly Ops5Surface[] = ['alert_rules', 'alert_incident', 'insights'];

export const OPS5_REFUSALS: readonly Ops5Refusal[] = Object.freeze([
  // ══ the console chrome on W402 / W403 ══
  { id: 'chrome_counts', canon: 'console chrome "[org] · Field Ops · IoT & machinery · sensors [n] · assets [n]"', surfaces: ALERT_PAGES,
    key: 'ops5.refusal.chromeCounts', why: 'FALSE as counts (survey shared chrome; as OPS-4c)' },
  { id: 'search', canon: 'console chrome "Search metrics/rules/incidents… ⌘K" · "MM"', surfaces: SEARCH_PAGES,
    key: 'ops5.refusal.search', why: 'DECOR — no search or person filter exists on these pages' },
  // ══ W402 ══
  { id: 'device_type_table', canon: 'W402 table "Device type · Condition · Action" (cooler "> [n]°C for [n] min · critical · rings phone"; chamber "humidity > [n]% for [n]h"; soil pod "any reading"; vaccine box "any breach · critical + vet desk")', surfaces: ['alert_rules'],
    key: 'ops5.refusal.deviceTypeTable', why: 'FALSE (survey §1B): rules have three kinds, not device types; no duration rule; humidity is never judged; soil pods send nothing; no vet desk' },
  { id: 'rule_severity', canon: 'W402 "critical" / "important" / "advisory" set per rule', surfaces: ['alert_rules'],
    key: 'ops5.refusal.ruleSeverity', why: 'FALSE: the SERVER rates each alert from its evidence (ops-alert.rules.ts severityFor); a rule cannot set it' },
  { id: 'rings_phone', canon: 'W402 "a critical [cooler] alert rings the phone at [time] the same as noon"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.ringsPhone', why: 'FALSE for a breach: 0201 catalogues it in-app + push only; a rule\'s critical alert may use a voice leg only where telephony exists (unverified)' },
  { id: 'escalation', canon: 'W402 "Escalation ladder — every step recorded: [role] — [n] minutes · …" and "who was asked, when, whether or not they answered"', surfaces: ['alert_rules', 'alert_act'],
    key: 'ops5.refusal.escalation', why: 'FALSE (survey F-6, OPS5-B10): one fan-out to the people named; nothing after; whether anyone answered is not recorded' },
  { id: 'versions', canon: 'W402 "… and versioned — the prior version stays on file"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.versions', why: 'PARTLY FALSE: every change is RECORDED (audit before/after; HOTFIX-14) and every proposal is kept, but no version history of a rule is offered here' },
  { id: 'platform_defaults', canon: 'W402 "No custom rules yet — This tenant is running the platform defaults shown above"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.platformDefaults', why: 'FALSE (survey §1B): there are no platform default rules' },
  { id: 'later_wins', canon: 'W402 "Rule versioning conflict — the later … approval wins, the other is archived, not lost"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.laterWins', why: 'FALSE: one open proposal per rule; a rule moved since a proposal is never overwritten (ALERT_RULE_CHANGED_SINCE_PROPOSAL)' },
  { id: 'any_ops_user', canon: 'W402 "Any ops user can propose a threshold change; only a second approver (checker) can confirm it live"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.anyOpsUser', why: 'FALSE: only a holder of logistics.manage proposes or confirms; no approver role exists — "a second person" (HOTFIX-14)' },
  { id: 'soil_patient', canon: 'W402 "soil is patient, milk is not"', surfaces: ['alert_rules'],
    key: 'ops5.refusal.soilPatient', why: 'no soil reading exists (OPS-4c Q6-A)' },
  { id: 'run_now', canon: 'OW-7 `/devices/alerts` "Run the rules now" (not canon)', surfaces: ['alert_rules'],
    key: 'ops5.refusal.runNow', why: 'E6: it pages real people on demand; it leaves this console (the API route stays, recorded)' },
  // ══ W403 ══
  { id: 'buyer_name', canon: 'W403 "([crop], buyer [name])"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.buyerName', why: 'WALL (E15): the breach read carries no buyer identity — keep it so; no crop' },
  { id: 'cause', canon: 'W403 "Cause — Door open at the hub transfer"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.cause', why: 'FALSE: no cause field; the free-text action note is never printed (E15)' },
  { id: 'door', canon: 'W403 timeline "door opens" / "door closes"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.door', why: 'FALSE: no door sensor exists' },
  { id: 'trail_attached', canon: 'W403 "Buyer informed of the blip with the reading trail attached"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.trailAttached', why: 'FALSE: the offer carries the peak, band and minutes; no trail' },
  { id: 'bump_not_breach', canon: 'W403 "Buyer chooses to accept the lot — bump, not breach"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.bumpNotBreach', why: 'FALSE: by the server\'s own rule it IS a breach; the word is kept' },
  { id: 'closed_by_person', canon: 'W403 "Incident file closed" · "only tenant ops can mark an incident closed once the buyer\'s choice is on file"', surfaces: ['alert_incident', 'incident_act'],
    key: 'ops5.refusal.closedByPerson', why: 'FALSE: a breach closes when a logger reading returns into the band (0201); nobody closes it' },
  { id: 'tolerance', canon: 'W403 "Graded response: the diverted-never-silently-sold rule does not auto-apply to a brief, within-tolerance blip"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.tolerance', why: 'FALSE: no such rule and no tolerance' },
  { id: 'cause_blocks', canon: 'W403 "Incident missing a cause — A breach closed without a recorded cause blocks closure"', surfaces: ['alert_incident'],
    key: 'ops5.refusal.causeBlocks', why: 'FALSE: an outcome needs a reason and only after the readings are back in range (breachActsFor)' },
  // ══ the chains (W3292–W3294) — the shared sentences refused BY NAME ══
  { id: 'act_zero_sum', canon: 'W3293 / W3324 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: ['alert_act', 'incident_act', 'insights_act'],
    key: 'ops5.refusal.zeroSum', why: 'no money moves in a rule change or a re-read' },
  { id: 'act_on_call', canon: 'W3294 / W3325 "repeated failures page the on-call"', surfaces: ['alert_act', 'incident_act', 'insights_act'],
    key: 'ops5.refusal.onCall', why: 'no paging exists' },
  { id: 'act_audit_view', canon: 'W3292–W3294 "View audit trail"', surfaces: ['alert_act'],
    key: 'ops5.refusal.auditView', why: 'every change IS recorded (HOTFIX-14), but no record viewer exists on this console' },
  { id: 'incident_audit', canon: 'W3292 "confirming writes an … entry with actor, time and reason" (opened from W403)', surfaces: ['incident_act'],
    key: 'ops5.refusal.incidentAudit', why: 'reading a breach again writes nothing' },
  { id: 'incident_close', canon: 'W403 state "Couldn\'t close the incident … Retry"', surfaces: ['incident_act'],
    key: 'ops5.refusal.incidentClose', why: 'there is no close act; Retry reads the breach again' },
  // ══ W369 (OPS-5b) — persons, places and figures anonymised; Q2-A and Q4-A lead-applied ══
  { id: 'ins_chrome', canon: 'W369 chrome "[centre] · OPS · [org] · dairy ops · [n] member pourers · [n] shifts"', surfaces: ['insights'],
    key: 'ops5.refusal.insChrome', why: 'the centre is FALSE (no centre filter, dairy-insights.repository.ts); "[n] shifts" a Rule-Zero list (OPS-3 Q16-A); the pourer count is the organisation\'s and is printed in its group' },
  { id: 'centre_figures', canon: 'W369 "Centre insights — what the pours are saying … trends [a role] can act on before the FPO asks"', surfaces: ['insights'],
    key: 'ops5.refusal.centreFigures', why: 'FALSE (survey F-8, OPS5-B9): every query is WHERE tenant_id; no centre\'s figures exist; no such role (OPS-3 Q14-A)' },
  { id: 'compute_schedule', canon: 'W369 "Nightly compute" · state "Nightly compute late — Yesterday\'s stamped cards stand (as-of law). Retry"', surfaces: ['insights', 'insights_act'],
    key: 'ops5.refusal.computeSchedule', why: 'FALSE: a READ model on the replica, read on every request (dairy-insights.read-model.ts); nothing is scheduled, stamped or late' },
  { id: 'member_total', canon: 'W369 "[n] active pourers of [n] members"', surfaces: ['insights'],
    key: 'ops5.refusal.memberTotal', why: 'GAP-BE: the read has no member count; "of N" refused (S4 E3)' },
  { id: 'quiet_reasons', canon: 'W369 "the [n] quiet ones get a visit, not a letter: [n] dry animals, [n] selling elsewhere, [n] a family reason, [n] unknown"', surfaces: ['insights'],
    key: 'ops5.refusal.quietReasons', why: 'FALSE and WALL (Q2-A): no reason is recorded for anyone; health and trade data about a member (DPDP — a lawyer\'s question)' },
  { id: 'no_shares', canon: 'W369 "Retention is a relationship number wearing a percentage" · "▲[n] vs previous"', surfaces: ['insights'],
    key: 'ops5.refusal.noShares', why: 'no %, share or change ratio is printed (brief §D "Numbers"); the server\'s basis points are not shown' },
  { id: 'quality_figures', canon: 'W369 "Median fat [n] … SNF [n] · retest rate [n] · adulteration hits 0 for [n] straight days (on the counter poster)"', surfaces: ['insights'],
    key: 'ops5.refusal.qualityFigures', why: 'GAP-BE (OPS5-B11): the insights read has none of them' },
  { id: 'member_watch', canon: 'W369 "Two members\' fat dropped [n]+ this week → feed-advisory message in [language], not a flag"', surfaces: ['insights'],
    key: 'ops5.refusal.memberWatch', why: 'FALSE and WALL (Q2-A): no per-member watch and no message exist' },
  { id: 'payout_timing', canon: 'W369 "Money on time — every CONFIRMED line paid on day [n] after close; silent lines on day [n] … three honest speeds"', surfaces: ['insights'],
    key: 'ops5.refusal.payoutTiming', why: 'REFUSED BY THE SERVER (PAYOUT_STREAK_MISSING): no paid-at is recorded; the group prints the server\'s refusal and its two facts' },
  { id: 'cooler_dispatch', canon: 'W369 "BMC & dispatch — [n] breach-minutes · tanker recon gap … · morning fill hits [n] · the case for a second cooler with its payback math"', surfaces: ['insights'],
    key: 'ops5.refusal.coolerDispatch', why: 'GAP-BE / FALSE: breach durations are not summed; dispatch refused (OPS-3 Q12-A); fill refused (OPS-3b); a payback is a money forecast' },
  { id: 'goals', canon: 'W369 state "First week of data — targets show from day one"', surfaces: ['insights'],
    key: 'ops5.refusal.goals', why: 'FALSE: no goal exists anywhere; the server\'s own "not enough history" state is printed instead' },
  { id: 'leaderboard', canon: 'W369 state "member-level drill needs the manager role — a counter screen never becomes a leaderboard of neighbours"', surfaces: ['insights'],
    key: 'ops5.refusal.leaderboard', why: 'the principle is TRUE of the read (no member rows; Q2-A); this page opens no member\'s record; no manager role' },
  // ══ the insights chains (W3321–W3325) ══
  { id: 'export_record_view', canon: 'W3321 / W3322 "View audit trail"', surfaces: ['insights_export'],
    key: 'ops5.refusal.exportRecordView', why: 'the request, the link and every fetch ARE recorded by the plane, but no record viewer exists on this console' },
  { id: 'insights_act_writes', canon: 'W3323 "confirming writes an … entry with actor, time and reason"', surfaces: ['insights_act'],
    key: 'ops5.refusal.insightsActWrites', why: 'reading the figures again writes nothing' },
]);
export function ops5RefusalKeys(surface: Ops5Surface): string[] { return OPS5_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS5_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_5a', canon: 'W402 `iot/alert-rules`, W403 `iot/alert-incident`', built: 'the two at their canon addresses; W403 takes `?id=` (one breach)' },
  { id: 'devices_redirects', canon: 'OW-7 `/devices/rules` and `/devices/alerts` (survey §1B "the built console")', built: 'REAL 307s (next.config.js, permanent: false) → `/iot/alert-rules`; both OW-7 pages and their server actions are deleted, and their `iot.` keys with them (the ones W402 reuses renamed into `ops5.alerts.`)' },
  { id: 'run_now_removed', canon: 'OW-7 "Run the rules now" (E6)', built: 'removed from this console; the API route stays and now writes one audit row naming the person' },
  { id: 'ack_removed', canon: 'OW-7 `/devices/alerts` "Acknowledge" (survey F-4)', built: 'not offered on W402 (the canon offers none); the API acknowledge is now keyed and recorded, and a breach\'s or a silence\'s own alert is refused ALERT_ACK_ON_ITS_OWN_FILE (the 5a first commit)' },
  { id: 'q3_built', canon: 'W402 "Rule edits are maker-checker and versioned" (survey §1B)', built: 'Q3-A as HOTFIX-14 built it: a change that could make an alert quieter is a proposal until another person confirms it; a louder change applies at once; both recorded. The words are "a second person", never "maker-checker"' },
  { id: 'review_change', canon: 'W402 "Review proposed change" (`data-decor` button; FM:112 nav-detail)', built: 'REAL: a link to the proposal\'s own state of the change chain, where another person may confirm and the proposer may withdraw' },
  { id: 'recipients_count', canon: 'W402 "who it rings"', built: 'the number of people a rule names — never an id or a name (E15); people are added or removed by typing their ids, and the rule\'s own ids are never printed back' },
  { id: 'rule_names', canon: 'survey E15 "Rule names are printed (their identity)"', built: 'a rule\'s name is printed as typed — the ONE free text on W402, pinned by a render test with a name-shaped fixture' },
  { id: 'last_change', canon: 'brief §E "who last changed it and when — from the audit/author columns"', built: 'the rule\'s last recorded change from `audit_log` (made, changed, or a proposal confirmed): when, and whether it was you — never a name (`updated_at` moves with every evaluation and cannot answer it)' },
  { id: 'no_rule_sentence', canon: 'survey §1B "No alert rule is set. A breach is still recorded, but nobody is told until a rule names who to tell."', built: 'NOT PRINTED AS WORDED — false on a shipment: 0201 also tells the shipment\'s driver. Printed instead (a fact of 0201:955-966): the server tells nobody about a breach except a shipment\'s driver, and still records it' },
  { id: 'w403_edges', canon: 'W403 is reached only from W400 (survey §0)', built: 'drawn: W400\'s last breach, each breach on W401, and each breach alert on W402 link `/iot/alert-incident?id=`' },
  { id: 'incident_chain_back', canon: 'W403 "Retry" rides W402\'s chain (W3292–W3294), so its Back returns to W402 (survey §1, canon defect)', built: 'from W403 the chain is PARITY-DECOR and its Back is W403 (the same breach)' },
  { id: 'sidebar_alert_rules', canon: 'console sidebar "Sensors · … · Alert rules"', built: '"Alert rules" in the Sensors group replaces the OW-7 `/devices/alerts` link (same nav key)' },
  { id: 'times_utc_5a', canon: 'W403 "Sat [d] Jul … [n] min"', built: 'each instant as the server\'s own date and minute, labelled UTC (the OPS-3b `atText`); the duration from the server\'s seconds' },
  { id: 'fm_chain_ids_5', canon: 'FM :110-114 chain targets W1844–W1846 (survey C-7)', built: 'those files do not exist; the real alert chain is W3292–W3294' },
]);

/** The verdict values. NAMED UPDATE (PC-56 OPS-5b): `pending_5b` is deleted now that 5b decides its six (the 4c-7 rule). */
export type Ops5Verdict = 'BUILT (read)' | 'REAL' | 'PARITY-DECOR';
export type Ops5Wave = '5a' | '5b';
/** Every canon file of OPS-5 (11), each with ONE verdict: 5a decides its 5, 5b its 6 — 11 decided, 0 pending. */
export const OPS5_CANON_FILES: readonly { file: string; wave: Ops5Wave; module: 'logistics' | 'dairy'; verdict: Ops5Verdict; note: string }[] = Object.freeze([
  // ── 5a · THE ALERTS (5) — decided (Q1-A, Q3-A lead-applied; the 5a first commit, OPS5-B3/B4/B6, E6) ──
  { file: 'W402-ops-alert-rules.html', wave: '5a', module: 'logistics', verdict: 'REAL', note: '/iot/alert-rules — a READ of each rule (kind, threshold in words, people named as a count, cooldown, on or paused, last evaluated, last recorded change: when and whether by you), its open proposal (fields and direction, when, by you or not — never the reason), what each rule fired (when, how many told, acknowledged or not), the breach alerts linked to W403; the Q3-A sentence; the true no-rule sentence; "Propose a change" REAL (the alert chain)' },
  { file: 'W403-ops-alert-incident.html', wave: '5a', module: 'logistics', verdict: 'BUILT (read)', note: '/iot/alert-incident?id= — one breach (GET …/cold-chain/breaches/:id): subject type and short reference, band, peak, the server\'s timeline with times, duration, the alert\'s state and how many were told, which acts are recorded and when (never their text), the outcome and the buyer\'s decision in words, a recorded loss through formatMoneyMinor in its own currency; the Q1-A sentence; no act; zero inputs' },
  { file: 'W3292-ops-alert-mutate-confirm.html', wave: '5a', module: 'logistics', verdict: 'REAL', note: '?act=confirm on W402 — the change form for one rule (or a new rule), or the open proposal with confirm (another person) / withdraw (the proposer), a key minted when shown; from W403: PARITY-DECOR, the link IS a re-read of the breach' },
  { file: 'W3293-ops-alert-mutate-success.html', wave: '5a', module: 'logistics', verdict: 'REAL', note: '?act=success — what the SERVER did: proposed (waiting for a second person), applied, created, confirmed or withdrawn; the zero-sum sentence refused BY NAME; from W403: nothing was changed' },
  { file: 'W3294-ops-alert-mutate-failure.html', wave: '5a', module: 'logistics', verdict: 'REAL', note: '?act=failure — the named refusal (ALERT_RULE_CONFIRMER_IS_PROPOSER, …_CHANGE_ALREADY_OPEN, …_CHANGED_SINCE_PROPOSAL, …); nothing changed; Back → W402 (from W403: Back → W403); nobody is paged' },
  // ── 5b · THE ORGANISATION'S MILK, IN NUMBERS (6) — decided (Q2-A, Q4-A lead-applied; the 5b first commit, OPS5-B6, E16) ──
  { file: 'W369-ops-insights.html', wave: '5b', module: 'dairy', verdict: 'BUILT (read)', note: '/insights — GET /v1/dairy/insights: every figure as the server words it (kg a day and in total, rate per kg through formatMoneyMinor in the read\'s currency, pourer counts, cycles closed / with every bill approved beside the server\'s payout refusal, the weekly table by shift, the premium band in words, cards in force, bonus paid, the spoilage refusal); 30/90/180 window by link; the whole organisation on every group; Q2-A and Q4-A verbatim; no member, reason, rank, %, goal or schedule; "Export" REAL (the export chain)' },
  { file: 'W3321-ops-insights-export-queued.html', wave: '5b', module: 'dairy', verdict: 'REAL', note: '/insights?export=<job> while queued or running — the plane\'s position and an ETA called an estimate ("no estimate yet" with no history); "Check again" re-reads GET /v1/exports/:id; the plane OFF → its own sentence' },
  { file: 'W3322-ops-insights-export-ready.html', wave: '5b', module: 'dairy', verdict: 'REAL', note: '/insights?export=<job> once ready — the receipt in words (file name, data rows, sha256, generated-at, requester as you), the fetch counts from the log; "Download" POSTs to /insights/exports/<job>/download, which mints the audited 15-minute link and pipes the logged fetch; expired / failed by name' },
  { file: 'W3323-ops-insights-mutate-confirm.html', wave: '5b', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=confirm on W369 (opened by "Retry") — the one link IS a re-read of the figures; no scheduled computation is retried' },
  { file: 'W3324-ops-insights-mutate-success.html', wave: '5b', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=success — the figures are read afresh each time the page opens; nothing written; the zero-sum sentence refused BY NAME' },
  { file: 'W3325-ops-insights-mutate-failure.html', wave: '5b', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=failure — nothing written; Back → W369; nobody is paged' },
]);

/** The three canon chain groups (survey §1D–§1F, 8 files, each exactly once) and the wave that owns each. */
export const OPS5_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Ops5Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'alert_mutate', donor: 'W402 (also opened by W403\'s Retry)', wave: '5a', files: ['W3292', 'W3293', 'W3294'] },
  { id: 'insights_export', donor: 'W369', wave: '5b', files: ['W3321', 'W3322'] },
  { id: 'insights_mutate', donor: 'W369', wave: '5b', files: ['W3323', 'W3324', 'W3325'] },
]);

// ── THE BUILT CHAINS: each is a query state of the page that opened it (`?act=`). The alert mutate group is built TWICE, by its two openers:
// REAL from W402, PARITY-DECOR from W403 (survey §1D). ──
// NAMED UPDATE (PC-56 OPS-5b): the two insights chains join, and each chain now names its own Back and re-read labels (5a's values unchanged).
// `insights_export`'s state is the JOB's (the plane decides queued or ready — never the URL); its extra states are the plane's other answers.
export type Chain5Id = 'alert_act' | 'incident_act' | 'insights_export' | 'insights_act';
export interface Chain5Def {
  id: Chain5Id; wave: Ops5Wave; kind: 'REAL' | 'PARITY-DECOR'; group: string; surface: Ops5Surface; states: readonly string[]; key: (state: string) => string; statement: string;
  backKey: string; rereadKey: string;
}
export const OPS5_CHAINS: readonly Chain5Def[] = Object.freeze([
  { id: 'alert_act', wave: '5a', kind: 'REAL', group: 'alert_mutate', surface: 'alert_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops5.chain.alertAct.${s}`, statement: 'ops5.alerts.secondPersonNotice',
    backKey: 'ops5.chain.backRules', rereadKey: 'ops5.chain.reread' },
  { id: 'incident_act', wave: '5a', kind: 'PARITY-DECOR', group: 'alert_mutate', surface: 'incident_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops5.chain.incidentAct.${s}`, statement: 'ops5.q1.words',
    backKey: 'ops5.chain.backIncident', rereadKey: 'ops5.chain.reread' },
  { id: 'insights_export', wave: '5b', kind: 'REAL', group: 'insights_export', surface: 'insights_export',
    states: ['queued', 'ready', 'failed', 'expired', 'off', 'forbidden', 'notFound', 'error'], key: (s: string) => `ops5.chain.insightsExport.${s}`, statement: 'ops5.ins.export.statement',
    backKey: 'ops5.chain.backInsights', rereadKey: 'ops5.chain.checkAgain' },
  { id: 'insights_act', wave: '5b', kind: 'PARITY-DECOR', group: 'insights_mutate', surface: 'insights_act', states: ['confirm', 'success', 'failure'], key: (s: string) => `ops5.chain.insightsAct.${s}`, statement: 'ops5.ins.q2',
    backKey: 'ops5.chain.backInsights', rereadKey: 'ops5.chain.rereadInsights' },
]);
export function chain5ById(id: Chain5Id): Chain5Def { return OPS5_CHAINS.find((c) => c.id === id) as Chain5Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain5State(id: Chain5Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain5ById(id);
  const raw = searchParams?.act;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
