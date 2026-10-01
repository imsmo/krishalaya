// modules/education/controllers/v1/resources.controller.ts · publish + moderate curated resources + browse.
// publish needs channel.host; approve/takedown need content.moderate. Browse is any authenticated user. `education` flag.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import type { Request } from 'express';
import { LearningResourceService } from '../../services/learning-resource.service';
import { CropCalendarReadModel } from '../../read-models/crop-calendar.read-model';
import { EducationPermissions, canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import { CreateResourceSchema, CreateResourceDto } from '../../dto/create-resource.dto';
import { QueryResourcesSchema, QueryResourcesDto } from '../../dto/query-resource.dto';
import { QueryCropCalendarSchema, QueryCropCalendarDto } from '../../dto/query-crop-calendar.dto';
import { ModerateChannelSchema, ModerateChannelDto } from '../../dto/register-channel.dto';

// HOTFIX-1 (8c's F-7 class): the audit row's `ip` is an inet — the client's address (`req.ip`, behind main.ts's
// `trust proxy` hops) or NULL, never `ctx.requestId` (a UUID, which made every one of these writes a 22P02 and rolled back).
export const ipOf = (r: Pick<Request, 'ip'>): string | null => (typeof r.ip === 'string' && r.ip.length > 0 ? r.ip : null);
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'education/resources', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class ResourcesController {
  constructor(private readonly svc: LearningResourceService, private readonly cropCalendars: CropCalendarReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }

  // Editorial crop-agronomy calendars (P1-5): reference growth-stage timelines by crop/season/region (read-only).
  @Get('crop-calendars')
  cropCalendars_(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCropCalendarSchema) q: QueryCropCalendarDto) {
    return this.cropCalendars.list(ctx.tenantId, q).then((data) => ({ data }));
  }

  @Post() @RequirePermissions(EducationPermissions.Host)
  publish(@CurrentContext() ctx: RequestContext, @ZodBody(CreateResourceSchema) dto: CreateResourceDto) { return this.svc.publish(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryResourcesSchema) q: QueryResourcesDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, channelId: q.channelId, kind: q.kind, topicId: q.topicId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Post(':id/approve') @RequirePermissions(EducationPermissions.Moderate)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateChannelSchema) dto: ModerateChannelDto) { return this.svc.moderate(ctx.tenantId, this.actor(ctx), id, 'approve', dto.note ?? null, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/takedown') @RequirePermissions(EducationPermissions.Moderate)
  takedown(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateChannelSchema) dto: ModerateChannelDto) { return this.svc.moderate(ctx.tenantId, this.actor(ctx), id, 'takedown', dto.note ?? null, ipOf(r)).then((data) => ({ data })); }
}
