// apps/web-tenant/src/features/offline/stale.ts · PC-56 TENANT-SW-f · W318 §1 — THE "AS OF" LAW, pure.
//
// W318: *"Showing data as of 15:18 (1 h 22 min ago) — connection is slow; the table below is your cached view … absolute + relative time ·
// money columns get a per-cell stale tint when > 1h old."* The console renders every page on the server at the moment it is asked, so a
// page is "as of" the instant it was rendered; it is STALE only when the browser shows it later (the back button, a tab left open on a
// mandi gate, a page restored offline). The threshold is ONE number, here, and the tint is a class AND a word — never colour alone.

/** A rendered page is stale after one hour (W318 §1 "per-cell stale tint when > 1h old"). */
export const STALE_AFTER_MS = 60 * 60_000;

/** Is a page rendered at `asOf` stale at `now`? Strictly more than an hour. A missing / unreadable instant is NOT stale (unknown ≠ old). */
export function isStale(asOf: string | Date | null | undefined, now: Date): boolean {
  if (!asOf) return false;
  const t = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > STALE_AFTER_MS;
}

export type RelativeUnit = 'now' | 'minutes' | 'hours' | 'days';
/** "3 min ago" / "1 h 22 min ago" — the parts; the words are the catalogue's (`swf.asOf.rel.<unit>`). */
export function relativeParts(asOf: string | Date, now: Date): { unit: RelativeUnit; value: number; minutes: number } {
  const t = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (mins < 1) return { unit: 'now', value: 0, minutes: 0 };
  if (mins < 60) return { unit: 'minutes', value: mins, minutes: 0 };
  if (mins < 24 * 60) return { unit: 'hours', value: Math.floor(mins / 60), minutes: mins % 60 };
  return { unit: 'days', value: Math.floor(mins / (24 * 60)), minutes: 0 };
}

/** The absolute instant on the IST wall clock: "2026-10-04 15:18 IST" (IST has no daylight saving: a constant +05:30). */
export function istClock(asOf: string | Date): string {
  const t = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  const s = new Date(t + 330 * 60_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} IST`;
}

/** The class a stale region carries (CSS tints money cells under it AND each money cell gets a word — see globals.css + AsOf). */
export const STALE_ATTR = 'data-kv-stale';
export function staleClass(stale: boolean): string { return stale ? 'kv-asof kv-asof--stale' : 'kv-asof'; }
