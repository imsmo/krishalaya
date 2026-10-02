// modules/requirements/jobs/expire-requirements.job.ts · PC-56 TENANT-11d · F-1 / F-9 — REQUIREMENT + QUOTE EXPIRY, ACTUALLY SCHEDULED.
//
// Before this wave the job was instantiated NOWHERE (the module header said "apps/worker"; apps/worker hosts no domain job —
// WORKER-RUNTIME.md "Deferred: domain-handler jobs"), so a requirement never lapsed past its need-by and a quote never lapsed past
// its validity; and as written it claimed `requirement_responses FOR UPDATE SKIP LOCKED` on the kv_relay pool, a role with NO
// grant on that table — wired as-is, the first tick would have been a 42501. It is now registered in `SCHEDULED_JOB_REGISTRY`
// (the 10b / 11a / 11b pattern: the runner takes a Postgres advisory lock per job name per tick, so N pods never race one sweep)
// and claims PER TENANT IN kv_app's UNIT OF WORK: the only thing it reads with the kv_relay pool is `tenants` (granted since
// 0014); every claim and every act after that runs as kv_app under RLS, and each act re-locks the row and re-checks its clock,
// so a row claimed by two ticks is expired once. No grant to kv_relay was added. One failure never stops the rest.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { RequirementService } from '../services/requirement.service';
import { RequirementResponseService } from '../services/requirement-response.service';

export const EXPIRE_REQUIREMENTS_JOB = 'requirements-expire';

export class ExpireRequirementsJob implements ScheduledJob {
  readonly name = EXPIRE_REQUIREMENTS_JOB;
  private readonly log = new Logger(ExpireRequirementsJob.name);
  constructor(
    readonly intervalMs: number,
    private readonly uow: UnitOfWork,
    private readonly reqRepo: RequirementRepository,
    private readonly respRepo: RequirementResponseRepository,
    private readonly requirements: RequirementService,
    private readonly responses: RequirementResponseService,
    private readonly limit = 200,
  ) {}

  async sweep(pool: Pool, now: Date = new Date()): Promise<{ tenants: number; requirements: number; responses: number; failed: number }> {
    const tenants = await this.reqRepo.activeTenants(pool);
    let requirements = 0, responses = 0, failed = 0;
    for (const tenantId of tenants) {
      let reqIds: string[] = []; let respIds: string[] = [];
      try {
        [reqIds, respIds] = await this.uow.run(tenantId, async (tx) => [
          await this.reqRepo.dueToExpire(tx, tenantId, now, this.limit),
          await this.respRepo.dueToExpire(tx, tenantId, now, this.limit),
        ], { userId: 'system' });
      } catch { failed++; continue; }
      for (const id of reqIds) { try { if (await this.requirements.expire(tenantId, id, now)) requirements++; } catch { failed++; } }
      for (const id of respIds) { try { if (await this.responses.expireResponse(tenantId, id, now)) responses++; } catch { failed++; } }
    }
    return { tenants: tenants.length, requirements, responses, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.requirements + r.responses > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.requirements} requirement(s) + ${r.responses} quote(s) expired, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
