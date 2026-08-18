// modules/tenancy/domain/analytics-window.ts · PURE window resolution for the analytics read (no I/O).
// Defaults to the last 30 days; clamps the span to a bounded MAX so a client can never request an unbounded
// partition scan (Law 8). `to` is exclusive. Invalid dates fall back to the default window.
export const MAX_WINDOW_DAYS = 366;
const DAY = 86_400_000;

function parse(d: string | undefined, fallback: Date): Date {
  if (!d) return fallback;
  const t = Date.parse(d);
  return Number.isNaN(t) ? fallback : new Date(t);
}

/** Resolve [from, to) from optional ISO/date strings. Ensures from<to and (to-from) <= MAX_WINDOW_DAYS. */
export function resolveWindow(fromStr: string | undefined, toStr: string | undefined, now: Date = new Date()): { from: Date; to: Date } {
  const to = parse(toStr, now);
  const from = parse(fromStr, new Date(to.getTime() - 30 * DAY));
  let lo = from;
  const hi = to;
  if (lo.getTime() >= hi.getTime()) lo = new Date(hi.getTime() - 30 * DAY);     // empty/inverted → default 30d back
  if (hi.getTime() - lo.getTime() > MAX_WINDOW_DAYS * DAY) lo = new Date(hi.getTime() - MAX_WINDOW_DAYS * DAY);
  return { from: lo, to: hi };
}
