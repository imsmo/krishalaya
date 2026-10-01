// modules/cms/controllers/v1/faq.controller.ts · PC-56 TENANT-8c · W177 — the FAQ (`cms_pages` with page_kind = faq,
// grouped by topic) and its reorder act. An FAQ entry IS a page: it is written, published, archived and restored through
// `cms/pages` (the SDK's `faq.create / update / publish` call those routes with the kind fixed); what is the FAQ's own is
// the list and the order inside a topic.
//
//   GET    /cms/faq                     W177 — entries by topic and place, GET-form filters (topic · state), live tiles
//   GET    /cms/faq/reorder             the reorder confirm step (`?slug=&direction=&reason=`) — the verdict, the order
//   POST   /cms/faq/reorder             the reorder act — keyed, a reason, audited, the topic locked
import { Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { CmsPageService } from '../../services/cms-page.service';
import { FaqMoveSchema, FaqMoveDto } from '../../dto/create-cms-page.dto';
import { QueryFaqSchema, QueryFaqDto } from '../../dto/query-cms-page.dto';
import { metaOf, needKey, pageActor } from './pages.controller';

@Controller({ path: 'cms/faq', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('cms')
export class FaqController {
  constructor(private readonly svc: CmsPageService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryFaqSchema) q: QueryFaqDto) {
    return this.svc.faqIndex(ctx.tenantId, pageActor(ctx), { topic: q.topic, state: q.state }).then(({ items, ...rest }) => ({ data: items, meta: rest }));
  }
  @Get('reorder')
  preview(@CurrentContext() ctx: RequestContext, @Query('slug') slug?: string, @Query('direction') direction?: string, @Query('reason') reason?: string) {
    const d = direction === 'down' ? 'down' : 'up';
    return this.svc.faqMovePreview(ctx.tenantId, pageActor(ctx), typeof slug === 'string' ? slug : '', d, typeof reason === 'string' ? reason : null).then((data) => ({ data }));
  }
  @Post('reorder')
  move(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(FaqMoveSchema) dto: FaqMoveDto) {
    return this.svc.faqMove(ctx.tenantId, pageActor(ctx), needKey(key), { slug: dto.slug, direction: dto.direction, reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
}
