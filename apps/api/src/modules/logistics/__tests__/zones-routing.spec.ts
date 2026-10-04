// modules/logistics/__tests__/zones-routing.spec.ts · pure-domain unit tests for API-W3-04: DeliveryZone
// (pincode/region validation + serviceability), DeliveryRoute (weekday/region validation), ColdChainLog (breach
// computation + sensor-envelope validation). Service-level UoW/outbox/audit/RLS is covered by the integration spec.
import { DeliveryZone } from '../domain/delivery-zone.entity';
import { DeliveryRoute } from '../domain/delivery-route.entity';
import { ColdChainLog, COLD_CHAIN_SUBJECTS, excursion } from '../domain/cold-chain-log.entity';
import { InvalidDeliveryZoneError, InvalidDeliveryRouteError, InvalidColdChainReadingError, FleetAlreadyInStateError } from '../domain/logistics.errors';
import { ZoneRouteEventType } from '../domain/logistics.events';

const PIN = '560001';
const REGION = '11111111-1111-1111-1111-111111111111';

describe('DeliveryZone', () => {
  const base = { id: 'z1', tenantId: 't1', defaultName: 'Bengaluru Urban', chargeDefinitionId: null };

  it('creates a zone, de-dupes pincodes, emits delivery_zone_created', () => {
    const z = DeliveryZone.create({ ...base, pincodes: [PIN, PIN, '560002'], regionIds: [REGION] });
    const p = z.toProps();
    expect(p.pincodes).toEqual([PIN, '560002']);
    expect(z.pullEvents().map((e) => e.type)).toContain(ZoneRouteEventType.DeliveryZoneCreated);
  });
  it('rejects invalid pincodes and region ids', () => {
    expect(() => DeliveryZone.create({ ...base, pincodes: ['12'], regionIds: [] })).toThrow(InvalidDeliveryZoneError);
    expect(() => DeliveryZone.create({ ...base, pincodes: ['012345'], regionIds: [] })).toThrow(InvalidDeliveryZoneError); // leading zero
    expect(() => DeliveryZone.create({ ...base, pincodes: [], regionIds: ['not-a-uuid'] })).toThrow(InvalidDeliveryZoneError);
  });
  it('rejects markup in the name', () => {
    expect(() => DeliveryZone.create({ ...base, defaultName: '<b>x', pincodes: [], regionIds: [] })).toThrow(InvalidDeliveryZoneError);
  });
  it('servesPincode reflects membership + active state', () => {
    const z = DeliveryZone.create({ ...base, pincodes: [PIN], regionIds: [] }); z.pullEvents();
    expect(z.servesPincode(PIN)).toBe(true);
    expect(z.servesPincode('999999')).toBe(false);
    z.setActive(false);
    expect(z.servesPincode(PIN)).toBe(false); // inactive zones don't serve
  });
  it('no-op update / activate throws already-in-state', () => {
    const z = DeliveryZone.create({ ...base, pincodes: [PIN], regionIds: [] });
    expect(() => z.setActive(true)).toThrow(FleetAlreadyInStateError);
    expect(() => z.update({ defaultName: 'Bengaluru Urban' })).toThrow(FleetAlreadyInStateError);
  });
});

describe('DeliveryRoute', () => {
  const base = { id: 'r1', tenantId: 't1', defaultName: 'Saturday Village Run — North', vehicleId: null, consolidationUserId: null };

  it('creates a route (nullable weekday) and emits delivery_route_created', () => {
    const r = DeliveryRoute.create({ ...base, runWeekday: 6, villageRegionIds: [REGION] });
    expect(r.runWeekday).toBe(6);
    expect(r.pullEvents().map((e) => e.type)).toContain(ZoneRouteEventType.DeliveryRouteCreated);
    expect(() => DeliveryRoute.create({ ...base, runWeekday: null, villageRegionIds: [] })).not.toThrow();
  });
  it('rejects an out-of-range weekday and bad region ids', () => {
    expect(() => DeliveryRoute.create({ ...base, runWeekday: 7, villageRegionIds: [] })).toThrow(InvalidDeliveryRouteError);
    expect(() => DeliveryRoute.create({ ...base, runWeekday: 1, villageRegionIds: ['nope'] })).toThrow(InvalidDeliveryRouteError);
  });
});

describe('ColdChainLog (PC-56 TENANT-SW-e: the band and the time are the SERVER\'s)', () => {
  const base = { tenantId: 't1', subjectType: 'vaccine_box' as const, subjectId: REGION };

  it('a manual reading carries no band and no time — the database copies the band and stamps its own clock', () => {
    const p = ColdChainLog.manual({ ...base, tempC: 12 }).toProps();
    expect(p).toMatchObject({ source: 'manual', recordedAt: null, isBreach: false, deviceId: null });
    expect('allowedMinC' in p).toBe(false);
  });
  it('mirrors the database\'s excursion rule for display, and cannot judge without a band', () => {
    expect(excursion(12, { minC: 2, maxC: 8 })).toBe(true);
    expect(excursion(5, { minC: 2, maxC: 8 })).toBe(false);
    expect(excursion(-1, { minC: 2, maxC: 8 })).toBe(true);
    expect(excursion(8, { minC: 2, maxC: 8 })).toBe(false);
    expect(excursion(5, null)).toBeNull();
  });
  it('rejects an unknown subject type', () => {
    expect(() => ColdChainLog.manual({ ...base, subjectType: 'fridge' as any, tempC: 5 })).toThrow(InvalidColdChainReadingError);
  });
  it('rejects out-of-envelope temperatures', () => {
    expect(() => ColdChainLog.manual({ ...base, tempC: 200 })).toThrow(InvalidColdChainReadingError);
  });
  it('has no id until persisted (DB bigserial assigns it)', () => {
    expect(ColdChainLog.manual({ ...base, tempC: 5 }).toProps().id).toBeNull();
  });
  it('exposes the documented subject types', () => { expect(COLD_CHAIN_SUBJECTS).toEqual(['shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box']); });
});
