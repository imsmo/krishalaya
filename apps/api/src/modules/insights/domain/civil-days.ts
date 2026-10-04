// modules/insights/domain/civil-days.ts · PC-56 TENANT-SW-f — calendar days as STRINGS (`YYYY-MM-DD`), the same rules 9c's auditor
// realm uses (a module keeps its own copy of three pure functions rather than reaching into another module's domain). UTC is used only
// as a calendar here, never as anybody's clock.
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day (`2026-02-30` is not one). */
export function isCivilDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Inclusive count of days from `a` to `b` (`a == b` → 1). */
export function daysInclusive(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
/** Today's civil day in IST. */
export function istToday(now: Date = new Date()): string { return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10); }
