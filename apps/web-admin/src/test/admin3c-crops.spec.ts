// apps/web-admin/src/test/admin3c-crops.spec.ts · PC-56 ADMIN-3c, console side.
//
// TWO ABSENCES THAT MUST NOT RENDER AS FACTS, and they are what DELTA-008 turned out to be about:
//   1. A crop with no sourced calendar has UNKNOWN seasons — not "no seasons". One is a statement about us; the other is
//      a claim about the crop.
//   2. A crop with NO PRODUCTS is not "unmapped". There is nothing to map, and a red badge there would never clear.
//
// The rest is the stage form, where a blank row must be an unused slot rather than an error, and where the source is
// checked first because it is the rule the canon repeats.
import {
  SEASONS, MAX_STAGES, MAX_DAY, BLANK_STAGE_ROWS, MIN_REASON,
  seasonsText, seasonsUnknown, mandiClass, mandiKey, syncStateOf,
  timelineProblems, stageWidthPct, formStages, buildCalendar, buildMapping,
  type CropRow, type StageRow,
} from '../features/catalogue/crops';

const UUID = '11111111-1111-4111-8111-111111111111';
const REASON = 'a real reason for the audit trail';
const bag = (o: Record<string, string>) => (n: string) => o[n] ?? '';

const crop = (over: Partial<CropRow> = {}): CropRow => ({
  id: UUID, code: 'crops.cereals.wheat', defaultName: 'Wheat', path: 'crops.cereals.wheat', depth: 3,
  isActive: true, seasons: ['rabi'], calendarCount: 1, productCount: 4, mappedCount: 4, varietyCount: 9, ...over,
});

describe('SEASONS — unknown is not none', () => {
  it('mirrors 0061 in agricultural-year order', () => {
    expect([...SEASONS]).toEqual(['kharif', 'rabi', 'zaid', 'perennial']);
  });

  it('renders the derived label', () => {
    expect(seasonsText(crop({ seasons: ['kharif', 'zaid'] }))).toBe('kharif · zaid');
    expect(seasonsText(crop({ seasonsLabel: 'rabi' }))).toBe('rabi');
  });

  it('orders by the agricultural year even when the API sends them shuffled', () => {
    expect(seasonsText(crop({ seasons: ['perennial', 'kharif', 'rabi'] }))).toBe('kharif · rabi · perennial');
  });

  it('returns NULL for a crop with none, and reports it as UNKNOWN', () => {
    // the distinction the whole DELTA turned on
    expect(seasonsText(crop({ seasons: null }))).toBeNull();
    expect(seasonsText(crop({ seasons: [] }))).toBeNull();
    expect(seasonsUnknown(crop({ seasons: null }))).toBe(true);
    expect(seasonsUnknown(crop({ seasons: [] }))).toBe(true);
    expect(seasonsUnknown(crop({ seasons: ['rabi'] }))).toBe(false);
  });

  it('trusts the server\'s own unknown flag when present', () => {
    expect(seasonsUnknown(crop({ seasons: ['rabi'], seasonsUnknown: true }))).toBe(true);
    expect(seasonsUnknown(crop({ seasons: null, seasonsUnknown: false }))).toBe(false);
  });
});

describe('THE MANDI BADGE — no products is not unmapped', () => {
  it('styles no_products as NEUTRAL, never as a failure', () => {
    // a red "unmapped" badge on a crop nobody has created products for would never clear
    expect(mandiClass('no_products')).toBe('kv-status--muted');
    expect(mandiClass(undefined)).toBe('kv-status--muted');
    expect(mandiClass('none')).toBe('kv-status--danger');
    expect(mandiClass('partial')).toBe('kv-status--warn');
    expect(mandiClass('all')).toBe('kv-status--ok');
  });

  it('names the four states, and an unknown one as noProducts rather than as mapped', () => {
    expect(mandiKey('all')).toBe('all');
    expect(mandiKey('partial')).toBe('partial');
    expect(mandiKey('none')).toBe('none');
    expect(mandiKey('no_products')).toBe('noProducts');
    // the safe fallback: never claim a mapping for a state this build does not understand
    expect(mandiKey('teleported')).toBe('noProducts');
    expect(mandiKey(undefined)).toBe('noProducts');
  });
});

describe('syncStateOf — an unmapped product has NO state', () => {
  it('returns null when there is no commodity code', () => {
    // inventing 'pending' would imply somebody had tried
    expect(syncStateOf({ externalId: null })).toBeNull();
    expect(syncStateOf({ externalId: '' })).toBeNull();
    expect(syncStateOf({ externalId: undefined, syncStatus: 'pending' })).toBeNull();
  });

  it('defaults a mapped product with no recorded status to pending', () => {
    expect(syncStateOf({ externalId: 'AGM-1101' })).toBe('pending');
    expect(syncStateOf({ externalId: 'AGM-1101', syncStatus: 'synced' })).toBe('synced');
    expect(syncStateOf({ externalId: 'AGM-1101', syncStatus: 'failed' })).toBe('failed');
  });
});

