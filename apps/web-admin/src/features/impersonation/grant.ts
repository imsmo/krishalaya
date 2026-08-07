// apps/web-admin/src/features/impersonation/grant.ts · PURE, framework-free helpers + types for the god-mode
// act-as (impersonation) console — the highest-sensitivity surface. No fetch, no React → unit-tested. MIRRORS
// admin-api impersonation: the grant lifecycle state machine (grant.state — active → ended|expired|revoked, only
// active is non-terminal), the deliberate safety bounds (READ-ONLY scope only, time-boxed ttl, ≥8-char
// justification). The minted act-as TOKEN is a secret handled server-side only — it is NEVER modelled, returned,
// or rendered here.

// Mirrors admin-api grant.state.ts.
export const GRANT_STATUSES = ['active', 'ended', 'expired', 'revoked'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export function grantStatusKey(s: string | null | undefined): GrantStatus {
  return (GRANT_STATUSES as readonly string[]).includes(s ?? '') ? (s as GrantStatus) : 'expired';
}
export function isGrantActive(s: GrantStatus): boolean { return s === 'active'; }
export function isGrantTerminal(s: GrantStatus): boolean { return s !== 'active'; }
/** A still-active grant can be closed early two ways (mirrors entity end()/revoke(); both require active). */
export function canEndGrant(s: GrantStatus): boolean { return s === 'active'; }
export function canRevokeGrant(s: GrantStatus): boolean { return s === 'active'; }

// Deliberate safety bounds (mirror admin-api scope.ts + dto).
export const IMPERSONATION_SCOPES = ['read_only'] as const;
export type ImpersonationScope = (typeof IMPERSONATION_SCOPES)[number];
export const TTL_MIN_SEC = 60;
export const TTL_MAX_SEC = 3600;
export const TTL_DEFAULT_SEC = 900;
export const REASON_MIN = 8;            // act-as demands a real justification (deliberate)
export const REASON_MAX = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): boolean { return UUID_RE.test((v ?? '').trim()); }
export function validReason(r: string | null | undefined): boolean {
  const s = (r ?? '').trim();
  return s.length >= REASON_MIN && s.length <= REASON_MAX;
}
// float-free ttl parse: a 2–4 digit string, unary + (exact integer), bounded to [60,3600].
function parseTtl(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return TTL_DEFAULT_SEC;
  if (!/^[0-9]{2,4}$/.test(s)) return null;
  const n = +s;
  return n >= TTL_MIN_SEC && n <= TTL_MAX_SEC ? n : null;
}

export type StartGrantResult =
  | { ok: true; value: { targetTenantId: string; targetUserId: string; reason: string; ttlSec: number; scope: ImpersonationScope } }
  | { ok: false; error: 'targetTenantId' | 'targetUserId' | 'reason' | 'ttlSec' | 'scope' };

export function buildStartGrant(raw: { targetTenantId?: string; targetUserId?: string; reason?: string; ttlSec?: string; scope?: string }): StartGrantResult {
  const targetTenantId = (raw.targetTenantId ?? '').trim();
  if (!isUuid(targetTenantId)) return { ok: false, error: 'targetTenantId' };
  const targetUserId = (raw.targetUserId ?? '').trim();
  if (!isUuid(targetUserId)) return { ok: false, error: 'targetUserId' };
  if (!validReason(raw.reason)) return { ok: false, error: 'reason' };
  const ttlSec = parseTtl(raw.ttlSec);
  if (ttlSec === null) return { ok: false, error: 'ttlSec' };
  const scope = (raw.scope ?? 'read_only').trim();
  if (!(IMPERSONATION_SCOPES as readonly string[]).includes(scope)) return { ok: false, error: 'scope' };
  return { ok: true, value: { targetTenantId, targetUserId, reason: (raw.reason ?? '').trim(), ttlSec, scope: scope as ImpersonationScope } };
}

export type ReasonResult = { ok: true; value: { reason: string } } | { ok: false; error: 'reason' };
export function buildReason(raw: { reason?: string }): ReasonResult {
  if (!validReason(raw.reason)) return { ok: false, error: 'reason' };
  return { ok: true, value: { reason: (raw.reason ?? '').trim() } };
}

