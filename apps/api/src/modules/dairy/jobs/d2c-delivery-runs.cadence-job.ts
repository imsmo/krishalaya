// modules/dairy/jobs/d2c-delivery-runs.cadence-job.ts · PC-55 A5.
// Materialises the next few days of D2C milk drops from active subscriptions, so a rider has tomorrow's list
// and a household's statement is built from real rows rather than a guess.
//
// SAFETY (this job writes rows that later become CHARGES, so it is deliberately paranoid):
//   • IDEMPOTENT AT THE DATABASE — INSERT … ON CONFLICT (subscription_id, due_on) DO NOTHING against the
//     0085 unique index. Re-running a tick, or two pods racing, can never create a second drop for the same
//     household on the same morning (a duplicate would be a double charge to a family buying milk).
//   • ADVISORY-LOCKED per tick by ScheduledJobsRunner (core/jobs), so only one pod does the work anyway.
//   • PER-TENANT ISOLATION — one tenant's failure never stops the others (same guarantee the runner gives
//     between jobs, extended here between tenants), mirroring KycExpiryRemindersCadenceJob's driver loop.
//   • PAUSE/CANCEL RESPECTED by the pure rules (shouldSchedule), not by ad-hoc SQL.
// It never touches money: no wallet, no ledger, no payment. Charging happens when payment keys land.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { D2cRepository } from '../repositories/d2c.repository';
import { horizonDays, shouldSchedule, type D2cFrequency } from '../domain/d2c-schedule.rules';

const LIVE_TENANT_STATUSES_SQL = `('trial','active','grace')`;

@Injectable()
export class D2cDeliveryRunsCadenceJob implements ScheduledJob {
  readonly name = 'd2c-delivery-runs';
  private readonly log = new Logger(D2cDeliveryRunsCadenceJob.name);

  constructor(
    readonly intervalMs: number,
    private readonly uow: UnitOfWork,
    private readonly repo: D2cRepository,
    /** How many days ahead to materialise (today + N). 2 gives riders tomorrow AND a buffer day. */
    private readonly horizon = 2,
  ) {}

  async run(pool: Pool): Promise<void> {
    const tenants = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE status IN ${LIVE_TENANT_STATUSES_SQL} AND deleted_at IS NULL`);
    const today = new Date().toISOString().slice(0, 10);
    const days = horizonDays(today, this.horizon);
    let created = 0, tenantsWithWork = 0, failures = 0;

    for (const t of tenants.rows) {
      try {
        const subs = await this.repo.schedulableSubscriptions(t.id);
        if (subs.length === 0) continue;
        const planQty = new Map<string, string | null>();
        let madeHere = 0;
        for (const day of days) {
          const due = subs.filter((s) => shouldSchedule({ id: s.id, frequency: s.frequency as D2cFrequency, startsOn: s.startsOn, status: s.status, pausedUntil: s.pausedUntil }, day));
          if (due.length === 0) continue;
          await this.uow.run(t.id, async (tx) => {
            for (const s of due) {
              if (!planQty.has(s.id)) planQty.set(s.id, await this.repo.planQtyFor(t.id, s.id));
              if (await this.repo.ensureDelivery(tx, t.id, s.id, day, planQty.get(s.id) ?? null)) madeHere++;
            }
          }, { userId: 'system' });
        }
        if (madeHere > 0) { created += madeHere; tenantsWithWork++; }
      } catch (e) {
        failures++;
        this.log.error(`d2c-delivery-runs failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    if (created > 0 || failures > 0) {
      this.log.log(`d2c-delivery-runs: ${created} drop(s) scheduled across ${tenantsWithWork} tenant(s), ${failures} tenant failure(s), horizon ${days[0]}..${days[days.length - 1]}`);
    }
  }
}
