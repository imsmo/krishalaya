// modules/education/controllers/v1/live-sessions.controller.ts · PC-56 TENANT-7c · the live class (W414 · W415 + the
// live-form and live-mutate chains). `education` flag; auth; the permission is judged by the review or the verdict (the
// course's instructor, or the desk's key), not by a decorator, so a refused act is a sentence and never a bare 403.
// Every write takes an Idempotency-Key (Law 3). PC-26b's channel-gated schedule/start/end/cancel routes are GONE: one
// write path per act, with a reason and an audit row (6d-4).
//
//   GET    /education/live-sessions                       W414 — keyset by (scheduled_at, id); box · courseId · status
//   POST   /education/live-sessions/preview               the form's review (no key — writes nothing); `id` = an edit's
//   POST   /education/live-sessions                       create, FORM body, key, audited
//   GET    /education/live-sessions/:id                   W415 — the class with its acts' verdicts, window, reminders
//   PATCH  /education/live-sessions/:id                   edit while scheduled, same body, same review, audited before/after
//   POST   /education/live-sessions/:id/acts/:act         start · end · cancel · attendance · recording · to_lesson — WITH A REASON
//   POST   /education/live-sessions/:id/register          a member registers (refused when not open or full)
//
// `preview` is declared BEFORE `:id` — the route-order reason this programme has documented since 6d.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { LiveSessionService } from '../../services/live-session.service';
import { canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import { LiveFormSchema, LiveFormDto, PreviewLiveSchema, PreviewLiveDto, QueryLiveSchema, QueryLiveDto, LiveActSchema, LiveActDto } from '../../dto/schedule-live.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [at, id] = Buffer.from(c, 'base64').toString().split('|'); return at && id ? { at, id } : undefined; };
const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'education/live-sessions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class LiveSessionsController {
  constructor(private readonly svc: LiveSessionService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryLiveSchema) q: QueryLiveDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, courseId: q.courseId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewLiveSchema) dto: PreviewLiveDto) { return this.svc.preview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(LiveFormSchema) dto: LiveFormDto) {
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.get(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(LiveFormSchema) dto: LiveFormDto) {
    return this.svc.update(ctx.tenantId, this.actor(ctx), key, id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(LiveActSchema) dto: LiveActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), key, id, act, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/register')
  register(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string) {
    return this.svc.register(ctx.tenantId, this.actor(ctx), key ?? null, id, ipOf(r)).then((data) => ({ data }));
  }
}
