// modules/logistics/read-models/fleet-register.read-model.ts · W229's fleet register (PC-56 TENANT-5b).
//
// A READ model: no writes, replica-only, and every judgement it renders comes from `domain/fleet-fitness.ts` so
// the console and the assignment gate cannot disagree about whether a vehicle is fit. That mattered enough to
// build it this way: a register that shows a green RC while `assign` refuses the vehicle would send an operator
// to file a bug about a rule working correctly.
//
// The masking, the rounding of nothing, and the refusal to invent "free 15:30" all happen HERE rather than in a
// template — a full registration number that reaches a serializer has already left the building.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { VehicleRepository, VehicleListQuery } from '../repositories/vehicle.repository';
import {
  FLEET_FITNESS_FLAG, RC_PARKING_FLAG, REQUIRE_RC_FLAG,
  RcCell, TodayVerdict, fleetSplit, maskRegNo, rcParks, rcVerdict, todayVerdict, vehicleFitness,
} from '../domain/fleet-fitness';
import { encodeFleetCursor } from '../services/logistics-partner.service';

export interface RegisterVehicleRow {
  id: string;
  /** 'tenant' = the FPO's own vehicle (it can park this one). 'platform' = a 3PL's, browsed read-only (Law 11). */
  scope: 'tenant' | 'platform';
  /** W229 prints `GJ-03-TR-88••`. The full plate is never serialised by this read. */
  regNoMasked: string;
  partnerName: string | null;
  /** The lookup CODE (`tempo`, `reefer_7mt`), translated by the console. Null until 0005's vocabulary is seeded
   *  — which, before this wave, was every vehicle on the platform. */
  typeCode: string | null;
  capacityKg: number | null;
  isRefrigerated: boolean;
  isActive: boolean;
  /** The RC, read for the first time. `3pl_held` is W229's own word for a partner's document. */
  rc: RcCell;
  /** Would the assignment gate refuse this vehicle right now, and why — the same function `assign` calls. */
  unfit: string | null;
  /** Whether an expired/rejected RC has actually parked this vehicle yet, or is merely due to. */
  parkedByRc: boolean;
  today: TodayVerdict;
}

export interface RegisterPage {
  items: RegisterVehicleRow[];
  nextCursor: string | null;
  /** W229's footer: "4 highlighted of 5 vehicles (yours 3 + partnered 2)". Of THIS PAGE, and the copy says so —
   *  a total across a keyset-paged table would be a count of something the reader cannot see. */
  split: { own: number; partnered: number; total: number };
  /** What is switched on, so the screen can say "this RC is expired and nothing is parking it" rather than
   *  implying W229's automatic parking is running when the flag is off. */
  mechanisms: { fitnessGate: boolean; rcParking: boolean; requireRc: boolean };
}

@Injectable()
export class FleetRegisterReadModel {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async register(tenantId: string, q: VehicleListQuery, now: Date = new Date()): Promise<RegisterPage> {
    return timed(this.metrics, 'logistics.fleet_register', { tenant: tenantId }, async () => {
      const rows = await this.vehicles.registerRows(tenantId, q);
      const ids = rows.map((r) => r.id);
      // Four bounded reads over the page's ids rather than one join across four partitioned tables: the day's
      // counters, the committed run, the reefer reading and the flags are independent questions, and a single
      // query would make the register's cost depend on the busiest vehicle's history.
      const [today, runs, reefer, fitnessGate, rcParking, requireRc] = await Promise.all([
        this.vehicles.todayFor(tenantId, ids),
        this.vehicles.nextRunFor(tenantId, ids),
        this.vehicles.reeferFor(tenantId, ids),
        this.flags.isEnabled(FLEET_FITNESS_FLAG, { tenantId }).catch(() => false),
        this.flags.isEnabled(RC_PARKING_FLAG, { tenantId }).catch(() => false),
        this.flags.isEnabled(REQUIRE_RC_FLAG, { tenantId }).catch(() => false),
      ]);
      const todayBy = new Map(today.map((t) => [t.vehicleId, t]));
      const runBy = new Map(runs.map((r) => [r.vehicleId, r]));
      const reeferBy = new Map(reefer.map((r) => [r.vehicleId, r]));

      const items: RegisterVehicleRow[] = rows.map((v) => {
        const held = v.scope === 'platform';
        const verdict = rcVerdict({ status: v.rcStatus, validUntil: v.rcValidUntil }, now);
        const rc: RcCell = held ? { kind: '3pl_held' } : verdict;
        const t = todayBy.get(v.id);
        const run = runBy.get(v.id);
        const rf = reeferBy.get(v.id);
        // The SAME function the gate calls, asked without a cold-chain requirement: this is the vehicle's own
        // fitness, not a verdict about one consignment. A reefer requirement belongs to a shipment.
        const fit = vehicleFitness({
          vehicle: { id: v.id, isActive: v.isActive, isRefrigerated: v.isRefrigerated, capacityKg: v.capacityKg },
          rc: verdict, requiresColdChain: false, requireRcOnFile: requireRc, rcHeldByPartner: held,
        });
        return {
          id: v.id, scope: v.scope, regNoMasked: maskRegNo(v.regNo), partnerName: v.partnerName,
          typeCode: v.typeCode, capacityKg: v.capacityKg, isRefrigerated: v.isRefrigerated, isActive: v.isActive,
          rc,
          unfit: fit.kind === 'fit' ? null : fit.kind,
          // "Due to be parked" and "parked" are different sentences on a safety screen, and the difference is
          // whether the job is switched on at all.
          parkedByRc: !held && rcParks(verdict) && !v.isActive,
          today: todayVerdict({
            onRoad: t?.onRoad ?? 0, deliveredToday: t?.deliveredToday ?? 0, assignedToday: t?.assignedToday ?? 0,
            nextRun: run ? { routeName: run.routeName, weekday: run.weekday } : null,
            reefer: rf ? { tempC: rf.tempC, isBreach: rf.isBreach } : null,
          }),
        };
      });
      const last = rows[rows.length - 1];
      return {
        items,
        nextCursor: rows.length === q.limit && last ? encodeFleetCursor(last.createdAt, last.id) : null,
        split: fleetSplit(items),
        mechanisms: { fitnessGate, rcParking, requireRc },
      };
    });
  }
}