// ---- read-model shapes (mirror admin-api impersonation read models; type-only, no runtime). NOTE: the act-as
//      token is intentionally absent — it is never returned to the browser. ----
export interface GrantRow {
  id: string; adminUserId: string; targetTenantId: string; targetUserId: string; reason: string;
  scope: ImpersonationScope | string; status: GrantStatus; expiresAt: string | null;
  endedAt: string | null; endedBy: string | null; endReason: string | null; createdAt: string | null;
}
export interface ActionRow { id: string; grantId: string; method: string; path: string; action: string | null; createdAt: string | null }

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-9b · WHAT THE PLATFORM CAN HONESTLY CLAIM ABOUT A SESSION                             */
/* ------------------------------------------------------------------------------------------------ */
//
// Until this wave `apps/api` had no verifier, so a minted token was inert and every promise on W008 — "read_only by
// design", "every page view is recorded", "the target tenant is notified of session end" — described behaviour that
// did not exist. These helpers keep the console's claims tied to the state of the enforcement rather than to the copy.

export interface EnforcementState {
  verifierExists: boolean;
  readOnlyEnforcedAtRequestTime: boolean;
  perRequestLoggingByPlatform: boolean;
  revocationTakesEffect: string;
  formatDuplicationOwner: string;
}

export function enforcementKey(e: EnforcementState | null | undefined): string {
  if (!e) return 'imp.enforce.unknown';
  if (!e.verifierExists) return 'imp.enforce.absent';
  return e.readOnlyEnforcedAtRequestTime && e.perRequestLoggingByPlatform
    ? 'imp.enforce.full' : 'imp.enforce.partial';
}

export function enforcementClass(e: EnforcementState | null | undefined): string {
  const k = enforcementKey(e);
  if (k === 'imp.enforce.full') return 'kv-note is-ok';
  // An UNKNOWN enforcement state is drawn as loudly as an absent one: a console that cannot say whether the read-only
  // rule is running must not imply that it is.
  return k === 'imp.enforce.partial' ? 'kv-note is-warn' : 'kv-note is-danger';
}

export interface ActionCounts { served: number; refusedWrite: number; refusedGrant: number }

/** The session's shape in one sentence. A blocked write and a use-after-end are the two rows a reviewer is looking
 *  for, so they get their own keys rather than being folded into a total. */
export function sessionShapeKey(c: ActionCounts | null | undefined): string {
  if (!c) return 'imp.actions.unknown';
  if (c.refusedGrant > 0) return 'imp.actions.usedAfterEnd';
  if (c.refusedWrite > 0) return 'imp.actions.blockedWrites';
  return c.served === 0 ? 'imp.actions.none' : 'imp.actions.served';
}

export function sessionShapeClass(c: ActionCounts | null | undefined): string {
  if (!c) return 'kv-note';
  if (c.refusedGrant > 0) return 'kv-note is-danger';
  return c.refusedWrite > 0 ? 'kv-note is-warn' : 'kv-note';
}

export function actionOutcomeKey(outcome: string): string {
  const known = ['served', 'refused_write', 'refused_grant'];
  return known.includes(outcome) ? `imp.outcome.${outcome}` : 'imp.outcome.other';
}

export function actionOutcomeClass(outcome: string): string {
  if (outcome === 'refused_grant') return 'kv-badge is-danger';
  if (outcome === 'refused_write') return 'kv-badge is-warn';
  return 'kv-badge';
}

/**
 * **AN ELAPSED GRANT THAT STILL READS `active` IS A DIFFERENT FACT FROM A LIVE ONE, AND THE LIST MUST SAY SO.** Expiry
 * had no writer, so a grant whose window closed hours ago showed as active on every surface — and kept holding the
 * one-active-per-(operator, target) slot. Reconciliation now runs on the read path; this covers the instant between an
 * elapsed window and the row catching up.
 */
export function isElapsedButActive(status: string, expiresAt: string | null, nowMs: number): boolean {
  if (status !== 'active' || !expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** Minutes left, floored, for a live grant. Floored so a session is never described as having more time than it has. */
export function minutesLeft(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((t - nowMs) / 60000));
}

/** Whether the target was told. A session the tenant was never notified of is the defect W008's transparency claim was
 *  written against, and old grants (before 0119) genuinely have no notice — so `null` reads as "not recorded", never
 *  as "not sent". */
export function noticeKey(notified: boolean | null | undefined): string {
  if (notified === null || notified === undefined) return 'imp.notice.unknown';
  return notified ? 'imp.notice.sent' : 'imp.notice.none';
}
