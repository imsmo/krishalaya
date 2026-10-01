// modules/cms/policies/cms.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded 0004).
//   cms.manage        — RETIRED in TENANT-8d. Before 8c it authored, published and archived every page (F-19); until 8d it
//                       managed the banners. No route, service or policy reads it now (grep in the 8d report).
//   cms.banners.manage — [8d] write, activate, pause, resume, archive and reorder the cooperative's banners (tenant_admin):
//                       a banner reaches every member's home screen, so it is neither a page draft (support_agent writes
//                       those) nor a page publish.
//   cms.pages.manage  — [8c] write a page / FAQ draft, restore an archived version as a draft, reorder the FAQ, withdraw
//                       a draft (tenant_admin, support_agent).
//   cms.pages.publish — [8c] publish a version, take a live version down (tenant_admin). On a POLICY page the publisher
//                       is never the version's author or last editor (page-acts.ts and 0177's trigger).
// Reading a PUBLISHED page (`by-slug`) or the LIVE banners offered to you + recording a click need only authentication. Platform
// pages (tenant_id NULL) are not writable here (Law 11 — admin-api only; 0177's policy split says so in the database).
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const CmsPermissions = { BannersManage: 'cms.banners.manage', PagesManage: 'cms.pages.manage', PagesPublish: 'cms.pages.publish' } as const;
const has = (ctx: RequestContext, code: string) => ctx.permissions.has(code) || ctx.permissions.has('*');
export const canManageBanners = (ctx: RequestContext) => has(ctx, CmsPermissions.BannersManage);
export const canAuthorPages = (ctx: RequestContext) => has(ctx, CmsPermissions.PagesManage);
export const canPublishPages = (ctx: RequestContext) => has(ctx, CmsPermissions.PagesPublish);
