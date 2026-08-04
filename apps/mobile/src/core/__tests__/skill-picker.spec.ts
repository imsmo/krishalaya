// Unit tests for the PURE Add-a-Skill logic (features/labour/skill-picker) behind screen 137. Verifies flat rows
// carry real name/emoji + selection, the experience buckets, and the selected count — no fabricated rate range.
import { flatSkillRows, EXPERIENCE_LEVELS, selectedCount } from '../../features/labour/skill-picker';
import type { Skill } from '@krishalaya/sdk-js';

const S = (id: string, code: string, name: string): Skill => ({ id, code, name, tier: 1, parentId: null, hazardous: false });

describe('flatSkillRows', () => {
  it('maps id/name + an emoji, marks selected, preserves order', () => {
    const rows = flatSkillRows([S('a', 'wheat_harvest', 'Wheat harvesting'), S('b', 'weeding', 'Weeding')], new Set(['a']));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'a', name: 'Wheat harvesting', selected: true });
    expect(rows[0].emoji).toBe('🌾');
    expect(rows[1]).toMatchObject({ id: 'b', selected: false });
    // no fabricated rate range on the row
    expect((rows[0] as Record<string, unknown>).rate).toBeUndefined();
  });
  it('is empty for no catalogue', () => {
    expect(flatSkillRows([], new Set())).toEqual([]);
  });
});

describe('EXPERIENCE_LEVELS', () => {
  it('are the four design buckets in order', () => {
    expect(EXPERIENCE_LEVELS.map((l) => l.key)).toEqual(['beginner', 'intermediate', 'skilled', 'expert']);
    expect(EXPERIENCE_LEVELS.map((l) => l.years)).toEqual(['0-2', '3-5', '6-10', '10+']);
  });
});

describe('selectedCount', () => {
  it('counts the picked skills', () => {
    expect(selectedCount(new Set())).toBe(0);
    expect(selectedCount(new Set(['a', 'b', 'c']))).toBe(3);
  });
});
