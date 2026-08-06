// apps/mobile/src/features/store-owner/licence.ts · PURE licence-expiry rules (PC-55 B6, on PC-54 W54-14).
// No IO, no React — so the countdown a shopkeeper acts on is unit-provable.
//
// WHY THIS FILE IS SMALL AND STRICT: the old screen deliberately refused to show a countdown because there was no
// backend for it, and a fabricated "expires soon" would have sent someone to a government office for nothing — or,
// worse, let them believe a lapsed licence was fine. Now that `validUntil` is a real server-held date, every number
// here is arithmetic on that date and nothing else. A missing or unreadable date is reported as UNKNOWN, never
// quietly treated as "plenty of time".
export const EXPIRY_WINDOW_DAYS = 90;   // the API's own default window for this feed
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExpiryState = 'expired' | 'soon' | 'later' | 'unknown';

/** Days until a document lapses, and what to call that. `days` is NEGATIVE once it has expired, so a caller can say
 *  "lapsed 12 days ago" without recomputing. 'soon' is 30 days or fewer — long enough to get a renewal moving in a
 *  district office, which is the real-world constraint this number serves. */
export function expiryState(validUntil: string | null | undefined, todayIso: string): { state: ExpiryState; days: number } {
  const d = (validUntil ?? '').trim();
  if (!DATE.test(d) || !DATE.test(todayIso)) return { state: 'unknown', days: 0 };
  const days = daysUntil(todayIso, d);
  if (days < 0) return { state: 'expired', days };
  if (days <= 30) return { state: 'soon', days };
  return { state: 'later', days };
}

export function daysUntil(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Soonest-lapsing first, and documents with NO readable date go LAST rather than first: an unknown date must not
 *  outrank a licence that genuinely expires next week. */
export function sortByExpiry<T extends { validUntil?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const av = (a.validUntil ?? '').trim();
    const bv = (b.validUntil ?? '').trim();
    const aOk = DATE.test(av);
    const bOk = DATE.test(bv);
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    if (!aOk && !bOk) return 0;
    return av.localeCompare(bv);
  });
}

/** Anything a shopkeeper must act on today: already lapsed, or lapsing inside the month. */
export function actionableCount(rows: readonly { validUntil?: string | null }[], todayIso: string): number {
  return rows.filter((r) => {
    const s = expiryState(r.validUntil, todayIso).state;
    return s === 'expired' || s === 'soon';
  }).length;
}
