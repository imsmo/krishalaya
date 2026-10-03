// modules/tenant-webhooks/controllers/v1/webhooks.controller.ts · the calling tenant's webhook endpoints and delivery log
// (validate → authorize → delegate) — PC-56 TENANT-13a.
//   • behind the `tenancy` flag (OFF → 404; the console prints "Flagged off");
//   • EVERY route — read and write — needs `api.manage` (tenant_admin), F-12: `tenant.settings` alone no longer lists URLs, and the
//     delivery log's payloads are member-adjacent data;
//   • every write takes the Idempotency-Key its review / confirm page minted (Law 3, F-21) and a reason where it is an act;
//   • the signing secret leaves the API only in the response to register / rotate, once;
//   • the delivery routes are declared before the `:id` routes so `deliveries` is never read as an endpoint id.
import { Controller, Delete, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE, decodeKeyset } from '../../../../shared/pagination/us-keyset';
import { TenantWebhookService, WebhooksActor } from '../../services/tenant-webhook.service';
import { WebhookDeliveryLogService } from '../../services/webhook-delivery-log.service';
import { EndpointAct, isEndpointAct } from '../../domain/webhook-rules';
import {
  CreateWebhookDto, CreateWebhookSchema, PreviewWebhookDto, PreviewWebhookSchema, QueryDeliveriesDto, QueryDeliveriesSchema, ReasonDto, ReasonSchema,
  UpdateWebhookDto, UpdateWebhookSchema,
} from '../../dto/create-webhook.dto';
import { ApiScopes } from '../../../../core/auth/api-key.port';

const needKey = (k?: string) => { if (!k || !/^[A-Za-z0-9_-]{8,120}$/.test(k)) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const actOf = (a: string): EndpointAct => { if (!isEndpointAct(a)) throw new BadRequestError(`'${a}' is not an endpoint act (pause, resume, rotate, delete, replay-failed)`); return a; };
const ipOf = (r: Request) => (r.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || r.ip || null;

@Controller({ path: 'webhooks', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
@RequirePermissions('api.manage')
export class WebhooksController {
  constructor(private readonly webhooks: TenantWebhookService, private readonly log: WebhookDeliveryLogService) {}
  private actor(ctx: RequestContext, r: Request): WebhooksActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: ipOf(r), requestId: ctx.requestId || null }; }

  /** The public catalogue: name, payload version, the fields a v1 payload carries. */
  @Get('events')
  events(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return { data: this.webhooks.catalogue(this.actor(ctx, r)) }; }

  /** W188 — the endpoints (never a secret), their 7-day figures, the count, and the delivery contract as built. */
  @Get() @ApiScopes('webhooks.read')
  list(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return this.webhooks.list(ctx.tenantId, this.actor(ctx, r)).then((data) => ({ data })); }

  /** W2833 — the registration review (live guard verdict). Writes nothing. */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(PreviewWebhookSchema) dto: PreviewWebhookDto) {
    return this.webhooks.preview(ctx.tenantId, this.actor(ctx, r), dto).then((data) => ({ data }));
  }

  /** W2834 — register (keyed). The secret is in THIS response body, once. */
  @Post()
  register(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateWebhookSchema) dto: CreateWebhookDto) {
    return this.webhooks.register(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }

  // ---- the delivery log (W189) ----
  @Get('deliveries') @ApiScopes('webhooks.read')
  deliveries(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(QueryDeliveriesSchema) q: QueryDeliveriesDto) {
    return this.log.list(ctx.tenantId, this.actor(ctx, r), {
      filter: { endpointId: q.endpointId, status: q.status ?? 'all', since: q.since }, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit,
    }).then((data) => ({ data }));
  }
  @Get('deliveries/:id') @ApiScopes('webhooks.read')
  delivery(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.log.get(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data }));
  }
  @Post('deliveries/:id/acts/replay/preview')
  previewReplay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.log.previewReplay(ctx.tenantId, this.actor(ctx, r), idOf(id), dto.reason).then((data) => ({ data }));
  }
  @Post('deliveries/:id/replay')
  replay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.log.replay(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }

  // ---- one endpoint ----
  /** Change event subscriptions (keyed, reasoned, audited before → after). */
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(UpdateWebhookSchema) dto: UpdateWebhookDto) {
    return this.webhooks.updateEvents(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto).then((data) => ({ data }));
  }
  /** W2836 — the confirm step's verdict for pause | resume | rotate | delete | replay-failed (read-only). */
  @Post(':id/acts/:act/preview')
  previewAct(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Param('act') act: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.previewAct(ctx.tenantId, this.actor(ctx, r), idOf(id), actOf(act), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/pause')
  pause(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.act(ctx.tenantId, this.actor(ctx, r), idOf(id), 'pause', needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/resume')
  resume(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.act(ctx.tenantId, this.actor(ctx, r), idOf(id), 'resume', needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/replay-failed')
  replayFailed(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.act(ctx.tenantId, this.actor(ctx, r), idOf(id), 'replay-failed', needKey(key), dto.reason).then((data) => ({ data }));
  }
  /** W2837 — rotate (keyed, reasoned). The new secret is in THIS response body, once; the old one signs for 24 h. */
  @Post(':id/rotate-secret')
  rotate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.rotate(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
  /** Soft delete (F-6) — keyed, reasoned; the open deliveries are cancelled. */
  @Delete(':id')
  remove(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.webhooks.act(ctx.tenantId, this.actor(ctx, r), idOf(id), 'delete', needKey(key), dto.reason).then((data) => ({ data }));
  }
}
