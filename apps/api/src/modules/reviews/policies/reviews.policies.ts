// modules/reviews/policies/reviews.policies.ts · permission keys (DB-backed RBAC, Law 6).
import { RequestContext } from '../../../core/tenancy-context/request-context';
// Posting a review needs review.create (buyer/seller roles) AND verified-purchase eligibility (enforced
// in the service). Moderation needs review.moderate. Author/target authority is enforced per-row.
// PC-56 STORE-5a · D2 (founder Q8): the organisation RESPONDS and FLAGS (`review.flag` — tenant_admin, support_agent); it never hides or removes a
// buyer's review. `review.moderate` (hide / remove / restore) is the platform desk's (support_agent after migration 0218). `listing.moderate` no
// longer admits review moderation — it was how the selling organisation's tenant_admin hid its buyers' reviews (survey F-6).
export const ReviewPermissions = { Create: 'review.create', Moderate: 'review.moderate', Flag: 'review.flag' } as const;
export function canModerateReview(ctx: RequestContext): boolean {
  return ctx.permissions.has('review.moderate') || ctx.permissions.has('*');
}
export function canFlagReview(ctx: RequestContext): boolean {
  return ctx.permissions.has('review.flag') || canModerateReview(ctx);
}
