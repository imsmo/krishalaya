// modules/cms/controllers/v1/banners.controller.ts · PC-56 TENANT-8d · THE BANNERS (W173 · W174 + the banner-form,
// banner-mutate, banners-form and banners-mutate chains). `cms` flag; auth; the verb (`cms.banners.manage`) is judged by
// the review or the verdict, never by a decorator on the writes, so a refusal is a sentence and never a bare 403. Every
// write takes an Idempotency-Key (Law 3); the audit row's `ip` is the client's or NULL, the request id in its own column.
//
//   GET    /cms/banners                  W173 — keyset, GET-form filters (phase · placement · language), live counts,
//                                        and the reader fact (there is none)
//   GET    /cms/banners/vocabulary       the form's choices (placements · roles · regions · languages · clean images · zone)
//   GET    /cms/banners/live             any member: the banners live now for a placement, by THEIR audience facts and
//                                        language — what an app WOULD be offered (no app calls it yet)
//   POST   /cms/banners/preview          the form's review + reach (writes nothing — no key); `?id=` reviews an edit
//   POST   /cms/banners                  the New-banner write — born a draft; keyed, audited
//   GET    /cms/banners/slot             the reorder's confirm step (`?id=&direction=&reason=`)
//   POST   /cms/banners/slot             move a banner one place in its placement; keyed, audited, the slot locked
//   GET    /cms/banners/:id              W174 — the banner, its words per language, acts, reach, slot, group, who
//   PATCH  /cms/banners/:id              Save changes / Add a language — keyed, audited, `expect` → typed 409
//   GET    /cms/banners/:id/acts         the confirm step's verdicts (`?reason=` to judge it)
//   POST   /cms/banners/:id/{activate,pause,resume,archive}   keyed, a reason, audited
//   POST   /cms/banners/:id/click        any member — counts a click on a LIVE banner only
// Static segments are declared BEFORE `:id`. PC-27's `deactivate` is `pause` now (a reason, an audit row — F-7).
import { Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BannerService } from '../../services/banner.service';
import { canManageBanners } from '../../policies/cms.policies';
import { BannerActSchema, BannerActDto, BannerFormSchema, BannerFormDto, SlotMoveSchema, SlotMoveDto } from '../../dto/create-banner.dto';
import { LiveBannersSchema, LiveBannersDto, QueryBannersSchema, QueryBannersDto, SlotPreviewSchema, SlotPreviewDto } from '../../dto/query-banner.dto';
import { BannerPhase } from '../../domain/banner-window';
import { metaOf, needKey } from './pages.controller';

export const bannerActor = (ctx: RequestContext) => ({ userId: ctx.userId, canManage: canManageBanners(ctx) });

@Controller({ path: 'cms/banners', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('cms')
export class BannersController {
  constructor(private readonly svc: BannerService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBannersSchema) q: QueryBannersDto) {
    return this.svc.index(ctx.tenantId, bannerActor(ctx), { phase: q.phase as BannerPhase | undefined, placement: q.placement, languageCode: q.languageCode, cursor: q.cursor, limit: q.limit })
      .then(({ items, nextCursor, ...rest }) => ({ data: items, meta: { nextCursor, ...rest } }));
  }
  @Get('vocabulary')
  vocabulary(@CurrentContext() ctx: RequestContext) { return this.svc.vocabulary(ctx.tenantId, bannerActor(ctx)).then((data) => ({ data })); }
  @Get('live')
  live(@CurrentContext() ctx: RequestContext, @ZodQuery(LiveBannersSchema) q: LiveBannersDto) {
    return this.svc.live(ctx.tenantId, ctx.userId, { placement: q.placement, languageCode: q.languageCode, limit: q.limit }).then(({ items, ...rest }) => ({ data: items, meta: rest }));
  }
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(BannerFormSchema) dto: BannerFormDto, @Query('id') id?: string) {
    return this.svc.preview(ctx.tenantId, bannerActor(ctx), dto, typeof id === 'string' && id.length > 0 ? id : null).then((data) => ({ data }));
  }
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(BannerFormSchema) dto: BannerFormDto) {
    return this.svc.save(ctx.tenantId, bannerActor(ctx), needKey(key), dto, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Get('slot')
  slotPreview(@CurrentContext() ctx: RequestContext, @ZodQuery(SlotPreviewSchema) q: SlotPreviewDto) {
    return this.svc.slotPreview(ctx.tenantId, bannerActor(ctx), q.id, q.direction, q.reason ?? null).then((data) => ({ data }));
  }
  @Post('slot')
  slotMove(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(SlotMoveSchema) dto: SlotMoveDto) {
    return this.svc.slotMove(ctx.tenantId, bannerActor(ctx), needKey(key), { id: dto.id, direction: dto.direction, reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.view(ctx.tenantId, bannerActor(ctx), id).then((data) => ({ data })); }
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(BannerFormSchema) dto: BannerFormDto) {
    return this.svc.save(ctx.tenantId, bannerActor(ctx), needKey(key), dto, metaOf(ctx, r), id).then((data) => ({ data }));
  }
  @Get(':id/acts')
  acts(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('reason') reason?: string) {
    return this.svc.acts(ctx.tenantId, bannerActor(ctx), id, { reason: typeof reason === 'string' ? reason : undefined }).then((data) => ({ data }));
  }
  @Post(':id/activate')
  activate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(BannerActSchema) dto: BannerActDto) {
    return this.svc.act(ctx.tenantId, bannerActor(ctx), needKey(key), id, 'activate', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/pause')
  pause(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(BannerActSchema) dto: BannerActDto) {
    return this.svc.act(ctx.tenantId, bannerActor(ctx), needKey(key), id, 'pause', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/resume')
  resume(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(BannerActSchema) dto: BannerActDto) {
    return this.svc.act(ctx.tenantId, bannerActor(ctx), needKey(key), id, 'resume', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/archive')
  archive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(BannerActSchema) dto: BannerActDto) {
    return this.svc.act(ctx.tenantId, bannerActor(ctx), needKey(key), id, 'archive', { reason: dto.reason }, metaOf(ctx, r)).then((data) => ({ data }));
  }
  @Post(':id/click')
  click(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.recordClick(ctx.tenantId, { userId: ctx.userId }, id).then((data) => ({ data })); }
}
