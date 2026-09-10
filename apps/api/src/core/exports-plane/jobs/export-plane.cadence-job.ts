// core/exports-plane/jobs/export-plane.cadence-job.ts · the REGISTERED cadence job that drives the export queue
// (PC-56 TENANT-6e-2). Registered in `ExportsPlaneModule.onModuleInit` into `SCHEDULED_JOB_REGISTRY` — the pattern
// 6c-1 replaced an unregistered job with, and the pattern `core/bulk`'s `runPendingImports` never got (see the wave's
// report: that sweep is called from nowhere). The runner takes the advisory lock per job name, hands us its kv_relay pool,
// and this delegates to `ExportWorker.tick` — one job per tick.
//
// THE FLAG IS READ ONCE PER TICK, PLATFORM-WIDE. `tenant_exports` OFF means no export is ever enqueued (the service
// refuses), so an OFF worker has nothing to do — but it must also not drain jobs enqueued BEFORE the flag was switched
// off: the kill-switch stops the machine, not just the door. Per-tenant flag context is not consulted here because the
// queue is one queue; a tenant whose flag is off could not have enqueued in the first place.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../jobs/scheduled-job';
import { FlagsService } from '../../feature-flags/flags.service';
import { ExportWorker } from '../export-worker';
import { EXPORT_PLANE_FLAG } from '../export-plane.service';

/** Ten seconds: the ETA is "jobs ahead × median runtime", and a tick interval longer than a typical run would make the
 *  interval — not the work — the thing a person waits for. One tick claims ONE job, so the cost of an idle tick is one
 *  indexed SELECT on a partial index. */
export const EXPORT_TICK_MS = 10_000;

@Injectable()
export class ExportPlaneCadenceJob implements ScheduledJob {
  readonly name = 'tenant-exports';
  private readonly log = new Logger(ExportPlaneCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly worker: ExportWorker, private readonly flags: FlagsService) {}

  async run(pool: Pool): Promise<void> {
    if (!(await this.flags.isEnabled(EXPORT_PLANE_FLAG).catch(() => false))) return;
    const r = await this.worker.tick(pool);
    if (r.generated || r.failed || r.released || r.expired) {
      this.log.log(`tenant-exports: ${r.generated} file(s) made, ${r.failed} failed, ${r.released} stale claim(s) released, ${r.expired} expired`);
    }
  }
}
