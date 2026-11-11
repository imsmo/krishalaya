// apps/web-gov/src/features/gov2/applications.ts · PC-56 GOV-2c — the application pages' PURE pieces (W330, W331 and their chains
// W3159–W3166). GOV-2 Q1-A, Q2-A, Q3-A, Q4-A (lead-applied 2026-11-10; the founder may reopen).
//
// The authority reads applications as GOV-2a's read gives them (`gov.applications.list / get`) and acts through ONE call
// (`gov.applications.act`). This module picks a page's state and its chain, cleans the filters (a status this realm never lists is
// dropped before the call), and decides which acts to OFFER. The offer MIRRORS the API and never grants: by the session's permissions and
// the application's status, and — when (and only when) a fact is given — by who checked, made or helped make it. The read gives no such
// fact today (GOV-2a returns booleans to its own refusal order only), so the page passes none and the API refuses by name (Q2-A).
import type { GovMe, GovMembership } from '@krishalaya/sdk-js';

export interface ReadError { status: number; code: string }

/** The statuses this realm lists — every status a SENT application can have (GOV-2a B1: an unsent one never reaches the authority). */
export const GOV_LISTED_STATUSES = Object.freeze(['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed'] as const);
export type GovListedStatus = (typeof GOV_LISTED_STATUSES)[number];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isApplicationId = (id: string | null | undefined): id is string => typeof id === 'string' && UUID.test(id);

/** `?status=` gives a listed status, else undefined (anything else — an unsent status included — is never sent to the API). */
export function statusFilter(raw: string | string[] | undefined): GovListedStatus | undefined {
  const v = one(raw);
  return v && (GOV_LISTED_STATUSES as readonly string[]).includes(v) ? (v as GovListedStatus) : undefined;
}
/** `?scheme=` gives a scheme id (uuid), else undefined. */
export const schemeFilter = (raw: string | string[] | undefined): string | undefined => { const v = one(raw); return isApplicationId(v) ? v : undefined; };
/** `?cursor=` gives passed through as the API minted it (the API validates it), bounded in length. */
export const cursorParam = (raw: string | string[] | undefined): string | undefined => { const v = one(raw); return v && v.length <= 200 ? v : undefined; };
/** The status in words; an unknown status gives the dash. */
export const statusKey = (s: string): string => ((GOV_LISTED_STATUSES as readonly string[]).includes(s) ? `gov2.status.${s}` : 'common.dash');
/** The application's number as printed: the first 8 characters of its id, upper case. */
export const shortId = (id: string): string => id.replace(/-/g, '').slice(0, 8).toUpperCase();

/** The address of a list view with these filters (and a cursor). */
export function listHref(q: { status?: string; scheme?: string; cursor?: string }): string {
  const p = new URLSearchParams();
  if (q.scheme) p.set('scheme', q.scheme);
  if (q.status) p.set('status', q.status);
  if (q.cursor) p.set('cursor', q.cursor);
  const s = p.toString();
  return s ? `/applications?${s}` : '/applications';
}

export type AppsState = 'ok' | 'empty' | 'off' | 'forbidden' | 'error';
export function applicationsState(items: unknown[] | null, err: ReadError | null): AppsState {
  if (err?.status === 404) return 'off';
  if (err?.status === 403) return 'forbidden';
  if (err || !items) return 'error';
  return items.length === 0 ? 'empty' : 'ok';
}
export type AppState = 'ok' | 'not_found' | 'off' | 'forbidden' | 'error';
/** GOV_APPLICATION_NOT_FOUND (unknown, malformed, another authority's — or an unsent one: the same 404) gives not_found; any other 404 gives off. */
export function applicationState(app: unknown, err: ReadError | null): AppState {
  if (err?.status === 404) return err.code === 'GOV_APPLICATION_NOT_FOUND' ? 'not_found' : 'off';
  if (err?.status === 403) return 'forbidden';
  if (err || !app) return 'error';
  return 'ok';
}

// ── the acts (Q2-A) ──
export const GOV_ACTS = Object.freeze(['verify', 'clarify', 'approve', 'reject'] as const);
export type GovActName = (typeof GOV_ACTS)[number];
export const actParam = (raw: string | string[] | undefined): GovActName | null => { const v = one(raw); return v && (GOV_ACTS as readonly string[]).includes(v) ? (v as GovActName) : null; };
/** The 11 listed rejection reasons (0106; GOV-2a's DEFINER list), in its order — each has words ×3. */
export const REJECTION_CODES = Object.freeze(['aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed', 'documents_missing',
  'ineligible_landholding', 'ineligible_category', 'ineligible_region', 'portal_rejected', 'withdrawn_by_applicant', 'other'] as const);
export type RejectionCode = (typeof REJECTION_CODES)[number];
export const isRejectionCode = (v: string): v is RejectionCode => (REJECTION_CODES as readonly string[]).includes(v);
/** A sentence the API accepts: 10–500 characters once trimmed. */
export const sentenceOk = (v: string | null | undefined): boolean => { const t = (v ?? '').trim(); return t.length >= 10 && t.length <= 500; };

