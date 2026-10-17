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
//
// PC-56 STORE-5a — A REVIEW IS A BUYER'S VERDICT ON THE ORGANISATION, KEPT, NEVER EDITED AWAY (founder D2 / D3 / D5, domain/review-rules.ts):
//   • submit: the sub-rating keys must be ACTIVE `review_dimension` codes (the vocabulary read once per request, cached 120 s — 422
//     REVIEW_DIMENSION_UNKNOWN); an expired eligibility is refused (409 REVIEW_WINDOW_CLOSED); the lock instant is stamped
//     (`edit_locks_at = now + reviews.edit_window_hours`);
//   • edit: the entity refuses after the lock (409 REVIEW_LOCKED — the rule in the entity, the clock passed in); the edit is AUDITED
//     `review.edited { before: {stars, subRatings, body}, after }` with the caller's address; an optional Idempotency-Key (the storefront's chain
//     carries the key minted at render, so a Retry is the same request);
//   • respond: the ORGANISATION's reply — any active organisation role here (HOTFIX-6's test, `ReviewRepository.isOrgMember`) or the platform
//     desk; a seller-target review only; audited `review.responded`; served `respondedBy: 'organisation'` on every read, never a person;
//   • moderate: `flag` (→ under_moderation, out of public view pending the desk) with `review.flag` OR `review.moderate`; hide / remove /
//     restore with `review.moderate` ONLY — the platform desk (support_agent after 0218), never the organisation; audited `review.flagged` /
//     `review.<act>`;
//   • the author's review of one order (`mine`), the caller's eligibility (`eligibility` — never a counterparty id), the W3145 confirm body
//     (`preview` — the SERVER's review: the organisation's name, the stars and the dimension labels as they will publish, "Verified buyer",
//     the lock instant and the window's end; it writes NOTHING), and the organisation's own list for its staff (`box=organisation`).
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
import { ReviewNotFoundError, ReviewForbiddenError, NotEligibleToReviewError, DuplicateReviewError, ReviewPublicBuyerRefusedError, ReviewPublicSellerRefusedError,
  ReviewWindowClosedError, ReviewDimensionUnknownError, ReviewFlagForbiddenError } from '../domain/reviews.errors';
import { projectReview, publicReview, reviewViewerOf, ReviewViewer, ReviewView } from '../domain/review-projection';
import { editLocksAt, isWindowOpen, canEdit, unknownDimensions, mayModerate, ORGANISATION_REPLY, VERIFIED_BUYER } from '../domain/review-rules';
import { ReviewDimension } from '../repositories/review.repository';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';
import { ReviewRepository } from '../repositories/review.repository';
import { CreateReviewDto } from '../dto/create-review.dto';
import { EditReviewDto, SellerResponseDto, ModerateReviewDto } from '../dto/update-review.dto';

