import { buildBillGen, canPreview, canApprove, canPay, isBillStatus, ADULTERATION_FLAGS } from '../features/dairy/pos';
import { buildPour } from '../features/ops3/counter';

const M = '0192d2c4-0000-7000-8000-000000000001';
const base = { membershipId: M, shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.5', fatPct: '4.2', snfPct: '8.5', waterFlag: false, adulteration: [] as string[] };

describe('features/dairy/pos (OW-4)', () => {
  // NAMED UPDATE (PC-56 OPS-3a): the pour-record check moved with the form to the counter — `buildCollection` → `buildPour`
  // (features/ops3/counter.ts). The same cases, kept — decimals validated, the 0–15 % bound on fat and SNF (now by PATTERN, no `Number(…)` on the
  // reading path, OPS3-B18), flags filtered to the known set — plus one: a day after the organisation's today is refused (founder Q5-A).
  it('collection: decimals validated; quality bounds 0–15%; flags filtered to the known set; a future day refused', () => {
    const today = '2026-11-09';
    expect(buildPour(base, today)).toEqual({ ok: true, value: { membershipId: M, shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.5', fatPct: '4.2', snfPct: '8.5' } });
    const flagged = buildPour({ ...base, waterFlag: true, adulteration: ['water', 'made-up'] }, today);
    expect(flagged).toEqual({ ok: true, value: { ...((buildPour(base, today) as { value: object }).value), waterFlag: true, adulterationFlags: ['water'] } });
    expect(buildPour({ ...base, membershipId: '' }, today)).toEqual({ ok: false, error: 'member' });
    expect(buildPour({ ...base, shift: 'noon' }, today)).toEqual({ ok: false, error: 'shift' });
    expect(buildPour({ ...base, weightKg: '0' }, today)).toEqual({ ok: false, error: 'weight' });
    expect(buildPour({ ...base, fatPct: '22' }, today)).toEqual({ ok: false, error: 'fat' });
    expect(buildPour({ ...base, fatPct: '15.01' }, today)).toEqual({ ok: false, error: 'fat' });
    expect(buildPour({ ...base, fatPct: '15.00', snfPct: '14.99' }, today).ok).toBe(true);
    expect(buildPour({ ...base, snfPct: 'abc' }, today)).toEqual({ ok: false, error: 'snf' });
    expect(buildPour({ ...base, collectedOn: '2026-11-10' }, today)).toEqual({ ok: false, error: 'future' });
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
