// modules/logistics/controllers/v1/pod.controller.ts · PC-56 TENANT-SW-a · W237 / W238 — POD review (validate → authorize → delegate). `logistics`
// flag + logistics.manage; the acts need `pod_review` ON. Every write keyed. The walls (reviewer ≠ driver / dispatcher, reject needs a second
// person, the 2-hour window) are 0196 triggers; refusals come back by name.
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { PodReviewService } from '../../services/pod-review.service';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const BoardQuery = z.object({ status: z.enum(['awaiting', 'auto_cleared', 'flagged', 'approved', 'rejected']).optional(), cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const FlagBody = z.object({ reason: z.enum(['mismatch', 'no_photo', 'wrong_recipient', 'weight_variance', 'other']), note: z.string().trim().min(3).max(1000).optional(),
  varianceMinor: z.string().regex(/^[1-9]\d{0,15}$/).optional() }).strict();
const NoteBody = z.object({ note: z.string().trim().min(3).max(1000).optional() }).strict();
const RejectBody = z.object({ note: z.string().trim().min(10).max(1000) }).strict();

@Controller({ path: 'logistics/pod', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class PodController {
  constructor(private readonly pod: PodReviewService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  /** Tiles (Awaiting · Auto-cleared today · Flagged · Escrow released today) from real rows + the queue (oldest first, µs keyset). */
  @Get() @RequirePermissions(ShipmentPermissions.Manage)
  board(@CurrentContext() ctx: RequestContext, @ZodQuery(BoardQuery) q: z.infer<typeof BoardQuery>) {
    return this.pod.board(ctx.tenantId, this.actor(ctx), q).then((res) => ({ data: { enabled: res.enabled, tiles: res.tiles, items: res.items, weighbridge: res.weighbridge }, meta: { nextCursor: res.nextCursor } }));
  }
  @Post('take-next') @RequirePermissions(ShipmentPermissions.Manage)
  takeNext(@CurrentContext() ctx: RequestContext, @Body() _b: unknown) { return this.pod.takeNext(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get(':id') @RequirePermissions(ShipmentPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.pod.get(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/flag') @RequirePermissions(ShipmentPermissions.Manage)
  flag(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(FlagBody) dto: z.infer<typeof FlagBody>) {
    return this.pod.flag(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/approve') @RequirePermissions(ShipmentPermissions.Manage)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(NoteBody) dto: z.infer<typeof NoteBody>) {
    return this.pod.approve(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto.note, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/reject') @RequirePermissions(ShipmentPermissions.Manage)
  proposeReject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RejectBody) dto: z.infer<typeof RejectBody>) {
    return this.pod.proposeReject(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto.note, ipOf(r)).then((data) => ({ data }));
  }
  /** The second person: confirms the rejection → a qty_mismatch dispute with the POD evidence. */
  @Post(':id/reject/confirm') @RequirePermissions(ShipmentPermissions.Manage)
  confirmReject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Body() _b: unknown) {
    return this.pod.confirmReject(ctx.tenantId, this.actor(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
}
