// modules/labour/jobs/booking-respond-timeout.job.ts · PC-56 TENANT-11b · F-1 / F-9 — THE RESPOND-BY CLOCK, ACTUALLY SCHEDULED.
//
// Before this wave the job was instantiated NOWHERE (the module header said "apps/worker"; apps/worker hosts no domain job —
// WORKER-RUNTIME.md "Deferred: domain-handler jobs"), so an open booking never timed out; and as written it claimed
// `labour_bookings FOR UPDATE SKIP LOCKED` on the kv_relay pool, a role with NO grant on that table — wired as-is, the first
// tick would have been a 42501. It is now registered in `SCHEDULED_JOB_REGISTRY` (the 10b / 11a pattern: the runner takes a
// Postgres advisory lock per job name per tick, so N pods never race one sweep) and it claims PER TENANT IN kv_app's UNIT
// OF WORK: the only thing it reads with the kv_relay pool is `tenants` (granted since 0014); every claim and every act after
// that runs as kv_app under RLS, and `expireBooking` re-locks the row and re-checks `open` + `respond_by < now`, so a row
// claimed by two ticks is expired once. No grant to kv_relay was added. One failure never stops the rest.
//
// NO OTHER LABOUR JOB is added (brief A5): completion releases the escrow in the pay run's own transaction, so there is no
// canon reason for an auto-release sweep.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { LabourBookingService } from '../services/labour-booking.service';

export const RESPOND_TIMEOUT_JOB = 'labour-booking-respond-timeout';

export class BookingRespondTimeoutJob implements ScheduledJob {
  readonly name = RESPOND_TIMEOUT_JOB;
  private readonly log = new Logger(BookingRespondTimeoutJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: LabourBookingRepository, private readonly svc: LabourBookingService, private readonly limit = 200) {}

  async sweep(pool: Pool, now: Date = new Date()): Promise<{ tenants: number; claimed: number; expired: number; failed: number }> {
    const tenants = await this.repo.activeTenants(pool);
    let claimed = 0, expired = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try { ids = await this.uow.run(tenantId, (tx) => this.repo.dueToExpire(tx, tenantId, now, this.limit), { userId: 'system' }); } catch { failed++; continue; }
      claimed += ids.length;
      for (const id of ids) { try { if (await this.svc.expireBooking(tenantId, id, now)) expired++; } catch { failed++; } }
    }
    return { tenants: tenants.length, claimed, expired, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.expired > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.expired} expired, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}
