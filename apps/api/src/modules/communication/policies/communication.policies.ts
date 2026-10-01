// modules/communication/policies/communication.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded 0004).
//   notification.manage — send a tenant broadcast + read the event catalogue (tenant_admin, support_agent). It USED to
//     gate template authoring too, which put "rewrite what every member receives" and "message everyone" on the
//     support agent's key (TENANT-8's F-19). [PC-56 TENANT-8a] Template authoring moved to its own two verbs:
//   notification.templates.manage  — write a draft override, submit it, withdraw your own (tenant_admin, support_agent);
//   notification.templates.approve — the CHECKER: approve / reject a colleague's version, retire an override
//     (tenant_admin only). Maker ≠ checker is the verdict AND 0175's trigger, so even a holder of both cannot
//     approve their own words.
// A user's OWN inbox + preferences + quiet hours need only authentication (ownership is the caller's userId,
// never a client-supplied id) — no special permission.
//   message.moderate — review + unflag/lock chat (support_agent/ai_ops/tenant_admin).
// Chat itself (open/post/read) + masked calls need only authentication; access is gated by PARTICIPANT
// membership (server-side), never a client-supplied id — a non-participant read 404s (anti-IDOR).
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const CommPermissions = { Manage: 'notification.manage', Moderate: 'message.moderate', TemplatesManage: 'notification.templates.manage', TemplatesApprove: 'notification.templates.approve' } as const;
export const canManageComms = (ctx: RequestContext) => ctx.permissions.has('notification.manage') || ctx.permissions.has('*');
export const canModerateMessages = (ctx: RequestContext) => ctx.permissions.has('message.moderate') || ctx.permissions.has('*');
export const canAuthorTemplates = (ctx: RequestContext) => ctx.permissions.has('notification.templates.manage') || ctx.permissions.has('*');
export const canApproveTemplates = (ctx: RequestContext) => ctx.permissions.has('notification.templates.approve') || ctx.permissions.has('*');
