// apps/admin-api/src/modules/platform-reports/read-models/platform-reports.read-model.ts · ALL read SQL for the
// exec dashboards. CROSS-TENANT platform aggregates (admin-api kv_admin bypasses RLS — this is the god-mode
// reporting plane, not a tenant-facing query). Every figure is computed in SQL: money via SUM(...)::text (bigint
// minor units, never floated), counts via ::int. Time-windowed queries filter on created_at so PG prunes the
// PARTITIONED orders / login_events tables to the window (Law 8). No mutations.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

export type SeriesMetric = 'orders' | 'gmv_minor' | 'new_tenants' | 'new_users' | 'dbt_minor';
export type SeriesBucket = 'day' | 'week' | 'month';

/**
 * The whitelisted series, as ONE definition both callers use.
 *
 * **THE TABLE AND COLUMN ARE INTERPOLATED AND THAT IS ONLY SAFE BECAUSE THIS MAP IS FROZEN AND THE KEY IS AN ENUM.**
 * `metric` reaches here through a zod enum and `bucket` through another, so no caller-controlled string is ever
 * concatenated. Written down explicitly because the shape — string interpolation into SQL — is the shape a reviewer must
 * stop, and the reason it is acceptable here has to be legible without tracing three callers.
 */
const SERIES_SRC: Readonly<Record<SeriesMetric, { table: string; col: string; ts: string }>> = Object.freeze({
  orders: { table: 'orders', col: 'COUNT(*)::text', ts: 'created_at' },
  gmv_minor: { table: 'orders', col: 'COALESCE(SUM(total_minor),0)::text', ts: 'created_at' },
  new_tenants: { table: 'tenants', col: 'COUNT(*)::text', ts: 'created_at' },
  new_users: { table: 'users', col: 'COUNT(*)::text', ts: 'created_at' },
  dbt_minor: { table: 'dbt_transfers', col: 'COALESCE(SUM(amount_minor),0)::text', ts: 'created_at' },
});

const SERIES_ROW_CAP = 400;

function seriesSql(metric: SeriesMetric, bucket: SeriesBucket): string {
  const m = SERIES_SRC[metric];
  return `SELECT date_trunc('${bucket}', ${m.ts})::date::text AS bucket, ${m.col} AS value
            FROM ${m.table} WHERE ${m.ts} >= $1 AND ${m.ts} < $2 AND deleted_at IS NULL
           GROUP BY 1 ORDER BY 1 LIMIT ${SERIES_ROW_CAP}`;
}

// Tenant lifecycle states considered "live" for active-tenant headline counts.
const ACTIVE_TENANT_STATES = ['active', 'trial', 'grace'];

@Injectable()
export class PlatformReportsReadModel {
  constructor(private readonly pool: AdminPool) {}

