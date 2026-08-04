// Unit tests for the PURE worker-home presenters (screen 29).
import { initials, pendingOfferCount, confirmedCount, taskEmoji, skillLabel, workTypeLabel } from '../../features/labour/worker-home';
import type { LabourAssignment, LabourLookups } from '@krishalaya/sdk-js';

const a = (status: string): LabourAssignment => ({ id: status, bookingId: 'b', workerId: 'w', status, wageMinor: '0', acceptedAt: null });

describe('worker home (screen 29)', () => {
  it('initials takes first two words, uppercased, with a fallback', () => {
    expect(initials('Sunita Kumari')).toBe('SK');
    expect(initials('  ramesh  ')).toBe('R');
    expect(initials('')).toBe('K');
    expect(initials(undefined, 'W')).toBe('W');
    expect(initials('a b c')).toBe('AB');
  });
  it('pendingOfferCount counts only pending_worker', () => {
    expect(pendingOfferCount([a('pending_worker'), a('accepted'), a('pending_worker'), a('rejected')])).toBe(2);
    expect(pendingOfferCount([])).toBe(0);
  });
  it('confirmedCount counts only accepted', () => {
    expect(confirmedCount([a('accepted'), a('accepted'), a('paid'), a('pending_worker')])).toBe(2);
  });
  it('taskEmoji maps by keyword and falls back generically', () => {
    expect(taskEmoji('Wheat harvesting')).toBe('🌾');
    expect(taskEmoji('Sowing')).toBe('🌱');
    expect(taskEmoji('Irrigation setup')).toBe('💧');
    expect(taskEmoji('Something else')).toBe('🧺');
    expect(taskEmoji(null)).toBe('🧺');
  });
  it('skillLabel resolves via lookups, else null', () => {
    const l = { workTypes: [], skills: [{ id: 's1', code: 'harvest', name: 'Harvesting', tier: 1, parentId: null, hazardous: false }], regions: [], skillLevels: [] } as LabourLookups;
    expect(skillLabel({ taskSkillId: 's1' }, l)).toBe('Harvesting');
    expect(skillLabel({ taskSkillId: 'nope' }, l)).toBeNull();
    expect(skillLabel({ taskSkillId: null }, l)).toBeNull();
    expect(skillLabel({ taskSkillId: 's1' }, null)).toBeNull();
  });
  it('workTypeLabel resolves via lookups, else null', () => {
    const l = { workTypes: [{ id: 'w1', code: 'manual', name: 'Manual harvesting' }], skills: [], regions: [], skillLevels: [] } as LabourLookups;
    expect(workTypeLabel({ demandTypeId: 'w1' }, l)).toBe('Manual harvesting');
    expect(workTypeLabel({ demandTypeId: 'nope' }, l)).toBeNull();
    expect(workTypeLabel({ demandTypeId: null }, l)).toBeNull();
    expect(workTypeLabel({ demandTypeId: 'w1' }, null)).toBeNull();
  });
});
