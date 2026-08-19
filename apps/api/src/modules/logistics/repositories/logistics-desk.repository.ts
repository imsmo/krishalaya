// modules/logistics/repositories/logistics-desk.repository.ts · the reads behind W225 (overview) and W244
// (insights) — PC-56 TENANT-5d. Replica-only; every statement is tenant-scoped and window-bounded.
//
// `shipments` and `shipment_events` are both PARTITIONED on `created_at` (Law 8), so every query here carries a
// `created_at` lower bound derived from the window the caller asked for — not as an optimisation but as the thing
// that stops a 90-day question from touching every partition the platform will ever have. `EXPLAIN` on the live
// schema is part of this wave's proof, because 5b learned that a predicate on the wrong column silently defeats a
// partial index and 5c learned that a join key with no index silently defeats everything.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { DeliveryStats, FailureRow, LaneRow } from '../domain/logistics-desk';

/** A shipment that needs somebody today: the schedule, and whether it has a vehicle and a driver. */
export interface DueShipmentRow {
  id: string; orderId: string; status: string; scheduledPickupAt: string;
  hasVehicle: boolean; hasRider: boolean; hasPartner: boolean; requiresColdChain: boolean;
}

export interface ColdChainInTransitRow {
  shipmentId: string; orderId: string; lastTempC: string | null; lastAt: string | null; breaches: number;
}

const day = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