/** `canModerate` = holds `review.moderate` (the platform desk); `canFlag` = holds `review.flag` (the organisation — STORE-5a · D2). */
export interface ReviewActor { userId: string; canModerate: boolean; canFlag?: boolean; }
/** The vocabulary's cache (founder brief B2: read once per request, cached 120 s), keyed by language. */
const dimsKey = (lang: string) => `reviews:dims:${lang}`;
const DIMS_TTL_S = 120;
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
  async submit(tenantId: string, reviewerUserId: string, idemKey: string, dto: CreateReviewDto, now: Date = new Date()) {
    return this.idem.remember(idemKey, reviewerUserId, 'reviews.submit', () =>
      timed(this.metrics, 'reviews.submit', { tenant: tenantId }, async () => {
        const { targetType, targetId, review } = await this.draft(tenantId, reviewerUserId, dto, now);
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

  /** STORE-5a · B2: everything a submit checks BEFORE it writes, shared with the preview (one rule, two callers): the eligibility (the
   *  caller is a party), the window (REVIEW_WINDOW_CLOSED), a duplicate (REVIEW_DUPLICATE — the preview says so before the write does), the
   *  vocabulary (REVIEW_DIMENSION_UNKNOWN) and the entity's own rules (REVIEW_INVALID); the lock instant from the setting. */
  private async draft(tenantId: string, reviewerUserId: string, dto: CreateReviewDto, now: Date) {
    const elig = await this.repo.eligibilityFor(tenantId, dto.orderId);
    if (!elig) throw new NotEligibleToReviewError();
    // resolve the target from the eligibility — the reviewer is the buyer or the seller of that order
    let targetType: ReviewTargetType; let targetId: string;
    if (reviewerUserId === elig.buyerUserId) { targetType = 'seller'; targetId = elig.sellerUserId; }
    else if (reviewerUserId === elig.sellerUserId) { targetType = 'buyer'; targetId = elig.buyerUserId; }
    else throw new NotEligibleToReviewError();
    if (!isWindowOpen(now, elig.expiresAt)) throw new ReviewWindowClosedError(elig.expiresAt);
    const dims = await this.dimensions(tenantId, 'en');
    const unknown = unknownDimensions(dto.subRatings, dims.map((d) => d.code));
    if (unknown.length > 0) throw new ReviewDimensionUnknownError(unknown);
    const w = await this.repo.windows(tenantId);
    const review = Review.submit({
      id: uuidv7(), tenantId, orderId: dto.orderId, reviewerUserId, targetType, targetId,
      stars: dto.stars, subRatings: dto.subRatings ?? {}, body: dto.body ?? null, tags: dto.tags ?? [], now, editLocksAt: editLocksAt(now, w.editWindowHours),
    });
    return { targetType, targetId, review, elig, dims };
  }

  /** STORE-5a · B2: the `review_dimension` vocabulary named in `lang` (cached 120 s per language — one read per request at most). */
  async dimensions(tenantId: string, lang: string): Promise<ReviewDimension[]> {
    const lc = (lang || 'en').toLowerCase().split('-')[0];
    return this.cache.wrap(dimsKey(lc), DIMS_TTL_S, () => this.repo.dimensions(tenantId, lc));
  }

  /** STORE-5a · B2 — W3145's confirm: the SERVER's review as it will publish, from the same checks a submit runs; it WRITES NOTHING. The
   *  organisation's name (never a person), the stars and each sub-rating with its dimension's label in the caller's language, the label
   *  "Verified buyer", the lock instant a submit now would stamp and the window's end. */
  async preview(tenantId: string, reviewerUserId: string, lang: string, dto: CreateReviewDto, now: Date = new Date()) {
    const { review, elig } = await this.draft(tenantId, reviewerUserId, dto, now);
    if (await this.repo.findMine(tenantId, reviewerUserId, dto.orderId)) throw new DuplicateReviewError();
    const p = review.toProps();
    const labels = new Map((await this.dimensions(tenantId, lang)).map((d) => [d.code, d.label]));
    const organisation = await this.repo.organisationName(tenantId);
    return {
      orderId: dto.orderId, organisation: { name: organisation }, stars: p.stars,
      subRatings: Object.entries(p.subRatings).map(([code, stars]) => ({ code, label: labels.get(code) ?? code, stars })),
      body: p.body, label: VERIFIED_BUYER, editLocksAt: p.editLocksAt ?? null, expiresAt: elig.expiresAt,
    };
  }

  /** STORE-5a · B2: the caller's eligibility for one order — whether they may review it, the window's end and whether it is open (the
   *  SERVER's decision: the storefront never compares instants itself), and whether they already did (their own review's id). Never the
   *  counterparty's id. Not a party (or no eligibility recorded) → `eligible: false` with nothing else. */
  async eligibility(tenantId: string, userId: string, orderId: string, now: Date = new Date()) {
    const elig = await this.repo.eligibilityFor(tenantId, orderId);
    if (!elig || (elig.buyerUserId !== userId && elig.sellerUserId !== userId)) return { eligible: false, expiresAt: null, windowOpen: false, reviewed: false };
    const mine = await this.repo.findMine(tenantId, userId, orderId);
    return { eligible: true, expiresAt: elig.expiresAt, windowOpen: isWindowOpen(now, elig.expiresAt), reviewed: mine !== null, ...(mine ? { reviewId: mine.id } : {}) };
  }

  /** STORE-5a · B2: the author's OWN review of one order (the author's shape + the lock instant and whether it is still editable — the server's
   *  decision), or 404. */
  async mine(tenantId: string, userId: string, orderId: string, now: Date = new Date()) {
    const r = await this.repo.findMine(tenantId, userId, orderId);
    if (!r) throw new ReviewNotFoundError(orderId);
    const p = r.toProps();
    return { ...projectReview(p, 'author'), editable: p.status !== 'removed' && canEdit(now, p.editLocksAt) };
  }

  /** The author edits their own review — inside the edit window only (the ENTITY's rule, the clock passed in: 409 REVIEW_LOCKED), against the
   *  vocabulary (REVIEW_DIMENSION_UNKNOWN), AUDITED `review.edited { before, after }` (STORE-5a · B2). An Idempotency-Key, when sent, makes a
   *  replay the same request (answered from memory — one audit row). */
  async edit(tenantId: string, actor: ReviewActor, id: string, dto: EditReviewDto, ip: string | null = null, idemKey?: string, now: Date = new Date()) {
    const act = async () => {
      if (dto.subRatings !== undefined) {
        const unknown = unknownDimensions(dto.subRatings, (await this.dimensions(tenantId, 'en')).map((d) => d.code));
        if (unknown.length > 0) throw new ReviewDimensionUnknownError(unknown);
      }
      const out = await this.uow.run(tenantId, async (tx) => {
        const review = await this.repo.getForUpdate(tx, tenantId, id);
        if (!review) throw new ReviewNotFoundError(id);
        if (review.reviewerUserId !== actor.userId) throw new ReviewForbiddenError('only the author may edit this review');
        const b = review.toProps();
        const before = { stars: b.stars, subRatings: b.subRatings, body: b.body };
        review.edit({ stars: dto.stars, subRatings: dto.subRatings, body: dto.body, tags: dto.tags }, now);
        const a = review.toProps();
        await this.repo.update(tx, review);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'review.edited', entityType: 'review', entityId: id,
          oldValue: before, newValue: { before, after: { stars: a.stars, subRatings: a.subRatings, body: a.body } }, ip });
        await this.flush(tx, tenantId, id, review.pullEvents());
        return a;
      }, { userId: actor.userId });
      await this.cache.del(summaryKey(tenantId, out.targetType, out.targetId)); await this.cache.del(orgSummaryKey(tenantId));
      return projectReview(out, 'author');   // HOTFIX-7 · B5
    };
    return idemKey ? this.idem.remember(idemKey, actor.userId, 'reviews.edit', act) : act();
  }

  /** STORE-5a · D2 — the ORGANISATION's reply (one, updatable): any active organisation role in this tenant, or the platform desk; a review OF
   *  the organisation's seller only (a seller's review of a buyer has no organisation reply). Audited `review.responded` with the caller's
   *  address. Served as the organisation's — `respondedBy: 'organisation'` — never the responder's name or id. */
  async respond(tenantId: string, actor: ReviewActor, id: string, dto: SellerResponseDto, ip: string | null = null) {
    const member = actor.canModerate || await this.repo.isOrgMember(tenantId, actor.userId);
    const out = await this.uow.run(tenantId, async (tx) => {
      const review = await this.repo.getForUpdate(tx, tenantId, id);
      if (!review) throw new ReviewNotFoundError(id);
      if (!member) throw new ReviewForbiddenError('only the organisation may reply to a review of it');
      if (review.targetType !== 'seller') throw new ReviewForbiddenError('the organisation replies to reviews of the organisation');
      review.sellerRespond(dto.response);
      await this.repo.update(tx, review);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'review.responded', entityType: 'review', entityId: id, newValue: { respondedBy: ORGANISATION_REPLY }, ip });
      await this.flush(tx, tenantId, id, review.pullEvents());
      return review.toProps();
    }, { userId: actor.userId });
    await this.cache.del(orgSummaryKey(tenantId));
    const view = projectReview(out, actor.canModerate ? 'moderator' : 'staff');
    return { ...view,
      respondedBy: ORGANISATION_REPLY };
  }

  /** STORE-5a · D2 — `flag` (→ under_moderation: out of public view until the platform desk decides) with `review.flag` OR `review.moderate`;
   *  hide / remove / restore with `review.moderate` only (the platform desk — support_agent after 0218): the organisation never hides or removes
   *  a buyer's review. Audited (`review.flagged`, `review.hide` / `review.remove` / `review.restore`) with the caller's address. */
  async moderate(tenantId: string, actor: ReviewActor, id: string, dto: ModerateReviewDto, ip: string | null) {
    if (!mayModerate(dto.action, { canModerate: actor.canModerate, canFlag: actor.canFlag === true })) {
      if (dto.action === 'flag') throw new ReviewFlagForbiddenError();
      throw new ReviewForbiddenError(`"${dto.action}" is the platform desk's act (review.moderate) — the organisation responds and flags`);
    }
    const out = await this.uow.run(tenantId, async (tx) => {
      const review = await this.repo.getForUpdate(tx, tenantId, id);
      if (!review) throw new ReviewNotFoundError(id);
      review.moderate(dto.action);
      await this.repo.update(tx, review);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: dto.action === 'flag' ? 'review.flagged' : `review.${dto.action}`, entityType: 'review', entityId: id, newValue: { status: review.status }, reason: dto.reason ?? null, ip });
      await this.flush(tx, tenantId, id, review.pullEvents());
      return review.toProps();
    }, { userId: actor.userId });
    await this.cache.del(summaryKey(tenantId, out.targetType, out.targetId)); await this.cache.del(orgSummaryKey(tenantId));
    return projectReview(out, actor.canModerate ? 'moderator' : 'staff');
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

  async list(tenantId: string, actor: ReviewActor, q: { box: 'target' | 'mine' | 'organisation'; targetType?: string; targetId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'organisation') {
      // STORE-5a · D2: the organisation's own reviews, for its staff (respond / flag) — members and the desk only
      if (!actor.canModerate && !(await this.repo.isOrgMember(tenantId, actor.userId))) throw new ReviewForbiddenError('the organisation\'s reviews are read by its members');
      const rows = await this.repo.listForOrganisationStaff(tenantId, { cursor: q.cursor, limit: q.limit });
      return { items: rows.map((r) => projectReview(r.toProps(), actor.canModerate ? 'moderator' : 'staff')), nextCursor: cursorOf(rows, q.limit) };
    }
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
