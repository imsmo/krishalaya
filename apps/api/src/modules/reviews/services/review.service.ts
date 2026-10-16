// modules/reviews/services/review.service.ts
// Review use-cases. Every write: one ACID tx (UoW), status via the machine (Law 5), outbox events in
// the SAME tx (Law 4), audit on moderation. NO money. Reviews are VERIFIED-PURCHASE only: the target
// (seller↔buyer) is resolved from the order's eligibility row (recorded when the order completed) —
// the client never supplies target_id, and a non-party can't review (anti-IDOR / anti-spam). No version
// column → mutations lock the row FOR UPDATE; the (order, reviewer, target) UNIQUE stops duplicates.
//
// PC-56 HOTFIX-7 · B5 (survey STORE-5 F-5) — NO PERSON ON A REVIEW READ THAT IS NOT YOURS TO HOLD. Every authenticated read goes through ONE
// projection decided by the viewer (domain/review-projection.ts): a stranger gets the public row, the author their own (with the order, never
// the target's or their own id), the organisation's side (the reviewed seller or any organisation role here) the buyer and the order, a
// moderator everything. The PUBLIC reads are keyed by the ORGANISATION (`targetType=organisation`, the tenant in context, no uuid): every
// published review of a seller in this tenant, and its aggregate. `targetType=buyer` → 422 REVIEW_PUBLIC_BUYER_REFUSED; `targetType=seller`
// (a person's uuid) → 422 REVIEW_PUBLIC_SELLER_REFUSED — nothing public needs it (the organisation page reads its own aggregate). Cursors are
// the µs keyset (B24).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Review } from '../domain/review.entity';
import { DomainEvent, ReviewTargetType } from '../domain/reviews.events';
import { ReviewNotFoundError, ReviewForbiddenError, NotEligibleToReviewError, DuplicateReviewError, ReviewPublicBuyerRefusedError, ReviewPublicSellerRefusedError } from '../domain/reviews.errors';
import { projectReview, publicReview, reviewViewerOf, ReviewViewer, ReviewView } from '../domain/review-projection';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';
import { ReviewRepository } from '../repositories/review.repository';
import { CreateReviewDto } from '../dto/create-review.dto';
import { EditReviewDto, SellerResponseDto, ModerateReviewDto } from '../dto/update-review.dto';

export interface ReviewActor { userId: string; canModerate: boolean; }
const summaryKey = (tenantId: string, tt: string, ti: string) => `reviews:sum:${tenantId}:${tt}:${ti}`;
/** PC-56 HOTFIX-7 · B5: the organisation's aggregate (published seller-target reviews in the tenant) — dropped with the person's on every write. */
const orgSummaryKey = (tenantId: string) => `reviews:sum:${tenantId}:organisation`;
/** the public reads' target: the organisation only (a person's uuid is refused by name) */
function assertPublicTarget(targetType: string): void {
  if (targetType === 'buyer') throw new ReviewPublicBuyerRefusedError();
  if (targetType !== 'organisation') throw new ReviewPublicSellerRefusedError();
}
const cursorOf = (rows: Review[], limit: number): string | null => {
  const last = rows[rows.length - 1]?.toProps();
  return rows.length === limit && last?.createdAtUs ? encodeKeyset(last.createdAtUs, last.id) : null;   // B24: the µs keyset
};

