// modules/tenancy/repositories/subscription.repository.ts
// SQL for tenant subscriptions. tenant_id in EVERY query (Law 1) + RLS. No version column → mutations
// lock the row FOR UPDATE. Reads on the replica; the expiry job uses SKIP LOCKED. Also reads
// usage_counters for the current-period dashboard.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Subscription } from '../domain/subscription.entity';
import { SubscriptionStatus } from '../domain/subscription.state';
import { BillingCycle } from '../domain/tenancy.events';

const COLS = `id, tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, discount_pct, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, grace_until, grace_started_at, created_at`;
function toDomain(r: any): Subscription {
  return Subscription.rehydrate({
    id: r.id, tenantId: r.tenant_id, planId: r.plan_id, status: r.status as SubscriptionStatus, billingCycle: r.billing_cycle as BillingCycle,
    priceMinor: BigInt(r.price_minor), currencyCode: r.currency_code, discountPct: Number(r.discount_pct), currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end, cancelledAt: r.cancelled_at, createdAt: r.created_at,
    // PC-56 TENANT-4d-4 · the grace window (0148). `grace_until` is a DATE and is carried as YYYY-MM-DD so
    // whole-day arithmetic never passes through a timezone.
    graceUntil: r.grace_until ? (r.grace_until instanceof Date ? r.grace_until.toISOString().slice(0, 10) : String(r.grace_until)) : null,
    graceStartedAt: r.grace_started_at ?? null,
  });
}

@Injectable()
export class SubscriptionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, s: Subscription): Promise<void> {
    const v = s.toProps();
    await tx.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, discount_pct, current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [v.id, v.tenantId, v.planId, v.status, v.billingCycle, v.priceMinor.toString(), v.currencyCode, v.discountPct, v.currentPeriodStart, v.currentPeriodEnd, v.cancelAtPeriodEnd]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Subscription | null> {
    const r = await tx.query(`SELECT ${COLS} FROM subscriptions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Subscription | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM subscriptions WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The tenant's current LIVE subscription (trialing|active|past_due|paused), if any. */
  async findLiveForTenant(tx: TxContext | null, tenantId: string): Promise<Subscription | null> {
    const sql = `SELECT ${COLS} FROM subscriptions WHERE tenant_id=$1 AND status IN ('trialing','active','past_due','paused') ORDER BY created_at DESC LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, s: Subscription): Promise<void> {
    const v = s.toProps();
    await tx.query(
      // PC-56 TENANT-4d-4: `current_period_start` and the two grace columns are written HERE now. The start
      // was previously never updated by anything, because nothing ever rolled a period (0148 defect 1) — a
      // roll that moved only the end would silently stretch every period instead of advancing it.
      `UPDATE subscriptions SET plan_id=$3, status=$4, price_minor=$5, current_period_start=$6, current_period_end=$7,
         cancel_at_period_end=$8, cancelled_at=$9, grace_until=$10::date, grace_started_at=$11, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [v.id, v.tenantId, v.planId, v.status, v.priceMinor.toString(), v.currentPeriodStart, v.currentPeriodEnd,
       v.cancelAtPeriodEnd, v.cancelledAt, v.graceUntil, v.graceStartedAt]);
  }
  async listFor(tenantId: string, q: { allTenants?: boolean; status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<Subscription[]> {
    const params: unknown[] = [];
    let where = q.allTenants ? `1=1` : `tenant_id=${(params.push(tenantId), '$1')}`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM subscriptions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** Worker finder (cross-tenant; kv_relay). Bounded + SKIP LOCKED; live subscriptions past period end. */
  async findDueToExpire(tx: TxContext, now: Date, limit: number): Promise<Subscription[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM subscriptions WHERE status IN ('trialing','active','past_due','paused') AND current_period_end < $1::date
        ORDER BY current_period_end LIMIT $2 FOR UPDATE SKIP LOCKED`, [now, limit]);
    return r.rows.map(toDomain);
  }
  /** Renewal-run finder (cross-tenant): ACTIVE, not cancel-at-period-end, whose period ends on/before `through`. */
  async findDueToRenew(tx: TxContext, through: Date, limit: number): Promise<Subscription[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM subscriptions WHERE status='active' AND cancel_at_period_end = false AND current_period_end <= $1::date
        ORDER BY current_period_end LIMIT $2`, [through, limit]);
    return r.rows.map(toDomain);
  }
  /**
   * PC-56 TENANT-4d-4 · the billing-cycle sweep's finder: live subscriptions at/after their period end,
   * **with how much each still OWES** across its issued/part-paid/overdue invoices.
   *
   * The owing figure is the whole reason this is one query rather than the old `findDueToExpire` plus a
   * guess: a subscription whose invoices are settled must NOT be expired just because nothing rolled its
   * period (0148 defect 1), and the only way the sweep can know that is to be told. Cross-tenant by design
   * (kv_relay), bounded, and `FOR UPDATE SKIP LOCKED` on the subscription rows so two ticks never fight.
   */
  async findPeriodEndedWithDebt(tx: TxContext, now: Date, limit: number): Promise<Array<{ sub: Subscription; owingMinor: bigint }>> {
    const r = await tx.query(
      `SELECT ${COLS.split(',').map((c) => `s.${c.trim()}`).join(', ')},
              COALESCE((SELECT SUM(i.total_minor - i.paid_minor)
                          FROM saas_invoices i
                         WHERE i.subscription_id = s.id
                           AND i.deleted_at IS NULL
                           AND i.status IN ('issued','partially_paid','overdue')
                           AND i.total_minor > i.paid_minor), 0)::text AS owing_minor
         FROM subscriptions s
        WHERE s.status IN ('trialing','active','past_due','paused')
          AND s.current_period_end <= $1
          AND s.deleted_at IS NULL
        ORDER BY s.current_period_end
        LIMIT $2
        FOR UPDATE OF s SKIP LOCKED`, [now, limit]);
    return r.rows.map((x: any) => ({ sub: toDomain(x), owingMinor: BigInt(x.owing_minor) }));
  }

  /** Trial-expiry finder (cross-tenant): trialing subscriptions whose trial ends on/before `through`. */
  async findTrialsEnding(tx: TxContext, through: Date, limit: number): Promise<Subscription[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM subscriptions WHERE status='trialing' AND current_period_end <= $1::date
        ORDER BY current_period_end LIMIT $2`, [through, limit]);
    return r.rows.map(toDomain);
  }
  /** Current-month usage for the tenant (mirror of plan_limits codes) — the quota dashboard. */
  async readUsage(tenantId: string): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT metric_code, used_value FROM usage_counters WHERE tenant_id=$1 AND period = date_trunc('month', now())::date`, [tenantId]);
    const m: Record<string, number> = {};
    for (const x of r.rows) m[x.metric_code] = Number(x.used_value);
    return m;
  }
}
