// modules/orders/jobs/seller-confirm-timeout.job.ts · THE 24 H SELLER-CONFIRM TIMEOUT (PRD §7.4), ACTUALLY SCHEDULED.
//
// PC-56 HOTFIX-5 · B1 / B2 (founder D2, survey F-1 / F-2 / C-2). Before this wave the class was provided and exported and registered
// NOWHERE (its header said "worker job"; apps/worker hosts no domain job), so no order ever auto-cancelled: under the seeded regime every
// order waits for its seller, and since 2c every order RESERVES its stock at placement — an order nobody confirmed held its lot for ever, and
// HOTFIX-4's `expired` payment state was unreachable. It is now a `ScheduledJob` registered by OrdersModule (the TENANT-11a pattern,
// `auctions/jobs/auctions.cadence-jobs.ts`):
//   • the ONLY read on the runner's kv_relay pool is the tenant list (`OrderRepository.tenantsWithDue`, on `orders`, granted since 0018);
//   • the claim is PER TENANT in kv_app's unit of work under RLS (`findDue`, bounded, SKIP LOCKED);
//   • every act is its OWN kv_app transaction through `OrderService.timeoutCancel`, which re-locks the row and re-checks the rule
//     (domain/order-clocks.ts) — so a second tick changes nothing: the rule refuses a cancelled order, the restock marker is already
//     cleared, the refund key `refund:<orderId>` is already booked. One failure never stops the rest (caught and counted).
// AUCTION ORDERS ARE EXCLUDED (founder D2 / F-2) — in the claim AND in the act: their 48 h balance window and the forfeit rule stand, and
// `AuctionDefaultJob` owns their end. The cadence is the registry's table (core/jobs/clock-cadence.ts), never a literal here.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { OrderRepository } from '../repositories/order.repository';
import { OrderService } from '../services/order.service';
import { SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES, SELLER_CONFIRM_TIMEOUT_STATUSES } from '../domain/order-clocks';

export const SELLER_CONFIRM_TIMEOUT_JOB = 'seller-confirm-timeout';
export interface ClockSweepResult { tenants: number; claimed: number; acted: number; failed: number }

export class SellerConfirmTimeoutJob implements ScheduledJob {
  readonly name = SELLER_CONFIRM_TIMEOUT_JOB;
  private readonly log = new Logger(SellerConfirmTimeoutJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: OrderRepository, private readonly orders: OrderService, private readonly limit = 200) {}

  /** One sweep. `onlyTenants` narrows it (the relay gate and the live spec drive one tenant); production passes none. */
  async sweep(pool: Pool, now: Date = new Date(), onlyTenants?: string[]): Promise<ClockSweepResult> {
    const tenants = onlyTenants ?? await this.repo.tenantsWithDue(pool, SELLER_CONFIRM_TIMEOUT_STATUSES, 'acceptance_deadline', now, SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES);
    let claimed = 0, acted = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try {
        ids = await this.uow.run(tenantId, async (tx) => (await this.repo.findDue(tx, tenantId, SELLER_CONFIRM_TIMEOUT_STATUSES, 'acceptance_deadline', now, this.limit, SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES)).map((o) => o.id), { userId: 'system' });
      } catch (e) { failed++; this.log.error(`${this.name}: claim failed for tenant ${tenantId}: ${(e as Error).message}`); continue; }
      claimed += ids.length;
      for (const id of ids) {
        try { if (await this.orders.timeoutCancel(tenantId, id, now)) acted++; }
        catch (e) { failed++; this.log.error(`${this.name}: order ${id} not cancelled: ${(e as Error).message}`); }
      }
    }
    return { tenants: tenants.length, claimed, acted, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.acted > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.acted} order(s) auto-cancelled, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}