@Injectable()
export class LogisticsDeskRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** W225's "24 active shipments" and its tab counts — one grouped scan of the live window rather than one query
   *  per status, which is how a six-tile header becomes six round trips. */
  async statusCounts(tenantId: string, windowDays: number): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT status::text AS status, count(*)::int AS n
         FROM shipments
        WHERE tenant_id=$1 AND created_at >= (now() - ($2::int || ' days')::interval)
        GROUP BY status`, [tenantId, windowDays]);
    const out: Record<string, number> = {};
    for (const x of r.rows as any[]) out[String(x.status)] = Number(x.n);
    return out;
  }

  /**
   * W225's "2 pickups scheduled today".
   *
   * Bounded to the CALENDAR day in the database's own time zone, and counted rather than inferred from a page: a
   * header that says "2" while the list below it shows one is the kind of disagreement that makes an operator stop
   * trusting both numbers.
   */
  async pickupsToday(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n
         FROM shipments
        WHERE tenant_id=$1 AND scheduled_pickup_at IS NOT NULL
          AND scheduled_pickup_at >= date_trunc('day', now())
          AND scheduled_pickup_at <  date_trunc('day', now()) + interval '1 day'
          -- The shipment must still be waiting to be collected; a pickup that already happened is not today's work.
          AND status IN ('assigned','pickup_scheduled')
          AND created_at >= (now() - interval '90 days')`, [tenantId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /**
   * The attention list's own rows: pickups due inside the next window, with what they are missing.
   *
   * `hasRider`/`hasPartner` are the distinction 5a drew and W225 prints ("tempo assigned, no driver yet"): a 3PL
   * shipment carries its own driver, so a missing rider on a partner shipment is not a gap. Both are returned and
   * the domain decides, because that judgement belongs in one place.
   */
  async pickupsDue(tenantId: string, hours: number, limit: number): Promise<DueShipmentRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, order_id, status::text AS status, scheduled_pickup_at,
              (vehicle_id IS NOT NULL) AS has_vehicle, (rider_user_id IS NOT NULL) AS has_rider,
              (partner_id IS NOT NULL) AS has_partner, requires_cold_chain
         FROM shipments
        WHERE tenant_id=$1 AND scheduled_pickup_at IS NOT NULL
          AND scheduled_pickup_at <= (now() + ($2::int || ' hours')::interval)
          AND status IN ('assigned','pickup_scheduled')
          AND created_at >= (now() - interval '90 days')
        ORDER BY scheduled_pickup_at
        LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}`, [tenantId, hours]);
    return (r.rows as any[]).map((x) => ({
      id: x.id, orderId: x.order_id, status: String(x.status), scheduledPickupAt: iso(x.scheduled_pickup_at) ?? '',
      hasVehicle: x.has_vehicle === true, hasRider: x.has_rider === true, hasPartner: x.has_partner === true,
      requiresColdChain: x.requires_cold_chain === true,
    }));
  }

  /**
   * The cold-chain rows W225 puts on the desk: reefer shipments IN FLIGHT, with their latest reading and how many
   * breaches that reading is part of.
   *
   * The temperature comes from `cold_chain_logs` (`subject_type='shipment'`), which is the ledgered reading — the
   * same source 5b's reefer check used, and the only one. There is no ETA here: 5a refused it for the whole platform
   * (no routing engine, no traffic feed), and W225's "ETA 17:30" is the one number on this row a farmer would plan an
   * afternoon around.
   */
  async coldChainInTransit(tenantId: string, limit: number): Promise<ColdChainInTransitRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH live AS (
         SELECT id, order_id FROM shipments
          WHERE tenant_id=$1 AND requires_cold_chain = true
            AND status IN ('picked_up','in_transit','at_hub','out_for_delivery')
            AND created_at >= (now() - interval '90 days')
       ), latest AS (
         SELECT l.subject_id, max(l.recorded_at) AS last_at
           FROM cold_chain_logs l
           JOIN live ON live.id = l.subject_id
          WHERE l.tenant_id=$1 AND l.subject_type='shipment'
            AND l.recorded_at >= (now() - interval '7 days')
          GROUP BY l.subject_id
       )
       SELECT live.id AS shipment_id, live.order_id,
              (SELECT temp_c FROM cold_chain_logs c
                WHERE c.tenant_id=$1 AND c.subject_type='shipment' AND c.subject_id=live.id
                  AND c.recorded_at = latest.last_at
                ORDER BY c.id DESC LIMIT 1)::text AS last_temp_c,
              latest.last_at,
              (SELECT count(*)::int FROM cold_chain_logs c2
                WHERE c2.tenant_id=$1 AND c2.subject_type='shipment' AND c2.subject_id=live.id
                  AND c2.recorded_at >= (now() - interval '7 days') AND c2.is_breach = true) AS breaches
         FROM live LEFT JOIN latest ON latest.subject_id = live.id
        ORDER BY breaches DESC NULLS LAST, latest.last_at DESC NULLS LAST
        LIMIT ${Math.max(1, Math.min(20, Math.trunc(limit)))}`, [tenantId]);
    return (r.rows as any[]).map((x) => ({
      shipmentId: x.shipment_id, orderId: x.order_id,
      lastTempC: x.last_temp_c ?? null, lastAt: iso(x.last_at), breaches: Number(x.breaches ?? 0),
    }));
  }

  /**
   * Delivery performance over the window: how many were delivered, how many took ONE attempt, and the median
   * pickup→delivery transit.
   *
   * `delivery_attempts` counts FAILED attempts (5a), so a first-attempt delivery is one with none recorded — not
   * `<= 1`, which would count a shipment that failed once and quietly turn a 60% first-attempt rate into 80%.
   * The median is `percentile_cont(0.5)`, computed in the database over the rows that HAVE a pickup stamp, with the
   * count of rows that do not returned beside it so the desk can say how much of the window it covers.
   */
  async deliveryStats(tenantId: string, windowDays: number): Promise<DeliveryStats> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS delivered,
              count(*) FILTER (WHERE coalesce(delivery_attempts,0) = 0)::int AS first_attempt,
              count(*) FILTER (WHERE picked_up_at IS NULL)::int AS missing_pickup,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (delivered_at - picked_up_at)) / 3600.0
              ) FILTER (WHERE picked_up_at IS NOT NULL) AS median_hours
         FROM shipments
        WHERE tenant_id=$1 AND status='delivered' AND delivered_at IS NOT NULL
          AND delivered_at >= (now() - ($2::int || ' days')::interval)
          AND created_at >= (now() - (($2::int + 30) || ' days')::interval)`, [tenantId, windowDays]);
    const x = (r.rows[0] ?? {}) as any;
    const median = x.median_hours == null ? null : Math.round(Number(x.median_hours) * 10) / 10;
    return {
      delivered: Number(x.delivered ?? 0),
      firstAttempt: Number(x.first_attempt ?? 0),
      medianTransitHours: median,
      missingPickupStamp: Number(x.missing_pickup ?? 0),
    };
  }

  /**
   * W244's chart: failed-delivery ATTEMPTS by coded reason, over the window.
   *
   * Counted from `shipment_events` — every attempt, not every shipment, which is why the canon's own caption says
   * "118 events". Rows with a NULL `reason_code` are returned as their own group rather than dropped: they are the
   * history this platform recorded before 0154 gave the reason a column, and the desk reports them as
   * `unclassified` (see `failureBreakdown`).
   */
  async failureReasons(tenantId: string, windowDays: number): Promise<FailureRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT reason_code, count(*)::int AS events
         FROM shipment_events
        WHERE tenant_id=$1 AND status='failed'
          AND created_at >= (now() - ($2::int || ' days')::interval)
        GROUP BY reason_code`, [tenantId, windowDays]);
    return (r.rows as any[]).map((x) => ({ reasonCode: x.reason_code ?? null, events: Number(x.events ?? 0) }));
  }

  /** The vocabulary behind those codes, so the console can name a tenant's OWN added reason rather than printing a
   *  raw code for anything it was not compiled with (Law 6: the vocabulary lives in the database). */
  async failureReasonVocabulary(tenantId: string): Promise<Array<{ code: string; name: string; sortOrder: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT code, default_name, sort_order
         FROM lookup_values
        WHERE type_code='shipment_failure_reason' AND is_active = true
          AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY sort_order, code`, [tenantId]);
    return (r.rows as any[]).map((x) => ({ code: String(x.code), name: String(x.default_name), sortOrder: Number(x.sort_order ?? 0) }));
  }

  /** Is this code real for this tenant? Used on the WRITE path, so an operator's failure reason cannot be a code
   *  nobody defined — and so a tenant's own added reason works without a deploy. */
  async isFailureReason(tenantId: string, code: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM lookup_values
        WHERE type_code='shipment_failure_reason' AND code=$2 AND is_active = true
          AND (tenant_id IS NULL OR tenant_id = $1) LIMIT 1`, [tenantId, code]);
    return r.rows.length > 0;
  }

  /**
   * W244's lanes: region pair → shipment count, over the window.
   *
   * The lane is `addresses.region_id` at each end. Shipments whose pickup or drop address is missing a region are
   * EXCLUDED and counted separately by the caller's total, because a lane with a null end is not a lane — and
   * silently bucketing them under one "unknown" pair would create a phantom busiest lane.
   */
  async lanes(tenantId: string, windowDays: number, limit: number): Promise<LaneRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT pa.region_id AS from_region_id, da.region_id AS to_region_id,
              pr.default_name AS from_name, dr.default_name AS to_name,
              count(*)::int AS shipments
         FROM shipments s
         JOIN addresses pa ON pa.id = s.pickup_address_id
         JOIN addresses da ON da.id = s.drop_address_id
         LEFT JOIN admin_regions pr ON pr.id = pa.region_id
         LEFT JOIN admin_regions dr ON dr.id = da.region_id
        WHERE s.tenant_id=$1
          AND s.created_at >= (now() - ($2::int || ' days')::interval)
          AND pa.region_id IS NOT NULL AND da.region_id IS NOT NULL
        GROUP BY pa.region_id, da.region_id, pr.default_name, dr.default_name
        ORDER BY shipments DESC
        LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}`, [tenantId, windowDays]);
    return (r.rows as any[]).map((x) => ({
      fromRegionId: x.from_region_id, toRegionId: x.to_region_id,
      fromName: x.from_name ?? null, toName: x.to_name ?? null, shipments: Number(x.shipments ?? 0),
    }));
  }

  /** How much history this tenant actually has, in days — W244's "Insights need 30+ days" state is a fact about the
   *  data, not a guess from a row count. Null when nothing has ever moved. */
  async historyDays(tenantId: string): Promise<number | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT EXTRACT(EPOCH FROM (now() - min(created_at))) / 86400.0 AS days
         FROM shipments WHERE tenant_id=$1`, [tenantId]);
    const d = (r.rows[0] as any)?.days;
    return d == null ? null : Math.floor(Number(d));
  }

  /** The next active weekly run, for W225's "Saturday Village Run loads in 5 days" and W244's route link. Reads the
   *  STATUS (0152), never the generated `is_active` — 5b proved a partial index on the generated column cannot be
   *  matched by the planner. */
  async nextWeeklyRun(tenantId: string): Promise<{ id: string; name: string; runWeekday: number | null; villages: number } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, default_name, run_weekday,
              coalesce(jsonb_array_length(village_region_ids), 0)::int AS villages
         FROM delivery_routes
        WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL
        ORDER BY run_weekday NULLS LAST, created_at
        LIMIT 1`, [tenantId]);
    const x = r.rows[0] as any;
    if (!x) return null;
    return { id: x.id, name: x.default_name, runWeekday: x.run_weekday == null ? null : Number(x.run_weekday), villages: Number(x.villages ?? 0) };
  }

  /** How many runs are committed at all — the difference between "Village Run consolidation" being a partial
   *  mechanism and being absent for this tenant. */
  async activeRouteCount(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n FROM delivery_routes WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`, [tenantId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /** Today's day-of-week as PostgreSQL sees it (0=Sunday), so "loads in 5 days" is computed against the database's
   *  clock rather than the API process's — two boxes in two zones must not disagree about which day it is. */
  async todayDow(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT EXTRACT(DOW FROM now())::int AS dow`);
    return Number((r.rows[0] as any)?.dow ?? 0);
  }

  /** Used by the export receipt: the window's own boundaries as the database resolved them, so a CSV cannot claim a
   *  range the query did not read. */
  async windowBounds(tenantId: string, windowDays: number): Promise<{ from: string; to: string }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT (now() - ($1::int || ' days')::interval)::date AS from_day, now()::date AS to_day`, [windowDays]);
    const x = (r.rows[0] ?? {}) as any;
    return { from: day(x.from_day), to: day(x.to_day) };
  }
}
