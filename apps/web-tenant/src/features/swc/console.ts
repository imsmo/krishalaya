// apps/web-tenant/src/features/swc/console.ts · PC-56 TENANT-SW-c · VERIFICATION DESK & TEAM in the console — PURE helpers (no IO).
//
// W157 `/people/verification` (take next, the median, recusal printed) · W158 `/people/verification/[id]` (recusal banner, claim + skip,
// what verifying unlocks — read, evidence reuse) · W183 `/settings/team` (seats, staff, maker-checker pairs, invites) · W184
// `/settings/team/[id]` (roles, desks, overrides WITH why, 2FA, conflicts, privileged actions, remove) · `/me/security` (own 2FA + own
// conflicts) · `/invite` (accept) · the 2FA step of `/login`. Every list mirrors the API's own (the console spec reads the API source).
import type { SeatState } from '@krishalaya/sdk-js';

export const VERIFICATION_HREF = '/people/verification';
export const TEAM_HREF = '/settings/team';
export const TEAM_INVITE_HREF = `${TEAM_HREF}/invite`;
export const TEAM_ACT_HREF = `${TEAM_HREF}/act`;
export const ME_SECURITY_HREF = '/me/security';
export const INVITE_ACCEPT_HREF = '/invite';
export const DESKS_HREF = `${TEAM_HREF}/desks`;
export const staffHref = (userId: string) => `${TEAM_HREF}/${encodeURIComponent(userId)}`;
export const memberHref = (userId: string) => `/people/${encodeURIComponent(userId)}`;
export const staffActHref = (userId: string, act: StaffAct, extra: Record<string, string> = {}) =>
  `${staffHref(userId)}/act?${new URLSearchParams({ act, step: 'confirm', ...extra }).toString()}`;