  /** MRR (active+trialing subs, annual÷12 floor in SQL) + active sub count, by currency. Float-free. */
  async revenueRollup(currency: string): Promise<{ mrrMinor: string; activeSubscriptions: number }> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN billing_cycle='annual' THEN price_minor/12 ELSE price_minor END),0)::text AS mrr,
              COUNT(*)::int AS active
         FROM subscriptions WHERE status IN ('active','trialing') AND currency_code=$1 AND deleted_at IS NULL`, [currency]);
    return { mrrMinor: String(r.rows[0]?.mrr ?? '0'), activeSubscriptions: r.rows[0]?.active ?? 0 };
  }

  /** Tenant counts grouped by lifecycle status (+ a derived "active" total). */
  async tenantStatusCounts(): Promise<{ byStatus: Record<string, number>; activeTotal: number; total: number }> {
    const r = await this.pool.query(`SELECT status, COUNT(*)::int AS n FROM tenants WHERE deleted_at IS NULL GROUP BY status`);
    const byStatus: Record<string, number> = {}; let activeTotal = 0; let total = 0;
    for (const row of r.rows) { byStatus[row.status] = row.n; total += row.n; if (ACTIVE_TENANT_STATES.includes(row.status)) activeTotal += row.n; }
    return { byStatus, activeTotal, total };
  }

  /** Active users + login success in a window (partition-pruned on login_events.created_at). */
  async activeUsers(from: Date, to: Date): Promise<{ activeUsers: number; loginAttempts: number; loginSucceeded: number }> {
    const r = await this.pool.query(
      `SELECT COUNT(DISTINCT user_id) FILTER (WHERE succeeded AND user_id IS NOT NULL)::int AS active_users,
              COUNT(*)::int AS attempts,
              COUNT(*) FILTER (WHERE succeeded)::int AS succeeded
         FROM login_events WHERE created_at >= $1 AND created_at < $2`, [from.toISOString(), to.toISOString()]);
    return { activeUsers: r.rows[0]?.active_users ?? 0, loginAttempts: r.rows[0]?.attempts ?? 0, loginSucceeded: r.rows[0]?.succeeded ?? 0 };
  }

  /** GMV rollup over orders in a window (partition-pruned), excluding cancelled. Money as text minor units. */
  async gmv(from: Date, to: Date, currency: string, tenantId?: string): Promise<{ gmvMinor: string; platformFeeMinor: string; commissionMinor: string; orders: number }> {
    const params: unknown[] = [from.toISOString(), to.toISOString(), currency];
    let where = `created_at >= $1 AND created_at < $2 AND currency_code=$3 AND status <> 'cancelled'`;
    if (tenantId) { params.push(tenantId); where += ` AND tenant_id=$${params.length}`; }
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(total_minor),0)::text AS gmv, COALESCE(SUM(platform_fee_minor),0)::text AS pf,
              COALESCE(SUM(commission_minor),0)::text AS comm, COUNT(*)::int AS orders
         FROM orders WHERE ${where}`, params);
    const x = r.rows[0] ?? {};
    return { gmvMinor: String(x.gmv ?? '0'), platformFeeMinor: String(x.pf ?? '0'), commissionMinor: String(x.comm ?? '0'), orders: x.orders ?? 0 };
  }

  /** New tenants per month over a window (bounded by the window's ≤366-day cap ⇒ ≤13 buckets). */
  async tenantGrowth(from: Date, to: Date): Promise<{ period: string; newTenants: number }[]> {
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period, COUNT(*)::int AS n
         FROM tenants WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
         GROUP BY 1 ORDER BY 1`, [from.toISOString(), to.toISOString()]);
    return r.rows.map((x: any) => ({ period: x.period, newTenants: x.n }));
  }

  /** PC-54 W54-11 slice 5 `report builder` v1: a WHITELISTED metric registry (never client SQL) bucketed
   *  by day|week|month. Each metric maps to one ledgered aggregate. */
  async customSeries(metric: SeriesMetric, from: Date, to: Date, bucket: SeriesBucket) {
    const r = await this.pool.query(seriesSql(metric, bucket), [from, to]);
    return r.rows as Array<{ bucket: string; value: string }>;
  }

  /**
   * PC-56 ADMIN-10 · the same series, run on a CALLER-SUPPLIED CONNECTION.
   *
   * The builder needs `SET LOCAL statement_timeout` to apply to this query, and `SET LOCAL` only binds inside the
   * transaction it is issued in — so the timeout and the query have to share a connection. A caller that set the timeout
   * on a pool checkout and then ran the query through `this.pool.query()` would get a fresh connection with no timeout
   * and would never notice: W111's "the 60s replica limit protects everyone" would be a limit set on an idle session.
   */
  async customSeriesOn(client: PoolClient, metric: SeriesMetric, from: Date, to: Date, bucket: SeriesBucket) {
    const r = await client.query(seriesSql(metric, bucket), [from, to]);
    return r.rows as Array<{ bucket: string; value: string }>;
  }
}
