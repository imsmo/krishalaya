// modules/promotions/services/coupon.service.ts
// Coupon admin (review/create/delete/list) + the VALIDATE (preview) and REDEEM (authoritative) use-cases. Outbox in-tx
// (Law 4), audit on every admin act.
//
// PC-56 TENANT-10b — THE REDEMPTION IS NOW A MONEY ACT, AND A DECLINE IS NO LONGER AN ABORT.
//   • F-2 / A1: redeem RESERVES the discount from the tenant's wallet (tenant Main → Hold) in the checkout's own
//     transaction, BEFORE the redemption row is written, and stores the hold's txn id on it. If the tenant cannot fund it,
//     the coupon is NOT applied: the checkout continues at full price and carries a kind notice (TENANT_FUNDS_UNAVAILABLE).
//   • F-21: a spent budget and a reached per-user limit take the SAME kind path — they used to throw inside the checkout
//     transaction and take the buyer's whole order down. Every outcome is an answer (`couponDecision`), never an exception.
//   • F-22 / A5: validate() (the preview) asks the same decision over the same facts — the per-user limit, the budget, and
//     the tenant's funds (a read-only balance check) — so the preview shows exactly what checkout will do.
//   • A4: every validate / redeem outcome is recorded in `coupon_redemption_attempts` (applied or declined, with why).
//   • A6: `promotions.spent_minor` moves only together with a hold (reserve) or a release — never bookkeeping alone.
//   • F-12: create audits the full coupon; delete needs a reason, audits what it deleted, and a missing id is a 404.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Coupon } from '../domain/coupon.entity';
import { CouponRedemption } from '../domain/coupon-redemption.entity';
import { Promotion } from '../domain/promotion.entity';
import { DomainEvent, PromotionEventType } from '../domain/promotions.events';
import { CouponFacts as DecisionFacts, CouponNotice, CouponOutcome, DeclinedOutcome, couponDecision, couponNotice } from '../domain/coupon-outcome';
import { CouponEntries, couponReview, reasonOk } from '../domain/promotion.rules';
import { encodeCursor } from '../domain/cursor';
import {
  PromotionForbiddenError, CouponNotFoundError, DuplicateRedemptionError, CouponCodeExistsError, CouponRefusedError, PromotionReasonRequiredError,
} from '../domain/promotions.errors';
import { PromotionRepository } from '../repositories/promotion.repository';
import { CouponRepository } from '../repositories/coupon.repository';
import { CouponRedemptionRepository } from '../repositories/coupon-redemption.repository';
import { CouponAttemptRepository, AttemptStage } from '../repositories/coupon-attempt.repository';
import { CouponMoneyService } from './coupon-money.service';
import { CreateCouponDto } from '../dto/create-coupon.dto';

export interface PromotionActor { userId: string; canManage: boolean; }

/** What a redeem / validate answers. A declined coupon carries the buyer's kind notice, never an error code. */
export type CouponResult =
  | { applied: true; outcome: 'applied'; code: string; promotionId: string; orderId: string | null; discountMinor: string; holdTxnId: string | null }
  | { applied: false; outcome: DeclinedOutcome; code: string; promotionId: string | null; orderId: string | null; discountMinor: '0'; notice: CouponNotice };

