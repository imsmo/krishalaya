// modules/logistics/read-models/route-board.read-model.ts · W231's delivery-routes board (PC-56 TENANT-5b).
//
// A READ model: replica-only, no writes, and every judgement comes from `domain/route-plan.ts` so the board and
// the [Approve route] button cannot disagree about whether a proposal is approvable.
//
// Three things this file is careful about, because W231 is a screen an FPO commits a truck on:
//   • the parcels number says whether it is MEASURED (an approved route's own history) or ESTIMATED (a
//     proposal's villages, from ad-hoc traffic). The canon prints "est." on exactly that row and the word
//     carries the whole difference;
//   • the economics return ONE side. The ad-hoc cost per parcel is real (`shipments.charge_minor`); a planned
//     run's cost is recorded nowhere on this platform, so `routeCost: 'not_recorded'` travels with the number
//     rather than a ₹28 nobody computed;
//   • villages are NAMES (`admin_regions.default_name`) and the consolidation point is a NAME plus a tier CODE.
//     A board of uuids is not a board.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { DeliveryRouteRepository } from '../repositories/delivery-route.repository';
import { VehicleRepository } from '../repositories/vehicle.repository';
import {
  ApprovalVerdict, EconomicsVerdict, ParcelsVerdict, RouteStatus, SUGGEST_WINDOW_DAYS,
  approvalVerdict, economicsVerdict, parcelsVerdict, suggestVerdict, villageOverflow, weekdayKey,
} from '../domain/route-plan';
import { maskRegNo } from '../domain/fleet-fitness';
import { encodeFleetCursor } from '../services/logistics-partner.service';

/** How far back the measure looks. 90 days ≈ 12 Saturdays: enough runs that an average means something, short
 *  enough that last season's crop pattern is not being sold as this season's demand. */
export const TRAFFIC_WINDOW_DAYS = 90;
/** The corridor list is a reading aid, not a report — bounded so an empty console cannot pull a season of rows. */
export const CORRIDOR_LIMIT = 20;

export interface RouteBoardRow {
  id: string;
  name: string;
  status: RouteStatus;
  /** i18n key ('route.day.sat'), never a weekday NAME — "Sat" is a word in three launch languages. */
  dayKey: string | null;
  onDemand: boolean;
  villages: { names: string[]; total: number; more: number };
  consolidation: { userId: string; name: string | null; tierCode: string | null } | null;
  vehicle: { id: string; regNoMasked: string } | null;
  parcels: ParcelsVerdict;
  economics: EconomicsVerdict;
  /** Whether [Approve route] may be OFFERED, and if not, which commitment is missing. */
  approval: ApprovalVerdict;
  approvedAt: string | null;
}

export interface RouteBoardPage {
  items: RouteBoardRow[];
  nextCursor: string | null;
  /** W231's footer: "3 highlighted of 4 routes (3 active + 1 proposed)" — of this page, and the copy says so. */
  counts: { active: number; proposed: number; inactive: number; total: number };
  windowDays: number;
}

