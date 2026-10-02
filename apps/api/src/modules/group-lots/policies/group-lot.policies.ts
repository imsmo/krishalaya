// modules/group-lots/policies/group-lot.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004 + 0128 + 0188).
//   group_lot.coordinate      — open a lot one coordinates oneself (tenant_admin, fpo_coordinator). It does NOT reach another
//                               coordinator's lot any more (F-23): ready / list / extend / nudge / cancel / prepare / pledge-for-
//                               a-member are THIS lot's coordinator's acts (the per-lot check in the service), or tenant_admin's.
//   group_lot.manage          — the tenant-wide reach (tenant_admin): every lot's coordinator acts, and APPOINTING another
//                               member as a lot's coordinator (with the appointee's recorded consent, group_lot_consents).
//   group_lot.settle_approve  — the SECOND PERSON (tenant_admin): confirm (pays everyone) or refuse a prepared settlement;
//                               never the preparer, never the coordinator (DB trigger trg_gls_moves, 0188).
// Browsing lots, a lot's progress, one's OWN pledge, pledging as oneself and withdrawing it is any member of the tenant.
import { RequestContext } from '../../../core/tenancy-context/request-context';

export const GroupLotPermissions = { Coordinate: 'group_lot.coordinate', Manage: 'group_lot.manage', SettleApprove: 'group_lot.settle_approve' } as const;

const has = (ctx: Pick<RequestContext, 'permissions'>, p: string) => ctx.permissions.has(p) || ctx.permissions.has('*');
export const canCoordinate = (ctx: Pick<RequestContext, 'permissions'>) => has(ctx, GroupLotPermissions.Coordinate);
export const canManageLots = (ctx: Pick<RequestContext, 'permissions'>) => has(ctx, GroupLotPermissions.Manage);
export const canApproveSettlement = (ctx: Pick<RequestContext, 'permissions'>) => has(ctx, GroupLotPermissions.SettleApprove);

/** Who is acting, as the group-lot service judges it. The per-lot rule is `coordinatesLot`. */
export interface GroupLotActor { userId: string; canCoordinate: boolean; canManage: boolean; canApprove: boolean; }
export function groupLotActor(ctx: Pick<RequestContext, 'userId' | 'permissions'>): GroupLotActor {
  return { userId: ctx.userId, canCoordinate: canCoordinate(ctx), canManage: canManageLots(ctx), canApprove: canApproveSettlement(ctx) };
}

/** F-23 — the per-lot coordinator check: THIS lot's coordinator, or tenant_admin's tenant-wide reach. Role-wide `coordinate` is not enough. */
export function coordinatesLot(actor: Pick<GroupLotActor, 'userId' | 'canManage'>, lot: { coordinatorUserId: string }): boolean {
  return actor.canManage || actor.userId === lot.coordinatorUserId;
}
