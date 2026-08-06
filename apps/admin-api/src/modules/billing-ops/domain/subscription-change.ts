// apps/admin-api/src/modules/billing-ops/domain/subscription-change.ts · pure rules for changing a tenant's
// subscription (PC-56 ADMIN-1c, closes ADMIN-1-Q10). No I/O → unit-provable.
//
// A subscription change is a change to a COMMERCIAL AGREEMENT. Nothing here moves money: it records what the next
// invoice should say. Every rule below exists to stop the platform quietly charging something nobody agreed to.
import { InvalidSubscriptionChangeError } from './billing-ops.errors';

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Statuses whose subscription may still be changed. A `cancelled` or `expired` subscription is finished: the tenant
 *  is re-sold a NEW one, so a price and a period are agreed afresh rather than silently inherited from a dead row. */
const CHANGEABLE: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'paused']);
export function isChangeable(status: string): boolean { return CHANGEABLE.has(status); }

/** Upper bound on a negotiated SaaS price (₹10 crore per cycle, in paise). A fat-finger guard, not a business limit:
 *  above this the number is a typo or an extra zero, and the tenant would find out on an invoice. */
export const MAX_SUBSCRIPTION_PRICE_MINOR = 100_000_000_00n;

export interface PlanChangeInput {
  currentPlanId: string;
  currentStatus: string;
  newPlanId: string;
  priceMinor: bigint;
  billingCycle: string;
  currency: string;
  newCurrency?: string;
  immediate: boolean;
}

export interface PlanChange { priceMinor: bigint; billingCycle: BillingCycle; effective: 'next_period' | 'immediate' }

/**
 * Validate a plan change.
 *
 * PRICE IS MANDATORY AND EXPLICIT. There is no "keep the current price" path: carrying a starter price onto an
 * enterprise plan (or the reverse) is a mistake nobody notices until an invoice lands, and the fix is always
 * embarrassing. Stating the price is the cheapest possible safeguard.
 *
 * CURRENCY CANNOT CHANGE HERE. A subscription's currency is the currency of its invoices and its wallet ledger;
 * switching it is a new agreement, not an edit. Refused rather than converted (Law 2 — no invented FX).
 *
 * `immediate` does NOT pro-rate. It records that the change applies to the current period as well; the billing cycle
 * owns the arithmetic. Anything else would mean this file computing money, which is exactly what it must not do.
 */
export function assertPlanChange(input: PlanChangeInput): PlanChange {
  if (!isChangeable(input.currentStatus)) {
    throw new InvalidSubscriptionChangeError(`a '${input.currentStatus}' subscription cannot be changed; sell a new one`);
  }
  if (input.newPlanId === input.currentPlanId) {
    // Not an error worth a 422? It is: the caller believes something will change and nothing will, and a no-op audit
    // row claiming a plan change would be a false record.
    throw new InvalidSubscriptionChangeError('the subscription is already on that plan');
  }
  if (!(BILLING_CYCLES as readonly string[]).includes(input.billingCycle)) {
    throw new InvalidSubscriptionChangeError(`billingCycle must be one of ${BILLING_CYCLES.join(', ')}`);
  }
  if (input.priceMinor <= 0n) {
    // A zero price is a real commercial thing (a free pilot) but it must be recorded as a DISCOUNT on a real price,
    // not as a price of nothing — otherwise the platform has no record of what the tenant will pay when it ends.
    throw new InvalidSubscriptionChangeError('priceMinor must be positive; record a free period as a discount, not a zero price');
  }
  if (input.priceMinor > MAX_SUBSCRIPTION_PRICE_MINOR) {
    throw new InvalidSubscriptionChangeError(`priceMinor exceeds the sanity cap (${MAX_SUBSCRIPTION_PRICE_MINOR})`);
  }
  if (input.newCurrency && input.newCurrency !== input.currency) {
    throw new InvalidSubscriptionChangeError(`cannot change currency from ${input.currency} to ${input.newCurrency}; that is a new subscription`);
  }
  return {
    priceMinor: input.priceMinor,
    billingCycle: input.billingCycle as BillingCycle,
    effective: input.immediate ? 'immediate' : 'next_period',
  };
}

export interface AddonInput {
  addonCode: string;
  quantity: number;
  priceMinor: bigint;
  startsOn: string;
  endsOn: string | null;
  subscriptionStatus: string;
}

export interface Addon { addonCode: string; quantity: number; priceMinor: bigint; startsOn: string; endsOn: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate an add-on.
 *
 * The dates carry the meaning: `startsOn` is when it begins to bill and `endsOn` (optional) is when it stops. An
 * add-on that ends BEFORE it starts would bill for a negative period — refused. A zero or negative quantity is
 * refused too: an add-on of nothing is a row that bills nothing and confuses every invoice it appears on.
 *
 * A PRICE OF ZERO IS ALLOWED HERE, unlike a plan price — a goodwill add-on ("we'll throw in the extra language")
 * is a normal commercial gesture, and recording it at zero is the honest representation of what was agreed. The
 * difference from a plan is that an add-on's absence costs nothing, so a zero leaves no unanswered question.
 */
export function assertAddon(input: AddonInput): Addon {
  if (!isChangeable(input.subscriptionStatus)) {
    throw new InvalidSubscriptionChangeError(`cannot add an add-on to a '${input.subscriptionStatus}' subscription`);
  }
  const addonCode = input.addonCode.trim();
  if (addonCode.length < 2 || addonCode.length > 60) {
    throw new InvalidSubscriptionChangeError('addonCode must be 2–60 characters');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10_000) {
    throw new InvalidSubscriptionChangeError('quantity must be a whole number between 1 and 10000');
  }
  if (input.priceMinor < 0n) throw new InvalidSubscriptionChangeError('priceMinor cannot be negative');
  if (input.priceMinor > MAX_SUBSCRIPTION_PRICE_MINOR) {
    throw new InvalidSubscriptionChangeError(`priceMinor exceeds the sanity cap (${MAX_SUBSCRIPTION_PRICE_MINOR})`);
  }
  if (!DATE_RE.test(input.startsOn)) throw new InvalidSubscriptionChangeError('startsOn must be YYYY-MM-DD');
  if (input.endsOn !== null) {
    if (!DATE_RE.test(input.endsOn)) throw new InvalidSubscriptionChangeError('endsOn must be YYYY-MM-DD');
    if (input.endsOn <= input.startsOn) {
      throw new InvalidSubscriptionChangeError('endsOn must be after startsOn; an add-on cannot bill for a negative period');
    }
  }
  return { addonCode, quantity: input.quantity, priceMinor: input.priceMinor, startsOn: input.startsOn, endsOn: input.endsOn };
}

/** Cancel-at-period-end is only meaningful while there IS a period left to serve. A cancelled or expired
 *  subscription has nothing to schedule; a paused one does (it resumes, or it ends). */
export function canCancelAtPeriodEnd(status: string): boolean { return isChangeable(status); }
