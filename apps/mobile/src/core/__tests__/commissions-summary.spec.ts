// Unit tests for the PURE commission-ledger derivations (features/ambassador/commissions-summary, screen 92).
// Money summed with BigInt (Law 2); month buckets by createdAt; §13: payouts are never counted as earned income
// and no farmer/bank/plan-amount is invented here.
import {
  commissionCategory, isPayout, monthKey, monthCreditsMinor, monthCountByCategory,
  withdrawableMinor, paidMinor, momDeltaPct, EARNING_RULES,
} from '../../features/ambassador/commissions-summary';
import type { AmbassadorEarning } from '@krishalaya/sdk-js';

const e = (
  amountMinor: string,
  eventCode: string,
  createdAt: string,
  payoutId: string | null = null,
): AmbassadorEarning =>
  ({ id: Math.random().toString(), ambassadorId: 'a', eventCode, referenceType: null, referenceId: null, amountMinor, payoutId, createdAt } as AmbassadorEarning);

describe('commissionCategory', () => {
  it('maps server codes to display categories', () => {
    expect(commissionCategory('referral_onboarding_kyc')).toBe('onboarding');
    expect(commissionCategory('first_sale')).toBe('first_sale');
    expect(commissionCategory('gmv_share')).toBe('gmv');
    expect(commissionCategory('monthly_bonus')).toBe('bonus');
    expect(commissionCategory('payout')).toBe('payout');
    expect(commissionCategory('mystery')).toBe('other');
    expect(commissionCategory(null)).toBe('other');
  });
});

describe('isPayout', () => {
  it('flags payout-coded or negative rows', () => {
    expect(isPayout(e('-500000', 'payout', '2026-08-01'))).toBe(true);
    expect(isPayout(e('5000', 'first_sale', '2026-08-01'))).toBe(false);
    expect(isPayout(e('5000', 'withdrawal_upi', '2026-08-01'))).toBe(true);
  });
});

describe('monthKey', () => {
  it('buckets ISO to YYYY-MM, null when absent/bad', () => {
    expect(monthKey('2026-08-14T10:00:00Z')).toBe('2026-08');
    expect(monthKey(null)).toBeNull();
    expect(monthKey('not-a-date')).toBeNull();
  });
});

describe('month sums + counts', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const items = [
    e('5000', 'onboarding', '2026-08-02T09:00:00Z'),
    e('2500', 'first_sale', '2026-08-05T09:00:00Z'),
    e('18400', 'gmv_share', '2026-08-10T09:00:00Z'),
    e('4200', 'onboarding', '2026-07-30T09:00:00Z'), // prior month → excluded
    e('-500000', 'payout', '2026-08-01T09:00:00Z'),   // payout → never earned income
  ];
  it('sums only in-month credits (excludes prior-month + payouts)', () => {
    expect(monthCreditsMinor(items, now)).toBe('25900');
  });
  it('counts by category within the month', () => {
    expect(monthCountByCategory(items, 'onboarding', now)).toBe(1);
    expect(monthCountByCategory(items, 'first_sale', now)).toBe(1);
    expect(monthCountByCategory(items, 'gmv', now)).toBe(1);
  });
});

describe('withdrawable / paid split (payoutId only real signal)', () => {
  const items = [
    e('5000', 'onboarding', '2026-08-02T09:00:00Z'),          // unpaid credit
    e('2500', 'first_sale', '2026-08-05T09:00:00Z', 'po_1'),  // paid credit
    e('-500000', 'payout', '2026-08-01T09:00:00Z', 'po_1'),   // payout row ignored both ways
  ];
  it('withdrawable = unpaid credits', () => { expect(withdrawableMinor(items)).toBe('5000'); });
  it('paid = credits carrying a payoutId', () => { expect(paidMinor(items)).toBe('2500'); });
});

describe('momDeltaPct', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  it('computes rounded percent vs prior month', () => {
    const items = [e('10000', 'gmv_share', '2026-08-10T09:00:00Z'), e('8000', 'gmv_share', '2026-07-10T09:00:00Z')];
    expect(momDeltaPct(items, now)).toBe(25);
  });
  it('null when no prior-month baseline (never fabricates a trend)', () => {
    expect(momDeltaPct([e('10000', 'gmv_share', '2026-08-10T09:00:00Z')], now)).toBeNull();
  });
});

describe('EARNING_RULES', () => {
  it('lists the four program rules with the bonus trophy', () => {
    expect(EARNING_RULES.map((r) => r.key)).toEqual(['onboarding', 'firstSale', 'gmv', 'bonus']);
    expect(EARNING_RULES.find((r) => r.key === 'bonus')!.icon).toBe('🏆');
  });
});
