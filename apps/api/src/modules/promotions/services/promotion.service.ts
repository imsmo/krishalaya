// modules/promotions/services/promotion.service.ts
// Promotion admin use-cases (tenant_admin / promotion.manage). Every write: one ACID tx (UoW), outbox events in the SAME
// tx (Law 4), audit on every admin action. No version column → budget/active mutations lock the row FOR UPDATE.
//
// PC-56 TENANT-10b
//   • B2 / F-8 / B7 / F-24 — create is reviewed by the same rule function as its review step (domain/promotion.rules):
//     a budget is REQUIRED (uncapped is refused by name), a percent rule may carry a per-order cap, and only the promotion
//     types with an engine (`discount`, `festival`) can be created (PROMO_TYPE_NO_ENGINE).
//   • B6 / F-12 — `promotion.created` audits the budget, the rules and the window; pause / resume carry a REASON and
//     before → after, and pause sets the human-pause bit the festival scheduler respects (F-10).
//   • F-2 — this service still moves no money: a promotion's budget is what the tenant's wallet is ASKED to fund; the
//     money moves at redemption (CouponMoneyService.tryHold) and `spent_minor` is the sum of those reservations (A6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Promotion, parsePromoRules } from '../domain/promotion.entity';
import { DomainEvent, hasEngine } from '../domain/promotions.events';
import { PromotionEntries, promotionReview, reasonOk } from '../domain/promotion.rules';
import { encodeCursor } from '../domain/cursor';
import {
  PromotionNotFoundError, PromotionForbiddenError, PromotionRefusedError, PromotionReasonRequiredError, PromotionNotResumableError, PromotionNotPausableError,
} from '../domain/promotions.errors';
import { PromotionRepository } from '../repositories/promotion.repository';
import { CreatePromotionDto } from '../dto/create-promotion.dto';

export interface PromotionActor { userId: string; canManage: boolean; }

/** The DTO's typed shape → the review's raw entries (one rule function for both). */
export function entriesFromDto(dto: CreatePromotionDto): PromotionEntries {
  const r = dto.rules ?? ({} as CreatePromotionDto['rules']);
  return {
    defaultName: dto.defaultName, promoType: dto.promoType, discountType: r.discountType,
    percentOff: r.percentOff !== undefined ? String(r.percentOff) : undefined, amountOffMinor: r.amountOffMinor,
    maxDiscountMinor: r.maxDiscountMinor, minOrderMinor: r.minOrderMinor, budgetMinor: dto.budgetMinor, startsAt: dto.startsAt, endsAt: dto.endsAt,
  };
}

