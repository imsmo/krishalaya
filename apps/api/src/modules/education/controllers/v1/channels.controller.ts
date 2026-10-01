// modules/education/controllers/v1/channels.controller.ts · register + moderate external content channels.
// register/update need channel.host (own channel); approve/suspend/reject need content.moderate. `education` flag.
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import type { Request } from 'express';
import { LearningChannelService } from '../../services/learning-channel.service';
import { EducationPermissions, canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import { RegisterChannelSchema, RegisterChannelDto, UpdateChannelSchema, UpdateChannelDto, ModerateChannelSchema, ModerateChannelDto } from '../../dto/register-channel.dto';
import { QueryChannelsSchema, QueryChannelsDto } from '../../dto/query-channel.dto';

// HOTFIX-1 (8c's F-7 class): the audit row's `ip` is an inet — the client's address (`req.ip`, behind main.ts's
// `trust proxy` hops) or NULL, never `ctx.requestId` (a UUID, which made every one of these writes a 22P02 and rolled back).
export const ipOf = (r: Pick<Request, 'ip'>): string | null => (typeof r.ip === 'string' && r.ip.length > 0 ? r.ip : null);
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'education/channels', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class ChannelsController {
  constructor(private readonly svc: LearningChannelService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }

  @Post() @RequirePermissions(EducationPermissions.Host)
  register(@CurrentContext() ctx: RequestContext, @ZodBody(RegisterChannelSchema) dto: RegisterChannelDto) { return this.svc.register(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryChannelsSchema) q: QueryChannelsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, topicId: q.topicId, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(EducationPermissions.Host)
  update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateChannelSchema) dto: UpdateChannelDto) { return this.svc.update(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }

  @Post(':id/approve') @RequirePermissions(EducationPermissions.Moderate)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateChannelSchema) dto: ModerateChannelDto) { return this.svc.moderate(ctx.tenantId, this.actor(ctx), id, 'approve', dto.note ?? null, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/suspend') @RequirePermissions(EducationPermissions.Moderate)
  suspend(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateChannelSchema) dto: ModerateChannelDto) { return this.svc.moderate(ctx.tenantId, this.actor(ctx), id, 'suspend', dto.note ?? null, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/reject') @RequirePermissions(EducationPermissions.Moderate)
  reject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateChannelSchema) dto: ModerateChannelDto) { return this.svc.moderate(ctx.tenantId, this.actor(ctx), id, 'reject', dto.note ?? null, ipOf(r)).then((data) => ({ data })); }
}
