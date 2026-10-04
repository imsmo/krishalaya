// modules/education/controllers/v1/studio-insights.controller.ts · PC-56 TENANT-SW-f · W417 — learner insights for the studio.
//   GET /v1/education/studio/insights            the courses the caller may read (µs keyset): a publisher all, an instructor their own
//   GET /v1/education/studio/insights/:courseId  the per-lesson funnel (real), the quiz-miss heatmap and the IST-hour watch curve (each
//                                                only at ≥ 50 distinct learners with captured data, else refused by name with the count)
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { canAuthor, canPublish } from '../../policies/education.policies';
import { LearnerInsightsService, StudioActor } from '../../services/learner-insights.service';

const PageSchema = z.object({ cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller({ path: 'education/studio/insights', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class StudioInsightsController {
  constructor(private readonly svc: LearnerInsightsService) {}
  private actor(ctx: RequestContext): StudioActor { return { userId: ctx.userId, canPublish: canPublish(ctx), canAuthor: canAuthor(ctx) }; }

  @Get()
  courses(@CurrentContext() ctx: RequestContext, @ZodQuery(PageSchema) q: z.infer<typeof PageSchema>) {
    return this.svc.courses(ctx.tenantId, this.actor(ctx), q).then((d) => ({ data: d.items, meta: { nextCursor: d.nextCursor, scope: d.scope } }));
  }
  @Get(':courseId')
  course(@CurrentContext() ctx: RequestContext, @Param('courseId') courseId: string) {
    if (!UUID.test(courseId)) throw new BadRequestError('courseId must be a uuid');
    return this.svc.course(ctx.tenantId, this.actor(ctx), courseId).then((data) => ({ data }));
  }
}
