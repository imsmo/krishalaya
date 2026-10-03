// modules/tenant-integrations/jobs/integration-reverify.job.ts · PC-56 TENANT-13c · THE HEALTH SOURCE: every live connection is re-verified
// against its provider once a day. Hourly tick (advisory-locked by the runner); per tenant, in kv_app's unit of work under RLS (the 11b
// pattern), the connections whose last check is ≥ 24 h old are read from the vault (the ONLY SECRET_READER consumer), verified through
// the pinned transport, and recorded in integration_verify_checks + the connection's status. The console's Health (24 h) is a count of
// these rows and the last good instant — never a fabricated percentage of calls no platform path makes.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { TenantIntegrationRepository } from '../repositories/tenant-integration.repository';
import { TenantIntegrationService } from '../services/tenant-integration.service';

export const INTEGRATION_REVERIFY_JOB = 'tenant-integrations-daily-reverify';

export class IntegrationReverifyJob implements ScheduledJob {
  readonly name = INTEGRATION_REVERIFY_JOB;
  private readonly log = new Logger(IntegrationReverifyJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: TenantIntegrationRepository, private readonly svc: TenantIntegrationService, private readonly perTenant = 20) {}

  async sweep(pool: Pool): Promise<{ tenants: number; checked: number; ok: number; failed: number }> {
    const r = await pool.query(`SELECT DISTINCT tenant_id AS id FROM tenant_integrations WHERE is_active = true AND deleted_at IS NULL ORDER BY 1`);
    const tenants = r.rows.map((x: { id: string }) => x.id);
    let checked = 0, ok = 0, failed = 0;
    for (const tenantId of tenants) {
      let due: { id: string; providerCode: string; secretRef: string }[] = [];
      try { due = await this.uow.run(tenantId, (tx) => this.repo.dueForCheckTx(tx, tenantId, this.perTenant), { userId: undefined }); } catch { failed++; continue; }
      for (const row of due) {
        try { checked++; if (await this.svc.reverify(tenantId, row)) ok++; } catch { failed++; }
      }
    }
    return { tenants: tenants.length, checked, ok, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.checked || r.failed) this.log.log(`${this.name}: ${r.checked} checked (${r.ok} ok), ${r.failed} failed across ${r.tenants} tenant(s)`);
  }
}