export const teamActHref = (act: TeamAct, extra: Record<string, string> = {}) => `${TEAM_ACT_HREF}?${new URLSearchParams({ act, step: 'confirm', ...extra }).toString()}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isIdemKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v);
export const isPermCode = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_.]{1,79}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

// ───────────────────────────────────────── the desk (W157 / W158)
/** The API's skip reasons (domain/verification-team.ts SKIP_REASONS). */
export const SKIP_REASONS = ['needs_specialist', 'evidence_unclear', 'language', 'conflict_to_declare', 'other'] as const;
export const isSkipReason = (v: unknown): v is (typeof SKIP_REASONS)[number] => oneOf(SKIP_REASONS, v);
export const RECUSAL_CODES = ['KYC_RECUSED_DECLARED', 'KYC_RECUSED_ONBOARDER'] as const;
/** Canon elements with no backend — each a sentence on the page (`swc.refused.<key>`), never drawn as if real. */
export const VERIFICATION_REFUSED_BY_NAME = ['kycCamp', 'aiPrecheck', 'attestationPath', 'nameInference', 'listingGate'] as const;
/** The median tile: seconds → { value, unit } (whole minutes under an hour, hours under two days, else days) — the API's rule. */
export function medianLabel(seconds: number | null | undefined): { value: number; unit: 'minutes' | 'hours' | 'days' } | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 3600) return { value: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
  if (seconds < 86_400 * 2) return { value: Math.round(seconds / 3600), unit: 'hours' };
  return { value: Math.round(seconds / 86_400), unit: 'days' };
}
export const recusalKey = (code: string | null | undefined) => (code === 'KYC_RECUSED_ONBOARDER' ? 'swc.recusal.onboarder' : code === 'KYC_RECUSED_DECLARED' ? 'swc.recusal.declared' : null);
export const purposeKey = (p: string) => (/^[a-z_]{2,40}$/.test(p) ? `swc.purpose.${p}` : 'swc.purpose.other');
export const PURPOSES = ['settlement', 'wage', 'dividend', 'patronage_bonus', 'loan_disbursal', 'course_royalty'] as const;
export const knownPurposeKey = (p: string) => ((PURPOSES as readonly string[]).includes(p) ? `swc.purpose.${p}` : 'swc.purpose.other');

// ───────────────────────────────────────── the team (W183 / W184)
export const TEAM_ACTS = ['invite', 'revoke_invite', 'add_directly', 'retry'] as const;
export type TeamAct = (typeof TEAM_ACTS)[number];
export const isTeamAct = (v: unknown): v is TeamAct => oneOf(TEAM_ACTS, v);
export const STAFF_ACTS = ['override', 'revoke_override', 'remove', 'declare_conflict', 'lift_conflict', 'confirm_proposal', 'refuse_proposal', 'retry'] as const;
export type StaffAct = (typeof STAFF_ACTS)[number];
export const isStaffAct = (v: unknown): v is StaffAct => oneOf(STAFF_ACTS, v);
/** "Retry" on the canon's chains (W2337, W2774) re-reads a page; it is not a state change. Refused by name. */
export function retryIsMutation(): false { return false; }
export const CONFLICT_RELATIONS = ['family', 'household', 'business', 'other'] as const;
export const isConflictRelation = (v: unknown): v is (typeof CONFLICT_RELATIONS)[number] => oneOf(CONFLICT_RELATIONS, v);
export const INVITE_LANGUAGES = ['en', 'hi', 'gu'] as const;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const reasonOk = (s: string | null | undefined) => { const n = String(s ?? '').replace(/\s+/g, ' ').trim().length; return n >= REASON_MIN && n <= REASON_MAX; };

/** The seats tile, as words: "N of M staff seats (<plan>)" · "N staff — unlimited (<plan>)" · no plan / no seat row. */
export function seatTile(s: SeatState): { key: string; vars: Record<string, string | number> } {
  switch (s.kind) {
    case 'limited': return { key: s.full ? 'swc.seats.full' : 'swc.seats.limited', vars: { used: s.used, seats: s.seats, plan: s.planName } };
    case 'unlimited': return { key: 'swc.seats.unlimited', vars: { used: s.used, plan: s.planName } };
    case 'not_defined': return { key: 'swc.seats.notDefined', vars: { used: s.used, plan: s.planName } };
    default: return { key: 'swc.seats.noPlan', vars: { used: s.used } };
  }
}
export const twoFactorKey = (s: string) => (oneOf(['confirmed', 'pending', 'not_enrolled'] as const, s) ? `swc.tfa.${s}` : 'swc.tfa.not_enrolled');
export const pairKey = (code: string) => `swc.pair.${/^[a-z_]{2,40}$/.test(code) ? code : 'other'}`;
export const PAIR_CODES = ['payout_batches', 'ambassador_runs', 'wage_advances', 'commission_rules', 'zone_changes', 'trust_settings', 'desk_changes', 'privileged_overrides', 'kyc_decisions'] as const;
export const inviteStatusKey = (s: string) => (oneOf(['pending', 'accepted', 'expired', 'revoked'] as const, s) ? `swc.invite.status.${s}` : 'swc.invite.status.pending');
export const relationKey = (r: string) => (isConflictRelation(r) ? `swc.relation.${r}` : 'swc.relation.other');
export const skipReasonKey = (r: string) => (isSkipReason(r) ? `swc.skip.${r}` : 'swc.skip.other');

/** W184 "Recent privileged actions": the audit action prefixes counted as privileged — the API's PRIVILEGED_ACTION_PREFIXES. */
export const PRIVILEGED_ACTION_PREFIXES = [
  'role.', 'staff.', 'kyc.document.', 'member.', 'payout', 'ambassador.run', 'wallet.', 'settlement', 'refund', 'order.refund',
  'export', 'tenant_setting', 'desk.', 'team.', 'two_factor.', 'commission', 'advance', 'audit.entry.revealed',
] as const;
export const isPrivilegedAction = (action: string) => PRIVILEGED_ACTION_PREFIXES.some((p) => action.startsWith(p));

/** The session-end sentence: the REAL bound the API reports (never the canon's typed "60s"). */
export function sessionBoundVars(sessionEndBoundSec: number, accessTokenTtlSec: number): { sec: number; ttlMin: number } {
  return { sec: sessionEndBoundSec, ttlMin: Math.max(1, Math.round(accessTokenTtlSec / 60)) };
}

// ───────────────────────────────────────── refusals → sentences
/** Every code the SW-c API can name (`swc.code.<CODE>`, en / hi / gu) — the API's SWC_CODES keys plus the shared ones. */
export const SWC_CODES = [
  'STAFF_SEATS_EXHAUSTED', 'KYC_RECUSED_DECLARED', 'KYC_RECUSED_ONBOARDER', 'MAKER_IS_CHECKER', 'OWN_DOCUMENT', 'KYC_CLAIM_NOT_YOURS', 'KYC_CLAIM_NOT_PENDING',
  'KYC_CLAIM_FINAL', 'KYC_CLAIM_NOT_STALE', 'KYC_CLAIM_BORN_LIVE', 'KYC_NOT_FOUND', 'CLAIM_NOT_FOUND', 'SKIP_REASON_REQUIRED', 'CONFLICT_FINAL', 'CONFLICT_BORN_ACTIVE',
  'CONFLICT_NOT_YOURS', 'CONFLICT_RECORDER_NOT_ADMIN', 'CONFLICT_MEMBER_NOT_IN_TENANT', 'CONFLICT_STAFF_NOT_STAFF', 'CONFLICT_SELF_LIFT', 'CONFLICT_LIFTER_NOT_ADMIN',
  'CONFLICT_ALREADY_DECLARED', 'CONFLICT_INVALID', 'CONFLICT_NOT_FOUND', 'INVITE_FINAL', 'INVITE_BORN_PENDING', 'INVITE_ROLE_NOT_STAFF', 'INVITE_NOT_ADMIN',
  'INVITE_ALREADY_USED', 'INVITE_EXPIRED', 'INVITE_NOT_YOURS', 'INVITE_NOT_STALE', 'INVITE_NOT_FOUND', 'INVITE_PENDING_EXISTS', 'INVITE_PHONE_INVALID',
  'INVITE_ALREADY_STAFF', 'INVITE_OTP_INVALID', 'INVITE_DESK_INVALID', 'WHATSAPP_NOT_CONNECTED', 'TOTP_FINAL', 'TOTP_BORN_UNCONFIRMED', 'TOTP_ALREADY_CONFIRMED',
  'TOTP_REPLAY', 'TOTP_INVALID', 'TOTP_NOT_ENROLLED', 'TOTP_NOT_CONFIRMED', 'RECOVERY_CODE_USED', 'RECOVERY_CODE_INVALID', 'RECOVERY_CODE_FINAL', 'RECOVERY_CODE_BORN_LIVE', 'TWO_FACTOR_CHALLENGE_INVALID',
  'OVERRIDE_NEEDS_CHECKER', 'OVERRIDE_CHECKER_IS_MAKER', 'OVERRIDE_CHECKER_IS_GRANTEE', 'OVERRIDE_NOT_ADMIN', 'OVERRIDE_PROPOSAL_FINAL', 'OVERRIDE_PROPOSAL_BORN',
  'OVERRIDE_PROPOSAL_EXPIRED', 'OVERRIDE_PROPOSAL_NOT_STALE', 'OVERRIDE_PROPOSAL_NOT_FOUND', 'OVERRIDE_PROPOSAL_LIVE', 'OVERRIDE_FINAL', 'OVERRIDE_NOT_FOUND',
  'NEEDS_SECOND_ADMIN', 'ROLE_NOT_FOUND', 'LAST_ADMIN', 'REMOVE_SELF', 'TEAM_RESTRICTED', 'STAFF_NOT_FOUND', 'REASON_REQUIRED', 'TWO_FACTOR_REQUIRED', 'SESSION_REVOKED',
  // shared / transport
  'VALIDATION_FAILED', 'FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'TWO_FACTOR_PENDING', 'unknown',
] as const;
export const swcCodeKey = (code: string) => ((SWC_CODES as readonly string[]).includes(code) ? `swc.code.${code}` : 'swc.code.unknown');
export function codesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown } | string> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) {
    return [...new Set(refusals.map((r) => { const c = typeof r === 'string' ? r : r?.code; return typeof c === 'string' && /^[A-Z_]{2,40}$/.test(c) ? c : 'unknown'; }))].slice(0, 8);
  }
  if (code && /^[A-Za-z_]{2,40}$/.test(code)) return [code];
  if (status === 403) return ['FORBIDDEN'];
  return ['unknown'];
}
export const parseCodes = (raw: string | undefined) => (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8);
export type SwcPageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
export function swcPageState(code: string | undefined, status?: number, forId = false): SwcPageState {
  if (code === 'TEAM_RESTRICTED' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (code === 'STAFF_NOT_FOUND' || (status === 404 && forId)) return 'notFound';
  if (status === 404) return 'flaggedOff';
  return 'error';
}
