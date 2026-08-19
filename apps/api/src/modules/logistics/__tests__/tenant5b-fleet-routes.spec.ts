// PC-56 TENANT-5b · the RC nobody read, the vehicle nothing validated, and a recurring run nobody approved.
//
// The four facts this file defends:
//   1. `vehicles.rc_doc_id` has pointed at a `kyc_documents` row since 0007 and nothing ever followed the pointer,
//      so W229's "an expired RC parks the vehicle automatically" had no mechanism.
//   2. `ShipmentService.assign` wrote any uuid onto a shipment — and `requires_cold_chain` (0007) had never been
//      compared with `is_refrigerated` (0007), so a ghee run could be loaded onto an open tempo.
//   3. `delivery_routes` had no proposal state, so W231's `(proposed)` row and its [Approve route] button could
//      not exist and every route was live the moment it was typed.
//   4. `LogisticsModule` CONSTRUCTED a cold-chain cadence job and never registered it with the runner.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  RC_EXPIRY_WARN_DAYS, fleetSplit, isFit, maskRegNo, rcAbsent, rcParks, rcVerdict, todayVerdict, vehicleFitness,
} from '../domain/fleet-fitness';
import {
  ROUTE_STATUSES, ROUTE_TRANSITIONS, SUGGEST_WINDOW_DAYS, VILLAGES_SHOWN, approvalVerdict, canTransitionRoute,
  economicsVerdict, isRouteStatus, parcelsVerdict, runsOnDemand, suggestVerdict, villageOverflow, weekdayKey,
} from '../domain/route-plan';
import { DeliveryRoute } from '../domain/delivery-route.entity';
import { FleetAlreadyInStateError, RouteNotApprovableError, VehicleUnfitError } from '../domain/logistics.errors';
import { ZoneRouteEventType, FleetEventType } from '../domain/logistics.events';
import { VehicleRepository } from '../repositories/vehicle.repository';
import { DeliveryRouteRepository } from '../repositories/delivery-route.repository';
import { RcExpiryParkingJob } from '../jobs/rc-expiry-parking.job';
import { ShipmentService } from '../services/shipment.service';
import { Shipment } from '../domain/shipment.entity';
import { LogisticsModule } from '../logistics.module';

const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const REPO = path.join(__dirname, '../../../../../..');
const migration = () => fs.readFileSync(path.join(REPO, 'db/migrations/0152_fleet_fitness_and_route_approval.sql'), 'utf8');
const seed = () => fs.readFileSync(path.join(REPO, 'db/seeds/core/0005_lookup_vocabularies.sql'), 'utf8');

