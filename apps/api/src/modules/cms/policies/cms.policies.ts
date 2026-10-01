// modules/cms/policies/cms.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded 0004).
//   cms.manage        — manage the tenant's BANNERS (8d's). Before PC-56 TENANT-8c it also authored, published and
//                       archived every page — one key, tenant_admin only, no checker (F-19).
//   cms.pages.manage  — [8c] write a page / FAQ draft, restore an archived version as a draft, reorder the FAQ, withdraw
//                       a draft (tenant_admin, support_agent).
//   cms.pages.publish — [8c] publish a version, take a live version down (tenant_admin). On a POLICY page the publisher
//                       is never the version's author or last editor (page-acts.ts and 0177's trigger).
// Reading a PUBLISHED page (`by-slug`) or a LIVE banner + recording a banner click need only authentication. Platform
// pages (tenant_id NULL) are not writable here (Law 11 — admin-api only; 0177's policy split says so in the database).
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const CmsPermissions = { Manage: 'cms.manage', PagesManage: 'cms.pages.manage', PagesPublish: 'cms.pages.publish' } as const;
const has = (ctx: RequestContext, code: string) => ctx.permissions.has(code) || ctx.permissions.has('*');
export const canManageCms = (ctx: RequestContext) => has(ctx, CmsPermissions.Manage);
export const canAuthorPages = (ctx: RequestContext) => has(ctx, CmsPermissions.PagesManage);
export const canPublishPages = (ctx: RequestContext) => has(ctx, CmsPermissions.PagesPublish);
