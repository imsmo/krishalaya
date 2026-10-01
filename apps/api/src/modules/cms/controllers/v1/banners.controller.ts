// modules/cms/controllers/v1/banners.controller.ts · banner scheduling (admin) + live browse + click tracking.
// create/activate/deactivate + the `all` box need cms.manage; the `live` box + click are any authenticated user.
// `cms` flag.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BannerService } from '../../services/banner.service';
import { CmsPermissions, canManageCms } from '../../policies/cms.policies';
import { CreateBannerSchema, CreateBannerDto } from '../../dto/create-banner.dto';
import { QueryBannersSchema, QueryBannersDto } from '../../dto/query-banner.dto';
import { ipOf } from './pages.controller';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'cms/banners', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('cms')
export class BannersController {
  constructor(private readonly svc: BannerService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageCms(ctx) }; }

  @Post() @RequirePermissions(CmsPermissions.Manage)
  // PC-56 TENANT-8c (F-7): the audit row's `ip` is the client's, never the request id. The rest of the banners is 8d's.
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(CreateBannerSchema) dto: CreateBannerDto) { return this.svc.create(ctx.tenantId, this.actor(ctx), dto, ipOf(r)).then((data) => ({ data })); }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBannersSchema) q: QueryBannersDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, placement: q.placement, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id') @RequirePermissions(CmsPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Post(':id/activate') @RequirePermissions(CmsPermissions.Manage)
  activate(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.setActive(ctx.tenantId, this.actor(ctx), id, true).then((data) => ({ data })); }
  @Post(':id/deactivate') @RequirePermissions(CmsPermissions.Manage)
  deactivate(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.setActive(ctx.tenantId, this.actor(ctx), id, false).then((data) => ({ data })); }
  @Post(':id/click')
  click(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.recordClick(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
}
