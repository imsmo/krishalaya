// modules/dairy/repositories/d2c.repository.ts · PC-54 W54-5. SQL for the D2C milk-subscription slice
// (0009: subscription_plans_d2c + d2c_subscriptions) and the per-MCC shift summary read-model over
// milk_collections (partitioned — every read pins collected_on, Law 8). Money bigint minor (Law 2).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface D2cPlan { id: string; sellerUserId: string | null; productId: string; defaultName: string; frequency: string; qtyPerDelivery: string; unitCode: string; pricePerDeliveryMinor: string; deliveryWindow: string | null; isActive: boolean }
export interface D2cSubscription { id: string; planId: string; customerUserId: string; addressId: string; status: string; startsOn: string; pausedUntil: string | null; billingMode: string }
export interface ShiftSummaryRow { shift: string; slips: number; weightKg: string; amountMinor: string; waterFlags: number }

const toPlan = (r: any): D2cPlan => ({ id: r.id, sellerUserId: r.seller_user_id, productId: r.product_id, defaultName: r.default_name, frequency: r.frequency, qtyPerDelivery: String(r.qty_per_delivery), unitCode: r.unit_code, pricePerDeliveryMinor: String(r.price_per_delivery_minor), deliveryWindow: r.delivery_window, isActive: r.is_active });
const toSub = (r: any): D2cSubscription => ({ id: r.id, planId: r.plan_id, customerUserId: r.customer_user_id, addressId: r.address_id, status: r.status, startsOn: String(r.starts_on).slice(0, 10), pausedUntil: r.paused_until ? String(r.paused_until).slice(0, 10) : null, billingMode: r.billing_mode });

