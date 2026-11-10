// apps/web-gov/src/features/gov1/access.ts · PC-56 GOV-1a — the access page's PURE pieces (W359 + the access chain W3198–W3200). GOV-1 Q4-A
// (lead-applied 2026-11-10; the founder may reopen): every role ends on its date; a role is granted only when a second person approves it —
// never the requester, never the grantee; one head removes at once, with a reason, never their own row; every act recorded (GOV-0).
//
// The API (GET /v1/gov/members, `authority.members.read`, both roles) gives each membership with the person's NAME (or null) and the phone by
// its last 3 — the authority's own people, to the authority's own members (Q4-A). "Asked by" and "approved by" arrive as user ids: they are
// resolved to a name ONLY from the same list (never another read); the platform's appointment of a first head is said so.
import type { GovMe, GovMembership } from '@krishalaya/sdk-js';

export const GOV_ROLE_CODES = Object.freeze(['authority_head', 'authority_officer'] as const);
export const TERM_MONTHS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const);

/** The person as the list names them: the name the API gives, else the phone by its last 3. */
export const personLabel = (m: Pick<GovMembership, 'name' | 'phoneMasked'>): string => (m.name && m.name.trim() ? m.name : m.phoneMasked);

export type Who = { kind: 'you' } | { kind: 'platform' } | { kind: 'person'; label: string } | { kind: 'unlisted' } | { kind: 'none' };
/** A user id from the list: who it is, resolved only from the same list. */
export function whoOf(userId: string | null, rows: readonly GovMembership[], meUserId: string, platform = false): Who {
  if (platform) return { kind: 'platform' };
  if (!userId) return { kind: 'none' };
  if (userId === meUserId) return { kind: 'you' };
  const r = rows.find((x) => x.userId === userId);
  return r ? { kind: 'person', label: personLabel(r) } : { kind: 'unlisted' };
}

export type RowStatus = 'requested' | 'active' | 'ended' | 'removed';
/** The status in words: an active row past its end is ENDED (it grants nothing — GOV-0 `live`). */
export function rowStatus(m: Pick<GovMembership, 'status' | 'live'>): RowStatus {
  if (m.status === 'requested') return 'requested';
  if (m.status === 'removed') return 'removed';
  return m.live ? 'active' : 'ended';
}

const can = (me: GovMe, p: string) => me.person.permissions.includes(p);
/** APPROVE is offered only to a holder of `authority.members.approve` (a head) who is NEITHER the requester NOR the grantee, on a pending row. */
export function canOfferApprove(m: GovMembership, me: GovMe): boolean {
  if (!can(me, 'authority.members.approve')) return false;
  if (m.status !== 'requested') return false;
  if (m.requestedBy !== null && m.requestedBy === me.person.userId) return false;
  if (m.userId === me.person.userId) return false;
  return true;
}
/** REMOVE is offered only to a holder of `authority.members.remove` (a head), on a pending or active row, never their own. */
export function canOfferRemove(m: GovMembership, me: GovMe): boolean {
  if (!can(me, 'authority.members.remove')) return false;
  if (m.status === 'removed') return false;
  return m.userId !== me.person.userId;
}
/** Request is offered to any holder of `authority.members.request` (both roles). */
export const canRequest = (me: GovMe): boolean => can(me, 'authority.members.request');

/**
 * WHO COULD APPROVE A REQUEST NOW — a fact for the page, never a workaround. An approver is a LIVE head (active, unexpired). When the
 * viewer is the only live head, no one else here can approve a request; when there is no live head, no one can.
 */
export type ApproverFact = 'none' | 'only_you' | null;
export function approverFact(rows: readonly GovMembership[], meUserId: string): ApproverFact {
  const heads = new Set(rows.filter((r) => r.roleCode === 'authority_head' && r.status === 'active' && r.live).map((r) => r.userId));
  if (heads.size === 0) return 'none';
  if (heads.size === 1 && heads.has(meUserId)) return 'only_you';
  return null;
}

/** An instant from the API: its UTC date and minute, labelled (the OPS-3b `atText` rule: no zone is assumed). */
export function atUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** The access chain's confirm forms: what `?do=` names. `reread` is the PARITY-DECOR chain opened by the error state's Retry. */
export type AccessDo = 'request' | 'approve' | 'remove' | 'reread';
export function accessDo(raw: string | string[] | undefined): AccessDo | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'request' || v === 'approve' || v === 'remove' || v === 'reread' ? v : null;
}
export type AccessDone = 'requested' | 'approved' | 'removed';
export function accessDone(raw: string | string[] | undefined): AccessDone | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'requested' || v === 'approved' || v === 'removed' ? v : null;
}

/** Every refusal the access acts name (GOV-0 `gov-console.errors.ts`), its key; anything else: the generic one. */
export const ACCESS_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  GOV_ROLE_REQUIRED: 'gov1.access.err.role',
  GOV_TERM_INVALID: 'gov1.access.err.term',
  GOV_REASON_REQUIRED: 'gov1.access.err.reason',
  GOV_PHONE_INVALID: 'gov1.access.err.phone',
  GOV_PERSON_UNKNOWN: 'gov1.access.err.personUnknown',
  GOV_ALREADY_REQUESTED: 'gov1.access.err.alreadyRequested',
  GOV_MEMBERSHIP_NOT_FOUND: 'gov1.access.err.notFound',
  GOV_REQUEST_NOT_PENDING: 'gov1.access.err.notPending',
  GOV_APPROVER_IS_REQUESTER: 'gov1.access.err.approverIsRequester',
  GOV_APPROVER_IS_GRANTEE: 'gov1.access.err.approverIsGrantee',
  GOV_APPROVER_NOT_HEAD: 'gov1.access.err.approverNotHead',
  GOV_REQUESTER_NOT_MEMBER: 'gov1.access.err.requesterNotMember',
  GOV_REMOVE_SELF: 'gov1.access.err.removeSelf',
  GOV_REMOVER_NOT_HEAD: 'gov1.access.err.removerNotHead',
  GOV_PERMISSION_MISSING: 'gov1.access.err.permission',
  GOV_SESSION_ENDED: 'gov1.access.err.sessionEnded',
  ACCESS_FAILED: 'gov1.access.err.failed',
});
export const accessErrorCode = (raw: string | string[] | undefined): string => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && ACCESS_ERRORS[v] ? v : 'ACCESS_FAILED';
};
