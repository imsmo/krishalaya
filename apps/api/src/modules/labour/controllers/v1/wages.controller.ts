// modules/labour/controllers/v1/wages.controller.ts · PC-56 TENANT-SW-b · C — W166 (`/ops/labour/wages`): the daily 18:00 IST wage runs and
// worker advances.
//   GET  /labour/wages/today                today's run (or "queued for 18:00"), its lines, the manual acts, the retry ladder, the tiles
//   GET  /labour/wages/runs?before&limit    run history (by IST day)
//   GET  /labour/wages/runs/:id             one run with its lines
//   GET  /labour/advances?status&bookingId  advances (oversight: all; an employer: their own) + the outstanding total
//   GET  /labour/advances/cap/:assignmentId the form's cap preview (≤ 50 % of the expected wage; the database re-judges)
//   POST /labour/advances                   request an advance (the worker, the employer or the desk; reason)          (Idempotency-Key)
//   POST /labour/advances/:id/approve       approve + disburse from the escrow (employer, or advance.approve + employer consent) (Idempotency-Key)
//   POST /labour/advances/:id/reject        reject with a reason
// Write-off is REFUSED BY NAME (founder) — there is no route. The labour flag gates all of it.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { WageRunService } from '../../services/wage-run.service';
import { WorkerAdvanceService } from '../../services/worker-advance.service';
import { labourActor } from '../../policies/labour.policies';
import { decodeCursor } from '../../domain/cursor';
import { AdvanceNotFoundError, WageRunNotFoundError } from '../../domain/labour.errors';
import {
  AdvanceApproveSchema, AdvanceApproveDto, AdvanceListSchema, AdvanceListDto, AdvanceRejectSchema, AdvanceRequestSchema, AdvanceRequestDto, WageHistorySchema, WageHistoryDto,
} from '../../dto/swb.dto';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const requireKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'labour/wages', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class WageRunsController {
  constructor(private readonly runs: WageRunService) {}
  @Get('today')
  today(@CurrentContext() ctx: RequestContext) { return this.runs.today(ctx.tenantId, labourActor(ctx)).then((data) => ({ data })); }
  @Get('runs')
  history(@CurrentContext() ctx: RequestContext, @ZodQuery(WageHistorySchema) q: WageHistoryDto) {
    return this.runs.history(ctx.tenantId, labourActor(ctx), { before: q.before, limit: q.limit }).then((r) => ({ data: r.items, meta: { nextBefore: r.nextBefore } }));
  }
  @Get('runs/:id')
  run(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!UUID.test(id)) throw new WageRunNotFoundError(id);
    return this.runs.run(ctx.tenantId, labourActor(ctx), id).then((data) => ({ data }));
  }
}

@Controller({ path: 'labour/advances', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class AdvancesController {
  constructor(private readonly advances: WorkerAdvanceService) {}
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(AdvanceListSchema) q: AdvanceListDto) {
    return this.advances.list(ctx.tenantId, labourActor(ctx), { status: q.status, bookingId: q.bookingId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, totals: r.totals } }));
  }
  @Get('cap/:assignmentId')
  cap(@CurrentContext() ctx: RequestContext, @Param('assignmentId') assignmentId: string) {
    if (!UUID.test(assignmentId)) throw new AdvanceNotFoundError(assignmentId);
    return this.advances.capFor(ctx.tenantId, labourActor(ctx), assignmentId).then((data) => ({ data }));
  }
  @Post()
  request(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(AdvanceRequestSchema) dto: AdvanceRequestDto) {
    return this.advances.request(ctx.tenantId, labourActor(ctx), dto, `advance-request:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/approve')
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(AdvanceApproveSchema) dto: AdvanceApproveDto) {
    if (!UUID.test(id)) throw new AdvanceNotFoundError(id);
    return this.advances.approve(ctx.tenantId, labourActor(ctx), id, dto, `advance-approve:${id}:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/reject')
  reject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AdvanceRejectSchema) dto: { reason: string }) {
    if (!UUID.test(id)) throw new AdvanceNotFoundError(id);
    return this.advances.reject(ctx.tenantId, labourActor(ctx), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
