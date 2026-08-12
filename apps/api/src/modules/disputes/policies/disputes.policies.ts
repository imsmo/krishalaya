// modules/disputes/policies/disputes.policies.ts · permission keys (DB-backed RBAC, Law 6).
import { RequestContext } from '../../../core/tenancy-context/request-context';
// Raising a dispute needs dispute.raise (buyer/seller roles) AND eligibility (enforced in the service).
// Moderation (review/escalate/resolve) needs dispute.resolve. Party-vs-party authority is per-row.
// `order.refund` is seeded by 0139 (PC-56 TENANT-3b) — W142 and W133 both named it and no file granted it. It is the
// MONEY key: deciding a dispute (dispute.resolve) and releasing the cash are two acts, held by two keys, so that the
// maker-checker rule the canon promises has two distinct roles to be built out of.
export const DisputePermissions = { Raise: 'dispute.raise', Resolve: 'dispute.resolve', Refund: 'order.refund' } as const;
export function canModerateDispute(ctx: RequestContext): boolean {
  return ctx.permissions.has('dispute.resolve') || ctx.permissions.has('*');
}
export function canRefund(ctx: RequestContext): boolean {
  return ctx.permissions.has('order.refund') || ctx.permissions.has('*');
}
