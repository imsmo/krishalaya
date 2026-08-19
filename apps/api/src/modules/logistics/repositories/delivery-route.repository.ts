// modules/logistics/repositories/delivery-route.repository.ts · SQL for delivery_routes (0007). NOT partitioned.
// Tenant-scoped (tenant_id NOT NULL) + RLS. No version col → mutations lock the row. Reads on the replica; keyset
// on (created_at, id). village_region_ids is a jsonb array. vehicle_id / consolidation_user_id FK violations
// surface as a typed 422.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { DeliveryRoute } from '../domain/delivery-route.entity';
import { UnknownZoneRouteReferenceError } from '../domain/logistics.errors';

export interface DueRouteRow { id: string; tenantId: string; defaultName: string; vehicleId: string | null; consolidationUserId: string | null; }

// PC-56 TENANT-5b · `status` replaces `is_active` as the written fact (0152). `is_active` is still SELECTed by
// nothing here on purpose: it is a GENERATED column now, so reading it would be reading the same fact twice, and
// WRITING it is an error PostgreSQL raises ("cannot insert a non-DEFAULT value into column is_active") — which
// is exactly the protection this wave wanted.
const COLS = `id, tenant_id, default_name, run_weekday, village_region_ids, vehicle_id, consolidation_user_id, status, approved_by, approved_at, created_at`;
const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String) : []);

function toDomain(r: any): DeliveryRoute {
  return DeliveryRoute.rehydrate({
    id: r.id, tenantId: r.tenant_id, defaultName: r.default_name, runWeekday: r.run_weekday, villageRegionIds: arr(r.village_region_ids),
    vehicleId: r.vehicle_id, consolidationUserId: r.consolidation_user_id,
    status: r.status, approvedBy: r.approved_by, approvedAt: r.approved_at, createdAt: r.created_at,
  });
}
export interface RouteListQuery { runWeekday?: number; activeOnly: boolean; status?: string; cursor?: { c: string; id: string }; limit: number; }

/** One route's measured traffic (PC-56 TENANT-5b). `parcels`/`runs` feed `parcelsVerdict`, `chargeTotalMinor`
 *  feeds `economicsVerdict` — both computed from delivered shipments, never from `shipments.route_id`, which
 *  nothing has ever written (see 0152's COMMENT on that column). */
export interface RouteTrafficRow { routeId: string; parcels: number; runs: number; chargeTotalMinor: string; currencyCode: string | null }

