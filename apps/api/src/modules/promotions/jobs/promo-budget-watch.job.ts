// modules/promotions/jobs/promo-budget-watch.job.ts
// Worker job (kv_relay): the BACKSTOP that deactivates promotions which have burned through their budget.
// The synchronous redeem path already emits BudgetExhausted + (at checkout) can't overspend, but the async
// backstop recorder (CouponRedemptionService, enforceBudget:false) can nudge spent_minor over budget on a
// rare decoupled path — this sweep makes sure such promotions actually flip is_active=false so no further
// coupons redeem. Claims exhausted-but-still-active promotions across tenants (SKIP LOCKED, bounded), then
// deactivates each via PromotionService (its own tx + outbox). IDEMPOTENT: a promotion already inactive is
// never re-claimed. PC-56 TENANT-10b (F-9): scheduled through SCHEDULED_JOB_REGISTRY by
// jobs/promotions.cadence-jobs.ts, which hands it the runner's kv_relay Pool (it was instantiated nowhere before).
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { PromotionRepository } from '../repositories/promotion.repository';
import { PromotionService } from '../services/promotion.service';

export class PromoBudgetWatchJob {
  constructor(private readonly systemPool: Pool, private readonly repo: PromotionRepository, private readonly promotions: PromotionService) {}

  async run(limit = 200): Promise<{ scanned: number; deactivated: number; failed: number }> {
    const client = await this.systemPool.connect();
    let exhausted: Array<{ id: string; tenantId: string }> = [];
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: '', userId: 'system' };
      exhausted = await this.repo.findBudgetExhausted(tx, limit);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }

    let deactivated = 0, failed = 0;
    for (const p of exhausted) { try { if ((await this.promotions.deactivateExhausted(p.tenantId, p.id)).deactivated) deactivated++; } catch { failed++; } }
    return { scanned: exhausted.length, deactivated, failed };
  }
}
