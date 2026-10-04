// modules/logistics/repositories/village-run.repository.ts · PC-56 TENANT-SW-e · W232 — route_drop_points, route_runs,
// parcel_handovers, parcel_handover_fees (0201) and the reads W232 prints: consolidation (13 / 32), the run's freight as billed
// on freight invoice lines, and the ambassador economics (the per-parcel fees accrued and paid). tenant_id in every query + RLS.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { pgDate } from '../../../core/database/pg-date';

/** The 13b setting (money_path, maker-checker) the per-parcel fee reads — raised to the platform floor at accrual (0201). */
export const PARCEL_FEE_SETTING = 'logistics.parcel_handover_fee_minor';
export interface PlanLine { shipmentId: string; dropPointId: string }
export interface RouteHead { id: string; tenantId: string; name: string; runWeekday: number | null; status: string; villageRegionIds: string[]; currencyCode: string | null }
export interface DropPointRow {
  id: string; routeId: string; sequence: number; regionId: string; regionName: string | null; name: string; ambassadorUserId: string;
  keeperName: string | null; keeperPhone: string | null; windowStart: string | null; windowEnd: string | null; active: boolean; deactivateReason: string | null;
}
export interface RunRow {
  id: string; tenantId: string; routeId: string; runDate: string; status: string; loadingPlan: PlanLine[]; partnerId: string | null; vehicleId: string | null;
  draftedBy: string; draftedAt: string; draftReason: string; confirmedBy: string | null; confirmedAt: string | null; loadingAt: string | null;
  departedAt: string | null; completedAt: string | null; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null; createdUs: string;
}
export interface HandoverRow {
  id: string; runId: string; shipmentId: string; dropPointId: string; handedBy: string; receivedBy: string; otpVerifiedAt: string;
  recipientUserId: string; recipientOtpVerifiedAt: string | null; status: string; collectedAt: string | null; returnedAt: string | null;
  returnReason: string | null; createdAt: string; createdUs: string; feeMinor: string | null; feeSource: string | null;
}
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const RUN_COLS = `id, tenant_id, route_id, run_date, status, loading_plan, partner_id, vehicle_id, drafted_by, drafted_at, draft_reason, confirmed_by, confirmed_at,
  loading_at, departed_at, completed_at, cancelled_by, cancelled_at, cancel_reason, ${US_SQL('created_at')} AS created_us`;
function toRun(r: any): RunRow {
  return { id: r.id, tenantId: r.tenant_id, routeId: r.route_id, runDate: pgDate(r.run_date), status: r.status, loadingPlan: r.loading_plan ?? [],
    partnerId: r.partner_id ?? null, vehicleId: r.vehicle_id ?? null, draftedBy: r.drafted_by, draftedAt: iso(r.drafted_at) as string, draftReason: r.draft_reason,
    confirmedBy: r.confirmed_by ?? null, confirmedAt: iso(r.confirmed_at), loadingAt: iso(r.loading_at), departedAt: iso(r.departed_at), completedAt: iso(r.completed_at),
    cancelledBy: r.cancelled_by ?? null, cancelledAt: iso(r.cancelled_at), cancelReason: r.cancel_reason ?? null, createdUs: r.created_us };
}

