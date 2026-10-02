// modules/requirements/__tests__/tenant11d-requirement-domain.spec.ts · PC-56 TENANT-11d — the pure rules of the wave:
// the blended price in bigint (floor, remainder shown), the ceiling flag, the lifecycle by quantity, the pooled quote's edges,
// the µs / need-by cursors, the exact quantity round-trip into an order line, and who the policies say may act.
import { aboveCeiling, blend, exactQtyNumber, formatQtyMilli, lineValueMinor, parseQtyMilli, stateForFulfilled } from '../domain/quantity';
import { assertGroupTransition, draftStatusFor, isEditable, GROUP_VALID_MS } from '../domain/response-group';
import { decodeCursor, encodeCursor } from '../domain/cursor';
import { MATCH_RULE, shortName } from '../domain/display';
import { canModerateRequirement, requirementActor, seesAll } from '../policies/requirements.policies';

describe('PC-56 TENANT-11d · the blended price (canon W132: 17 + 23 = 40 qtl, blended under the ceiling)', () => {
  it('Σ(qty × price) ÷ Σ qty in bigint, floor; the total is Σ of each line\'s order total; the remainder makes them add up', () => {
    const b = blend([{ qtyMilli: 17_000n, priceMinor: 634_000n }, { qtyMilli: 23_000n, priceMinor: 644_500n }]);
    expect(b.lineCount).toBe(2);
    expect(formatQtyMilli(b.totalQtyMilli)).toBe('40.000');
    expect(b.totalValueMinor).toBe(17n * 634_000n + 23n * 644_500n);              // 25,601,500 paise
    expect(b.blendedPriceMinor).toBe(25_601_500n / 40n);                          // 640,037 (floor of 640,037.5)
    expect(b.blendedRemainderMinor).toBe(b.totalValueMinor - b.blendedPriceMinor! * 40n);   // 20 paise
    expect(b.blendedRemainderMinor).toBe(20n);
  });
  it('fractional quantities stay exact (thousandths), and an empty draft has no blended price', () => {
    const b = blend([{ qtyMilli: parseQtyMilli('12.5'), priceMinor: 333n }, { qtyMilli: parseQtyMilli('0.125'), priceMinor: 1001n }]);
    expect(b.totalValueMinor).toBe(lineValueMinor(12_500n, 333n) + lineValueMinor(125n, 1001n));
    expect(formatQtyMilli(b.totalQtyMilli)).toBe('12.625');
    expect(blend([])).toEqual({ lineCount: 0, totalQtyMilli: 0n, totalValueMinor: 0n, blendedPriceMinor: null, blendedRemainderMinor: 0n });
  });
  it('the budget is a CEILING: above it is flagged, never refused; no ceiling → never above', () => {
    expect(aboveCeiling(650_001n, 650_000n)).toBe(true);
    expect(aboveCeiling(650_000n, 650_000n)).toBe(false);
    expect(aboveCeiling(900_000n, null)).toBe(false);
  });
});

describe('PC-56 TENANT-11d · the lifecycle runs on the fulfilled QUANTITY', () => {
  it('0 → open, part → partially_matched, all or more → fulfilled', () => {
    expect(stateForFulfilled(0n, 40_000n)).toBe('open');
    expect(stateForFulfilled(25_000n, 40_000n)).toBe('partially_matched');
    expect(stateForFulfilled(40_000n, 40_000n)).toBe('fulfilled');
    expect(stateForFulfilled(41_000n, 40_000n)).toBe('fulfilled');
  });
  it('an order line\'s number is the DB quantity exactly, or refused', () => {
    expect(exactQtyNumber('17.000')).toBe(17);
    expect(exactQtyNumber('12.125')).toBe(12.125);
    expect(exactQtyNumber('99999999999.999')).toBe(99999999999.999);
  });
});

describe('PC-56 TENANT-11d · the pooled quote\'s edges', () => {
  it('draft ⇄ consent_pending → submitted → accepted | rejected | withdrawn; nothing leaves a decision', () => {
    expect(() => assertGroupTransition('draft', 'submitted')).not.toThrow();
    expect(() => assertGroupTransition('consent_pending', 'draft')).not.toThrow();
    expect(() => assertGroupTransition('submitted', 'accepted')).not.toThrow();
    expect(() => assertGroupTransition('submitted', 'draft')).toThrow();
    expect(() => assertGroupTransition('accepted', 'withdrawn')).toThrow();
    expect(() => assertGroupTransition('draft', 'accepted')).toThrow();
    expect(isEditable('consent_pending')).toBe(true); expect(isEditable('submitted')).toBe(false);
  });
  it('any line without its member\'s yes makes the draft consent_pending', () => {
    expect(draftStatusFor([])).toBe('draft');
    expect(draftStatusFor([{ consentId: 'c1' }, { consentId: 'c2' }])).toBe('draft');
    expect(draftStatusFor([{ consentId: 'c1' }, { consentId: null }])).toBe('consent_pending');
    expect(GROUP_VALID_MS).toBe(48 * 3600_000);
  });
});

describe('PC-56 TENANT-11d · F-25 cursors', () => {
  const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  it('the created cursor carries every microsecond; the need-by cursor carries the day or infinity', () => {
    const c = encodeCursor('created', '2026-07-11 10:00:00.123456+05:30', id)!;
    expect(decodeCursor(c, 'created')).toEqual({ kind: 'created', c: '2026-07-11 10:00:00.123456+05:30', id });
    const n = encodeCursor('need_by', 'infinity', id)!;
    expect(decodeCursor(n, 'need_by')).toEqual({ kind: 'need_by', c: 'infinity', id });
  });
  it('a hand-edited, mismatched or malformed cursor is "no cursor"', () => {
    const c = encodeCursor('created', '2026-07-11 10:00:00.123456+05:30', id)!;
    expect(decodeCursor(c, 'need_by')).toBeUndefined();
    expect(decodeCursor(Buffer.from(`created:1; DROP TABLE x|${id}`).toString('base64url'))).toBeUndefined();
    expect(encodeCursor('need_by', '16 Jul', id)).toBeNull();
  });
});

describe('PC-56 TENANT-11d · who may act (A3 / A4)', () => {
  const ctx = (perms: string[]) => ({ userId: 'u1', permissions: new Set(perms) }) as never;
  it('requirement.desk is the desk; a moderator reads and closes but is not the desk', () => {
    expect(requirementActor(ctx(['requirement.desk']))).toMatchObject({ canDesk: true, canModerate: false, canPost: false });
    expect(requirementActor(ctx(['dispute.resolve']))).toMatchObject({ canDesk: false, canModerate: true });
    expect(canModerateRequirement(ctx(['listing.moderate']))).toBe(true);
    expect(seesAll({ userId: 'u', canModerate: false, canDesk: true })).toBe(true);
    expect(seesAll({ userId: 'u', canModerate: false })).toBe(false);
  });
  it('names are short; the match is labelled rule-based, the AI score not yet available', () => {
    expect(shortName('Suresh Bhai Bhatt')).toBe('Suresh B.');
    expect(shortName('  ')).toBeNull();
    expect(MATCH_RULE).toBe('stock match (rule-based) — AI score not yet available');
  });
});
