// apps/web-tenant/src/test/tenant1b3-farmer360.spec.ts · PC-56 TENANT-1b-3.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A MISSING YIELD IS NEVER THE EXPECTED YIELD, AND TWO UNITS ARE NEVER ONE NUMBER.**
//
// Both are single-line substitutions that would look like tidying up in a diff, and both put a wrong figure on a page a
// banker may be shown — which costs the farmer, not the platform.
import {
  landSummary, hasMixedUnits, seasonLabel, yieldLabel, hasAnySource, creditEvidenceOrder,
} from '../features/people/farmer360';

/** A translator that returns the key plus its interpolated vars, so assertions can see WHICH string was chosen. */
const t = { t: (k: string, v: Record<string, string | number> = {}) => `${k}${Object.keys(v).length ? `:${Object.values(v).join(',')}` : ''}` };

describe('TENANT-1b-3 · land areas keep their units', () => {
  const acre = { unit: 'acre', area: '4.2000', parcels: 2, verifiedParcels: 1 };
  const hectare = { unit: 'hectare', area: '1.0000', parcels: 1, verifiedParcels: 0 };

  it('returns each unit separately, largest first', () => {
    expect(landSummary([hectare, acre])).toEqual([acre, hectare]);
  });

  /** **A HECTARE IS 2.4711 ACRES.** Adding them gives "5.2", a quantity in no unit at all — and converting silently is
   *  how a 4.2-acre holding becomes a 10.4-acre one on a loan application. */
  it('never collapses two units into one figure', () => {
    const out = landSummary([acre, hectare]);
    expect(out).toHaveLength(2);
    expect(hasMixedUnits([acre, hectare])).toBe(true);
    expect(hasMixedUnits([acre])).toBe(false);
    expect(hasMixedUnits([])).toBe(false);
  });

  it('keeps a zero-area parcel that exists, and drops nothing that has parcels', () => {
    // A parcel recorded with no area yet is still a parcel the organisation knows about — dropping it would understate
    // the count beside the area.
    expect(landSummary([{ unit: 'acre', area: '0', parcels: 1, verifiedParcels: 0 }])).toHaveLength(1);
  });

  it('is stable when two units hold the same area', () => {
    const a = { unit: 'acre', area: '1.0000', parcels: 1, verifiedParcels: 0 };
    const b = { unit: 'bigha', area: '1.0000', parcels: 1, verifiedParcels: 0 };
    expect(landSummary([b, a]).map((x) => x.unit)).toEqual(['acre', 'bigha']);
  });
});

describe('TENANT-1b-3 · the yield cell', () => {
  it('shows a recorded harvest as a harvest', () => {
    expect(yieldLabel({ actualYield: '52.000', expectedYield: '48.000' }, t)).toBe('f360.yieldActual:52.000');
  });

  /**
   * **THE SUBSTITUTION THIS TEST EXISTS TO PREVENT.** The expected figure sits in the same row. Using it when the actual
   * is missing would make a failed season look average, and W155 states the rule itself: "Yields are his records + FPO
   * weighbridge — never estimated without saying so."
   */
  it('never presents an expectation as a harvest', () => {
    const out = yieldLabel({ actualYield: null, expectedYield: '48.000' }, t);
    expect(out).toBe('f360.yieldExpected:48.000');
    expect(out).not.toContain('yieldActual');
  });

  it('says "not recorded" when there is neither', () => {
    expect(yieldLabel({ actualYield: null, expectedYield: null }, t)).toBe('f360.yieldNone');
  });

  it('treats a ZERO harvest as a real harvest, not as missing', () => {
    // A crop that failed is a recorded fact and a farmer needs it on the page — "0 harvested" is information, and
    // rendering it as "not recorded" would erase a bad season instead of showing it.
    expect(yieldLabel({ actualYield: '0.000', expectedYield: '48.000' }, t)).toBe('f360.yieldActual:0.000');
  });
});

describe('TENANT-1b-3 · season labels', () => {
  it('translates the four seasons the schema uses', () => {
    for (const s of ['kharif', 'rabi', 'zaid', 'perennial']) {
      expect(seasonLabel({ season: s, year: 2025 }, t)).toBe(`f360.season.${s} 2025`);
    }
  });

  it('prints an unrecognised season code rather than a translation key', () => {
    // `crop_seasons.season` is free text, and a tenant in a market this console has never seen must not read
    // "f360.season.boro 2026". Rule zero: a hard-coded list must not block a country.
    expect(seasonLabel({ season: 'boro', year: 2026 }, t)).toBe('boro 2026');
  });
});

describe('TENANT-1b-3 · an empty 360 says so', () => {
  const empty = {
    income: { cropRealizedMinor: '0', cropPayoutCount: 0, dairyRealizedMinor: null, dairyBillCount: 0, totalRealizedMinor: null },
    land: { byUnit: [], irrigation: [], parcelsWithRecord: 0 },
    schemesYtd: [],
    seasons: [],
  };

  it('reports no source when the organisation holds nothing', () => {
    // A page of dashes reads as a broken page and a field officer rings the office about it. It is also a FINDING: a
    // member with no land, no seasons, no credits and no income is one this organisation has not actually served.
    expect(hasAnySource(empty)).toBe(false);
  });

  it('counts any ONE of the five sources as something', () => {
    expect(hasAnySource({ ...empty, seasons: [{} as never] })).toBe(true);
    expect(hasAnySource({ ...empty, schemesYtd: [{} as never] })).toBe(true);
    expect(hasAnySource({ ...empty, land: { ...empty.land, byUnit: [{} as never] } })).toBe(true);
    expect(hasAnySource({ ...empty, income: { ...empty.income, cropPayoutCount: 1 } })).toBe(true);
    expect(hasAnySource({ ...empty, income: { ...empty.income, dairyBillCount: 1 } })).toBe(true);
  });
});

describe('TENANT-1b-3 · credit evidence leads with regularity', () => {
  it('puts months before the payout count', () => {
    // Eight settled payouts across nine months is a different story from eight in one month, and a KCC desk discounts
    // the second. The order is the lender's, not ours.
    expect(creditEvidenceOrder()[0]).toBe('months');
    expect(creditEvidenceOrder()).toEqual(['months', 'payouts', 'land', 'kyc']);
  });
});
