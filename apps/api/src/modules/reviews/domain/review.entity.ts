// modules/reviews/domain/review.entity.ts
// Review aggregate — a VERIFIED-PURCHASE rating of the counterparty of a completed order (buyer→seller
// or seller→buyer). Pure domain: stars 1–5, sub-ratings 1–5, status transitions ONLY via the state
// machine (Law 5). NO money. No version column (add_std_columns) → the service serializes mutations
// with SELECT … FOR UPDATE; the (order, reviewer, target) UNIQUE stops duplicates.
import { ReviewStatus, assertTransition, isEditable } from './review.state';
import { ReviewEventType, DomainEvent, ReviewTargetType } from './reviews.events';
import { InvalidReviewError, ReviewRemovedError } from './reviews.errors';

export interface ReviewProps {
  id: string; tenantId: string; orderId: string | null; reviewerUserId: string;
  targetType: ReviewTargetType; targetId: string; stars: number; subRatings: Record<string, number>;
  body: string | null; tags: string[]; isVerifiedPurchase: boolean; status: ReviewStatus;
  sellerResponse: string | null; sellerRespondedAt: Date | null; helpfulCount: number; createdAt: Date;
  /** PC-56 HOTFIX-7 · B24: `created_at` as the database printed it (µs) — the keyset cursor only, never served. */
  createdAtUs?: string | null;
}

const MAX_BODY = 4000;
function validStars(n: unknown): boolean { return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5; }
function validSubRatings(sub: Record<string, number>): boolean {
  const keys = Object.keys(sub);
  if (keys.length > 12) return false;
  return keys.every((k) => /^[a-z_]{1,30}$/.test(k) && validStars(sub[k]));
}

export class Review {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: ReviewProps) {}

  static submit(input: {
    id: string; tenantId: string; orderId: string; reviewerUserId: string; targetType: ReviewTargetType; targetId: string;
    stars: number; subRatings?: Record<string, number>; body?: string | null; tags?: string[]; now?: Date;
  }): Review {
    if (!validStars(input.stars)) throw new InvalidReviewError('stars must be an integer 1–5');
    const sub = input.subRatings ?? {};
    if (!validSubRatings(sub)) throw new InvalidReviewError('sub_ratings must be {dimension: 1–5}');
    if (input.body != null && input.body.length > MAX_BODY) throw new InvalidReviewError(`body exceeds ${MAX_BODY} chars`);
    const tags = input.tags ?? [];
    if (tags.length > 10 || tags.some((t) => typeof t !== 'string' || t.length > 40)) throw new InvalidReviewError('too many/invalid tags');
    const r = new Review({
      id: input.id, tenantId: input.tenantId, orderId: input.orderId, reviewerUserId: input.reviewerUserId,
      targetType: input.targetType, targetId: input.targetId, stars: input.stars, subRatings: sub,
      body: input.body ?? null, tags, isVerifiedPurchase: true, status: 'published',
      sellerResponse: null, sellerRespondedAt: null, helpfulCount: 0, createdAt: input.now ?? new Date(),
    });
    r.events.push({ type: ReviewEventType.Submitted, payload: { reviewId: r.props.id, targetType: r.props.targetType, targetId: r.props.targetId, reviewerUserId: r.props.reviewerUserId, stars: r.props.stars } });
    return r;
  }
  static rehydrate(props: ReviewProps): Review { return new Review(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get reviewerUserId() { return this.props.reviewerUserId; }
  get targetType() { return this.props.targetType; }
  get targetId() { return this.props.targetId; }
  toProps(): Readonly<ReviewProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** The author edits stars/body/sub-ratings/tags (not allowed once removed). */
  edit(input: { stars?: number; body?: string | null; subRatings?: Record<string, number>; tags?: string[] }): void {
    if (!isEditable(this.props.status)) throw new ReviewRemovedError();
    if (input.stars !== undefined) { if (!validStars(input.stars)) throw new InvalidReviewError('stars must be an integer 1–5'); this.props.stars = input.stars; }
    if (input.subRatings !== undefined) { if (!validSubRatings(input.subRatings)) throw new InvalidReviewError('sub_ratings must be {dimension: 1–5}'); this.props.subRatings = input.subRatings; }
    if (input.body !== undefined) { if (input.body != null && input.body.length > MAX_BODY) throw new InvalidReviewError(`body exceeds ${MAX_BODY} chars`); this.props.body = input.body; }
    if (input.tags !== undefined) { if (input.tags.length > 10 || input.tags.some((t) => t.length > 40)) throw new InvalidReviewError('too many/invalid tags'); this.props.tags = input.tags; }
    this.events.push({ type: ReviewEventType.Edited, payload: { reviewId: this.props.id, stars: this.props.stars } });
  }

  /** The reviewed seller replies once (or updates their reply). Only meaningful while visible. */
  sellerRespond(text: string, now: Date = new Date()): void {
    if (this.props.status === 'removed') throw new ReviewRemovedError();
    if (!text.trim() || text.length > MAX_BODY) throw new InvalidReviewError('response must be 1–4000 chars');
    this.props.sellerResponse = text;
    this.props.sellerRespondedAt = now;
    this.events.push({ type: ReviewEventType.SellerResponded, payload: { reviewId: this.props.id } });
  }

  /** Moderator action. hide/restore/flag/remove move the status via the state machine. */
  moderate(action: 'hide' | 'restore' | 'flag' | 'remove'): void {
    const to: ReviewStatus = action === 'hide' ? 'hidden' : action === 'restore' ? 'published' : action === 'flag' ? 'under_moderation' : 'removed';
    assertTransition(this.props.status, to);
    this.props.status = to;
    this.events.push({ type: ReviewEventType.Moderated, payload: { reviewId: this.props.id, action, status: to } });
  }
}
