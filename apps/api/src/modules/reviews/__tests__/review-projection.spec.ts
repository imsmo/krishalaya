// modules/reviews/__tests__/review-projection.spec.ts · PC-56 HOTFIX-7 · B5 (survey STORE-5 F-5) — WHO SEES WHOSE NAME ON A REVIEW. Pure.
//   moderator → the full row · author → orderId + status, never targetId / reviewerUserId · staff (the reviewed seller, or an organisation role)
//   → reviewerUserId + orderId · a buyer who is the target of a seller's review → their order, never the reviewer's id · anyone else → the
//   public row (no person, no order, no target). The public list's row carries no uuid at all.
import { projectReview, publicReview, reviewViewerOf } from '../domain/review-projection';
import type { ReviewProps } from '../domain/review.entity';

const BUYER = '0217b000-0000-7000-8000-0000000000b1', FARMER = '0217b000-0000-7000-8000-0000000000f1', ORDER = '0217b000-0000-7000-8000-0000000000c1';
const row = (over: Partial<ReviewProps> = {}): ReviewProps => ({ id: '0217b000-0000-7000-8000-0000000000a1', tenantId: 't', orderId: ORDER, reviewerUserId: BUYER, targetType: 'seller',
  targetId: FARMER, stars: 4, subRatings: { quality: 5 }, body: 'good groundnut', tags: [], isVerifiedPurchase: true, status: 'published', sellerResponse: null, sellerRespondedAt: null,
  helpfulCount: 0, createdAt: new Date('2026-10-17T00:00:00Z'), ...over });
const v = (userId: string, o: { mod?: boolean; org?: boolean } = {}) => ({ userId, isModerator: !!o.mod, isOrgMember: !!o.org });
const PERSON = ['reviewerUserId', 'targetId', 'orderId'];

describe('PC-56 HOTFIX-7 · review-projection', () => {
  it('the viewer: moderator > author > staff (the reviewed seller, or an organisation role) > party (a buyer reviewed) > public', () => {
    expect(reviewViewerOf(row(), v('x', { mod: true }))).toBe('moderator');
    expect(reviewViewerOf(row(), v(BUYER))).toBe('author');
    expect(reviewViewerOf(row(), v(FARMER))).toBe('staff');
    expect(reviewViewerOf(row(), v('staff-1', { org: true }))).toBe('staff');
    expect(reviewViewerOf(row({ targetType: 'buyer', targetId: BUYER, reviewerUserId: FARMER }), v(BUYER))).toBe('party');
    expect(reviewViewerOf(row(), v('stranger'))).toBe('public');
  });
  it('a stranger gets NO reviewerUserId / orderId / targetId (and no person uuid anywhere in the row)', () => {
    const p = projectReview(row(), 'public');
    for (const k of PERSON) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).not.toContain(BUYER); expect(JSON.stringify(p)).not.toContain(FARMER); expect(JSON.stringify(p)).not.toContain(ORDER);
    expect(p).toMatchObject({ stars: 4, body: 'good groundnut', isVerifiedPurchase: true });
  });
  it('the author sees the order and the status, never the target\'s uuid or their own reviewer id', () => {
    const p = projectReview(row({ status: 'hidden' }), 'author');
    expect(p).toMatchObject({ orderId: ORDER, status: 'hidden' });
    expect(p).not.toHaveProperty('targetId'); expect(p).not.toHaveProperty('reviewerUserId');
    expect(JSON.stringify(p)).not.toContain(FARMER);
  });
  it('the organisation\'s side sees the buyer and the order; a moderator everything', () => {
    expect(projectReview(row(), 'staff')).toMatchObject({ reviewerUserId: BUYER, orderId: ORDER, targetId: FARMER });
    expect(projectReview(row(), 'moderator')).toMatchObject({ reviewerUserId: BUYER, orderId: ORDER, targetId: FARMER, status: 'published' });
  });
  it('a buyer reviewed by the seller sees their own order, never the seller person\'s id', () => {
    const p = projectReview(row({ targetType: 'buyer', targetId: BUYER, reviewerUserId: FARMER }), 'party');
    expect(p).toMatchObject({ orderId: ORDER });
    expect(p).not.toHaveProperty('reviewerUserId'); expect(JSON.stringify(p)).not.toContain(FARMER);
  });
  it('the PUBLIC list row carries no uuid at all (not even the review\'s)', () => {
    const p = publicReview(row());
    expect(p).not.toHaveProperty('id');
    expect(JSON.stringify(p)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
