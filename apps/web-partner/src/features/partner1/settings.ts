// apps/web-partner/src/features/partner1/settings.ts · PC-56 PARTNER-1a · founder D5 — ORGANISATION SETTINGS, the pure pieces.
//   • the four partner roles and their label keys (the API's matrix: admin all · checker read + decide · maker read + review · viewer read);
//   • the reason rule of the team's acts (10–500 characters — the API's `REASON_MIN` / `REASON_MAX`, pinned by a parity spec);
//   • a refusal code → its sentence key, for the invite chain (W3008) and the revoke / remove confirms;
//   • the invite chain's steps (W3006 confirm → W3007 success → W3008 failure) — the code is shown ONCE in the success step and never put
//     in a URL, a cookie or storage (the chain is a client-side step machine; components/partner1/InviteChain.tsx).
export const PARTNER_ROLE_CODES = ['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer'] as const;
export type PartnerRoleCode = (typeof PARTNER_ROLE_CODES)[number];
export const isPartnerRoleCode = (v: unknown): v is PartnerRoleCode => typeof v === 'string' && (PARTNER_ROLE_CODES as readonly string[]).includes(v);
export const roleKey = (code: string) => (isPartnerRoleCode(code) ? `partner1.role.${code}` : 'partner1.settings.notRecorded');

/** The API's reason rule for revoking an invite / removing a member (identity/domain/verification-team.ts REASON_MIN / REASON_MAX). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export function reasonOk(raw: unknown): boolean {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX;
}

const INVITE_CODES = ['PARTNER_ALREADY_MEMBER', 'PARTNER_INVITE_PENDING_EXISTS', 'PARTNER_INVITE_PHONE_INVALID', 'PARTNER_ROLE_REQUIRED', 'PARTNER_PERMISSION_MISSING', 'RATE_LIMITED'] as const;
/** W3008 — a named refusal of the invite → its sentence (no seat limit exists for a partner, so there is no seat refusal). */
export function inviteErrorKey(code: string | null | undefined): string {
  return code && (INVITE_CODES as readonly string[]).includes(code) ? `partner1.invite.err.${code}` : 'partner1.invite.err.unknown';
}
const ACT_CODES = ['PARTNER_REASON_REQUIRED', 'PARTNER_LAST_ADMIN', 'PARTNER_REMOVE_SELF'] as const;
export function actErrorKey(code: string | null | undefined): string {
  return code && (ACT_CODES as readonly string[]).includes(code) ? `partner1.act.err.${code}` : 'partner1.act.err.unknown';
}

export type InviteStep = 'edit' | 'confirm' | 'success' | 'failure';
export const INVITE_STEP_FILES: Readonly<Record<Exclude<InviteStep, 'edit'>, string>> = Object.freeze({ confirm: 'W3006', success: 'W3007', failure: 'W3008' });

/** The settings page's act states (`?act=revoke_invite&id=…` / `?act=remove_member&id=…`, `?done=…`, `?failed=CODE`). */
export type SettingsAct = 'revoke_invite' | 'remove_member';
export function settingsAct(v: unknown): SettingsAct | null {
  return v === 'revoke_invite' || v === 'remove_member' ? v : null;
}
