// apps/web-gov/src/features/gov4/refusals.ts · PC-56 GOV-4 — WHAT THE FIELD VISITS PAGE DOES NOT CLAIM, BY NAME. PURE.
// The `features/gov3/refusals.ts` shape (survey_gov4.md E5): each refused canon claim is listed ONCE with where the canon makes it (persons,
// places, bodies and figures anonymised in brackets) and the surfaces that PRINT it (a sentence that says no — never an offer, never the
// canon's own words); the render tests read this map, and the gov4 claims guard (test/gov4-claims-guard.spec.ts) keeps the canon's false
// words out of every `gov4.` value.
//
// GOV-4 is GOV-4a → GOV-4b (survey §4; GOV-4 Q1-A, Q2-A, Q3-A and Q5-A applied by the lead under the founder's instructions — 06_GOV.md "GOV-4
// SPLIT"; his to reopen). This registry carries ALL 19 canon files: GOV-4a decides its 13; GOV-4b's 6 stay `pending_4b` until it decides them.
//
// GOV-4a · FIELD VISITS builds ONE route (E1), `/verification` ("Field visits"):
//   • W335 (the queue) — BUILT (honest): it READS NOTHING (E2: the shell's `gov.me()` only). Q2's, Q1's, Q3's and Q5's sentences and the
//     download sentence; no row, no count, no farmer, no village, no officer, no position, no picture, no phone, no figure.
//   • W336 (one case), W337 (the visit capture), W338 (the review of officers) — BUILT (honest) as the page's section "What this console does
//     not do" (GOV4_NOT_DONE): each canon feature named once, in plain words, as not done here. Their own addresses (`/verification/[id]`,
//     `/verification/[id]/visit`, `/verification/review`) have no route and answer not found.
//   • the chains (`?do=…&act=`; Back → `/verification`): the file chain (W3189–W3190), the form chain (W3191–W3194) and the act chain
//     (W3195–W3197) — all DECOR: nothing is made, entered, given, sent or submitted. The page reads nothing, so it has no load-error state and no
//     Retry (the canon's Retry → W3195 has nothing to re-read — DELTA `no_retry`).
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Gov4Surface =
  // GOV-4a · the page and its chains
  | 'verification' | 'visit_file' | 'visit_draft' | 'visit_act'
  // GOV-4b · named now so the registry is whole; nothing is built or printed for them until GOV-4b
  | 'access_signins' | 'session_file' | 'session_reread';
export interface Gov4Refusal { id: string; canon: string; surfaces: readonly Gov4Surface[]; key: string; why: string }

/** The surfaces GOV-4a builds. */
export const SURFACES_4A: readonly Gov4Surface[] = ['verification', 'visit_file', 'visit_draft', 'visit_act'];
/** The surfaces GOV-4b will build (pending). */
export const SURFACES_4B: readonly Gov4Surface[] = ['access_signins', 'session_file', 'session_reread'];
const WRITE_CHAINS_4A: readonly Gov4Surface[] = ['visit_draft', 'visit_act'];

