// Unit tests for the PURE browse-jobs filter/sort/tag logic (screen 30).
import { matchesFilter, filterJobs, sortJobs, jobTags, presentSkillIds } from '../../features/labour/browse-jobs';
import type { LabourBooking } from '@krishalaya/sdk-js';

const now = Date.parse('2026-08-18T12:00:00Z');
const b = (over: Partial<LabourBooking>): LabourBooking => ({
  id: 'b', bookingNo: 'B1', employerUserId: 'emp-123456', demandTypeId: null, taskSkillId: null,
  workersNeeded: 1, startDate: '2026-08-18T06:00:00Z', endDate: null, wageKind: 'per_day',
  wageOfferedMinor: '40000', minWageMinor: '35000', currencyCode: 'INR', womenOnly: false, status: 'open', respondBy: null, ...over,
});

describe('browse jobs (screen 30)', () => {
  it('matchesFilter: all/today/week/group/women/skill', () => {
    expect(matchesFilter(b({}), 'all', now)).toBe(true);
    expect(matchesFilter(b({ startDate: '2026-08-18T06:00:00Z' }), 'today', now)).toBe(true);
    expect(matchesFilter(b({ startDate: '2026-08-20T06:00:00Z' }), 'today', now)).toBe(false);
    expect(matchesFilter(b({ startDate: '2026-08-22T06:00:00Z' }), 'week', now)).toBe(true);
    expect(matchesFilter(b({ startDate: '2026-09-30T06:00:00Z' }), 'week', now)).toBe(false);
    expect(matchesFilter(b({ workersNeeded: 12 }), 'group', now)).toBe(true);
    expect(matchesFilter(b({ workersNeeded: 1 }), 'group', now)).toBe(false);
    expect(matchesFilter(b({ womenOnly: true }), 'women', now)).toBe(true);
    expect(matchesFilter(b({ taskSkillId: 's1' }), 'skill:s1', now)).toBe(true);
    expect(matchesFilter(b({ taskSkillId: 's2' }), 'skill:s1', now)).toBe(false);
  });
  it('filterJobs returns only matching', () => {
    const items = [b({ id: 'a', workersNeeded: 5 }), b({ id: 'c', workersNeeded: 1 })];
    expect(filterJobs(items, 'group', now).map((x) => x.id)).toEqual(['a']);
  });
  it('sortJobs: soonest date, and highest wage descending', () => {
    const items = [b({ id: 'late', startDate: '2026-08-25T00:00:00Z', wageOfferedMinor: '20000' }), b({ id: 'soon', startDate: '2026-08-19T00:00:00Z', wageOfferedMinor: '90000' })];
    expect(sortJobs(items, 'soonest').map((x) => x.id)).toEqual(['soon', 'late']);
    expect(sortJobs(items, 'wage').map((x) => x.id)).toEqual(['soon', 'late']); // soon has higher wage
    expect(sortJobs([b({ id: 'lo', wageOfferedMinor: '100' }), b({ id: 'hi', wageOfferedMinor: '999' })], 'wage').map((x) => x.id)).toEqual(['hi', 'lo']);
  });
  it('jobTags reflects only booking-backed badges', () => {
    expect(jobTags(b({ workersNeeded: 12, womenOnly: true, wageOfferedMinor: '40000', minWageMinor: '35000' }))).toEqual(['group', 'women', 'aboveMin']);
    expect(jobTags(b({ workersNeeded: 1, womenOnly: false, wageOfferedMinor: '35000', minWageMinor: '35000' }))).toEqual([]);
  });
  it('presentSkillIds is first-seen distinct', () => {
    expect(presentSkillIds([b({ taskSkillId: 's1' }), b({ taskSkillId: 's2' }), b({ taskSkillId: 's1' }), b({ taskSkillId: null })])).toEqual(['s1', 's2']);
  });
});
