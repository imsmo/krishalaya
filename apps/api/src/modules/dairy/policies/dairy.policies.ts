// modules/dairy/policies/dairy.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   dairy.manage — the cooperative/MCC operator: create MCCs + rate cards, enrol members, record
//                  collections, generate/approve/PAY milk bills. Members READ their own data (no perm).
import { RequestContext } from '../../../core/tenancy-context/request-context';

/**
 * [PC-56 TENANT-6c-3] `SettlementClose` is 0144's permission, reused rather than re-invented.
 *
 * W169: *"Preview/approve needs dairy-desk + `settlement.close` + checker — this is 312 families' milk money."* The
 * dairy desk's own verb is `dairy.manage`; the second key is the SAME one the settlement console uses, and 0144 granted
 * it to `tenant_admin` only — which is the point. The desk previews; somebody who is not the desk approves.
 *
 * A second dairy-specific permission would have been the wrong answer: an access review that has to check two keys
 * meaning "may close money" is an access review nobody completes.
 */
export const DairyPermissions = { Manage: 'dairy.manage', SettlementClose: 'settlement.close' } as const;

/**
 * `dairy.manage` is the cooperative/MCC OPERATOR's verb. Until TENANT-6c-3 the roles seed also granted it to
 * `dairy_farmer`, so any member could create the rate card that sets what every other member is paid, generate a bill
 * and pay it out of the cooperative's wallet. Removed in 0159; nothing a member does needs it, because every
 * member-facing dairy route authorises by OWNERSHIP and carries no permission at all.
 */
export const canManageDairy = (ctx: RequestContext) => ctx.permissions.has('dairy.manage') || ctx.permissions.has('*');
export const canCloseSettlement = (ctx: RequestContext) => ctx.permissions.has('settlement.close') || ctx.permissions.has('*');
