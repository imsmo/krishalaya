// apps/web-partner/src/features/partner1/keys.ts · PC-56 PARTNER-1b · founder D1 — THE PARTNER'S OWN API KEYS, the pure pieces. PURE.
//   • the revoke reason rule — 20–300 characters once whitespace is collapsed (the API's `KEY_REVOKE_REASON_MIN` / `MAX`, pinned by the
//     parity spec; the API and 0227's definer refuse the same bounds);
//   • a key's status words (active / not active / revoked on <date>);
//   • the revoke chain's state from the query (`?act=revoke&id=…` confirm W2911 · `&state=success` W2912 · `&state=failure&code=…` W2913) —
//     the REASON is typed on the confirm step and travels in the form body only, never in a URL; the Idempotency-Key is minted at render;
//   • a refusal code → its sentence key.
import { formatDate } from '@krishalaya/i18n';

export const KEY_REVOKE_REASON_MIN = 20;
export const KEY_REVOKE_REASON_MAX = 300;
export function keyReasonOk(raw: unknown): boolean {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return r.length >= KEY_REVOKE_REASON_MIN && r.length <= KEY_REVOKE_REASON_MAX;
}

export type KeyStatus = 'active' | 'inactive' | 'revoked';
/** The status words of a key: "Active", "Not active", or "Revoked on <date>" (India time). */
export function keyStatusText(t: { t(k: string, v?: Record<string, string | number>): string }, k: { status: KeyStatus | string; revokedAt: string | null }, lang: string): string {
  if (k.status === 'revoked') {
    return k.revokedAt ? t.t('partner1.keys.status.revokedOn', { date: formatDate(k.revokedAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) }) : t.t('partner1.keys.status.revoked');
  }
  return t.t(k.status === 'active' ? 'partner1.keys.status.active' : 'partner1.keys.status.inactive');
}

export type RevokeStep = 'confirm' | 'success' | 'failure';
export const REVOKE_STEP_FILES: Readonly<Record<RevokeStep, string>> = Object.freeze({ confirm: 'W2911', success: 'W2912', failure: 'W2913' });
type SP = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
/** The revoke chain's state from the page's query, or null for the page itself. Only `act`, `id`, `state` and `code` are read. */
export function revokeState(sp: SP): { id: string; step: RevokeStep; code: string | null } | null {
  if (one(sp?.act) !== 'revoke') return null;
  const id = one(sp?.id);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const st = one(sp?.state);
  const step: RevokeStep = st === 'success' ? 'success' : st === 'failure' ? 'failure' : 'confirm';
  const code = one(sp?.code);
  return { id, step, code: step === 'failure' && code && /^[A-Z_]{3,60}$/.test(code) ? code : step === 'failure' ? 'unknown' : null };
}

const REVOKE_CODES = ['PARTNER_KEY_NOT_FOUND', 'PARTNER_KEY_ALREADY_REVOKED', 'PARTNER_KEY_REASON_REQUIRED', 'PARTNER_PERMISSION_MISSING', 'PARTNER_IDEMPOTENCY_KEY_REQUIRED', 'RATE_LIMITED'] as const;
/** W2913 — a named refusal of the revoke → its sentence; anything else → "it could not be revoked; nothing changed". */
export function revokeErrorKey(code: string | null | undefined): string {
  return code && (REVOKE_CODES as readonly string[]).includes(code) ? `partner1.keys.err.${code}` : 'partner1.keys.err.unknown';
}
