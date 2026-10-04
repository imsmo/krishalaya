// modules/memberships/jobs/agm-pack-render.job.ts · PC-56 TENANT-SW-d · D3 — the AGM pack RENDER: every pack a second tenant_admin
// confirmed (`issuing`) becomes `issued` — the PDF through the 13d text pdf-writer, stored as media, the sha256s, the document id and
// the dataset queued on the 6e-2 plane, in one transaction per pack. Registered in SCHEDULED_JOB_REGISTRY (advisory-locked per tick).
// The kv_app UoW pattern (11b / 13b / SW-a/b/c): the runner's kv_relay pool reads only `tenants`; each tenant's packs are rendered in
// kv_app's unit of work under RLS. No grant to kv_relay on agm_packs. A failed render is recorded on the pack (render_error,
// render_attempts) and retried next tick.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { AgmPackService } from '../services/agm-pack.service';

export const AGM_PACK_RENDER_JOB = 'governance-agm-pack-render';

export class AgmPackRenderJob implements ScheduledJob {
  readonly name = AGM_PACK_RENDER_JOB;
  private readonly log = new Logger(AgmPackRenderJob.name);
  constructor(readonly intervalMs: number, private readonly packs: AgmPackService) {}

  async sweep(pool: Pool, only?: string[]): Promise<{ tenants: number; issued: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let issued = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try { const x = await this.packs.renderIssuing(id); issued += x.issued; failed += x.failed; }
      catch (e) { failed++; this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: r.rows.length, issued, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.issued || r.failed) this.log.log(`${this.name}: ${r.issued} pack(s) issued, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
