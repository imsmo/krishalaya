// Unit tests for the PURE Ambassador-Home logic (features/ambassador/ambassador-home) behind screen 86.
import { referralsThisMonth, pendingReferrals, myRank, personInitials, FARMER_TABS, filterReferralsByTab, farmerTabCounts, sortByRank, onboardsToReachTop, tenureYears } from '../../features/ambassador/ambassador-home';
import type { LeaderboardEntry } from '@krishalaya/sdk-js';

const r = (id: string, status: string, createdAt?: string) => ({ id, referrerUserId: 'me', refereeUserId: null, code: id, status, createdAt } as never);
const lb = (userId: string, rank: number, events: number, earnedMinor = '0'): LeaderboardEntry => ({ ambassadorId: 'amb-' + userId, userId, tierId: null, earnedMinor, events, rank } as LeaderboardEntry);

describe('sortByRank', () => {
  it('sorts ascending by server rank without mutating input', () => {
    const input = [lb('c', 3, 8), lb('a', 1, 18), lb('b', 2, 15)];
    expect(sortByRank(input).map((e) => e.userId)).toEqual(['a', 'b', 'c']);
    expect(input.map((e) => e.userId)).toEqual(['c', 'a', 'b']);
    expect(sortByRank(null)).toEqual([]);
  });
});

describe('tenureYears', () => {
  const now = Date.UTC(2026, 6, 15);
  it('floors whole years since join; null when absent/bad/negative', () => {
    expect(tenureYears('2024-06-01T00:00:00Z', now)).toBe(2);
    expect(tenureYears('2026-01-01T00:00:00Z', now)).toBe(0);
    expect(tenureYears(null, now)).toBeNull();
    expect(tenureYears('nope', now)).toBeNull();
    expect(tenureYears('2027-01-01T00:00:00Z', now)).toBeNull();
  });
});

describe('onboardsToReachTop', () => {
  const board = [lb('deepak', 1, 18), lb('rita', 2, 15), lb('me', 3, 12)];
  it('computes topEvents − myEvents + 1', () => {
    expect(onboardsToReachTop(board, 'me')).toBe(7); // 18 - 12 + 1
  });
  it('null when caller is #1, unranked, or board empty', () => {
    expect(onboardsToReachTop(board, 'deepak')).toBeNull();
    expect(onboardsToReachTop(board, 'ghost')).toBeNull();
    expect(onboardsToReachTop([], 'me')).toBeNull();
    expect(onboardsToReachTop(board, null)).toBeNull();
  });
});

describe('referralsThisMonth', () => {
  const now = Date.UTC(2026, 6, 15); // Jul 2026
  it('counts only this-month referrals', () => {
    const items = [r('a', 'invited', '2026-07-02T00:00:00Z'), r('b', 'signed_up', '2026-07-30T00:00:00Z'), r('c', 'invited', '2026-06-30T00:00:00Z'), r('d', 'invited')];
    expect(referralsThisMonth(items, now)).toBe(2);
    expect(referralsThisMonth([], now)).toBe(0);
    expect(referralsThisMonth(null, now)).toBe(0);
  });
});

describe('pendingReferrals', () => {
  it('keeps invited/signed_up, newest first, capped', () => {
    const items = [r('a', 'invited', '2026-07-01T00:00:00Z'), r('b', 'activated', '2026-07-02T00:00:00Z'), r('c', 'signed_up', '2026-07-03T00:00:00Z'), r('d', 'rewarded', '2026-07-04T00:00:00Z')];
    const out = pendingReferrals(items, 4);
    expect(out.map((x) => x.id)).toEqual(['c', 'a']);
    expect(pendingReferrals(items, 1).map((x) => x.id)).toEqual(['c']);
  });
});

describe('myRank', () => {
  const board = [{ ambassadorId: 'x', userId: 'u1', tierId: null, earnedMinor: '0', events: 0, rank: 1 }, { ambassadorId: 'y', userId: 'u2', tierId: null, earnedMinor: '0', events: 0, rank: 3 }] as never;
  it('finds the caller rank or null', () => {
    expect(myRank(board, 'u2')).toBe(3);
    expect(myRank(board, 'u9')).toBeNull();
    expect(myRank(board, null)).toBeNull();
  });
});

describe('personInitials', () => {
  it('derives ≤2 upper-case letters, degrades to a dash', () => {
    expect(personInitials('Anil Kumar')).toBe('AK');
    expect(personInitials('KV7Q')).toBe('KV');
    expect(personInitials('')).toBe('–');
    expect(personInitials(null)).toBe('–');
  });
});

describe('farmer tabs', () => {
  const items = [r('a', 'invited', '2026-07-01T00:00:00Z'), r('b', 'activated', '2026-07-03T00:00:00Z'), r('c', 'signed_up', '2026-07-02T00:00:00Z'), r('d', 'rewarded', '2026-07-04T00:00:00Z')];
  it('has the three real buckets', () => { expect(FARMER_TABS).toEqual(['all', 'onboarded', 'pending']); });
  it('counts buckets from real statuses', () => {
    expect(farmerTabCounts(items)).toEqual({ all: 4, onboarded: 2, pending: 2 });
    expect(farmerTabCounts([])).toEqual({ all: 0, onboarded: 0, pending: 0 });
  });
  it('filters + sorts newest-first', () => {
    expect(filterReferralsByTab(items, 'onboarded').map((x) => x.id)).toEqual(['d', 'b']);
    expect(filterReferralsByTab(items, 'pending').map((x) => x.id)).toEqual(['c', 'a']);
    expect(filterReferralsByTab(items, 'all').map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});
