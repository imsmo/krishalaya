// apps/admin-api/src/core/rbac/owner-roles.ts · the platform OWNER-role permission catalog (Law 11).
// These are PLATFORM roles, defined HERE in the god-mode realm — never in the tenant DB's role_permissions
// (a tenant admin can NEVER be granted these). Least-privilege: each owner role lists exactly the platform
// permissions it holds; super_admin holds '*'. Permissions resolve from the token's roles claim against this
// static catalog — never trusted directly from the client.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const OwnerPermissions = {
  AiModelManage: 'ai.model.manage',     // register/promote/retire models + tune thresholds
  AiModelRead: 'ai.model.read',         // browse the registry + fairness reports
  TenantManage: 'tenant.manage',        // approve/suspend/archive tenants + limit overrides (consequential)
  TenantRead: 'tenant.read',            // search tenants + read scorecards
  ReconManage: 'recon.manage',          // open/resolve mismatch investigations + FREEZE wallet accounts
  ReconRead: 'recon.read',              // wallet reconciliation dashboard + run/investigation reads
  ComplianceManage: 'compliance.manage',// work DSRs, approve exports, manage retention, run breach console
  ComplianceRead: 'compliance.read',    // audit-log explorer + DSR/export/breach/retention reads
  // ADMIN-5 — the canon names this permission by hand on W041 and W042 ("Needs compliance.dsr — DPO-designated staff
  // only; every action is audited"). Separate from ComplianceManage because working a RIGHTS REQUEST means reading one
  // identified person's data and deciding what happens to it, while ComplianceManage also covers retention config and
  // export approvals, which name nobody. Somebody who tunes a retention policy has no reason to open a named farmer's
  // erasure. W046/W047's `compliance.consent.read`/`.write` and W043's `compliance.breach` are the same argument and are
  // NOT added here — they belong with the planes that use them (ADMIN-5b/5c), because a permission with no route behind
  // it is a promise nothing keeps.
  ComplianceDsr: 'compliance.dsr',      // work a DPDP rights request end to end (DPO-designated staff)
  // ADMIN-5b — both named by the canon (W046's and W047's restricted states). Separate from ComplianceDsr and from
  // ComplianceManage because they govern a different thing again: the REGISTRY is a cross-tenant list of people and
  // their choices, and the PURPOSE registry is the legal text every one of those choices was given against. Somebody
  // who works rights requests has no reason to rewrite a consent notice; somebody who authors notices has no reason to
  // read a named farmer's consent history.
  ComplianceConsentRead: 'compliance.consent.read',    // cross-tenant consent register + purposes (PII masked)
  ComplianceConsentWrite: 'compliance.consent.write',  // author + publish consent notices (checker-gated on publish)
  // ADMIN-5c — W043's restricted state names it ("Needs compliance.breach (DPO + security)"). Separate again because a
  // breach register is a SECURITY object as much as a privacy one: the people who need it are the on-call and the DPO,
  // not whoever tunes retention policies. W043 also says declaring is never blocked — any staff member can raise one
  // via the incident line — so this permission gates the CONSOLE, not the ability to report.
  ComplianceBreach: 'compliance.breach',
  BillingManage: 'billing.manage',      // SaaS invoice transitions + dunning + MANUAL money adjustments (via wallet-service)
  BillingRead: 'billing.read',          // revenue dashboard + invoice/adjustment/dunning reads
  FlagsManage: 'flags.manage',          // create/enable/disable flags + percent rollout + targeting + KILL-SWITCH (Law 10)
  FlagsRead: 'flags.read',              // flag registry + change-history reads
  PlansManage: 'plans.manage',          // SaaS plan catalogue: create/version/publish/archive + features + limits + pricing
  PlansRead: 'plans.read',              // plan catalogue + feature/limit + change-history reads
  ImpersonationGrant: 'impersonation.grant', // start/end/revoke a READ-ONLY act-as session (highest sensitivity)
  ImpersonationRead: 'impersonation.read',   // impersonation grant + action history reads (audit)
  SupportOversightRead: 'support.oversight.read',     // cross-tenant ticket + SLA-breach + tenant-health reads
  SupportOversightManage: 'support.oversight.manage', // escalate a ticket (raise severity / status / reassign)
  ReportsRead: 'reports.read',          // read-only exec dashboards (MRR/ARR/GMV/active-tenants/active-users)
  ProvidersManage: 'providers.manage',  // enable/disable an integration provider platform-wide (Law 12 degrade)
  ProvidersRead: 'providers.read',      // provider registry + credential-ref health reads (no secrets)
  AnnouncementsManage: 'announcements.manage', // author/schedule/publish/expire platform-wide announcements
  AnnouncementsRead: 'announcements.read',     // announcement list + change-history reads
  CatalogueManage: 'catalogue.manage',  // platform master taxonomy: lookup vocabularies + category tree (create/edit/move/activate)
  CatalogueRead: 'catalogue.read',      // taxonomy registry (types/values/categories) + change-history reads
  // PC-56 ADMIN-3b. DELIBERATELY NOT part of catalogue.*: curating the category tree does not entitle somebody to assert
  // that a Tamil sentence means what the English means. And this permission is necessary but NOT sufficient — the
  // `translation_reviewers` table (0103) decides which LANGUAGES, because a language list is data and an enum cannot
  // carry "…but only for Gujarati".
  TranslationsReview: 'translations.review',   // author + approve/reject translations, within one's granted languages
  TranslationsManage: 'translations.manage',   // grant/revoke a reviewer's languages; request machine-translation runs
  SchemesRegistryManage: 'schemes.registry.manage', // govt-scheme master: authorities + schemes (create/edit/version/activate)
  SchemesRegistryRead: 'schemes.registry.read',     // scheme/authority registry + change-history + window calendar reads
  // ADMIN-4b — TWO PERMISSIONS SEPARATE FROM THE REGISTRY ONES, AND THE SEPARATION IS THE WHOLE POINT.
  // The registry is GLOBAL data with no person in it: a catalogue editor may need `schemes.registry.*` all day. The
  // two below open cross-tenant reads over FARMERS, and W074's and W076's own restricted states name them by hand.
  // Folding either into `schemes.registry.read` would mean anybody who can fix a typo in a scheme's name can also
  // download every scheme applicant in the country — and in the audit ledger that export would be indistinguishable
  // from a taxonomy dump.
  SchemesApplicationsRead: 'schemes.applications.read', // cross-tenant scheme applications INCLUDING applicant PII
  SchemesDbtRead: 'schemes.dbt.read',                   // cross-tenant DBT/PFMS credit observations (never bank fields)
  CellsManage: 'cells.manage',  // shard/cell routing directory: register cells/shards, status lifecycle, tenant placement/move (Law 8/12)
  CellsRead: 'cells.read',      // cell/shard map + tenant-placement + residency + change-history reads (no DSN secrets)
} as const;
export type OwnerPermission = (typeof OwnerPermissions)[keyof typeof OwnerPermissions];

