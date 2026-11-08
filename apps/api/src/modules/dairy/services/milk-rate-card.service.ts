// modules/dairy/services/milk-rate-card.service.ts · cooperative-admin milk pricing (rate cards).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create/approve (Law 3), authz THROWS (Law 6).
//
// [PC-56 HOTFIX-12] NO RATE CHANGE WITHOUT A SECOND PERSON AND A RECORD (founder Q1-A + Q1-sub, 2026-11-08; migration 0234).
// Before this hotfix `create` was the whole lifecycle: one person, no audit row, any `effectiveFrom` (the past included),
// priced from the moment it committed, and nothing closed the card it replaced (survey F-1, C-3, C-9). Now:
//   • CREATE records the creator and writes ONE audit row with the whole card; a start that is not after the tenant's today (in its
//     own zone) is refused `RATE_CARD_BACKDATED`, before the idempotency record and before any write; the new card
//     AWAITS A SECOND PERSON and prices nothing (`resolveActive` reads approved cards only).
//   • APPROVE is a second person's act: the creator is refused `RATE_CARD_SECOND_PERSON_REQUIRED` (403); a card whose
//     start has passed is refused `RATE_CARD_BACKDATED`; a clash with another approved card for the milk type is refused
//     `RATE_CARD_OVERLAP` — all before the idempotency record and any write. Then, in ONE transaction: the predecessor in
//     force is closed the day before the new card starts (AT APPROVAL, never at create, so an unapproved card never leaves
//     a day on which nothing prices), the approval is stamped, one audit row is written, and the members whose milk the
//     card prices are told through the outbox (push + in-app, their own language, never SMS).
//   • An already-approved card answers `RATE_CARD_ALREADY_APPROVED` (409) INSIDE the idempotency record, deliberately:
//     checked before it, every same-key replay of a successful approval would turn into a 409.
// The database holds the same rules whatever writes the row (0234: the CHECKs, the guard trigger, the exclusion).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkRateCard } from '../domain/milk-rate-card.entity';
import { PricingModel, AnimalType, DairyEventType } from '../domain/dairy.events';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { CreateRateCardDto } from '../dto/create-milk-rate-card.dto';
import {
  RateCardNotFoundError, DairyForbiddenError, RateCardBackdatedError, RateCardSecondPersonRequiredError,
  RateCardAlreadyApprovedError, RateCardOverlapError,
} from '../domain/dairy.errors';
import { chunkRecipients } from '../domain/dairy-diversion';
import { rateCardApprovedVars } from '../domain/dairy-notice-vars';
import { DairyActor } from './mcc-centre.service';

const big = (s?: string) => (s == null ? null : BigInt(s));

/** `YYYY-MM-DD` minus one day, by calendar arithmetic in UTC — a whole day, never a timezone shift. PURE. */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * The approval's overlap verdict over the approved cards meeting the new card's days. PURE.
 * `predecessors` start BEFORE the new card (they are closed the day before it starts); anything starting on or after
 * its start is a clash (the same start date, or a later approved card inside its days) and refuses the approval.
 */
export function overlapVerdict(card: { effectiveFrom: string }, meeting: ReadonlyArray<{ id: string; effectiveFrom: string }>): { predecessors: string[]; clashes: string[] } {
  return {
    predecessors: meeting.filter((c) => c.effectiveFrom < card.effectiveFrom).map((c) => c.id),
    clashes: meeting.filter((c) => c.effectiveFrom >= card.effectiveFrom).map((c) => c.id),
  };
}

