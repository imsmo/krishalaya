// modules/schemes/controllers/v1/scheme-desk.controller.ts · PC-56 TENANT-SW-b · D — W202 / W203 (the tenant schemes desk). scheme.desk.
//   GET  /schemes/desk/summary                       tiles (open apps, rejection rate FY, benefits landed FY + method, eligible-not-applied)
//   GET  /schemes/desk/schemes                       the per-scheme table
//   GET  /schemes/desk/pipeline/:code?group&cursor   one scheme's pipeline tab (counts for every tab; masked applicant; derived blocker)
//   POST /schemes/desk/sweeps                        "Run eligibility sweep" {schemeCode, reason} (Idempotency-Key) — a CALL LIST, never an application
//   GET  /schemes/desk/sweeps/:id?all&cursor         a sweep + its call list (eligible, not applied)
//   POST /schemes/desk/applications/:id/reveal       one form_data field, reason ≥ 20, audited
// Registered FIRST in the module: SchemesController's `GET schemes/:id` would otherwise swallow `schemes/desk/...`.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { SchemeDeskService } from '../../services/scheme-desk.service';
import { SchemesPermissions, canDesk } from '../../policies/schemes.policies';
import { PIPELINE_GROUPS } from '../../domain/scheme-desk';
import { ApplicationNotFoundError } from '../../domain/schemes.errors';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PipelineQuery = z.object({ group: z.enum(PIPELINE_GROUPS).default('under_verification'), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const SweepBody = z.object({ schemeCode: z.string().trim().min(1).max(60), reason: z.string().trim().min(3).max(300) }).strict();
const RevealBody = z.object({ field: z.string().trim().min(1).max(80), reason: z.string().trim().min(20).max(500) }).strict();

@Controller({ path: 'schemes/desk', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('schemes')
export class SchemeDeskController {
  constructor(private readonly desk: SchemeDeskService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canDesk: canDesk(ctx) }; }

  @Get('summary') @RequirePermissions(SchemesPermissions.Desk)
  summary(@CurrentContext() ctx: RequestContext) { return this.desk.summary(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('schemes') @RequirePermissions(SchemesPermissions.Desk)
  schemes(@CurrentContext() ctx: RequestContext) { return this.desk.schemeTable(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('pipeline/:code') @RequirePermissions(SchemesPermissions.Desk)
  pipeline(@CurrentContext() ctx: RequestContext, @Param('code') code: string, @ZodQuery(PipelineQuery) q: z.infer<typeof PipelineQuery>) {
    return this.desk.pipeline(ctx.tenantId, this.actor(ctx), code, q).then((data) => ({ data }));
  }
  @Post('sweeps') @RequirePermissions(SchemesPermissions.Desk)
  sweep(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(SweepBody) dto: z.infer<typeof SweepBody>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.desk.requestSweep(ctx.tenantId, this.actor(ctx), dto, `scheme-sweep:${ctx.tenantId}:${key}`, ipOf(r)).then((data) => ({ data }));
  }
  @Get('sweeps/:id') @RequirePermissions(SchemesPermissions.Desk)
  sweepView(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('cursor') cursor?: string, @Query('all') all?: string, @Query('limit') limit?: string) {
    if (!UUID.test(id)) throw new BadRequestError('sweep id is a uuid');
    return this.desk.sweepView(ctx.tenantId, this.actor(ctx), id, { cursor, all: all === 'true', limit: Math.min(Math.max(Number(limit) || 50, 1), 100) }).then((data) => ({ data }));
  }
  @Post('applications/:id/reveal') @RequirePermissions(SchemesPermissions.Desk)
  reveal(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RevealBody) dto: z.infer<typeof RevealBody>) {
    if (!UUID.test(id)) throw new ApplicationNotFoundError(id);
    return this.desk.reveal(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
