// PC-53 · cells spec. Pins: precedence (tenant pin > country > default), malformed config ⇒ single-cell
// (boot never dies), and the single-cell no-op contract (today's behaviour byte-identical).
import { parseCellMap, cellFor, isSingleCell, SINGLE_CELL } from '../cell-resolver';

describe('parseCellMap', () => {
  it('parses a real map, survives garbage, defaults to single-cell', () => {
    const m = parseCellMap('{"default":"in-1","countries":{"BD":"bd-1","NP":"in-1"},"tenants":{"t9":"bd-1"}}');
    expect(m.defaultCell).toBe('in-1');
    expect(m.countries.BD).toBe('bd-1');
    expect(parseCellMap('nonsense')).toEqual(SINGLE_CELL);
    expect(parseCellMap(undefined)).toEqual(SINGLE_CELL);
    expect(parseCellMap('{"countries":{"LK":42}}').countries).toEqual({}); // non-string cells dropped
  });
});

describe('cellFor (residency precedence)', () => {
  const m = parseCellMap('{"default":"in-1","countries":{"BD":"bd-1"},"tenants":{"t9":"bd-1","t2":"in-1"}}');
  it('tenant pin > country > default; country is case-insensitive', () => {
    expect(cellFor(m, { tenantId: 't9', countryCode: 'IN' })).toBe('bd-1'); // pin wins
    expect(cellFor(m, { countryCode: 'bd' })).toBe('bd-1');
    expect(cellFor(m, { countryCode: 'LK' })).toBe('in-1');                 // unmapped country ⇒ default, never blocked
    expect(cellFor(m, {})).toBe('in-1');
  });
});

describe('isSingleCell (the no-op contract)', () => {
  it('unset CELL_ID or a one-cell map ⇒ guard inert', () => {
    expect(isSingleCell(SINGLE_CELL, undefined)).toBe(true);
    expect(isSingleCell(SINGLE_CELL, 'in-1')).toBe(true);
    expect(isSingleCell(parseCellMap('{"default":"in-1","countries":{"BD":"bd-1"}}'), 'in-1')).toBe(false);
  });
});
