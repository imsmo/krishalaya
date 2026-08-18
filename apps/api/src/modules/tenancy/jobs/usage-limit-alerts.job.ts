// modules/tenancy/jobs/usage-limit-alerts.job.ts
// Worker job (kv_relay): warn tenants approaching a plan quota. Joins active subscriptions ⋈ plan_limits ⋈ this
// month's usage_counters and emits ONE tenancy.usage_limit_alert per (tenant, metric) at/over the threshold
// (default 80%). Unlimited limits (-1) and zero usage are skipped. Cross-tenant scan, bounded. Idempotent per
// calendar date via an ops_job_runs date-guard so a re-run the same day never re-spams. Emits + run-marker commit
// in ONE tx. NOT a DI provider — apps/worker instantiates it with the kv_relay Pool.
import type { Pool, PoolClient } from 'pg';
import { TenancyEventType } from '../domain/tenancy.events';

const JOB_CODE = 'usage_limit_alerts';

export class UsageLimitAlertsJob {
  constructor(private readonly systemPool: Pool) {}

  /** `thresholdPct` in [0,1]. PC-56 TENANT-4d-1: the default was 0.8 while W118 promises a notice "at 90%
   *  of any limit" — a tenant told 90 heard at 80. The default now comes from the domain constant the screen
   *  also reads (0145 makes it a per-tenant setting, which the caller may pass in). */
  async run(limit = 2000, thresholdPct = DEFAULT_ALERT_THRESHOLD_PCT / 100, now: Date = new Date()): Promise<{ alerted: number; skipped: boolean }> {
    const runDate = now.toISOString().slice(0, 10);
    const client: PoolClient = await this.systemPool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query(`SELECT 1 FROM ops_job_runs WHERE job_code=$1 AND status='completed' AND detail->>'runDate'=$2 LIMIT 1`, [JOB_CODE, runDate]);
      if ((prior.rowCount ?? 0) > 0) { await client.query('ROLLBACK'); return { alerted: 0, skipped: true }; }

      const rows = await client.query(
        `SELECT s.tenant_id, pl.limit_code, pl.limit_value, uc.used_value
           FROM subscriptions s
           JOIN plan_limits pl ON pl.plan_id = s.plan_id
           JOIN usage_counters uc ON uc.tenant_id = s.tenant_id AND uc.metric_code = pl.limit_code
                                 AND uc.period = date_trunc('month', $1::timestamptz)::date
          WHERE s.status = 'active' AND pl.limit_value > 0
            AND uc.used_value::numeric >= ($2::numeric * pl.limit_value)
          ORDER BY s.tenant_id LIMIT $3`,
        [now, thresholdPct, limit]);

      let alerted = 0;
      for (const r of rows.rows as any[]) {
        const pct = Number(r.used_value) / Number(r.limit_value);
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'tenant',$1,$2,$3::jsonb)`,
          [r.tenant_id, TenancyEventType.UsageLimitAlert,
           JSON.stringify({ v: 1, tenantId: r.tenant_id, metricCode: r.limit_code, used: String(r.used_value), limit: String(r.limit_value), pct: Math.round(pct * 100), runDate, dedupeKey: `usage_alert:${r.tenant_id}:${r.limit_code}:${runDate}` })]);
        alerted++;
      }
      await client.query(`INSERT INTO ops_job_runs (job_code, status, detail, finished_at) VALUES ($1,'completed',$2::jsonb, now())`, [JOB_CODE, JSON.stringify({ runDate, alerted })]);
      await client.query('COMMIT');
      return { alerted, skipped: false };
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  }
}
