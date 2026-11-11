// apps/web-gov/src/features/gov2/refusals.ts · PC-56 GOV-2 — WHAT THE SCHEME AND APPLICATION PAGES DO NOT CLAIM, BY NAME. PURE.
// The `features/gov1/refusals.ts` shape (survey_gov2.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov2 claims guard (test/gov2-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov2.` value.
//
// GOV-2 is GOV-2a (backend, migration 0240) → GOV-2b → GOV-2c (survey §4; GOV-2 Q1-A and Q5-A applied by the lead under the founder's
// instructions of 2026-11-10 — 06_GOV.md "GOV-2 SPLIT"; his to reopen). This registry carries ALL 28 canon files: GOV-2b decides its 18,
// GOV-2c's 10 are `pending_2c` until that wave decides them (the 4c-7 rule: GOV-2c deletes the value from the type).
//
// GOV-2b · THE AUTHORITY'S SCHEMES builds (Q5-A: the authority READS its schemes; writing and publishing stay with the platform's team):
//   • `schemes` (W326, `/schemes`) — BUILT (read): `gov.schemes.list()` (GOV-2a B3) — name, code, category, benefit type, instalments,
//     active / inactive, the published version, "a newer draft exists" as a fact; each row links to `/schemes/[id]`. No money figure (Q1-A).
//   • `scheme_identity` (W327, `/schemes/[id]?tab=identity`) — BUILT (honest): the published version's fields, read only; every authoring act
//     refused BY NAME (its chain DECOR).
//   • `scheme_rules` (W328, `?tab=rules`) — BUILT (honest): the rules in words from the evaluator's five fields (features/gov2/rules-format.ts),
//     acres as stored; "+ Add a rule", "Add a rule", "Save draft", "Remove" refused BY NAME (DECOR).
//   • `scheme_versions` (W329, `?tab=versions`) — BUILT (read): `gov.schemes.versions()` + `gov.schemes.diff()` — number, status, published
//     when, "published by a second person" as the read says, the diff as the read returns it; "Send for approval", "Start a draft" DECOR.
//   • the chains (`?do=…&act=`): scheme form, scheme send, rule form, rule remove — DECOR; the load-error Retrys — PARITY-DECOR (re-read).
//     Back → the page that opened it (`chain2Back`): a chain opened on a scheme returns to THAT scheme, never the list (the canon's defect).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov2Surface =
  // GOV-2b · the pages
  | 'schemes' | 'scheme_identity' | 'scheme_rules' | 'scheme_versions'
  // GOV-2b · the chains
  | 'scheme_form' | 'scheme_send' | 'scheme_reread' | 'rule_form' | 'rule_remove' | 'rules_reread'
  // GOV-2c (pending — no refusal is listed for them until that wave)
  | 'applications' | 'application' | 'application_act' | 'applications_export' | 'applications_reread';
export interface Gov2Refusal { id: string; canon: string; surfaces: readonly Gov2Surface[]; key: string; why: string }

/** The surfaces GOV-2b builds. */
export const SURFACES_2B: readonly Gov2Surface[] = ['schemes', 'scheme_identity', 'scheme_rules', 'scheme_versions', 'scheme_form', 'scheme_send', 'scheme_reread', 'rule_form', 'rule_remove', 'rules_reread'];
/** The surfaces GOV-2c will build (pending). */
export const SURFACES_2C: readonly Gov2Surface[] = ['applications', 'application', 'application_act', 'applications_export', 'applications_reread'];
const PAGES_2B: readonly Gov2Surface[] = ['schemes', 'scheme_identity', 'scheme_rules', 'scheme_versions'];
const CHAINS_2B: readonly Gov2Surface[] = ['scheme_form', 'scheme_send', 'scheme_reread', 'rule_form', 'rule_remove', 'rules_reread'];
const AUTHORING_CHAINS: readonly Gov2Surface[] = ['scheme_form', 'scheme_send', 'rule_form', 'rule_remove'];
const REREAD_CHAINS: readonly Gov2Surface[] = ['scheme_reread', 'rules_reread'];

