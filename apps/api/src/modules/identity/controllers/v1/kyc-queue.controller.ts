// modules/identity/controllers/v1/kyc-queue.controller.ts · PC-56 TENANT-SW-c · A2 — W157 "Take next", W158 "Skip (take next)".
//
// Behind the `kyc` flag like the desk (FeatureFlagGuard: OFF = 404). `kyc.review` is judged by the service so a refusal is a sentence
// (`KYC_DESK_RESTRICTED`), and every rule the claim obeys (own / submitted / recused / already claimed) is re-checked by 0199's trigger.
// Take next and Skip are keyed (Idempotency-Key from the page that offers them).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE } from '../../../../shared/pagination/us-keyset';
import { KycQueueService } from '../../services/kyc-queue.service';
import { SkipClaimSchema, SkipClaimDto } from '../../dto/verification-team.dto';

const actorOf = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null });
const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };

@Controller({ path: 'kyc/queue', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('kyc')
export class KycQueueController {
  constructor(private readonly queue: KycQueueService) {}

  /** W157 "Take next": claim the oldest pending member document you may decide (FOR UPDATE SKIP LOCKED), for 15 minutes. */
  @Post('claim')
  claim(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string) {
    return this.queue.takeNext(ctx.tenantId, actorOf(ctx, req), needKey(key)).then((data) => ({ data }));
  }

  /** Your live claim (if any). */
  @Get('claims/mine')
  mine(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.queue.mine(ctx.tenantId, actorOf(ctx, req)).then((data) => ({ data }));
  }

  /** W158 "Skip (take next)": release with a coded reason and take the next one (never the same document again in this act). */
  @Post('claims/:id/skip')
  skip(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(SkipClaimSchema) dto: SkipClaimDto) {
    return this.queue.skip(ctx.tenantId, actorOf(ctx, req), idOf(id), dto, needKey(key)).then((data) => ({ data }));
  }

  /** Give the document back to the queue. */
  @Post('claims/:id/release')
  release(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string) {
    return this.queue.release(ctx.tenantId, actorOf(ctx, req), idOf(id)).then((data) => ({ data }));
  }
}
