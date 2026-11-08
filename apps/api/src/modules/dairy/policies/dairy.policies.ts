// modules/dairy/policies/dairy.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004, granted in 0235).
//   dairy.manage  — the cooperative's dairy administrator: centres, rate cards, enrolment, bills, every quality decision and
//                   every cooler setting — every money or settings act. Also records and reads (administrators keep it).
//   dairy.collect — [PC-56 OPS-3p · founder Q6-A, 2026-11-08] the COUNTER: records a pour and a manual cooler reading, and
//                   reads the boards. Never a rate, a bill, a member or a decision. "The person weighing her milk should not
//                   be the person who can change what it is worth."
//   dairy.read    — [PC-56 OPS-3p] reads the boards (counter board, quality desk, BMC monitor, day sheet, centre roll). No act.
//   Members READ their own data (no perm).
import { RequestContext } from '../../../core/tenancy-context/request-context';
import { IdentityPermissions } from '../../identity/policies/identity.policies';

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
export const DairyPermissions = {
  Manage: 'dairy.manage',
  SettlementClose: 'settlement.close',
  /**
   * [PC-56 TENANT-6d-6] DAIRY'S SECOND VERB — the dairy lead's.
   *
   * W170: *"playbook overrides are operator + dairy lead together."* A diversion sends a village's evening milk to
   * another centre, and one person's word is not enough. Deliberately NOT `settlement.close`: that is a MONEY
   * permission a cooperative may have granted to a treasurer who has no business moving milk. TENANT-6c-3 observed in
   * the roles seed that every sibling vertical has two verbs while dairy had only `manage` — this is the other one.
   */
  Override: 'dairy.override',
  /** [PC-56 OPS-3p · founder Q6-A] the counter's verb: a pour and a manual cooler reading (0235). */
  Collect: 'dairy.collect',
  /** [PC-56 OPS-3p · founder Q6-A] the boards' read-only verb (0235). */
  Read: 'dairy.read',
} as const;

/**
 * [PC-56 OPS-3p] THE TWO ANY-OF SETS — the ONE source for both layers. A route's `@RequireAnyPermission(...)` and the
 * service's own check (via `canCollectDairy` / `canReadDairy` on the actor) read the SAME array, so the two layers cannot
 * drift apart: widening one widens both, and a test sees it.
 *   COLLECT — record a pour / a manual cooler reading: the counter, or an administrator (who keeps every act it had).
 *   READ    — look at a board: the reader, the counter, or an administrator.
 * Neither ever contains a code that prices, bills, enrols or decides.
 */
export const DAIRY_COLLECT_ANY: readonly string[] = Object.freeze([DairyPermissions.Collect, DairyPermissions.Manage]);
export const DAIRY_READ_ANY: readonly string[] = Object.freeze([DairyPermissions.Read, DairyPermissions.Collect, DairyPermissions.Manage]);

/**
 * `dairy.manage` is the cooperative/MCC OPERATOR's verb. Until TENANT-6c-3 the roles seed also granted it to
 * `dairy_farmer`, so any member could create the rate card that sets what every other member is paid, generate a bill
 * and pay it out of the cooperative's wallet. Removed in 0159; nothing a member does needs it, because every
 * member-facing dairy route authorises by OWNERSHIP and carries no permission at all.
 */
export const canManageDairy = (ctx: RequestContext) => ctx.permissions.has('dairy.manage') || ctx.permissions.has('*');
/** [PC-56 OPS-3p] may record a pour / a manual cooler reading (DAIRY_COLLECT_ANY). */
export const canCollectDairy = (ctx: RequestContext) => DAIRY_COLLECT_ANY.some((p) => ctx.permissions.has(p)) || ctx.permissions.has('*');
/** [PC-56 OPS-3p] may read a dairy board (DAIRY_READ_ANY). */
export const canReadDairy = (ctx: RequestContext) => DAIRY_READ_ANY.some((p) => ctx.permissions.has(p)) || ctx.permissions.has('*');
/**
 * [PC-56 OPS-3p] The SERVICE side of the same two rules, on the resolved actor. `canCollect` / `canRead` are optional on the
 * actor and absent means FALSE (fail-closed, the TENANT-6c-3 rule); an actor built with `canManage: true` (every internal
 * caller and fixture before this wave) keeps what it had, because DAIRY_COLLECT_ANY and DAIRY_READ_ANY both contain
 * `dairy.manage`.
 */
export const actorMayCollect = (a: { canManage: boolean; canCollect?: boolean }) => a.canManage === true || a.canCollect === true;
export const actorMayRead = (a: { canManage: boolean; canCollect?: boolean; canRead?: boolean }) =>
  a.canManage === true || a.canCollect === true || a.canRead === true;
export const canCloseSettlement = (ctx: RequestContext) => ctx.permissions.has('settlement.close') || ctx.permissions.has('*');
/** The checker's verb for a playbook override (0166). `*` still passes, as it does for every permission on this
 *  platform — a god-mode caller is a different conversation (Law 11) and not a second rule here. */
export const canOverrideDairy = (ctx: RequestContext) => ctx.permissions.has('dairy.override') || ctx.permissions.has('*');

/**
 * [PC-56 TENANT-6e-1] W172's restricted state: *"insights restricted — member drill-down needs `member.view360`"*.
 *
 * The insights page is an AGGREGATE and needs `dairy.manage` like every other dairy screen. Opening one member's record
 * from it is a different decision, and 0128 already made it: `member.view360` is *"the deepest per-person read"*,
 * granted to `tenant_admin` alone. So the drill-down is answered here rather than the page assuming that a manager who
 * may see 312 pourers in total may also open any one of their files.
 *
 * The key is IMPORTED from identity rather than retyped. It is one seeded platform permission (0004 + 0128) and two
 * copies of the string is how a rename leaves a screen silently granting nobody — Law 6's reasoning applied to a
 * permission key. Identity's *policies* are its public authorisation surface; this is not a reach into its
 * repositories, which is what Law 11 forbids.
 */
export const canDrillDownMember = (ctx: RequestContext) =>
  ctx.permissions.has(IdentityPermissions.View360) || ctx.permissions.has('*');
