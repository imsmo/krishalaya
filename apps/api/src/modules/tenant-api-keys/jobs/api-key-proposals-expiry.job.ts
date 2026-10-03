// modules/tenant-api-keys/jobs/api-key-proposals-expiry.job.ts · PC-56 TENANT-13c · a key proposal nobody confirmed in 7 days EXPIRES and
// its waiting key is revoked (it never worked). Registered in SCHEDULED_JOB_REGISTRY (advisory-locked per tick); reads only `tenants` on
// the runner's pool and acts per tenant in kv_app's unit of work under RLS (the 11b / 13b pattern). `expireDue` re-checks status and
// instant, so a double claim is one act.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { ApiKeyRepository } from '../repositories/api-key.repository';
import { ApiKeyService } from '../services/api-key.service';

export const API_KEY_PROPOSALS_EXPIRY_JOB = 'tenant-api-key-proposals-expiry';

export class ApiKeyProposalsExpiryJob implements ScheduledJob {
  readonly name = API_KEY_PROPOSALS_EXPIRY_JOB;
  private readonly log = new Logger(ApiKeyProposalsExpiryJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: ApiKeyRepository, private readonly svc: ApiKeyService, private readonly limit = 200) {}

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
