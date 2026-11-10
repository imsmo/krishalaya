// apps/web-gov/src/features/gov1/refusals.ts · PC-56 GOV-1 — WHAT THE SIGN-IN, ACCESS, DASHBOARD AND CHROME PAGES DO NOT CLAIM, BY NAME. PURE.
// The web-ops `features/ops5/refusals.ts` shape (survey_gov1.md E5): each refused canon claim is listed ONCE with where the canon makes it
// (persons, places, bodies and figures anonymised) and the surfaces that PRINT it (a sentence that says no — never an offer, and never the
// canon's own words); the render tests read this map, and the claims guard (test/claims-guard.spec.ts, the `gov1.` scope) keeps the canon's
// false words out of every `gov1.` value.
//
// GOV-1 is HOTFIX-15 → GOV-0 → two screen waves (survey §4; Q2-A, Q4-A, Q5-A applied by the lead under the founder's instruction of 2026-11-10
// "please choose recommended option and start at your end next step … think as you are product owner" — his to reopen): 1a → 1b. This
// registry carries ALL 21 canon files. GOV-1a decides its 9; GOV-1b's 12 are `pending_1b` until it builds them (then that value is deleted).
//
// GOV-1a · SIGNING IN AND WHO MAY builds:
//   • `login` (W355, `/login`) — the gov realm only (`client.gov.auth.*`, never the organisation sign-in): phone → code → (the chooser when
//     the phone holds a role in several authorities) → the authenticator code; no confirmed authenticator → the set-up step (the secret and
//     its otpauth address as the API gives them, a code to confirm, the recovery codes once, then sign in again). Q5-A's sentence printed
//     only in its TRUE half (a refused sign-in for a phone with no role is not recorded — GOV-0 `gov-auth.service.ts` `verify`).
//   • `login_form` (W3229–W3232, `?act=` on /login) — form-error REAL (wrong / expired code with the tries left; a wrong authenticator code),
//     review DECOR (a sign-in has no review step), success REAL (signed in to the authority), failure REAL (locked with the wait, no role,
//     the step expired, not a government session); Back → /login always (the canon's links to W325 are a defect).
//   • `access` (W359, `/access`) — a READ of the authority's people as GOV-0 gives them (name, or the phone by its last 3; role; who asked;
//     who approved; when it ends; status) to the authority's own members; Q4-A's sentence; approve offered only to a head who is neither the
//     requester nor the grantee; remove offered to a head, never on their own row, with a reason, at once; the lone-head fact.
//   • `access_act` (W3198–W3200, `?act=` on /access) — REAL: request a role / approve / remove — confirm, the server's answer, the named refusal.
//   • `access_reread` (the same W3198–W3200 files, opened by the error state's "Retry") — PARITY-DECOR: a re-read; Back → /access.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov1Surface =
  // the four pages
  | 'login' | 'dashboard' | 'chrome_canon' | 'access'
  // the chains
  | 'login_form' | 'dashboard_form' | 'dashboard_act' | 'chrome_act' | 'access_act' | 'access_reread';
export interface Gov1Refusal { id: string; canon: string; surfaces: readonly Gov1Surface[]; key: string; why: string }

/** The surfaces GOV-1a builds. */
export const SURFACES_1A: readonly Gov1Surface[] = ['login', 'login_form', 'access', 'access_act', 'access_reread'];
/** The surfaces GOV-1b builds (pending until it does). */
export const SURFACES_1B: readonly Gov1Surface[] = ['dashboard', 'dashboard_form', 'dashboard_act', 'chrome_canon', 'chrome_act'];
const CHAINS_1A: readonly Gov1Surface[] = ['login_form', 'access_act', 'access_reread'];

