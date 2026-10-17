// Unit tests for the PURE seller-review-response validator.
import { validateReviewResponse, flagErrorKey, canFlagReview } from '../features/reviews/respond';

describe('validateReviewResponse', () => {
  it('trims and accepts a valid response', () => {
    expect(validateReviewResponse('  Thanks for your feedback!  ')).toEqual({ ok: true, value: 'Thanks for your feedback!' });
  });
  it('rejects empty / blank / nullish', () => {
    expect(validateReviewResponse('')).toEqual({ ok: false, error: 'empty' });
    expect(validateReviewResponse('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateReviewResponse(null)).toEqual({ ok: false, error: 'empty' });
    expect(validateReviewResponse(undefined)).toEqual({ ok: false, error: 'empty' });
  });
  it('rejects > 4000 chars (after trim)', () => {
    expect(validateReviewResponse('a'.repeat(4001))).toEqual({ ok: false, error: 'too_long' });
    expect(validateReviewResponse('a'.repeat(4000))).toEqual({ ok: true, value: 'a'.repeat(4000) });
  });
});

// PC-56 STORE-5a · D2 (founder Q8): the organisation FLAGS (never hides or removes); the flag's refusals by name; only a live review is flaggable.
describe('STORE-5a · the organisation flags a review', () => {
  it('names the refusals', () => {
    expect(flagErrorKey('REVIEW_FLAG_FORBIDDEN', 403)).toBe('review_flag_forbidden');
    expect(flagErrorKey('REVIEW_FORBIDDEN', 403)).toBe('review_flag_forbidden');
    expect(flagErrorKey('REVIEW_ILLEGAL_TRANSITION', 409)).toBe('review_flag_illegal');
    expect(flagErrorKey('REVIEW_REMOVED', 409)).toBe('review_flag_illegal');
    expect(flagErrorKey(null, 503)).toBe('review_flag');
  });
  it('only a published review can be flagged (a flagged one is with the platform desk)', () => {
    expect(['published', 'under_moderation', 'hidden', 'removed', undefined].map(canFlagReview)).toEqual([true, false, false, false, false]);
  });
});
