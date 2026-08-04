import { canBoost, pickTier, boostErrorKey } from '../features/listings/boost';
import type { BoostTier } from '@krishalaya/sdk-js';

const tiers: BoostTier[] = [
  { id: 't1', code: 'basic', name: 'Basic', priceMinor: '9900', days: 7 },
  { id: 't2', code: 'max', name: 'Max', priceMinor: '29900', days: 30 },
];

describe('features/listings/boost', () => {
  it('canBoost only for published + not already boosted', () => {
    expect(canBoost('published', false)).toBe(true);
    expect(canBoost('published', true)).toBe(false);
    expect(canBoost('draft', false)).toBe(false);
    expect(canBoost(undefined, false)).toBe(false);
  });

  it('pickTier accepts only ids from the server catalogue', () => {
    expect(pickTier(tiers, ' t2 ')?.code).toBe('max');
    expect(pickTier(tiers, 'fabricated')).toBeNull();
    expect(pickTier(tiers, '')).toBeNull();
    expect(pickTier([], 't1')).toBeNull();
  });

  it('maps wallet failure codes to UI reasons', () => {
    expect(boostErrorKey('WALLET_INSUFFICIENT_BALANCE')).toBe('boostfunds');
    expect(boostErrorKey('WALLET_FROZEN')).toBe('boostfrozen');
    expect(boostErrorKey('SOMETHING_ELSE')).toBe('boost');
    expect(boostErrorKey(undefined)).toBe('boost');
  });
});