export const GOV4_REFUSALS: readonly Gov4Refusal[] = Object.freeze([
  // ══ the console chrome on W335–W338 ══
  { id: 'console_chrome_4a', canon: 'W335–W338 "[initials]" avatar · "Search [visits / cases / applications]… ⌘K" · the bell', surfaces: ['verification'],
    key: 'gov4.refusal.consoleChrome', why: 'DECOR (FM filter rows ×4): no search, person picker or bell exists' },
  { id: 'page_switch_4a', canon: 'W335–W338 state "Flagged off — [page] disabled …"', surfaces: ['verification'],
    key: 'gov4.refusal.pageSwitch', why: 'no per-page switch exists; gov_console OFF sends the reader to the sign-in page, which says so (lib/session.ts)' },
  // ══ W335 ══
  { id: 'queue_counts', canon: 'W335 tiles "Awaiting site visit [n] · oldest [n] days · target ≤ [n]" · "Money these visits release [money] · avg [money]" · "Field officers active today [n] · avg [n] visits/day"', surfaces: ['verification'],
    key: 'gov4.refusal.noCounts', why: 'MONEY · TRUST, FALSE ×3: no gov read of visits exists (survey §1A); no money figure (Q5-A); no officer activity (Q3-A)' },
  { id: 'queue_rows', canon: 'W335 table Waiting · Application · Village / [area] · [instalment] at stake · Assigned ("[n] days · [ref] · farmer [initials] · [n] ha · [village] · [area] · [money] · [officer] · tomorrow AM")', surfaces: ['verification'],
    key: 'gov4.refusal.noRows', why: 'PII · LOCATION · MONEY (Q1-A, GOV-2 Q3-A): never a farmer, village, hectares, sum or officer; the five row boxes act on nothing' },
  { id: 'queue_paging', canon: 'W335 "Showing 1–25 of [n] pending visits · Page size · Page 1 of [n]" · filters "[n] days" · four row menus · W338 "Showing 3 of [n] in review" · filters "[ref]"', surfaces: ['verification'],
    key: 'gov4.refusal.noPaging', why: 'no rows are listed, so there is nothing to page or filter (FM :95-97, :102, :112-113, :115 DECOR)' },
  { id: 'visit_pays', canon: 'W335 "Site visits that release instalment 2 … [share] of their money" · "Inst-2-at-stake = approved ha × [money] × [share]"', surfaces: ['verification'],
    key: 'gov4.refusal.noPayment', why: 'MONEY, FALSE: no visit releases anything; no instalment plan; no formula exists (Q5-A)' },
  { id: 'pairing', canon: 'W335 "same-village pairing" · "Same-village visits pair automatically" · W336 "paired with [ref] (same village)"', surfaces: ['verification'],
    key: 'gov4.refusal.noPairing', why: 'FALSE: no pairing exists; a village is never shown (Q1-A)' },
  { id: 'rides_events', canon: 'W335 "Field-verification records ride application events + media today; a dedicated table is [delta]"', surfaces: ['verification'],
    key: 'gov4.refusal.noHistory', why: 'C-6: the table exists (0066) and a visit wrote no application event, audit or outbox row' },
  { id: 'queue_clear', canon: 'W335 state "Queue clear — Every installation-ready farmer has a visit scheduled — the target state" · W338 "Nothing in review — … the system is earning its trust"', surfaces: ['verification'],
    key: 'gov4.refusal.emptyMeansNothing', why: 'FALSE as a claim: nothing is scheduled or reviewed here, so an empty page is not success (the GOV-3 rule)' },
  { id: 'area_roles', canon: 'W335 "Beat-scoped view — Field officers see their own beat only; supervisors see the taluka; this district view needs the coordinator role" · W338 "Supervisor role" ×2', surfaces: ['verification'],
    key: 'gov4.refusal.twoRoles', why: 'FALSE: an authority has two roles, head and officer (0239:25-28); no area, beat or supervisor role exists' },
  // ══ W336 / W337 — the claims beyond the features named in "What this console does not do" ══
  { id: 'checklist', canon: 'W336 "What the visit must establish — nothing more" (installed on the approved [land, record ref] · measured coverage · operational · farmer signing off) · "The checklist is the whole visit"', surfaces: ['verification'],
    key: 'gov4.refusal.noChecklist', why: 'FALSE: field_verifications has no checklist; the land-record reference is a document number never in the gov read (Q1-A)' },
  { id: 'farmer_told', canon: 'W336 "The farmer was told the date the moment it was set — same message, same clock" · "the farmer\'s copy of this same checklist says so in [language]"', surfaces: ['verification'],
    key: 'gov4.refusal.noMessage', why: 'FALSE: no message about a visit exists (no outbox on schedule); no app shows a farmer her visits' },
  { id: 'reassign', canon: 'W336 "Not your [area] — This case belongs to [area] ([officer]). Reassignment is the supervisor\'s action, recorded with a reason" · W337 "Officer-of-record only — Only the assigned officer\'s device can capture"', surfaces: ['verification'],
    key: 'gov4.refusal.noMove', why: 'C-5: no assign or reassign act exists in any realm' },
  { id: 'on_device', canon: 'W337 "offline-capable … works with zero bars: everything below saves on-device and syncs from the road … a DRAFT capture" · "Sync pending (offline) — [n] photos + the walk trace are queued on this device"', surfaces: ['verification'],
    key: 'gov4.refusal.noDevice', why: 'FALSE: no offline client, no draft, no sync (synced_at never written); a web console saves nothing on a device' },
  { id: 'boundary_check', canon: 'W337 "Geotags are checked against the parcel polygon on sync — a mismatch flags for supervisor review" · W338 "geotag [n] m off parcel"', surfaces: ['verification'],
    key: 'gov4.refusal.noBoundary', why: 'C-3: no point is ever tested against a land boundary (no parcel link on field_verifications)' },
  { id: 'files_out', canon: 'W338 "Export week (audit-stamped)" (→ W3189)', surfaces: ['verification', 'visit_file'],
    key: 'gov4.refusal.noFile', why: 'applied from GOV-2/3 Q4-A: no gov file plane; the download sentence is printed' },
  // ══ the chains' shared sentences (W3189–W3197) — refused BY NAME ══
  { id: 'chain_record_4a', canon: 'W3195 / W3196 "confirming writes an [record] entry with actor, time and reason" · "View [the record]" · "the [record] has the entry (actor · time · reason · before/after)"', surfaces: WRITE_CHAINS_4A,
    key: 'gov4.refusal.chainRecord', why: 'nothing is written from these pages, so there is no entry to view' },
  { id: 'chain_paging_4a', canon: 'W3194 / W3197 "repeated failures page the [duty person]"', surfaces: WRITE_CHAINS_4A,
    key: 'gov4.refusal.chainPaging', why: 'no paging exists' },
  { id: 'chain_money_4a', canon: 'W3196 "Money-adjacent actions reconcile [to zero] before this page ever shows"', surfaces: ['visit_act'],
    key: 'gov4.refusal.chainMoney', why: 'no money moves on this console' },
  { id: 'chain_file_4a', canon: 'W3189 / W3190 "queued with a position and [time to ready] … [stamped], [checked], delivered by [time-limited link]" · "file name, row count, [file hash] … [n]-min [link], every fetch logged"', surfaces: ['visit_file'],
    key: 'gov4.refusal.chainFile', why: 'no file is queued, made or handed out in this realm (GOV-2 Q4-A)' },
  { id: 'chain_review_step', canon: 'W3192 "[two-person]-friendly review step … the diff against current values"', surfaces: ['visit_draft'],
    key: 'gov4.refusal.chainReview', why: 'no form exists, so there is nothing to review or compare' },
  { id: 'chain_back_form', canon: 'W3191 "Back to the form" (→ W335, not W337)', surfaces: ['visit_draft'],
    key: 'gov4.refusal.chainBackForm', why: 'canon defect (survey §1): no form exists; Back returns to the page' },
]);
export function gov4RefusalKeys(surface: Gov4Surface): string[] { return GOV4_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** `/verification`'s section "What this console does not do" — W335's acts, W336, W337 and W338 BUILT (honest): each feature named ONCE. */
export const GOV4_NOT_DONE: readonly { id: string; file: 'W335' | 'W336' | 'W337' | 'W338'; canon: string; key: string }[] = Object.freeze([
  { id: 'schedule', file: 'W335', canon: 'W335 "Plan tomorrow\'s visits" · W336 "Visit scheduled tomorrow, [day] AM"', key: 'gov4.notDone.schedule' },
  { id: 'assign', file: 'W335', canon: 'W335 "Assign by beat" (→ W3195) · the "Assigned" column', key: 'gov4.notDone.assign' },
  { id: 'recompute', file: 'W336', canon: 'W336 "Money at this gate — Approved … Inst-1 … Inst-2 if measured … total recomputes on MEASURED ha" · W337 "What this means for the farmer … [money] … joins the NEXT daily batch"', key: 'gov4.notDone.recompute' },
  { id: 'capture', file: 'W337', canon: 'W337 "Site visit" capture: photos 1/2/3 · geotag ✓ · GPS walk [n] ha · walk trace · video [time] · "Save draft" (→ W3191) · "Submit — needs farmer OTP" (→ W3195) · the measured-ha input', key: 'gov4.notDone.capture' },
  { id: 'farmer_code', file: 'W337', canon: 'W337 "Farmer sign-off — pending OTP — OTP goes to the FARMER\'s registered phone ([masked]) … the dispute path opens right here" · "Send OTP to farmer" (→ W3195)', key: 'gov4.notDone.farmerCode' },
  { id: 'review', file: 'W338', canon: 'W338 "Supervisor review — completed verifications · [person] · [area] · 10% random re-checks + every flag"', key: 'gov4.notDone.review' },
  { id: 'officials', file: 'W338', canon: 'W338 rows "[officer] · pattern flag (signals-not-verdicts) … officer coaching" · "Officer workload — fairness view — [officer] [n] visits … route km"', key: 'gov4.notDone.officials' },
]);

/** What was built differently from the canon, and why (DELTAs). */
export const GOV4_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'one_route', canon: 'W335 /verification · W336 /verification/[id] · W337 /verification/[id]/visit · W338 /verification/review', built: 'E1: one route, /verification; W336, W337, W338 are its "does not do" section; the other addresses have no route (not found)' },
  { id: 'nav_verification', canon: 'the canon sidebar has no entry for field verification (W335:24-34)', built: 'GOV_NAV gains "Field visits" (/verification) so the page\'s sentences are reachable; the GOV-1a 307 for /verification is removed' },
  { id: 'reads_nothing', canon: 'W335 tiles and queue, W336 case, W337 capture, W338 review rows', built: 'Q1-A / Q2-A / Q3-A / Q5-A: the page reads nothing (the shell\'s gov.me only); no row, count, person, place, position, picture, phone or figure' },
  { id: 'no_retry', canon: 'load-error "Retry" on W335 / W336 / W337 / W338 → the mutate-confirm page W3195', built: 'the page reads nothing, so it has no load-error state and no Retry; the act chain (W3195–W3197) is DECOR only' },
  { id: 'field_visit_word', canon: '"verification", "verified", "Site visit"', built: 'F-12: every sentence says "field visit"; the authority\'s own check is called a desk check (Q2-A) — never "verified"' },
  { id: 'closed_tenant', canon: 'the organisation\'s schedule / submit routes (scheme.process, no live holder)', built: 'Q2-A: refused by name FIELD_VISITS_ARE_NOT_RECORDED_HERE for every caller; the applicant\'s own read of visits recorded before is kept' },
]);

