// apps/web-tenant/src/features/group-lots/coordinator.ts · PURE quantity helpers for the group-lot console (PC-56 TENANT-11c).
// Quantities are decimal strings (numeric(14,3)) handled as integer milli-units — never a float. The server is authoritative
// for every lifecycle edge and every rupee: the old client-side settlement PREVIEW (and the typed-gross settle form it fed) is
// gone with the route it mirrored — the settlement is now prepared from the REAL sale by the API and shown as the API returns it.
// Regexes are anchored fixed char-classes (ReDoS-safe).

export const GROUP_LOT_STATUSES = ['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'] as const;
export type GroupLotStatus = (typeof GROUP_LOT_STATUSES)[number];

const QTY = /^\d{1,11}(\.\d{1,3})?$/;   // numeric(14,3) — up to 11 integer digits, ≤3 decimals
const QTY_SCALE = 1000n;

/** "12.5" → 12500n milli-units. Throws on malformed input. */
export function parseQtyMilli(q: string): bigint {
  if (!QTY.test(q)) throw new Error('bad quantity');
  const [intPart, fracPart = ''] = q.split('.');
  const frac = (fracPart + '000').slice(0, 3);
  return BigInt(intPart) * QTY_SCALE + BigInt(frac || '0');
}
/** 12500n → "12.500". */
export function formatQtyMilli(milli: bigint): string {
  const whole = milli / QTY_SCALE;
  const frac = (milli % QTY_SCALE).toString().padStart(3, '0');
  return `${whole}.${frac}`;
}
/** Pledged ÷ target as integer basis points (display only; clamped to 10000). Float-free. */
export function progressBps(pledgedQuantity: string, targetQuantity: string): number {
  const target = parseQtyMilli(targetQuantity);
  if (target <= 0n) return 0;
  const pct = (parseQtyMilli(pledgedQuantity) * 10000n) / target;
  return Number(pct > 10000n ? 10000n : pct);
}
/** A lot is open for new pledges only while pledging AND before the deadline (the server re-checks). */
export function canPledge(status: string, pledgeDeadline: string, now: Date = new Date()): boolean {
  if (status !== 'pledging') return false;
  const t = Date.parse(pledgeDeadline);
  return Number.isFinite(t) && t > now.getTime();
}
