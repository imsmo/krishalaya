// modules/promotions/jobs/promotions.cadence-jobs.ts · PC-56 TENANT-10b · B4 / F-9 — THE TWO SWEEPS, ACTUALLY SCHEDULED.
//
// `PromoBudgetWatchJob` and `FestivalCampaignSchedulerJob` shipped with this module and were instantiated NOWHERE: the
// module header said "instantiated by apps/worker"; apps/worker has no promotions job and, by its own contract
// (WORKER-RUNTIME.md, "Deferred: domain-handler jobs"), cannot host one — both call PromotionService, which needs the
// module's unit of work, outbox and audit writer. So W129's `scheduled → active` never happened on its own and the budget
// backstop never ran. `core/jobs/jobs.runner.ts` exists for exactly this (identity, dairy and seven other modules register
// through it): advisory-locked per tick by the runner, so N pods do not race the same sweep; each candidate is handled in
// its own transaction, so one tenant's failure never stops another's.
//
// IDEMPOTENT, BOTH: the budget watch only claims ACTIVE promotions whose spend has reached the budget; the scheduler only
// claims festival promotions whose is_active disagrees with their window — an aligned row is never re-claimed. The
// HUMAN-PAUSE BIT (F-10) is respected twice: the scheduler's claim excludes `paused_at IS NOT NULL`, and
// PromotionService.applyScheduleWindow re-checks it under the row lock.
//
// NOT FLAG-GATED PER TENANT on purpose: the sweeps only ever CLOSE a spent promotion or align a festival with the window
// its own tenant_admin authored; with the `promotions` flag OFF a tenant has no promotions to sweep.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { PromotionRepository } from '../repositories/promotion.repository';
import { PromotionService } from '../services/promotion.service';
import { PromoBudgetWatchJob } from './promo-budget-watch.job';
import { FestivalCampaignSchedulerJob } from './festival-campaign-scheduler.job';

export const BUDGET_WATCH_JOB = 'promotions-budget-watch';
export const FESTIVAL_SCHEDULER_JOB = 'promotions-festival-scheduler';

export class PromoBudgetWatchCadenceJob implements ScheduledJob {
  readonly name = BUDGET_WATCH_JOB;
  private readonly log = new Logger(PromoBudgetWatchCadenceJob.name);
  constructor(readonly intervalMs: number, private readonly repo: PromotionRepository, private readonly promotions: PromotionService) {}
  async run(pool: Pool): Promise<void> {
    const r = await new PromoBudgetWatchJob(pool, this.repo, this.promotions).run();
    if (r.deactivated > 0 || r.failed > 0) this.log.log(`promotions-budget-watch: ${r.deactivated} closed on a spent budget, ${r.failed} failed, of ${r.scanned} claimed`);
  }
}

export class FestivalSchedulerCadenceJob implements ScheduledJob {
  readonly name = FESTIVAL_SCHEDULER_JOB;
  private readonly log = new Logger(FestivalSchedulerCadenceJob.name);
  constructor(readonly intervalMs: number, private readonly repo: PromotionRepository, private readonly promotions: PromotionService) {}
  async run(pool: Pool): Promise<void> {
    const r = await new FestivalCampaignSchedulerJob(pool, this.repo, this.promotions).run();
    if (r.changed > 0 || r.failed > 0) this.log.log(`promotions-festival-scheduler: ${r.changed} window(s) opened/closed, ${r.failed} failed, of ${r.scanned} claimed`);
  }
}