/** The verdict values (GOV-4b deletes `pending_4b` from the type when it decides its 6 — the 4c-7 rule). */
export type Gov4Verdict = 'BUILT (honest)' | 'BUILT (read)' | 'REAL' | 'PARITY-DECOR' | 'DECOR' | 'pending_4b';
export type Gov4Wave = '4a' | '4b';
/** Every canon file of GOV-4 (19), each with ONE verdict: 4a decides its 13; 4b's 6 are pending. */
export const GOV4_CANON_FILES: readonly { file: string; wave: Gov4Wave; verdict: Gov4Verdict; note: string }[] = Object.freeze([
  // ── 4a · FIELD VISITS (13) — decided (Q1-A, Q2-A, Q3-A, Q5-A lead-applied) ──
  { file: 'W335-gov-verification-queue.html', wave: '4a', verdict: 'BUILT (honest)', note: '/verification — reads nothing; Q2, Q1, Q3, Q5 and the download sentence verbatim; no row, count, person, place or figure' },
  { file: 'W336-gov-verification-case.html', wave: '4a', verdict: 'BUILT (honest)', note: '/verification "What this console does not do" (gov4.notDone.recompute); /verification/[id] has no route' },
  { file: 'W337-gov-verification-visit.html', wave: '4a', verdict: 'BUILT (honest)', note: '/verification "What this console does not do" (gov4.notDone.capture / .farmerCode); /verification/[id]/visit has no route' },
  { file: 'W338-gov-verification-review.html', wave: '4a', verdict: 'BUILT (honest)', note: '/verification "What this console does not do" (gov4.notDone.review / .officials) and Q3\'s sentence; /verification/review has no route' },
  { file: 'W3189-gov-verification-export-queued.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=file&act=queued — no file is made; reached by address only' },
  { file: 'W3190-gov-verification-export-ready.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=file&act=ready — no file exists to hand out' },
  { file: 'W3191-gov-verification-form-form-error.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=draft&act=form-error — no form exists (Q2-A)' },
  { file: 'W3192-gov-verification-form-review.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=draft&act=review — nothing to review' },
  { file: 'W3193-gov-verification-form-success.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=draft&act=success — nothing was saved' },
  { file: 'W3194-gov-verification-form-failure.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=draft&act=failure — nothing was sent' },
  { file: 'W3195-gov-verification-mutate-confirm.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=act&act=confirm — assigning, a code to a farmer and submitting refused BY NAME (Q2-A)' },
  { file: 'W3196-gov-verification-mutate-success.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=act&act=success — nothing was done' },
  { file: 'W3197-gov-verification-mutate-failure.html', wave: '4a', verdict: 'DECOR', note: '/verification?do=act&act=failure — nothing was sent; Back → /verification' },
  // ── 4b · SIGN-INS (6) — pending GOV-4b (Q4) ──
  { file: 'W356-gov-session-audit.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
  { file: 'W3262-gov-session-export-queued.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
  { file: 'W3263-gov-session-export-ready.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
  { file: 'W3264-gov-session-mutate-confirm.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
  { file: 'W3265-gov-session-mutate-success.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
  { file: 'W3266-gov-session-mutate-failure.html', wave: '4b', verdict: 'pending_4b', note: 'GOV-4b' },
]);

/** The canon chain groups (survey §1F–§1K; the canon's route comments "B2 shared chain: <m> × chain-<x>"), 14 files, each exactly once. */
export const GOV4_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Gov4Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'verification_export', donor: 'W335', wave: '4a', files: ['W3189', 'W3190'] },
  { id: 'verification_form', donor: 'W335', wave: '4a', files: ['W3191', 'W3192', 'W3193', 'W3194'] },
  { id: 'verification_mutate', donor: 'W335', wave: '4a', files: ['W3195', 'W3196', 'W3197'] },
  { id: 'session_export', donor: 'W356', wave: '4b', files: ['W3262', 'W3263'] },
  { id: 'session_mutate', donor: 'W356', wave: '4b', files: ['W3264', 'W3265', 'W3266'] },
]);

// ── THE BUILT CHAINS (GOV-4a): each is a query state (`?do=…&act=`) of /verification; Back → /verification. All DECOR. ──
export type Chain4Id = 'visit_file' | 'visit_draft' | 'visit_act';
export interface Chain4Def {
  id: Chain4Id; wave: Gov4Wave; kind: 'PARITY-DECOR' | 'DECOR'; group: string; surface: Gov4Surface; states: readonly string[];
  doing: string; key: (state: string) => string; statement: string;
}
export const GOV4_CHAINS: readonly Chain4Def[] = Object.freeze([
  { id: 'visit_file', wave: '4a', kind: 'DECOR', group: 'verification_export', surface: 'visit_file', states: ['queued', 'ready'], doing: 'file',
    key: (s: string) => `gov4.chain.file.${s}`, statement: 'gov4.download' },
  { id: 'visit_draft', wave: '4a', kind: 'DECOR', group: 'verification_form', surface: 'visit_draft', states: ['form-error', 'review', 'success', 'failure'], doing: 'draft',
    key: (s: string) => `gov4.chain.draft.${s}`, statement: 'gov4.q2' },
  { id: 'visit_act', wave: '4a', kind: 'DECOR', group: 'verification_mutate', surface: 'visit_act', states: ['confirm', 'success', 'failure'], doing: 'act',
    key: (s: string) => `gov4.chain.act.${s}`, statement: 'gov4.q2' },
]);
export function chain4ById(id: Chain4Id): Chain4Def { return GOV4_CHAINS.find((c) => c.id === id) as Chain4Def; }
/** Every gov4a chain returns to the one page that opens it. */
export const VERIFICATION_BACK = '/verification';

type Params = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Which chain a query opens: `do=file` / `do=draft` / `do=act`; anything else → null (the page itself). */
export function chain4For(searchParams: Params): Chain4Id | null {
  const d = one(searchParams?.do);
  const c = GOV4_CHAINS.find((x) => x.doing === d);
  return c ? c.id : null;
}
/** The chain state (`?act=`), or null for the page itself / a state the chain does not have. */
export function chain4State(id: Chain4Id, searchParams: Params): string | null {
  const v = one(searchParams?.act);
  return v && chain4ById(id).states.includes(v) ? v : null;
}
