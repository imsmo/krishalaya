// modules/requirements/policies/requirements.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004 + 0189).
//   requirement.post  — post one's OWN requirement (buyer roles: customer, farmer, vyapari). Unchanged.
//   requirement.quote — quote on someone else's requirement with one's OWN listing (seller roles). Unchanged.
//   requirement.desk  — PC-56 TENANT-11d (A3, tenant_admin + fpo_coordinator): post a requirement AS a named buyer (with the
//                       buyer's recorded consent, act `post`); run the member-stock response groups (each member's consent
//                       before send); shortlist / accept / reject FOR the buyer only with the buyer's consent for THAT act.
//   moderator (listing.moderate | dispute.resolve) — READ every requirement and its responses, and CLOSE one with a reason
//                       (audited). F-10: it no longer reaches accept / shortlist / reject — staff never decide for a buyer
//                       without the buyer's yes (and then only through requirement.desk).
import { RequestContext } from '../../../core/tenancy-context/request-context';

export const RequirementPermissions = { Post: 'requirement.post', Quote: 'requirement.quote', Desk: 'requirement.desk' } as const;

const has = (ctx: Pick<RequestContext, 'permissions'>, p: string) => ctx.permissions.has(p) || ctx.permissions.has('*');
/** Tenant moderation: read everything, close with a reason. NOT a decision on a buyer's quote. */
export function canModerateRequirement(ctx: Pick<RequestContext, 'permissions'>): boolean {
  return has(ctx, 'listing.moderate') || has(ctx, 'dispute.resolve');
}
export const canDesk = (ctx: Pick<RequestContext, 'permissions'>) => has(ctx, RequirementPermissions.Desk);

/** Who is acting, as the requirement services judge it. Per-row authority (buyer / seller / consent) is in the services. */
export interface RequirementActor { userId: string; canModerate: boolean; canDesk?: boolean; canPost?: boolean; canQuote?: boolean }
export function requirementActor(ctx: Pick<RequestContext, 'userId' | 'permissions'>): RequirementActor {
  return { userId: ctx.userId, canModerate: canModerateRequirement(ctx), canDesk: canDesk(ctx), canPost: has(ctx, RequirementPermissions.Post), canQuote: has(ctx, RequirementPermissions.Quote) };
}
/** The desk and moderators read the whole tenant's board and every response (with masked identities). */
export const seesAll = (a: RequirementActor) => a.canModerate || !!a.canDesk;
