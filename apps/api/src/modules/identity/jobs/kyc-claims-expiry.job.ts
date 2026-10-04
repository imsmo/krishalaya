// modules/identity/jobs/kyc-claims-expiry.job.ts · PC-56 TENANT-SW-c · A2 — a take-next claim left past its 15 minutes is RELEASED, so the
// document returns to the queue for the next reviewer. Registered in SCHEDULED_JOB_REGISTRY (advisory-locked per tick, every minute).
// The kv_app UoW pattern (11b / 13b / SW-a / SW-b): the runner's kv_relay pool reads only `tenants`; each tenant's stale claims are
// released in kv_app's unit of work under RLS (`release_kind = 'expired'`, no person — 0199's trigger refuses it before the 15 minutes).
// No grant to kv_relay on kyc_claims.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { KycQueueService } from '../services/kyc-queue.service';

export const KYC_CLAIMS_EXPIRY_JOB = 'identity-kyc-claims-expiry';

export class KycClaimsExpiryJob implements ScheduledJob {
  readonly name = KYC_CLAIMS_EXPIRY_JOB;
  private readonly log = new Logger(KycClaimsExpiryJob.name);
  constructor(readonly intervalMs: number, private readonly queue: KycQueueService) {}

  /** One tick. `only` narrows the tenants (a proof's isolation); production passes nothing. */
  async sweep(pool: Pool, only?: string[]): Promise<{ tenants: number; released: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let released = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try { released += await this.queue.expireStale(id); } catch (e) { failed++; this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: r.rows.length, released, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.released || r.failed) this.log.log(`${this.name}: ${r.released} stale claim(s) released, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