@Injectable()
export class PromotionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: PromotionRepository,
  ) {}

  /** W2721 — the review (with refusals it IS W2720's form-error). No write. */
  review(actor: PromotionActor, entries: PromotionEntries, now: Date = new Date()) {
    this.assertManager(actor);
    return promotionReview(entries, now);
  }

  async create(tenantId: string, actor: PromotionActor, idemKey: string, dto: CreatePromotionDto, ip: string | null = null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'promotions.create', () =>
      timed(this.metrics, 'promotions.create', { tenant: tenantId }, async () => {
        const review = promotionReview(entriesFromDto(dto));
        if (!review.ready) throw new PromotionRefusedError(review.refusals);
        const rules = parsePromoRules(dto.rules);   // defense-in-depth (also validated by zod at the edge)
        const promo = Promotion.create({ id: uuidv7(), tenantId, promoType: dto.promoType, defaultName: dto.defaultName, rules,
          budgetMinor: BigInt(dto.budgetMinor!), startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, promo);
          const out = this.serialize(promo);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'promotion.created', entityType: 'promotion', entityId: out.id, ip,
            newValue: { name: out.defaultName, promoType: out.promoType, rules: out.rules, budgetMinor: out.budgetMinor, startsAt: out.startsAt, endsAt: out.endsAt, status: out.status } });
          await this.flush(tx, tenantId, out.id, promo.pullEvents());
          return out;
        }, { userId: actor.userId });
      }));
  }

  /**
   * W2724–W2726 — PAUSE or RESUME, with a REASON (audited). Pause sets the human-pause bit, so the festival scheduler never
   * re-opens it (F-10); resume clears it. Refused by name when it would change nothing: pausing a promotion that is not
   * running (PROMOTION_NOT_PAUSABLE) or resuming one whose budget is spent / window has ended (PROMOTION_NOT_RESUMABLE).
   */
  async setActive(tenantId: string, actor: PromotionActor, id: string, isActive: boolean, reason: string | null | undefined, ip: string | null) {
    this.assertManager(actor);
    if (!reasonOk(reason)) throw new PromotionReasonRequiredError();
    return this.uow.run(tenantId, async (tx) => {
      const promo = await this.repo.getForUpdate(tx, tenantId, id);
      if (!promo) throw new PromotionNotFoundError(id);
      const before = promo.status();
      if (isActive) {
        if (before === 'exhausted' || before === 'expired') throw new PromotionNotResumableError(before);
        if (before !== 'paused') throw new PromotionNotResumableError(before);
        promo.resume();
      } else {
        if (before !== 'active' && before !== 'scheduled') throw new PromotionNotPausableError(before);
        promo.pauseBy(actor.userId);
      }
      await this.repo.update(tx, promo);
      const after = this.serialize(promo);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: isActive ? 'promotion.resumed' : 'promotion.paused', entityType: 'promotion', entityId: id,
        oldValue: { status: before, isActive: !isActive }, newValue: { status: after.status, isActive }, reason: reason!.trim(), ip });
      await this.flush(tx, tenantId, id, promo.pullEvents());
      return after;
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, actor: PromotionActor, id: string) {
    this.assertManager(actor);
    const promo = await this.repo.getById(tenantId, id);
    if (!promo) throw new PromotionNotFoundError(id);
    return this.serialize(promo);
  }

  async list(tenantId: string, actor: PromotionActor, q: { activeOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    this.assertManager(actor);
    const [rows, total] = await Promise.all([this.repo.listFor(tenantId, q), this.repo.countFor(tenantId, q.activeOnly)]);
    const items = rows.map((p) => this.serialize(p));
    const last = rows[rows.length - 1]?.toProps();
    return { items, nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null, total };
  }

  // ---------- system (cadence-job) lifecycle — no human actor, called per-tenant by the jobs ----------
  /** promo-budget-watch: deactivate a promotion that has spent its budget. Idempotent. A SYSTEM toggle — the human-pause
   *  bit is untouched, and the status reads `exhausted` (F-10's order) whatever is_active says. */
  async deactivateExhausted(tenantId: string, id: string): Promise<{ deactivated: boolean }> {
    return this.uow.run(tenantId, async (tx) => {
      const promo = await this.repo.getForUpdate(tx, tenantId, id);
      if (!promo || !promo.isActive || !promo.isBudgetExhausted()) return { deactivated: false };
      promo.setActive(false);
      await this.repo.update(tx, promo);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'promotion.budget_closed', entityType: 'promotion', entityId: id,
        oldValue: { isActive: true }, newValue: { isActive: false, status: 'exhausted' }, reason: 'budget spent (promo-budget-watch)' });
      await this.flush(tx, tenantId, id, promo.pullEvents());
      this.metrics.inc('promotions.budget_deactivated', { tenant: tenantId });
      return { deactivated: true };
    }, { userId: 'system' });
  }

  /** festival-campaign-scheduler: align a festival promotion's is_active with its window — open when it opens, close when
   *  it closes. Idempotent. NEVER re-opens a promotion a person paused (F-10) — re-checked here under the row lock, because
   *  a pause can land between the sweep's claim and this call. */
  async applyScheduleWindow(tenantId: string, id: string, now = new Date()): Promise<{ changed: boolean }> {
    return this.uow.run(tenantId, async (tx) => {
      const promo = await this.repo.getForUpdate(tx, tenantId, id);
      if (!promo || promo.isHumanPaused) return { changed: false };
      const desired = promo.isWithinWindow(now) && !promo.isBudgetExhausted();
      if (promo.isActive === desired) return { changed: false };
      promo.setActive(desired);
      await this.repo.update(tx, promo);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: desired ? 'promotion.window_opened' : 'promotion.window_closed', entityType: 'promotion', entityId: id,
        oldValue: { isActive: !desired }, newValue: { isActive: desired }, reason: 'festival window (festival-campaign-scheduler)' });
      await this.flush(tx, tenantId, id, promo.pullEvents());
      this.metrics.inc('promotions.schedule_toggled', { tenant: tenantId, active: String(desired) });
      return { changed: true };
    }, { userId: 'system' });
  }

  private assertManager(actor: PromotionActor): void { if (!actor.canManage) throw new PromotionForbiddenError('requires promotion.manage'); }
  serialize(p: Promotion) {
    const v = p.toProps();
    return { id: v.id, promoType: v.promoType, hasEngine: hasEngine(v.promoType), defaultName: v.defaultName, status: p.status(),
      rules: { discountType: v.rules.discountType, percentOff: v.rules.percentOff, amountOffMinor: v.rules.amountOffMinor?.toString() ?? null, minOrderMinor: v.rules.minOrderMinor?.toString() ?? null, maxDiscountMinor: v.rules.maxDiscountMinor?.toString() ?? null },
      budgetMinor: v.budgetMinor?.toString() ?? null, spentMinor: v.spentMinor.toString(), maxDiscountMinor: v.rules.maxDiscountMinor?.toString() ?? null,
      startsAt: v.startsAt, endsAt: v.endsAt, isActive: v.isActive, pausedByHuman: v.pausedAt != null, pausedAt: v.pausedAt ?? null, createdAt: v.createdAt };
  }
  private async flush(tx: TxContext, tenantId: string, promotionId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'promotion', aggregateId: promotionId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