// role code → permissions. '*' = god mode (everything). These are PLATFORM roles only — they can NEVER be
// granted to a tenant user (Law 11); the tenant DB's role_permissions has no row for any of these codes.
const OWNER_ROLE_GRANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  super_admin:            ['*'],
  platform_ai_ops:        [OwnerPermissions.AiModelManage, OwnerPermissions.AiModelRead],
  platform_ai_auditor:    [OwnerPermissions.AiModelRead],
  platform_tenant_ops:    [OwnerPermissions.TenantManage, OwnerPermissions.TenantRead],
  platform_tenant_viewer: [OwnerPermissions.TenantRead],
  platform_recon_ops:     [OwnerPermissions.ReconManage, OwnerPermissions.ReconRead],
  platform_recon_viewer:  [OwnerPermissions.ReconRead],
  platform_compliance_ops:    [OwnerPermissions.ComplianceManage, OwnerPermissions.ComplianceRead, OwnerPermissions.ComplianceDsr],
  // The DPO works rights requests and reads the registers — and deliberately does NOT get ComplianceManage, so they
  // cannot rewrite a retention policy to change the scope of an erasure they are about to sign off. That separation is
  // the whole reason this role exists rather than being folded into platform_compliance_ops.
  platform_dpo:               [OwnerPermissions.ComplianceDsr, OwnerPermissions.ComplianceRead, OwnerPermissions.ComplianceConsentRead, OwnerPermissions.ComplianceBreach],
  // Security on-call works the breach register and reads the posture page, and holds nothing else — they have no reason
  // to open a named farmer's rights request at 3am.
  platform_security_oncall:   [OwnerPermissions.ComplianceBreach, OwnerPermissions.ComplianceRead],
  // The notice AUTHOR reads the registry and writes notices, and deliberately holds no rights-request permission: the
  // person who writes the words has no business reading which named farmers accepted them.
  platform_consent_author:    [OwnerPermissions.ComplianceConsentRead, OwnerPermissions.ComplianceConsentWrite],
  platform_compliance_viewer: [OwnerPermissions.ComplianceRead],   // DPO / auditor read-only
  platform_billing_ops:       [OwnerPermissions.BillingManage, OwnerPermissions.BillingRead],
  platform_billing_viewer:    [OwnerPermissions.BillingRead],      // finance / revenue analyst read-only
  platform_flags_ops:         [OwnerPermissions.FlagsManage, OwnerPermissions.FlagsRead],
  platform_flags_viewer:      [OwnerPermissions.FlagsRead],        // SRE / release manager read-only
  platform_plans_ops:         [OwnerPermissions.PlansManage, OwnerPermissions.PlansRead],
  platform_plans_viewer:      [OwnerPermissions.PlansRead],        // pricing / product analyst read-only
  platform_support_impersonator: [OwnerPermissions.ImpersonationGrant, OwnerPermissions.ImpersonationRead],
  platform_impersonation_auditor: [OwnerPermissions.ImpersonationRead],   // read-only audit of act-as sessions
  platform_support_oversight: [OwnerPermissions.SupportOversightManage, OwnerPermissions.SupportOversightRead],
  platform_support_oversight_viewer: [OwnerPermissions.SupportOversightRead],   // NOC / support-lead read-only
  platform_reports_viewer: [OwnerPermissions.ReportsRead],   // exec / finance / analyst — read-only dashboards
  platform_providers_ops: [OwnerPermissions.ProvidersManage, OwnerPermissions.ProvidersRead],
  platform_providers_viewer: [OwnerPermissions.ProvidersRead],   // integrations / SRE — read-only
  platform_announcements_ops: [OwnerPermissions.AnnouncementsManage, OwnerPermissions.AnnouncementsRead],
  platform_announcements_viewer: [OwnerPermissions.AnnouncementsRead],   // comms / marketing — read-only
  platform_catalogue_ops: [OwnerPermissions.CatalogueManage, OwnerPermissions.CatalogueRead],
  platform_catalogue_viewer: [OwnerPermissions.CatalogueRead],   // catalogue / data-governance analyst — read-only
  // A REVIEWER IS NOT A CATALOGUE EDITOR. They also need CatalogueRead to see the canonical text they are judging
  // against — reviewing a translation without its source is a spelling check, not a review.
  platform_translations_reviewer: [OwnerPermissions.TranslationsReview, OwnerPermissions.CatalogueRead],
  // The localisation LEAD decides who speaks for a language, and reviews too.
  platform_translations_lead: [OwnerPermissions.TranslationsManage, OwnerPermissions.TranslationsReview, OwnerPermissions.CatalogueRead],
  platform_schemes_ops: [OwnerPermissions.SchemesRegistryManage, OwnerPermissions.SchemesRegistryRead],
  platform_schemes_viewer: [OwnerPermissions.SchemesRegistryRead],   // govt-programs / policy analyst — read-only
  platform_cells_ops: [OwnerPermissions.CellsManage, OwnerPermissions.CellsRead],
  platform_cells_viewer: [OwnerPermissions.CellsRead],   // infra / SRE — read-only topology view
});

/** Flatten a token's roles to a permission set against the static owner catalog (unknown roles grant nothing). */
export function resolveOwnerPermissions(roles: string[]): Set<string> {
  const perms = new Set<string>();
  for (const r of roles) for (const p of OWNER_ROLE_GRANTS[r] ?? []) perms.add(p);
  return perms;
}
export function hasOwnerPermission(perms: Set<string>, needed: string): boolean { return perms.has('*') || perms.has(needed); }

export const REQUIRE_OWNER_PERMISSION = 'require_owner_permission';
export const RequireOwnerPermission = (perm: OwnerPermission) => SetMetadata(REQUIRE_OWNER_PERMISSION, perm);

/** Guard that THROWS (never logs) when the principal lacks the required owner permission (Law 6 / §4). */
@Injectable()
export class OwnerPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<string>(REQUIRE_OWNER_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!needed) return true;
    const req = ctx.switchToHttp().getRequest();
    const perms: Set<string> = req.admin?.permissions ?? new Set();
    if (!hasOwnerPermission(perms, needed)) throw new ForbiddenException(`missing owner permission: ${needed}`);
    return true;
  }
}
