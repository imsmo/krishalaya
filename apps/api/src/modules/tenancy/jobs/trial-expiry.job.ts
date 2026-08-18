// modules/tenancy/jobs/trial-expiry.job.ts
// Find trialing subscriptions whose trial ends within a notice window and emit ONE tenancy.trial_ending event
// each, so the tenant is nudged to add a plan/payment method before they lose access. Read + the emits commit in
// ONE tx; idempotent per (subscription, trial-end day) via a deterministic dedupe key in the payload. Bounded
// per tick, cross-tenant.
//
// **WIRED, AT LAST, BY PC-56 TENANT-4d-5.** TENANT-4d-2 found four job classes in this directory that no runtime
// ran and deliberately left two of them alone; 0148's header named this one explicitly and said why: a trial
// notice "needs the notification plane TENANT-4d-5 builds. Wiring a job whose notification goes nowhere would be
// the fake-surface shape this programme refuses." That plane now exists, so the reason to leave it unwired is
// gone — and leaving it unwired would have made `saas.trial_ending` a map row with a catalog row, templates in
// three languages, and NO PRODUCER, which is the same defect from the other end.
//
// The pool arrives as a `run()` argument rather than through the constructor, matching SaasBillingCycleJob: the
// cadence runner owns exactly one kv_relay pool and hands it to every job, so a job that captured its own would
// be a second connection pool for one purpose.
import type { Pool, PoolClient } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { TenancyEventType } from '../domain/tenancy.events';
import { BillingNoticeService } from '../services/billing-notice.service';

export class TrialExpiryJob {
  constructor(private readonly subs: SubscriptionRepository, private readonly notice: BillingNoticeService) {}

  /** `noticeDays` ahead of trial end to nudge; defaults to 3. */
  async run(pool: Pool, limit = 200, noticeDays = 3, now: Date = new Date()): Promise<{ notified: number; silent: number }> {
    const through = new Date(now.getTime() + noticeDays * 86400_000);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as never) as never, tenantId: '', userId: 'system' };
      const ending = await this.subs.findTrialsEnding(tx, through, limit);
      let notified = 0;
      let silent = 0;
      for (const s of ending) {
        const p = s.toProps();
        const dayTag = p.currentPeriodEnd.toISOString().slice(0, 10);
        // Through the SAME enrichment every other billing notice uses (flag, holders of `tenant.settings`,
        // suspension, ceiling) rather than a private recipient rule for the one event that happens to be
        // emitted by a job instead of a service. A tenant with notices off, or with nobody holding
        // `tenant.settings`, still gets the outbox row — the FACT that a trial is ending is not conditional on
        // anyone hearing about it — it simply carries no recipient, and the fanout's own fail-closed rule
        // ("never invent a recipient") ends it there.
        const payload = await this.notice.enrich(tx, p.tenantId, TenancyEventType.TrialEnding, {
          v: 1, subscriptionId: p.id, tenantId: p.tenantId, trialEndsOn: dayTag,
          dedupeKey: `trial_ending:${p.id}:${dayTag}`,
        });
        if (payload.recipientUserIds === undefined) silent++; else notified++;
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'subscription',$2,$3,$4::jsonb)`,
          [p.tenantId, p.id, TenancyEventType.TrialEnding, JSON.stringify(payload)]);
      }
      await client.query('COMMIT');
      return { notified, silent };
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  }
}