@Injectable()
export class VillageRunRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  async route(tenantId: string, routeId: string, tx?: SqlExecutor): Promise<RouteHead | null> {
    const r = await this.db(tenantId, tx).query(
      `SELECT r.id, r.tenant_id, r.default_name, r.run_weekday, r.status, r.village_region_ids, c.currency_code
         FROM delivery_routes r JOIN tenants t ON t.id = r.tenant_id LEFT JOIN countries c ON c.code = t.country_code
        WHERE r.id=$1 AND r.tenant_id=$2 AND r.deleted_at IS NULL`, [routeId, tenantId]);
    const x = r.rows[0] as any;
    return x ? { id: x.id, tenantId: x.tenant_id, name: x.default_name, runWeekday: x.run_weekday ?? null, status: x.status,
      villageRegionIds: (x.village_region_ids ?? []) as string[], currencyCode: x.currency_code ?? null } : null;
  }
  async regionNames(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, default_name FROM admin_regions WHERE id = ANY($1::uuid[])`, [[...ids]]);
    return new Map((r.rows as any[]).map((x) => [x.id, x.default_name]));
  }

  /* ── drop points ── */
  async dropPoints(tenantId: string, routeId: string, tx?: SqlExecutor): Promise<DropPointRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT d.id, d.route_id, d.sequence, d.region_id, ar.default_name AS region_name, d.name, d.ambassador_user_id, u.full_name, u.phone,
              to_char(d.window_start, 'HH24:MI') AS ws, to_char(d.window_end, 'HH24:MI') AS we, d.active, d.deactivate_reason
         FROM route_drop_points d JOIN users u ON u.id = d.ambassador_user_id LEFT JOIN admin_regions ar ON ar.id = d.region_id
        WHERE d.tenant_id=$1 AND d.route_id=$2 ORDER BY d.active DESC, d.sequence, d.created_at`, [tenantId, routeId]);
    return (r.rows as any[]).map((x) => ({ id: x.id, routeId: x.route_id, sequence: Number(x.sequence), regionId: x.region_id, regionName: x.region_name ?? null,
      name: x.name, ambassadorUserId: x.ambassador_user_id, keeperName: x.full_name ?? null, keeperPhone: x.phone ?? null,
      windowStart: x.ws ?? null, windowEnd: x.we ?? null, active: !!x.active, deactivateReason: x.deactivate_reason ?? null }));
  }
  async insertDropPoint(tx: TxContext, d: { id: string; tenantId: string; routeId: string; sequence: number; regionId: string; name: string; ambassadorUserId: string;
    windowStart: string | null; windowEnd: string | null; createdBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO route_drop_points (id, tenant_id, route_id, sequence, region_id, name, ambassador_user_id, window_start, window_end, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::time,$9::time,$10)`,
      [d.id, d.tenantId, d.routeId, d.sequence, d.regionId, d.name, d.ambassadorUserId, d.windowStart, d.windowEnd, d.createdBy]);
  }
  async deactivateDropPoint(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(`UPDATE route_drop_points SET active=false, deactivated_by=$3, deactivated_at=now(), deactivate_reason=$4, updated_at=now()
                               WHERE id=$1 AND tenant_id=$2 AND active`, [id, tenantId, by, reason]);
    return r.rowCount ?? 0;
  }
  async dropPoint(tx: SqlExecutor, tenantId: string, id: string): Promise<DropPointRow | null> {
    const r = await tx.query(`SELECT route_id FROM route_drop_points WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    const routeId = (r.rows[0] as any)?.route_id;
    if (!routeId) return null;
    return (await this.dropPoints(tenantId, routeId, tx)).find((d) => d.id === id) ?? null;
  }

  /* ── runs ── */
  async runs(tenantId: string, routeId: string, q: { cursor?: { ts: string; id: string }; limit: number }): Promise<RunRow[]> {
    const params: unknown[] = [tenantId, routeId];
    let where = `tenant_id=$1 AND route_id=$2`;
    if (q.cursor) { params.push(q.cursor.ts, q.cursor.id); where += ` AND (created_at < $3::timestamptz OR (created_at = $3::timestamptz AND id < $4::uuid))`; }
    params.push(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${RUN_COLS} FROM route_runs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params);
    return r.rows.map(toRun);
  }
  async run(tenantId: string, id: string, tx?: SqlExecutor, lock = false): Promise<RunRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${RUN_COLS} FROM route_runs WHERE id=$1 AND tenant_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, tenantId]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  async insertRun(tx: TxContext, r: { id: string; tenantId: string; routeId: string; runDate: string; plan: PlanLine[]; partnerId: string | null; vehicleId: string | null; draftedBy: string; reason: string }) {
    await tx.query(
      `INSERT INTO route_runs (id, tenant_id, route_id, run_date, loading_plan, partner_id, vehicle_id, drafted_by, draft_reason)
       VALUES ($1,$2,$3,$4::date,$5::jsonb,$6,$7,$8,$9)`,
      [r.id, r.tenantId, r.routeId, r.runDate, JSON.stringify(r.plan), r.partnerId, r.vehicleId, r.draftedBy, r.reason]);
  }
  async move(tx: TxContext, tenantId: string, id: string, to: string, by: string, reason: string | null): Promise<void> {
    const sets: Record<string, string> = {
      confirmed: `status='confirmed', confirmed_by=$3, confirmed_at=now()`,
      loading: `status='loading', loading_at=now()`,
      in_transit: `status='in_transit', departed_at=now()`,
      completed: `status='completed', completed_at=now()`,
      cancelled: `status='cancelled', cancelled_by=$3, cancelled_at=now(), cancel_reason=$4`,
    };
    const params: unknown[] = [id, tenantId];
    if (to === 'confirmed' || to === 'cancelled') params.push(by);
    if (to === 'cancelled') params.push(reason);
    await tx.query(`UPDATE route_runs SET ${sets[to]}, updated_at=now() WHERE id=$1 AND tenant_id=$2`, params);
  }

  /* ── what W232 prints ── */
  /** "Parcels consolidated N / M": M = parcels (not cancelled) bound for the route's villages, created in the run week (7 IST days
   *  ending on the run day); N = those of them on this run's plan. Pruned on shipments.created_at. */
  async consolidation(tenantId: string, routeId: string, fromInstant: string, toInstant: string, planned: readonly string[]): Promise<{ bound: number; onRunOfBound: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH v AS (SELECT (jsonb_array_elements_text(village_region_ids))::uuid AS region_id FROM delivery_routes WHERE id=$2 AND tenant_id=$1),
            b AS (SELECT s.id FROM shipments s JOIN addresses a ON a.id = s.drop_address_id JOIN v ON v.region_id = a.region_id
                   WHERE s.tenant_id=$1 AND s.status <> 'cancelled'
                     AND s.created_at >= $3::timestamptz AND s.created_at < $4::timestamptz)
       SELECT (SELECT count(*) FROM b)::int AS bound, (SELECT count(*) FROM b WHERE b.id = ANY($5::uuid[]))::int AS on_run`,
      [tenantId, routeId, fromInstant, toInstant, [...planned]]);
    return { bound: Number((r.rows[0] as any).bound), onRunOfBound: Number((r.rows[0] as any).on_run) };
  }
  /** The run's freight AS BILLED: freight invoice lines whose parcel is on this run's plan (5c), per currency. */
  async runFreight(tenantId: string, planned: readonly string[]): Promise<Array<{ currency: string; billedMinor: string; lines: number }>> {
    if (!planned.length) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT f.currency_code, coalesce(sum(l.billed_minor), 0)::text AS billed, count(*)::int AS lines
         FROM freight_invoice_lines l JOIN freight_invoices f ON f.id = l.invoice_id AND f.tenant_id = l.tenant_id
        WHERE l.tenant_id=$1 AND l.shipment_id = ANY($2::uuid[]) AND l.deleted_at IS NULL AND f.deleted_at IS NULL
        GROUP BY f.currency_code`, [tenantId, [...planned]]);
    return (r.rows as any[]).map((x) => ({ currency: x.currency_code, billedMinor: x.billed, lines: Number(x.lines) }));
  }
  /** W232 "Ambassador economics": per keeper of this route, the per-parcel fees ACCRUED (parcel_handover_fees) and how much of it
   *  SW-b's runs have PAID (the earning's payout_id is set). */
  async economics(tenantId: string, routeId: string): Promise<Array<{ ambassadorUserId: string; name: string | null; phone: string | null; parcels: number; accruedMinor: string; paidMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT f.ambassador_user_id, u.full_name, u.phone, count(*)::int AS parcels, coalesce(sum(f.amount_minor), 0)::text AS accrued,
              coalesce(sum(f.amount_minor) FILTER (WHERE e.payout_id IS NOT NULL), 0)::text AS paid
         FROM parcel_handover_fees f JOIN users u ON u.id = f.ambassador_user_id
         LEFT JOIN ambassador_earnings e ON e.id = f.earning_id AND e.tenant_id = f.tenant_id AND e.created_at >= f.accrued_at - interval '1 minute' AND e.created_at <= f.accrued_at + interval '1 minute'
        WHERE f.tenant_id=$1 AND f.route_id=$2 GROUP BY f.ambassador_user_id, u.full_name, u.phone ORDER BY u.full_name NULLS LAST`, [tenantId, routeId]);
    return (r.rows as any[]).map((x) => ({ ambassadorUserId: x.ambassador_user_id, name: x.full_name ?? null, phone: x.phone ?? null, parcels: Number(x.parcels),
      accruedMinor: x.accrued, paidMinor: x.paid }));
  }
  /** The fee in force (the database's own resolution, the one the accrual uses), the platform floor, and the cooperative's own
   *  value of `logistics.parcel_handover_fee_minor` when it set one (null = the registry default applies). */
  async feeInForce(tenantId: string): Promise<{ feeMinor: string; floorMinor: string; tenantValueMinor: string | null }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT kv_parcel_handover_fee_minor($1)::text AS fee, coalesce((kv_platform_setting('platform.parcel_handover_fee_floor_minor') #>> '{}'), '500') AS floor,
              (SELECT s.value #>> '{}' FROM tenant_settings s WHERE s.tenant_id=$1 AND s.key=$2 AND s.deleted_at IS NULL) AS tenant_value`, [tenantId, PARCEL_FEE_SETTING]);
    return { feeMinor: (r.rows[0] as any).fee, floorMinor: (r.rows[0] as any).floor, tenantValueMinor: (r.rows[0] as any).tenant_value ?? null };
  }

  /* ── handovers ── */
  async handovers(tenantId: string, runId: string, tx?: SqlExecutor): Promise<HandoverRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT h.*, ${US_SQL('h.created_at')} AS created_us, f.amount_minor::text AS fee_minor, f.fee_source
         FROM parcel_handovers h LEFT JOIN parcel_handover_fees f ON f.handover_id = h.id
        WHERE h.tenant_id=$1 AND h.run_id=$2 ORDER BY h.created_at DESC, h.id DESC LIMIT 500`, [tenantId, runId]);
    return (r.rows as any[]).map((x) => ({ id: x.id, runId: x.run_id, shipmentId: x.shipment_id, dropPointId: x.drop_point_id, handedBy: x.handed_by, receivedBy: x.received_by,
      otpVerifiedAt: iso(x.otp_verified_at) as string, recipientUserId: x.recipient_user_id, recipientOtpVerifiedAt: iso(x.recipient_otp_verified_at), status: x.status,
      collectedAt: iso(x.collected_at), returnedAt: iso(x.returned_at), returnReason: x.return_reason ?? null, createdAt: iso(x.created_at) as string, createdUs: x.created_us,
      feeMinor: x.fee_minor ?? null, feeSource: x.fee_source ?? null }));
  }
  async handover(tx: SqlExecutor, tenantId: string, id: string, lock = false): Promise<HandoverRow | null> {
    const r = await tx.query(`SELECT run_id FROM parcel_handovers WHERE id=$1 AND tenant_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, tenantId]);
    const runId = (r.rows[0] as any)?.run_id;
    if (!runId) return null;
    return (await this.handovers(tenantId, runId, tx)).find((h) => h.id === id) ?? null;
  }
  async handoverFor(tx: SqlExecutor, tenantId: string, runId: string, shipmentId: string): Promise<HandoverRow | null> {
    const r = await tx.query(`SELECT id FROM parcel_handovers WHERE tenant_id=$1 AND run_id=$2 AND shipment_id=$3`, [tenantId, runId, shipmentId]);
    const id = (r.rows[0] as any)?.id;
    return id ? this.handover(tx, tenantId, id) : null;
  }
  async insertHandover(tx: TxContext, h: { id: string; tenantId: string; runId: string; shipmentId: string; dropPointId: string; handedBy: string; receivedBy: string; recipientUserId: string }) {
    await tx.query(
      `INSERT INTO parcel_handovers (id, tenant_id, run_id, shipment_id, drop_point_id, handed_by, received_by, otp_verified_at, recipient_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)`, [h.id, h.tenantId, h.runId, h.shipmentId, h.dropPointId, h.handedBy, h.receivedBy, h.recipientUserId]);
  }
  async collect(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE parcel_handovers SET status='collected', recipient_otp_verified_at=now(), collected_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  }
  async returnParcel(tx: TxContext, tenantId: string, id: string, reason: string): Promise<void> {
    await tx.query(`UPDATE parcel_handovers SET status='returned', returned_at=now(), return_reason=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, reason]);
  }
  /** The member who collects (the order's buyer) and the parcel's AWB, for the handover screens. */
  async parcelRecipient(tx: SqlExecutor, tenantId: string, shipmentId: string): Promise<{ buyerUserId: string; phone: string; language: string; awb: string | null } | null> {
    const r = await tx.query(
      `SELECT o.buyer_user_id, u.phone, u.language_code, s.awb_no FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id JOIN users u ON u.id = o.buyer_user_id
        WHERE s.id=$1 AND s.tenant_id=$2`, [shipmentId, tenantId]);
    const x = r.rows[0] as any;
    return x ? { buyerUserId: x.buyer_user_id, phone: x.phone, language: x.language_code, awb: x.awb_no ?? null } : null;
  }
  async userPhone(tx: SqlExecutor, userId: string): Promise<{ phone: string; language: string } | null> {
    const r = await tx.query(`SELECT phone, language_code FROM users WHERE id=$1`, [userId]);
    const x = r.rows[0] as any;
    return x ? { phone: x.phone, language: x.language_code } : null;
  }
  /** Who may hand parcels over on this run: the run's carrier is a rider → that rider; otherwise a logistics manager (checked by the caller). */
  async runRider(tx: SqlExecutor, tenantId: string, partnerId: string | null): Promise<string | null> {
    if (!partnerId) return null;
    const r = await tx.query(`SELECT rider_user_id FROM logistics_partners WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`, [partnerId, tenantId]);
    return (r.rows[0] as any)?.rider_user_id ?? null;
  }
  /** Open parcels bound for the route's villages, for the loading-plan form (W2814): newest first, bounded. */
  async candidateParcels(tenantId: string, routeId: string): Promise<Array<{ shipmentId: string; awb: string | null; regionId: string; status: string; createdAt: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH v AS (SELECT (jsonb_array_elements_text(village_region_ids))::uuid AS region_id FROM delivery_routes WHERE id=$2 AND tenant_id=$1)
       SELECT s.id, s.awb_no, a.region_id, s.status, s.created_at FROM shipments s JOIN addresses a ON a.id = s.drop_address_id JOIN v ON v.region_id = a.region_id
        WHERE s.tenant_id=$1 AND s.status NOT IN ('delivered', 'cancelled', 'returned') AND s.created_at >= now() - interval '60 days' AND s.created_at <= now()
        ORDER BY s.created_at DESC LIMIT 200`, [tenantId, routeId]);
    return (r.rows as any[]).map((x) => ({ shipmentId: x.id, awb: x.awb_no ?? null, regionId: x.region_id, status: x.status, createdAt: iso(x.created_at) as string }));
  }
}
