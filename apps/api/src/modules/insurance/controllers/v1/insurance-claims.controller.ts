// modules/insurance/controllers/v1/insurance-claims.controller.ts · claims lifecycle (KV-BL-054, screens
// 289-293). `insurance` flag. file/add-evidence/acknowledge = claimant (insurance.enrol); request-docs/
// schedule-survey/record-survey/decide/settle/close = insurer (insurance.manage) — mirrors fintech's
// loan-applications controller's borrower-vs-lender RBAC split exactly (the "lender-partner RBAC pattern").
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { InsuranceClaimService } from '../../services/insurance-claim.service';
import { CreateInsuranceClaimSchema, CreateInsuranceClaimDto, AddClaimEvidenceSchema, AddClaimEvidenceDto, AcknowledgeAssessmentSchema, AcknowledgeAssessmentDto } from '../../dto/create-insurance-claim.dto';
import { ScheduleSurveySchema, ScheduleSurveyDto, RecordSurveySchema, RecordSurveyDto, DecideClaimSchema, DecideClaimDto } from '../../dto/insurance-claim-actions.dto';
import { VerifyVetCertSchema, VerifyVetCertDto } from '../../dto/verify-vet-cert.dto';
import { QueryInsuranceClaimsSchema, QueryInsuranceClaimsDto } from '../../dto/query-insurance-claim.dto';
import { InsurancePermissions, canManageInsurance } from '../../policies/insurance.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'insurance/claims', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('insurance')
export class InsuranceClaimsController {
  constructor(private readonly svc: InsuranceClaimService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageInsurance(ctx) }; }

  /** FILE a claim (screens 289-290). Idempotency-Key required (Law 3). */
  @Post() @RequirePermissions(InsurancePermissions.Enrol)
  file(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateInsuranceClaimSchema) dto: CreateInsuranceClaimDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.file(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }

  /** "My claims" (or the insurer queue, insurance.manage) — screen 291's status tracker list. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInsuranceClaimsSchema) q: QueryInsuranceClaimsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { status: q.status, policyId: q.policyId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** Claim detail (screen 291). 404-not-403 anti-IDOR. */
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  /** ADD EVIDENCE (screen 290, add-more path). */
  @Post(':id/evidence') @RequirePermissions(InsurancePermissions.Enrol)
  addEvidence(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(AddClaimEvidenceSchema) dto: AddClaimEvidenceDto) {
    return this.svc.addEvidence(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  /** screen 292's "I agree / I disagree". */
  @Post(':id/acknowledge-assessment') @RequirePermissions(InsurancePermissions.Enrol)
  acknowledgeAssessment(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(AcknowledgeAssessmentSchema) dto: AcknowledgeAssessmentDto) {
    return this.svc.acknowledgeAssessment(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  // ---- insurer-side (insurance.manage) — API only this batch, no console UI (DEV-24/56) --------------

  @Post(':id/request-documents') @RequirePermissions(InsurancePermissions.Manage)
  requestDocuments(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.requestDocuments(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /** VET-CERT VERIFICATION (DEV-25/KV-BL-057) — advisory-only, livestock (animal) claims only. Flag
   *  `vet_cert_verification` gates whether the external provider is even called (OFF -> honest 'unavailable'
   *  without a network call); NEVER auto-transitions the claim — the insurer still decides via decide(). */
  @Post(':id/verify-vet-cert') @RequirePermissions(InsurancePermissions.Manage)
  verifyVetCert(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(VerifyVetCertSchema) dto: VerifyVetCertDto) {
    return this.svc.verifyVetCert(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  @Post(':id/schedule-survey') @RequirePermissions(InsurancePermissions.Manage)
  scheduleSurvey(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(ScheduleSurveySchema) dto: ScheduleSurveyDto) {
    return this.svc.scheduleSurvey(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  @Post(':id/record-survey') @RequirePermissions(InsurancePermissions.Manage)
  recordSurvey(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(RecordSurveySchema) dto: RecordSurveyDto) {
    return this.svc.recordSurvey(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  @Post(':id/decide') @RequirePermissions(InsurancePermissions.Manage)
  decide(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(DecideClaimSchema) dto: DecideClaimDto) {
    return this.svc.decide(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  /** SETTLE — money-out. Idempotency-Key required (Law 3). */
  @Post(':id/settle') @RequirePermissions(InsurancePermissions.Manage)
  settle(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.settle(ctx.tenantId, this.actor(ctx), key, id).then((data) => ({ data }));
  }

  @Post(':id/close') @RequirePermissions(InsurancePermissions.Manage)
  close(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.close(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
}
