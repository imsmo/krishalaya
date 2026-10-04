// modules/identity/domain/verification-team.ts · PC-56 TENANT-SW-c · VERIFICATION DESK & TEAM — the pure rules (no IO).
//
// Everything here is a decision the services and the console share; every list mirrors 0199 (a unit spec reads the migration text
// and fails on drift). Founder decisions 2026-10-04: STAFF SEATS PER PLAN · SMS INVITE TOKEN · TOTP 2FA FOR STAFF · STAFF
// SELF-DECLARE CONFLICTS + ONBOARDER RULE, BOTH MECHANICALLY RECUSED.
import { createHash, randomBytes } from 'node:crypto';

// ───────────────────────────────────────────── A · the verification desk
/** W157 "Take next": a claim lives 15 minutes (0199 `ck_kc_window`). */
export const CLAIM_MINUTES = 15;
/** W158 "Skip (take next)" — the coded reasons (0199 `ck_kc_skip_reason`). `other` needs words (≥ 10). */
export const SKIP_REASONS = ['needs_specialist', 'evidence_unclear', 'language', 'conflict_to_declare', 'other'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const isSkipReason = (v: unknown): v is SkipReason => typeof v === 'string' && (SKIP_REASONS as readonly string[]).includes(v);
export function skipRefusal(code: unknown, note: unknown): string | null {
  if (!isSkipReason(code)) return 'SKIP_REASON_REQUIRED';
  const n = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (code === 'other' && n.length < 10) return 'SKIP_REASON_REQUIRED';
  if (n.length > 300) return 'SKIP_REASON_REQUIRED';
  return null;
}
/** The recusal codes 0199 raises (`kv_kyc_recusal`). */
export const RECUSAL_CODES = ['KYC_RECUSED_DECLARED', 'KYC_RECUSED_ONBOARDER'] as const;
export type RecusalCode = (typeof RECUSAL_CODES)[number];
export const isRecusalCode = (v: unknown): v is RecusalCode => typeof v === 'string' && (RECUSAL_CODES as readonly string[]).includes(v);

/** The median verify time tile (W157 "Median verify time (7d)"): seconds → a whole number of minutes/hours/days, or null. */
export const MEDIAN_WINDOW_DAYS = 7;
export function medianLabel(seconds: number | null): { value: number; unit: 'minutes' | 'hours' | 'days' } | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 3600) return { value: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
  if (seconds < 86_400 * 2) return { value: Math.round(seconds / 3600), unit: 'hours' };
  return { value: Math.round(seconds / 86_400), unit: 'days' };
}

/** "being reviewed by <masked>" — a first name's initial and the rest masked; never a phone, never a full name. */
export function maskName(name: string | null | undefined): string {
  const n = String(name ?? '').trim();
  if (!n) return '••••';
  const first = n.split(/\s+/)[0];
  return `${first.slice(0, 1).toUpperCase()}${'•'.repeat(Math.max(2, Math.min(6, first.length - 1)))}`;
}

/** Canon elements this platform cannot back — each a sentence on the page (`swc.refused.<key>`), never a fake. */
export const VERIFICATION_REFUSED_BY_NAME = ['kycCamp', 'aiPrecheck', 'attestationPath', 'nameInference', 'listingGate'] as const;

// ───────────────────────────────────────────── A3 · conflicts
export const CONFLICT_RELATIONS = ['family', 'household', 'business', 'other'] as const;
export type ConflictRelation = (typeof CONFLICT_RELATIONS)[number];
export const isConflictRelation = (v: unknown): v is ConflictRelation => typeof v === 'string' && (CONFLICT_RELATIONS as readonly string[]).includes(v);
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const cleanReason = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export function reasonRefusal(s: unknown): 'REASON_REQUIRED' | null {
  const r = cleanReason(s);
  return r.length >= REASON_MIN && r.length <= REASON_MAX ? null : 'REASON_REQUIRED';
}
export function conflictRefusals(input: { relation?: unknown; relationNote?: unknown; reason?: unknown; memberUserId?: unknown; staffUserId?: string }): string[] {
  const out: string[] = [];
  if (!isConflictRelation(input.relation)) out.push('CONFLICT_RELATION');
  else if (input.relation === 'other' && cleanReason(input.relationNote).length < 3) out.push('CONFLICT_RELATION_NOTE');
  if (reasonRefusal(input.reason)) out.push('REASON_REQUIRED');
  if (typeof input.memberUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.memberUserId)) out.push('CONFLICT_MEMBER_REQUIRED');
  else if (input.staffUserId && input.memberUserId === input.staffUserId) out.push('CONFLICT_SELF');
  return out;
}

