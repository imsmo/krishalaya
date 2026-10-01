// modules/identity/domain/kyc-expiry.ts · PC-56 TENANT-9a · `expired` IS A WRITTEN STATE NOW (F-3).
//
// Dates are the cooperative's own calendar dates (`YYYY-MM-DD`, resolved in its zone by `kyc_tenant_today()`), never a
// UTC instant: a licence valid until 30 Sep is valid through 30 Sep in Anand, and lapses at the first moment of 1 Oct there.
// Pure date arithmetic on the civil calendar (UTC noon anchors avoid any DST edge).

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCivil(d: string): number | null {
  const m = ISO_DATE.exec(d);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const t = Date.UTC(y, mo - 1, da, 12);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) return null;   // 31 Feb
  return t;
}

/** Whole days from `today` until `validUntil` (0 = lapses at the end of today; negative = already lapsed). */
export function daysUntil(validUntil: string, today: string): number | null {
  const a = parseCivil(validUntil); const b = parseCivil(today);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY_MS);
}

/** Lapsed = the last valid day is BEFORE today. */
export function isLapsed(validUntil: string | null, today: string): boolean {
  if (validUntil === null) return false;
  const d = daysUntil(validUntil, today);
  return d !== null && d < 0;
}

/** Inside the renewal window: still valid, and lapsing within `windowDays` (inclusive). */
export function isExpiringWithin(validUntil: string | null, today: string, windowDays: number): boolean {
  if (validUntil === null) return false;
  const d = daysUntil(validUntil, today);
  return d !== null && d >= 0 && d <= windowDays;
}

/** A reminder goes ONCE per document (the old job re-emitted every tick, forever, for lapsed documents too). */
export function dueForReminder(doc: { status: string; validUntil: string | null; remindedAt: string | null }, today: string, windowDays: number): boolean {
  return doc.status === 'verified' && doc.remindedAt === null && isExpiringWithin(doc.validUntil, today, windowDays);
}

/** `30/09/2026` — the digits a notice prints (no month name: a word would be English inside Gujarati copy). */
export function noticeDay(d: string): string {
  const m = ISO_DATE.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}
