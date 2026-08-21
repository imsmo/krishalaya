// modules/dairy/services/milk-quality.service.ts · W168's flag protocol as writes (PC-56 TENANT-6b-1).
//
// W168's three steps and its footer promise:
//   1. *"Operator re-tests sealed sample with member present (today evening shift)"*
//   2. *"Confirmed dilution → pour rejected, gentle first-time conversation"*
//   3. *"Repeat pattern (3+ in 90d) → dairy committee review"*
//      *"Flag decisions are recorded · pour-level hold, never wallet freeze · member notified in Gujarati"*
//
// **NONE of this existed.** The flag was two columns on a pour and the story stopped: no re-test, no outcome, no
// decider, no notification — and the pour was billed and PAID at full price regardless. This service is the missing
// half, and its whole design point is that the REVIEW and the POUR'S MONEY move in ONE transaction. A decision that
// updates the record but not the hold (or the hold but not the record) is the shape of bug that leaves a farmer's money
// in a state nobody is looking at.
//
// "never wallet freeze" is honoured structurally rather than promised: nothing here touches a wallet. The hold lives on
// the pour, so the member's OTHER pours bill and pay normally while this one waits — which is exactly what W168 says.
import { DairyNoticeVarsService } from './dairy-notice-vars.service';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { DomainEvent } from '../domain/dairy.events';
import { holdFor } from '../domain/milk-quality.state';
import { DairyForbiddenError, QualityReviewNotFoundError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

export interface RetestInput { memberPresent: boolean; sampleSealed?: boolean; note?: string | null }
export interface DecideInput { outcome: 'cleared' | 'rejected'; note?: string | null }

@Injectable()
export class MilkQualityService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly reviews: MilkQualityReviewRepository,
    private readonly collections: MilkCollectionRepository,
    // [PC-56 TENANT-6d-7] The two things the decision notice needed and did not have: WHO is told (the farmer behind
    // the membership — this event named no recipient at all, so it has never sent a message) and IN WHICH WORDS.
    private readonly memberships: DairyMembershipRepository,
    private readonly noticeVars: DairyNoticeVarsService,
  ) {}

  /**
   * Step 1 — the re-test. Records who did it, when, and **whether the member was there**, which is the dignity half of
   * W168's promise and is never defaulted: a platform that assumes the member was present turns a safeguard into a
   * formality. The pour stays held: a sample tested is not a sample cleared.
   */
  async retest(tenantId: string, actor: DairyActor, idemKey: string, reviewId: string, input: RetestInput) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.quality.retest', () =>
      timed(this.metrics, 'dairy.quality.retest', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const review = await this.reviews.getForUpdate(tx, tenantId, reviewId);
          if (!review) throw new QualityReviewNotFoundError(reviewId);
          review.retest(actor.userId, new Date(), input.memberPresent, input.note ?? null);
          if (input.sampleSealed) review.markSampleSealed();
          await this.reviews.update(tx, tenantId, review);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.quality_review.retested',
            entityType: 'milk_quality_review', entityId: reviewId,
            newValue: { memberPresent: input.memberPresent, sampleSealed: review.toProps().sampleSealed },
          });
          return review.toJSON();
        }, { userId: actor.userId })));
  }

  /**
   * Step 2 — the decision, and the pour's money with it.
   *
   * `cleared` releases the hold so the pour bills normally in the next cycle; `rejected` means the cooperative did not
   * buy that milk and the pour is never billable. The pour keeps its priced `amount_minor` in both cases: zeroing a
   * rejected pour would destroy the record of what the milk would have been worth, which is the number a committee and
   * a member argue about.
   *
   * The hold moves through the collection's own state machine via `holdFor(status)` — ONE function decides what a review
   * status means for money, so the two can never drift into a review marked `cleared` beside a pour still `held`.
   */
  async decide(tenantId: string, actor: DairyActor, idemKey: string, reviewId: string, input: DecideInput) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.quality.decide', () =>
      timed(this.metrics, 'dairy.quality.decide', { tenant: tenantId, outcome: input.outcome }, () =>
        this.uow.run(tenantId, async (tx) => {
          const review = await this.reviews.getForUpdate(tx, tenantId, reviewId);
          if (!review) throw new QualityReviewNotFoundError(reviewId);
          const before = review.status;
          const membership = await this.memberships.getById(tenantId, review.toProps().membershipId, tx);
          review.decide(input.outcome, actor.userId, new Date(), input.note ?? null,
            membership?.farmerUserId ?? null, await this.noticeVars.qualityDecided(tx, { outcome: input.outcome }));
          await this.reviews.update(tx, tenantId, review);
          // The pour's hold, in the same transaction. `from` is the hold the review's PREVIOUS status implied, so a
          // concurrent decision on the same pour loses the race loudly instead of overwriting the first outcome.
          await this.collections.setHoldState(tx, tenantId, review.collectionRef, holdFor(review.status), holdFor(before));
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: `dairy.quality_review.${input.outcome}`,
            entityType: 'milk_quality_review', entityId: reviewId,
            oldValue: { status: before }, newValue: { status: review.status, holdState: review.holdState },
          });
          await this.flush(tx, tenantId, reviewId, review.pullEvents());
          return review.toJSON();
        }, { userId: actor.userId })));
  }

  async get(tenantId: string, actor: DairyActor, reviewId: string) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const review = await this.reviews.getById(tenantId, reviewId);
    if (!review) throw new QualityReviewNotFoundError(reviewId);
    return review.toJSON();
  }

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'milk_quality_review', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
