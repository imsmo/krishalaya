import { flattenRegionNav } from '../features/discovery/regions';
import type { RegionNode } from '@krishalaya/sdk-js';

const n = (over: Partial<RegionNode>): RegionNode => ({
  id: 'r', code: null, level: 1, parentId: null, name: 'Region', lat: null, lng: null, ...over,
});

describe('features/discovery/regions', () => {
  it('flattens with level-based indent, normalised to the shallowest node', () => {
    const out = flattenRegionNav([
      n({ id: 's1', level: 1, name: 'Gujarat' }),
      n({ id: 'd1', level: 2, name: 'Anand', parentId: 's1' }),
      n({ id: 'v1', level: 3, name: 'Karamsad', parentId: 'd1' }),
    ]);
    expect(out.map((o) => o.depth)).toEqual([0, 1, 2]);
    expect(out[0].label).toBe('Gujarat');
    expect(out[1].label.endsWith('Anand')).toBe(true);
    expect(out[1].label.length).toBeGreaterThan('Anand'.length);
  });

  it('subtree reads (all level 2+) still indent from zero', () => {
    const out = flattenRegionNav([n({ id: 'd1', level: 2, name: 'Anand' }), n({ id: 'v1', level: 3, name: 'Karamsad' })]);
    expect(out.map((o) => o.depth)).toEqual([0, 1]);
  });

  it('degrades to [] on empty/nullish/malformed input', () => {
    expect(flattenRegionNav([])).toEqual([]);
    expect(flattenRegionNav(null)).toEqual([]);
    expect(flattenRegionNav(undefined)).toEqual([]);
    expect(flattenRegionNav([n({ id: '', name: 'x' }), n({ id: 'ok', name: '' })])).toEqual([]);
  });
});
