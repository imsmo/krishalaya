// modules/orders/jobs/auto-complete-quality-window.job.ts · THE QUALITY-WINDOW AUTO-COMPLETE, ACTUALLY SCHEDULED — IT RELEASES ESCROW.
//
// PC-56 HOTFIX-5 · B1 (founder D2, survey F-1(c) / C-2). Before this wave the class was registered NOWHERE: a delivered order completed only
// if a moderator completed it (the storefront has no buyer "received" act yet — STORE-3a), so the farmer's escrow was never released, the
// review CTA never appeared, and "then escrow releases" was false. It is now a `ScheduledJob` registered by OrdersModule, the same shape as
// the seller-confirm timeout: tenants on the kv_relay pool (`orders` only), the claim per tenant as kv_app, each act its own kv_app
// transaction through `OrderService.autoComplete` (re-lock, re-check `delivered` and `quality_window_ends < now`).
//
// THE MONEY (Law 9 — founder review before production): the completion emits `orders.order_completed` with the settlement payload, and the
// payments module's OrderCompletedHandler hands it to `OrderSettlementService.settle` — the SAME code a buyer's receipt or a moderator's
// `POST /v1/orders/:id/complete` reaches, under the SAME key `settle:<orderId>`: one path, so a second tick, a replayed event or a later
// manual completion settles nothing twice (the state machine refuses `completed → completed`; the ledger key refuses a second post).
// The window is 24 h for every category (order.entity QUALITY_WINDOW_MS) — the per-category setting is owed (F-22), named not built.
// FAIL CLOSED (found proving D2): only an order PAID ONLINE into escrow is completed by the clock — a pay-on-delivery order's settlement
// would credit the seller from an escrow that never held the money (domain/order-clocks.ts QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT; founder Q).
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { OrderRepository } from '../repositories/order.repository';
import { OrderService } from '../services/order.service';
import { QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT, QUALITY_WINDOW_STATUSES } from '../domain/order-clocks';
import type { ClockSweepResult } from './seller-confirm-timeout.job';

export const QUALITY_WINDOW_COMPLETE_JOB = 'quality-window-complete';

export class AutoCompleteQualityWindowJob implements ScheduledJob {
  readonly name = QUALITY_WINDOW_COMPLETE_JOB;
  private readonly log = new Logger(AutoCompleteQualityWindowJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: OrderRepository, private readonly orders: OrderService, private readonly limit = 200) {}

  async sweep(pool: Pool, now: Date = new Date(), onlyTenants?: string[]): Promise<ClockSweepResult> {
    const tenants = onlyTenants ?? await this.repo.tenantsWithDue(pool, QUALITY_WINDOW_STATUSES, 'quality_window_ends', now, [], 500, QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT);
    let claimed = 0, acted = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try {
        ids = await this.uow.run(tenantId, async (tx) => (await this.repo.findDue(tx, tenantId, QUALITY_WINDOW_STATUSES, 'quality_window_ends', now, this.limit, [], QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT)).map((o) => o.id), { userId: 'system' });
      } catch (e) { failed++; this.log.error(`${this.name}: claim failed for tenant ${tenantId}: ${(e as Error).message}`); continue; }
      claimed += ids.length;
      for (const id of ids) {
        try { if (await this.orders.autoComplete(tenantId, id, now)) acted++; }
        catch (e) { failed++; this.log.error(`${this.name}: order ${id} not completed: ${(e as Error).message}`); }
      }
    }
    return { tenants: tenants.length, claimed, acted, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.acted > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.acted} order(s) auto-completed, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}
