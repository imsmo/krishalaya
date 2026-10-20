// modules/partner-console/domain/partner-console.rules.ts · PC-56 PARTNER-0 · the PURE pieces of the partner realm (unit-tested, no I/O).
//
//   • the permission matrix (mirrors 0225 / seed core/0004 — the database is the authority; this copy exists so the spec can pin it);
//   • the sign-in chooser rule (founder D1): exactly one active partner → minted; several → a chooser; none → refused (enumeration-safe);
//   • the invite's state (single use, 7 days, revoked);
//   • the masks: a regulator reference shows only its last 4; a phone only its last 3 (`••••••318`, founder D2);
//   • which permission a decision needs (maker reviews, checker decides).
export const PARTNER_PERMISSIONS = Object.freeze([
  'partner.applications.read', 'partner.applications.review', 'partner.applications.decide', 'partner.team.manage',
  'partner.keys.read', 'partner.keys.revoke', 'partner.webhooks.read', 'partner.settings.read', 'partner.insurance.read', 'partner.claims.read',
] as const);
export type PartnerPermission = (typeof PARTNER_PERMISSIONS)[number];
export const PARTNER_ROLES = Object.freeze(['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer'] as const);
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/** THE MATRIX (founder D1 + PARTNER-0's `review` verb for the maker; PC-56 PARTNER-1b · 0227: every partner role READS its organisation's keys
 *  and webhooks — `partner.keys.read`, `partner.webhooks.read` — and only the administrator REVOKES a key; PC-56 PARTNER-2a · 0228: every partner
 *  role reads its insurer organisation's own book — `partner.insurance.read`, policy facts only; PC-56 PARTNER-3a · 0230: every partner role reads
 *  the claims on its insurer organisation's own products — `partner.claims.read`, claim facts only, never a claimant). */
export const PARTNER_ROLE_MATRIX: Readonly<Record<PartnerRole, readonly PartnerPermission[]>> = Object.freeze({
  partner_admin: PARTNER_PERMISSIONS,
  partner_checker: ['partner.applications.read', 'partner.applications.decide', 'partner.keys.read', 'partner.webhooks.read', 'partner.insurance.read', 'partner.claims.read'],
  partner_maker: ['partner.applications.read', 'partner.applications.review', 'partner.keys.read', 'partner.webhooks.read', 'partner.insurance.read', 'partner.claims.read'],
  partner_viewer: ['partner.applications.read', 'partner.keys.read', 'partner.webhooks.read', 'partner.insurance.read', 'partner.claims.read'],
});

export const isPartnerRole = (v: unknown): v is PartnerRole => typeof v === 'string' && (PARTNER_ROLES as readonly string[]).includes(v);

/** A decision act → the permission it needs: the maker starts a review, the checker approves or rejects. */
export function decisionPermission(kind: 'review' | 'approve' | 'reject'): PartnerPermission {
  return kind === 'review' ? 'partner.applications.review' : 'partner.applications.decide';
}

export type SignInChoice = { kind: 'none' } | { kind: 'one'; partnerId: string } | { kind: 'choose'; partnerIds: string[] };
/**
 * THE CHOOSER RULE. `memberOf` = the distinct partners in which the person holds an ACTIVE membership (of an active partner); `requested` =
 * the partner the caller asked for (the second verify). A request for a partner the person is not a member of is answered exactly like
 * "no partner" — the caller learns nothing about which organisations exist.
 */
export function chooseSignIn(memberOf: readonly string[], requested?: string | null): SignInChoice {
  const ids = [...new Set(memberOf)];
  if (requested) return ids.includes(requested) ? { kind: 'one', partnerId: requested } : { kind: 'none' };
  if (ids.length === 0) return { kind: 'none' };
  if (ids.length === 1) return { kind: 'one', partnerId: ids[0] };
  return { kind: 'choose', partnerIds: ids.sort() };
}

export type InviteState = 'usable' | 'used' | 'revoked' | 'expired';
/** One answer used by BOTH the pre-check (before an OTP is spent) and the in-transaction re-check (under the row lock). */
export function inviteState(inv: { status: string; expiresAt: string | Date }, nowMs: number = Date.now()): InviteState {
  if (inv.status === 'accepted') return 'used';
  if (inv.status === 'revoked') return 'revoked';
  if (inv.status === 'expired' || new Date(inv.expiresAt).getTime() <= nowMs) return 'expired';
  return 'usable';
}

/** `••••4471` — a regulator reference is printed by its last 4 only (founder D2 spirit; never the whole licence number). */
export function maskRegulatorRef(ref: string | null | undefined): string | null {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  return `••••${r.slice(-4)}`;
}

/** `••••••318` — six bullets and the last 3 digits (the SQL `partner_applicant_phone_masked` shape, for the person's own /me). */
export function maskPhoneTail(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 4) return null;
  return `${'•'.repeat(6)}${digits.slice(-3)}`;
}

/** List page size: default 25, at most 100 (the partner console's read; the machine realm clamps at 200). */
export function clampPartnerLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(100, Math.floor(n));
}

/** The application statuses a partner may filter by (the state machine's subset; `reviewQueue` = submitted + under_review). */
export const PARTNER_APP_STATUSES = Object.freeze(['submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'disbursed'] as const);
export const isPartnerAppStatus = (v: unknown): v is (typeof PARTNER_APP_STATUSES)[number] => typeof v === 'string' && (PARTNER_APP_STATUSES as readonly string[]).includes(v);