/** Facts about the SESSION person and this application. Never an id. The read gives none today gives `null` (unknown). */
export interface ActFacts { actorIsVerifier: boolean; actorIsApplicant: boolean; actorIsAssister: boolean }
const VERIFY = 'authority.applications.verify';
const DECIDE = 'authority.applications.decide';
/**
 * The acts OFFERED on an application (Q2-A, E4) — a mirror of GOV-2a's act machine, never a grant:
 *   verify   a holder of `verify`, status submitted / appealed / under_verification ("complete checking" — the read cannot tell if checked);
 *   clarify  a holder of `verify`, status under_verification;
 *   approve / reject  a holder of `decide`, status under_verification, and NOT the person who checked it, made it or helped make it — when the
 *            facts say so; with no facts (null) they are offered and the API refuses by name (GOV_DECIDER_IS_* / GOV_NOT_VERIFIED).
 */
export function offeredActs(me: Pick<GovMe, 'person'>, status: string, facts: ActFacts | null): GovActName[] {
  const can = (p: string) => me.person.permissions.includes(p);
  const out: GovActName[] = [];
  if (can(VERIFY) && (status === 'submitted' || status === 'appealed' || status === 'under_verification')) out.push('verify');
  if (can(VERIFY) && status === 'under_verification') out.push('clarify');
  const second = !facts || (!facts.actorIsVerifier && !facts.actorIsApplicant && !facts.actorIsAssister);
  if (can(DECIDE) && status === 'under_verification' && second) out.push('approve', 'reject');
  return out;
}
export const canDecide = (me: Pick<GovMe, 'person'>): boolean => me.person.permissions.includes(DECIDE);
export const canCheck = (me: Pick<GovMe, 'person'>): boolean => me.person.permissions.includes(VERIFY);

/**
 * THE LONE-HEAD FACT (GOV-0 Q1, still open) — from the members read, never a workaround: a decision needs a live head AND a check by another
 * live person. No live head → `no_head`; the viewer the only live member → `alone`; else null (or when the members read is unavailable).
 */
export type DecisionFact = 'no_head' | 'alone' | null;
export function decisionFact(rows: readonly GovMembership[] | null, meUserId: string): DecisionFact {
  if (!rows) return null;
  const live = rows.filter((r) => r.status === 'active' && r.live);
  const heads = new Set(live.filter((r) => r.roleCode === 'authority_head').map((r) => r.userId));
  if (heads.size === 0) return 'no_head';
  const people = new Set(live.map((r) => r.userId));
  if (people.size === 1 && people.has(meUserId)) return 'alone';
  return null;
}

/** Every refusal the act names (GOV-2a `gov-console.errors.ts`), its key; anything else: the generic one. */
export const ACT_ERRORS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries([
  'GOV_DECIDER_IS_VERIFIER', 'GOV_DECIDER_IS_APPLICANT', 'GOV_DECIDER_IS_ASSISTER', 'GOV_NOT_VERIFIED', 'GOV_REASON_CODE_REQUIRED', 'GOV_REASON_REQUIRED',
  'GOV_NOTE_REQUIRED', 'GOV_REASON_CODE_ONLY_ON_REJECT', 'GOV_ACT_NOT_NOW', 'GOV_PERMISSION_MISSING', 'GOV_APPLICATION_NOT_FOUND',
  'GOV_IDEMPOTENCY_KEY_REQUIRED', 'GOV_SESSION_ENDED', 'ACT_FAILED',
].map((c) => [c, `gov2.err.${c}`])));
export const actErrorCode = (raw: string | string[] | undefined): string => { const v = one(raw); return v && ACT_ERRORS[v] ? v : 'ACT_FAILED'; };

// ── the chains as query states ──
export type AppChain = 'application_act' | 'application_reread' | 'applications_file' | 'applications_reread';
/** On the LIST: `do=file` gives the file chain (DECOR), `do=reread` gives the list re-read. On an APPLICATION: `do=reread` gives its re-read; an act
 *  name (`do=verify|clarify|approve|reject`) → the act chain. Anything else → null (the page itself). */
export function appChainFor(searchParams: Record<string, string | string[] | undefined> | undefined, onApplication: boolean): AppChain | null {
  const d = one(searchParams?.do);
  if (!onApplication) return d === 'file' ? 'applications_file' : d === 'reread' ? 'applications_reread' : null;
  if (d === 'reread') return 'application_reread';
  return actParam(d) ? 'application_act' : null;
}
/** Back gives the application that opened the chain; the list's chains (or a malformed id) gives /applications. */
export const appChainBack = (appId: string | null): string => (isApplicationId(appId) ? `/applications/${appId}` : '/applications');
/** The address that opens an act's confirm state from the application. */
export const actHref = (appId: string, act: GovActName): string => `/applications/${appId}?do=${act}&act=confirm`;
