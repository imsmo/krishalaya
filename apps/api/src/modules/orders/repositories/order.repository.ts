// modules/orders/repositories/order.repository.ts
// orders/order_items/order_events are PARTITIONED by created_at (PK includes created_at).
// CRITICAL (Law 8): every point lookup derives created_at from the v7 id via uuid_v7_time()
// so PostgreSQL prunes to ONE partition instead of scanning all of them. Writes are
// optimistic-locked by `version`. tenant_id in every query (Law 1) + RLS is the net.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Order, OrderProps } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { OrderStatus } from '../domain/order.state';

const COLS = `id, tenant_id, order_no, checkout_group_id, buyer_user_id, seller_user_id, source, offer_id, requirement_id, currency_code,
  subtotal_minor, delivery_fee_minor, discount_minor, tax_minor, commission_minor, platform_fee_minor, tds_minor,
  total_minor, status, delivery_method_id, delivery_address_id, acceptance_deadline, quality_window_ends,
  cancel_reason_id, cancelled_by, version, created_at, completed_at`;
// partition-prune window around the v7 id's embedded time (clock skew tolerant)
const PRUNE = `created_at >= uuid_v7_time($1) - interval '5 seconds' AND created_at < uuid_v7_time($1) + interval '5 seconds'`;
const big = (v: any) => BigInt(v);
function toDomain(r: any): Order {
  return Order.rehydrate({ id: r.id, tenantId: r.tenant_id, orderNo: r.order_no, checkoutGroupId: r.checkout_group_id,
    buyerUserId: r.buyer_user_id, sellerUserId: r.seller_user_id, source: r.source, offerId: r.offer_id ?? null, requirementId: r.requirement_id ?? null, currencyCode: r.currency_code,
    subtotalMinor: big(r.subtotal_minor), deliveryFeeMinor: big(r.delivery_fee_minor), discountMinor: big(r.discount_minor),
    taxMinor: big(r.tax_minor), commissionMinor: big(r.commission_minor), platformFeeMinor: big(r.platform_fee_minor),
    tdsMinor: big(r.tds_minor), totalMinor: big(r.total_minor), status: r.status as OrderStatus,
    deliveryMethodId: r.delivery_method_id, deliveryAddressId: r.delivery_address_id, acceptanceDeadline: r.acceptance_deadline,
    qualityWindowEnds: r.quality_window_ends, cancelReasonId: r.cancel_reason_id, cancelledBy: r.cancelled_by,
    version: r.version, createdAt: r.created_at, completedAt: r.completed_at });
}

