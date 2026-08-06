// apps/web-admin/src/features/tenants/tabs.ts · the per-tenant TAB MODEL (PC-56 ADMIN-1c, canon W003).
// No IO → unit-provable.
//
// THE PROBLEM THIS SOLVES. The canon shows a tenant as one subject with tabs — Profile, Billing, Modules & flags,
// Integrations, Audit. The console had those five things as five unrelated top-level routes, so answering "what is
// going on with Anand FPO?" meant visiting /tenants/x, then /billing, then /flags, then /providers, then
// /compliance/audit and re-filtering each one by hand. That is not a missing tab strip; it is a support call that
// takes four minutes instead of thirty seconds.
//
// WHAT THESE TABS ARE, HONESTLY. They are DEEP LINKS, not embedded views. Each one points at the real console route
// that owns that concern, pre-filtered to this tenant where the route supports it. Re-implementing five consoles
// inside a tab strip would duplicate every permission check and every degrade path; linking keeps one owner per
// concern. The label says where you are going.
//
// A TAB THAT CANNOT BE PRE-FILTERED IS MARKED. `flags` and `integrations` are platform-wide configuration screens
// with no per-tenant filter today, so those tabs are flagged `scoped: false` and the page says "platform-wide" beside
// them. A tab that silently showed every tenant's flags while sitting under one tenant's name would be actively
// misleading — the operator would read a global kill-switch as this tenant's setting.

export const TENANT_TABS = ['profile', 'billing', 'subscription', 'flags', 'integrations', 'audit'] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

export interface TabLink {
  key: TenantTab;
  href: string;
  /** false when the destination cannot be filtered to this tenant — the page says so rather than implying it is. */
  scoped: boolean;
}

/**
 * Build the tab strip for one tenant.
 *
 * `profile` is the page itself (the scorecard), so its href is the tenant route — an active tab that links to where
 * you already are is better than a tab that is absent, because the strip then always shows the full shape of what is
 * knowable about a tenant.
 */
export function tenantTabs(tenantId: string): TabLink[] {
  const id = encodeURIComponent(tenantId);
  return [
    { key: 'profile', href: `/tenants/${id}`, scoped: true },
    // the invoice list takes a tenantId filter (billing-ops QueryInvoicesSchema), so this really is this tenant's book
    { key: 'billing', href: `/billing/invoices?tenantId=${id}`, scoped: true },
    { key: 'subscription', href: `/tenants/${id}/subscription`, scoped: true },
    // platform-wide screens: no per-tenant filter exists on either API today
    { key: 'flags', href: '/flags', scoped: false },
    { key: 'integrations', href: '/providers', scoped: false },
    // the audit trail filters by entity, and a tenant IS an entity
    { key: 'audit', href: `/compliance/audit?entityType=tenant&entityId=${id}`, scoped: true },
  ];
}

export function isTenantTab(v: string | null | undefined): v is TenantTab {
  return !!v && (TENANT_TABS as readonly string[]).includes(v);
}

/** Which tab a route belongs to, so the strip can mark the current one wherever the operator has landed. Longest
 *  match wins: `/tenants/x/subscription` must not resolve to `profile` just because it starts with the tenant route. */
export function activeTab(pathname: string, tenantId: string): TenantTab {
  const id = encodeURIComponent(tenantId);
  if (pathname.startsWith(`/tenants/${id}/subscription`)) return 'subscription';
  if (pathname.startsWith('/billing')) return 'billing';
  if (pathname.startsWith('/flags')) return 'flags';
  if (pathname.startsWith('/providers')) return 'integrations';
  if (pathname.startsWith('/compliance/audit')) return 'audit';
  return 'profile';
}

/** The tabs that genuinely narrow to this tenant. Used for the "these are platform-wide" note, so the caller does not
 *  hard-code the list in two places and let them drift. */
export function unscopedTabs(tenantId: string): TenantTab[] {
  return tenantTabs(tenantId).filter((t) => !t.scoped).map((t) => t.key);
}
