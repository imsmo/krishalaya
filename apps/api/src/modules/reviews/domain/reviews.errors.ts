// modules/reviews/domain/reviews.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class ReviewNotFoundError extends NotFoundError { constructor(id: string) { super('Review not found'); (this as any).details = { id }; } }
/** The actor is not the review's author / target seller / a moderator, as required. */
export class ReviewForbiddenError extends AppError { constructor(message = 'Not allowed on this review') { super('REVIEW_FORBIDDEN', message, 403); } }
/** The reviewer has no verified-purchase eligibility (no completed order with this counterparty). */
export class NotEligibleToReviewError extends AppError { constructor() { super('REVIEW_NOT_ELIGIBLE', 'You can only review the counterparty of a completed order', 403); } }
/** One review per (order, reviewer, target) — UNIQUE in the schema. */
export class DuplicateReviewError extends AppError { constructor() { super('REVIEW_DUPLICATE', 'You have already reviewed this order', 409); } }
/** Acting on a soft-removed review. */
export class ReviewRemovedError extends AppError { constructor() { super('REVIEW_REMOVED', 'This review has been removed', 409); } }
export class InvalidReviewError extends DomainError { constructor(message: string) { super('REVIEW_INVALID', message, 400); } }
/** PC-56 HOTFIX-7 · B5 (survey STORE-5 F-5, Q11): a BUYER's received ratings are never public — the seller's review of the buyer is kept for the
 *  organisation (staff read it, signed in), and the public routes refuse `targetType=buyer` by name. */
export class ReviewPublicBuyerRefusedError extends DomainError { constructor() { super('REVIEW_PUBLIC_BUYER_REFUSED', 'A buyer\'s ratings are not public', 422, {}); } }
/** PC-56 HOTFIX-7 · B5: the public routes are keyed by the ORGANISATION (`targetType=organisation`, no uuid) — nothing public needs a seller's
 *  person uuid (the organisation page reads its own aggregate; the storefront lists by organisation), so `targetType=seller` is refused too. */
export class ReviewPublicSellerRefusedError extends DomainError { constructor() { super('REVIEW_PUBLIC_SELLER_REFUSED', 'Public reviews are read per organisation, never per person', 422, {}); } }