@Injectable()
export class OrderRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert order header + items + the initial 'created' timeline event, all in the caller's tx. */
  async insertGraph(tx: TxContext, order: Order, items: OrderItem[]): Promise<void> {
    const p = order.toProps();
    await tx.query(
      // S6 device-test fix: the column list named offer_id/requirement_id TWICE (after `source` AND
      // at the end) with only 24 placeholders — Postgres threw "column offer_id specified more than
      // once", so API checkout NEVER succeeded. The params map offer_id/requirement_id to $23/$24,
      // so the correct 24-column list carries them ONLY at the end (matching the params order).
      `INSERT INTO orders (id, tenant_id, order_no, checkout_group_id, buyer_user_id, seller_user_id, source, currency_code,
        subtotal_minor, delivery_fee_minor, discount_minor, tax_minor, commission_minor, platform_fee_minor, tds_minor,
        total_minor, status, delivery_method_id, delivery_address_id, acceptance_deadline, version, created_at, offer_id, requirement_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [p.id, p.tenantId, p.orderNo, p.checkoutGroupId, p.buyerUserId, p.sellerUserId, p.source, p.currencyCode,
       p.subtotalMinor.toString(), p.deliveryFeeMinor.toString(), p.discountMinor.toString(), p.taxMinor.toString(),
       p.commissionMinor.toString(), p.platformFeeMinor.toString(), p.tdsMinor.toString(), p.totalMinor.toString(),
       p.status, p.deliveryMethodId, p.deliveryAddressId, p.acceptanceDeadline, p.version, p.createdAt, p.offerId, p.requirementId]);
    for (const it of items) {
      const v = it.props;
      await tx.query(
        `INSERT INTO order_items (id, order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot,
          quantity, unit_code, unit_price_minor, line_total_minor, gst_rate_pct, hsn_code, batch_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())`,
        [uuidv7(), v.orderId, v.orderCreatedAt, v.tenantId, v.listingId, v.productId, v.titleSnapshot, v.quantity,
         v.unitCode, v.unitPriceMinor.toString(), v.lineTotalMinor.toString(), v.gstRatePct, v.hsnCode, v.batchId]);
    }
    await this.recordEvent(tx, p.tenantId, p.id, null, p.status, p.buyerUserId, 'order placed');
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Order | null> {
    const r = await tx.query(`SELECT ${COLS} FROM orders WHERE id=$1 AND tenant_id=$2 AND ${PRUNE} FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Idempotency guard for the order-from-offer handler: has an order already been created for this
   *  accepted offer? (Uses idx_orders_offer; cross-partition by design — a rare, bounded lookup.) */
  async existsForOffer(tx: TxContext, tenantId: string, offerId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM orders WHERE tenant_id=$1 AND offer_id=$2 LIMIT 1`, [tenantId, offerId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Idempotency guard for the order-from-requirement handler: has an order already been created for
   *  this accepted requirement? (Uses idx_orders_requirement; cross-partition by design, bounded.) */
  async existsForRequirement(tx: TxContext, tenantId: string, requirementId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM orders WHERE tenant_id=$1 AND requirement_id=$2 LIMIT 1`, [tenantId, requirementId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Visible to buyer or seller only (no cross-party / cross-tenant peeking). */
  async getVisible(tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Order | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM orders WHERE id=$1 AND tenant_id=$2 AND ${PRUNE}
         AND ($3 = true OR buyer_user_id=$4 OR seller_user_id=$4)`, [id, tenantId, canModerate, viewerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Optimistic-locked update (version). 0 rows ⇒ concurrent modification. Records the timeline event. */
  async update(tx: TxContext, order: Order, fromStatus: OrderStatus): Promise<boolean> {
    const p = order.toProps();
    const r = await tx.query(
      `UPDATE orders SET status=$4, quality_window_ends=$5, cancel_reason_id=$6, cancelled_by=$7, completed_at=$8,
         version=version+1, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND created_at=$3 AND version=$9`,
      [p.id, p.tenantId, p.createdAt, p.status, p.qualityWindowEnds, p.cancelReasonId, p.cancelledBy, p.completedAt, p.version]);
    if (r.rowCount === 0) return false;
    if (fromStatus !== p.status) await this.recordEvent(tx, p.tenantId, p.id, fromStatus, p.status, p.cancelledBy ?? null, null);
    return true;
  }
  async recordEvent(tx: TxContext, tenantId: string, orderId: string, from: OrderStatus | null, to: OrderStatus, actor: string | null, note: string | null): Promise<void> {
    await tx.query(
      `INSERT INTO order_events (id, tenant_id, order_id, from_status, to_status, actor_user_id, note) VALUES (uuid_generate_v7(),$1,$2,$3,$4,$5,$6)`,
      [tenantId, orderId, from, to, actor, note]);
  }

  /** Cursor list for buyer/seller history (keyset on created_at,id — prunes recent partitions). */
  /** DELTA-069 (DEV-50): userId=null = moderator-scoped TENANT-WIDE list (canon 547's
   *  tenant-owner worklist) — mirrors the pattern stats()/getById() already use
   *  (sellerUserId: canModerate ? null : ctx.userId). RLS still scopes to the tenant;
   *  the caller (controller) enforces canModerateOrder before ever passing null. */
  async listFor(tenantId: string, party: 'buyer' | 'seller', userId: string | null, opts: { status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<Order[]> {
    const col = party === 'buyer' ? 'buyer_user_id' : 'seller_user_id';
    const params: unknown[] = userId === null ? [tenantId] : [tenantId, userId];
    let where = userId === null ? `tenant_id=$1` : `tenant_id=$1 AND ${col}=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.status) where += ` AND status=${p(opts.status)}`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM orders WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** Worker finder: orders in `statuses` whose `deadlineCol` has passed. Bounds the scan to
   *  recent partitions (created_at > now - 60d) and locks rows for the worker (SKIP LOCKED). */
  async findDue(tx: TxContext, tenantId: string, statuses: string[], deadlineCol: 'acceptance_deadline' | 'quality_window_ends', now: Date, limit: number): Promise<Order[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM orders
        WHERE tenant_id=$1 AND status = ANY($2) AND ${deadlineCol} IS NOT NULL AND ${deadlineCol} < $3
          AND created_at > now() - interval '60 days'
        ORDER BY created_at ASC LIMIT $4 FOR UPDATE SKIP LOCKED`,
      [tenantId, statuses, now, limit]);
    return r.rows.map(toDomain);
  }

  /** The PRIMARY line item (first by creation) + total item count for a page of orders — enriches the order-list
   *  read-model with a crop title + qty (screen 56). `refs` carry each order's createdAt so we bound the scan to
   *  the page's partition window (Law 8) instead of scanning every order_items partition. Bounded by the page. */
  async primaryItemsFor(tenantId: string, refs: { id: string; createdAt: Date | string }[]): Promise<Map<string, { title: string; quantity: number; unitCode: string; itemCount: number }>> {
    const out = new Map<string, { title: string; quantity: number; unitCode: string; itemCount: number }>();
    if (refs.length === 0) return out;
    const ids = refs.map((r) => r.id);
    const minCreated = refs.reduce((m, r) => { const d = new Date(r.createdAt); return d < m ? d : m; }, new Date(refs[0].createdAt));
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT order_id, title_snapshot, quantity::float8 AS quantity, unit_code, cnt FROM (
         SELECT order_id, title_snapshot, quantity, unit_code,
           row_number() OVER (PARTITION BY order_id ORDER BY created_at ASC, id ASC) AS rn,
           count(*)     OVER (PARTITION BY order_id) AS cnt
         FROM order_items
         WHERE tenant_id=$1 AND order_id = ANY($2) AND order_created_at >= $3::timestamptz - interval '5 seconds' /* S6 device-test fix: uncast param was inferred as interval → 'timestamptz >= interval' 500 */
       ) s WHERE rn = 1`,
      [tenantId, ids, minCreated]);
    for (const row of r.rows) out.set(row.order_id, { title: row.title_snapshot, quantity: Number(row.quantity), unitCode: row.unit_code, itemCount: Number(row.cnt) });
    return out;
  }

  /** Buyer trust summary for the seller's accept/reject decision (screen 57): how many orders this buyer has
   *  placed (total + completed) in this tenant. tenant-scoped counts only — no PII. */
  async buyerOrderCounts(tenantId: string, buyerUserId: string): Promise<{ ordersAsBuyer: number; completedAsBuyer: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='completed')::int AS completed
         FROM orders WHERE tenant_id=$1 AND buyer_user_id=$2`, [tenantId, buyerUserId]);
    return { ordersAsBuyer: r.rows[0]?.total ?? 0, completedAsBuyer: r.rows[0]?.completed ?? 0 };
  }

  async itemsOf(tenantId: string, orderId: string): Promise<any[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT listing_id, product_id, title_snapshot, quantity, delivered_quantity, unit_code, unit_price_minor, line_total_minor, gst_rate_pct, batch_id
         FROM order_items WHERE tenant_id=$1 AND order_id=$2 AND order_created_at >= uuid_v7_time($2) - interval '5 seconds' AND order_created_at < uuid_v7_time($2) + interval '5 seconds'`,
      [tenantId, orderId]);
    return r.rows.map((x) => ({ ...x, unit_price_minor: String(x.unit_price_minor), line_total_minor: String(x.line_total_minor) }));
  }
}
