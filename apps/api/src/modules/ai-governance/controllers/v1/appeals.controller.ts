// modules/ai-governance/controllers/v1/appeals.controller.ts · the one-tap appeal path (PC-56 ADMIN-SWEEP-b1).
//
// SUBMIT NEEDS ONLY AUTHENTICATION — no @RequirePermissions, deliberately, on the moderation-reports precedent: an
// appeal is a RIGHT exercised about a decision that hit YOU, and ownership (enforced in the service) is the
// authorization. Gating a farmer's avenue of contest behind a grantable permission would let a role misconfiguration
// silence exactly the person the platform just acted against. Same `ai_governance` flag as the moderation surface it
// appeals — if nothing can be removed, there is nothing to appeal.
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { AppealService, decodeAppealCursor } from '../../services/appeal.service';
import { SubmitAppealSchema, SubmitAppealDto, QueryMyAppealsSchema, QueryMyAppealsDto } from '../../dto/submit-appeal.dto';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'appeals', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ai_governance')
export class AppealsController {
  constructor(private readonly svc: AppealService) {}

  @Post()   // no @RequirePermissions — see header
  submit(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(SubmitAppealSchema) dto: SubmitAppealDto) {
    return this.svc.submit(ctx.tenantId, { userId: ctx.userId }, dto, ipOf(req)).then((data) => ({ data }));
  }

  @Get('mine')   // own rows only — the repository binds appellant to the token
  mine(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryMyAppealsSchema) q: QueryMyAppealsDto) {
    return this.svc.listMine(ctx.tenantId, { userId: ctx.userId }, { cursor: decodeAppealCursor(q.cursor), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
}