// ───────────────────────────────────────────── B1 · seats
/** The staff set (0199 `roles.is_staff`, set by name — the 4d-1 meter's five). The DB column is the authority; this mirrors it. */
export const STAFF_ROLE_CODES = ['tenant_admin', 'tenant_staff', 'support_agent', 'auditor', 'fpo_coordinator'] as const;
/** The plan defaults 0199 / rules-0201 seed (`plan_features.staff_seats`). null = unlimited. */
export const SEAT_DEFAULTS: Readonly<Record<string, number | null>> = Object.freeze({ starter: 3, growth: 10, professional: 25, enterprise: null, government: null });

export type SeatState =
  | { kind: 'limited'; used: number; seats: number; planName: string; full: boolean }
  | { kind: 'unlimited'; used: number; planName: string }
  | { kind: 'no_plan'; used: number }
  | { kind: 'not_defined'; used: number; planName: string };
export function seatState(used: number, plan: { planName: string; seats: number | null; defined: boolean } | null): SeatState {
  if (!plan) return { kind: 'no_plan', used };
  if (!plan.defined) return { kind: 'not_defined', used, planName: plan.planName };
  if (plan.seats === null) return { kind: 'unlimited', used, planName: plan.planName };
  return { kind: 'limited', used, seats: plan.seats, planName: plan.planName, full: used >= plan.seats };
}

// ───────────────────────────────────────────── B2 · invites
export const INVITE_DAYS = 7;
/** The raw token: 32 random bytes, base64url (43 chars). Returned ONCE; only sha256(token) is kept for lookup. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: inviteTokenHash(token) };
}
export const inviteTokenHash = (token: string) => createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
export const looksLikeInviteToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
/** +91 98•••••412 — the country code, the first two and the last three digits; never the whole number in a read or an audit row. */
export function maskPhone(phone: string | null | undefined): string {
  const p = String(phone ?? '').replace(/\s+/g, '');
  if (!/^\+\d{8,15}$/.test(p)) return p ? '•••' : '';
  const cc = p.startsWith('+91') ? '+91' : p.slice(0, 3);
  const rest = p.slice(cc.length);
  return `${cc} ${rest.slice(0, 2)}${'•'.repeat(Math.max(1, rest.length - 5))}${rest.slice(-3)}`;
}
/** The accept link, or (no console URL configured) null — the SMS then carries the code to type in the console. */
export function inviteLink(base: string | null | undefined, token: string): string | null {
  const b = String(base ?? '').trim().replace(/\/+$/, '');
  return b && /^https?:\/\//.test(b) ? `${b}/invite?t=${encodeURIComponent(token)}` : null;
}
export const INVITE_CHANNELS = ['sms'] as const;   // WhatsApp: no provider connected (8e) — refused by name

// ───────────────────────────────────────────── B3 · 2FA
export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODE_COUNT = 10;
/** A pending-2FA sign-in must finish within this many seconds of the OTP step. */
export const TWO_FACTOR_CHALLENGE_SECONDS = 300;
/** Routes a staff member without confirmed 2FA can still reach when the tenant requires it (the route prefixes, after /v1). */
export const TWO_FACTOR_EXEMPT_PREFIXES = ['/me/2fa', '/auth/'] as const;

// ───────────────────────────────────────────── B4 · maker-checker pairs (W183 "Maker-checker pairs live here")
/** Each rule the platform ENFORCES with a second person, and the permission that makes and the one that checks. The people are
 *  derived from effective permissions at read time — never typed. `checkerRole` means the checker must also hold that role
 *  (the trigger checks `kv_is_tenant_admin`). */
