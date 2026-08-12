// modules/listings/listings.policies.ts
// Permission constants + ownership guard logic for the listings surface.
// Permissions are stored in the DB (dynamic RBAC, Law 9) — these are the string
// keys the seed pack grants to roles. The guard resolves the caller's effective
// permission set (role grants + per-user overrides) from RequestContext.
import { RequestContext } from '../../core/tenancy-context/request-context';
import { ForbiddenError } from '../../shared/errors/app-error';

export const ListingPermissions = {
  Create: 'listing.create',
  Update: 'listing.update',
  Publish: 'listing.publish',
  Moderate: 'listing.moderate',     // tenant admin / support: reject, force-pause
  // PC-56 TENANT-2a: seeded + granted to tenant_admin in 0004, checked by NOTHING until this wave — a granted
  // permission with no route behind it is a promise nothing keeps (0120's rule, met from its third side).
  Approve: 'listing.approve',       // QC: decide pending_approval (W126/W127); separate from creation — no self-review
  ViewAny: 'listing.view_any',      // see other sellers' listings within tenant
  Boost: 'listing.boost',
  GroupLotManage: 'group_lot.manage',
} as const;
export type ListingPermission = typeof ListingPermissions[keyof typeof ListingPermissions];

/** True if the caller may moderate (admin override of ownership). */
export function canModerate(ctx: RequestContext): boolean {
  return ctx.permissions.has(ListingPermissions.Moderate) || ctx.permissions.has('*');
}

/** True if the caller holds the permission OR owns the resource (admins override). */
export function canMutateListing(ctx: RequestContext, listingSellerUserId: string, perm: ListingPermission): boolean {
  if (canModerate(ctx)) return true;
  return ctx.permissions.has(perm) && ctx.userId === listingSellerUserId;
}

export function requirePermission(ctx: RequestContext, perm: ListingPermission): void {
  if (!ctx.permissions.has(perm) && !canModerate(ctx)) {
    throw new ForbiddenError(`Missing permission: ${perm}`, { required: [perm] });
  }
}
