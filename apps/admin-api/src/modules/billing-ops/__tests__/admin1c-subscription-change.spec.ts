// apps/admin-api/src/modules/billing-ops/__tests__/admin1c-subscription-change.spec.ts · PC-56 ADMIN-1c.
// A subscription change is a change to a COMMERCIAL AGREEMENT — what the next invoice will say. Every test here is
// really the same question: could an operator commit the platform to charging something nobody agreed to?
import {
  BILLING_CYCLES, MAX_SUBSCRIPTION_PRICE_MINOR, isChangeable, assertPlanChange, assertAddon, canCancelAtPeriodEnd,
} from '../domain/subscription-change';
import { InvalidSubscriptionChangeError } from '../domain/billing-ops.errors';

const PLAN_A = '018f0000-0000-7000-8000-00000000000a';
const PLAN_B = '018f0000-0000-7000-8000-00000000000b';
const base = {
  currentPlanId: PLAN_A, currentStatus: 'active', newPlanId: PLAN_B,
  priceMinor: 499000n, billingCycle: 'monthly', currency: 'INR', immediate: false,
};

describe('plan change — the price is always stated, and the current period is never touched by stealth', () => {
  it('mirrors the 0002 cycle vocabulary', () => {
    expect([...BILLING_CYCLES]).toEqual(['monthly', 'annual']);
  });

  it('defaults to the NEXT period, and says so in the result', () => {
    expect(assertPlanChange(base)).toEqual({ priceMinor: 499000n, billingCycle: 'monthly', effective: 'next_period' });
    expect(assertPlanChange({ ...base, immediate: true }).effective).toBe('immediate');
  });

  it('refuses a change to a FINISHED subscription — a dead one is re-sold, not edited', () => {
    for (const s of ['trialing', 'active', 'past_due', 'paused']) expect(isChangeable(s)).toBe(true);
    for (const s of ['cancelled', 'expired', 'nonsense']) {
      expect(isChangeable(s)).toBe(false);
      expect(() => assertPlanChange({ ...base, currentStatus: s })).toThrow(InvalidSubscriptionChangeError);
    }
  });

  it('refuses a no-op: a "change" to the same plan would write a false audit record', () => {
    expect(() => assertPlanChange({ ...base, newPlanId: PLAN_A })).toThrow(InvalidSubscriptionChangeError);
  });

  it('refuses a zero or negative price — a free period is a DISCOUNT on a real price', () => {
    // otherwise the platform has no record of what the tenant pays when the free period ends
    expect(() => assertPlanChange({ ...base, priceMinor: 0n })).toThrow(InvalidSubscriptionChangeError);
    expect(() => assertPlanChange({ ...base, priceMinor: -1n })).toThrow(InvalidSubscriptionChangeError);
  });

  it('refuses an absurd price (the extra-zero typo a tenant would find on an invoice)', () => {
    expect(assertPlanChange({ ...base, priceMinor: MAX_SUBSCRIPTION_PRICE_MINOR }).priceMinor).toBe(MAX_SUBSCRIPTION_PRICE_MINOR);
    expect(() => assertPlanChange({ ...base, priceMinor: MAX_SUBSCRIPTION_PRICE_MINOR + 1n })).toThrow(InvalidSubscriptionChangeError);
  });

  it('REFUSES a currency switch rather than converting it', () => {
    expect(() => assertPlanChange({ ...base, newCurrency: 'USD' })).toThrow(InvalidSubscriptionChangeError);
    expect(assertPlanChange({ ...base, newCurrency: 'INR' }).priceMinor).toBe(499000n);   // same currency is fine
  });

  it('refuses an unknown billing cycle', () => {
    expect(() => assertPlanChange({ ...base, billingCycle: 'weekly' })).toThrow(InvalidSubscriptionChangeError);
  });
});

describe('add-on — dates carry the meaning, and a zero price is legitimate here', () => {
  const addon = {
    addonCode: 'extra_language', quantity: 1, priceMinor: 99000n,
    startsOn: '2026-09-01', endsOn: null as string | null, subscriptionStatus: 'active',
  };

  it('accepts an open-ended add-on and trims the code', () => {
    expect(assertAddon({ ...addon, addonCode: '  extra_language  ' }))
      .toEqual({ addonCode: 'extra_language', quantity: 1, priceMinor: 99000n, startsOn: '2026-09-01', endsOn: null });
  });

  it('ALLOWS a zero price — a goodwill add-on is a normal commercial gesture', () => {
    // unlike a plan price: an add-on's absence costs nothing, so a zero leaves no unanswered question
    expect(assertAddon({ ...addon, priceMinor: 0n }).priceMinor).toBe(0n);
    expect(() => assertAddon({ ...addon, priceMinor: -1n })).toThrow(InvalidSubscriptionChangeError);
  });

  it('refuses an add-on that ends before it starts (a negative billing period)', () => {
    expect(assertAddon({ ...addon, endsOn: '2026-12-31' }).endsOn).toBe('2026-12-31');
    expect(() => assertAddon({ ...addon, endsOn: '2026-08-01' })).toThrow(InvalidSubscriptionChangeError);
    expect(() => assertAddon({ ...addon, endsOn: '2026-09-01' })).toThrow(InvalidSubscriptionChangeError);   // same day
  });

  it('refuses malformed dates rather than guessing a format', () => {
    expect(() => assertAddon({ ...addon, startsOn: '01/09/2026' })).toThrow(InvalidSubscriptionChangeError);
    expect(() => assertAddon({ ...addon, endsOn: 'next year' })).toThrow(InvalidSubscriptionChangeError);
  });

  it('refuses a quantity of nothing, a fractional quantity, or an absurd one', () => {
    for (const q of [0, -3, 1.5, 10_001]) {
      expect(() => assertAddon({ ...addon, quantity: q })).toThrow(InvalidSubscriptionChangeError);
    }
    expect(assertAddon({ ...addon, quantity: 10_000 }).quantity).toBe(10_000);
  });

  it('refuses an add-on on a finished subscription', () => {
    expect(() => assertAddon({ ...addon, subscriptionStatus: 'cancelled' })).toThrow(InvalidSubscriptionChangeError);
  });

  it('refuses a code that is too short or too long', () => {
    expect(() => assertAddon({ ...addon, addonCode: 'x' })).toThrow(InvalidSubscriptionChangeError);
    expect(() => assertAddon({ ...addon, addonCode: 'x'.repeat(61) })).toThrow(InvalidSubscriptionChangeError);
  });
});

describe('cancel at period end', () => {
  it('is offered only while there is a period left to serve', () => {
    for (const s of ['trialing', 'active', 'past_due', 'paused']) expect(canCancelAtPeriodEnd(s)).toBe(true);
    for (const s of ['cancelled', 'expired']) expect(canCancelAtPeriodEnd(s)).toBe(false);
  });
});
