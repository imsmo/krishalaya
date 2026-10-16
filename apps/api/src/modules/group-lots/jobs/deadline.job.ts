// modules/group-lots/jobs/deadline.job.ts · PC-56 STORE-3c · B8 (founder D3, survey B25) — THE GROUP-LOT PLEDGE DEADLINE, A CLOCK.
//
// What was true: no sweep ended a lot at its `pledge_deadline` (survey 1A: "pledges dissolve" was FALSE as automatic) — an unfilled lot stayed
// `pledging` for ever unless its coordinator cancelled it by hand. Now a `ScheduledJob` registered by GroupLotsModule on the HOTFIX-5 pattern
// (orders/jobs/seller-confirm-timeout.job.ts):
//   • the ONLY read on the runner's kv_relay pool is the tenant list (`GroupLotRepository.tenantsWithDueDeadline`, on `group_lots`, which 0188.8
//     grants kv_relay SELECT on);
//   • the claim is PER TENANT in kv_app's unit of work under RLS (`dueAtDeadline`, bounded, SKIP LOCKED);
//   • every act is its OWN kv_app transaction through `GroupLotService.cancelAtDeadline`, which re-locks the lot and re-checks the rule
//     (domain/deadline.ts) — a second tick changes nothing. One failure never stops the rest (caught and counted).
// NO MONEY MOVES (Law 9 list, §9): a pledging lot holds no money. The cadence is the registry's table (core/jobs/clock-cadence.ts), never a
// literal here.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { GroupLotRepository } from '../repositories/group-lot.repository';
import { GroupLotService } from '../services/group-lot.service';

export const GROUP_LOT_DEADLINE_JOB = 'group-lots-deadline';
export interface DeadlineSweepResult { tenants: number; claimed: number; acted: number; failed: number }

export class GroupLotDeadlineJob implements ScheduledJob {
  readonly name = GROUP_LOT_DEADLINE_JOB;
  private readonly log = new Logger(GroupLotDeadlineJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: GroupLotRepository, private readonly lots: GroupLotService, private readonly limit = 200) {}

  /** One sweep. `onlyTenants` narrows it (the live spec drives one tenant); production passes none. */
  async sweep(pool: Pool, now: Date = new Date(), onlyTenants?: string[]): Promise<DeadlineSweepResult> {
    const tenants = onlyTenants ?? await this.repo.tenantsWithDueDeadline(pool, now);
    let claimed = 0, acted = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try { ids = await this.uow.run(tenantId, (tx) => this.repo.dueAtDeadline(tx, tenantId, now, this.limit), { userId: 'system' }); }
      catch (e) { failed++; this.log.error(`${this.name}: claim failed for tenant ${tenantId}: ${(e as Error).message}`); continue; }
      claimed += ids.length;
      for (const id of ids) {
        try { if (await this.lots.cancelAtDeadline(tenantId, id, now)) acted++; }
        catch (e) { failed++; this.log.error(`${this.name}: lot ${id} not closed: ${(e as Error).message}`); }
      }
    }
    return { tenants: tenants.length, claimed, acted, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.acted > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.acted} lot(s) closed at their deadline, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}