export const GOV1_REFUSALS: readonly Gov1Refusal[] = Object.freeze([
  // ══ W355 and the auth shell ══
  { id: 'other_sign_in', canon: 'W355 button "Sign in with government [single sign-on] ([state portal] / [department])" · "[single sign-on] integration is the launch path …; your identity, role and department arrive from the assertion"', surfaces: ['login'],
    key: 'gov1.refusal.otherSignIn', why: 'FALSE (survey §1A, GOV1-B11): no such sign-in exists; GOV-0 has no such route (Q5-A)' },
  { id: 'official_id', canon: 'W355 "[department] credentials (fallback, being retired)" · input "Official ID"', surfaces: ['login'],
    key: 'gov1.refusal.officialId', why: 'FALSE: no staff identifier exists; the phone identifies the person' },
  { id: 'step_up_key', canon: 'W355 "Step-up rule: viewing needs sign-in; [releasing money] (FTO sign-off, batch release) additionally needs your [hardware key]"', surfaces: ['login'],
    key: 'gov1.refusal.noPayment', why: 'FALSE: no money is released and no extra key exists in the gov realm (Q1-A, Q5-A)' },
  { id: 'sign_in_record', canon: 'W355 "Every sign-in — successful or not — is recorded with device and origin."', surfaces: ['login'],
    key: 'gov1.refusal.signInRecord', why: 'PARTLY FALSE: wrong codes and completed sign-ins are written to login_events with the network address; no device is sent; a phone refused for holding no role is NOT recorded (gov-auth.service.ts verify)' },
  { id: 'auth_shell_identity', canon: 'auth shell "[emblem slot] · [directorate], [state] · on Krishalaya Gov · GOV"', surfaces: ['login', 'login_form'],
    key: 'gov1.refusal.authShell', why: 'FALSE before sign-in: the console does not know the authority until the person signs in; no emblem is ever shown (W358 rule)' },
  { id: 'helpdesk', canon: 'auth shell "helpdesk for officials: [mailbox]"', surfaces: ['login', 'login_form'],
    key: 'gov1.refusal.helpdesk', why: 'FALSE: no such mailbox exists (survey E11; PARTNER-1a Q3 precedent)' },
  // ══ the login chain (W3229–W3232) ══
  { id: 'login_review', canon: 'W3230 "review" state of the sign-in form', surfaces: ['login_form'],
    key: 'gov1.refusal.loginReview', why: 'DECOR: a sign-in has no review step' },
  // ══ W359 ══
  { id: 'review_date', canon: 'W359 "every role and every external grant carries an expiry, an approver, and a review date. Renewal is a decision, not a default."', surfaces: ['access'],
    key: 'gov1.refusal.reviewDate', why: 'PARTLY FALSE: an end date and a second person are kept (0239); no review date and no renewal step exist' },
  { id: 'role_duties', canon: 'W359 roles "scheme officer (draft rules, never approve)" · "finance officer (prepare batches, never release)" · "field officer · beat [n] (capture visits, own beat only)"', surfaces: ['access', 'access_act'],
    key: 'gov1.refusal.roleDuties', why: 'FALSE (GOV1-B8): two roles exist — authority_head, authority_officer; duties are not split' },
  { id: 'recheck', canon: 'W359 "re-check ordered ([screen]) role unchanged while coaching runs; suspension would need the supervisor + one level up"', surfaces: ['access'],
    key: 'gov1.refusal.recheck', why: 'FALSE: no re-check, coaching, suspension or hierarchy exists' },
  { id: 'external_grants', canon: 'W359 table "External grants ([outside bodies]) — DELTA-042": [bank body], [insurance body] ("… [n] extracts this period"), [state audit office] "half-signed = no access; both-signatures-or-neither"', surfaces: ['access'],
    key: 'gov1.refusal.externalGrants', why: 'FALSE: no external grant object exists; no outside body is a user of this console' },
  { id: 'late_mark', canon: 'W359 "A grant renewed in the last week … [late] mark forever"', surfaces: ['access'],
    key: 'gov1.refusal.lateMark', why: 'FALSE: no such mark exists' },
  { id: 'stored_grants', canon: 'W359 state "Couldn\'t load grants — Active sessions continue under their stored grants … Retry"', surfaces: ['access', 'access_reread'],
    key: 'gov1.refusal.storedGrants', why: 'FALSE: a removal ends the person\'s gov sessions in the same transaction when no live role remains (gov-members.service.ts remove); a refresh re-reads the membership' },
  { id: 'two_to_remove', canon: 'W359 state "Granting is [two-key] — … revoking needs two people — the same bar as granting."', surfaces: ['access', 'access_act'],
    key: 'gov1.refusal.twoToRemove', why: 'Q4-A: removal is ONE head, at once, recorded; granting needs a second person' },
  { id: 'head_grants_rest', canon: 'W359 state "No roles granted — A new authority starts with exactly one account — the authority head, who grants the rest."', surfaces: ['access'],
    key: 'gov1.refusal.headGrantsRest', why: 'PARTLY FALSE: the platform appoints the first head; a head cannot approve a request they made, so a lone head cannot add anyone alone (GOV-0 founder question)' },
  { id: 'console_chrome', canon: 'console chrome "[directorate] · GOV · [state] · state authority" · "Search schemes, applications… ⌘K" · "[initials]" · the bell', surfaces: ['access'],
    key: 'gov1.refusal.consoleChrome', why: 'DECOR — no search, person picker or bell exists; the authority\'s name comes from GOV-0 (Q2-A)' },
  // ══ the chains' shared sentences (W3198–W3200, W3229–W3232) — refused BY NAME ══
  { id: 'chain_money', canon: 'W3199 / W3231 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: CHAINS_1A,
    key: 'gov1.refusal.chainMoney', why: 'no money moves in a sign-in, a role request or a re-read' },
  { id: 'chain_paging', canon: 'W3200 / W3232 "repeated failures page the [duty person]"', surfaces: CHAINS_1A,
    key: 'gov1.refusal.chainPaging', why: 'no paging exists' },
  { id: 'chain_record_view', canon: 'W3198–W3200, W3229–W3232 "View [the record]" · "the [record] has the entry (actor · time · reason · before/after)"', surfaces: ['login_form', 'access_act'],
    key: 'gov1.refusal.chainRecordView', why: 'every role act IS recorded (gov-members.service.ts audit rows), every completed sign-in and wrong code is in login_events — but no record viewer exists on this console' },
  { id: 'reread_writes', canon: 'W3198 "confirming writes an [record] entry with actor, time and reason" (opened by "Retry")', surfaces: ['access_reread'],
    key: 'gov1.refusal.rereadWrites', why: 'reading the list again writes nothing' },
]);
export function gov1RefusalKeys(surface: Gov1Surface): string[] { return GOV1_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const GOV1_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'gov_realm', canon: 'C-1 "gov-persona scoped tokens" (README, package.json, layout) — before GOV-0 a phone was signed into ONE organisation', built: 'Q2-A: the console signs into an AUTHORITY through `/v1/gov/auth/*` only; the organisation sign-in, the tenant id and the tenant SDK are gone from web-gov' },
  { id: 'persona_gate', canon: 'survey C-3 / F-4: the sidebar was drawn whenever a session cookie existed', built: 'E2: `requireGov()` — no token → /login; a token that is not a gov session → cleared, the NOT_A_GOVERNMENT_ACCOUNT door; the sidebar is drawn only after the API answers `GET /v1/gov/me`' },
  { id: 'second_factor', canon: 'W355 (not canon) — the TOTP step was missing (survey §1A)', built: 'Q5-A: the authenticator code on every account; the set-up step for an account without one (GOV_TWO_FACTOR_REQUIRED → enrol → confirm → sign in again)' },
  { id: 'otp_digits', canon: 'W355 "OTP to registered official phone" · 6-digit', built: 'the code field takes what the API accepts (4–8 digits); the authenticator field 6 digits' },
  { id: 'enrol_qr', canon: 'brief §D Q5-A "show the secret/QR the API gives"', built: 'the API gives the secret and its otpauth address (no image); both are printed as text and the address is a link an authenticator app on the same phone can open. No QR image is drawn (no library; none added)' },
  { id: 'q5_half', canon: 'brief §D Q5-A page words "… Every sign-in, successful or not, is recorded with the time and the network address it came from."', built: 'the second sentence is NOT printed: a sign-in refused because the phone holds no role (GOV_ACCESS_NONE after a correct code) writes no login_events row. Only the first sentence is printed; the refusal list states what is and is not recorded' },
  { id: 'login_chain_back', canon: 'W3230 / W3232 link to W325 (survey §1 canon defects)', built: 'every login chain state links Back to /login' },
  { id: 'access_route', canon: 'W359 is in no sidebar (survey §1D)', built: '"Access" joins the sidebar (E1)' },
  { id: 'access_people', canon: 'W359 "Official · Role · Granted by · Expires · Status"', built: 'name (or the phone by its last 3 when no name is held) · role · asked by · approved by · ends · status, as GOV-0\'s list gives them; "asked by" and "approved by" resolved to a name only from the same list (the platform\'s appointment of a first head said so); request and removal reasons are not printed' },
  { id: 'first_head_fact', canon: 'brief §D Q4-A page words "A role is granted only when a second person approves it"', built: 'printed verbatim AND beside it the fact the code proves: an authority\'s first head is appointed by the platform (admin realm, 0239 239.3)' },
  { id: 'old_pages', canon: 'the pre-canon GW-1…GW-5 pages (`/schemes`, `/registers`, `/verification`, `/mgnrega`) read an ORGANISATION through the tenant sign-in', built: 'they cannot work under a gov session: 307 → /dashboard (next.config.js, permanent: false) and their pages, actions and the evidence route deleted; /dashboard is gated and says in one sentence that it is being rebuilt for authorities and reads nothing (GOV-1b owns W325)' },
  { id: 'fm_chain_ids', canon: 'FM :177, :193-194 chain targets W1743–W1746, W1761–W1766 (survey C-9)', built: 'those files do not exist; the real chains are W3229–W3232 and W3198–W3200' },
]);

