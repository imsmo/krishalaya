// modules/communication/controllers/v1/notifications.controller.ts · the caller's OWN notification inbox — PC-56
// TENANT-8b · THE INBOX. Every route acts on ctx.userId only (ownership is server-side; a non-owner read returns 404 — no
// IDOR). `communication` flag. validate → authorize → delegate only. Static segments are declared BEFORE `:id`.
//
//   GET  /notifications                    W204 / W431 — your IN-APP items (F-9), keyset, GET-form filters
//   GET  /notifications/filters            the tier / module vocabularies (from the catalogue)
//   GET  /notifications/bell               W432 — unread (capped at 100), the latest eight, what is held tonight
//   GET  /notifications/delivery-health    W204 "Member delivery health (24h)" — notification.manage, else a sentence
//   GET  /notifications/read-all           the mark-all-read confirm step's object (how many it would clear)
//   POST /notifications/read-all           MARK ALL READ — Idempotency-Key REQUIRED (the form's), audited
//   GET  /notifications/:id/ladder?at=     W434 — one of your notifications, every channel, each a ladder
//   POST /notifications/:id/read           mark one read — `at` prunes to one partition; Idempotency-Key when the form
//                                          sent one (older SDK callers send none — the act is idempotent by nature)
import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { InboxService, decodeInboxCursor } from '../../services/inbox.service';
import { QueryNotificationsSchema, QueryNotificationsDto, MarkReadSchema } from '../../dto/query-notification.dto';
import { canManageComms } from '../../policies/communication.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class NotificationsController {
  constructor(private readonly svc: InboxService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageComms(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryNotificationsSchema) q: QueryNotificationsDto) {
    return this.svc.list(ctx.tenantId, ctx.userId, {
      status: q.status, unreadOnly: q.unreadOnly, state: q.state as 'unread' | 'read' | undefined, tier: q.tier, module: q.module, channel: q.channel,
      cursor: decodeInboxCursor(q.cursor), limit: q.limit,
    }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, zone: res.zone, today: res.today } }));
  }
  @Get('filters')
  filters() { return this.svc.filters().then((data) => ({ data })); }
  @Get('bell')
  bell(@CurrentContext() ctx: RequestContext) { return this.svc.bell(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Get('delivery-health')
  health(@CurrentContext() ctx: RequestContext) { return this.svc.health(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('read-all')
  readAllPreview(@CurrentContext() ctx: RequestContext) { return this.svc.readAllPreview(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post('read-all')
  readAll(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.markAllRead(ctx.tenantId, this.actor(ctx), key, ipOf(r)).then((data) => ({ data }));
  }
  @Get(':id/ladder')
  ladder(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('at') at?: string) {
    return this.svc.ladder(ctx.tenantId, ctx.userId, id, typeof at === 'string' ? at : undefined).then((data) => ({ data }));
  }
  @Post(':id/read')
  read(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const parsed = MarkReadSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestError('at must be an ISO timestamp');
    return this.svc.markRead(ctx.tenantId, this.actor(ctx), id, { at: parsed.data.at ?? null, idemKey: key ?? null, ip: ipOf(r) }).then((data) => ({ data }));
  }
}