@Injectable()
export class RouteBoardReadModel {
  constructor(
    private readonly routes: DeliveryRouteRepository,
    private readonly vehicles: VehicleRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async board(tenantId: string, q: { status?: string; runWeekday?: number; cursor?: { c: string; id: string }; limit: number }): Promise<RouteBoardPage> {
    return timed(this.metrics, 'logistics.route_board', { tenant: tenantId }, async () => {
      const rows = (await this.routes.list(tenantId, { activeOnly: false, status: q.status, runWeekday: q.runWeekday, cursor: q.cursor, limit: q.limit }))
        .map((r) => r.toProps());
      const ids = rows.map((r) => r.id);
      const regionIds = Array.from(new Set(rows.flatMap((r) => r.villageRegionIds)));
      const userIds = Array.from(new Set(rows.map((r) => r.consolidationUserId).filter((x): x is string => !!x)));
      const vehicleIds = Array.from(new Set(rows.map((r) => r.vehicleId).filter((x): x is string => !!x)));

      const [traffic, names, points, vehicleRows] = await Promise.all([
        this.routes.traffic(tenantId, ids, TRAFFIC_WINDOW_DAYS),
        this.routes.regionNames(tenantId, regionIds),
        this.routes.consolidationPoints(tenantId, userIds),
        vehicleIds.length ? this.vehicles.registerRows(tenantId, { activeOnly: false, limit: Math.max(vehicleIds.length, 1) }) : Promise.resolve([]),
      ]);
      const trafficBy = new Map(traffic.map((t) => [t.routeId, t]));
      const vehicleBy = new Map(vehicleRows.map((v) => [v.id, v]));

      const counts = { active: 0, proposed: 0, inactive: 0, total: rows.length };
      const items: RouteBoardRow[] = rows.map((r) => {
        counts[r.status] += 1;
        const t = trafficBy.get(r.id);
        const shown = r.villageRegionIds.slice(0, 3).map((id) => names.get(id) ?? id);
        const v = r.vehicleId ? vehicleBy.get(r.vehicleId) : undefined;
        const point = r.consolidationUserId ? points.get(r.consolidationUserId) : undefined;
        return {
          id: r.id, name: r.defaultName, status: r.status,
          dayKey: weekdayKey(r.runWeekday), onDemand: r.runWeekday === null,
          villages: { names: shown, total: r.villageRegionIds.length, more: villageOverflow(r.villageRegionIds.length) },
          consolidation: r.consolidationUserId
            ? { userId: r.consolidationUserId, name: point?.fullName ?? null, tierCode: point?.tierCode ?? null }
            : null,
          // The plate is masked here too: the board is the same audience as the register.
          vehicle: r.vehicleId ? { id: r.vehicleId, regNoMasked: v ? maskRegNo(v.regNo) : '' } : null,
          parcels: parcelsVerdict({ status: r.status, parcels: t?.parcels ?? 0, runs: t?.runs ?? 0 }),
          economics: economicsVerdict({
            adHocTotalMinor: BigInt(t?.chargeTotalMinor ?? '0'), adHocParcels: t?.parcels ?? 0,
            // The currency is the ORDERS' own, read alongside the charges rather than assumed: a platform that
            // hardcodes INR here cannot open a second country (Rule Zero).
            currencyCode: t?.currencyCode ?? 'INR',
          }),
          approval: approvalVerdict({ status: r.status, vehicleId: r.vehicleId, consolidationUserId: r.consolidationUserId, villageRegionIds: r.villageRegionIds }),
          approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
        };
      });
      const last = rows[rows.length - 1];
      return {
        items,
        nextCursor: rows.length === q.limit && last ? encodeFleetCursor(last.createdAt ?? null, last.id) : null,
        counts, windowDays: TRAFFIC_WINDOW_DAYS,
      };
    });
  }

  /**
   * W231's empty state offers "the suggest tool maps 30 days of ad-hoc shipments into route candidates". The
   * tool does not exist; this is its ingredient, and the verdict says which is which.
   *
   * Corridors are village + weekday + parcels + spend — real traffic an operator reads and turns into a
   * proposal. Nothing here creates a route: a grouping query must not commit a vehicle and a named person's day.
   */
  async corridors(tenantId: string): Promise<{ verdict: ReturnType<typeof suggestVerdict>; items: Array<{ regionId: string; villageName: string | null; dayKey: string | null; parcels: number; spentMinor: string }> }> {
    const raw = await this.routes.corridors(tenantId, SUGGEST_WINDOW_DAYS, CORRIDOR_LIMIT);
    const names = await this.routes.regionNames(tenantId, raw.map((c) => c.regionId));
    return {
      verdict: suggestVerdict(),
      items: raw.map((c) => ({
        regionId: c.regionId, villageName: names.get(c.regionId) ?? null,
        dayKey: weekdayKey(c.weekday), parcels: c.parcels, spentMinor: c.chargeTotalMinor,
      })),
    };
  }
}
