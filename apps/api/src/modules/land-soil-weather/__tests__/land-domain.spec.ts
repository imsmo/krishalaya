// modules/land-soil-weather/__tests__/land-domain.spec.ts · pure-domain unit tests: the crop-season state
// machine + the parcel/crop/soil aggregates (area/yield are float-free scaled integers). No infra.
import { canTransition, isTerminal, CROP_STATUSES, CropStatus, IllegalCropTransitionError } from '../domain/crop-season.state';
import { LandParcel } from '../domain/land-parcel.entity';
import { CropSeason } from '../domain/crop-season.entity';
import { SoilTest } from '../domain/soil-test.entity';
import { LandEventType } from '../domain/land-soil-weather.events';
import { InvalidParcelError, InvalidCropSeasonError, InvalidSoilTestError, LandForbiddenError, InvalidBoundaryError, YieldUnitError } from '../domain/land-soil-weather.errors';
import { BOUNDARY_MAPPED_SQL, validateBoundary } from '../domain/geojson';

const parcel = (over: any = {}) => LandParcel.register({ id: 'p1', tenantId: 't1', ownerUserId: 'u1', regionId: null, surveyNo: '123/4', bhulekhRef: null,
  areaTenThousandth: 25000n, areaUnit: 'acre', irrigationTypeId: null, boundaryGeojson: null, isTenantFarmed: false, ...over });
const crop = (over: any = {}) => CropSeason.plan({ id: 'c1', tenantId: 't1', parcelId: 'p1', productId: 'prod1', season: 'kharif', year: 2026, expectedHarvest: null, expectedYieldMilli: null, ...over });

describe('crop-season.state machine', () => {
  it('planned→sown→harvested; abandon from planned/sown', () => {
    expect(canTransition('planned', 'sown')).toBe(true);
    expect(canTransition('sown', 'harvested')).toBe(true);
    expect(canTransition('planned', 'abandoned')).toBe(true);
    expect(canTransition('sown', 'abandoned')).toBe(true);
    expect(canTransition('planned', 'harvested')).toBe(false);
    expect(canTransition('harvested', 'sown')).toBe(false);
    expect(isTerminal('harvested')).toBe(true); expect(isTerminal('abandoned')).toBe(true);
    for (const s of CROP_STATUSES) expect(() => canTransition(s, 'abandoned' as CropStatus)).not.toThrow();
    expect(new IllegalCropTransitionError('harvested', 'planned').code).toBe('CROP_SEASON_ILLEGAL_TRANSITION');
  });
});

describe('LandParcel', () => {
  it('registers active with area as a scaled integer (2.5000 acre)', () => {
    const p = parcel(); expect(p.toJSON().area).toBe('2.5000'); expect(p.toJSON().verificationStatus).toBe('none');
    expect(p.pullEvents().map((e) => e.type)).toContain(LandEventType.ParcelRegistered);
  });
  it('rejects non-positive area; assertOwner throws for a stranger', () => {
    expect(() => parcel({ areaTenThousandth: 0n })).toThrow(InvalidParcelError);
    expect(() => parcel().assertOwner('someone_else', false)).toThrow(LandForbiddenError);
    expect(() => parcel().assertOwner('someone_else', true)).not.toThrow(); // admin override
  });
});

describe('CropSeason lifecycle', () => {
  it('plan→sow→harvest stamps dates/yield + emits events', () => {
    const c = crop(); c.pullEvents();
    c.sow('2026-06-15'); c.harvest(3500n, 'quintal');   // 3.500 (scaled ×1000), in quintal (PC-56 TENANT-12, F-9)
    expect(c.status).toBe('harvested'); expect(c.toJSON().sownOn).toBe('2026-06-15'); expect(c.toJSON().actualYield).toBe('3.500'); expect(c.toJSON().yieldUnitCode).toBe('quintal');
    expect(c.pullEvents().map((e) => e.type)).toEqual([LandEventType.CropSeasonSown, LandEventType.CropSeasonHarvested]);
  });
  it('rejects a bad year and a negative yield', () => {
    expect(() => crop({ year: 1900 })).toThrow(InvalidCropSeasonError);
    const c = crop(); c.sow('2026-06-15');
    expect(() => c.harvest(-1n)).toThrow(InvalidCropSeasonError);
  });
  it('PC-56 TENANT-12 (F-9): a yield is never stored without its unit; (F-19) abandon needs a reason', () => {
    expect(() => crop({ expectedYieldMilli: 20000n })).toThrow(YieldUnitError);
    expect(crop({ expectedYieldMilli: 20000n, yieldUnitCode: 'quintal' }).toJSON().yieldUnitCode).toBe('quintal');
    const c = crop(); c.sow('2026-06-15');
    expect(() => c.harvest(3500n)).toThrow(YieldUnitError);
    const k = crop({ expectedYieldMilli: 20000n, yieldUnitCode: 'quintal' }); k.sow('2026-06-15');
    expect(() => k.harvest(1500000n, 'kg')).toThrow(InvalidCropSeasonError);   // the actual must be in the expected's unit
    k.harvest(18000n); expect(k.toJSON().yieldUnitCode).toBe('quintal');        // the season's own unit carries over
    const a = crop(); expect(() => a.abandon('')).toThrow(InvalidCropSeasonError);
    a.abandon('hailstorm flattened the crop'); expect(a.status).toBe('abandoned');
  });
});