@Injectable()
export class ReviewService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: ReviewRepository,
  ) {}

  /** A party to a completed order reviews the counterparty (verified purchase). */
  async submit(tenantId: string, reviewerUserId: string, idemKey: string, dto: CreateReviewDto) {
    return this.idem.remember(idemKey, reviewerUserId, 'reviews.submit', () =>
      timed(this.metrics, 'reviews.submit', { tenant: tenantId }, async () => {
        const elig = await this.repo.eligibilityFor(tenantId, dto.orderId);
        if (!elig) throw new NotEligibleToReviewError();
        // resolve the target from the eligibility — the reviewer is the buyer or the seller of that order
        let targetType: ReviewTargetType; let targetId: string;
        if (reviewerUserId === elig.buyerUserId) { targetType = 'seller'; targetId = elig.sellerUserId; }
        else if (reviewerUserId === elig.sellerUserId) { targetType = 'buyer'; targetId = elig.buyerUserId; }
        else throw new NotEligibleToReviewError();

        const review = Review.submit({
          id: uuidv7(), tenantId, orderId: dto.orderId, reviewerUserId, targetType, targetId,
          stars: dto.stars, subRatings: dto.subRatings ?? {}, body: dto.body ?? null, tags: dto.tags ?? [],
        });
        const res = await this.uow.run(tenantId, async (tx) => {
          const inserted = await this.repo.insert(tx, review);
          if (!inserted) throw new DuplicateReviewError();
          const p = review.toProps();
          await this.flush(tx, tenantId, p.id, review.pullEvents());
          return projectReview(p, 'author');   // HOTFIX-7 · B5: the author's own shape (never the target's uuid)
        }, { userId: reviewerUserId });
        await this.cache.del(summaryKey(tenantId, targetType, targetId)); await this.cache.del(orgSummaryKey(tenantId));
        return res;
      }));
  }

  /** The author edits their own review. */
  async edit(tenantId: string, actor: ReviewActor, id: string, dto: EditReviewDto) {
    const out = await this.uow.run(tenantId, async (tx) => {
      const review = await this.repo.getForUpdate(tx, tenantId, id);
      if (!review) throw new ReviewNotFoundError(id);
      if (review.reviewerUserId !== actor.userId) throw new ReviewForbiddenError('only the author may edit this review');
      review.edit({ stars: dto.stars, subRatings: dto.subRatings, body: dto.body, tags: dto.tags });
      await this.repo.update(tx, review);
      await this.flush(tx, tenantId, id, review.pullEvents());
      return review.toProps();
    }, { userId: actor.userId });
    await this.cache.del(summaryKey(tenantId, out.targetType, out.targetId)); await this.cache.del(orgSummaryKey(tenantId));
    return projectReview(out, 'author');   // HOTFIX-7 · B5
  }

  /** The reviewed party (target) responds publicly to the review. */
  async respond(tenantId: string, actor: ReviewActor, id: string, dto: SellerResponseDto) {
    return this.uow.run(tenantId, async (tx) => {
      const review = await this.repo.getForUpdate(tx, tenantId, id);
      if (!review) throw new ReviewNotFoundError(id);
      if (review.targetId !== actor.userId && !actor.canModerate) throw new ReviewForbiddenError('only the reviewed party may respond');
      review.sellerRespond(dto.response);
      await this.repo.update(tx, review);
      await this.flush(tx, tenantId, id, review.pullEvents());
      return projectReview(review.toProps(), actor.canModerate ? 'moderator' : 'staff');   // HOTFIX-7 · B5: the responder is the organisation's side
    }, { userId: actor.userId });
  }

  /** Moderator hides/restores/flags/removes a review. */
  async moderate(tenantId: string, actor: ReviewActor, id: string, dto: ModerateReviewDto, ip: string | null) {
    if (!actor.canModerate) throw new ReviewForbiddenError('requires review.moderate');
    const out = await this.uow.run(tenantId, async (tx) => {
      const review = await this.repo.getForUpdate(tx, tenantId, id);
      if (!review) throw new ReviewNotFoundError(id);
      review.moderate(dto.action);
      await this.repo.update(tx, review);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `review.${dto.action}`, entityType: 'review', entityId: id, newValue: { status: review.status }, reason: dto.reason ?? null, ip });
      await this.flush(tx, tenantId, id, review.pullEvents());
      return review.toProps();
    }, { userId: actor.userId });
    await this.cache.del(summaryKey(tenantId, out.targetType, out.targetId)); await this.cache.del(orgSummaryKey(tenantId));
    return projectReview(out, 'moderator');
  }

  /** A published review is public; a non-published one is visible only to its author/target/moderator
   *  (404 — not 403 — to everyone else, so reviews can't be enumerated by id). */
  async getById(tenantId: string, actor: ReviewActor, id: string) {
    const review = await this.repo.getById(tenantId, id);
    if (!review) throw new ReviewNotFoundError(id);
    const p = review.toProps();
    const isParty = p.reviewerUserId === actor.userId || p.targetId === actor.userId || actor.canModerate;
    if (p.status !== 'published' && !isParty) throw new ReviewNotFoundError(id);
    return projectReview(p, await this.viewerOf(tenantId, actor, p));   // HOTFIX-7 · B5
  }

  /** HOTFIX-7 · B5: who is reading (the organisation-role test read from the database only when it can change the answer). */
  private async viewerOf(tenantId: string, actor: ReviewActor, p: Pick<ReturnType<Review['toProps']>, 'reviewerUserId' | 'targetId' | 'targetType'>): Promise<ReviewViewer> {
    const cheap = reviewViewerOf(p, { userId: actor.userId, isModerator: actor.canModerate, isOrgMember: false });
    if (cheap !== 'public' && cheap !== 'party') return cheap;
    return reviewViewerOf(p, { userId: actor.userId, isModerator: actor.canModerate, isOrgMember: await this.repo.isOrgMember(tenantId, actor.userId) });
  }

  async list(tenantId: string, actor: ReviewActor, q: { box: 'target' | 'mine'; targetType?: string; targetId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'mine') {
      const mine = await this.repo.listForReviewer(tenantId, actor.userId, { cursor: q.cursor, limit: q.limit });
      return { items: mine.map((r) => projectReview(r.toProps(), 'author')), nextCursor: cursorOf(mine, q.limit) };
    }
    if (!q.targetType || !q.targetId) throw new ReviewForbiddenError('targetType and targetId are required');
    const rows = await this.repo.listForTarget(tenantId, q.targetType, q.targetId, { cursor: q.cursor, limit: q.limit });
    // HOTFIX-7 · B5: one viewer decision per row (the organisation-role read at most once per page)
    let orgMember: boolean | null = null;
    const items: ReviewView[] = [];
    for (const r of rows) {
      const p = r.toProps();
      let viewer = reviewViewerOf(p, { userId: actor.userId, isModerator: actor.canModerate, isOrgMember: false });
      if (viewer === 'public' || viewer === 'party') {
        if (orgMember === null) orgMember = await this.repo.isOrgMember(tenantId, actor.userId);
        viewer = reviewViewerOf(p, { userId: actor.userId, isModerator: actor.canModerate, isOrgMember: orgMember });
      }
      items.push(projectReview(p, viewer));
    }
    return { items, nextCursor: cursorOf(rows, q.limit) };
  }

  /** PUBLIC cached aggregate (avg + count + histogram). HOTFIX-7 · B5: keyed by the ORGANISATION — every published seller-target review in the
   *  tenant; a person's uuid (seller or buyer) is refused by name. */
  async summary(tenantId: string, targetType: string) {
    assertPublicTarget(targetType);
    return this.cache.wrap(orgSummaryKey(tenantId), 120, () => this.repo.summaryForOrganisation(tenantId));
  }

  /** PUBLIC, anonymous-safe list of a target's PUBLISHED reviews. Carries NO buyer PII (no reviewer id) — only
   *  the rating, body, verified-purchase flag and the seller's public response. Keyset paginated. */
  async publicList(tenantId: string, q: { targetType: string; cursor?: { c: string; id: string }; limit: number }) {
    assertPublicTarget(q.targetType);
    const rows = await this.repo.listForOrganisation(tenantId, { cursor: q.cursor, limit: q.limit });
    // PII-free and uuid-free (domain/review-projection.ts publicReview): no reviewer, no order, no target, no review id — the cursor is opaque
    return { items: rows.map((r) => publicReview(r.toProps())), nextCursor: cursorOf(rows, q.limit) };
  }
  private async flush(tx: TxContext, tenantId: string, reviewId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'review', aggregateId: reviewId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
