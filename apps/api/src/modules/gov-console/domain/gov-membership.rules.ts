// modules/gov-console/domain/gov-membership.rules.ts · PC-56 GOV-0 · A GOVERNMENT AUTHORITY IS AN ORGANISATION — the PURE pieces (no I/O).
//
// GOV-1 Q2-A / Q4-A / Q5-A, applied by the lead on 2026-11-10 under the founder's instruction of that day ("please choose recommended option
// and start at your end next step … think as you are product owner") — the founder may reopen them.
//
//   • the role matrix (mirrors migration 0239 / seed core/0004 — the DATABASE is the authority; this copy exists so a spec can pin it);
//   • THE MEMBERSHIP MACHINE (Law 5 — the one place its moves are decided): requested → active (a SECOND person approves) · requested → removed
//     (withdrawn, with a reason) · active → removed (one person, at once, with a reason). removed is final. "expired" is not a state: it is an
//     active row whose `expires_at` has passed, and such a row resolves NO permission (`membershipLive`);
//   • THE TWO-PERSON RULE: the approver is never the requester and never the grantee (0239 CHECKs + guard repeat it in the database);
//   • THE TERM: every membership has an end — 1 to 12 months from its approval (or from the platform's appointment of a first head);
//   • the sign-in chooser (one authority → a session; several → a choice; none → refused, enumeration-safe), the phone mask.
export const GOV_ROLES = Object.freeze(['authority_head', 'authority_officer'] as const);
export type GovRole = (typeof GOV_ROLES)[number];
export const GOV_PERMISSIONS = Object.freeze([
  'authority.applications.read', 'authority.members.read', 'authority.members.request', 'authority.members.approve', 'authority.members.remove',
] as const);
export type GovPermission = (typeof GOV_PERMISSIONS)[number];

/** THE MATRIX (0239). The head approves and removes; both roles read the authority's applications and people and may REQUEST a role for
 *  someone. Role separation by duty (scheme / verification / finance / field — survey GOV1-B8) is NAMED, not built here. */
export const GOV_ROLE_MATRIX: Readonly<Record<GovRole, readonly GovPermission[]>> = Object.freeze({
  authority_head: GOV_PERMISSIONS,
  authority_officer: ['authority.applications.read', 'authority.members.read', 'authority.members.request'],
});
export const isGovRole = (v: unknown): v is GovRole => typeof v === 'string' && (GOV_ROLES as readonly string[]).includes(v);

export const GOV_MAX_TERM_MONTHS = 12;
export type MembershipStatus = 'requested' | 'active' | 'removed';
export interface MembershipFacts {
  status: MembershipStatus; userId: string; requestedBy: string | null; expiresAt: string | Date | null;
}

/** 1–12 whole months, or the refusal. */
export function termRefusal(months: unknown): 'GOV_TERM_INVALID' | null {
  return Number.isInteger(months) && (months as number) >= 1 && (months as number) <= GOV_MAX_TERM_MONTHS ? null : 'GOV_TERM_INVALID';
}

/** A reason is 10–500 characters after trimming (the house removal rule, 0225's shape). */
export function reasonRefusal(reason: unknown): 'GOV_REASON_REQUIRED' | null {
  const n = typeof reason === 'string' ? reason.trim().length : 0;
  return n >= 10 && n <= 500 ? null : 'GOV_REASON_REQUIRED';
}

/** Does this membership resolve permissions NOW? Only an active row whose end is still ahead. An expired row resolves nothing. */
export function membershipLive(m: Pick<MembershipFacts, 'status' | 'expiresAt'>, nowMs: number = Date.now()): boolean {
  if (m.status !== 'active' || !m.expiresAt) return false;
  return new Date(m.expiresAt).getTime() > nowMs;
}

export type ApprovalRefusal = 'GOV_MEMBERSHIP_NOT_FOUND' | 'GOV_REQUEST_NOT_PENDING' | 'GOV_APPROVER_IS_REQUESTER' | 'GOV_APPROVER_IS_GRANTEE';
/**
 * THE TWO-PERSON RULE (Q4-A). In order: the row exists; it is a pending request; the approver did not ask for it; the approver is not the
 * person who would receive it. (Who MAY approve at all — the head's `authority.members.approve` — is the permission guard's, before this.)
 */
export function approvalRefusal(m: MembershipFacts | null, approverUserId: string): ApprovalRefusal | null {
  if (!m) return 'GOV_MEMBERSHIP_NOT_FOUND';
  if (m.status !== 'requested') return 'GOV_REQUEST_NOT_PENDING';
  if (m.requestedBy !== null && m.requestedBy === approverUserId) return 'GOV_APPROVER_IS_REQUESTER';
  if (m.userId === approverUserId) return 'GOV_APPROVER_IS_GRANTEE';
  return null;
}

export type RemovalRefusal = 'GOV_MEMBERSHIP_NOT_FOUND' | 'GOV_REMOVE_SELF';
/** ONE person removes, at once (Q4-A): an active membership or a pending request; never their own row (another head removes them). */
export function removalRefusal(m: MembershipFacts | null, removerUserId: string): RemovalRefusal | null {
  if (!m || m.status === 'removed') return 'GOV_MEMBERSHIP_NOT_FOUND';
  if (m.userId === removerUserId) return 'GOV_REMOVE_SELF';
  return null;
}

/** The machine's legal moves — the one place they are written (the 0239 guard re-checks them in the database). */
export function nextStatus(from: MembershipStatus, act: 'approve' | 'remove'): MembershipStatus | null {
  if (act === 'approve') return from === 'requested' ? 'active' : null;
  return from === 'requested' || from === 'active' ? 'removed' : null;
}

export type GovSignInChoice = { kind: 'none' } | { kind: 'one'; authorityId: string } | { kind: 'choose'; authorityIds: string[] };
/** One live authority → it; several → a choice; a request for an authority the person does not belong to answers exactly like "none". */
export function chooseAuthority(memberOf: readonly string[], requested?: string | null): GovSignInChoice {
  const ids = [...new Set(memberOf)];
  if (requested) return ids.includes(requested) ? { kind: 'one', authorityId: requested } : { kind: 'none' };
  if (ids.length === 0) return { kind: 'none' };
  if (ids.length === 1) return { kind: 'one', authorityId: ids[0] };
  return { kind: 'choose', authorityIds: ids.sort() };
}

/** `••••••318` — six bullets and the last 3 digits (the 0239 SQL masks are the same shape). */
export function maskPhoneTail(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 4) return null;
  return `${'•'.repeat(6)}${digits.slice(-3)}`;
}

/** List page size: default 25, at most 100. */
export function clampGovLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(100, Math.floor(n));
}
