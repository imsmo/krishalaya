// core/rbac/ungrantable.ts · PC-56 TENANT-13b · THE ONE LIST OF PERMISSIONS NO TENANT PATH MAY HAND OUT (F-18, brief B1 "same list,
// one source").
//
// Two tenant paths hand permissions to a person beyond their role: a per-person staff OVERRIDE (`user-tenant-role.service.ts`,
// `POST /rbac/overrides`) and a DESK (0192, `desk.service.ts`). Both — and the RBAC resolver itself, which refuses to compile one of
// these codes out of a desk even if a row somehow carries it (`role-cache.service.ts`) — read THIS set. Before this wave the override
// path held its own inline copy and a desk had none.
//
// What is on it, and why:
//   • god-mode and platform verbs — `*`, plan.manage, tenant.manage, user.impersonate, flag.toggle (Law 11);
//   • the money verbs a bundle must never reach — wallet.adjust, and every CHECKER code: payout.approve, group_lot.settle_approve,
//     labour.wages.approve, notification.templates.approve (a maker and a checker are different humans BY CONSTRUCTION — canon W185:
//     "approval is tenant_admin — maker and checker are different humans by construction");
//   • the keys of the house — tenant.settings, desk.manage, user.approve, api.manage: a desk that carried one would let its members
//     re-grant themselves, change the trust-affecting settings, or become the second signature of the desk proposal that made them.
//
// `listing.approve` is deliberately NOT here: canon's moderation desk carries it, and QC's no-self-review (QC_OWN_DRAFT /
// QC_OWN_LISTING, 0138's CHECK) is the separation it needs.
//
// The web console's override form mirrors this list for UX only (apps/web-tenant/src/features/team/permissions.ts) — a parity test
// (`tenant13b-settings-desks.spec.ts`) fails on any drift; the desk form reads the grantable list from the API.
export const UNGRANTABLE_PERMISSIONS: ReadonlySet<string> = new Set([
  '*', 'plan.manage', 'tenant.manage', 'user.impersonate', 'flag.toggle',
  'wallet.adjust', 'payout.approve', 'group_lot.settle_approve', 'labour.wages.approve', 'notification.templates.approve',
  'tenant.settings', 'desk.manage', 'user.approve', 'api.manage',
]);

export function isUngrantable(code: string): boolean { return UNGRANTABLE_PERMISSIONS.has(code); }