const NOW = new Date('2026-08-19T09:00:00Z');
const veh = (over: Partial<{ isActive: boolean; isRefrigerated: boolean; capacityKg: number | null }> = {}) =>
  ({ id: 'v1', isActive: true, isRefrigerated: false, capacityKg: 1500, ...over });

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the RC nothing had ever read', () => {
  it('reads all six document states, and tells absent from expired', () => {
    // The two that look alike and are not: nobody uploaded a document, versus a document that ran out.
    expect(rcVerdict(null, NOW)).toEqual({ kind: 'absent' });
    expect(rcVerdict({ status: null, validUntil: null }, NOW)).toEqual({ kind: 'absent' });
    expect(rcVerdict({ status: 'verified', validUntil: '2026-08-01' }, NOW)).toEqual({ kind: 'expired', validUntil: '2026-08-01', daysOver: 18 });
    expect(rcVerdict({ status: 'pending', validUntil: '2030-01-01' }, NOW)).toEqual({ kind: 'unverified' });
    // Rejected is checked BEFORE verified-ness: a refused document is not a slow one, and a rejected RC with a
    // future date must not read as valid.
    expect(rcVerdict({ status: 'rejected', validUntil: '2030-01-01' }, NOW)).toEqual({ kind: 'rejected' });
    expect(rcVerdict({ status: 'verified', validUntil: '2029-03-01' }, NOW)).toEqual({ kind: 'valid', validUntil: '2029-03-01' });
    // A verified RC with no expiry recorded is VALID, not expired: null means "no date was recorded", and
    // parking a vehicle over a blank field would be the console arguing with its own database.
    expect(rcVerdict({ status: 'verified', validUntil: null }, NOW)).toEqual({ kind: 'valid', validUntil: null });
  });

  it('treats the last day of a licence as a day you may drive on', () => {
    // Off-by-one on a legal date is the difference between a lorry running and a farmer's crop sitting at a gate.
    expect(rcVerdict({ status: 'verified', validUntil: '2026-08-19' }, NOW).kind).toBe('expiring');
    expect(rcVerdict({ status: 'verified', validUntil: '2026-08-18' }, NOW).kind).toBe('expired');
    const edge = rcVerdict({ status: 'verified', validUntil: '2026-10-18' }, NOW);
    expect(edge).toEqual({ kind: 'expiring', validUntil: '2026-10-18', daysLeft: RC_EXPIRY_WARN_DAYS });
    expect(rcVerdict({ status: 'verified', validUntil: '2026-10-19' }, NOW).kind).toBe('valid');
  });

  it('parks for EXPIRED and REJECTED, and never for a missing document', () => {
    expect(rcParks({ kind: 'expired', validUntil: '2026-08-01', daysOver: 18 })).toBe(true);
    expect(rcParks({ kind: 'rejected' })).toBe(true);
    // **The decision this wave is most careful about.** No vehicle in production has an RC on file, so parking on
    // absence would deactivate every fleet on the platform in one tick and call it safety.
    expect(rcParks({ kind: 'absent' })).toBe(false);
    expect(rcParks({ kind: 'unverified' })).toBe(false);
    expect(rcParks({ kind: 'expiring', validUntil: '2026-09-01', daysLeft: 13 })).toBe(false);
    expect(rcAbsent({ kind: 'absent' })).toBe(true);
    expect(rcAbsent({ kind: 'unverified' })).toBe(false);
  });

  it('masks the plate, and masks a SHORT plate at least as hard', () => {
    // W229 prints `GJ-03-TR-88••`. A registration number identifies a vehicle, its owner and, on a village run, a
    // household — and the register is readable by every holder of logistics.manage, including a 3PL desk.
    expect(maskRegNo('GJ03TR8812')).toBe('GJ03TR88••');
    expect(maskRegNo('GJ-03-TR-8812')).toBe('GJ-03-TR-88••');
    expect(maskRegNo('AB12')).toBe('AB••');
    expect(maskRegNo('A')).toBe('A••');
    expect(maskRegNo('')).toBe('');
    for (const plate of ['GJ03TR8812', 'AB12']) expect(maskRegNo(plate).endsWith('••')).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · may this vehicle take this load', () => {
  const rcOk = { kind: 'valid', validUntil: '2029-01-01' } as const;

  it('refuses a vehicle this tenant cannot see, rather than writing the uuid anyway', () => {
    // The pre-wave behaviour: `assign` took a uuid from a .strict() DTO and wrote it onto the shipment.
    expect(vehicleFitness({ vehicle: null, rc: { kind: 'absent' }, requiresColdChain: false, requireRcOnFile: false }))
      .toEqual({ kind: 'vehicle_unknown' });
  });

  it('refuses a parked vehicle — including a partnered one', () => {
    expect(vehicleFitness({ vehicle: veh({ isActive: false }), rc: rcOk, requiresColdChain: false, requireRcOnFile: false }))
      .toEqual({ kind: 'vehicle_parked' });
    // Whoever parked it, it is not to be dispatched: parking is checked before the paperwork, and before the
    // 3PL-held shortcut.
    expect(vehicleFitness({ vehicle: veh({ isActive: false }), rc: { kind: 'absent' }, requiresColdChain: false, requireRcOnFile: false, rcHeldByPartner: true }))
      .toEqual({ kind: 'vehicle_parked' });
  });

  it('refuses an expired or rejected RC and says WHICH', () => {
    expect(vehicleFitness({ vehicle: veh(), rc: { kind: 'expired', validUntil: '2026-08-01', daysOver: 18 }, requiresColdChain: false, requireRcOnFile: false }))
      .toEqual({ kind: 'rc_invalid', rc: 'expired', validUntil: '2026-08-01' });
    expect(vehicleFitness({ vehicle: veh(), rc: { kind: 'rejected' }, requiresColdChain: false, requireRcOnFile: false }))
      .toEqual({ kind: 'rc_invalid', rc: 'rejected', validUntil: null });
  });

  it('lets a vehicle with NO RC through by default, and refuses it only where the tenant asked', () => {
    expect(isFit(vehicleFitness({ vehicle: veh(), rc: { kind: 'absent' }, requiresColdChain: false, requireRcOnFile: false }))).toBe(true);
    expect(vehicleFitness({ vehicle: veh(), rc: { kind: 'absent' }, requiresColdChain: false, requireRcOnFile: true }))
      .toEqual({ kind: 'rc_absent' });
    // An unverified document is never the strict rule's business: that is our review queue, not the tenant's fault.
    expect(isFit(vehicleFitness({ vehicle: veh(), rc: { kind: 'unverified' }, requiresColdChain: false, requireRcOnFile: true }))).toBe(true);
  });

  it('**refuses a cold-chain consignment on a vehicle that is not refrigerated**', () => {
    // Both columns have existed since 0007 and had never been read together. The only thing that would have
    // noticed is cold_chain_logs, after the temperature was already wrong.
    expect(vehicleFitness({ vehicle: veh({ isRefrigerated: false }), rc: rcOk, requiresColdChain: true, requireRcOnFile: false }))
      .toEqual({ kind: 'not_refrigerated' });
    expect(isFit(vehicleFitness({ vehicle: veh({ isRefrigerated: true }), rc: rcOk, requiresColdChain: true, requireRcOnFile: false }))).toBe(true);
    // And it still applies to a partner's vehicle: physics is not contractual.
    expect(vehicleFitness({ vehicle: veh({ isRefrigerated: false }), rc: { kind: 'absent' }, requiresColdChain: true, requireRcOnFile: false, rcHeldByPartner: true }))
      .toEqual({ kind: 'not_refrigerated' });
  });

  it('skips the RC branches for a 3PL-held document instead of pretending it is valid', () => {
    // An FPO cannot renew a Shadowfax RC. Refusing their dispatch over a document RLS correctly hides from them
    // would punish them for somebody else's paperwork — and calling the invisible document `valid` inside the
    // domain would be the rules lying to themselves.
    expect(isFit(vehicleFitness({ vehicle: veh(), rc: { kind: 'expired', validUntil: '2020-01-01', daysOver: 2000 }, requiresColdChain: false, requireRcOnFile: true, rcHeldByPartner: true }))).toBe(true);
  });

  it('orders the refusals so the FIRST thing that stops you is the thing you are told', () => {
    // "This vehicle is not refrigerated" is useless advice about a vehicle that does not exist.
    const all = vehicleFitness({ vehicle: null, rc: { kind: 'expired', validUntil: '2026-01-01', daysOver: 200 }, requiresColdChain: true, requireRcOnFile: true });
    expect(all.kind).toBe('vehicle_unknown');
    const parked = vehicleFitness({ vehicle: veh({ isActive: false }), rc: { kind: 'expired', validUntil: '2026-01-01', daysOver: 200 }, requiresColdChain: true, requireRcOnFile: true });
    expect(parked.kind).toBe('vehicle_parked');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · what a vehicle is doing today (W229)', () => {
  const base = { onRoad: 0, deliveredToday: 0, assignedToday: 0, nextRun: null, reefer: null };

  it('prefers what is happening NOW over what happened earlier', () => {
    expect(todayVerdict({ ...base, onRoad: 1, deliveredToday: 3, reefer: { tempC: 4.2, isBreach: false } }))
      .toEqual({ kind: 'carrying', onRoad: 1, reefer: { tempC: 4.2, isBreach: false } });
    expect(todayVerdict({ ...base, deliveredToday: 2, nextRun: { routeName: 'Village Run', weekday: 6 } }))
      .toEqual({ kind: 'done_today', deliveredToday: 2 });
    expect(todayVerdict({ ...base, nextRun: { routeName: 'Village Run', weekday: 6 } }))
      .toEqual({ kind: 'loads_next', routeName: 'Village Run', weekday: 6 });
    expect(todayVerdict(base)).toEqual({ kind: 'idle' });
  });

  it('never returns a time a vehicle becomes free', () => {
    // W229 prints "2 runs done · free 15:30". There is no shift model, no working-hours record and no
    // drop-duration estimate anywhere, so that hour is not derivable — and it is the number on this screen a
    // dispatcher would promise a farmer. Asserted on the RETURNED SHAPE, so a future field cannot sneak in.
    const kinds = [
      todayVerdict({ ...base, onRoad: 1 }), todayVerdict({ ...base, deliveredToday: 1 }),
      todayVerdict({ ...base, nextRun: { routeName: 'r', weekday: 1 } }), todayVerdict(base),
    ];
    for (const v of kinds) {
      expect(Object.keys(v).some((k) => /free|until|eta|available/i.test(k))).toBe(false);
    }
    const src = read('domain', 'fleet-fitness.ts');
    expect(src).not.toMatch(/freeAt|freeFrom/);
  });

  it('counts own and partnered vehicles separately (W229 footer)', () => {
    expect(fleetSplit([{ scope: 'tenant' }, { scope: 'tenant' }, { scope: 'platform' }]))
      .toEqual({ own: 2, partnered: 1, total: 3 });
    expect(fleetSplit([])).toEqual({ own: 0, partnered: 0, total: 0 });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · a route is a proposal until somebody commits a truck', () => {
  const base = { id: 'r1', tenantId: 't1', defaultName: 'Saturday Village Run — south', vehicleId: null as string | null, consolidationUserId: null as string | null };
  const proposal = (over: Partial<typeof base> & { runWeekday?: number | null; villageRegionIds?: string[] } = {}) =>
    DeliveryRoute.create({ ...base, runWeekday: 6, villageRegionIds: ['11111111-1111-4111-8111-111111111111'], ...over });

  it('creates PROPOSED, not live', () => {
    const r = proposal();
    expect(r.status).toBe('proposed');
    expect(r.isActive).toBe(false);
    // Before this wave `create` set is_active TRUE, so the Village-Run job — which selects
    // `is_active AND run_weekday = today` — would have notified a named ambassador about an unapproved run.
    expect(r.toProps().approvedAt).toBeNull();
  });

  it('has ONE state machine, and never turns a suspended run back into an idea', () => {
    expect([...ROUTE_STATUSES]).toEqual(['proposed', 'active', 'inactive']);
    expect(canTransitionRoute('proposed', 'active')).toBe(true);
    expect(canTransitionRoute('proposed', 'inactive')).toBe(true);
    expect(canTransitionRoute('active', 'inactive')).toBe(true);
    expect(canTransitionRoute('inactive', 'active')).toBe(true);
    // A run that carried parcels for a season is not an untested idea again, and re-proposing it would erase the
    // record that it ran.
    expect(canTransitionRoute('inactive', 'proposed')).toBe(false);
    expect(canTransitionRoute('active', 'proposed')).toBe(false);
    expect(ROUTE_TRANSITIONS.active).not.toContain('active');
    expect(isRouteStatus('active')).toBe(true);
    expect(isRouteStatus('running')).toBe(false);
  });

  it('names the ONE missing commitment, in the order an operator fixes them', () => {
    expect(approvalVerdict({ status: 'proposed', vehicleId: null, consolidationUserId: null, villageRegionIds: [] }))
      .toEqual({ kind: 'needs_villages' });
    expect(approvalVerdict({ status: 'proposed', vehicleId: null, consolidationUserId: null, villageRegionIds: ['v'] }))
      .toEqual({ kind: 'needs_vehicle' });
    expect(approvalVerdict({ status: 'proposed', vehicleId: 'veh', consolidationUserId: null, villageRegionIds: ['v'] }))
      .toEqual({ kind: 'needs_consolidation' });
    expect(approvalVerdict({ status: 'proposed', vehicleId: 'veh', consolidationUserId: 'u', villageRegionIds: ['v'] }))
      .toEqual({ kind: 'ready' });
    expect(approvalVerdict({ status: 'active', vehicleId: 'veh', consolidationUserId: 'u', villageRegionIds: ['v'] }))
      .toEqual({ kind: 'already_active' });
    expect(approvalVerdict({ status: 'inactive', vehicleId: 'veh', consolidationUserId: 'u', villageRegionIds: ['v'] }))
      .toEqual({ kind: 'not_proposed', status: 'inactive' });
  });

  it('refuses to approve a run with nothing to carry it, or nobody to receive it', () => {
    expect(() => proposal().approve('ops-1')).toThrow(RouteNotApprovableError);
    const withVehicle = proposal({ vehicleId: 'veh-1' });
    expect(() => withVehicle.approve('ops-1')).toThrow(/consolidation/i);
  });

  it('records WHO committed the vehicle and the person, and emits the evidence', () => {
    const r = proposal({ vehicleId: 'veh-1', consolidationUserId: 'amb-1' });
    r.pullEvents();
    const when = new Date('2026-08-19T10:00:00Z');
    expect(r.approve('ops-7', when).verdict).toEqual({ kind: 'ready' });
    const p = r.toProps();
    expect(p.status).toBe('active');
    expect(r.isActive).toBe(true);
    expect(p.approvedBy).toBe('ops-7');
    expect(p.approvedAt).toBe(when);
    const ev = r.pullEvents().find((e) => e.type === ZoneRouteEventType.DeliveryRouteApproved)!;
    // The event carries WHAT was committed, not just that something was approved: a consumer told only "approved"
    // cannot tell an ambassador which Thursday is theirs.
    expect(ev.payload).toMatchObject({ routeId: 'r1', vehicleId: 'veh-1', consolidationUserId: 'amb-1', runWeekday: 6, villages: 1, approvedBy: 'ops-7' });
  });

  it('refuses BOTH back doors: a proposal switched live, and a DROPPED proposal switched live', () => {
    // Two guards, two paths. `POST :id/active` predates the approval, so without the first a proposal goes
    // straight to running; without the second, dropping it (proposed → inactive) and switching it on does the same
    // thing one step later — with `approved_by` still null either way, and no record that the decision was skipped.
    const fresh = proposal({ vehicleId: 'veh-1', consolidationUserId: 'amb-1' });
    expect(() => fresh.setActive(true)).toThrow(RouteNotApprovableError);
    const dropped = proposal({ vehicleId: 'veh-1', consolidationUserId: 'amb-1' });
    dropped.setActive(false);                       // proposed → inactive: a dropped proposal
    expect(dropped.status).toBe('inactive');
    expect(dropped.toProps().approvedAt).toBeNull();
    expect(() => dropped.setActive(true)).toThrow(/never been approved|approve it/i);
    // …and suspending it AGAIN is refused rather than reported as an act: a no-op that answers "done" writes an
    // audit row for a change nobody made, which is this programme's most-found defect wearing a different hat.
    expect(() => dropped.setActive(false)).toThrow(FleetAlreadyInStateError);
  });

  it('refuses to switch a NEVER-APPROVED route live through the back door', () => {
    // `POST :id/active` predates the approval. Without this guard a dropped proposal could go straight to running
    // with `approved_by` still null — the decision skipped and no record that it was.
    const r = proposal({ vehicleId: 'veh-1', consolidationUserId: 'amb-1' });
    expect(() => r.setActive(true)).toThrow(/never been approved|approve it/i);
    r.approve('ops-1');
    expect(r.setActive(false)).toMatchObject({ action: 'deactivated', new: { status: 'inactive' } });
    expect(r.setActive(true)).toMatchObject({ action: 'activated', new: { status: 'active' } });
    // …and the approval evidence survives a suspension, so a restart is the SAME commitment resuming.
    expect(r.toProps().approvedBy).toBe('ops-1');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the parcels number, and the half of the economics nobody recorded', () => {
  it('says MEASURED for a run and ESTIMATED for a proposal — W231 prints "est." on that row', () => {
    expect(parcelsVerdict({ status: 'active', parcels: 68, runs: 2 })).toEqual({ kind: 'measured', perRun: 34, runs: 2 });
    expect(parcelsVerdict({ status: 'proposed', parcels: 36, runs: 3 })).toEqual({ kind: 'estimated', perRun: 12, runs: 3 });
    // An FPO deciding whether to commit a truck must know which of the two they are reading.
    expect(parcelsVerdict({ status: 'active', parcels: 5, runs: 3 }).kind).not.toBe('estimated');
  });

  it('is unknown rather than zero when nothing has been delivered there', () => {
    expect(parcelsVerdict({ status: 'active', parcels: 0, runs: 0 })).toEqual({ kind: 'no_history' });
    expect(parcelsVerdict({ status: 'proposed', parcels: 0, runs: 4 })).toEqual({ kind: 'no_history' });
    expect(parcelsVerdict({ status: 'active', parcels: 3, runs: 0 })).toEqual({ kind: 'no_history' });
  });

  it('keeps one decimal, so a viable route does not read as a dead one', () => {
    // Integer division would report 1.6 parcels a run as 1.
    expect(parcelsVerdict({ status: 'active', parcels: 8, runs: 5 })).toEqual({ kind: 'measured', perRun: 1.6, runs: 5 });
    expect(parcelsVerdict({ status: 'active', parcels: 100, runs: 3 }).kind).toBe('measured');
    expect((parcelsVerdict({ status: 'active', parcels: 100, runs: 3 }) as { perRun: number }).perRun).toBe(33.3);
  });

  it('returns the ad-hoc baseline in MINOR UNITS and names the route side as unrecorded', () => {
    const v = economicsVerdict({ adHocTotalMinor: 960000n, adHocParcels: 100, currencyCode: 'INR' });
    expect(v).toEqual({ kind: 'ad_hoc_only', adHocPerParcelMinor: '9600', parcels: 100, currencyCode: 'INR', routeCost: 'not_recorded' });
    // **The refusal that matters.** W231 prints "₹28/parcel vs ₹96 ad-hoc". The ₹96 side is real
    // (shipments.charge_minor); a planned run's cost is recorded NOWHERE, so the comparison is not made. Two
    // numbers side by side read as two measurements.
    expect(v.routeCost).toBe('not_recorded');
    expect(economicsVerdict({ adHocTotalMinor: 0n, adHocParcels: 0, currencyCode: 'INR' }))
      .toEqual({ kind: 'no_baseline', routeCost: 'not_recorded' });
    expect(economicsVerdict({ adHocTotalMinor: 500n, adHocParcels: 0, currencyCode: 'INR' }).kind).toBe('no_baseline');
    // Integer arithmetic throughout (Law 2) — no float ever touches the money.
    const odd = economicsVerdict({ adHocTotalMinor: 1000n, adHocParcels: 3, currencyCode: 'INR' });
    expect((odd as { adHocPerParcelMinor: string }).adHocPerParcelMinor).toBe('333');
    // **Integer, not float, at a magnitude where the difference is visible.** 2^53+1 paise is not a realistic
    // freight bill, but it is the smallest number that proves the arithmetic never goes through a double — and a
    // platform that will run in several currencies for years should not be one rounding away from a wrong total.
    const huge = economicsVerdict({ adHocTotalMinor: 9007199254740993n, adHocParcels: 1, currencyCode: 'INR' });
    expect((huge as { adHocPerParcelMinor: string }).adHocPerParcelMinor).toBe('9007199254740993');
    // The break-even count W231 quotes ("only above 9 parcels/run") needs that same missing route cost, so no
    // threshold is hardcoded anywhere in the rules.
    expect(read('domain', 'route-plan.ts')).not.toMatch(/(BREAK_?EVEN|MIN_VIABLE)\s*=\s*\d/);
  });

  it('offers corridors, and refuses to call them a suggester', () => {
    expect(suggestVerdict()).toEqual({ kind: 'corridors_only', windowDays: SUGGEST_WINDOW_DAYS });
    expect(SUGGEST_WINDOW_DAYS).toBe(30);   // W231: "maps 30 days of ad-hoc shipments"
    expect(villageOverflow(14)).toBe(14 - VILLAGES_SHOWN);
    expect(villageOverflow(2)).toBe(0);
  });

  it('names the weekday as a KEY, never as a word', () => {
    expect(weekdayKey(6)).toBe('route.day.sat');
    expect(weekdayKey(0)).toBe('route.day.sun');
    expect(weekdayKey(null)).toBeNull();
    expect(weekdayKey(7)).toBeNull();
    expect(runsOnDemand(null)).toBe(true);
    expect(runsOnDemand(3)).toBe(false);
    // "Sat" is a word in three launch languages (Law 7).
    expect(read('domain', 'route-plan.ts')).not.toMatch(/'Saturday'|'Sat'/);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the queries, executed', () => {
  const cap = () => {
    const sql: string[] = []; const params: unknown[][] = [];
    const q = jest.fn(async (s: string, p?: unknown[]) => { sql.push(s); params.push(p ?? []); return { rows: [], rowCount: 0 }; });
    return { q, sql, params, replica: { forTenant: jest.fn(() => ({ query: q })) } };
  };

  it('joins the RC and the type vocabulary — the first read of rc_doc_id in the monorepo', async () => {
    const c = cap();
    await new VehicleRepository(c.replica as never).registerRows('t1', { activeOnly: false, limit: 50 });
    expect(c.sql[0]).toContain('LEFT JOIN kyc_documents d ON d.id = v.rc_doc_id');
    expect(c.sql[0]).toContain('d.status AS rc_status');
    expect(c.sql[0]).toContain('d.valid_until AS rc_valid_until');
    expect(c.sql[0]).toContain('LEFT JOIN lookup_values lv ON lv.id = v.vehicle_type_id');
    // Platform vehicles are visible (Law 11 read-only), tenant scoping is explicit (Law 1).
    expect(c.sql[0]).toContain('(v.tenant_id=$1 OR v.tenant_id IS NULL)');
    expect(c.sql[0]).toContain('ORDER BY v.created_at DESC, v.id DESC');
  });

  it("bounds today's counters and the reefer reading so the partitions prune (Law 8)", async () => {
    const c = cap();
    const repo = new VehicleRepository(c.replica as never);
    await repo.todayFor('t1', ['v1']);
    expect(c.sql[0]).toContain("created_at >= now() - interval '90 days'");
    expect(c.sql[0]).toContain('created_at <= now()');
    await repo.reeferFor('t1', ['v1']);
    // cold_chain_logs is partitioned by recorded_at; the subject is a SHIPMENT because there is no 'vehicle'
    // subject type and inventing one would be a second place to record the same temperature.
    expect(c.sql[1]).toContain("c.subject_type = 'shipment'");
    expect(c.sql[1]).toContain("c.recorded_at >= now() - interval '24 hours'");
    expect(c.sql[1]).toContain('DISTINCT ON (s.vehicle_id)');
  });

  it('finds only vehicles a document actually condemns, and parks idempotently', async () => {
    const c = cap();
    const repo = new VehicleRepository(c.replica as never);
    const exec = { query: c.q };
    await repo.rcInvalidActive(exec as never, 500);
    const sql = c.sql[0];
    expect(sql).toContain("d.status = 'verified' AND d.valid_until IS NOT NULL AND d.valid_until < current_date");
    expect(sql).toContain("OR d.status = 'rejected'");
    expect(sql).toContain('v.is_active = true');
    // Never on absence: `rc_doc_id` is an INNER JOIN here, so a vehicle with no document cannot be selected at all.
    expect(sql).toContain('JOIN kyc_documents d ON d.id = v.rc_doc_id');
    expect(sql).not.toMatch(/LEFT JOIN kyc_documents/);
    await repo.park(exec as never, 'v1');
    // Conditional, so two racing ticks park it once and the second reports zero rather than double-auditing.
    expect(c.sql[1]).toContain('WHERE id=$1 AND is_active=true');
  });

  it('measures parcels from DELIVERED shipments and their drop village, never from shipments.route_id', async () => {
    const c = cap();
    await new DeliveryRouteRepository(c.replica as never).traffic('t1', ['r1'], 90);
    const sql = c.sql[0];
    expect(sql).toContain('jsonb_array_elements_text(r.village_region_ids)');
    expect(sql).toContain('JOIN addresses a ON a.id = s.drop_address_id');
    expect(sql).toContain("s.status = 'delivered'");
    expect(sql).toContain('extract(dow FROM s.delivered_at) = rr.run_weekday');
    expect(sql).toContain('count(DISTINCT (s.delivered_at)::date)');
    // The created_at bound is what prunes the partitioned table when the filter is on delivered_at (Law 8).
    expect(sql).toContain('s.created_at   >= now()');
    expect(sql).toContain('s.created_at   <= now()');
    // `shipments.route_id` is dead and stays dead — populating it would mean inventing a choice nobody makes.
    // (`rr.route_id` below is this query's own alias for the ROUTE's id; what must not appear is the shipment's
    // column, which is the dead one.)
    expect(sql).not.toMatch(/s\.route_id|shipments\.route_id/);
  });

  it('resolves village NAMES and the ambassador tier instead of printing uuids', async () => {
    const c = cap();
    const repo = new DeliveryRouteRepository(c.replica as never);
    await repo.regionNames('t1', ['11111111-1111-4111-8111-111111111111']);
    expect(c.sql[0]).toContain('SELECT id, default_name FROM admin_regions');
    await repo.consolidationPoints('t1', ['u1']);
    expect(c.sql[1]).toContain('LEFT JOIN ambassador_profiles ap ON ap.user_id = u.id AND ap.tenant_id = $1');
    expect(c.sql[1]).toContain('lv.code AS tier_code');
  });

  it('writes `status` and never the GENERATED is_active', async () => {
    const c = cap();
    const repo = new DeliveryRouteRepository(c.replica as never);
    const tx = { query: c.q };
    const r = DeliveryRoute.create({ id: 'r1', tenantId: 't1', defaultName: 'Run', runWeekday: 6, villageRegionIds: [], vehicleId: null, consolidationUserId: null });
    await repo.insert(tx as never, r);
    // `is_active` is GENERATED ALWAYS in 0152: writing it is an error PostgreSQL raises, which is exactly the
    // protection this wave wanted — one fact, one column.
    expect(c.sql[0]).not.toContain('is_active');
    expect(c.sql[0]).toContain('status');
    await repo.update(tx as never, r);
    expect(c.sql[1]).not.toMatch(/is_active=/);
    expect(c.sql[1]).toContain('approved_by=$9');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the gate, and the job, run rather than read', () => {
  const PEPPER = 'test-pepper';

  function harness(opts: { requiresColdChain?: boolean; vehicle?: Record<string, unknown> | null; fitnessOn?: boolean; requireRc?: boolean } = {}) {
    const s = Shipment.rehydrate({
      id: 's1', tenantId: 't1', orderId: 'o1', partnerId: null, vehicleId: null, riderUserId: null,
      status: 'pending', awbNo: null, pickupAddressId: null, dropAddressId: null,
      scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: null, deliveredAt: null,
      pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null, chargeMinor: null, codMinor: null,
      requiresColdChain: opts.requiresColdChain ?? false, createdAt: new Date('2026-08-18T06:00:00Z'), deliveryAttempts: 0,
    });
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })), tenantId: 't1' };
    const uow = { run: jest.fn(async (t: string, fn: (x: typeof tx) => Promise<unknown>) => { void t; return fn(tx); }) };
    const orders = { transportStatus: jest.fn(async () => 'confirmed') };
    const flags = { isEnabled: jest.fn(async (key: string) => (key === 'logistics_fleet_fitness' ? (opts.fitnessOn ?? true) : (opts.requireRc ?? false))) };
    const outbox = { write: jest.fn(async (a: unknown, b: unknown) => { void a; void b; }) };
    const audit = { write: jest.fn(async (a: unknown, b: unknown) => { void a; void b; }) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const idem = { remember: jest.fn(async (k: string, u: string, e: string, fn: () => Promise<unknown>) => { void k; void u; void e; return fn(); }) };
    const repo = { getForUpdate: jest.fn(async () => s), update: jest.fn(async () => true) };
    const vehicleRepo = {
      fitnessOf: jest.fn(async () => (opts.vehicle === undefined
        ? { id: 'veh-1', scope: 'tenant', isActive: true, isRefrigerated: false, capacityKg: 1500, rcStatus: 'verified', rcValidUntil: '2029-01-01' }
        : opts.vehicle)),
    };
    const svc = new ShipmentService(uow as never, orders as never, flags as never, outbox as never, idem as never,
      metrics as never, audit as never, { auth: { hashPepper: PEPPER } } as never, repo as never, vehicleRepo as never);
    return { svc, s, repo, metrics, flags, vehicleRepo };
  }
  const boss = { userId: 'ops-1', canManage: true };

  it('refuses a COLD-CHAIN shipment onto an open vehicle', async () => {
    const h = harness({ requiresColdChain: true });
    await expect(h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null))
      .rejects.toMatchObject({ code: 'SHIPMENT_VEHICLE_UNFIT', details: { reason: 'not_refrigerated' } });
    expect(h.repo.update).not.toHaveBeenCalled();
    expect(h.metrics.inc).toHaveBeenCalledWith('logistics.vehicle_unfit', { reason: 'not_refrigerated' });
  });

  it('refuses an unknown vehicle and a parked one, and names which', async () => {
    const unknown = harness({ vehicle: null });
    await expect(unknown.svc.assign('t1', boss, 's1', { vehicleId: 'veh-x' } as never, null))
      .rejects.toMatchObject({ details: { reason: 'vehicle_unknown' } });
    const parked = harness({ vehicle: { id: 'veh-1', scope: 'tenant', isActive: false, isRefrigerated: true, capacityKg: 1, rcStatus: 'verified', rcValidUntil: '2029-01-01' } });
    await expect(parked.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null))
      .rejects.toMatchObject({ details: { reason: 'vehicle_parked' } });
  });

  it('refuses an EXPIRED RC and carries the date the operator has to fix', async () => {
    const h = harness({ vehicle: { id: 'veh-1', scope: 'tenant', isActive: true, isRefrigerated: true, capacityKg: 1, rcStatus: 'verified', rcValidUntil: '2020-01-01' } });
    await expect(h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null))
      .rejects.toMatchObject({ code: 'SHIPMENT_VEHICLE_UNFIT', details: { reason: 'rc_invalid', rc: 'expired', validUntil: '2020-01-01' } });
  });

  it('does nothing at all when the flag is off — the pre-wave behaviour, exactly', async () => {
    const h = harness({ requiresColdChain: true, fitnessOn: false });
    const out = await h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null);
    expect(out.status).toBe('assigned');
    // Not even READ: a flag that is off must not cost a query on the write path of every assignment.
    expect(h.vehicleRepo.fitnessOf).not.toHaveBeenCalled();
  });

  it('reads its flags PER TENANT, and does not read them at all without a vehicle', async () => {
    const h = harness();
    await h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null);
    expect(h.flags.isEnabled).toHaveBeenCalledWith('logistics_fleet_fitness', { tenantId: 't1' });
    const riderOnly = harness();
    await riderOnly.svc.assign('t1', boss, 's1', { riderUserId: 'r1' } as never, null);
    expect(riderOnly.flags.isEnabled).not.toHaveBeenCalled();
    expect(riderOnly.vehicleRepo.fitnessOf).not.toHaveBeenCalled();
  });

  it('does NOT refuse when the flag store is unreadable — an outage must not stop a tenant\'s dispatch', () => {
    // Law 10's convention, which this platform applies everywhere: an unreadable flag reads as OFF, so a flag
    // store outage cannot silently ENABLE a feature — and here the feature is a refusal, so failing the other way
    // would ground every fleet on the platform because a cache was down.
    return (async () => {
      const h = harness({ requiresColdChain: true });
      h.flags.isEnabled = jest.fn(async () => { throw new Error('flag store down'); }) as never;
      const out = await h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-1' } as never, null);
      expect(out.status).toBe('assigned');
      expect(h.vehicleRepo.fitnessOf).not.toHaveBeenCalled();
    })();
  });

  it('does not refuse an FPO over a 3PL\'s expired paperwork', async () => {
    // A platform vehicle's RC lives in the partner's realm and RLS correctly hides it, so the tenant sees nothing
    // and can renew nothing. The carrier warrants its own fleet; the register says who holds the document.
    const h = harness({ vehicle: { id: 'veh-9', scope: 'platform', isActive: true, isRefrigerated: true, capacityKg: 7000, rcStatus: 'verified', rcValidUntil: '2020-01-01' } });
    const out = await h.svc.assign('t1', boss, 's1', { vehicleId: 'veh-9' } as never, null);
    expect(out.status).toBe('assigned');
    // …and the same vehicle is still refused when it is PARKED, because that is not about paperwork.
    const parked = harness({ vehicle: { id: 'veh-9', scope: 'platform', isActive: false, isRefrigerated: true, capacityKg: 7000, rcStatus: 'verified', rcValidUntil: '2029-01-01' } });
    await expect(parked.svc.assign('t1', boss, 's1', { vehicleId: 'veh-9' } as never, null))
      .rejects.toMatchObject({ details: { reason: 'vehicle_parked' } });
  });

  it('VehicleUnfitError carries a stable code and a reason for every branch', () => {
    for (const r of ['vehicle_unknown', 'vehicle_parked', 'rc_invalid', 'rc_absent', 'not_refrigerated'] as const) {
      const e = new VehicleUnfitError(r);
      expect(e.code).toBe('SHIPMENT_VEHICLE_UNFIT');
      expect((e.details as { reason: string }).reason).toBe(r);
      expect(e.message.length).toBeGreaterThan(20);
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the RC-parking job W229 describes', () => {
  function jobHarness(opts: { due?: Array<{ id: string; tenantId: string | null; regNo: string; rcStatus: string; rcValidUntil: string | null }>; flagOn?: boolean | Record<string, boolean>; parked?: boolean } = {}) {
    const sql: string[] = []; const params: unknown[][] = [];
    const client = { query: jest.fn(async (s: string, p?: unknown[]) => { sql.push(s); params.push(p ?? []); return { rows: [], rowCount: 1 }; }), release: jest.fn() };
    const pool = { connect: jest.fn(async () => client) };
    const vehicles = {
      rcInvalidActive: jest.fn(async () => opts.due ?? []),
      park: jest.fn(async () => opts.parked ?? true),
    };
    const flags = {
      isEnabled: jest.fn(async (key: string, ctx?: { tenantId?: string }) => {
        void key;
        if (typeof opts.flagOn === 'object') return opts.flagOn[ctx?.tenantId ?? '__platform__'] ?? false;
        return opts.flagOn ?? true;
      }),
    };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const job = new RcExpiryParkingJob(vehicles as never, flags as never, metrics as never);
    return { job, pool, client, sql, params, vehicles, flags, metrics };
  }
  const due = [{ id: 'v1', tenantId: 't1', regNo: 'GJ03TR8812', rcStatus: 'verified', rcValidUntil: '2026-01-01' }];

  it('parks the vehicle, audits it as the PLATFORM, and emits the evidence', async () => {
    const h = jobHarness({ due });
    const r = await h.job.run(h.pool as never, 500);
    expect(r).toEqual({ scanned: 1, parked: 1, skipped: 0 });
    expect(h.vehicles.park).toHaveBeenCalled();
    const outbox = h.sql.find((s) => s.includes('INSERT INTO outbox_events'))!;
    expect(outbox).toBeDefined();
    const audit = h.sql.find((s) => s.includes('INSERT INTO audit_log'))!;
    // No human clicked this. Attributing it to one would be a status recording an act nobody performed.
    expect(audit).toContain('actor_user_id');
    expect(audit).toContain('NULL');
    expect(audit).toContain('logistics.vehicle_parked_rc_invalid');
    expect(h.sql.filter((s) => s === 'COMMIT')).toHaveLength(1);
    expect(h.metrics.inc).toHaveBeenCalledWith('logistics.vehicle_parked_rc', { status: 'verified' });
    expect(FleetEventType.VehicleParkedRcInvalid).toBe('logistics.vehicle_parked_rc_invalid');
  });

  it('parks NOTHING when the tenant has the switch off — and says so in the count', async () => {
    const h = jobHarness({ due, flagOn: false });
    const r = await h.job.run(h.pool as never, 500);
    expect(r).toEqual({ scanned: 1, parked: 0, skipped: 1 });
    expect(h.vehicles.park).not.toHaveBeenCalled();
    expect(h.sql).not.toContain('COMMIT');
  });

  it('parks NOTHING when the flag store is unreadable', async () => {
    const h = jobHarness({ due });
    h.flags.isEnabled = jest.fn(async () => { throw new Error('flag store down'); }) as never;
    const r = await h.job.run(h.pool as never, 500);
    // Same convention as the request path: an unreadable flag reads as OFF. A safety rule that fires on a cache
    // outage would deactivate fleets nobody asked it to.
    expect(r).toEqual({ scanned: 1, parked: 0, skipped: 1 });
    expect(h.vehicles.park).not.toHaveBeenCalled();
  });

  it('puts the EVIDENCE in the event payload, not just the verdict', async () => {
    const h = jobHarness({ due });
    await h.job.run(h.pool as never, 500);
    const outboxCall = h.params.find((p) => String(p[0] ?? '').length > 0 && typeof p[3] === 'string' && String(p[3]).includes('vehicleId'));
    expect(outboxCall).toBeDefined();
    const payload = JSON.parse(String(outboxCall![3]));
    // A consumer told only "parked" cannot tell an FPO what to renew.
    expect(payload).toMatchObject({ v: 1, vehicleId: 'v1', regNo: 'GJ03TR8812', rcStatus: 'verified', rcValidUntil: '2026-01-01' });
    const auditCall = h.params.find((p) => typeof p[3] === 'string' && String(p[3]).includes('isActive') && String(p[3]).includes('false'));
    expect(JSON.parse(String(auditCall![3]))).toMatchObject({ isActive: false, rcStatus: 'verified', rcValidUntil: '2026-01-01' });
  });

  it('is PER TENANT: one tenant switching it on does not park another tenant\'s fleet', async () => {
    const h = jobHarness({
      due: [
        { id: 'v1', tenantId: 't1', regNo: 'A1', rcStatus: 'rejected', rcValidUntil: null },
        { id: 'v2', tenantId: 't2', regNo: 'B2', rcStatus: 'verified', rcValidUntil: '2026-01-01' },
        { id: 'v3', tenantId: 't1', regNo: 'C3', rcStatus: 'verified', rcValidUntil: '2025-01-01' },
      ],
      flagOn: { t1: true, t2: false },
    });
    const r = await h.job.run(h.pool as never, 500);
    expect(r).toEqual({ scanned: 3, parked: 2, skipped: 1 });
    // Memoised per tenant: a fleet is many vehicles and one tenant, and the flag store is not a per-row lookup.
    expect(h.flags.isEnabled.mock.calls.length).toBe(2);
  });

  it('counts a vehicle somebody else already parked as skipped, not as parked twice', async () => {
    const h = jobHarness({ due, parked: false });
    const r = await h.job.run(h.pool as never, 500);
    expect(r).toEqual({ scanned: 1, parked: 0, skipped: 1 });
    expect(h.sql).toContain('ROLLBACK');
  });

  it('releases the connection even when a tick throws', async () => {
    const h = jobHarness({ due });
    h.vehicles.park = jest.fn(async () => { throw new Error('deadlock'); }) as never;
    await expect(h.job.run(h.pool as never, 500)).rejects.toThrow(/deadlock/);
    expect(h.client.release).toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the cadence job that was built and never registered', () => {
  it('registers BOTH logistics jobs with the runner', () => {
    // **The defect.** `OpsAlertsCadenceJob` has always been constructed by a factory in this module — with a
    // comment reading "Every 10 minutes: fast enough that a cold-chain breach is seen while the cargo can still be
    // saved" — and `SCHEDULED_JOB_REGISTRY` was not imported by the module at all, so nothing ever called `run()`.
    // Seven other modules register their cadence jobs. Cold-chain breach alerting had no clock anywhere.
    const outbox = { register: jest.fn() };
    const jobs = { register: jest.fn() };
    const config = { jobs: { logisticsFleet: { enabled: true, rcParkingIntervalMs: 86_400_000, rcParkingBatchSize: 500 } } };
    const opsAlerts = { name: 'ops-alerts', intervalMs: 600_000, run: jest.fn() };
    const rcParking = { name: 'logistics-rc-expiry-parking', intervalMs: 86_400_000, run: jest.fn() };
    const orderConfirmed = { eventType: 'orders.order_confirmed', handle: jest.fn() };
    new LogisticsModule(outbox as never, jobs as never, config as never, orderConfirmed as never, opsAlerts as never, rcParking as never).onModuleInit();
    expect(outbox.register).toHaveBeenCalledWith(orderConfirmed);
    const registered = jobs.register.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(registered).toEqual(['ops-alerts', 'logistics-rc-expiry-parking']);
  });

  it('honours the per-job env gate, like every other module\'s cadence job', () => {
    const jobs = { register: jest.fn() };
    const config = { jobs: { logisticsFleet: { enabled: false, rcParkingIntervalMs: 1, rcParkingBatchSize: 1 } } };
    new LogisticsModule({ register: jest.fn() } as never, jobs as never, config as never,
      { eventType: 'x', handle: jest.fn() } as never, { name: 'a', intervalMs: 1, run: jest.fn() } as never, { name: 'b', intervalMs: 1, run: jest.fn() } as never).onModuleInit();
    expect(jobs.register).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · 0152 and the vocabulary that had no values', () => {
  it('gives the route ONE state machine and derives is_active from it', () => {
    const sql = migration();
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS status varchar(12)");
    expect(sql).toContain("CHECK (status IN ('proposed', 'active', 'inactive'))");
    expect(sql).toContain("ALTER COLUMN status SET DEFAULT 'proposed'");
    // The backfill runs BEFORE the NOT NULL and maps a live run to `active` — demoting running routes to
    // proposals would silently stop them.
    expect(sql).toMatch(/UPDATE delivery_routes SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END/);
    expect(sql).toContain('ADD COLUMN is_active boolean GENERATED ALWAYS AS (status = \'active\') STORED');
    // Two mechanisms over one fact is on this programme's defect list; the generated column is the fix.
    expect(sql).toContain('DROP COLUMN is_active');
  });

  it('records the approval as evidence, both halves or neither', () => {
    const sql = migration();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id)');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS approved_at timestamptz');
    expect(sql).toContain('CHECK ((approved_by IS NULL) = (approved_at IS NULL))');
  });

  it('indexes the two queries this wave put on a write path', () => {
    const sql = migration();
    expect(sql).toContain('idx_delivery_routes_live_day');
    expect(sql).toContain("WHERE status = 'active' AND deleted_at IS NULL");
    expect(sql).toContain('idx_vehicles_rc_doc');
    expect(sql).toContain('idx_vehicles_tenant_active');
  });

  it('ships all three switches OFF, separately', () => {
    const sql = migration();
    for (const f of ['logistics_fleet_fitness', 'logistics_rc_parking', 'logistics_require_rc']) expect(sql).toContain(`'${f}'`);
    expect(sql.match(/INSERT INTO feature_flags/g)?.length).toBe(3);
    expect(sql).not.toMatch(/is_enabled\s*\)\s*SELECT[^;]*true/);
  });

  it('**adds `vehicles.is_active`, which the whole fleet registry queried and which never existed**', () => {
    const sql = migration();
    // Found by applying this migration to an empty PG16: an index creation failed with
    // `ERROR: column "is_active" does not exist`. 0007 declared that column on logistics_partners, pickup_slots
    // and delivery_routes and MISSED vehicles, while VehicleRepository SELECTs it, INSERTs it, UPDATEs it and
    // filters on it (with `activeOnly` defaulting to TRUE) — so every vehicle read and write on the platform
    // errored at the database, in this console and in the live 3PL partner console.
    expect(sql).toContain('ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true');
    expect(sql).toContain('COMMENT ON COLUMN vehicles.is_active');
    expect(sql).toContain('column is_active does not exist');
    // The repository has always assumed it — asserted here so a future "tidy-up" that drops the column has to
    // read this test first.
    const repo = read('repositories', 'vehicle.repository.ts');
    expect(repo).toContain('is_active');
    expect(repo).toContain('WHERE id=$1 AND is_active=true');
  });

  it('**seeds the `rc` document type, without which an RC could not be classified at all**', () => {
    const s = seed();
    // `vehicles.rc_doc_id` → `kyc_documents.doc_type_id` → this vocabulary, which held four values while 0003's own
    // comment names eight. There was no `rc`: even an uploaded registration certificate had no type to be filed
    // under, so W229's RC column had nothing to read at the far end of its own foreign key.
    expect(s).toContain("('doc_type',NULL,'rc','Vehicle registration certificate'");
    // The four others 0003 promised are NAMED rather than added by a wave that does not own them — a value nobody
    // reads is its own defect.
    for (const missing of ['license_form20', 'organic_cert', 'vet_degree']) {
      expect({ code: missing, named: s.includes(missing) }).toEqual({ code: missing, named: true });
      expect({ code: missing, seeded: s.includes(`,'${missing}','`) }).toEqual({ code: missing, seeded: false });
    }
  });

  it('reads the FACT in the job\'s query, because the planner cannot prove a generated column matches', () => {
    // 0152's partial index is `WHERE status = 'active'`. The version of this query that filtered the DERIVED
    // `is_active` planned a **Seq Scan** over every route on the platform — proven by EXPLAIN on 4,000 rows during
    // this wave's live apply — because PostgreSQL cannot prove a predicate on a generated column is the same
    // predicate. One fact, read one way, and the index matches it.
    const repo = read('repositories', 'delivery-route.repository.ts');
    const job = repo.slice(repo.indexOf('async findActiveByWeekday'), repo.indexOf('async list('));
    expect(job).toContain("status = 'active'");
    expect(job).not.toContain('is_active');
    expect(migration()).toContain("WHERE status = 'active' AND deleted_at IS NULL");
  });

  it('names the dead column it deliberately leaves dead, and the two it now reads', () => {
    const sql = migration();
    expect(sql).toContain('COMMENT ON COLUMN shipments.route_id');
    expect(sql).toContain('DEAD COLUMN since 0007');
    expect(sql).toContain('COMMENT ON COLUMN vehicles.rc_doc_id');
    expect(sql).toContain('COMMENT ON COLUMN vehicles.is_refrigerated');
  });

  it('**seeds the vehicle_type vocabulary that had a type and NOT ONE VALUE**', () => {
    const s = seed();
    // The type was declared from the beginning; no value was ever inserted, so `vehicles.vehicle_type_id` could
    // never be set and W229's Type column had no source and its form no options.
    expect(s).toContain("('vehicle_type','Vehicle type',false)");
    for (const code of ['bike', 'tempo', 'truck', 'reefer_7mt', 'tractor_trolley']) {
      expect({ code, seeded: s.includes(`('vehicle_type',NULL,'${code}'`) }).toEqual({ code, seeded: true });
    }
    // The reefer type carries the flag as a DEFAULT for the form; `is_refrigerated` stays the column the gate
    // reads, because a retrofitted insulated tempo is real.
    expect(s).toMatch(/'reefer_7mt','Reefer \(7 MT\)','\{"refrigerated":true/);
    expect(s).toContain('ON CONFLICT (type_code,tenant_id,code) DO NOTHING');
    // Seeds own vocabularies (Law 6) — the migration says so rather than duplicating them.
    expect(migration()).toContain('does not seed the `vehicle_type` vocabulary');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5b · the SDK and the routes that had no client', () => {
  it('now exposes the fleet register and the route board', () => {
    const sdk = fs.readFileSync(path.join(REPO, 'packages/sdk-js/src/resources/logistics.ts'), 'utf8');
    for (const m of ['async register(', 'async createVehicle(', 'async setVehicleActive(', 'async board(', 'async corridors(', 'async approve(']) {
      expect({ method: m, present: sdk.includes(m) }).toEqual({ method: m, present: true });
    }
    const client = fs.readFileSync(path.join(REPO, 'packages/sdk-js/src/client.ts'), 'utf8');
    expect(client).toContain('this.fleet = new FleetResource(this.http)');
    expect(client).toContain('this.routes = new RoutesResource(this.http)');
  });

  it('exposes the register and the approval as ROUTES, with the read gated on logistics.manage', () => {
    const file = read('controllers', 'v1', 'partners.controller.ts');
    // Three controllers live in this file; the ordering rule is about THIS one's routes.
    const partners = file.slice(file.indexOf('export class VehiclesController'), file.indexOf('export class PickupSlotsController'));
    expect(partners).toContain("@Get('register')");
    // A safety register carries document status, expiry dates and a live temperature — W229's restricted state is
    // explicit that it needs the logistics lead.
    expect(partners).toMatch(/@Get\('register'\)\s*@RequirePermissions\(ShipmentPermissions\.Manage\)/);
    // Declared before `:id` or the literal path is swallowed by the parameter route.
    expect(partners.indexOf("@Get('register')")).toBeLessThan(partners.indexOf("@Get(':id')"));
    const routes = read('controllers', 'v1', 'routes.controller.ts');
    expect(routes).toContain("@Get('board')");
    expect(routes).toContain("@Get('corridors')");
    expect(routes).toContain("@Post(':id/approve')");
    expect(routes.indexOf("@Get('board')")).toBeLessThan(routes.indexOf("@Get(':id')"));
    // Approval is a commitment: idempotent, like create (Law 3). Read from the METHOD's own text, because a
    // file-wide match would be satisfied by the `create` route's key three methods above.
    const approveMethod = routes.slice(routes.indexOf("@Post(':id/approve')"), routes.indexOf("@Post(':id/approve')") + 400);
    expect(approveMethod).toContain("Headers('idempotency-key')");
    expect(approveMethod).toContain('reqKey(key)');
  });
});