/** The verdict values. `pending_1b` is deleted when GOV-1b decides its 12 (the 4c-7 rule). */
export type Gov1Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_1b';
export type Gov1Wave = '1a' | '1b';
/** Every canon file of GOV-1 (21), each with ONE verdict: 1a decides its 9; 1b's 12 are pending. */
export const GOV1_CANON_FILES: readonly { file: string; wave: Gov1Wave; verdict: Gov1Verdict; note: string }[] = Object.freeze([
  // ── 1a · SIGNING IN AND WHO MAY (9) — decided (Q2-A, Q4-A, Q5-A lead-applied) ──
  { file: 'W355-gov-login.html', wave: '1a', verdict: 'BUILT (honest)', note: '/login — the gov realm only: phone → code → chooser → authenticator code; the set-up step; every named refusal x3; Q5-A\'s true half; the other sign-in ways, staff identifier, extra key, helpdesk refused BY NAME' },
  { file: 'W3229-gov-login-form-form-error.html', wave: '1a', verdict: 'REAL', note: '?act=form-error — a wrong code with the tries left, an expired code, a wrong authenticator code; the form again; Back → /login' },
  { file: 'W3230-gov-login-form-review.html', wave: '1a', verdict: 'DECOR', note: '?act=review — a sign-in has no review step (refused BY NAME); Back → /login' },
  { file: 'W3231-gov-login-form-success.html', wave: '1a', verdict: 'REAL', note: '?act=success — signed in to the authority the API names; the console link; Back → /login' },
  { file: 'W3232-gov-login-form-failure.html', wave: '1a', verdict: 'REAL', note: '?act=failure — locked with the wait, no role, a step expired, not a government session, too many attempts; Back → /login' },
  { file: 'W359-gov-access-grants.html', wave: '1a', verdict: 'REAL', note: '/access — the authority\'s people as GOV-0 gives them, to its own members; Q4-A verbatim + the first-head fact; approve only for a head who neither asked nor would hold it; remove only for a head, not on their own row; the lone-head fact; "Request a role" REAL' },
  { file: 'W3198-gov-access-mutate-confirm.html', wave: '1a', verdict: 'REAL', note: '?act=confirm — the request form (phone, role, 1–12 months, reason), the approval, or the removal with its reason, a key minted when shown; from the error state\'s Retry: PARITY-DECOR, the link IS a re-read' },
  { file: 'W3199-gov-access-mutate-success.html', wave: '1a', verdict: 'REAL', note: '?act=success — what the SERVER did: requested (waiting for a second person), approved (with the end date), removed (sessions ended)' },
  { file: 'W3200-gov-access-mutate-failure.html', wave: '1a', verdict: 'REAL', note: '?act=failure — the named refusal (GOV_APPROVER_IS_REQUESTER, GOV_PERSON_UNKNOWN, GOV_ALREADY_REQUESTED, …); nothing changed; Back → /access' },
  // ── 1b · THE DESK AND ITS CHROME (12) — pending ──
  { file: 'W325-gov-dashboard.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b: the overview read (B5); until then /dashboard says it is being rebuilt and reads nothing' },
  { file: 'W358-gov-chrome-canon.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3214-gov-chrome-mutate-confirm.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3215-gov-chrome-mutate-success.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3216-gov-chrome-mutate-failure.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3217-gov-dashboard-form-form-error.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3218-gov-dashboard-form-review.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3219-gov-dashboard-form-success.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3220-gov-dashboard-form-failure.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3221-gov-dashboard-mutate-confirm.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3222-gov-dashboard-mutate-success.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
  { file: 'W3223-gov-dashboard-mutate-failure.html', wave: '1b', verdict: 'pending_1b', note: 'GOV-1b' },
]);

/** The five canon chain groups (survey §1E–§1J, 17 files, each exactly once) and the wave that owns each. */
export const GOV1_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov1Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'access_mutate', donor: 'W359', wave: '1a', files: ['W3198', 'W3199', 'W3200'] },
  { id: 'login_form', donor: 'W355', wave: '1a', files: ['W3229', 'W3230', 'W3231', 'W3232'] },
  { id: 'chrome_mutate', donor: 'W358', wave: '1b', files: ['W3214', 'W3215', 'W3216'] },
  { id: 'dashboard_form', donor: 'W325', wave: '1b', files: ['W3217', 'W3218', 'W3219', 'W3220'] },
  { id: 'dashboard_mutate', donor: 'W325', wave: '1b', files: ['W3221', 'W3222', 'W3223'] },
]);

