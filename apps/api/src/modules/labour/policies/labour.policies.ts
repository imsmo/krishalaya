// modules/labour/policies/labour.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004 + 0187).
//   worker.book           — an EMPLOYER (farmer/FPO) posts and runs their OWN bookings (unchanged: nothing removed).
//   booking.manage        — tenant oversight READS (box=all, the roster, the summary) and the MGNREGA desk.
//   labour.desk           — PC-56 TENANT-11b (F-8 / F-20): the labour desk (tenant_admin, fpo_coordinator) posts, fills,
//                           confirms the roster of and cancels a job FOR an employer — each with the employer's RECORDED
//                           consent for that act (labour_consents); it may also start / complete a job it runs.
//   labour.wages.approve  — PC-56 TENANT-11b: the pay act on a DESK-RUN booking (tenant_admin only). The employer always
//                           may pay their own booking.
// Registering a worker profile and a worker RESPONDING to their own assignment is any authenticated user.
import { RequestContext } from '../../../core/tenancy-context/request-context';

export const LabourPermissions = { Book: 'worker.book', Manage: 'booking.manage', Desk: 'labour.desk', WagesApprove: 'labour.wages.approve' } as const;

const has = (ctx: Pick<RequestContext, 'permissions'>, p: string) => ctx.permissions.has(p) || ctx.permissions.has('*');

export function canBookLabour(ctx: Pick<RequestContext, 'permissions'>): boolean { return has(ctx, LabourPermissions.Book); }
export function canManageLabour(ctx: Pick<RequestContext, 'permissions'>): boolean { return has(ctx, LabourPermissions.Manage); }
export function canRunLabourDesk(ctx: Pick<RequestContext, 'permissions'>): boolean { return has(ctx, LabourPermissions.Desk); }
export function canApproveLabourWages(ctx: Pick<RequestContext, 'permissions'>): boolean { return has(ctx, LabourPermissions.WagesApprove); }

/** Who is acting, as the labour services judge it. `canBook` / `canDesk` gate posting; the per-booking check is in the service. */
export interface LabourActor { userId: string; canBook: boolean; canDesk: boolean; canApproveWages: boolean; canManage: boolean; }
export function labourActor(ctx: Pick<RequestContext, 'userId' | 'permissions'>): LabourActor {
  return { userId: ctx.userId, canBook: canBookLabour(ctx), canDesk: canRunLabourDesk(ctx), canApproveWages: canApproveLabourWages(ctx), canManage: canManageLabour(ctx) };
}
/** May this caller read tenant-wide labour facts (box=all, any roster, the summary)? */
export function canOverseeLabour(a: Pick<LabourActor, 'canDesk' | 'canManage'>): boolean { return a.canDesk || a.canManage; }
