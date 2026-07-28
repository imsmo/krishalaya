// modules/insurance/policies/insurance.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   insurance.enrol  — a farmer/pashupalak/dairy_farmer/vyapari enrols in / cancels their own policy.
//   insurance.manage — the insurer/tenant admin surface (product catalogue authoring stays admin-side, Law 11;
//                       not exposed by this module's controllers, reserved for a future partner-console batch).
// Browsing the product catalogue + IRDAI partner list (global reference data) is any authenticated tenant user.
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const InsurancePermissions = { Enrol: 'insurance.enrol', Manage: 'insurance.manage' } as const;
export const canEnrol = (ctx: RequestContext) => ctx.permissions.has('insurance.enrol') || ctx.permissions.has('*');
export const canManageInsurance = (ctx: RequestContext) => ctx.permissions.has('insurance.manage') || ctx.permissions.has('*');
