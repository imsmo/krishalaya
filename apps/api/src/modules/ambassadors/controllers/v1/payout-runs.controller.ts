// modules/ambassadors/controllers/v1/payout-runs.controller.ts · PC-56 TENANT-SW-b · A — W161 (`/people/ambassadors/earnings`).
//   GET  /ambassadors/payout-runs              history (µs keyset)                                       ambassador.payout.prepare | ambassador.payout
//   GET  /ambassadors/payout-runs/current      the open run (lines, funding, maker) + when the job prepares the next one
//   GET  /ambassadors/payout-runs/:runId       one run with its lines
//   POST /ambassadors/payout-runs/prepare      a person prepares a weekly run now (reason, Idempotency-Key)    ambassador.payout.prepare
//   POST /ambassadors/payout-runs/:runId/confirm  the CHECKER confirms → the run pays (tenant Main → ambassador Main)   ambassador.payout
//   POST /ambassadors/payout-runs/:runId/pay      re-run the unpaid lines of a confirmed run                          ambassador.payout
//   POST /ambassadors/payout-runs/:runId/refuse   refuse a prepared run (nothing moves)                               ambassador.payout
// Registered BEFORE AmbassadorsController (whose `:id` would otherwise shadow `payout-runs`). `ambassadors` flag.
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PayoutRunService } from '../../services/payout-run.service';
import { AmbassadorsPermissions } from '../../policies/ambassadors.policies';
import { decodeCursor } from '../../domain/cursor';
import { AmbassadorRunNotFoundError, AmbassadorsForbiddenError } from '../../domain/ambassadors.errors';
import { RunActSchema, RunListSchema, RunListDto } from '../../dto/enroll-ambassador.dto';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const runParam = (id: string) => { if (!UUID.test(id)) throw new AmbassadorRunNotFoundError(id); return id; };
const requireKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };
const has = (ctx: RequestContext, p: string) => ctx.permissions.has(p) || ctx.permissions.has('*');
/** The run screens are read by whoever prepares or confirms runs. */
const assertRunReader = (ctx: RequestContext) => {
  if (!has(ctx, AmbassadorsPermissions.PayoutPrepare) && !has(ctx, AmbassadorsPermissions.Payout)) throw new AmbassadorsForbiddenError('requires ambassador.payout.prepare or ambassador.payout');
};

@Controller({ path: 'ambassadors/payout-runs', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class PayoutRunsController {
  constructor(private readonly runs: PayoutRunService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(RunListSchema) q: RunListDto) {
    assertRunReader(ctx);
    return this.runs.list(ctx.tenantId, { cursor: decodeCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('current')
  current(@CurrentContext() ctx: RequestContext) { assertRunReader(ctx); return this.runs.current(ctx.tenantId, ctx.userId).then((data) => ({ data })); }

  @Post('prepare') @RequirePermissions(AmbassadorsPermissions.PayoutPrepare)
  prepare(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RunActSchema) dto: { reason: string }) {
    return this.runs.prepareByPerson(ctx.tenantId, { userId: ctx.userId }, { kind: 'weekly', reason: dto.reason }, `ambrun-prepare:${ctx.tenantId}:${requireKey(key)}`).then((data) => ({ data }));
  }

  @Get(':runId')
  get(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string) { assertRunReader(ctx); return this.runs.get(ctx.tenantId, runParam(runId), ctx.userId).then((data) => ({ data })); }

  @Post(':runId/confirm') @RequirePermissions(AmbassadorsPermissions.Payout)
  confirm(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string, @Headers('idempotency-key') key: string, @ZodBody(RunActSchema) dto: { reason: string }) {
    return this.runs.confirm(ctx.tenantId, { userId: ctx.userId }, runParam(runId), dto.reason, `ambrun-confirm:${runId}:${requireKey(key)}`).then((data) => ({ data }));
  }
  @Post(':runId/pay') @RequirePermissions(AmbassadorsPermissions.Payout)
  pay(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string, @Headers('idempotency-key') key: string, @ZodBody(RunActSchema) dto: { reason: string }) {
    return this.runs.payAgain(ctx.tenantId, { userId: ctx.userId }, runParam(runId), dto.reason, `ambrun-pay:${runId}:${requireKey(key)}`).then((data) => ({ data }));
  }
  @Post(':runId/refuse') @RequirePermissions(AmbassadorsPermissions.Payout)
  refuse(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string, @ZodBody(RunActSchema) dto: { reason: string }) {
    return this.runs.refuse(ctx.tenantId, { userId: ctx.userId }, runParam(runId), dto.reason).then((data) => ({ data }));
  }
}
