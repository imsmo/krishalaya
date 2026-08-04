// Unit tests for the PURE Visit-Log derivations (features/ambassador/visits, screen 164). §13: only real logged
// visits are bucketed/counted; no farmer/region name, planned row, or km is invented.
import { visitDayBucket, groupVisitsByDay, visitsThisMonth, distinctRegionsThisMonth } from '../../features/ambassador/visits';
import type { AmbassadorVisit } from '@krishalaya/sdk-js';

const v = (id: string, visitedAt: string, regionId: string | null = null): AmbassadorVisit =>
  ({ id, ambassadorId: 'a', visitedUserId: null, purpose: 'help', notes: null, lat: null, lng: null, regionId, visitedAt } as AmbassadorVisit);

const now = new Date('2026-08-20T18:00:00Z');

describe('visitDayBucket', () => {
  it('classifies today / yesterday / earlier; null when bad', () => {
    expect(visitDayBucket('2026-08-20T09:00:00Z', now)).toBe('today');
    expect(visitDayBucket('2026-08-19T09:00:00Z', now)).toBe('yesterday');
    expect(visitDayBucket('2026-08-10T09:00:00Z', now)).toBe('earlier');
    expect(visitDayBucket(null, now)).toBeNull();
    expect(visitDayBucket('nope', now)).toBeNull();
  });
});

describe('groupVisitsByDay', () => {
  it('buckets + sorts newest-first within each day', () => {
    const g = groupVisitsByDay([
      v('a', '2026-08-20T08:00:00Z'), v('b', '2026-08-20T12:00:00Z'),
      v('c', '2026-08-19T10:00:00Z'), v('d', '2026-08-01T10:00:00Z'),
    ], now);
    expect(g.today.map((x) => x.id)).toEqual(['b', 'a']);
    expect(g.yesterday.map((x) => x.id)).toEqual(['c']);
    expect(g.earlier.map((x) => x.id)).toEqual(['d']);
  });
});

describe('visitsThisMonth', () => {
  it('counts visits in the current month only', () => {
    expect(visitsThisMonth([v('a', '2026-08-02T00:00:00Z'), v('b', '2026-08-19T00:00:00Z'), v('c', '2026-07-30T00:00:00Z')], now)).toBe(2);
  });
});

describe('distinctRegionsThisMonth', () => {
  it('counts distinct regionIds this month, ignoring null + prior months', () => {
    const list = [v('a', '2026-08-02T00:00:00Z', 'r1'), v('b', '2026-08-05T00:00:00Z', 'r1'), v('c', '2026-08-06T00:00:00Z', 'r2'), v('d', '2026-08-07T00:00:00Z', null), v('e', '2026-07-01T00:00:00Z', 'r9')];
    expect(distinctRegionsThisMonth(list, now)).toBe(2);
  });
});
