// modules/ambassadors/policies/ambassadors.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded 0004).
//   ambassador.manage — admin: enroll/suspend/edit ambassadors, activate referrals (tenant_admin + support_agent).
//   ambassador.payout — PC-56 TENANT-10a (0184, F-3): run a commission payout or the weekly earnings run — the money
//   gate, tenant_admin ONLY. Being an ambassador is NOT self-grant (Law 11). Creating/sharing a referral code + viewing
//   one's OWN referrals/earnings needs only authentication (ownership = caller's userId; no IDOR).
import { RequestContext } from '../../../core/tenancy-context/request-context';
// PC-56 TENANT-SW-b (0198): ambassador.payout.prepare — prepare a weekly / exception run (tenant_admin, fpo_coordinator); ambassador.payout
// now CONFIRMS a run someone else prepared (the database refuses the preparer). The money leaves the TENANT's Main wallet.
export const AmbassadorsPermissions = { Manage: 'ambassador.manage', Payout: 'ambassador.payout', PayoutPrepare: 'ambassador.payout.prepare' } as const;
export const canManageAmbassadors = (ctx: RequestContext) => ctx.permissions.has('ambassador.manage') || ctx.permissions.has('*');
