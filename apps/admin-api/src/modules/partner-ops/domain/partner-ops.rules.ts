// apps/admin-api/src/modules/partner-ops/domain/partner-ops.rules.ts · PC-56 PARTNER-1a (founder D2 + D3).
//
// The pure half of the partner registry: the reason floor, the SLA merge, the invite token, and the two masks. No I/O —
// everything here is unit-tested without a database.
import { createHash, randomBytes } from 'node:crypto';

/** Twenty characters — the same floor settings-ops puts on a platform change. A partner's decision promise is read by
 *  every farmer who applies to them, and a three-word reason on that is a decision nobody wrote down. */
export const PARTNER_OPS_REASON_MIN = 20;

/** The upper bound on a published decision promise: 30 days. Anything longer is not a promise a farmer can plan on. */
export const SLA_DECISION_HOURS_MAX = 720;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** `sla->'decision_hours'` when it is an integer >= 1, else null. A zero, a fraction, a string or a missing key is "no
 *  published promise" — the console must never render `0 h` as a commitment. */
export function slaDecisionHours(sla: unknown): number | null {
  if (!sla || typeof sla !== 'object' || Array.isArray(sla)) return null;
  const v = (sla as Record<string, unknown>).decision_hours;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/** The next `sla` jsonb: the old object with `decision_hours` set, or the key REMOVED when `hours` is null. Every other
 *  key (disbursal / claim TATs written by owner SQL) is kept exactly — this route owns one key, not the object. */
export function nextSla(old: unknown, hours: number | null): Record<string, unknown> {
  const base: Record<string, unknown> = old && typeof old === 'object' && !Array.isArray(old)
    ? { ...(old as Record<string, unknown>) } : {};
  if (hours === null) delete base.decision_hours;
  else base.decision_hours = hours;
  return base;
}

/** The raw invite token and its lookup hash — the SAME shape apps/api mints in identity/domain/verification-team.ts
 *  (32 random bytes, base64url = 43 chars; sha256 hex), so the partner realm's accept path reads both alike. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, hash };
}

/** '••••' + the last four characters of a regulator licence reference, or null when there is none. */
export function maskRegulatorRef(ref: string | null | undefined): string | null {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  return '••••' + r.slice(-4);
}

/** '••••••' + the last three digits — never the whole number in an audit row or a response. */
export function maskInvitePhone(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return '••••••' + digits.slice(-3);
}
