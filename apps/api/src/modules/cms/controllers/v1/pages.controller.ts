// modules/cms/controllers/v1/pages.controller.ts · PC-56 TENANT-8c · THE PAGES (W175 · W176 + the page-form,
// page-mutate and pages-form chains). `cms` flag; auth; the verbs are judged by the review or the verdict
// (`cms.pages.manage` writes drafts, `cms.pages.publish` is the checker), never by a decorator on the writes, so a
// refused act is a sentence and never a bare 403. Every write takes an Idempotency-Key (Law 3). The audit row's `ip` is
// the client's (`req.ip`, behind main.ts's `trust proxy` hops) or NULL — never the request id, which has its own column
// (F-7: PC-27 passed `ctx.requestId` as `ip`).
//
//   GET    /cms/pages                    W175 — one row per slug, keyset on the slug, GET-form filters (kind · state ·
//                                        language), the chips' live counts, and the reader fact (there is none)
//   GET    /cms/pages/vocabulary         the form's choices (kinds · FAQ topics · archive reasons · languages)
//   POST   /cms/pages/preview            the form's review (writes nothing — no key)
//   POST   /cms/pages                    the form's write — a new page, a new version, or the open draft; keyed, audited
//   GET    /cms/pages/by-slug/:slug      the live page a member would be served (any authenticated user; F-14 fixed)
//   GET    /cms/pages/slug/:slug         W176 — a slug's versions, what serves, the acts each version has
//   GET    /cms/pages/:id                one version (an author's or publisher's read)
//   PATCH  /cms/pages/:id                the form's write aimed at that draft (the SDK's `update`); keyed, audited
//   GET    /cms/pages/:id/acts           the confirm step's object + verdicts (`?reason=&archiveReason=` to judge them)
//   POST   /cms/pages/:id/publish        keyed, a reason; a POLICY page by a second person
//   POST   /cms/pages/:id/archive        keyed, a reason and an archive reason from the vocabulary
//   POST   /cms/pages/:id/restore        keyed, a reason — an archived version comes back as the next draft
// Static segments are declared BEFORE `:id`.
import { Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ActMeta, CmsPageService } from '../../services/cms-page.service';
import { canAuthorPages, canPublishPages } from '../../policies/cms.policies';
import { PageActSchema, PageActDto, PageFormSchema, PageFormDto } from '../../dto/create-cms-page.dto';
import { QueryPagesSchema, QueryPagesDto } from '../../dto/query-cms-page.dto';

/** The client's address as Express resolved it through the trusted proxy hops — or NULL. Never a request id (F-7). */
export const ipOf = (r: Pick<Request, 'ip'>): string | null => (typeof r.ip === 'string' && r.ip.length > 0 ? r.ip : null);
export const metaOf = (ctx: RequestContext, r: Pick<Request, 'ip'>): ActMeta => ({ ip: ipOf(r), requestId: ctx.requestId ?? null });
export const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };
export const pageActor = (ctx: RequestContext) => ({ userId: ctx.userId, canAuthor: canAuthorPages(ctx), canPublish: canPublishPages(ctx) });

@Controller({ path: 'cms/pages', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('cms')
export class PagesController {
  constructor(private readonly svc: CmsPageService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryPagesSchema) q: QueryPagesDto) {
    return this.svc.index(ctx.tenantId, pageActor(ctx), { pageKind: q.pageKind, state: q.state, languageCode: q.languageCode, cursor: q.cursor, limit: q.limit })
      .then(({ items, nextCursor, ...rest }) => ({ data: items, meta: { nextCursor, ...rest } }));
  }
  @Get('vocabulary')
  vocabulary(@CurrentContext() ctx: RequestContext) { return this.svc.vocabulary(ctx.tenantId, pageActor(ctx)).then((data) => ({ data })); }
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(PageFormSchema) dto: PageFormDto) { return this.svc.preview(ctx.tenantId, pageActor(ctx), dto).then((data) => ({ data })); }
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(PageFormSchema) dto: PageFormDto) {
    return this.svc.save(ctx.tenantId, pageActor(ctx), needKey(key), dto, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Get('by-slug/:slug')
  bySlug(@CurrentContext() ctx: RequestContext, @Param('slug') slug: string) { return this.svc.getBySlug(ctx.tenantId, slug).then((data) => ({ data })); }
  @Get('slug/:slug')
  view(@CurrentContext() ctx: RequestContext, @Param('slug') slug: string) { return this.svc.view(ctx.tenantId, pageActor(ctx), slug).then((data) => ({ data })); }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, pageActor(ctx), id).then((data) => ({ data })); }
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(PageFormSchema) dto: PageFormDto) {
    return this.svc.save(ctx.tenantId, pageActor(ctx), needKey(key), dto, metaOf(ctx, r), id).then((data) => ({ data }));
  }
  @Get(':id/acts')
  acts(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('reason') reason?: string, @Query('archiveReason') archiveReason?: string) {
    return this.svc.acts(ctx.tenantId, pageActor(ctx), id, { reason: typeof reason === 'string' ? reason : undefined, archiveReason: typeof archiveReason === 'string' ? archiveReason : undefined }).then((data) => ({ data }));
  }
  @Post(':id/publish')
  publish(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(PageActSchema) dto: PageActDto) {
    return this.svc.act(ctx.tenantId, pageActor(ctx), needKey(key), id, 'publish', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/archive')
  archive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(PageActSchema) dto: PageActDto) {
    return this.svc.act(ctx.tenantId, pageActor(ctx), needKey(key), id, 'archive', { reason: dto.reason, archiveReason: dto.archiveReason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/restore')
  restore(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(PageActSchema) dto: PageActDto) {
    return this.svc.act(ctx.tenantId, pageActor(ctx), needKey(key), id, 'restore', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
}