@Injectable()
export class CouponService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly promos: PromotionRepository,
    private readonly coupons: CouponRepository,
    private readonly redemptions: CouponRedemptionRepository,
    private readonly attempts: CouponAttemptRepository,
    private readonly money: CouponMoneyService,
  ) {}

  // ---------- admin ----------
  /** W2540 — the review (and, with refusals, W2539's form-error). The same rule function the act re-runs in its tx. */
  async reviewCoupon(tenantId: string, actor: PromotionActor, entries: CouponEntries) {
    if (!actor.canManage) throw new PromotionForbiddenError('requires promotion.manage');
    const promo = entries.promotionId && /^[0-9a-f-]{36}$/i.test(entries.promotionId.trim()) ? await this.promos.getById(tenantId, entries.promotionId.trim()) : null;
    const codeTaken = entries.code && /^[A-Za-z0-9_-]{3,40}$/.test(entries.code.trim()) ? await this.coupons.codeTaken(tenantId, entries.code) : false;
    return couponReview(entries, { promotion: promo ? { status: promo.status(), promoType: promo.promoType } : null, codeTaken });
  }

  async createCoupon(tenantId: string, actor: PromotionActor, idemKey: string, dto: CreateCouponDto, ip: string | null = null) {
    if (!actor.canManage) throw new PromotionForbiddenError('requires promotion.manage');
    return this.idem.remember(idemKey, actor.userId, 'promotions.coupon_create', () =>
      timed(this.metrics, 'promotions.coupon_create', { tenant: tenantId }, async () =>
        this.uow.run(tenantId, async (tx) => {
          const entries: CouponEntries = { promotionId: dto.promotionId, code: dto.code, maxUses: dto.maxUses?.toString(), perUserLimit: dto.perUserLimit?.toString() };
          const promo = await this.promos.getInTx(tx, tenantId, dto.promotionId);
          const review = couponReview(entries, { promotion: promo ? { status: promo.status(), promoType: promo.promoType } : null, codeTaken: await this.coupons.codeTaken(tenantId, dto.code, tx) });
          if (!review.ready) throw new CouponRefusedError(review.refusals);
          const coupon = Coupon.create({ id: uuidv7(), tenantId, promotionId: dto.promotionId, code: dto.code, maxUses: dto.maxUses ?? null, perUserLimit: dto.perUserLimit });
          if (!(await this.coupons.insert(tx, coupon))) throw new CouponCodeExistsError();
          const v = coupon.toProps();
          const snapshot = { code: v.code, promotionId: v.promotionId, promotionName: promo!.toProps().defaultName, maxUses: v.maxUses, perUserLimit: v.perUserLimit };
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'coupon.created', entityType: 'coupon', entityId: coupon.id, newValue: snapshot, ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'coupon', aggregateId: coupon.id, eventType: PromotionEventType.CouponCreated, payload: { v: 1, couponId: coupon.id, promotionId: dto.promotionId } });
          return { id: coupon.id, code: v.code, promotionId: dto.promotionId, maxUses: v.maxUses, perUserLimit: v.perUserLimit };
        }, { userId: actor.userId })));
  }

  /** W2543–W2545 — soft delete WITH A REASON. F-12: a delete that deleted nothing is a 404 and writes no audit row. */
  async deleteCoupon(tenantId: string, actor: PromotionActor, id: string, reason: string | null | undefined, ip: string | null) {
    if (!actor.canManage) throw new PromotionForbiddenError('requires promotion.manage');
    if (!reasonOk(reason)) throw new PromotionReasonRequiredError();
    return this.uow.run(tenantId, async (tx) => {
      const before = await this.coupons.getByIdForUpdate(tx, tenantId, id);
      if (!before || before.isDeleted) throw new CouponNotFoundError();
      const n = await this.coupons.softDelete(tx, tenantId, id);
      if (n !== 1) throw new CouponNotFoundError();
      const v = before.toProps();
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'coupon.deleted', entityType: 'coupon', entityId: id,
        oldValue: { code: v.code, promotionId: v.promotionId, uses: v.uses, maxUses: v.maxUses, perUserLimit: v.perUserLimit, deleted: false },
        newValue: { deleted: true }, reason: reason!.trim(), ip });
      return { id, deleted: true };
    }, { userId: actor.userId });
  }

  async listForPromotion(tenantId: string, actor: PromotionActor, promotionId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    if (!actor.canManage) throw new PromotionForbiddenError('requires promotion.manage');
    const rows = await this.coupons.listForPromotion(tenantId, promotionId, q);
    const items = rows.map((c) => { const v = c.toProps(); return { id: v.id, promotionId: v.promotionId, code: v.code, maxUses: v.maxUses, uses: v.uses, perUserLimit: v.perUserLimit, createdAt: v.createdAt }; });
    const last = rows[rows.length - 1]?.toProps();
    return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }

  // ---------- preview (read-only for money; records the attempt) ----------
  /** A5 — the SAME decision checkout makes, over the same facts (per-user limit, budget, the tenant's funds). */
  async validate(tenantId: string, userId: string, code: string, subtotalMinor: bigint): Promise<CouponResult> {
    const coupon = await this.coupons.getByCode(tenantId, code);
    const promo = coupon?.promotionId ? await this.promos.getById(tenantId, coupon.promotionId) : null;
    const discount = promo ? promo.computeDiscount(subtotalMinor) : 0n;
    const used = coupon ? await this.redemptions.countForUser(null, tenantId, coupon.id, userId) : 0;
    return this.uow.run(tenantId, async (tx) => {
      let outcome = couponDecision(this.facts(coupon, promo, discount, used, null));
      if (outcome === 'applied') outcome = couponDecision(this.facts(coupon, promo, discount, used, await this.money.tenantCanFund(tx, tenantId, discount)));
      await this.record(tx, tenantId, coupon, null, userId, 'preview', outcome, discount);
      return this.result(outcome, code, coupon, promo, null, discount, null);
    }, { userId });
  }

  // ---------- authoritative redemption (atomic) ----------
  async redeem(tenantId: string, userId: string, idemKey: string, dto: { code: string; orderId: string; subtotalMinor: bigint }) {
    return this.idem.remember(idemKey, userId, 'promotions.redeem', () =>
      timed(this.metrics, 'promotions.redeem', { tenant: tenantId }, () =>
        this.uow.run(tenantId, (tx) => this.redeemInTx(tx, tenantId, userId, dto), { userId })));
  }

  /**
   * The atomic redemption CORE — called inside an existing tx (orders' checkout) so the reservation, the redemption and
   * the order commit together. Locks the coupon and its promotion FOR UPDATE; decides; on `applied` posts the HOLD first
   * (A1) and only then writes the redemption carrying its txn id. A decline returns `applied: false` with a kind notice —
   * the caller places the order at full price. Re-redeeming the same (coupon, order) is still refused loudly
   * (DuplicateRedemptionError): that is a replay bug, not a buyer's coupon.
   */
  async redeemInTx(tx: TxContext, tenantId: string, userId: string, dto: { code: string; orderId: string; subtotalMinor: bigint }): Promise<CouponResult> {
    const coupon = await this.coupons.getByCodeForUpdate(tx, tenantId, dto.code);
    // a replay of the same (coupon, order) is detected FIRST — before any rule could answer it as a buyer's decline
    if (coupon && (await this.redemptions.existsFor(tx, tenantId, coupon.id, dto.orderId))) throw new DuplicateRedemptionError();
    const promo = coupon?.promotionId ? await this.promos.getForUpdate(tx, tenantId, coupon.promotionId) : null;
    const discount = promo ? promo.computeDiscount(dto.subtotalMinor) : 0n;
    const used = coupon ? await this.redemptions.countForUser(tx, tenantId, coupon.id, userId) : 0;
    let outcome: CouponOutcome = couponDecision(this.facts(coupon, promo, discount, used, null));
    let holdTxnId: string | null = null;
    if (outcome === 'applied') {
      holdTxnId = await this.money.tryHold(tx, { tenantId, orderId: dto.orderId, couponId: coupon!.id, amountMinor: discount, initiatedBy: userId });
      if (!holdTxnId) outcome = 'tenant_funds_unavailable';
    }
    if (outcome === 'applied') {
      const redemption = CouponRedemption.create({ id: uuidv7(), couponId: coupon!.id, tenantId, userId, orderId: dto.orderId, amountMinor: discount });
      if (!(await this.redemptions.insert(tx, redemption, holdTxnId))) throw new DuplicateRedemptionError();
      coupon!.consumeUse();
      promo!.reserve(discount);
      await this.coupons.updateUses(tx, coupon!);
      await this.promos.update(tx, promo!);
      await this.flush(tx, tenantId, coupon!.id, [
        { type: PromotionEventType.CouponRedeemed, payload: { couponId: coupon!.id, promotionId: promo!.id, orderId: dto.orderId, userId, discountMinor: discount.toString(), holdTxnId } },
        ...promo!.pullEvents(),
      ]);
      this.metrics.inc('promotions.redeemed', { tenant: tenantId });
    } else {
      this.metrics.inc('promotions.redeem_declined', { tenant: tenantId, outcome });
    }
    await this.record(tx, tenantId, coupon, dto.orderId, userId, 'redeem', outcome, discount);
    return this.result(outcome, dto.code, coupon, promo, dto.orderId, discount, holdTxnId);
  }

  async listMyRedemptions(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.redemptions.listForUser(tenantId, userId, q);
    const last = rows[rows.length - 1];
    const items = rows.map(({ createdAtRaw: _raw, ...x }) => x);
    return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }

  // ---------- helpers ----------
  private facts(coupon: Coupon | null, promo: Promotion | null, discount: bigint, used: number, funds: boolean | null): DecisionFacts {
    return {
      coupon: coupon && !coupon.isDeleted ? { hasGlobalCapacity: coupon.hasGlobalCapacity(), perUserLimit: coupon.perUserLimit } : null,
      promotion: promo ? { status: promo.status(), canReserve: promo.canReserve(discount) } : null,
      discountMinor: discount, usedByUser: used, fundsAvailable: funds,
    };
  }
  private async record(tx: TxContext, tenantId: string, coupon: Coupon | null, orderId: string | null, userId: string, stage: AttemptStage, outcome: CouponOutcome, discount: bigint) {
    await this.attempts.insert(tx, { tenantId, couponId: coupon?.id ?? null, orderId, userId, stage, outcome, amountMinor: coupon ? discount : null });
  }
  private result(outcome: CouponOutcome, code: string, coupon: Coupon | null, promo: Promotion | null, orderId: string | null, discount: bigint, holdTxnId: string | null): CouponResult {
    const c = coupon?.code ?? code.trim().toUpperCase();
    if (outcome === 'applied') return { applied: true, outcome, code: c, promotionId: promo!.id, orderId, discountMinor: discount.toString(), holdTxnId };
    return { applied: false, outcome, code: c, promotionId: promo?.id ?? null, orderId, discountMinor: '0', notice: couponNotice(outcome) };
  }
  private async flush(tx: TxContext, tenantId: string, aggId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'coupon', aggregateId: aggId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
