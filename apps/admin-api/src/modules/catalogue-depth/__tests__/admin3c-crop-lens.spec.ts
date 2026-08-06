// apps/admin-api/src/modules/catalogue-depth/__tests__/admin3c-crop-lens.spec.ts · PC-56 ADMIN-3c.
//
// THIS DOMAIN GOVERNS AGRONOMY ADVICE, which makes it different from every other one in this console. A wrong unit
// conversion misquotes a quantity and somebody notices at the weighbridge. A wrong crop calendar tells a farmer to sow at
// the wrong time, and they find out at harvest.
//
// So the tests are about the things that would RENDER PERFECTLY and misinform: an unsourced calendar, stages that overlap
// or leave a gap, a timeline that does not fit its own duration, and a season claim nobody can trace.
import {
  SEASONS, isSeason, seasonsForCrop, seasonsLabel,
  assertStages, assertCalendar, currentStageForFarm,
  assertMapping, mappingRollup, SYNC_STATES, AGMARKNET_PROVIDER,
  MAX_STAGES, MAX_DAY, MIN_SOURCE,
} from '../domain/crop-lens';
import { InvalidCropCalendarError, InvalidMandiMappingError } from '../domain/catalogue-depth.errors';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('seasons — DELTA-008\'s answer, derived rather than stored', () => {
  it('mirrors 0061\'s CHECK, in agricultural-year order', () => {
    expect([...SEASONS]).toEqual(['kharif', 'rabi', 'zaid', 'perennial']);
    expect(isSeason('kharif')).toBe(true);
    expect(isSeason('monsoon')).toBe(false);
  });

  it('returns NULL — not [] — for a crop with no calendars', () => {
    // `[]` renders as "grows in no season", which is a claim. NULL renders as "unknown", which is what we know.
    expect(seasonsForCrop([])).toBeNull();
    expect(seasonsLabel(null)).toBeNull();
  });

  it('derives the distinct seasons of a crop\'s calendars', () => {
    expect(seasonsForCrop([{ season: 'kharif' }, { season: 'kharif' }, { season: 'zaid' }]))
      .toEqual(['kharif', 'zaid']);
    expect(seasonsLabel(['kharif', 'zaid'])).toBe('kharif · zaid');
  });

  it('orders by the agricultural year, not alphabetically', () => {
    // a sort() would give "kharif · perennial · rabi", which is not how anybody reads it
    expect(seasonsForCrop([{ season: 'perennial' }, { season: 'rabi' }, { season: 'kharif' }]))
      .toEqual(['kharif', 'rabi', 'perennial']);
  });

  it('IGNORES DEACTIVATED calendars — a withdrawn calendar stops backing its season claim', () => {
    expect(seasonsForCrop([{ season: 'kharif', isActive: false }])).toBeNull();
    expect(seasonsForCrop([{ season: 'kharif', isActive: false }, { season: 'rabi', isActive: true }])).toEqual(['rabi']);
  });

  it('returns NULL when every calendar carries an unrecognised season', () => {
    // defensive: a row predating the CHECK must not produce a garbage label
    expect(seasonsForCrop([{ season: 'monsoon' }])).toBeNull();
  });
});