describe('timelineProblems — marks what the server will refuse', () => {
  it('finds an overlap, a gap and a backwards stage', () => {
    expect(timelineProblems([
      { name: 'A', dayFrom: 0, dayTo: 20 }, { name: 'B', dayFrom: 15, dayTo: 30 },
    ])[0]).toMatch(/A and B overlap/);
    expect(timelineProblems([
      { name: 'A', dayFrom: 0, dayTo: 20 }, { name: 'B', dayFrom: 30, dayTo: 40 },
    ])[0]).toMatch(/days 20–30 are not covered/);
    expect(timelineProblems([{ name: 'A', dayFrom: 20, dayTo: 5 }])[0]).toMatch(/ends on day 5 but starts on 20/);
  });

  it('says nothing about a coherent timeline, including touching stages', () => {
    expect(timelineProblems([
      { name: 'A', dayFrom: 0, dayTo: 20 }, { name: 'B', dayFrom: 20, dayTo: 40 },
    ])).toEqual([]);
    expect(timelineProblems([])).toEqual([]);
  });

  it('checks in day order regardless of the array order', () => {
    expect(timelineProblems([
      { name: 'B', dayFrom: 20, dayTo: 40 }, { name: 'A', dayFrom: 0, dayTo: 20 },
    ])).toEqual([]);
  });
});

describe('stageWidthPct — never divides by zero', () => {
  it('gives a proportion of the growing period', () => {
    expect(stageWidthPct({ name: 'A', dayFrom: 0, dayTo: 60 }, 120)).toBe(50);
    expect(stageWidthPct({ name: 'A', dayFrom: 100, dayTo: 120 }, 120)).toBe(17);
  });

  it('returns 0 rather than NaN or Infinity for a zero-length calendar', () => {
    // a NaN width silently becomes an unstyled element; Infinity becomes a full bar, which would read as a whole season
    expect(stageWidthPct({ name: 'A', dayFrom: 0, dayTo: 10 }, 0)).toBe(0);
    expect(stageWidthPct({ name: 'A', dayFrom: 0, dayTo: 10 }, -5)).toBe(0);
  });

  it('clamps to 0–100 rather than overflowing the row', () => {
    expect(stageWidthPct({ name: 'A', dayFrom: 0, dayTo: 300 }, 120)).toBe(100);
    expect(stageWidthPct({ name: 'A', dayFrom: 50, dayTo: 20 }, 120)).toBe(0);
  });
});

describe('formStages', () => {
  it('renders existing stages in day order, then blanks', () => {
    const existing: StageRow[] = [
      { name: 'Harvest', dayFrom: 80, dayTo: 110 }, { name: 'Sowing', dayFrom: 0, dayTo: 10 },
    ];
    const rows = formStages(existing);
    expect(rows).toHaveLength(existing.length + BLANK_STAGE_ROWS);
    expect(rows.slice(0, 2).map((r) => r!.name)).toEqual(['Sowing', 'Harvest']);
    expect(rows.slice(2).every((r) => r === null)).toBe(true);
  });

  it('offers blanks for a brand-new calendar', () => {
    expect(formStages([]).every((r) => r === null)).toBe(true);
    expect(formStages([])).toHaveLength(BLANK_STAGE_ROWS);
  });
});

