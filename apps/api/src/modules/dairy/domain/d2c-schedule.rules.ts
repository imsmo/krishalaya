// modules/dairy/domain/d2c-schedule.rules.ts · PC-55 A5 — PURE delivery-schedule logic.
// This is the code that decides whether a household is charged for a bottle of milk on a given morning, so
// every rule here is written to be provably conservative: a paused subscription is NEVER scheduled, a day is
// never scheduled twice, and nothing is ever scheduled before it starts or after it is cancelled.
export const D2C_FREQUENCIES = ['daily', 'alternate_day', 'weekly', 'monthly'] as const;
export type D2cFrequency = (typeof D2C_FREQUENCIES)[number];
export const DELIVERY_STATUSES = ['scheduled', 'delivered', 'skipped', 'failed', 'refunded'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** Whole days between two ISO dates (UTC midnights, so DST can never shift a delivery day). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parse(toIso).getTime() - parse(fromIso).getTime()) / DAY);
}

/** Does this subscription's cadence land on `dayIso`, counting from its own start date? */
export function isDueOn(frequency: D2cFrequency, startsOn: string, dayIso: string): boolean {
  const delta = daysBetween(startsOn, dayIso);
  if (delta < 0) return false;                                   // never before the household asked for it
  switch (frequency) {
    case 'daily': return true;
    case 'alternate_day': return delta % 2 === 0;
    case 'weekly': return delta % 7 === 0;                       // same weekday as the start date
    case 'monthly': {
      const s = parse(startsOn), d = parse(dayIso);
      // The same day-of-month, and for short months the LAST day (a 31st subscription in February bills on
      // the 28th/29th rather than silently skipping the month).
      const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const target = Math.min(s.getUTCDate(), lastOfMonth);
      return d.getUTCDate() === target;
    }
    default: return false;
  }
}

/** A pause is INCLUSIVE of paused_until — the household said "not until then", so that day is still off. */
export function isPaused(pausedUntil: string | null | undefined, dayIso: string): boolean {
  return !!pausedUntil && dayIso <= pausedUntil;
}

export interface SubscriptionForSchedule {
  id: string; frequency: D2cFrequency; startsOn: string; status: string; pausedUntil: string | null;
}
/** The single decision function the job uses. Only ACTIVE, started, unpaused subscriptions produce a row. */
export function shouldSchedule(sub: SubscriptionForSchedule, dayIso: string): boolean {
  if (sub.status !== 'active') return false;                     // paused/cancelled never materialise a charge
  if (isPaused(sub.pausedUntil, dayIso)) return false;
  return isDueOn(sub.frequency, sub.startsOn, dayIso);
}

/** The horizon the job materialises: today through today+N (inclusive), so a rider has tomorrow's list. */
export function horizonDays(todayIso: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= days; i++) out.push(iso(new Date(parse(todayIso).getTime() + i * DAY)));
  return out;
}

// ===== delivery outcome gates =====
/** A scheduled drop may be completed, skipped or failed — once. A settled outcome is never overwritten. */
export function canSettleDelivery(current: DeliveryStatus): boolean { return current === 'scheduled'; }
/** Only a DELIVERED drop is billable. Skipped/failed/refunded never enter a statement. */
export function isBillable(status: DeliveryStatus): boolean { return status === 'delivered'; }

/** Statement arithmetic in MINOR UNITS, integer-only (Law 2). qty is a 3-dp decimal STRING: we bill
 *  price_per_delivery × delivered-count — never price × litres — because the plan sells a DELIVERY. */
export function statementTotalMinor(deliveredCount: number, pricePerDeliveryMinor: string): string {
  if (!/^\d{1,15}$/.test(pricePerDeliveryMinor)) throw new Error('pricePerDeliveryMinor must be a minor-unit integer string');
  return (BigInt(deliveredCount) * BigInt(pricePerDeliveryMinor)).toString();
}
