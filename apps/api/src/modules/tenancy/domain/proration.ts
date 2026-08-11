// modules/tenancy/domain/proration.ts · the money W119 prints and no code computed (PC-56 TENANT-1d).
//
// **BEFORE THIS FILE, AN UPGRADE WAS FREE.** `SubscriptionService.changePlan` swapped the plan id and the price on the
// subscription row, wrote an audit line, and billed nothing — `grep -rln "prorat" apps packages` returned nothing across
// the monorepo. A tenant could move from Starter (₹2,999) to Professional (₹19,999) on day two, get every Professional
// capability immediately, and be invoiced ₹0 for the remainder of the cycle. There was no failed payment and no dunning
// row to notice: just revenue that was never invoiced, on every upgrade the platform ever processed.
//
// Everything here is a pure function over bigint minor units. **NO FLOAT TOUCHES MONEY, EVER (Law 2)** — the day
// fractions are expressed as integer multiplication before integer division, so ₹8,999 × 19 / 31 is computed as
// (899900n × 19n) / 31n and not as a rate. A float rate on a monthly price is how a tenant is billed a paisa more than
// their invoice says, every month, until somebody reconciles it by hand.

export type ChangeDirection = 'upgrade' | 'downgrade' | 'lateral';

export interface PlanChangeInput {
  fromPriceMinor: bigint;
  toPriceMinor: bigint;
  /** Inclusive period start and end, as YYYY-MM-DD. The tenant's own billing period, not a calendar month. */
  periodStart: string;
  periodEnd: string;
  /** The day the change is requested. */
  today: string;
  taxBp: number;
}

export interface ProrationLines {
  direction: ChangeDirection;
  daysInPeriod: number;
  daysRemaining: number;
  /** What the new plan costs for the remaining days. */
  newPlanChargeMinor: bigint;
  /** What the old plan already paid for those same days, credited back. */
  unusedCreditMinor: bigint;
  /** charge − credit, floored at zero. */
  netDueMinor: bigint;
  taxMinor: bigint;
  totalDueMinor: bigint;
  /** Immediate for an upgrade; the period end for a downgrade (W119: "no clawbacks mid-cycle"). */
  effectiveDate: string;
  /** True when the change waits — the console must say so before the tenant clicks. */
  scheduled: boolean;
}

/** Whole days between two ISO dates, UTC, no timezone drift. Billing periods are DATES, not instants: a tenant in
 *  Junagadh and one in Guwahati on the same plan must be billed the same number of days. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * **THE PERIOD IS COUNTED INCLUSIVELY AND THE REMAINDER INCLUDES TODAY.**
 *
 * W119's own numbers force this and they are worth checking against: Professional at ₹19,999/month, "13–31 Jul (19 days
 * prorated)" = ₹12,257. July 13th to 31st inclusive is 19 days, and 1999900 × 19 / 31 = 1225739 paise ≈ ₹12,257. So the
 * canon counts the day of the change as a day the tenant gets the new plan — which is the only reading that is fair when
 * the upgrade takes effect immediately. Counting from tomorrow would charge for 18 days of a plan they are using today.
 */
export function periodDays(periodStart: string, periodEnd: string): number {
  return Math.max(1, daysBetween(periodStart, periodEnd) + 1);
}

export function remainingDays(today: string, periodEnd: string): number {
  return Math.max(0, daysBetween(today, periodEnd) + 1);
}

/**
 * A price for part of a period, in minor units.
 *
 * **THE ROUNDING DIRECTION IS A DECISION AND W119 STATES IT: "rounded in your favour".** So the CHARGE rounds DOWN
 * (floor) and the CREDIT rounds UP (ceil) — both in the tenant's favour, both by at most one paisa, and both stated
 * where the code lives rather than left to whatever integer division happens to do. A platform that rounds its own way
 * on every upgrade of 15,000 tenants is collecting a rounding error as revenue, which is the kind of thing that is
 * indefensible precisely because it is tiny.
 */
export function partPeriodCharge(fullPriceMinor: bigint, days: number, daysInPeriod: number): bigint {
  if (daysInPeriod <= 0 || days <= 0) return 0n;
  const d = BigInt(Math.min(days, daysInPeriod));
  // Multiply first, divide once: bigint division truncates toward zero, which for a positive numerator is floor.
  return (fullPriceMinor * d) / BigInt(daysInPeriod);
}

export function partPeriodCredit(fullPriceMinor: bigint, days: number, daysInPeriod: number): bigint {
  if (daysInPeriod <= 0 || days <= 0) return 0n;
  const d = BigInt(Math.min(days, daysInPeriod));
  const n = fullPriceMinor * d;
  const q = BigInt(daysInPeriod);
  // Ceiling, in bigint: add (divisor − 1) before dividing. In the tenant's favour, by design.
  return (n + q - 1n) / q;
}

/** Tax in integer basis points on a minor-unit amount, rounded to the nearest paisa (half-up).
 *
 *  **NOT `amount * 0.18`.** 674100 × 0.18 in floating point is 121338.00000000001, and a tax line that ends in a
 *  fractional paisa is an invoice a finance team cannot file. */
export function taxOn(netMinor: bigint, taxBp: number): bigint {
  if (netMinor <= 0n || taxBp <= 0) return 0n;
  const bp = BigInt(Math.round(taxBp));
  return (netMinor * bp + 5_000n) / 10_000n;
}

/**
 * Which way the change goes.
 *
 * **BY PRICE, NOT BY PLAN NAME OR BY A LADDER.** A tenant on a negotiated Growth price of ₹4,000 moving to list-price
 * Professional at ₹19,999 is an upgrade; the same tenant on an anchor deal at ₹25,000 moving to Professional is a
 * DOWNGRADE, whatever the plan is called. `subscriptions.price_minor` is the negotiated price and 0002 says so — so the
 * comparison has to use it, or an anchor tenant gets billed immediately for a change that reduces their bill.
 */
