// modules/dairy/services/d2c.service.ts · PC-54 W54-5. D2C subscription slice + MCC shift summary.
// PLAN price is set ONCE by the seller (dairy.manage) in minor units; the customer SUBSCRIBES to the plan
// (idempotent) and owns pause/resume/cancel. Delivery-run generation + monthly postpaid billing are the
// scheduler/settlement side → stay gated (`d2c-delivery-runs`). Shift summary = Manage-gated aggregate.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { D2cRepository } from '../repositories/d2c.repository';
import { DairyForbiddenError } from '../domain/dairy.errors';
import { canSettleDelivery, isBillable, statementTotalMinor, type DeliveryStatus } from '../domain/d2c-schedule.rules';

export interface DairyActor { userId: string; canManage: boolean }

@Injectable()
export class D2cService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: D2cRepository) {}

  async createPlan(tenantId: string, actor: DairyActor, key: string, dto: { productId: string; defaultName: string; frequency: string; qtyPerDelivery: string; unitCode: string; pricePerDeliveryMinor: string; deliveryWindow?: string }) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(key, actor.userId, 'dairy.d2c.plan', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, (tx) => this.repo.insertPlan(tx, { id, tenantId, sellerUserId: actor.userId, ...dto }), { userId: actor.userId });
      return { id };
    });
  }
  listPlans(tenantId: string) { return this.repo.listPlans(tenantId); }

  async subscribe(tenantId: string, userId: string, key: string, dto: { planId: string; addressId: string; startsOn: string }) {
    return this.idem.remember(key, userId, 'dairy.d2c.subscribe', async () => {
      const plan = await this.repo.getPlan(tenantId, dto.planId);
      if (!plan || !plan.isActive) throw new NotFoundError('plan not found or inactive');
      const id = uuidv7();
      await this.uow.run(tenantId, (tx) => this.repo.insertSubscription(tx, { id, tenantId, planId: dto.planId, customerUserId: userId, addressId: dto.addressId, startsOn: dto.startsOn }), { userId });
      return { id, status: 'active' as const };
    });
  }
  mine(tenantId: string, userId: string) { return this.repo.mySubscriptions(tenantId, userId); }

  async setStatus(tenantId: string, userId: string, id: string, status: 'active' | 'paused' | 'cancelled', pausedUntil?: string) {
    if (status === 'paused' && !pausedUntil) throw new BadRequestError('pausedUntil required to pause');
    const ok = await this.uow.run(tenantId, (tx) => this.repo.setSubscriptionStatus(tx, tenantId, id, userId, status, status === 'paused' ? pausedUntil : undefined), { userId });
    if (!ok) throw new ConflictError('subscription not found, not yours, or already cancelled');
    return { id, status };
  }

  /** PC-54 W54-5 `mcc-shift-summary` (canon 238): the honest day sheet — aggregated from ledgered slips. */
  shiftSummary(tenantId: string, actor: DairyActor, mccId: string, date: string) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestError('date must be YYYY-MM-DD');
    return this.repo.shiftSummary(tenantId, mccId, date);
  }

  // ===== PC-55 A5 · deliveries & the postpaid statement =====
  /** Delivery list. A customer sees only their own drops; a seller only their plans' drops. */
  deliveries(tenantId: string, actor: DairyActor, q: { box: 'customer' | 'seller'; from: string; to: string; status?: string; limit: number }) {
    if (q.box === 'seller' && !actor.canManage) throw new DairyForbiddenError('requires dairy.manage for the seller view');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) {
      throw new BadRequestError('from/to must be YYYY-MM-DD with from <= to');
    }
    return this.repo.listDeliveries(tenantId, { ...q, userId: actor.userId });
  }

  /** Settle one drop (seller-side). Idempotent by state: a settled outcome is NEVER overwritten, because a
   *  delivered drop is billable and re-marking it would change what a household owes. */
  async settleDelivery(tenantId: string, actor: DairyActor, id: string, dueOn: string, status: 'delivered' | 'skipped' | 'failed', dto: { qty?: string; qualityMeta?: Record<string, unknown> }) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new BadRequestError('dueOn (the drop date) is required as YYYY-MM-DD');
    return this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.lockDelivery(tx, tenantId, id, dueOn);
      if (!d) throw new NotFoundError('delivery not found for that date');
      if (!canSettleDelivery(d.status as DeliveryStatus)) {
        // Same outcome twice is a no-op (retry-safe); a DIFFERENT outcome is refused, since money follows this.
        if (d.status === status) return { id, dueOn, status: d.status as DeliveryStatus, unchanged: true };
        throw new ConflictError(`this drop is already ${d.status} — a settled delivery is never rewritten`);
      }
      await this.repo.settleDelivery(tx, tenantId, id, dueOn, status, dto.qty, dto.qualityMeta);
      return { id, dueOn, status, billable: isBillable(status) };
    }, { userId: actor.userId });
  }

  /** MONTHLY POSTPAID STATEMENT — a ledgered aggregate of DELIVERED drops × the plan's own price.
   *  It states plainly that no charge has been raised: the payment leg waits for gateway keys. */
  async statement(tenantId: string, actor: DairyActor, q: { box: 'customer' | 'seller'; from: string; to: string }) {
    if (q.box === 'seller' && !actor.canManage) throw new DairyForbiddenError('requires dairy.manage for the seller view');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) {
      throw new BadRequestError('from/to must be YYYY-MM-DD with from <= to');
    }
    const lines = await this.repo.statement(tenantId, { ...q, userId: actor.userId });
    // Re-derive the grand total with the pure integer helper (the DB already summed per line; this proves the
    // arithmetic in one place and keeps every figure a minor-unit STRING — no floats anywhere).
    const grandTotalMinor = lines.reduce((acc, l) => (BigInt(acc) + BigInt(statementTotalMinor(Number(l.deliveredCount), String(l.pricePerDeliveryMinor)))).toString(), '0');
    return {
      period: { from: q.from, to: q.to },
      lines,
      grandTotalMinor,
      billing: { mode: 'monthly_postpaid', charged: false, note: 'This is a statement of delivered drops, not an invoice. Collection runs when the payment gateway is configured.' },
    };
  }
}
