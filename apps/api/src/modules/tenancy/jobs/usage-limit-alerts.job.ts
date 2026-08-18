// modules/tenancy/jobs/usage-limit-alerts.job.ts
// Warn tenants approaching a plan quota. Joins active subscriptions ⋈ plan_limits ⋈ this month's usage_counters
// and emits ONE tenancy.usage_limit_alert per (tenant, metric) at/over the threshold. Unlimited limits (-1) and
// zero usage are skipped. Cross-tenant scan, bounded. Idempotent per calendar date via an ops_job_runs date
// guard so a re-run the same day never re-spams. Emits + run-marker commit in ONE tx.
//
// **THIS FILE DID NOT COMPILE, AND NOTHING COULD SEE THAT (found by PC-56 TENANT-4d-5).**
//
// TENANT-4d-1 corrected the threshold default here — W118 promises a notice "at 90% of any limit" and the job
// used 80%, so a tenant told 90 heard at 80 — by writing `DEFAULT_ALERT_THRESHOLD_PCT / 100` into the default
// parameter. It never added the import. `tsc` reports `TS2304: Cannot find name 'DEFAULT_ALERT_THRESHOLD_PCT'`
// on line 1 of that expression, and the wave that wrote it passed a clean typecheck, because:
//
//   • `apps/api/tsconfig.json` includes only `src/main.ts`, `src/app.module.ts`, `src/core/**`, `src/shared/**`
//     and `src/modules/listings/**`. Every other module is typechecked ONLY through what those entry points
//     transitively import — and this job was not a DI provider and was registered nowhere, so nothing imported
//     it and `tsc --listFiles` never mentions it. **AN UNWIRED FILE IS ALSO AN UNTYPECHECKED FILE.**
//   • the 4d-1 spec that covers this line asserts on the file's SOURCE TEXT
//     (`expect(s).toContain('DEFAULT_ALERT_THRESHOLD_PCT / 100')`) rather than importing the class, so it read
//     the characters, confirmed they were there, and passed. A text assertion cannot fail on an unresolved
//     symbol. That test is kept — the value it guards is real — and a behavioural test now sits beside it.
//
// So the honest summary of the pre-4d-5 state is not "the usage alert used the wrong threshold". It is: the job
// that sends W118's promised notice could not have been loaded into a Node process at all, and the wave that
// scheduled it would have discovered that at boot. Wiring it (below) is what makes it typechecked.
import type { Pool, PoolClient } from 'pg';
import { TenancyEventType } from '../domain/tenancy.events';
import { DEFAULT_ALERT_THRESHOLD_PCT } from '../domain/plan-usage';
import { BillingNoticeService } from '../services/billing-notice.service';

const JOB_CODE = 'usage_limit_alerts';

export class UsageLimitAlertsJob {
  constructor(private readonly notice: BillingNoticeService) {}

  /** `thresholdPct` in [0,1]. PC-56 TENANT-4d-1: the default was 0.8 while W118 promises a notice "at 90%
   *  of any limit" — a tenant told 90 heard at 80. The default now comes from the domain constant the screen
   *  also reads (0145 makes it a per-tenant setting, which the caller may pass in). */
  async run(pool: Pool, limit = 2000, thresholdPct = DEFAULT_ALERT_THRESHOLD_PCT / 100, now: Date = new Date()): Promise<{ alerted: number; silent: number; skipped: boolean }> {
    const runDate = now.toISOString().slice(0, 10);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query(`SELECT 1 FROM ops_job_runs WHERE job_code=$1 AND status='completed' AND detail->>'runDate'=$2 LIMIT 1`, [JOB_CODE, runDate]);
      if ((prior.rowCount ?? 0) > 0) { await client.query('ROLLBACK'); return { alerted: 0, silent: 0, skipped: true }; }

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

      const tx = { query: (sql: string, params?: readonly unknown[]) => client.query(sql, params as never) as never, tenantId: '', userId: 'system' };
      let alerted = 0;
      let silent = 0;
      for (const r of rows.rows as Array<{ tenant_id: string; limit_code: string; limit_value: string; used_value: string }>) {
        const pct = Number(r.used_value) / Number(r.limit_value);
        // W118's "console + email notice" reaches the tenant through the one notification spine, with the
        // recipients resolved by the same rule every other billing notice uses.
        const payload = await this.notice.enrich(tx as never, r.tenant_id, TenancyEventType.UsageLimitAlert, {
          v: 1, tenantId: r.tenant_id, metricCode: r.limit_code, used: String(r.used_value),
          limit: String(r.limit_value), pct: Math.round(pct * 100), runDate,
          dedupeKey: `usage_alert:${r.tenant_id}:${r.limit_code}:${runDate}`,
        });
        if (payload.recipientUserIds === undefined) silent++; else alerted++;
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'tenant',$1,$2,$3::jsonb)`,
          [r.tenant_id, TenancyEventType.UsageLimitAlert, JSON.stringify(payload)]);
      }
      await client.query(`INSERT INTO ops_job_runs (job_code, status, detail, finished_at) VALUES ($1,'completed',$2::jsonb, now())`, [JOB_CODE, JSON.stringify({ runDate, alerted, silent })]);
      await client.query('COMMIT');
      return { alerted, silent, skipped: false };
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  }
}
