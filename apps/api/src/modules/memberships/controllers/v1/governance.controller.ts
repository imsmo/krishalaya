// modules/memberships/controllers/v1/governance.controller.ts · PC-54 W54-7 `governance-agm`.
// Manage = tenant.settings (the FPO board); voting = any authenticated member (the DB PK is the ballot box).
import { Controller, Get, Headers, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { GovernanceService, RESOLUTION_TYPES } from '../../services/governance.service';
import { CoopPayoutService } from '../../services/coop-payout.service';
import { z } from 'zod';

const CreateResolutionSchema = z.object({
  title: z.string().trim().min(3).max(250),
  body: z.string().max(10000).optional(),
  resolutionType: z.enum(RESOLUTION_TYPES),
  votingOpens: z.string().datetime().optional(),
  votingCloses: z.string().datetime().optional(),
  payload: z.record(z.unknown()).optional(),
}).strict();
// PC-55 A8 · a run REQUIRES a second human (maker != checker), so confirmedBy is mandatory.
const PayoutRunSchema = z.object({ confirmedBy: z.string().uuid() }).strict();
const VoteSchema = z.object({ choice: z.string().trim().min(1).max(20) }).strict();

@Controller({ path: 'governance/resolutions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class GovernanceController {
  constructor(private readonly svc: GovernanceService, private readonly payouts: CoopPayoutService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: ctx.permissions.has('tenant.settings') || ctx.permissions.has('*') }; }

  @Post() @RequirePermissions('tenant.settings')
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateResolutionSchema) dto: z.infer<typeof CreateResolutionSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('status') status?: string) {
    return this.svc.list(ctx.tenantId, status).then((data) => ({ data }));
  }
  @Post(':id/open') @RequirePermissions('tenant.settings')
  open(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.transition(ctx.tenantId, this.actor(ctx), id, 'open').then((data) => ({ data })); }
  @Post(':id/close') @RequirePermissions('tenant.settings')
  close(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.transition(ctx.tenantId, this.actor(ctx), id, 'closed').then((data) => ({ data })); }
  @Post(':id/vote')
  vote(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(VoteSchema) dto: { choice: string }) {
    return this.svc.vote(ctx.tenantId, ctx.userId, id, dto.choice).then((data) => ({ data }));
  }
  // --- PC-55 A8 `coop-payout-runs`: an ACTIVATED dividend/patronage vote becomes queued payouts. ---
  @Get(':id/payout-preview') @RequirePermissions('tenant.settings')
  payoutPreview(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.payouts.preview(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
  @Post(':id/payout-run') @RequirePermissions('tenant.settings')
  payoutRun(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PayoutRunSchema) dto: { confirmedBy: string }) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.payouts.run(ctx.tenantId, this.actor(ctx), id, key, dto, r.ip || null).then((data) => ({ data }));
  }
  @Get('payout-runs/list') @RequirePermissions('tenant.settings')
  payoutRuns(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.payouts.runs(ctx.tenantId, this.actor(ctx), Number(limit) || 50).then((data) => ({ data }));
  }
  @Get('payout-runs/:runId') @RequirePermissions('tenant.settings')
  payoutRunDetail(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string) {
    return this.payouts.getRun(ctx.tenantId, this.actor(ctx), runId).then((data) => ({ data }));
  }

  @Get(':id/results')
  results(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.results(ctx.tenantId, id).then((data) => ({ data })); }
}
