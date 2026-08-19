// modules/logistics/jobs/rc-expiry-parking.cadence-job.ts · PC-56 TENANT-5b
//
// Wraps `RcExpiryParkingJob` as a `ScheduledJob` so `core/jobs/jobs.runner.ts` runs it inside apps/api under a
// Postgres advisory lock — the same host `SaasBillingCycleCadenceJob`, `KycExpiryRemindersCadenceJob` and five
// others already run on.
//
// DAILY by default: an RC expires on a DATE, so a per-minute sweep would run 1,440 times a day to do nothing
// 1,439 of them, and no farmer would notice the difference. The tick is idempotent regardless (`park()` only
// touches a vehicle that is still active), so a manual run or an overlapping deploy is safe.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { RcExpiryParkingJob } from './rc-expiry-parking.job';

@Injectable()
export class RcExpiryParkingCadenceJob implements ScheduledJob {
  readonly name = 'logistics-rc-expiry-parking';
  private readonly log = new Logger(RcExpiryParkingCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly job: RcExpiryParkingJob, private readonly batchSize: number) {}

  async run(pool: Pool): Promise<void> {
    const r = await this.job.run(pool, this.batchSize, new Date());
    // A tick that found expired RCs and parked none because every tenant has the flag off is NOT silence: "the
    // flag is off" is the answer to "why is that lorry still moving", and an operator should find it in the log
    // rather than in this file.
    this.log.log(`logistics-rc-expiry-parking scanned=${r.scanned} parked=${r.parked} skipped=${r.skipped}`);
  }
}
