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
import { ShareRegisterReadModel } from '../../read-models/share-register.read-model';
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
  constructor(private readonly svc: GovernanceService, private readonly payouts: CoopPayoutService,
              private readonly register_: ShareRegisterReadModel) {}
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
  /**
   * Cast or CHANGE this member's own vote.
   *
   * **NO PERMISSION DECORATOR, AND THAT IS CORRECT — BUT IT WAS NOT SUFFICIENT.** W198 is explicit: "the vote itself belongs
   * to every eligible member — this console never casts votes for anyone." A permission would be the wrong tool, because a
   * vote is not a staff capability; the right gate is ELIGIBILITY, decided from the tenant's bylaws. Before PC-56 TENANT-1e
   * there was neither, so any authenticated user in the tenant could vote in an FPO's AGM. `GovernanceService.vote` now
   * refuses a non-member, a suspended member, somebody short of the shareholding bylaw, and somebody inside the tenure rule.
   *
   * `ctx.userId` and never a body parameter: the console cannot vote on somebody else's behalf because there is nowhere to
   * say whose behalf.
   */
  @Post(':id/vote')
  vote(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(VoteSchema) dto: { choice: string }) {
    return this.svc.vote(ctx.tenantId, ctx.userId, id, dto.choice).then((data) => ({ data }));
  }

  /** May I vote, and if not, what would I need? Read-only, about the CALLER only — the console shows it before offering a
   *  ballot, so a member reads "eligible from November" rather than tapping and being refused. */
  /**
   * W197's share register, tiles and bylaw panel.
   *
   * **`report.view`, THE SAME GRANT AS THE MEMBER ROSTER, AND NOT `tenant.settings`.** W197's restricted state reads
   * "Register edits are board + checker; members see their own holding in their app" — so READING the register is a member-desk
   * capability while EDITING it is not, and the two must not share a permission. There is no edit route in this wave: share
   * allotment is a money movement at first settlement ("Rs 200 deducted with consent"), and a register write with no allotment
   * path behind it would be a control whose promise the code cannot keep.
   */
  @Get('register')
  @RequirePermissions('report.view')
  register(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string) {
    return this.register_.view(ctx.tenantId, cursor).then((data) => ({ data }));
  }

  @Get('me/eligibility')
  eligibility(@CurrentContext() ctx: RequestContext) {
    return this.svc.eligibilityFor(ctx.tenantId, ctx.userId).then((data) => ({ data }));
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