export const GOV2_REFUSALS: readonly Gov2Refusal[] = Object.freeze([
  // ══ the console chrome on W326–W329 ══
  { id: 'console_chrome_2b', canon: 'W326–W329 "[initials]" avatar · "Search schemes, applications… ⌘K" · the bell', surfaces: PAGES_2B,
    key: 'gov2.refusal.consoleChrome', why: 'DECOR ×4 (FM filter rows): no search, person picker or bell exists' },
  { id: 'benefit_money', canon: 'W326 "[money figure] /ha · cap [n] ha · [n] instalments ([split])" · "[money figure] fixed" · "kit in kind + [money figure]" · W327 inputs "[money] per [area]", "[area] cap"', surfaces: ['schemes', 'scheme_identity', 'scheme_versions'],
    key: 'gov2.refusal.benefitMoney', why: 'Q1-A: no rupee figure; the read (0240 gov_version_public) returns the benefit type and the instalment count only' },
  // ══ W326 ══
  { id: 'awaiting_officer', canon: 'W326 "v[n] live · v[n] draft — awaiting [officer title]"', surfaces: ['schemes', 'scheme_versions'],
    key: 'gov2.refusal.awaitingOfficer', why: 'FALSE: the version is published by a platform operator other than its drafter (0105 ck_scheme_version_maker_ne_checker), never by an officer of the authority' },
  { id: 'legal_requests', canon: 'W326 "Retired schemes stay readable forever: an [information-law] query … deserves the [year] rules, verbatim" · W329 "the same record an [information-law] query or a [court] can request"', surfaces: ['schemes', 'scheme_versions'],
    key: 'gov2.refusal.legalRequests', why: 'LEGAL: no statement about requests under any law; an inactive scheme IS readable here (gov_scheme_read does not filter is_active)' },
  { id: 'other_authorities', canon: 'W326 state "No schemes defined — [central schemes] appear via the platform registry automatically"', surfaces: ['schemes'],
    key: 'gov2.refusal.otherAuthorities', why: 'FALSE: the read returns only schemes whose authority is the session\'s (0240 gov_scheme_read)' },
  { id: 'drafting_role', canon: 'W326 state "Drafting needs the scheme-officer role … request-role path is logged"', surfaces: ['schemes'],
    key: 'gov2.refusal.draftingRole', why: 'FALSE: no gov role drafts (Q5-A; GOV-1 two roles only)' },
  { id: 'window_status', canon: 'W326 "[crop period] · [dates]" / "opens [date] ([crop period])" / "closed [year]" · "Status chips are derived states (is_active + window + draft-version presence)"', surfaces: ['schemes', 'scheme_identity'],
    key: 'gov2.refusal.windowStatus', why: 'F-7: the window is stored, unvalidated, and never read by apply/submit — so "open"/"closed" is not a fact' },
  { id: 'page_count', canon: 'W326 "Showing 1–4 of [n] · Page size 25/50/100 · Page 1 of [n]"', surfaces: ['schemes'],
    key: 'gov2.refusal.pageCount', why: 'the read returns every scheme the authority runs (no LIMIT in gov_scheme_read); no page is cut, so no page count' },
  { id: 'define_scheme_2b', canon: 'W326 "Define a scheme" (header → W327; empty state → W3182)', surfaces: ['schemes', 'scheme_form'],
    key: 'gov2.refusal.define', why: 'Q5-A: authoring is the platform\'s (admin realm, two people); its chain is DECOR' },
  { id: 'page_switch_2b', canon: 'W326–W329 state "Flagged off — [page] disabled … [plan settings]"', surfaces: PAGES_2B,
    key: 'gov2.refusal.pageSwitch', why: 'no per-page switch exists; the console\'s own switch (gov_console) is stated when it is off' },
  // ══ W327 ══
  { id: 'authoring_form', canon: 'W327 the whole form — "Editing as a NEW draft version (v[n]) … nothing here touches the live v[n] until publish · drafted by [person]" · inputs name, code, category, benefit type, instalments, window, region', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.authoringForm', why: 'Q5-A: the published version is READ; the draft plane is the admin realm\'s' },
  { id: 'currency', canon: 'W327 "Stored in minor units with currency [code] — the [figure] a farmer sees is this [figure], formatted per their language\'s number system"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.currency', why: 'FALSE: benefit_summary carries no currency (0011); Q1-A prints no money figure' },
  { id: 'translation_desk', canon: 'W327 "Scheme name (English — [n] more languages via the translation desk)"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.translationDesk', why: 'the read returns default_name only; translations unverified (survey "did not open")' },
  { id: 'document_checks', canon: 'W327 Required documents "[land extract] · [identity number] (masked capture) · bank passbook / [bank account check]"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.documentChecks', why: 'the read returns document TYPES by name; no masked capture or bank check exists on an application' },
  { id: 'closing_time', canon: 'W327 "Closes at 23:59 [zone] on the closing day … [n]h [extra time] … part of the published rules"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.closingTime', why: 'F-7: the window is not enforced; no time-zone literal (Rule Zero)' },
  { id: 'region_pilots', canon: 'W327 "Region scoping uses the admin-regions tree; [sub-district]-level pilots"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.regionPilots', why: 'F-7: applicable_region_ids is stored and never read by apply/submit' },
  { id: 'farmer_card', canon: 'W327 card "How a farmer will see this" ("[plain-language promise]")', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.farmerCard', why: 'no plain-language card exists in any table' },
  { id: 'instalment_split', canon: 'W327 "([n] on approval, [n] on installation verification)"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.instalmentSplit', why: 'FALSE: no split field and no installation step exist; the instalment COUNT is printed' },
  { id: 'kept_locally', canon: 'W327 state "Draft not saved — kept locally on this console"', surfaces: ['scheme_identity'],
    key: 'gov2.refusal.keptLocally', why: 'nothing is written from this console, so nothing is kept' },
  // ══ W328 ══
  { id: 'land_range_record', canon: 'W328 "Land holding between [min] and [max] [area unit] (from linked [land extract] record)"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.landRangeRecord', why: 'F-6: landholding_max_acres only — a maximum, in acres; no minimum; no land-registry link' },
  { id: 'residence_water', canon: 'W328 "Resident state [state] (from profile / region tree)" · "Water source declared … (from application form + doc)"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.residenceWater', why: 'F-6: neither is an evaluator field' },
  { id: 'tiers_group', canon: 'W328 OR tiers "[small/marginal] → [farmer\'s share] [n] · [social-group] certificate on file → [n] · others [n]"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.tiersGroup', why: 'F-6 / PII: no tiers, no cost share, no social-group field — and none is printed (Q3)' },
  { id: 'auto_checker', canon: 'W328 "Rules compile … what the [automatic pre-checker] runs is EXACTLY what you built"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.autoChecker', why: 'F-5: eligibility_check is never written; the evaluator is not run at apply or submit' },
  { id: 'trial_run', canon: 'W328 trial run "~[n] farmers would qualify · [share] … [sub-districts]" + "aggregate-only … logged" · W329 gate "Dry run completed ([n] …)"', surfaces: ['scheme_rules', 'scheme_versions'],
    key: 'gov2.refusal.trialRun', why: 'F-13: the cohort run is the platform\'s (admin realm), over the live population; not the authority\'s read' },
  { id: 'margin_comments', canon: 'W328 state "View-only — comments land in the draft\'s margin"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.marginComments', why: 'no comment object exists on a scheme' },
  { id: 'rules_pay', canon: 'W328 state "No rules yet — A scheme with no rules pays everyone…" · "Dry run failed … publishing stays blocked"', surfaces: ['scheme_rules'],
    key: 'gov2.refusal.rulesPay', why: 'the evaluator only says eligible or not (with reasons); it pays nothing; no publish gate is claimed' },
  // ══ W329 ══
  { id: 'named_approver', canon: 'W329 "Drafted by [person] ([officer title]) · publish requires the [senior officer] — the drafter can never be the approver" · "sent to [person], due within [n] working days"', surfaces: ['scheme_versions'],
    key: 'gov2.refusal.namedApprover', why: 'the read returns no operator id (0240) and no due date exists; the second-person FACT is printed from the read' },
  { id: 'reading_level', canon: 'W329 gate "Plain-language card reads at grade-[n] level in [languages]"', surfaces: ['scheme_versions'],
    key: 'gov2.refusal.readingLevel', why: 'no readability check exists' },
  { id: 'spending_gate', canon: 'W329 gate "[budget line] … [sanctioned money figure] … [projected money figure] … FAILS red if projection exceeds [the limit]"', surfaces: ['scheme_versions'],
    key: 'gov2.refusal.spendingGate', why: 'F-12 / MONEY: no budget, sanction or projection exists in any table' },
  { id: 'diff_money', canon: 'W329 "What changes — the whole diff" ([money figure] → [money figure], [cost share], [document] removed, "one office trip less")', surfaces: ['scheme_versions'],
    key: 'gov2.refusal.diffMoney', why: 'the diff is 0240 gov_scheme_version_diff over the public fields only — no money figure' },
  { id: 'pinned_count', canon: 'W329 "Version rule (PRD R18): applications are pinned … [n] [crop period] applications stay judged by v[n]"', surfaces: ['scheme_versions'],
    key: 'gov2.refusal.pinnedCount', why: 'the pin is TRUE (printed); no per-version count is read here' },
  // ══ the chains' shared sentences (W3172–W3178, W3182–W3188) — refused BY NAME ══
  { id: 'chain_money_2b', canon: 'W3174 / W3177 / W3184 / W3187 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: CHAINS_2B,
    key: 'gov2.refusal.chainMoney', why: 'no money moves when a scheme is read' },
  { id: 'chain_paging_2b', canon: 'W3175 / W3178 / W3185 / W3188 "repeated failures page the [duty person]"', surfaces: CHAINS_2B,
    key: 'gov2.refusal.chainPaging', why: 'no paging exists' },
  { id: 'chain_record_view_2b', canon: 'W3174 / W3177 / W3184 / W3187 "View [the record]" · "the [record] has the entry (actor · time · reason · before/after)"', surfaces: AUTHORING_CHAINS,
    key: 'gov2.refusal.chainRecordView', why: 'nothing is written from these chains, so there is no entry to view' },
  { id: 'chain_review_step', canon: 'W3173 / W3183 "[two-person]-friendly review step: everything you entered, shown read-only, with the diff against current values"', surfaces: ['scheme_form', 'rule_form'],
    key: 'gov2.refusal.chainReviewStep', why: 'DECOR: nothing is entered here; the two-person step is the admin realm\'s publish' },
  { id: 'chain_back_confirm', canon: 'W3175 / W3185 "Retry — back to confirm" · W3182 / W3183 "Back to the form" / "Back to edit" → W326', surfaces: ['scheme_form', 'rule_form'],
    key: 'gov2.refusal.chainBackConfirm', why: 'canon defect (survey §1): a form chain has no confirm; Back returns to the page that opened it' },
  { id: 'reread_writes_2b', canon: 'W3176 / W3186 "confirming writes an [record] entry with actor, time and reason" (opened by "Retry")', surfaces: REREAD_CHAINS,
    key: 'gov2.refusal.rereadWrites', why: 'reading the page again writes nothing' },
]);
export function gov2RefusalKeys(surface: Gov2Surface): string[] { return GOV2_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const GOV2_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'schemes_route', canon: 'GOV-1a 307 `/schemes` → `/dashboard` (next.config.js; GOV1 delta old_pages)', built: 'GOV-2b removes the /schemes redirect and builds /schemes for the AUTHORITY (gov realm); /registers, /verification, /mgnrega still 307 until their waves' },
  { id: 'nav_schemes', canon: 'canon sidebar "Scheme registry" (W326) and "Define a scheme" (W327)', built: 'GOV_NAV gains "Schemes" (/schemes); "Define a scheme" is NOT a nav link — it is refused BY NAME on the list (Q5-A)' },
  { id: 'tabs', canon: 'W327 → W328 → W329 as a three-step stepper "1 · Identity & benefit · 2 · Eligibility · 3 · Review & publish"', built: 'E1: one read page per scheme, /schemes/[id]?tab=identity|rules|versions; no step order (nothing is authored)' },
  { id: 'q5_sentence', canon: 'brief §D Q5-A page words "Schemes are written by the platform\'s team, not from this console. Each version is drafted by one person and published by another."', built: 'printed verbatim on the list, every tab and every chain. Clause 2 is proved for every version the publish plane records (0105 ck_scheme_version_maker / _published / _maker_ne_checker); a BACKFILLED version names no publisher, and its row says "not recorded" from the read' },
  { id: 'q1_no_money', canon: 'W326 / W327 / W329 benefit figures', built: 'Q1-A: the benefit type and the instalment count, as the read returns them; no money figure, no currency, no split' },
  { id: 'rules_words', canon: 'W328 rule rows (land range, residence, water source, tiers)', built: 'E6: the evaluator\'s five fields in words (features/gov2/rules-format.ts): roles, land held at most N acres (as stored, never converted), gender, minimum / maximum age; a stored condition the evaluator does not read is named as not applied' },
  { id: 'versions_tab', canon: 'W329 "Review & publish" with gates and "Send for approval"', built: 'the scheme\'s version history (gov.schemes.versions) and, for one version, the read\'s diff against the version below (gov.schemes.diff); "Send for approval" / "Start a draft" refused BY NAME' },
  { id: 'chain_back', canon: 'W3182 / W3183 / W3185 Back / Retry → W326 (the list)', built: 'chain2Back: a chain opened on a scheme returns to THAT scheme\'s tab; the list\'s "Define a scheme" chain returns to /schemes' },
  { id: 'retry_reread', canon: 'load-error "Retry" on W326–W329 → the mutate-confirm pages W3186 / W3176', built: 'the error state\'s Retry opens the re-read chain (`?do=reread&act=confirm`); its one link IS the re-read; nothing is written' },
]);

