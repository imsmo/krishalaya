// modules/tenant-integrations/jobs/integration-proposals-clock.job.ts · PC-56 TENANT-13c · the proposal clock: an unconfirmed provider
// change expires after 7 days; a confirmation the process never finished applying (> 15 min) closes verify_failed ("interrupted"). Both
// wipe the sealed candidate credential; neither vaults anything. Per tenant in kv_app's unit of work (the 11b / 13b pattern).
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { CONFIRMED_STUCK_MINUTES } from '../domain/integration-proposal.state';
import { TenantIntegrationRepository } from '../repositories/tenant-integration.repository';
import { TenantIntegrationService } from '../services/tenant-integration.service';

export const INTEGRATION_PROPOSALS_CLOCK_JOB = 'tenant-integration-proposals-clock';

export class IntegrationProposalsClockJob implements ScheduledJob {
  readonly name = INTEGRATION_PROPOSALS_CLOCK_JOB;
  private readonly log = new Logger(IntegrationProposalsClockJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: TenantIntegrationRepository, private readonly svc: TenantIntegrationService, private readonly limit = 200) {}

  async sweep(pool: Pool): Promise<{ tenants: number; closed: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    const tenants = r.rows.map((x: { id: string }) => x.id);
    let closed = 0, failed = 0;
    for (const tenantId of tenants) {
      let due: { id: string; status: string }[] = [];
      try { due = await this.uow.run(tenantId, (tx) => this.repo.dueToCloseTx(tx, tenantId, CONFIRMED_STUCK_MINUTES, this.limit), { userId: undefined }); } catch { failed++; continue; }
      for (const d of due) { try { if (await this.svc.closeDue(tenantId, d.id, d.status)) closed++; } catch { failed++; } }
    }
    return { tenants: tenants.length, closed, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.closed || r.failed) this.log.log(`${this.name}: ${r.closed} closed, ${r.failed} failed across ${r.tenants} tenant(s)`);
  }
}
