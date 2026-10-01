// modules/identity/jobs/kyc-document-expiry.cadence-job.ts · PC-56 TENANT-9a · the REGISTERED driver for
// `KycDocumentExpiryJob` (6c-1's pattern, the same cross-tenant loop as `KycExpiryRemindersCadenceJob`: list live tenant
// ids from the runner's pool, then run each tenant through its own RLS-scoped unit of work; one tenant's failure never
// stops the rest).
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { KycDocumentExpiryJob } from './kyc-document-expiry.job';

@Injectable()
export class KycDocumentExpiryCadenceJob implements ScheduledJob {
  readonly name = 'kyc-document-expiry';
  private readonly log = new Logger(KycDocumentExpiryCadenceJob.name);
  constructor(readonly intervalMs: number, private readonly job: KycDocumentExpiryJob) {}

  async run(pool: Pool): Promise<void> {
    const tenants = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE status IN ('trial','active','grace') AND deleted_at IS NULL`);
    let expired = 0; let failed = 0;
    for (const t of tenants.rows) {
      try { expired += await this.job.runForTenant(t.id); }
      catch (err) { failed++; this.log.error(`kyc-document-expiry failed for tenant ${t.id}: ${(err as Error)?.message ?? String(err)}`); }
    }
    this.log.log(`kyc-document-expiry cycle: tenants=${tenants.rows.length} expired=${expired} failedTenants=${failed}`);
  }
}
