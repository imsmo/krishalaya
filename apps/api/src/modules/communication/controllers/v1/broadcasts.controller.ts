// modules/communication/controllers/v1/broadcasts.controller.ts · THE BROADCAST PLANE — PC-56 TENANT-8e (W429, W2841–W2847,
// W2839/W2840). Gated by the `communication` flag (404 → the console's "flagged off" sentence) and authentication; the verb is
// judged by the SERVICE, never a decorator, so a refusal is a sentence (`COMM_FORBIDDEN`, `BROADCAST_FORM_REFUSED` with the
// review's codes, `BROADCAST_ACT_REFUSED` with the verdict's) — never a bare 403:
//   • READ (history, receipt, the review, the confirm step, the audience choices): `notification.broadcast.send` OR
//     `notification.manage` (the support agent keeps the read);
//   • WRITE (save draft, send, cancel): `notification.broadcast.send` — tenant_admin only (F-19). Every write takes the
//     FORM's Idempotency-Key (F-17) and is audited with the client IP and the request id in their own columns.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ExportPlaneService } from '../../../../core/exports-plane/export-plane.service';
import { canReadBroadcasts, canSendBroadcasts } from '../../policies/communication.policies';
import { BroadcastService, decodeBroadcastCursor } from '../../services/broadcast.service';
import { BROADCASTS_DATASET } from '../../exports/broadcasts.dataset';
import {
  BroadcastActSchema, BroadcastActDto, BroadcastActsQuerySchema, BroadcastExportParamsSchema, BroadcastExportParams, BroadcastFormSchema, BroadcastFormDto,
  QueryBroadcastsSchema, QueryBroadcastsDto,
} from '../../dto/create-broadcast.dto';

const ipOf = (r: Request) => r.ip || null;
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'communication/broadcasts', version: '1' })
@UseGuards(AuthGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class BroadcastsController {
  constructor(private readonly svc: BroadcastService, private readonly exportsPlane: ExportPlaneService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canSend: canSendBroadcasts(ctx), canRead: canReadBroadcasts(ctx) }; }
  private meta(ctx: RequestContext, r: Request) { return { ip: ipOf(r), requestId: ctx.requestId ?? null }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBroadcastsSchema) q: QueryBroadcastsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { status: q.status, cursor: decodeBroadcastCursor(q.cursor), limit: q.limit })
      .then(({ items, nextCursor, byStatus, zone, canSend }) => ({ data: items, meta: { nextCursor, byStatus, zone, canSend } }));
  }
  @Get('roles')
  roles(@CurrentContext() ctx: RequestContext) { return this.svc.roles(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }

  /** The form chain's review (writes nothing — no key). */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(BroadcastFormSchema) dto: BroadcastFormDto) {
    return this.svc.preview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  /** *Save draft* (W2841–W2844). */
  @Post()
  saveDraft(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(BroadcastFormSchema) dto: BroadcastFormDto) {
    return this.svc.saveDraft(ctx.tenantId, this.actor(ctx), needKey(key), dto, this.meta(ctx, r)).then((data) => ({ data }));
  }
  /** W2839 · enqueue the export of the broadcast history (the plane checks the dataset's verb and its flag). */
  @Post('export')
  enqueueExport(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(BroadcastExportParamsSchema) body: BroadcastExportParams) {
    return this.exportsPlane.enqueue(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions }, needKey(key), { datasetCode: BROADCASTS_DATASET, params: body }, ipOf(r))
      .then((data) => ({ data }));
  }

  @Get(':id')
  view(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.view(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/preview')
  previewEdit(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(BroadcastFormSchema) dto: BroadcastFormDto) {
    return this.svc.preview(ctx.tenantId, this.actor(ctx), dto, id).then((data) => ({ data }));
  }
  @Patch(':id')
  editDraft(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(BroadcastFormSchema) dto: BroadcastFormDto) {
    return this.svc.saveDraft(ctx.tenantId, this.actor(ctx), needKey(key), dto, this.meta(ctx, r), id).then((data) => ({ data }));
  }
  /** The mutate chain's confirm step: both verdicts (the reason judged when given) and the send maths for a draft. */
  @Get(':id/acts')
  acts(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(BroadcastActsQuerySchema) q: { reason?: string }) {
    return this.svc.acts(ctx.tenantId, this.actor(ctx), id, q.reason).then((data) => ({ data }));
  }
  /** *Send broadcast* (W2845–W2847): a draft → queued (now) or scheduled (its time). */
  @Post(':id/send')
  send(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(BroadcastActSchema) body: BroadcastActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), id, 'send', needKey(key), body.reason, this.meta(ctx, r)).then((data) => ({ data }));
  }
  /** Cancel a draft or a scheduled broadcast. */
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(BroadcastActSchema) body: BroadcastActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), id, 'cancel', needKey(key), body.reason, this.meta(ctx, r)).then((data) => ({ data }));
  }
}
