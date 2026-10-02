// modules/requirements/controllers/v1/responses.controller.ts · acting on a single quote, or on a pooled quote as a whole.
// shortlist / accept (by quantity) / reject by the buyer — or by the buyer desk with the buyer's recorded consent for that act
// (PC-56 TENANT-11d, A4); reject = withdraw by the quote's own seller. Moderators read; they no longer decide (F-10).
// Gated by the `requirements` flag. Static `groups/…` routes are declared BEFORE `:id` so they are never shadowed.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { RequirementResponseService } from '../../services/requirement-response.service';
import { AcceptResponseSchema, AcceptResponseDto, DecideSchema, DecideDto } from '../../dto/requirement-desk.dto';
import { requirementActor } from '../../policies/requirements.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'responses', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('requirements')
export class ResponsesController {
  constructor(private readonly responses: RequirementResponseService) {}

  @Post('groups/:gid/accept')
  acceptGroup(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @ZodBody(DecideSchema) dto: DecideDto) {
    return this.responses.acceptGroup(ctx.tenantId, requirementActor(ctx), gid, ipOf(r), dto).then((data) => ({ data }));
  }
  @Post('groups/:gid/reject')
  rejectGroup(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @ZodBody(DecideSchema) dto: DecideDto) {
    return this.responses.rejectGroup(ctx.tenantId, requirementActor(ctx), gid, ipOf(r), dto).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.responses.getById(ctx.tenantId, requirementActor(ctx), id).then((data) => ({ data })); }

  @Post(':id/shortlist')
  shortlist(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DecideSchema) dto: DecideDto) {
    return this.responses.shortlist(ctx.tenantId, requirementActor(ctx), id, ipOf(r), dto).then((data) => ({ data }));
  }

  @Post(':id/accept')
  accept(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AcceptResponseSchema) dto: AcceptResponseDto) {
    return this.responses.accept(ctx.tenantId, requirementActor(ctx), id, ipOf(r), dto).then((data) => ({ data }));
  }

  @Post(':id/reject')
  reject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DecideSchema) dto: DecideDto) {
    return this.responses.reject(ctx.tenantId, requirementActor(ctx), id, ipOf(r), dto).then((data) => ({ data }));
  }
}
