// modules/schemes/policies/schemes.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   scheme.apply   — a farmer applies to a scheme + provides clarifications on their own application.
//   scheme.process — a government officer / scheme operator: verify, clarify, approve/reject, disburse,
//                    record DBT credits. Browsing the scheme catalogue is any authenticated tenant user.
import { RequestContext } from '../../../core/tenancy-context/request-context';
//   scheme.desk    — PC-56 TENANT-SW-b (0198): the tenant schemes desk (W202 / W203): pipeline, eligibility sweep (a call list, never an
//                    application), per-field form reveal. tenant_admin, fpo_coordinator.
export const SchemesPermissions = { Apply: 'scheme.apply', Process: 'scheme.process', Desk: 'scheme.desk' } as const;
export const canApply = (ctx: RequestContext) => ctx.permissions.has('scheme.apply') || ctx.permissions.has('*');
export const canProcess = (ctx: RequestContext) => ctx.permissions.has('scheme.process') || ctx.permissions.has('*');
export const canDesk = (ctx: RequestContext) => ctx.permissions.has('scheme.desk') || ctx.permissions.has('*');