export function directionOf(fromPriceMinor: bigint, toPriceMinor: bigint): ChangeDirection {
  if (toPriceMinor > fromPriceMinor) return 'upgrade';
  return toPriceMinor < fromPriceMinor ? 'downgrade' : 'lateral';
}

/**
 * The whole calculation, and the effective date that follows from the direction.
 *
 * **AN UPGRADE APPLIES TODAY AND IS INVOICED; A DOWNGRADE APPLIES AT THE PERIOD END AND IS INVOICED NOTHING.** That is
 * W119's rule and it is the right one in both directions: charging for a downgrade would be charging for less, and
 * applying it immediately would take away capability the tenant has already paid for while owing them a refund this
 * platform has no mechanism to compute or pay.
 *
 * A LATERAL change (same price — a billing-cycle switch, a plan renamed at the same price) applies immediately and bills
 * nothing, because there is nothing to bill and nothing to take away.
 */
export function prorate(input: PlanChangeInput): ProrationLines {
  const direction = directionOf(input.fromPriceMinor, input.toPriceMinor);
  const daysInPeriod = periodDays(input.periodStart, input.periodEnd);
  const daysRemaining = Math.min(remainingDays(input.today, input.periodEnd), daysInPeriod);

  if (direction !== 'upgrade') {
    // Nothing is billed and nothing is credited. The components are still returned — a console that showed a downgrade
    // with no numbers at all would leave a tenant guessing whether they had been charged.
    return {
      direction, daysInPeriod, daysRemaining,
      newPlanChargeMinor: 0n, unusedCreditMinor: 0n, netDueMinor: 0n, taxMinor: 0n, totalDueMinor: 0n,
      effectiveDate: direction === 'downgrade' ? nextDay(input.periodEnd) : input.today,
      scheduled: direction === 'downgrade',
    };
  }

  const newPlanChargeMinor = partPeriodCharge(input.toPriceMinor, daysRemaining, daysInPeriod);
  const unusedCreditMinor = partPeriodCredit(input.fromPriceMinor, daysRemaining, daysInPeriod);
  // **FLOORED AT ZERO, NEVER NEGATIVE.** A credit larger than the new charge cannot happen on an upgrade by definition
  // (the new price is higher), but a negotiated price can make the arithmetic surprising — and a negative "due" would be
  // a silent refund nobody authorised. Floored, with both components kept so the reader can see why.
  const netDueMinor = newPlanChargeMinor > unusedCreditMinor ? newPlanChargeMinor - unusedCreditMinor : 0n;
  const taxMinor = taxOn(netDueMinor, input.taxBp);
  return {
    direction, daysInPeriod, daysRemaining,
    newPlanChargeMinor, unusedCreditMinor, netDueMinor, taxMinor,
    totalDueMinor: netDueMinor + taxMinor,
    effectiveDate: input.today,
    scheduled: false,
  };
}

/** The day after an ISO date. A downgrade takes effect the day the NEW period starts, not the last day of the old one —
 *  W119 says "Downgrade takes effect 01 Aug" for a period ending 31 Jul. */
export function nextDay(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------------------------------ */
/* LIMITS — what a downgrade would break, and what it must never do                                  */
/* ------------------------------------------------------------------------------------------------ */

export interface LimitBreach { limitCode: string; limitValue: string; currentUsage: string }

/**
 * Which of the target plan's limits the tenant is already over.
 *
 * **AND THE RULE THIS SUPPORTS IS THE ONE THAT PROTECTS A FARMER, NOT THE PLATFORM.** W119: "you have 1,284 members and
 * 7 staff — over Starter's limits (500 / 2). **Existing members are never removed**; you just can't add more until
 * within limits. Auctions and dairy would switch off with your data kept intact."
 *
 * So a breach is a WARNING on the way in and a ceiling afterwards — never a deletion. A platform that dropped 784
 * members because a co-operative downgraded to save money would have destroyed the register those members' payouts
 * depend on, to enforce a price. `-1` means unlimited (0002's own convention).
 */
export function limitBreaches(
  targetLimits: Record<string, string>,
  currentUsage: Record<string, string>,
): LimitBreach[] {
  const out: LimitBreach[] = [];
  for (const [limitCode, limitValueRaw] of Object.entries(targetLimits)) {
    const limitValue = BigInt(limitValueRaw);
    if (limitValue < 0n) continue;                       // -1 = unlimited, by 0002's convention
    const usedRaw = currentUsage[limitCode];
    if (usedRaw === undefined) continue;                 // nothing measured for this limit; not a breach, an unknown
    const used = BigInt(usedRaw);
    if (used > limitValue) out.push({ limitCode, limitValue: limitValue.toString(), currentUsage: used.toString() });
  }
  return out;
}

/** **A BREACH NEVER BLOCKS THE DOWNGRADE AND NEVER DELETES ANYTHING.** It is disclosed, recorded on the change row, and
 *  becomes a ceiling on ADDITIONS once the new plan applies. Named as a function so the rule is a thing code refers to
 *  rather than a paragraph somebody remembers. */
export function breachBlocksChange(): boolean {
  return false;
}

/** The idempotency key W119's "a double click cannot charge twice" needs. Derived from what makes the change unique
 *  rather than random, so the SECOND click computes the same key and hits the unique index. */
export function changeIdempotencyKey(subscriptionId: string, toPlanId: string, effectiveDate: string): string {
  return `plan_change:${subscriptionId}:${toPlanId}:${effectiveDate}`;
}
