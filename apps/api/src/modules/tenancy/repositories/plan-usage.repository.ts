// modules/tenancy/repositories/plan-usage.repository.ts · the readings behind W118's meters
// (PC-56 TENANT-4d-1). Every query is tenant-scoped in its own predicate as well as by RLS.
//
// STOCKS ARE COUNTED LIVE, FLOWS COME FROM `usage_counters`. See domain/plan-usage.ts: a stock accumulated
// into a monthly counter drifts the moment one is removed, and the drift is invisible on the screen.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { STAFF_SEAT_ROLES } from '../domain/plan-usage';

@Injectable()
export class PlanUsageRepository {
  constructor(private readonly pools: PgPoolProvider) {}

  /** The tenant's live member count: distinct PEOPLE with a live role in this tenant. Counted from the
   *  roster itself, so removing a member lowers the meter — which a monthly counter could never do. */
  async memberCount(tenantId: string): Promise<number> {
    const r = await this.pools.replica(0).query<{ n: string }>(
      `SELECT count(DISTINCT utr.user_id)::text AS n
         FROM user_tenant_roles utr
        WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL AND utr.is_active = true`,
      [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** The same count inside the caller's transaction — used by the addition gate, so the number the refusal
   *  is based on is the number as of the write, not as of a replica read seconds earlier. */
  async memberCountForUpdate(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query<{ n: string }>(
      `SELECT count(DISTINCT utr.user_id)::text AS n
         FROM user_tenant_roles utr
        WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL AND utr.is_active = true`,
      [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Staff seats: people holding a role the product sells as a SEAT (domain/plan-usage's registry, because
   *  `roles` has no column for it). A person holding two staff roles is ONE seat. */
  async staffSeatCount(tenantId: string): Promise<number> {
    const r = await this.pools.replica(0).query<{ n: string }>(
      `SELECT count(DISTINCT utr.user_id)::text AS n
         FROM user_tenant_roles utr
         JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL AND utr.is_active = true
              AND r.code = ANY($2::text[])`,
      [tenantId, [...STAFF_SEAT_ROLES]]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** The limits the tenant's CURRENT plan defines, by limit code. A metric with no row here is unpriced —
   *  which the meter reports as `not_measured`, never as unlimited headroom. */
  async planLimits(tenantId: string): Promise<{ planId: string | null; planName: string | null; planVersion: number | null; status: string | null; limits: Record<string, number> }> {
    const r = await this.pools.replica(0).query<{ plan_id: string; plan_name: string; version: number; status: string; limit_code: string | null; limit_value: string | null }>(
      `SELECT p.id::text AS plan_id, p.default_name AS plan_name, p.version, s.status::text AS status,
              pl.limit_code, pl.limit_value::text AS limit_value
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         LEFT JOIN plan_limits pl ON pl.plan_id = p.id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
              AND s.status IN ('trialing','active','past_due','paused')
        ORDER BY s.created_at DESC`,
      [tenantId]);
    if (r.rows.length === 0) return { planId: null, planName: null, planVersion: null, status: null, limits: {} };
    const head = r.rows[0];
    const limits: Record<string, number> = {};
    for (const x of r.rows) if (x.limit_code) limits[x.limit_code] = Number(x.limit_value);
    return { planId: head.plan_id, planName: head.plan_name, planVersion: Number(head.version), status: head.status, limits };
  }

  /** The tenant's plan limits inside a transaction — the addition gate reads the limit and the count in the
   *  same tx, so a plan change mid-write cannot make the refusal cite a limit that no longer applies. */
  async planLimitForUpdate(tx: TxContext, tenantId: string, limitCode: string): Promise<{ limitValue: number | null; status: string | null }> {
    const r = await tx.query<{ limit_value: string | null; status: string }>(
      `SELECT pl.limit_value::text AS limit_value, s.status::text AS status
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         LEFT JOIN plan_limits pl ON pl.plan_id = p.id AND pl.limit_code = $2
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
              AND s.status IN ('trialing','active','past_due','paused')
        ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId, limitCode]);
    const row = r.rows[0];
    if (!row) return { limitValue: null, status: null };
    return { limitValue: row.limit_value === null ? null : Number(row.limit_value), status: row.status };
  }

  /** Monthly FLOW counters for this tenant (the only thing `usage_counters` models honestly). */
  async flowCounters(tenantId: string): Promise<Record<string, number>> {
    const r = await this.pools.replica(0).query<{ metric_code: string; used_value: string }>(
      `SELECT metric_code, used_value::text AS used_value FROM usage_counters
        WHERE tenant_id = $1 AND period = date_trunc('month', now())::date`, [tenantId]);
    const out: Record<string, number> = {};
    for (const x of r.rows) out[x.metric_code] = Number(x.used_value);
    return out;
  }

  /** Month-end member counts for W118's projection. Derived from when each person's role was created, so it
   *  is a real history rather than a stored series nobody maintains — and it can only ever be as good as the
   *  roster, which is the point: no separate copy to drift. */
  async memberHistory(tenantId: string, months = 6): Promise<Array<{ month: string; value: number }>> {
    const r = await this.pools.replica(0).query<{ month: string; value: string }>(
      `WITH months AS (
         SELECT to_char(d, 'YYYY-MM') AS month, (date_trunc('month', d) + interval '1 month') AS upto
           FROM generate_series(date_trunc('month', now()) - ($2::int - 1) * interval '1 month',
                                date_trunc('month', now()), interval '1 month') d)
       SELECT m.month,
              (SELECT count(DISTINCT utr.user_id) FROM user_tenant_roles utr
                WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL AND utr.created_at < m.upto)::text AS value
         FROM months m ORDER BY m.month`,
      [tenantId, months]);
    return r.rows.map((x) => ({ month: x.month, value: Number(x.value) }));
  }

  /** The tenant's alert threshold (0145's setting), raw — the domain decides what a malformed value means. */
  async alertThresholdSetting(tenantId: string): Promise<unknown | null> {
    const r = await this.pools.replica(0).query(
      `SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key='plans.usage_alert_threshold_pct'`, [tenantId]);
    return r.rows[0] ? r.rows[0].value : null;
  }

  /** W115's cards: the plans a tenant may actually choose — public, active, and for their country (or
   *  country-agnostic). Newest version of each code wins, because a price change is a new version row. */
  async choosablePlans(countryCode: string): Promise<Array<{ code: string; version: number; name: string; monthlyPriceMinor: string; annualPriceMinor: string; currencyCode: string; isPublic: boolean; isActive: boolean; countryCode: string | null; limits: Record<string, number> }>> {
    const r = await this.pools.replica(0).query<any>(
      `SELECT DISTINCT ON (p.code) p.code, p.version, p.default_name AS name,
              p.monthly_price_minor::text AS monthly_price_minor, p.annual_price_minor::text AS annual_price_minor,
              p.currency_code, p.is_public, p.is_active, p.country_code,
              COALESCE((SELECT jsonb_object_agg(pl.limit_code, pl.limit_value) FROM plan_limits pl WHERE pl.plan_id = p.id), '{}'::jsonb) AS limits
         FROM plans p
        WHERE p.is_active = true AND p.is_public = true
              AND p.country_code = $1
              AND p.deleted_at IS NULL
        ORDER BY p.code, p.version DESC`,
      [countryCode]);
    return r.rows.map((x: any) => ({
      code: x.code, version: Number(x.version), name: x.name,
      monthlyPriceMinor: x.monthly_price_minor, annualPriceMinor: x.annual_price_minor,
      currencyCode: x.currency_code,
      isPublic: x.is_public, isActive: x.is_active, countryCode: x.country_code ?? null,
      limits: Object.fromEntries(Object.entries(x.limits ?? {}).map(([k, v]) => [k, Number(v)])),
    }));
  }
}