describe('assertStages — five rules, each catching a timeline that renders fine and misinforms', () => {
  const ok = [
    { name: 'Sowing', dayFrom: 0, dayTo: 10 },
    { name: 'Vegetative', dayFrom: 10, dayTo: 35 },
    { name: 'Harvest', dayFrom: 35, dayTo: 110 },
  ];

  it('accepts a coherent timeline and returns it ordered', () => {
    const out = assertStages([ok[2], ok[0], ok[1]], 105, 120);
    expect(out.map((s) => s.name)).toEqual(['Sowing', 'Vegetative', 'Harvest']);
    expect(out[0].advisory).toBeNull();
  });

  it('RULE 1 — refuses an empty timeline', () => {
    // a calendar with no stages is a duration wearing an agronomy label
    expect(() => assertStages([], 100, 120)).toThrow(/at least one stage/);
    expect(() => assertStages('nope', 100, 120)).toThrow(/must be an array/);
  });

  it('RULE 2 — refuses a stage that ends before it begins', () => {
    // draws as a zero-width band nobody sees
    expect(() => assertStages([{ name: 'Sowing', dayFrom: 30, dayTo: 10 }], 0, 120))
      .toThrow(/cannot end before it begins/);
  });

  it('RULE 3 — refuses OVERLAPPING stages, and says why it matters', () => {
    expect(() => assertStages([
      { name: 'Vegetative', dayFrom: 10, dayTo: 40 },
      { name: 'Flowering', dayFrom: 35, dayTo: 55 },
    ], 0, 120)).toThrow(/told two different things about the same day/);
  });

  it('allows stages that TOUCH — the boundary day belongs to both in agronomy, not in the data', () => {
    expect(() => assertStages([
      { name: 'Vegetative', dayFrom: 10, dayTo: 35 },
      { name: 'Flowering', dayFrom: 35, dayTo: 55 },
    ], 0, 55)).not.toThrow();
  });

  it('RULE 4 — refuses a GAP, because a gap reads as "nothing to do"', () => {
    expect(() => assertStages([
      { name: 'Vegetative', dayFrom: 10, dayTo: 35 },
      { name: 'Pod fill', dayFrom: 55, dayTo: 105 },
    ], 0, 120)).toThrow(/no stage covering them/);
  });

  it('RULE 5 — refuses a timeline that does not fit its own duration', () => {
    // invisible on a chart that scales to its own data
    expect(() => assertStages(ok, 105, 100)).toThrow(/claims at most 100 days/);
    expect(() => assertStages(ok, 140, 200)).toThrow(/claims at least 140 days/);
  });

  it('refuses a nameless stage, an absurd day and too many stages', () => {
    expect(() => assertStages([{ name: 'X', dayFrom: 0, dayTo: 10 }], 0, 10)).toThrow(/2–60 characters/);
    expect(() => assertStages([{ name: 'Sowing', dayFrom: 0, dayTo: MAX_DAY + 1 }], 0, 999)).toThrow(/0–730/);
    expect(() => assertStages([{ name: 'Sowing', dayFrom: 0.5, dayTo: 10 }], 0, 10)).toThrow(/whole number of days/);
    const many = Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({ name: `S${i}`, dayFrom: i, dayTo: i + 1 }));
    expect(() => assertStages(many, 0, 100)).toThrow(/at most 20 stages/);
  });

  it('keeps an advisory and treats a blank one as absent', () => {
    const out = assertStages([{ name: 'Pegging', dayFrom: 0, dayTo: 80, advisory: '  gypsum 250 kg/ha  ' }], 0, 80);
    expect(out[0].advisory).toBe('gypsum 250 kg/ha');
    const none = assertStages([{ name: 'Pegging', dayFrom: 0, dayTo: 80, advisory: '   ' }], 0, 80);
    expect(none[0].advisory).toBeNull();
  });
});

