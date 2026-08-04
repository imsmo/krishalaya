// Unit tests for the PURE hire-browse logic (screen 42).
import { filterWorkers, sortWorkers, skillChips, bookableSkills } from '../../features/labour/hire-browse';
import type { WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';

const w = (over: Partial<WorkerProfile>): WorkerProfile => ({
  id: 'w', userId: 'u', ageVerified18: true, villageRegionId: null, travelKm: null, stayAwayOk: null,
  minWageExpectationMinor: null, autoAcceptAboveMinor: null, hasSmartphone: null, ratingAvg: 4.5,
  bookingsCompleted: 10, noShowCount: 0, ...over,
});

describe('hire browse (screen 42)', () => {
  it('filterWorkers: rating, verified, skill (skill no-ops when no skillIds)', () => {
    const items = [w({ id: 'a', ratingAvg: 4.9 }), w({ id: 'b', ratingAvg: 4.0 }), w({ id: 'c', ratingAvg: 4.6, ageVerified18: false })];
    expect(filterWorkers(items, { minRating: 4.5 }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterWorkers(items, { verified: true }).map((x) => x.id)).toEqual(['a', 'b']);
    // skill filter applies only to workers that carry skillIds
    const sk = [w({ id: 'x', skillIds: ['s1'] }), w({ id: 'y', skillIds: ['s2'] }), w({ id: 'z' })];
    expect(filterWorkers(sk, { skillId: 's1' }).map((x) => x.id)).toEqual(['x', 'z']); // z has no skillIds → not hidden
  });
  it('sortWorkers by rating / jobs, descending, nulls last', () => {
    const items = [w({ id: 'lo', ratingAvg: 4.1 }), w({ id: 'hi', ratingAvg: 4.9 }), w({ id: 'na', ratingAvg: null })];
    expect(sortWorkers(items, 'rating').map((x) => x.id)).toEqual(['hi', 'lo', 'na']);
    const j = [w({ id: 'a', bookingsCompleted: 5 }), w({ id: 'b', bookingsCompleted: 50 })];
    expect(sortWorkers(j, 'jobs').map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('skillChips caps + overflow, empty without lookups/skillIds', () => {
    const l = { workTypes: [], skills: [{ id: 's1', code: 'h', name: 'Harvest', tier: 1, parentId: null, hazardous: false }, { id: 's2', code: 'sow', name: 'Sowing', tier: 1, parentId: null, hazardous: false }, { id: 's3', code: 'w', name: 'Weeding', tier: 1, parentId: null, hazardous: false }], regions: [], skillLevels: [] } as LabourLookups;
    expect(skillChips(['s1', 's2', 's3'], l, 2)).toEqual({ labels: ['Harvest', 'Sowing'], extra: 1 });
    expect(skillChips(['s1'], l, 2)).toEqual({ labels: ['Harvest'], extra: 0 });
    expect(skillChips(undefined, l)).toEqual({ labels: [], extra: 0 });
    expect(skillChips(['s1'], null)).toEqual({ labels: [], extra: 0 });
  });
  it('bookableSkills: own skills when present, else full catalogue, [] without lookups', () => {
    const l = { workTypes: [], skills: [{ id: 's1', code: 'h', name: 'Harvest', tier: 1, parentId: null, hazardous: false }, { id: 's2', code: 'sow', name: 'Sowing', tier: 1, parentId: null, hazardous: false }], regions: [], skillLevels: [] } as LabourLookups;
    expect(bookableSkills(['s2'], l).map((s) => s.id)).toEqual(['s2']);
    expect(bookableSkills(undefined, l).map((s) => s.id)).toEqual(['s1', 's2']); // fallback to full catalogue
    expect(bookableSkills(['nope'], l).map((s) => s.id)).toEqual(['s1', 's2']); // no matches → full catalogue
    expect(bookableSkills(['s1'], null)).toEqual([]);
  });
});