export interface MakerCheckerRule { code: string; maker: string; checker: string; checkerRole: 'tenant_admin' | null; enforcedBy: string }
export const MAKER_CHECKER_RULES: readonly MakerCheckerRule[] = Object.freeze([
  { code: 'payout_batches', maker: 'payout.prepare', checker: 'payout.approve', checkerRole: null, enforcedBy: '0143 payout batch checker' },
  { code: 'ambassador_runs', maker: 'ambassador.payout.prepare', checker: 'ambassador.payout', checkerRole: 'tenant_admin', enforcedBy: '0198 trg_apr_moves' },
  { code: 'wage_advances', maker: 'labour.desk', checker: 'advance.approve', checkerRole: null, enforcedBy: '0198 assert_worker_advance_moves' },
  { code: 'commission_rules', maker: 'commission.manage', checker: 'commission.manage', checkerRole: 'tenant_admin', enforcedBy: '0196 trg_crp_moves' },
  { code: 'zone_changes', maker: 'logistics.zones.manage', checker: 'logistics.zones.manage', checkerRole: 'tenant_admin', enforcedBy: '0196 trg_dzp_moves' },
  { code: 'trust_settings', maker: 'tenant.settings', checker: 'tenant.settings', checkerRole: 'tenant_admin', enforcedBy: '0192 trg_tsp_moves' },
  { code: 'desk_changes', maker: 'desk.manage', checker: 'desk.manage', checkerRole: 'tenant_admin', enforcedBy: '0192 trg_dcp_moves' },
  { code: 'privileged_overrides', maker: 'user.approve', checker: 'user.approve', checkerRole: 'tenant_admin', enforcedBy: '0199 trg_sop_moves' },
  { code: 'kyc_decisions', maker: 'kyc.manage', checker: 'kyc.review', checkerRole: null, enforcedBy: '0180 trg_kyc_documents_guard + 0199 trg_kyc_recusal' },
] as MakerCheckerRule[]);

/** Pair people from effective permission sets: who holds the maker code, who can check (holds the checker code, and the role). */
export function makerCheckerPairs(
  staff: ReadonlyArray<{ userId: string; name: string | null; permissions: ReadonlySet<string>; roles: readonly string[] }>,
  rules: readonly MakerCheckerRule[] = MAKER_CHECKER_RULES,
): Array<{ code: string; enforcedBy: string; makers: Array<{ userId: string; name: string | null }>; checkers: Array<{ userId: string; name: string | null }>; live: boolean }> {
  return rules.map((r) => {
    const makers = staff.filter((s) => s.permissions.has(r.maker)).map((s) => ({ userId: s.userId, name: s.name }));
    const checkers = staff.filter((s) => s.permissions.has(r.checker) && (!r.checkerRole || s.roles.includes(r.checkerRole))).map((s) => ({ userId: s.userId, name: s.name }));
    // live = there is at least one maker AND at least one checker who is a different person from some maker
    const live = makers.length > 0 && checkers.some((c) => makers.some((m) => m.userId !== c.userId));
    return { code: r.code, enforcedBy: r.enforcedBy, makers, checkers, live };
  });
}

// ───────────────────────────────────────────── C1 · overrides
/** The codes a per-staff override GRANTS only with a second tenant_admin (0199 `override_checker_codes` — the DB is the gate). */
export const OVERRIDE_CHECKER_CODES: Readonly<Record<string, 'money' | 'pii'>> = Object.freeze({
  'payout.prepare': 'money', 'ambassador.payout.prepare': 'money', 'ambassador.payout': 'money', 'advance.approve': 'money',
  'order.refund': 'money', 'dispute.resolve': 'money', 'settlement.close': 'money', 'payments.credit_note.issue': 'money',
  'loan.manage': 'money', 'wallet.view': 'money', 'wallet.org_view': 'money', 'ledger.read': 'money',
  'member.pii.reveal': 'pii', 'member.view360': 'pii', 'export.manage': 'pii', 'kyc.review': 'pii', 'kyc.manage': 'pii',
});
export const overrideNeedsChecker = (code: string) => Object.prototype.hasOwnProperty.call(OVERRIDE_CHECKER_CODES, code);

/** W184 "Recent privileged actions": the audit action prefixes counted as privileged (staff acts on money, people, access). */
export const PRIVILEGED_ACTION_PREFIXES = [
  'role.', 'staff.', 'kyc.document.', 'member.', 'payout', 'ambassador.run', 'wallet.', 'settlement', 'refund', 'order.refund',
  'export', 'tenant_setting', 'desk.', 'team.', 'two_factor.', 'commission', 'advance', 'audit.entry.revealed',
] as const;
export const isPrivilegedAction = (action: string) => PRIVILEGED_ACTION_PREFIXES.some((p) => action.startsWith(p));

// ───────────────────────────────────────────── C2 · removal
/** The sentence W184 prints instead of the canon's typed "60s": the REAL bound (posture cache TTL; the access TTL is longer). */
export const SESSION_POSTURE_CACHE_SECONDS = 30;
export function removeRefusals(input: { actorUserId: string; targetUserId: string; targetIsAdmin: boolean; activeAdmins: number; reason: unknown }): string[] {
  const out: string[] = [];
  if (reasonRefusal(input.reason)) out.push('REASON_REQUIRED');
  if (input.actorUserId === input.targetUserId) out.push('REMOVE_SELF');
  if (input.targetIsAdmin && input.activeAdmins <= 1) out.push('LAST_ADMIN');
  return out;
}
