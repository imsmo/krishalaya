// modules/insurance/policies/insurance.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   insurance.enrol  — a farmer/pashupalak/dairy_farmer/vyapari enrols in / cancels their own policy.
//   insurance.manage — the tenant's own insurance desk (claims progression, the tenant's own book / insights). PC-56 PARTNER-2a: product
//                       authoring and issuance are REFUSED BY NAME from the tenant realm (authoring.controller.ts — founder Q5 / Q7); the
//                       insurer reads its own book in the PARTNER realm (`partner.insurance.read`, modules/partner-console), never here.
// Browsing the product catalogue + IRDAI partner list (global reference data) is any authenticated tenant user.
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const InsurancePermissions = { Enrol: 'insurance.enrol', Manage: 'insurance.manage' } as const;
export const canEnrol = (ctx: RequestContext) => ctx.permissions.has('insurance.enrol') || ctx.permissions.has('*');
export const canManageInsurance = (ctx: RequestContext) => ctx.permissions.has('insurance.manage') || ctx.permissions.has('*');
