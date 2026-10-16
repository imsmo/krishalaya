// modules/reviews/domain/review-projection.ts · PC-56 HOTFIX-7 · B5 (survey STORE-5 F-5) — WHO SEES WHOSE NAME ON A REVIEW. PURE.
//
// `GET /v1/reviews?box=target&targetType=&targetId=` and `GET /v1/reviews/:id` served the FULL row — `reviewerUserId` (the buyer's uuid),
// `targetId` (the farmer's uuid) and `orderId` — to ANY signed-in user (the HF-5 F-7 class, missed because reviews were never in scope). One
// projection, decided by the VIEWER (the HOTFIX-6 `conversation-roles.ts` two-shape rule):
//   • moderator — the full row;
//   • author    — their own review: `orderId` and `status` (what they wrote, about which order, and whether it is live), NEVER `targetId` or
//                 `reviewerUserId` (the organisation's person is not theirs to hold; their own id they know);
//   • staff     — the organisation's side: the reviewed seller themself (`targetType = seller`, `targetId = viewer`) or anyone holding an
//                 organisation role in this tenant (read from the database — an active role other than `customer`): the row with the
//                 buyer (`reviewerUserId`) and the order (the organisation sees its buyer — the HOTFIX-6 / STORE-4b rule);
//   • party     — a BUYER who is the target of a seller's review: their own order (`orderId`), the review — never the reviewer's person id;
//   • public    — everyone else: the public projection (no person, no order, no target) — exactly the anonymous `GET reviews/public` row.
import type { ReviewProps } from './review.entity';

export type ReviewViewer = 'moderator' | 'author' | 'staff' | 'party' | 'public';

export function reviewViewerOf(p: Pick<ReviewProps, 'reviewerUserId' | 'targetId' | 'targetType'>, v: { userId: string; isModerator: boolean; isOrgMember: boolean }): ReviewViewer {
  if (v.isModerator) return 'moderator';
  if (p.reviewerUserId === v.userId) return 'author';
  if ((p.targetType === 'seller' && p.targetId === v.userId) || v.isOrgMember) return 'staff';
  if (p.targetType === 'buyer' && p.targetId === v.userId) return 'party';
  return 'public';
}

/** The anonymous-safe row (no reviewer, no order, no target, no review uuid — the public list is keyed by the organisation, its cursor is
 *  opaque). */
export function publicReview(p: ReviewProps) {
  return { stars: p.stars, subRatings: p.subRatings, body: p.body, tags: p.tags, isVerifiedPurchase: p.isVerifiedPurchase,
    sellerResponse: p.sellerResponse, sellerRespondedAt: p.sellerRespondedAt, helpfulCount: p.helpfulCount, createdAt: p.createdAt };
}

/** One review as a signed-in viewer reads it — the person / order fields present only for the viewers that may hold them. */
export interface ReviewView {
  id: string; targetType?: string; stars: number; subRatings: Record<string, number>; body: string | null; tags: string[]; isVerifiedPurchase: boolean;
  sellerResponse: string | null; sellerRespondedAt: Date | null; helpfulCount: number; createdAt: Date;
  orderId?: string | null; reviewerUserId?: string; targetId?: string; status?: string;
}

export function projectReview(p: ReviewProps, viewer: ReviewViewer): ReviewView {
  const base = { id: p.id, targetType: p.targetType, stars: p.stars, subRatings: p.subRatings, body: p.body, tags: p.tags, isVerifiedPurchase: p.isVerifiedPurchase,
    sellerResponse: p.sellerResponse, sellerRespondedAt: p.sellerRespondedAt, helpfulCount: p.helpfulCount, createdAt: p.createdAt };
  switch (viewer) {
    case 'moderator':
    case 'staff':
      return { ...base, orderId: p.orderId, reviewerUserId: p.reviewerUserId, targetId: p.targetId, status: p.status };
    case 'author':
    case 'party':
      return { ...base, orderId: p.orderId, status: p.status };
    default:
      return { id: p.id, ...publicReview(p) };
  }
}
