// modules/gov-console/__tests__/gov-overview.spec.ts · PC-56 GOV-1b · GOV1-B5 — the overview's shape (pure): every scheme with zeros, every
// counted status with zeros, drafts and unknown statuses never counted, a cell for a scheme the authority does not run never counted, the two
// queues with the oldest age, and no key that could carry an application, a person, an organisation, a share or money.
import { OVERVIEW_QUEUES, OVERVIEW_STATUSES, shapeOverview } from '../domain/gov-overview';

const S1 = { id: 's1', code: 'a_one', name: 'Scheme One' };
const S2 = { id: 's2', code: 'b_two', name: 'Scheme Two' };
const AT = '2026-11-10T00:00:00.000Z';

describe('PC-56 GOV-1b · shapeOverview', () => {
  it('no scheme → zero of everything, both queues present with no age', () => {
    const o = shapeOverview([], [], AT);
    expect(o).toEqual({ window: { kind: 'all_time', draftsCounted: false }, computedAt: AT, schemes: { count: 0 }, byScheme: [],
      totals: { total: 0, byStatus: Object.fromEntries(OVERVIEW_STATUSES.map((s) => [s, 0])) },
      queues: [{ status: 'clarification_needed', count: 0, oldestDays: null }, { status: 'appealed', count: 0, oldestDays: null }] });
  });
  it('counts by scheme × status and the totals add up; zeros kept; drafts, unknown statuses and foreign schemes never counted', () => {
    const o = shapeOverview([S1, S2], [
      { schemeId: 's1', status: 'submitted', count: 40, oldestDays: 3 }, { schemeId: 's1', status: 'clarification_needed', count: 7, oldestDays: 12 },
      { schemeId: 's2', status: 'clarification_needed', count: 2, oldestDays: 30 }, { schemeId: 's2', status: 'appealed', count: 4, oldestDays: 0 },
      { schemeId: 's1', status: 'draft', count: 99, oldestDays: 1 }, { schemeId: 's1', status: 'nonsense', count: 5, oldestDays: 1 },
      { schemeId: 'elsewhere', status: 'submitted', count: 1000, oldestDays: 400 },
    ], AT);
    expect(o.schemes.count).toBe(2);
    expect(o.byScheme.map((r) => [r.scheme.code, r.total])).toEqual([['a_one', 47], ['b_two', 6]]);
    expect(o.byScheme[1].byStatus).toMatchObject({ submitted: 0, clarification_needed: 2, appealed: 4 });
    expect(o.totals.total).toBe(53); expect(o.totals.byStatus.submitted).toBe(40);
    expect(Object.keys(o.totals.byStatus)).toEqual([...OVERVIEW_STATUSES]);
    expect(o.queues).toEqual([{ status: 'clarification_needed', count: 9, oldestDays: 30 }, { status: 'appealed', count: 4, oldestDays: 0 }]);
    expect([...OVERVIEW_QUEUES]).toEqual(['clarification_needed', 'appealed']);
  });
  it('no key could carry an application, a person, an organisation, a share or money', () => {
    const o = shapeOverview([S1], [{ schemeId: 's1', status: 'approved', count: 3, oldestDays: 2 }], AT);
    const keys: string[] = [];
    const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
    walk(o);
    expect(keys.filter((k) => /application|applicant|organisation|tenant|user|member|form|district|percent|rate|target|amount|minor|sum|credit|rupee|inr/i.test(k))).toEqual([]);
  });
});
