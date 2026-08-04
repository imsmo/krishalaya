// Unit tests for the PURE ambassador/referral logic (features/ambassador/referral-flow). Earnings summed with
// BigInt (Law 2); code validation mirrors the server's regex.
import { referralStatusTone, normalizeReferralCode, isValidReferralCode, referralFunnel, sumEarningsMinor, isConverted, ONBOARD_METHODS, deriveReferralCode } from '../../features/ambassador/referral-flow';
import type { Referral, AmbassadorEarning } from '@krishalaya/sdk-js';

const ref = (status: string): Referral => ({ id: Math.random().toString(), referrerUserId: 'a', refereeUserId: null, code: 'ABCD', status } as Referral);
const earn = (amountMinor: string, payoutId: string | null = null): AmbassadorEarning =>
  ({ id: Math.random().toString(), ambassadorId: 'a', eventCode: 'referral_activated', referenceType: null, referenceId: null, amountMinor, payoutId } as AmbassadorEarning);

describe('ONBOARD_METHODS / deriveReferralCode', () => {
  it('lists the three design methods, scan fastest', () => {
    expect(ONBOARD_METHODS.map((m) => m.key)).toEqual(['scan', 'manual', 'sms']);
    expect(ONBOARD_METHODS.find((m) => m.key === 'scan')!.fastest).toBe(true);
  });
  it('derives a valid shareable code from a seed', () => {
    const c = deriveReferralCode('a1b2-c3d4-e5f6');
    expect(isValidReferralCode(c)).toBe(true);
    expect(c).toBe('A1B2C3D4');
    expect(isValidReferralCode(deriveReferralCode('x'))).toBe(true); // short seed padded
  });
});

describe('referralStatusTone', () => {
  it('tones across the funnel', () => {
    expect(referralStatusTone('invited')).toBe('neutral');
    expect(referralStatusTone('signed_up')).toBe('info');
    expect(referralStatusTone('activated')).toBe('accent');
    expect(referralStatusTone('rewarded')).toBe('success');
  });
});

describe('normalizeReferralCode / isValidReferralCode', () => {
  it('upper-cases and strips non-alphanumerics', () => {
    expect(normalizeReferralCode(' ram-esh 24 ')).toBe('RAMESH24');
    expect(normalizeReferralCode('a@b#c1')).toBe('ABC1');
  });
  it('mirrors the server regex ^[A-Z0-9]{4,20}$', () => {
    expect(isValidReferralCode('ABCD')).toBe(true);
    expect(isValidReferralCode('RAMESH24')).toBe(true);
    expect(isValidReferralCode('ABC')).toBe(false);            // too short
    expect(isValidReferralCode('A'.repeat(21))).toBe(false);   // too long
    expect(isValidReferralCode('abcd')).toBe(false);           // lower-case (normalize first)
    expect(isValidReferralCode('AB CD')).toBe(false);          // space
  });
});

describe('referralFunnel', () => {
  it('tallies by stage', () => {
    const f = referralFunnel([ref('invited'), ref('invited'), ref('signed_up'), ref('activated'), ref('rewarded')]);
    expect(f).toEqual({ invited: 2, signedUp: 1, activated: 1, rewarded: 1, total: 5 });
  });
  it('tolerates empty', () => {
    expect(referralFunnel([])).toEqual({ invited: 0, signedUp: 0, activated: 0, rewarded: 0, total: 0 });
  });
});

describe('sumEarningsMinor', () => {
  it('sums all as bigint-minor string', () => {
    expect(sumEarningsMinor([earn('50000'), earn('120000', 'p1')])).toBe('170000');
  });
  it('unpaidOnly excludes paid-out earnings', () => {
    expect(sumEarningsMinor([earn('50000'), earn('120000', 'p1')], true)).toBe('50000');
  });
  it('skips malformed, never floats', () => {
    expect(sumEarningsMinor([earn('abc'), earn('100')])).toBe('100');
    expect(sumEarningsMinor([])).toBe('0');
  });
});

describe('isConverted', () => {
  it('signed_up and beyond count as converted', () => {
    expect(isConverted('invited')).toBe(false);
    expect(isConverted('signed_up')).toBe(true);
    expect(isConverted('activated')).toBe(true);
    expect(isConverted('rewarded')).toBe(true);
  });
});
