// modules/orders/read-models/order-console.read-model.ts · W133's working views + W134's timeline and money box
// (PC-56 TENANT-3a). Replica-backed, tenant-scoped (Law 1), keyset only — the canon's "1 2 3 … 176" pager would
// need the COUNT(*) that takes a 4,459-row list down at scale, so the VIEW COUNTS are the honest totals instead
// (the roster rule, third application).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { ORDER_VIEWS, OrderView, statusesInView, viewOfStatus } from '../domain/order-money';

export interface ConsoleOrderRow {
  id: string; orderNo: string; status: string; totalMinor: string; currencyCode: string;
  buyerUserId: string; buyerName: string | null; sellerUserId: string; sellerName: string | null;
  itemSummary: string | null; createdAt: string; updatedAt: string;
  acceptanceDeadline: string | null; disputeId: string | null;
}

export interface TimelineEvent { fromStatus: string | null; toStatus: string; note: string | null; actorUserId: string | null; actorName: string | null; at: string }

@Injectable()
export class OrderConsoleReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** W133's five tabs. One GROUP BY over the tenant's orders, then folded through the ONE status→view mapping
   *  (domain/order-money.ts) — a status the mapping does not know is counted as `unmapped` and SAID, never
   *  silently dropped: an order that appears in no tab is an order nobody works. */
  async viewCounts(tenantId: string): Promise<Record<OrderView, number> & { all: number; unmapped: number }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM orders WHERE tenant_id = $1 GROUP BY status`, [tenantId]);
    const out = Object.fromEntries(ORDER_VIEWS.map((v) => [v, 0])) as Record<OrderView, number> & { all: number; unmapped: number };
    out.all = 0; out.unmapped = 0;
    for (const row of r.rows) {
      const v = viewOfStatus(row.status);
      if (v) out[v] += row.n; else out.unmapped += row.n;
      out.all += row.n;
    }
    return out;
  }

  /** The staff worklist: every party's orders in this tenant, one working view at a time, keyset on
   *  (created_at, id) — which also prunes the recent partitions (Law 8). Names joined for the two columns the
   *  canon shows; the primary line item summarised from order_items. */
  async list(tenantId: string, q: { view?: OrderView; cursor?: { c: string; id: string } | null; limit: number }): Promise<ConsoleOrderRow[]> {
    const limit = Math.min(Math.max(q.limit, 1), 100);
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `o.tenant_id = $1`;
    if (q.view) {
      const statuses = statusesInView(q.view);
      where += ` AND o.status = ANY(${p(statuses)}::order_status[])`;
    }
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (o.created_at < ${cc} OR (o.created_at = ${cc} AND o.id < ${ci}))`; }
    const lp = p(limit);
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT o.id, o.order_no AS "orderNo", o.status, o.total_minor::text AS "totalMinor", o.currency_code AS "currencyCode",
              o.buyer_user_id AS "buyerUserId", bu.full_name AS "buyerName",
              o.seller_user_id AS "sellerUserId", su.full_name AS "sellerName",
              o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.acceptance_deadline AS "acceptanceDeadline",
              (SELECT d.id FROM disputes d
                WHERE d.order_id = o.id AND d.tenant_id = o.tenant_id AND d.deleted_at IS NULL
                  AND d.status NOT IN ('resolved', 'rejected', 'withdrawn')
                ORDER BY d.created_at DESC LIMIT 1) AS "disputeId",
              (SELECT string_agg(x.s, ', ') FROM (
                 SELECT concat_ws(' ', oi.quantity::text, oi.unit_code, pr.default_name) AS s
                   FROM order_items oi LEFT JOIN products pr ON pr.id = oi.product_id
                  WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    AND oi.order_created_at = o.created_at        -- locate the parent partition (Law 8)
                  ORDER BY oi.created_at LIMIT 2) x) AS "itemSummary"
         FROM orders o
         LEFT JOIN users bu ON bu.id = o.buyer_user_id
         LEFT JOIN users su ON su.id = o.seller_user_id
        WHERE ${where}
        ORDER BY o.created_at DESC, o.id DESC LIMIT ${lp}`, params);
    return r.rows;
  }

  /** W134's timeline: order_events — every state hop, recorded since 0005 and read by no tenant surface until
   *  this wave (the tracking read-model reads it for a SHIPMENT view only). Oldest-last so the newest hop is
   *  first, the way the canon draws it. */
  async timeline(tenantId: string, orderId: string, createdAt: Date, limit = 50): Promise<TimelineEvent[]> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT e.from_status AS "fromStatus", e.to_status AS "toStatus", e.note, e.actor_user_id AS "actorUserId",
              u.full_name AS "actorName", e.created_at AS at
         FROM order_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.tenant_id = $1 AND e.order_id = $2
          AND e.created_at >= $3::timestamptz - interval '1 day'
        ORDER BY e.created_at DESC LIMIT $4`,
      [tenantId, orderId, createdAt, Math.min(Math.max(limit, 1), 200)]);
    return r.rows;
  }

  /** The money row + its frozen basis. Read straight from the order (no recomputation — that is the whole point). */
  async money(tenantId: string, orderId: string): Promise<{
    subtotalMinor: string; deliveryFeeMinor: string; discountMinor: string; taxMinor: string;
    commissionMinor: string; platformFeeMinor: string; tdsMinor: string; totalMinor: string;
    commissionRuleSnapshot: unknown | null; currencyCode: string;
  } | null> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT subtotal_minor::text AS "subtotalMinor", delivery_fee_minor::text AS "deliveryFeeMinor",
              discount_minor::text AS "discountMinor", tax_minor::text AS "taxMinor",
              commission_minor::text AS "commissionMinor", platform_fee_minor::text AS "platformFeeMinor",
              tds_minor::text AS "tdsMinor", total_minor::text AS "totalMinor",
              commission_rule_snapshot AS "commissionRuleSnapshot", currency_code AS "currencyCode"
         FROM orders
        WHERE tenant_id = $1 AND id = $2
          -- Law 8: prune to the partition the v7 id's embedded time points at (clock-skew tolerant).
          AND created_at >= uuid_v7_time($2) - interval '5 seconds'
          AND created_at <  uuid_v7_time($2) + interval '5 seconds'
        LIMIT 1`, [tenantId, orderId]);
    return r.rows[0] ?? null;
  }
}
