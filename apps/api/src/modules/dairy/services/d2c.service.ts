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
}
