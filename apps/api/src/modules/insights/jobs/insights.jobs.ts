// modules/insights/jobs/insights.jobs.ts · PC-56 TENANT-SW-f — the two clocks the insights need, REGISTERED in SCHEDULED_JOB_REGISTRY by
// InsightsModule. Each sweeps on the runner's kv_relay pool reading ONLY `tenants`, and does every table act per tenant in kv_app's unit of
// work (the HOTFIX-2 / SW-a shape) — the relay role holds nothing on the tables they touch.
//   • insights-reports (every 15 s): due report schedules become queued runs (next run computed in IST), then queued runs are READ under the
//     60 s statement timeout and their watermarked CSV queued on the 6e-2 plane (ReportRunner).
//   • insights-wastage-sweep (hourly): every qualifying source row of every tenant through `kv_wastage_backfill(…, 'sweep')` — the net under
//     the relay handlers (a source event lost to a crash is recorded within the hour; a recorded one is `exists`, nothing is written twice).
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import type { UnitOfWork } from '../../../core/database/unit-of-work';
import { ReportRunner } from '../services/report.service';
import { InsightsRepository } from '../repositories/insights.repository';

const LIVE_TENANTS = `SELECT id FROM tenants WHERE status IN ('trial','active','grace') AND deleted_at IS NULL`;
const tenantsOf = async (pool: Pool, only?: readonly string[]) =>
  (await pool.query<{ id: string }>(only?.length ? `${LIVE_TENANTS} AND id = ANY($1::uuid[]) ORDER BY id` : `${LIVE_TENANTS} ORDER BY id`, only?.length ? [[...only]] : [])).rows;

export class ReportsCadenceJob {
  readonly name = 'insights-reports';
  private readonly log = new Logger(ReportsCadenceJob.name);
  constructor(readonly intervalMs: number, private readonly runner: ReportRunner) {}
  async sweep(pool: Pool, only?: readonly string[], now = new Date()): Promise<{ tenants: number; scheduled: number; ran: number; ready: number; refused: number; failed: number; errors: number }> {
    const t = await tenantsOf(pool, only);
    const out = { tenants: t.length, scheduled: 0, ran: 0, ready: 0, refused: 0, failed: 0, errors: 0 };
    for (const { id } of t) {
      try {
        out.scheduled += await this.runner.materialiseDue(id, now);
        const r = await this.runner.runQueued(id);
        out.ran += r.ran; out.ready += r.ready; out.refused += r.refused; out.failed += r.failed;
      } catch (e) { out.errors++; this.log.error(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return out;
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.scheduled || r.ran || r.errors) this.log.log(`${this.name}: ${r.scheduled} scheduled, ${r.ran} run (${r.ready} ready, ${r.refused} refused, ${r.failed} failed), ${r.errors} error(s)`);
  }
}

export class WastageSweepJob {
  readonly name = 'insights-wastage-sweep';
  private readonly log = new Logger(WastageSweepJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: InsightsRepository) {}
  async sweep(pool: Pool, only?: readonly string[]): Promise<{ tenants: number; written: number; failed: number }> {
    const t = await tenantsOf(pool, only);
    let written = 0; let failed = 0;
    for (const { id } of t) {
      try {
        const counts = await this.uow.run(id, (tx) => this.repo.backfill(tx, id, 'sweep', null), { userId: undefined });
        written += counts.reduce((a, c) => a + c.written, 0);
      } catch (e) { failed++; this.log.error(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: t.length, written, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.written || r.failed) this.log.log(`${this.name}: ${r.written} wastage event(s) recorded, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