describe('assertCalendar — THE SOURCE RULE COMES FIRST', () => {
  const base = {
    cropName: 'GG-20 groundnut', season: 'kharif', source: 'ICAR-DGR Junagadh',
    durationDaysMin: 105, durationDaysMax: 120,
    stages: [{ name: 'Sowing', dayFrom: 0, dayTo: 10 }, { name: 'Harvest', dayFrom: 10, dayTo: 115 }],
  };

  it('accepts a sourced calendar', () => {
    const c = assertCalendar(base);
    expect(c.source).toBe('ICAR-DGR Junagadh');
    expect(c.season).toBe('kharif');
    expect(c.stages).toHaveLength(2);
  });

  it('REFUSES AN UNSOURCED CALENDAR, and the message says why', () => {
    // W110 states it twice, and the column was nullable for the platform's whole life until 0104
    for (const bad of ['', '   ', 'AI']) {
      expect(() => assertCalendar({ ...base, source: bad })).toThrow(/never fabricated/);
    }
    expect(assertCalendar({ ...base, source: 'a'.repeat(MIN_SOURCE) }).source).toHaveLength(MIN_SOURCE);
  });

  it('checks the source BEFORE the timeline — the ordering is deliberate', () => {
    // both are wrong; the message must be about the missing source, because a perfectly-shaped timeline nobody can
    // attribute is not agronomy
    expect(() => assertCalendar({ ...base, source: '', stages: [] })).toThrow(/never fabricated/);
  });

  it('refuses an invented season and an incoherent duration', () => {
    expect(() => assertCalendar({ ...base, season: 'monsoon' })).toThrow(/season must be one of/);
    expect(() => assertCalendar({ ...base, durationDaysMin: 150, durationDaysMax: 100 }))
      .toThrow(/cannot be shorter than the minimum/);
    expect(() => assertCalendar({ ...base, durationDaysMin: 0, durationDaysMax: 999 }))
      .toThrow(/perennial's life, not a season/);
    expect(() => assertCalendar({ ...base, durationDaysMax: 'about four months' })).toThrow(/whole number of days/);
  });

  it('DROPS a malformed link rather than storing a dangling reference', () => {
    // a dangling category_id would make the crop→calendar join silently miss, and the crop would read "unknown" — which
    // is at least honest, unlike a broken join that looks like data
    expect(assertCalendar({ ...base, categoryId: 'wheat' }).categoryId).toBeNull();
    expect(assertCalendar({ ...base, regionId: 'saurashtra' }).regionId).toBeNull();
    expect(assertCalendar({ ...base, categoryId: UUID }).categoryId).toBe(UUID);
  });

  it('treats a NULL region as pan-India, which is a real value', () => {
    expect(assertCalendar(base).regionId).toBeNull();
  });
});

describe('THE HONESTLY-ABSENT RULE, as a function that always refuses', () => {
  it('never computes a farm\'s current stage, and explains the temptation it is refusing', () => {
    // crop_seasons.sown_on EXISTS (0010) and is one join away. It is one farmer's entry about one parcel; a calendar is
    // regional reference data. Joining them would present a generic timeline as a fact about their soil.
    expect(() => currentStageForFarm()).toThrow(/does not compute a farm's current growth stage/);
    expect(() => currentStageForFarm()).toThrow(/crop_seasons\.sown_on is one farmer's entry about one parcel/);
  });
});

describe('assertMapping — a PRODUCT, not a crop', () => {
  it('accepts a product and a commodity code, upper-cased', () => {
    const m = assertMapping({ productId: UUID, externalId: 'agm-1101' });
    expect(m).toEqual({ productId: UUID, externalId: 'AGM-1101', providerCode: AGMARKNET_PROVIDER });
  });

  it('REFUSES anything but a product uuid, and says why it matters', () => {
    // this is the correction ADMIN-3c makes to the canon's own screen: mandi_prices keys on product_id, so a
    // category-level mapping would look right here and resolve to no price at all
    expect(() => assertMapping({ productId: 'crops.cereals.wheat', externalId: 'AGM-1101' }))
      .toThrow(/mandi prices key on product_id/);
    expect(() => assertMapping({ productId: '', externalId: 'AGM-1101' })).toThrow(InvalidMandiMappingError);
  });

  it('refuses something that is not a commodity code, naming the confusion', () => {
    // a mandi (market) code and a commodity code are different things, and `mandis.mandi_code` holds the former
    for (const bad of ['wheat', 'AGM', '1101', 'AGM-', 'AGMARKNET-COMMODITY-1101']) {
      expect(() => assertMapping({ productId: UUID, externalId: bad })).toThrow(/COMMODITY code, not a mandi/);
    }
  });

  it('accepts the real-registry variants', () => {
    for (const good of ['AGM-1101', 'AGM1101', 'COM-24', 'AGMARK-00012345']) {
      expect(assertMapping({ productId: UUID, externalId: good }).externalId).toBe(good.toUpperCase());
    }
  });
});

describe('mappingRollup — the W023 badge', () => {
  it('reports NO SHARE for a crop with no products', () => {
    // "0% mapped" beside a crop nobody has created products for is a criticism of nothing
    expect(mappingRollup([])).toEqual({ total: 0, mapped: 0, pct: null, state: 'no_products' });
  });

  it('distinguishes none, partial and all', () => {
    const p = (n: number, mapped: number) =>
      Array.from({ length: n }, (_, i) => ({ productId: String(i), externalId: i < mapped ? 'AGM-1' : null }));
    expect(mappingRollup(p(5, 0))).toMatchObject({ total: 5, mapped: 0, pct: 0, state: 'none' });
    expect(mappingRollup(p(5, 3))).toMatchObject({ total: 5, mapped: 3, pct: 60, state: 'partial' });
    expect(mappingRollup(p(5, 5))).toMatchObject({ total: 5, mapped: 5, pct: 100, state: 'all' });
  });

  it('treats an empty-string external id as unmapped', () => {
    expect(mappingRollup([{ productId: 'a', externalId: '' }])).toMatchObject({ mapped: 0, state: 'none' });
  });
});

describe('the sync vocabulary', () => {
  it('starts a fresh mapping as PENDING, not synced', () => {
    // nobody has checked that the commodity code resolves upstream; claiming synced would assert something unverified
    expect([...SYNC_STATES]).toEqual(['pending', 'synced', 'failed', 'conflict']);
    expect(SYNC_STATES[0]).toBe('pending');
  });

  it('carries the error type for a refused calendar', () => {
    const e = new InvalidCropCalendarError('unsourced');
    expect(e.getStatus()).toBe(422);
    expect((e.getResponse() as any).code).toBe('CROP_CALENDAR_INVALID');
  });
});
