// Unit tests for the PURE category-nav flattener (P1-9). Pins: real names (not UUIDs), depth-indent preserves the
// server's path order, inactive nodes dropped, empty/garbage degrades to [].
import type { CategoryNode } from '@krishalaya/sdk-js';
import { flattenCategoryNav } from '../features/discovery/categories';

const cat = (over: Partial<CategoryNode>): CategoryNode => ({
  id: 'c', parentId: null, code: 'c', defaultName: 'C', path: 'c', depth: 1,
  commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1, ...over,
});

describe('flattenCategoryNav', () => {
  it('indents children under parents (path-ordered) and uses real names', () => {
    const out = flattenCategoryNav([
      cat({ id: 'a', code: 'grains', defaultName: 'Grains', depth: 1 }),
      cat({ id: 'b', code: 'wheat', defaultName: 'Wheat', depth: 2 }),
      cat({ id: 'c', code: 'veg', defaultName: 'Vegetables', depth: 1 }),
    ]);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].label).toBe('Grains');
    expect(out[1].label).toMatch(/Wheat$/);
    expect(out[1].depth).toBe(1); // one level under the shallowest
    expect(out[2].label).toBe('Vegetables');
  });
  it('normalises indent to the shallowest present node (subtree read still indents from 0)', () => {
    const out = flattenCategoryNav([cat({ id: 'b', defaultName: 'Wheat', depth: 2 })]);
    expect(out[0].depth).toBe(0);
    expect(out[0].label).toBe('Wheat');
  });
  it('drops inactive nodes and falls back to code/id when name is missing', () => {
    const out = flattenCategoryNav([
      cat({ id: 'x', defaultName: 'X', isActive: false }),
      cat({ id: 'y', code: 'pulses', defaultName: undefined as unknown as string, depth: 1 }),
    ]);
    expect(out.map((o) => o.id)).toEqual(['y']);
    expect(out[0].label).toBe('pulses');
  });
  it('degrades empty / null / undefined to []', () => {
    expect(flattenCategoryNav([])).toEqual([]);
    expect(flattenCategoryNav(null)).toEqual([]);
    expect(flattenCategoryNav(undefined)).toEqual([]);
  });
});
