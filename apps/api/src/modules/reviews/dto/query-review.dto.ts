// modules/reviews/dto/query-review.dto.ts · list/filter query params (cursor pagination, never OFFSET).
import { z } from 'zod';
import { ReviewTargetType } from '../domain/reviews.events';

// Public list of a target's reviews; or the caller's own authored reviews (box=mine).
// PC-56 STORE-5a · D2: + `organisation` — the organisation's own reviews for its staff (members and the desk only; respond / flag).
export const REVIEW_BOXES = ['target', 'mine', 'organisation'] as const;
export type ReviewBox = (typeof REVIEW_BOXES)[number];

export const QueryReviewsSchema = z.object({
  box: z.enum(REVIEW_BOXES).default('target'),
  targetType: z.enum(['seller', 'buyer'] as [ReviewTargetType, ReviewTargetType]).optional(),
  targetId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryReviewsDto = z.infer<typeof QueryReviewsSchema>;

// PC-56 HOTFIX-7 · B5: the PUBLIC reads are keyed by the ORGANISATION (`targetType=organisation`, no id — the tenant in context). `seller` and
// `buyer` stay in the enum only to be REFUSED BY NAME (REVIEW_PUBLIC_SELLER_REFUSED / REVIEW_PUBLIC_BUYER_REFUSED, 422) rather than as an
// anonymous validation error; `targetId` is accepted and ignored for them (a mobile caller still sends one — named for the mobile wave).
export const PUBLIC_REVIEW_TARGETS = ['organisation', 'seller', 'buyer'] as const;
export const ReviewSummaryQuerySchema = z.object({
  targetType: z.enum(PUBLIC_REVIEW_TARGETS),
  targetId: z.string().uuid().optional(),
}).strict();
export type ReviewSummaryQueryDto = z.infer<typeof ReviewSummaryQuerySchema>;

// PUBLIC list of a target's PUBLISHED reviews (anonymous storefront). Required target; keyset cursor; capped.
// The projection carries NO buyer PII (no reviewer id) — only the rating, body, verified-purchase flag and the
// seller's public response.
export const PublicReviewsQuerySchema = z.object({
  targetType: z.enum(PUBLIC_REVIEW_TARGETS),
  targetId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type PublicReviewsQueryDto = z.infer<typeof PublicReviewsQuerySchema>;

// PC-56 STORE-5a · B2: the caller's own review of ONE order (`GET reviews/mine?orderId=`) and their eligibility for it (`GET reviews/eligibility`).
export const ReviewOrderQuerySchema = z.object({ orderId: z.string().uuid() }).strict();
export type ReviewOrderQueryDto = z.infer<typeof ReviewOrderQuerySchema>;