/** The verdict values (`pending_2c` until GOV-2c decides its 10 files — the 4c-7 rule). */
export type Gov2Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_2c';
export type Gov2Wave = '2b' | '2c';
/** Every canon file of GOV-2 (28), each with ONE verdict: 2b decides its 18; 2c's 10 are pending. */
export const GOV2_CANON_FILES: readonly { file: string; wave: Gov2Wave; verdict: Gov2Verdict; note: string }[] = Object.freeze([
  // ── 2b · THE AUTHORITY'S SCHEMES (18) — decided (Q1-A, Q5-A lead-applied) ──
  { file: 'W326-gov-schemes.html', wave: '2b', verdict: 'BUILT (read)', note: '/schemes — gov.schemes.list: name, code, category, benefit type, instalments, active / inactive, published version, the newer-draft fact; rows → /schemes/[id]; Q5-A verbatim; no money figure; "Define a scheme" refused BY NAME' },
  { file: 'W327-gov-scheme-definition.html', wave: '2b', verdict: 'BUILT (honest)', note: '/schemes/[id]?tab=identity — the published version read only (window and regions "as written", not enforced); the authoring form refused BY NAME' },
  { file: 'W328-gov-eligibility-builder.html', wave: '2b', verdict: 'BUILT (honest)', note: '/schemes/[id]?tab=rules — the five evaluator fields in words, acres as stored; the builder refused BY NAME' },
  { file: 'W329-gov-scheme-review.html', wave: '2b', verdict: 'BUILT (read)', note: '/schemes/[id]?tab=versions — gov.schemes.versions + diff: number, status, published when, the second-person fact as read; "Send for approval" / "Start a draft" refused BY NAME' },
  { file: 'W3172-gov-eligibility-form-form-error.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=rule&act=form-error — adding a rule refused BY NAME; Back → the scheme\'s rules' },
  { file: 'W3173-gov-eligibility-form-review.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=rule&act=review — the rules tab\'s "+ Add a rule" / "Add a rule" / "Save draft" open this state' },
  { file: 'W3174-gov-eligibility-form-success.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=rule&act=success — nothing was saved' },
  { file: 'W3175-gov-eligibility-form-failure.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=rule&act=failure — nothing was sent; Back → the scheme\'s rules (never a confirm step)' },
  { file: 'W3176-gov-eligibility-mutate-confirm.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=remove&act=confirm — "Remove" refused BY NAME; from the rules tab\'s error Retry (`do=reread`): PARITY-DECOR, the link IS a re-read' },
  { file: 'W3177-gov-eligibility-mutate-success.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=remove&act=success — nothing was removed' },
  { file: 'W3178-gov-eligibility-mutate-failure.html', wave: '2b', verdict: 'DECOR', note: '?tab=rules&do=remove&act=failure — nothing was sent; Back → the scheme\'s rules' },
  { file: 'W3182-gov-scheme-form-form-error.html', wave: '2b', verdict: 'DECOR', note: '?do=scheme&act=form-error (or ?do=define on /schemes) — refused BY NAME; Back → the scheme (the canon\'s → W326 defect not copied)' },
  { file: 'W3183-gov-scheme-form-review.html', wave: '2b', verdict: 'DECOR', note: '?do=scheme&act=review — "Define a scheme", "+ Add" ×2, "Save draft", "Start a draft" open this state' },
  { file: 'W3184-gov-scheme-form-success.html', wave: '2b', verdict: 'DECOR', note: '?do=scheme&act=success — no scheme was created or changed' },
  { file: 'W3185-gov-scheme-form-failure.html', wave: '2b', verdict: 'DECOR', note: '?do=scheme&act=failure — nothing was sent; Back → the scheme (never a confirm step)' },
  { file: 'W3186-gov-scheme-mutate-confirm.html', wave: '2b', verdict: 'DECOR', note: '?do=send&act=confirm — "Copy an existing scheme", "Send for approval" refused BY NAME; from an error Retry (`do=reread`): PARITY-DECOR, the link IS a re-read' },
  { file: 'W3187-gov-scheme-mutate-success.html', wave: '2b', verdict: 'DECOR', note: '?do=send&act=success — nothing was copied or sent' },
  { file: 'W3188-gov-scheme-mutate-failure.html', wave: '2b', verdict: 'DECOR', note: '?do=send&act=failure — nothing was sent; Back → the scheme' },
  // ── 2c · APPLICATIONS (10) — pending GOV-2c ──
  { file: 'W330-gov-applications.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W331-gov-application-detail.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3159-gov-application-mutate-confirm.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3160-gov-application-mutate-success.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3161-gov-application-mutate-failure.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3162-gov-applications-export-queued.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3163-gov-applications-export-ready.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3164-gov-applications-mutate-confirm.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3165-gov-applications-mutate-success.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
  { file: 'W3166-gov-applications-mutate-failure.html', wave: '2c', verdict: 'pending_2c', note: 'GOV-2c' },
]);

/** The seven canon chain groups (survey §1G–§1N, 22 files, each exactly once) and the wave that owns each. */
export const GOV2_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov2Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'application_mutate', donor: 'W331', wave: '2c', files: ['W3159', 'W3160', 'W3161'] },
  { id: 'applications_export', donor: 'W330', wave: '2c', files: ['W3162', 'W3163'] },
  { id: 'applications_mutate', donor: 'W330', wave: '2c', files: ['W3164', 'W3165', 'W3166'] },
  { id: 'eligibility_form', donor: 'W328', wave: '2b', files: ['W3172', 'W3173', 'W3174', 'W3175'] },
  { id: 'eligibility_mutate', donor: 'W328', wave: '2b', files: ['W3176', 'W3177', 'W3178'] },
  { id: 'scheme_form', donor: 'W326/W327/W329', wave: '2b', files: ['W3182', 'W3183', 'W3184', 'W3185'] },
  { id: 'scheme_mutate', donor: 'W326/W327/W329', wave: '2b', files: ['W3186', 'W3187', 'W3188'] },
]);

