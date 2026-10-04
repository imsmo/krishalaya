// modules/memberships/jobs/register-import-apply.job.ts · PC-56 TENANT-SW-d · E1 — the register import APPLY: every import a second
// tenant_admin confirmed is written into `coop_share_registers` (source = 'import', import_batch_id) — idempotently: only `valid` lines are
// visited, a member already on the register (or a folio taken since validation) is skipped. Registered in SCHEDULED_JOB_REGISTRY.
// The kv_app UoW pattern: the runner's kv_relay pool reads only `tenants`; each tenant's imports are applied in kv_app's unit of work.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { RegisterImportService } from '../services/register-import.service';

export const REGISTER_IMPORT_APPLY_JOB = 'governance-register-import-apply';

export class RegisterImportApplyJob implements ScheduledJob {
  readonly name = REGISTER_IMPORT_APPLY_JOB;
  private readonly log = new Logger(RegisterImportApplyJob.name);
  constructor(readonly intervalMs: number, private readonly imports: RegisterImportService) {}

  async sweep(pool: Pool, only?: string[]): Promise<{ tenants: number; imports: number; rows: number; skipped: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let imports = 0, rows = 0, skipped = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try { const x = await this.imports.applyConfirmed(id); imports += x.applied; rows += x.rows; skipped += x.skipped; }
      catch (e) { failed++; this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: r.rows.length, imports, rows, skipped, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.imports || r.failed) this.log.log(`${this.name}: ${r.imports} import(s) applied (${r.rows} row(s), ${r.skipped} skipped), ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