@Injectable()
export class MilkRateCardService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: MilkRateCardRepository,
    // [PC-56 HOTFIX-12] the record: an audit row on create and on approval (survey C-3 — none existed).
    private readonly audit: AuditWriter,
  ) {}

  /** The card as a viewer reads it: its approval state, and whether the viewer created / approved it — never an id. */
  private view(card: MilkRateCard, viewerId?: string) {
    return { ...card.toJSON(),
      createdByYou: viewerId != null && card.createdBy === viewerId,
      approvedByYou: viewerId != null && card.approvedBy === viewerId };
  }

  async create(tenantId: string, actor: DairyActor, idemKey: string, dto: CreateRateCardDto, ip: string | null = null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    // [PC-56 HOTFIX-12 · founder Q1-A + follow-up 2026-11-08] tomorrow at the earliest — today itself is refused, so pricing changes
    // only at midnight and no day is split between two cards. The tenant's today, in its own zone. Refused
    // BEFORE the idempotency record and before any write.
    const today = await this.repo.tenantToday(tenantId);
    if (dto.effectiveFrom <= today) throw new RateCardBackdatedError(dto.effectiveFrom, today);
    return this.idem.remember(idemKey, actor.userId, 'dairy.ratecard.create', () =>
      timed(this.metrics, 'dairy.ratecard.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const card = MilkRateCard.create({ id: uuidv7(), tenantId, defaultName: dto.defaultName, animalType: dto.animalType as AnimalType,
            pricingModel: dto.pricingModel as PricingModel, ratePerKgFatMinor: big(dto.ratePerKgFatMinor), ratePerKgSnfMinor: big(dto.ratePerKgSnfMinor),
            baseRatePerLitreMinor: big(dto.baseRatePerLitreMinor),
            // [PC-56 TENANT-6b-1 LIVE FINDING] This line was missing. The DTO accepted `bonusSlabs`, the entity priced
            // them, the repository persisted them — and the service in between dropped the caller's answer on the
            // floor, so every card came back with `bonus_rules = []` and W168's premium band still paid nothing. The
            // same defect shape TENANT-5d found on a delivery failure reason: a write that discards what it was told.
            bonusSlabs: dto.bonusSlabs,
            effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null,
            // [PC-56 HOTFIX-12] the first person, recorded (0001's created_by, written by nothing before this hotfix).
            createdBy: actor.userId });
          await this.repo.insert(tx, card);
          // [PC-56 HOTFIX-12] ONE audit row with the whole card — the record F-1 said did not exist.
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.rate_card.created', entityType: 'milk_rate_card',
            entityId: card.id, newValue: { ...card.toJSON(), createdBy: actor.userId }, ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'milk_rate_card', aggregateId: card.id, eventType: DairyEventType.RateCardCreated, payload: { v: 1, rateCardId: card.id, animalType: dto.animalType } });
          return this.view(card, actor.userId);
        }, { userId: actor.userId })));
  }

  /**
   * [PC-56 HOTFIX-12 · founder Q1-A] THE SECOND PERSON. See the header for the order of the refusals and why
   * `RATE_CARD_ALREADY_APPROVED` sits inside the idempotency record.
   */
  async approve(tenantId: string, actor: DairyActor, idemKey: string, id: string, ip: string | null = null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const pre = await this.repo.getById(tenantId, id);
    if (!pre) throw new RateCardNotFoundError(id);
    if (!pre.isApproved) {
      // Refused BEFORE the idempotency record and any write (the ordering spies pin it).
      if (pre.createdBy === null || pre.createdBy === actor.userId) throw new RateCardSecondPersonRequiredError(id);
      const today = await this.repo.tenantToday(tenantId);
      if (pre.effectiveFrom <= today) throw new RateCardBackdatedError(pre.effectiveFrom, today);
      const { clashes } = overlapVerdict(pre, await this.repo.approvedMeeting(null, tenantId, pre.animalType, pre.effectiveFrom, pre.effectiveTo, id));
      if (clashes.length > 0) throw new RateCardOverlapError(id, clashes);
    }
    return this.idem.remember(idemKey, actor.userId, 'dairy.ratecard.approve', () =>
      timed(this.metrics, 'dairy.ratecard.approve', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          // The same checks again, on the LOCKED row: a second approver racing the first, or a day boundary crossed
          // between the pre-check and the lock, must still be refused.
          const card = await this.repo.getForUpdate(tx, tenantId, id);
          if (!card) throw new RateCardNotFoundError(id);
          if (card.isApproved) throw new RateCardAlreadyApprovedError(id);
          if (card.createdBy === null || card.createdBy === actor.userId) throw new RateCardSecondPersonRequiredError(id);
          const today = await this.repo.tenantToday(tenantId, tx);
          if (card.effectiveFrom <= today) throw new RateCardBackdatedError(card.effectiveFrom, today);
          const meeting = await this.repo.approvedMeeting(tx, tenantId, card.animalType, card.effectiveFrom, card.effectiveTo, id);
          const { predecessors, clashes } = overlapVerdict(card, meeting);
          if (clashes.length > 0) throw new RateCardOverlapError(id, clashes);
          // THE PREDECESSOR IS CLOSED HERE, AT APPROVAL — the day before the new card starts — so the day the new card
          // starts is the first day it prices, and until it is approved the old card keeps pricing every day.
          const closeOn = dayBefore(card.effectiveFrom);
          const closed = meeting.filter((c) => predecessors.includes(c.id))
            .map((c) => ({ id: c.id, effectiveToWas: c.effectiveTo, effectiveTo: closeOn }));
          for (const c of closed) await this.repo.closeOn(tx, tenantId, c.id, closeOn);
          const at = new Date();
          await this.repo.approve(tx, tenantId, id, actor.userId, at);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.rate_card.approved', entityType: 'milk_rate_card', entityId: id,
            oldValue: { approvalState: 'awaiting_second_person', createdBy: card.createdBy },
            newValue: { approvalState: 'approved', approvedBy: actor.userId, approvedAt: at.toISOString(), animalType: card.animalType,
              effectiveFrom: card.effectiveFrom, effectiveTo: card.effectiveTo, closedPredecessors: closed }, ip });
          // THE MEMBERS ARE TOLD (Q1-A): one event per chunk of the members whose milk this card prices; always at least
          // one event, so a cooperative's own subscribers see the approval even when no member is enrolled yet.
          const recipients = await this.repo.memberUserIdsPricedBy(tx, tenantId, card.animalType);
          const chunks = chunkRecipients(recipients);
          for (const chunk of chunks.length > 0 ? chunks : [[]]) {
            await this.outbox.write(tx, { tenantId, aggregateType: 'milk_rate_card', aggregateId: id, eventType: DairyEventType.RateCardApproved,
              payload: { v: 1, rateCardId: id, animalType: card.animalType, effectiveFromDay: card.effectiveFrom, effectiveToDay: card.effectiveTo,
                predecessorIds: closed.map((c) => c.id), recipientUserIds: chunk,
                ...rateCardApprovedVars({ cardName: card.defaultName, effectiveFrom: card.effectiveFrom }) } });
          }
          this.metrics.inc('dairy.ratecard.approved', { tenant: tenantId });
          const after = await this.repo.getById(tenantId, id, tx);
          return this.view(after ?? card, actor.userId);
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, id: string, viewerId?: string) { const c = await this.repo.getById(tenantId, id); if (!c) throw new RateCardNotFoundError(id); return this.view(c, viewerId); }
  async list(tenantId: string, q: { animalType?: string; activeOnly: boolean }, viewerId?: string) { return (await this.repo.listFor(tenantId, q)).map((c) => this.view(c, viewerId)); }
}
