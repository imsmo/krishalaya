import { buildTier, isMembershipStatus } from '../features/members/form';

describe('features/members/form (PC-28)', () => {
  it('tier: code pattern, name 2–120, float-free fees, blank monthly = 0, optional annual', () => {
    expect(buildTier({ code: 'gold_2026', name: 'Gold', monthlyMajor: '99.50', annualMajor: '999' }))
      .toEqual({ ok: true, value: { code: 'gold_2026', defaultName: 'Gold', monthlyFeeMinor: '9950', annualFeeMinor: '99900' } });
    expect(buildTier({ code: 'basic', name: 'Basic', monthlyMajor: '', annualMajor: '' }))
      .toEqual({ ok: true, value: { code: 'basic', defaultName: 'Basic', monthlyFeeMinor: '0' } });
    expect(buildTier({ code: 'x', name: 'ok', monthlyMajor: '', annualMajor: '' })).toEqual({ ok: false, error: 'code' });
    expect(buildTier({ code: 'has space', name: 'ok', monthlyMajor: '', annualMajor: '' })).toEqual({ ok: false, error: 'code' });
    expect(buildTier({ code: 'ok', name: 'x', monthlyMajor: '', annualMajor: '' })).toEqual({ ok: false, error: 'name' });
    expect(buildTier({ code: 'ok', name: 'Fine', monthlyMajor: 'abc', annualMajor: '' })).toEqual({ ok: false, error: 'fee' });
  });
  it('status filter accepts only known statuses', () => {
    expect(isMembershipStatus('active')).toBe(true);
    expect(isMembershipStatus('bogus')).toBe(false);
  });
});