@Injectable()
export class D2cRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertPlan(tx: TxContext, p: { id: string; tenantId: string; sellerUserId: string; productId: string; defaultName: string; frequency: string; qtyPerDelivery: string; unitCode: string; pricePerDeliveryMinor: string; deliveryWindow?: string }): Promise<void> {
    await tx.query(`INSERT INTO subscription_plans_d2c (id, tenant_id, seller_user_id, product_id, default_name, frequency, qty_per_delivery, unit_code, price_per_delivery_minor, delivery_window) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.tenantId, p.sellerUserId, p.productId, p.defaultName, p.frequency, p.qtyPerDelivery, p.unitCode, p.pricePerDeliveryMinor, p.deliveryWindow ?? null]);
  }
  async listPlans(tenantId: string): Promise<D2cPlan[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM subscription_plans_d2c WHERE tenant_id=$1 AND is_active=true AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [tenantId]);
    return r.rows.map(toPlan);
  }
  async getPlan(tenantId: string, id: string): Promise<D2cPlan | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM subscription_plans_d2c WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toPlan(r.rows[0]) : null;
  }
  async insertSubscription(tx: TxContext, s: { id: string; tenantId: string; planId: string; customerUserId: string; addressId: string; startsOn: string }): Promise<void> {
    await tx.query(`INSERT INTO d2c_subscriptions (id, tenant_id, plan_id, customer_user_id, address_id, starts_on) VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.id, s.tenantId, s.planId, s.customerUserId, s.addressId, s.startsOn]);
  }
  async mySubscriptions(tenantId: string, customerUserId: string): Promise<D2cSubscription[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM d2c_subscriptions WHERE tenant_id=$1 AND customer_user_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`, [tenantId, customerUserId]);
    return r.rows.map(toSub);
  }
  /** Customer-owned state change; legal transitions enforced in SQL (reflect the 0009 CHECK). */
  async setSubscriptionStatus(tx: TxContext, tenantId: string, id: string, customerUserId: string, status: 'active' | 'paused' | 'cancelled', pausedUntil?: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE d2c_subscriptions SET status=$4, paused_until=$5
        WHERE id=$1 AND tenant_id=$2 AND customer_user_id=$3 AND status != 'cancelled' AND deleted_at IS NULL`,
      [id, tenantId, customerUserId, status, pausedUntil ?? null]);
    return (r.rowCount ?? 0) > 0;
  }

  /** PC-54 W54-5 `mcc-shift-summary`: the day's totals per shift at ONE centre — aggregated from the
   *  ledgered slips (partition pinned by collected_on), never a fabricated dashboard number. */
  async shiftSummary(tenantId: string, mccId: string, date: string): Promise<ShiftSummaryRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT shift::text, COUNT(*)::int AS slips, COALESCE(SUM(weight_kg),0)::text AS weight_kg,
              COALESCE(SUM(amount_minor),0)::text AS amount_minor,
              COUNT(*) FILTER (WHERE water_flag)::int AS water_flags
         FROM milk_collections WHERE tenant_id=$1 AND mcc_id=$2 AND collected_on=$3
        GROUP BY shift ORDER BY shift`, [tenantId, mccId, date]);
    return r.rows.map((x: any) => ({ shift: x.shift, slips: x.slips, weightKg: x.weight_kg, amountMinor: x.amount_minor, waterFlags: x.water_flags }));
  }

  // ===== PC-55 A5 · delivery runs =====
  /** Active subscriptions with their plan cadence — the scheduler's input (tenant-scoped). */
  async schedulableSubscriptions(tenantId: string): Promise<Array<{ id: string; frequency: string; startsOn: string; status: string; pausedUntil: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT s.id, p.frequency, s.starts_on, s.status, s.paused_until
         FROM d2c_subscriptions s JOIN subscription_plans_d2c p ON p.id = s.plan_id
        WHERE s.tenant_id=$1 AND s.status='active' AND s.deleted_at IS NULL AND p.is_active = true AND p.deleted_at IS NULL
        LIMIT 5000`, [tenantId]);
    return r.rows.map((x: any) => ({ id: x.id, frequency: x.frequency, startsOn: String(x.starts_on).slice(0, 10), status: x.status, pausedUntil: x.paused_until ? String(x.paused_until).slice(0, 10) : null }));
  }

  /** Materialise one drop. ON CONFLICT DO NOTHING against the (subscription, due_on) unique index makes the
   *  job IDEMPOTENT: re-running the same horizon can never double-charge a household. Returns true if a NEW
   *  row was created (so the job can report honest counts). */
  async ensureDelivery(tx: TxContext, tenantId: string, subscriptionId: string, dueOn: string, qty: string | null): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO d2c_deliveries (tenant_id, subscription_id, due_on, status, qty)
       VALUES ($1,$2,$3,'scheduled',$4)
       ON CONFLICT (subscription_id, due_on) DO NOTHING`,
      [tenantId, subscriptionId, dueOn, qty]);
    return (r.rowCount ?? 0) > 0;
  }

  async lockDelivery(tx: TxContext, tenantId: string, id: string, dueOn: string) {
    const r = await tx.query<{ id: string; status: string; subscription_id: string; due_on: string }>(
      `SELECT id, status, subscription_id, due_on FROM d2c_deliveries
        WHERE id=$1 AND tenant_id=$2 AND due_on=$3 FOR UPDATE`, [id, tenantId, dueOn]);
    return r.rows[0] ?? null;
  }
  async settleDelivery(tx: TxContext, tenantId: string, id: string, dueOn: string, status: 'delivered' | 'skipped' | 'failed', qty?: string, qualityMeta?: Record<string, unknown>): Promise<void> {
    await tx.query(
      `UPDATE d2c_deliveries SET status=$4, delivered_at = CASE WHEN $4='delivered' THEN now() ELSE NULL END,
              qty = COALESCE($5, qty), quality_meta = COALESCE($6::jsonb, quality_meta)
        WHERE id=$1 AND tenant_id=$2 AND due_on=$3`,
      [id, tenantId, dueOn, status, qty ?? null, qualityMeta ? JSON.stringify(qualityMeta) : null]);
  }

  /** Delivery list. box=customer scopes to the caller's own subscriptions; box=seller to plans they own.
   *  due_on is ALWAYS bounded — the table is partitioned by it (Law 8). */
  async listDeliveries(tenantId: string, q: { box: 'customer' | 'seller' | 'all'; userId: string; from: string; to: string; status?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [tenantId, q.from, q.to];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let scope = '';
    if (q.box === 'customer') scope = ` AND s.customer_user_id = ${p(q.userId)}`;
    else if (q.box === 'seller') scope = ` AND pl.seller_user_id = ${p(q.userId)}`;
    let st = '';
    if (q.status) st = ` AND d.status = ${p(q.status)}`;
    const lim = p(Math.min(q.limit, 500));
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.id, d.subscription_id, d.due_on, d.status, d.delivered_at, d.qty::text AS qty, d.quality_meta,
              pl.default_name AS plan_name, pl.price_per_delivery_minor::text AS price_per_delivery_minor,
              pl.unit_code, s.customer_user_id, s.address_id
         FROM d2c_deliveries d
         JOIN d2c_subscriptions s ON s.id = d.subscription_id
         JOIN subscription_plans_d2c pl ON pl.id = s.plan_id
        WHERE d.tenant_id=$1 AND d.due_on >= $2::date AND d.due_on <= $3::date${scope}${st}
        ORDER BY d.due_on DESC, d.id DESC LIMIT ${lim}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, subscriptionId: x.subscription_id, dueOn: String(x.due_on).slice(0, 10), status: x.status,
      deliveredAt: x.delivered_at ? new Date(x.delivered_at).toISOString() : null, qty: x.qty,
      qualityMeta: x.quality_meta, planName: x.plan_name, pricePerDeliveryMinor: x.price_per_delivery_minor,
      unitCode: x.unit_code, customerUserId: x.customer_user_id, addressId: x.address_id,
    }));
  }

  /** MONTHLY POSTPAID STATEMENT — a LEDGERED AGGREGATE: only DELIVERED drops, priced at the plan's own
   *  per-delivery price, summed in minor units by the database. No client arithmetic, no payment side-effect. */
  async statement(tenantId: string, q: { box: 'customer' | 'seller'; userId: string; from: string; to: string }): Promise<Array<Record<string, unknown>>> {
    const scopeCol = q.box === 'customer' ? 's.customer_user_id' : 'pl.seller_user_id';
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT s.id AS subscription_id, pl.default_name AS plan_name, s.customer_user_id,
              pl.price_per_delivery_minor::text AS price_per_delivery_minor,
              COUNT(*) FILTER (WHERE d.status='delivered')::int AS delivered_count,
              COUNT(*) FILTER (WHERE d.status='skipped')::int   AS skipped_count,
              COUNT(*) FILTER (WHERE d.status='failed')::int    AS failed_count,
              (COUNT(*) FILTER (WHERE d.status='delivered') * pl.price_per_delivery_minor)::text AS total_minor
         FROM d2c_deliveries d
         JOIN d2c_subscriptions s ON s.id = d.subscription_id
         JOIN subscription_plans_d2c pl ON pl.id = s.plan_id
        WHERE d.tenant_id=$1 AND d.due_on >= $2::date AND d.due_on <= $3::date AND ${scopeCol} = $4
        GROUP BY s.id, pl.default_name, s.customer_user_id, pl.price_per_delivery_minor
        ORDER BY total_minor::numeric DESC LIMIT 500`, [tenantId, q.from, q.to, q.userId]);
    return r.rows.map((x: any) => ({
      subscriptionId: x.subscription_id, planName: x.plan_name, customerUserId: x.customer_user_id,
      pricePerDeliveryMinor: x.price_per_delivery_minor, deliveredCount: x.delivered_count,
      skippedCount: x.skipped_count, failedCount: x.failed_count, totalMinor: x.total_minor,
    }));
  }
  /** Plan qty for a subscription (the scheduler stamps the expected qty on each drop). */
  async planQtyFor(tenantId: string, subscriptionId: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT pl.qty_per_delivery::text AS qty FROM d2c_subscriptions s JOIN subscription_plans_d2c pl ON pl.id = s.plan_id
        WHERE s.id=$1 AND s.tenant_id=$2`, [subscriptionId, tenantId]);
    return r.rows[0]?.qty ?? null;
  }
}
