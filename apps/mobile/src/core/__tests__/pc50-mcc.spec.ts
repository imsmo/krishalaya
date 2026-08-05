// PC-50 W10-7 · pure MCC-counter logic. Pins the slip builder against web-ops pos.ts (the proven counter
// rules: DEC bounds, seeded adulteration vocabulary, strict omission — and NO price field anywhere) and the
// member display filter.
import { buildSlipDraft, filterMembers } from '../../features/mcc-operator/mcc';

describe('buildSlipDraft (mirrors web-ops pos.ts / RecordCollectionSchema)', () => {
  const base = { membershipId: 'm1', shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.500', fatPct: '4.2', snfPct: '8.5', waterFlag: false, adulteration: [] as string[] };
  it('accepts a clean slip and NEVER carries money', () => {
    const r = buildSlipDraft(base);
    expect(r).toEqual({ ok: true, value: { membershipId: 'm1', shift: 'morning', collectedOn: '2026-08-05', weightKg: '12.500', fatPct: '4.2', snfPct: '8.5' } });
    if (r.ok) { expect(r.value).not.toHaveProperty('amountMinor'); expect(r.value).not.toHaveProperty('rateCardId'); }
  });
  it('enforces the counter bounds and the seeded adulteration vocabulary', () => {
    expect(buildSlipDraft({ ...base, weightKg: '0' })).toEqual({ ok: false, error: 'weight' });
    expect(buildSlipDraft({ ...base, fatPct: '15.5' })).toEqual({ ok: false, error: 'fat' });
    expect(buildSlipDraft({ ...base, snfPct: '0' })).toEqual({ ok: false, error: 'snf' });
    expect(buildSlipDraft({ ...base, shift: 'noon' })).toEqual({ ok: false, error: 'shift' });
    const r = buildSlipDraft({ ...base, waterFlag: true, adulteration: ['starch', 'plutonium'] });
    expect(r).toEqual({ ok: true, value: { ...((buildSlipDraft(base) as { value: object }).value), waterFlag: true, adulterationFlags: ['starch'] } });
  });
});

describe('filterMembers (display filter, never money)', () => {
  it('case-insensitive contains on memberCode', () => {
    const ms = [{ memberCode: 'AMB-001' }, { memberCode: 'amb-042' }, { memberCode: 'KRJ-007' }];
    expect(filterMembers(ms, 'amb').map((m) => m.memberCode)).toEqual(['AMB-001', 'amb-042']);
    expect(filterMembers(ms, '')).toHaveLength(3);
  });
});
