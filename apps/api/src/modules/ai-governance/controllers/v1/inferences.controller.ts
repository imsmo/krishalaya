// modules/ai-governance/controllers/v1/inferences.controller.ts · record AI decisions (audit log) + browse +
// human override. record needs ai.review + Idempotency-Key. validate→authorize→delegate only. `ai_governance` flag.
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AiInferenceService } from '../../services/ai-inference.service';
import { AiPermissions, canReviewAi, canModerateContent, canReadInferences } from '../../policies/ai-governance.policies';
import { CreateInferenceSchema, CreateInferenceDto } from '../../dto/create-ai-inference.dto';
import { QueryInferencesSchema, QueryInferencesDto } from '../../dto/query-ai-inference.dto';
import { OverrideInferenceSchema, OverrideInferenceDto } from '../../dto/override-ai-inference.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'ai/inferences', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ai_governance')
export class InferencesController {
  constructor(private readonly svc: AiInferenceService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canReview: canReviewAi(ctx), canModerate: canModerateContent(ctx), canRead: canReadInferences(ctx) }; }

  @Post() @RequirePermissions(AiPermissions.Review)
  record(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateInferenceSchema) dto: CreateInferenceDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.record(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  /** PC-56 TENANT-12 (F-7): `ai.review` OR `ai.inference.read` (judged by the service); RLS confines either to this tenant. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInferencesSchema) q: QueryInferencesDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { subjectType: q.subjectType, subjectId: q.subjectId, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
  @Post(':id/override') @RequirePermissions(AiPermissions.Review)
  override(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(OverrideInferenceSchema) dto: OverrideInferenceDto) {
    return this.svc.override(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
}
