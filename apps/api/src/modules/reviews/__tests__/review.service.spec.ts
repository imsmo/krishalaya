// modules/reviews/__tests__/review.service.spec.ts · pure-domain unit tests: the review status state
// machine (Law 5) + the Review aggregate (submit validation, edit, seller response, moderation). The
// service's verified-purchase gate / UoW / outbox / cache are covered by the integration spec.
import { canTransition, isVisible, isEditable, IllegalReviewTransitionError, REVIEW_STATUSES, ReviewStatus } from '../domain/review.state';
import { Review } from '../domain/review.entity';
import { ReviewEventType } from '../domain/reviews.events';
import { InvalidReviewError, ReviewRemovedError } from '../domain/reviews.errors';

// PC-56 STORE-5a · B1: a review carries its lock instant (stamped at submit by the service) — here a week ahead, so the edit cases are inside it
const mk = (over: any = {}) => Review.submit({ id: 'rv1', tenantId: 't1', orderId: 'o1', reviewerUserId: 'buyer1', targetType: 'seller', targetId: 'seller1', stars: 5,
  editLocksAt: new Date(Date.now() + 7 * 86_400_000), ...over });

describe('review.state machine', () => {
  it('allows documented transitions, forbids illegal ones', () => {
    expect(canTransition('published', 'hidden')).toBe(true);
    expect(canTransition('published', 'removed')).toBe(true);
    expect(canTransition('under_moderation', 'published')).toBe(true);
    expect(canTransition('removed', 'published')).toBe(false);
    expect(isVisible('published')).toBe(true); expect(isVisible('hidden')).toBe(false);
    expect(isEditable('published')).toBe(true); expect(isEditable('removed')).toBe(false);
  });
  it('covers every status', () => { for (const s of REVIEW_STATUSES) expect(() => canTransition(s, 'removed' as ReviewStatus)).not.toThrow(); });
});

describe('Review.submit', () => {
  it('rejects bad stars, oversized body, bad sub-ratings and too many tags', () => {
    expect(() => mk({ stars: 0 })).toThrow(InvalidReviewError);
    expect(() => mk({ stars: 6 })).toThrow(InvalidReviewError);
    expect(() => mk({ stars: 4.5 })).toThrow(InvalidReviewError);
    expect(() => mk({ body: 'x'.repeat(4001) })).toThrow(InvalidReviewError);
    expect(() => mk({ subRatings: { quality: 9 } })).toThrow(InvalidReviewError);
    expect(() => mk({ tags: Array(11).fill('t') })).toThrow(InvalidReviewError);
  });
  it('starts published + verified and emits submitted', () => {
    const r = mk({ subRatings: { quality: 5, freshness: 4 }, body: 'great', tags: ['fresh'] });
    expect(r.status).toBe('published');
    expect(r.toProps().isVerifiedPurchase).toBe(true);
    expect(r.pullEvents().map((e) => e.type)).toContain(ReviewEventType.Submitted);
  });
});

describe('Review edit / respond / moderate', () => {
  it('author edit updates fields and emits edited', () => {
    const r = mk(); r.pullEvents();
    r.edit({ stars: 3, body: 'changed' });
    expect(r.toProps().stars).toBe(3); expect(r.toProps().body).toBe('changed');
    expect(r.pullEvents().map((e) => e.type)).toContain(ReviewEventType.Edited);
  });
  it('seller response is recorded with a timestamp', () => {
    const r = mk(); r.pullEvents();
    r.sellerRespond('thanks for the feedback');
    expect(r.toProps().sellerResponse).toBe('thanks for the feedback');
    expect(r.toProps().sellerRespondedAt).toBeInstanceOf(Date);
    expect(r.pullEvents().map((e) => e.type)).toContain(ReviewEventType.SellerResponded);
  });
  it('moderation walks the state machine; removed is terminal and un-editable', () => {
    const r = mk(); r.pullEvents();
    r.moderate('hide'); expect(r.status).toBe('hidden');
    r.moderate('restore'); expect(r.status).toBe('published');
    r.moderate('flag'); expect(r.status).toBe('under_moderation');
    r.moderate('remove'); expect(r.status).toBe('removed');
    expect(() => r.edit({ stars: 1 })).toThrow(ReviewRemovedError);
    expect(() => r.moderate('restore')).toThrow(IllegalReviewTransitionError);
  });
});