// ── THE BUILT CHAINS (GOV-2b): each is a query state (`?do=…&act=`) of the page that opened it. The two mutate groups are built TWICE, by
// their two kinds of opener: the authoring act (DECOR — refused BY NAME) and the error state's Retry (PARITY-DECOR — a re-read). ──
export type Chain2Id = 'scheme_form' | 'scheme_send' | 'scheme_reread' | 'rule_form' | 'rule_remove' | 'rules_reread';
export interface Chain2Def {
  id: Chain2Id; wave: Gov2Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov2Surface; states: readonly string[];
  /** The `do=` value that opens it. */
  doing: string;
  /** The tab a chain opened on a scheme returns to when the opener named none. */
  tab: SchemeTab;
  key: (state: string) => string; statement: string; rereadKey: string;
}
export type SchemeTab = 'identity' | 'rules' | 'versions';
export const SCHEME_TABS: readonly SchemeTab[] = Object.freeze(['identity', 'rules', 'versions']);
const FORM_STATES = ['form-error', 'review', 'success', 'failure'] as const;
const MUTATE_STATES = ['confirm', 'success', 'failure'] as const;
export const GOV2_CHAINS: readonly Chain2Def[] = Object.freeze([
  { id: 'scheme_form', wave: '2b', kind: 'DECOR', group: 'scheme_form', surface: 'scheme_form', states: FORM_STATES, doing: 'scheme', tab: 'identity',
    key: (s: string) => `gov2.chain.schemeForm.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
  { id: 'scheme_send', wave: '2b', kind: 'DECOR', group: 'scheme_mutate', surface: 'scheme_send', states: MUTATE_STATES, doing: 'send', tab: 'identity',
    key: (s: string) => `gov2.chain.schemeSend.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
  { id: 'scheme_reread', wave: '2b', kind: 'PARITY-DECOR', group: 'scheme_mutate', surface: 'scheme_reread', states: MUTATE_STATES, doing: 'reread', tab: 'identity',
    key: (s: string) => `gov2.chain.schemeReread.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
  { id: 'rule_form', wave: '2b', kind: 'DECOR', group: 'eligibility_form', surface: 'rule_form', states: FORM_STATES, doing: 'rule', tab: 'rules',
    key: (s: string) => `gov2.chain.ruleForm.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
  { id: 'rule_remove', wave: '2b', kind: 'DECOR', group: 'eligibility_mutate', surface: 'rule_remove', states: MUTATE_STATES, doing: 'remove', tab: 'rules',
    key: (s: string) => `gov2.chain.ruleRemove.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
  { id: 'rules_reread', wave: '2b', kind: 'PARITY-DECOR', group: 'eligibility_mutate', surface: 'rules_reread', states: MUTATE_STATES, doing: 'reread', tab: 'rules',
    key: (s: string) => `gov2.chain.rulesReread.${s}`, statement: 'gov2.q5', rereadKey: 'gov2.chain.reread' },
]);
export function chain2ById(id: Chain2Id): Chain2Def { return GOV2_CHAINS.find((c) => c.id === id) as Chain2Def; }

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSchemeId = (id: string | null | undefined): id is string => typeof id === 'string' && UUID.test(id);

/** The tab a scheme page shows (`?tab=`), identity when absent or unknown. */
export function schemeTab(searchParams: Params): SchemeTab {
  const v = one(searchParams?.tab);
  return (SCHEME_TABS as readonly string[]).includes(v ?? '') ? (v as SchemeTab) : 'identity';
}
/** Which chain a query opens. On the LIST (`onScheme` false): `do=define` → the scheme form, `do=reread` → the scheme re-read. On a SCHEME:
 *  `do=scheme` → the scheme form, `do=send` → the scheme send, `do=rule` → the rule form, `do=remove` → the rule removal, `do=reread` → the
 *  rules re-read on the rules tab and the scheme re-read on the others. Anything else → null (the page itself). */
export function chain2For(searchParams: Params, onScheme: boolean): Chain2Id | null {
  const d = one(searchParams?.do);
  if (!onScheme) return d === 'define' ? 'scheme_form' : d === 'reread' ? 'scheme_reread' : null;
  if (d === 'scheme') return 'scheme_form';
  if (d === 'send') return 'scheme_send';
  if (d === 'rule') return 'rule_form';
  if (d === 'remove') return 'rule_remove';
  if (d === 'reread') return schemeTab(searchParams) === 'rules' ? 'rules_reread' : 'scheme_reread';
  return null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain2State(id: Chain2Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain2ById(id).states.includes(v) ? v : null;
}
/** Where a chain state's Back goes — ONE place: a chain opened on a scheme returns to THAT scheme's tab (the tab it was opened on, else the
 *  chain's own); the list's chains (and a malformed scheme id) return to /schemes. Never a confirm step. */
export function chain2Back(id: Chain2Id, schemeId: string | null, tab?: SchemeTab | null): string {
  if (!isSchemeId(schemeId)) return '/schemes';
  const c = chain2ById(id);
  const to = c.tab === 'rules' ? 'rules' : (tab ?? c.tab);
  return `/schemes/${schemeId}?tab=${to}`;
}
/** The address that opens a chain state from a page. */
export function chain2Href(id: Chain2Id, state: string, schemeId: string | null, tab?: SchemeTab): string {
  const c = chain2ById(id);
  if (!isSchemeId(schemeId)) return `/schemes?do=${id === 'scheme_form' ? 'define' : c.doing}&act=${state}`;
  return `/schemes/${schemeId}?tab=${c.tab === 'rules' ? 'rules' : (tab ?? c.tab)}&do=${c.doing}&act=${state}`;
}
