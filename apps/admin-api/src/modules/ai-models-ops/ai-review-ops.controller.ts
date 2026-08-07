// apps/admin-api/src/modules/ai-models-ops/ai-review-ops.controller.ts · W082/W083/W084 (PC-56 ADMIN-7).
//
// A SEPARATE CONTROLLER PATH FROM `ai/models`, because a review case is not a model resource — it is a decision about one
// farmer's listing that happens to name a model. Nesting it under `ai/models/:id/...` would make the queue reachable only
// per model, which is the opposite of how W082 works: one officer draining one priority order across every model and
// every tenant.
//
// **ONE NEW OWNER PERMISSION, `ai.review`, named by W082 and previously existing only in the TENANT realm.** apps/api has
// it in `ai-governance.policies.ts` for a tenant's own reviewer; the platform officer the screen is written for had no
// permission and no surface at all. They are not the same act — a tenant reviews their own cases, a platform officer
// reviews everybody's — and reusing one grant for both would give a tenant admin cross-tenant reach.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { AiReviewService } from './services/ai-review.service';
import {
  QueryCasesSchema, QueryCasesDto, DecideCaseSchema, DecideCaseDto,
  QueryInferencesSchema, QueryInferencesDto,
} from './dto/ai-models-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'ai', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class AiReviewOpsController {
  constructor(private readonly review: AiReviewService) {}

  /* ======================= W082 · the queue ======================= */

  @Get('review/cases') @RequireOwnerPermission(OwnerPermissions.AiReview)
  listCases(@Req() req: any, @ZodQuery(QueryCasesSchema) q: QueryCasesDto) {
    return this.review.listCases(admin(req), q).then((r) => ({
      data: r.items, meta: { nextCursor: r.nextCursor, census: r.census, note: r.note },
    }));
  }

  /* ======================= W083 · one case ======================= */

  @Get('review/cases/:id') @RequireOwnerPermission(OwnerPermissions.AiReview)
  getCase(@Req() req: any, @Param('id') id: string) {
    return this.review.getCase(admin(req), id).then((data) => ({ data }));
  }

  /** Taking a case is a write and it is single-owner, so two officers cannot reach conflicting decisions on the same
   *  farmer's listing. Not step-up gated: claiming is reversible and making the safe first step expensive is how a queue
   *  goes unworked. */
  @Post('review/cases/:id/claim') @RequireOwnerPermission(OwnerPermissions.AiReview)
  claim(@Req() req: any, @Param('id') id: string) {
    return this.review.claim(admin(req), id).then((data) => ({ data }));
  }

  /** Deciding IS step-up gated. An `accept` on a `fraud_flag` holds a farmer's listing off the market; a `reject`
   *  releases a listing the model thought was fraudulent. Both are consequential for somebody outside this building. */
  @Post('review/cases/:id/decide')
  @RequireOwnerPermission(OwnerPermissions.AiReview)
  @UseGuards(StepUpReauthGuard)
  decide(@Req() req: any, @Param('id') id: string, @ZodBody(DecideCaseSchema) body: DecideCaseDto) {
    return this.review.decide(admin(req), id, body.decision, body.note).then((data) => ({ data }));
  }

  /* ======================= W084 · the decision explorer ======================= */

  /** `ai.model.read` and NOT `ai.review`: reading what models decided is the auditor's job and does not imply the right
   *  to decide anything. W084's restricted state names `ai.read`, which in this realm is `ai.model.read`. */
  @Get('inferences') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  listInferences(@Req() req: any, @ZodQuery(QueryInferencesSchema) q: QueryInferencesDto) {
    return this.review.listInferences(admin(req), q).then((r) => ({
      data: r.items, meta: { nextCursor: r.nextCursor, window: r.window, inputsWithheld: r.inputsWithheld },
    }));
  }
}