describe('PC-56 TENANT-12 · F-2 — a boundary is a closed GeoJSON polygon or it is refused by name', () => {
  const ring = [[72.1, 21.1], [72.2, 21.1], [72.2, 21.2], [72.1, 21.1]];
  it('accepts a Polygon and a MultiPolygon; refuses {}, a Point, an open ring, a short ring, out-of-range positions, extras', () => {
    expect(validateBoundary({ type: 'Polygon', coordinates: [ring] }).ok).toBe(true);
    expect(validateBoundary({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }).ok).toBe(true);
    const code = (v: unknown) => { const r = validateBoundary(v); return r.ok ? 'ok' : r.refusal; };
    expect(code({})).toBe('TYPE_NOT_POLYGON');
    expect(code(null)).toBe('NOT_AN_OBJECT');
    expect(code({ type: 'Point', coordinates: [72, 21] })).toBe('TYPE_NOT_POLYGON');
    expect(code({ type: 'Polygon', coordinates: [[[72.1, 21.1], [72.2, 21.1], [72.2, 21.2], [72.1, 21.3]]] })).toBe('RING_NOT_CLOSED');
    expect(code({ type: 'Polygon', coordinates: [[[72.1, 21.1], [72.2, 21.1], [72.1, 21.1]]] })).toBe('RING_TOO_SHORT');
    expect(code({ type: 'Polygon', coordinates: [[[181, 21.1], [72.2, 21.1], [72.2, 21.2], [181, 21.1]]] })).toBe('LONGITUDE_OUT_OF_RANGE');
    expect(code({ type: 'Polygon', coordinates: [[[72, 91], [72.2, 21.1], [72.2, 21.2], [72, 91]]] })).toBe('LATITUDE_OUT_OF_RANGE');
    expect(code({ type: 'Polygon', coordinates: [[[72, 'x'], [72.2, 21.1], [72.2, 21.2], [72, 'x']]] })).toBe('POSITION_INVALID');
    expect(code({ type: 'Polygon', coordinates: [ring], properties: {} })).toBe('EXTRA_MEMBERS');
    expect(code({ type: 'MultiPolygon', coordinates: [] })).toBe('NO_POLYGONS');
    expect(code({ type: 'Polygon' })).toBe('COORDINATES_MISSING');
  });
  it('the entity refuses a bad boundary on register AND on update', () => {
    expect(() => parcel({ boundaryGeojson: {} })).toThrow(InvalidBoundaryError);
    expect(() => parcel().update({ boundaryGeojson: { type: 'Polygon', coordinates: [] } as any })).toThrow(InvalidBoundaryError);
    expect(parcel({ boundaryGeojson: { type: 'Polygon', coordinates: [ring] } }).auditView().boundary).toBe('Polygon');
  });
  it('the coverage predicate counts exactly the accepted shape', () => {
    expect(BOUNDARY_MAPPED_SQL('b')).toContain("b->>'type' IN ('Polygon','MultiPolygon')");
  });
});

describe('SoilTest', () => {
  it('requires sampled date + non-empty results; emits soil_test_recorded', () => {
    expect(() => SoilTest.record({ id: 's', tenantId: 't', parcelId: 'p1', labName: null, shcCardNo: null, sampledOn: '2026-05-01', results: {}, recommendations: {}, reportMediaId: null, validUntil: null })).toThrow(InvalidSoilTestError);
    const t = SoilTest.record({ id: 's', tenantId: 't', parcelId: 'p1', labName: 'SHC Lab', shcCardNo: 'SHC-1', sampledOn: '2026-05-01', results: { ph: 6.8, n: 280 }, recommendations: { urea_kg: 50 }, reportMediaId: null, validUntil: null });
    expect(t.pullEvents().map((e) => e.type)).toContain(LandEventType.SoilTestRecorded);
  });
});
