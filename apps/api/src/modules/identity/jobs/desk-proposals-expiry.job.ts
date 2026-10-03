// modules/identity/jobs/desk-proposals-expiry.job.ts · PC-56 TENANT-13b · a desk proposal nobody confirmed in 7 days EXPIRES (0192
// `expires_at`). Registered in SCHEDULED_JOB_REGISTRY (advisory-locked per tick); reads only `tenants` on the runner's pool and acts
// per tenant in kv_app's unit of work under RLS (the 11b pattern). `expireDue` re-checks status and instant, so a double claim is one act.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { DeskRepository } from '../repositories/desk.repository';
import { DeskService } from '../services/desk.service';

export const DESK_PROPOSALS_EXPIRY_JOB = 'identity-desk-proposals-expiry';

export class DeskProposalsExpiryJob implements ScheduledJob {
  readonly name = DESK_PROPOSALS_EXPIRY_JOB;
  private readonly log = new Logger(DeskProposalsExpiryJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: DeskRepository, private readonly svc: DeskService, private readonly limit = 200) {}

  async sweep(pool: Pool): Promise<{ tenants: number; expired: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    const tenants = r.rows.map((x: { id: string }) => x.id);
    let expired = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try { ids = await this.uow.run(tenantId, (tx) => this.repo.dueToExpireTx(tx, tenantId, this.limit), { userId: undefined }); } catch { failed++; continue; }
      for (const id of ids) { try { if (await this.svc.expireDue(tenantId, id)) expired++; } catch { failed++; } }
    }
    return { tenants: tenants.length, expired, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.expired || r.failed) this.log.log(`${this.name}: ${r.expired} expired, ${r.failed} failed across ${r.tenants} tenant(s)`);
  }
}