@Injectable()
export class DeliveryRouteRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, e: DeliveryRoute): Promise<void> {
    const p = e.toProps();
    try {
      await tx.query(
        `INSERT INTO delivery_routes (id, tenant_id, default_name, run_weekday, village_region_ids, vehicle_id, consolidation_user_id, status, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8, now())`,
        [p.id, p.tenantId, p.defaultName, p.runWeekday, JSON.stringify(p.villageRegionIds), p.vehicleId, p.consolidationUserId, p.status]);
    } catch (e2: any) { if (e2?.code === '23503') throw new UnknownZoneRouteReferenceError('vehicle_or_consolidation_user'); throw e2; }
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DeliveryRoute | null> {
    const r = await tx.query(`SELECT ${COLS} FROM delivery_routes WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<DeliveryRoute | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM delivery_routes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async update(tx: TxContext, e: DeliveryRoute): Promise<void> {
    const p = e.toProps();
    try {
      await tx.query(
        `UPDATE delivery_routes SET default_name=$3, run_weekday=$4, village_region_ids=$5::jsonb, vehicle_id=$6,
           consolidation_user_id=$7, status=$8, approved_by=$9, approved_at=$10, updated_at=now()
          WHERE id=$1 AND tenant_id=$2`,
        [p.id, p.tenantId, p.defaultName, p.runWeekday, JSON.stringify(p.villageRegionIds), p.vehicleId, p.consolidationUserId,
         p.status, p.approvedBy, p.approvedAt]);
    } catch (e2: any) { if (e2?.code === '23503') throw new UnknownZoneRouteReferenceError('vehicle_or_consolidation_user'); throw e2; }
  }

  /**
   * Cross-tenant scan for the Village-Run consolidation job: APPROVED routes scheduled for `weekday`. Bounded.
   *
   * PC-56 TENANT-5b: filters `status = 'active'` — the FACT — and not the derived `is_active`. That is not a
   * stylistic preference: 0152's partial index is `WHERE status = 'active'`, and PostgreSQL cannot prove that a
   * predicate on a GENERATED column is the same predicate, so the version of this query that read `is_active`
   * planned a **Seq Scan** over every route on the platform (proven by EXPLAIN on 4,000 rows during this wave's
   * live apply). One fact, read one way, and the index matches it.
   */
  async findActiveByWeekday(exec: SqlExecutor, weekday: number, limit: number): Promise<DueRouteRow[]> {
    const r = await exec.query(
      `SELECT id, tenant_id, default_name, vehicle_id, consolidation_user_id FROM delivery_routes
        WHERE status = 'active' AND run_weekday = $1 AND deleted_at IS NULL ORDER BY id LIMIT $2`, [weekday, limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, defaultName: x.default_name, vehicleId: x.vehicle_id, consolidationUserId: x.consolidation_user_id }));
  }

  async list(tenantId: string, q: RouteListQuery): Promise<DeliveryRoute[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1`;
    if (q.runWeekday !== undefined) where += ` AND run_weekday=${p(q.runWeekday)}`;
    if (q.activeOnly) where += ` AND status = 'active'`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM delivery_routes WHERE ${where} AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /**
   * **W231's "Parcels/run avg", MEASURED (PC-56 TENANT-5b).**
   *
   * A delivered shipment whose drop address sits in one of the route's village regions, on the route's own
   * weekday, is a parcel that run carried. `runs` counts the DISTINCT delivery dates, so the average is per
   * actual run rather than per calendar week — a Saturday that was rained off is not a run with zero parcels.
   *
   * Not from `shipments.route_id`: that column has existed since 0007 and is written by nothing, because
   * nothing anywhere chooses a route for a shipment (0152 records the decision to leave it dead rather than
   * back-fill an invented choice).
   *
   * PRUNED (Law 8): `shipments` is partitioned by `created_at` and this filters on `delivered_at`, so the
   * created_at bound is what stops the query touching every partition ever created. A shipment delivered inside
   * the window cannot have been created more than `windowDays + 30` ago in any realistic flow, and the extra
   * month is slack rather than a guess that could silently drop parcels.
   */
  async traffic(tenantId: string, routeIds: readonly string[], windowDays: number): Promise<RouteTrafficRow[]> {
    if (routeIds.length === 0) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `WITH r AS (
         SELECT id, run_weekday, village_region_ids FROM delivery_routes
          WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
       ), rr AS (
         SELECT r.id AS route_id, r.run_weekday, (jsonb_array_elements_text(r.village_region_ids))::uuid AS region_id FROM r
       )
       SELECT rr.route_id,
              count(*)::int AS parcels,
              count(DISTINCT (s.delivered_at)::date)::int AS runs,
              coalesce(sum(s.charge_minor), 0)::text AS charge_total,
              max(o.currency_code) AS currency_code
         FROM shipments s
         JOIN addresses a ON a.id = s.drop_address_id
         JOIN rr ON rr.region_id = a.region_id
         LEFT JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
        WHERE s.tenant_id=$1
          AND s.status = 'delivered'
          AND s.delivered_at >= now() - ($3 || ' days')::interval
          AND s.created_at   >= now() - (($3::int + 30) || ' days')::interval
          AND s.created_at   <= now()
          AND (rr.run_weekday IS NULL OR extract(dow FROM s.delivered_at) = rr.run_weekday)
        GROUP BY rr.route_id`, [tenantId, [...routeIds], windowDays]);
    return r.rows.map((x: any) => ({
      routeId: x.route_id, parcels: Number(x.parcels ?? 0), runs: Number(x.runs ?? 0),
      chargeTotalMinor: String(x.charge_total ?? '0'), currencyCode: x.currency_code ?? null,
    }));
  }

  /**
   * W231's second empty state offers "the suggest tool maps 30 days of ad-hoc shipments into route candidates".
   * That tool does not exist. What this returns is its honest ingredient: the corridors an operator's parcels
   * ALREADY travel — village, weekday, parcels, spend — which a person reads and turns into a proposal. Nothing
   * here creates a route, because a grouping query must not commit a vehicle and an ambassador.
   */
  async corridors(tenantId: string, windowDays: number, limit: number): Promise<Array<{ regionId: string; weekday: number; parcels: number; chargeTotalMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT a.region_id,
              extract(dow FROM s.delivered_at)::int AS weekday,
              count(*)::int AS parcels,
              coalesce(sum(s.charge_minor), 0)::text AS charge_total
         FROM shipments s
         JOIN addresses a ON a.id = s.drop_address_id
        WHERE s.tenant_id=$1 AND s.status='delivered' AND a.region_id IS NOT NULL
          AND s.delivered_at >= now() - ($2 || ' days')::interval
          AND s.created_at   >= now() - (($2::int + 30) || ' days')::interval
          AND s.created_at   <= now()
        GROUP BY a.region_id, weekday
        ORDER BY parcels DESC, a.region_id
        LIMIT $3`, [tenantId, windowDays, limit]);
    return r.rows.map((x: any) => ({ regionId: x.region_id, weekday: Number(x.weekday), parcels: Number(x.parcels), chargeTotalMinor: String(x.charge_total ?? '0') }));
  }

  /** Village NAMES for a set of region ids (W231 prints "Vanthali, Bhesan, Keshod +11", not eleven uuids).
   *  `admin_regions` is platform reference data with no tenant column — read-only here, and bounded. */
  async regionNames(tenantId: string, regionIds: readonly string[]): Promise<Map<string, string>> {
    if (regionIds.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, default_name FROM admin_regions WHERE id = ANY($1::uuid[])`, [[...regionIds]]);
    return new Map(r.rows.map((x: any) => [String(x.id), String(x.default_name)]));
  }

  /** The consolidation point: a named person, and the ambassador tier W231 prints beside them
   *  ("Dinesh Bhai M. (cluster lead)"). The tier is a lookup CODE, translated by the console — never the
   *  seeded English label, which would ship one language to three. */
  async consolidationPoints(tenantId: string, userIds: readonly string[]): Promise<Map<string, { fullName: string | null; tierCode: string | null }>> {
    if (userIds.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT u.id, u.full_name, lv.code AS tier_code
         FROM users u
         LEFT JOIN ambassador_profiles ap ON ap.user_id = u.id AND ap.tenant_id = $1 AND ap.deleted_at IS NULL
         LEFT JOIN lookup_values lv ON lv.id = ap.tier_id
        WHERE u.id = ANY($2::uuid[])`, [tenantId, [...userIds]]);
    return new Map(r.rows.map((x: any) => [String(x.id), { fullName: x.full_name ?? null, tierCode: x.tier_code ?? null }]));
  }
}
