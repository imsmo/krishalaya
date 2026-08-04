import { buildCollection, buildBillGen, canPreview, canApprove, canPay, isBillStatus, ADULTERATION_FLAGS } from '../features/dairy/pos';

const base = { membershipId: 'm1', shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.5', fatPct: '4.2', snfPct: '8.5', waterFlag: false, adulteration: [] as string[] };

describe('features/dairy/pos (OW-4)', () => {
  it('collection: decimals validated; quality bounds 0–15%; flags filtered to the known set', () => {
    expect(buildCollection(base)).toEqual({ ok: true, value: { membershipId: 'm1', shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.5', fatPct: '4.2', snfPct: '8.5' } });
    const flagged = buildCollection({ ...base, waterFlag: true, adulteration: ['water', 'made-up'] });
    expect(flagged).toEqual({ ok: true, value: { ...((buildCollection(base) as { value: object }).value), waterFlag: true, adulterationFlags: ['water'] } });
    expect(buildCollection({ ...base, membershipId: '' })).toEqual({ ok: false, error: 'member' });
    expect(buildCollection({ ...base, shift: 'noon' })).toEqual({ ok: false, error: 'shift' });
    expect(buildCollection({ ...base, weightKg: '0' })).toEqual({ ok: false, error: 'weight' });
    expect(buildCollection({ ...base, fatPct: '22' })).toEqual({ ok: false, error: 'fat' });
    expect(buildCollection({ ...base, snfPct: 'abc' })).toEqual({ ok: false, error: 'snf' });
    expect(ADULTERATION_FLAGS).toContain('urea');
  });

  it('bill generation: ordered YYYY-MM-DD period', () => {
    expect(buildBillGen({ membershipId: 'm1', periodStart: '2026-08-01', periodEnd: '2026-08-15' }).ok).toBe(true);
    expect(buildBillGen({ membershipId: 'm1', periodStart: '2026-08-15', periodEnd: '2026-08-01' })).toEqual({ ok: false, error: 'period' });
    expect(buildBillGen({ membershipId: '', periodStart: '2026-08-01', periodEnd: '2026-08-15' })).toEqual({ ok: false, error: 'member' });
  });

  it('bill gates mirror draft→previewed→approved→paid', () => {
    expect(canPreview('draft')).toBe(true); expect(canPreview('previewed')).toBe(false);
    expect(canApprove('previewed')).toBe(true); expect(canApprove('draft')).toBe(false);
    expect(canPay('approved')).toBe(true); expect(canPay('paid')).toBe(false);
    expect(isBillStatus('disputed')).toBe(true); expect(isBillStatus('x')).toBe(false);
  });
});