describe('buildCalendar — the source is checked FIRST', () => {
  const base: Record<string, string> = {
    source: 'ICAR-DGR Junagadh', cropName: 'GG-20 groundnut', season: 'kharif',
    durationDaysMin: '105', durationDaysMax: '120', stageCount: '3',
    stage_0_name: 'Sowing', stage_0_dayFrom: '0', stage_0_dayTo: '10',
    stage_1_name: 'Pegging', stage_1_dayFrom: '10', stage_1_dayTo: '80', stage_1_advisory: 'gypsum 250 kg/ha',
    stage_2_name: 'Harvest', stage_2_dayFrom: '80', stage_2_dayTo: '115',
    reason: REASON,
  };

  it('builds a sourced calendar with its stages in order', () => {
    const r = buildCalendar(bag(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe('ICAR-DGR Junagadh');
    expect(r.value.stages).toHaveLength(3);
    expect(r.value.stages[1].advisory).toBe('gypsum 250 kg/ha');
    // an absent advisory is OMITTED, not sent as an empty string
    expect('advisory' in r.value.stages[0]).toBe(false);
  });

  it('REFUSES an unsourced calendar BEFORE anything about days', () => {
    expect(buildCalendar(bag({ ...base, source: '' }))).toEqual({ ok: false, error: 'source' });
    expect(buildCalendar(bag({ ...base, source: 'AI' }))).toEqual({ ok: false, error: 'source' });
    // THE SOURCE ERROR WINS OVER EVERY OTHER FIELD, not merely over the duration. Mutation testing caught this: a mutant
    // that moved the source check below cropName and season survived, because the only ordering case here paired it with
    // the duration. A perfect calendar nobody can attribute is not agronomy, so this is the message that must surface
    // whatever else is also wrong.
    const alsoWrongCases: Array<Record<string, string>> = [
      { durationDaysMin: 'x' },
      { cropName: '' },
      { season: 'monsoon' },
      { reason: 'fix' },
      { stageCount: '0' },
      { cropName: '', season: 'monsoon', durationDaysMin: 'x', reason: 'fix' },
    ];
    for (const alsoWrong of alsoWrongCases) {
      expect(buildCalendar(bag({ ...base, source: '', ...alsoWrong }))).toEqual({ ok: false, error: 'source' });
    }
  });

  it('SKIPS an entirely blank stage row — that is how the form offers more rows than a short calendar needs', () => {
    const withBlanks = { ...base, stageCount: '6' };
    const r = buildCalendar(bag(withBlanks));
    expect(r.ok && r.value.stages).toHaveLength(3);
  });

  it('refuses a HALF-FILLED stage row rather than guessing', () => {
    expect(buildCalendar(bag({ ...base, stageCount: '4', stage_3_dayFrom: '115' })))
      .toEqual({ ok: false, error: 'stageName' });
    expect(buildCalendar(bag({ ...base, stage_1_dayTo: 'eighty' }))).toEqual({ ok: false, error: 'stageDays' });
  });

  it('refuses a calendar with no stages at all', () => {
    const empty: Record<string, string> = { ...base, stageCount: '2' };
    delete empty.stage_0_name; delete empty.stage_0_dayFrom; delete empty.stage_0_dayTo;
    delete empty.stage_1_name; delete empty.stage_1_dayFrom; delete empty.stage_1_dayTo;
    delete empty.stage_2_name; delete empty.stage_2_dayFrom; delete empty.stage_2_dayTo;
    expect(buildCalendar(bag(empty))).toEqual({ ok: false, error: 'noStages' });
  });

  it('refuses an incoherent duration', () => {
    expect(buildCalendar(bag({ ...base, durationDaysMin: '150' }))).toEqual({ ok: false, error: 'durationOrder' });
    expect(buildCalendar(bag({ ...base, durationDaysMax: String(MAX_DAY + 1) }))).toEqual({ ok: false, error: 'durationLong' });
    expect(buildCalendar(bag({ ...base, durationDaysMin: '' }))).toEqual({ ok: false, error: 'duration' });
  });

  it('refuses an invented season and a thin reason', () => {
    expect(buildCalendar(bag({ ...base, season: 'monsoon' }))).toEqual({ ok: false, error: 'season' });
    expect(buildCalendar(bag({ ...base, reason: 'fix' }))).toEqual({ ok: false, error: 'reason' });
    expect(buildCalendar(bag({ ...base, reason: 'a'.repeat(MIN_REASON) })).ok).toBe(true);
  });

  it('OMITS an absent link rather than sending an empty string, and refuses a malformed one', () => {
    const r = buildCalendar(bag(base));
    expect(r.ok && 'categoryId' in r.value).toBe(false);
    expect(buildCalendar(bag({ ...base, categoryId: 'wheat' }))).toEqual({ ok: false, error: 'categoryId' });
    expect(buildCalendar(bag({ ...base, categoryId: UUID })).ok).toBe(true);
  });

  it('refuses more stages than one calendar', () => {
    const many: Record<string, string> = { ...base, stageCount: String(MAX_STAGES + 1) };
    for (let i = 0; i <= MAX_STAGES; i += 1) {
      many[`stage_${i}_name`] = `S${i}`;
      many[`stage_${i}_dayFrom`] = String(i);
      many[`stage_${i}_dayTo`] = String(i + 1);
    }
    expect(buildCalendar(bag(many))).toEqual({ ok: false, error: 'tooManyStages' });
  });
});

describe('buildMapping — a PRODUCT, not a crop', () => {
  it('accepts a product and upper-cases the commodity code', () => {
    expect(buildMapping(bag({ productId: UUID, externalId: 'agm-1101', reason: REASON })))
      .toEqual({ ok: true, value: { productId: UUID, externalId: 'AGM-1101', reason: REASON } });
  });

  it('refuses a crop path where a product id belongs', () => {
    expect(buildMapping(bag({ productId: 'crops.cereals.wheat', externalId: 'AGM-1101', reason: REASON })))
      .toEqual({ ok: false, error: 'productId' });
  });

  it('refuses something that is not a commodity code', () => {
    for (const bad of ['wheat', 'AGM', '1101', 'AGM-']) {
      expect(buildMapping(bag({ productId: UUID, externalId: bad, reason: REASON })))
        .toEqual({ ok: false, error: 'commodityCode' });
    }
  });

  it('demands a reason', () => {
    expect(buildMapping(bag({ productId: UUID, externalId: 'AGM-1101' }))).toEqual({ ok: false, error: 'reason' });
  });
});
