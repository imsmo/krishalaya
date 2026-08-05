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
}