// ── THE BUILT CHAINS: each is a query state of the page that opened it (`?act=`). The access mutate group is built TWICE, by its two openers:
// REAL ("Request a role", approve, remove) and PARITY-DECOR (the error state's "Retry"). ──
export type Chain1Id = 'login_form' | 'access_act' | 'access_reread';
/** Where every chain state's Back goes — ONE place (the login chain: /login, never W325: the canon's defect). */
export const CHAIN_BACK: Readonly<Record<Chain1Id, string>> = Object.freeze({ login_form: '/login', access_act: '/access', access_reread: '/access' });
export interface Chain1Def {
  id: Chain1Id; wave: Gov1Wave; kind: 'REAL' | 'PARITY-DECOR'; group: string; surface: Gov1Surface; states: readonly string[];
  /** A state that is DECOR inside an otherwise REAL chain (the login review). */
  decorStates: readonly string[];
  key: (state: string) => string; statement: string; backKey: string; rereadKey: string;
}
export const GOV1_CHAINS: readonly Chain1Def[] = Object.freeze([
  { id: 'login_form', wave: '1a', kind: 'REAL', group: 'login_form', surface: 'login_form', states: ['form-error', 'review', 'success', 'failure'], decorStates: ['review'],
    key: (s: string) => `gov1.chain.login.${s}`, statement: 'gov1.login.q5', backKey: 'gov1.chain.backLogin', rereadKey: 'gov1.chain.backLogin' },
  { id: 'access_act', wave: '1a', kind: 'REAL', group: 'access_mutate', surface: 'access_act', states: ['confirm', 'success', 'failure'], decorStates: [],
    key: (s: string) => `gov1.chain.access.${s}`, statement: 'gov1.access.q4', backKey: 'gov1.chain.backAccess', rereadKey: 'gov1.chain.reread' },
  { id: 'access_reread', wave: '1a', kind: 'PARITY-DECOR', group: 'access_mutate', surface: 'access_reread', states: ['confirm', 'success', 'failure'], decorStates: [],
    key: (s: string) => `gov1.chain.reread.${s}`, statement: 'gov1.access.q4', backKey: 'gov1.chain.backAccess', rereadKey: 'gov1.chain.reread' },
]);
export function chain1ById(id: Chain1Id): Chain1Def { return GOV1_CHAINS.find((c) => c.id === id) as Chain1Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain1State(id: Chain1Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain1ById(id);
  const raw = searchParams?.act;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
