// modules/identity/controllers/v1/kyc.controller.ts · KYC submission (self) + review (admin).
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { BadRequestError, NotFoundError } from '../../../../shared/errors/app-error';
import { KycDocumentService } from '../../services/kyc-document.service';
import { z } from 'zod';
import { decodeKeyset, UUID_RE } from '../../domain/kyc-cursor';
import { KYC_REVIEW } from '../../services/kyc-desk.service';

// PC-54 W54-1: reviewer-queue query (status defaults to the actionable box) + keyset cursor codec.
const ReviewQueueSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'expired']).default('pending'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
type ReviewQueueDto = z.infer<typeof ReviewQueueSchema>;
// [PC-56 TENANT-9a] F-7: the cursor carries the MICROSECOND instant the database printed; a malformed one is page one.
const decodeReviewCursor = (c?: string) => decodeKeyset(c, UUID_RE);
import { EkycService } from '../../services/ekyc.service';
import { BusinessKycService } from '../../services/business-kyc.service';
import { SubmitKycSchema, SubmitKycDto, ReviewKycSchema, ReviewKycDto } from '../../dto/create-kyc-document.dto';
import { StartEkycSchema, StartEkycDto, VerifyEkycSchema, VerifyEkycDto } from '../../dto/ekyc.dto';
import { SubmitBusinessKycSchema, SubmitBusinessKycDto, ReviewBusinessKycSchema, ReviewBusinessKycDto } from '../../dto/submit-business-kyc.dto';
import { IdentityPermissions } from '../../policies/identity.policies';

// [PC-56 TENANT-9a] F-17 (spoofable ip): the LEFTMOST X-Forwarded-For is whatever the client typed; `req.ip` is what the
// trusted proxy chain resolved. A KYC decision's audit row records the latter.
const ipOf = (req: Request) => req.ip || null;
const actorOf = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, permissions: ctx.permissions, ip: ipOf(req), requestId: ctx.requestId || null });

@Controller({ path: 'kyc', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('kyc')
export class KycController {
  constructor(private readonly kyc: KycDocumentService, private readonly ekyc: EkycService, private readonly business: BusinessKycService, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService) {}

  // --- eKYC (Aadhaar/PAN provider verification). Static paths declared BEFORE the bare @Get()/`:id`. ---
  // The RAW id is accepted in the body, validated, sent to the provider, then discarded — only masked + ref persist.
  @Post('ekyc/start')
  async ekycStart(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(StartEkycSchema) dto: StartEkycDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.idem.remember(key, ctx.userId, 'identity.ekyc.start', () => this.ekyc.start(ctx.tenantId, ctx.userId, dto));
    return { data };
  }

  @Post('ekyc/verify')
  async ekycVerify(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(VerifyEkycSchema) dto: VerifyEkycDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.idem.remember(key, ctx.userId, 'identity.ekyc.verify', () => this.ekyc.verify(ctx.tenantId, ctx.userId, dto));
    return { data };
  }

  @Get('ekyc/sessions')
  ekycSessions(@CurrentContext() ctx: RequestContext) {
    return this.ekyc.list(ctx.tenantId, ctx.userId, { limit: 20 }).then((data) => ({ data }));
  }

  // --- Business KYC (buyer): GST/PAN + business-type + proof docs (P0-5). Raw GSTIN/PAN accepted ONCE,
  // masked before storage; only the caller's OWN profile is read/written (no id param → no IDOR). Static paths. ---
  @Post('business')
  submitBusiness(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(SubmitBusinessKycSchema) dto: SubmitBusinessKycDto) {
    return this.business.submit(ctx.tenantId, ctx.userId, dto, ipOf(req)).then((data) => ({ data }));
  }

  @Get('business')
  businessStatus(@CurrentContext() ctx: RequestContext) {
    return this.business.status(ctx.tenantId, ctx.userId).then((data) => ({ data }));
  }

  @Post('business/:id/review')
  @RequirePermissions(IdentityPermissions.Approve)
  reviewBusiness(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(ReviewBusinessKycSchema) dto: ReviewBusinessKycDto) {
    return this.business.review(ctx.tenantId, ctx.userId, id, dto, ipOf(req)).then((data) => ({ data }));
  }

  /** A member's OWN document. [PC-56 TENANT-9a] Reviewed by the desk's builder (roles it evidences, validity, duplicate,
   *  evidence); a refusal is `KYC_DESK_REFUSED` with every code. The service holds the Idempotency-Key. */
  @Post()
  async submit(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(SubmitKycSchema) dto: SubmitKycDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return { data: await this.kyc.submit(ctx.tenantId, actorOf(ctx, req), dto, key) };
  }

  // --- PC-54 W54-1 `kyc-review-read-models` (Ledger Appendix 6): the reviewer's QUEUE + CASE reads.
  // Evidence-before-decision: kyc/:id/review existed but every read was self-scoped — a blind approve is
  // forbidden. Approve-gated; static 'review/...' paths declared BEFORE the bare @Get().
  @Get('review/queue')
  @RequirePermissions(KYC_REVIEW)
  reviewQueue(@CurrentContext() ctx: RequestContext, @ZodQuery(ReviewQueueSchema) q: ReviewQueueDto) {
    return this.kyc.reviewQueue(ctx.tenantId, { status: q.status, cursor: decodeReviewCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('review/:id')
  @RequirePermissions(KYC_REVIEW)
  async reviewCase(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const data = await this.kyc.reviewCase(ctx.tenantId, id);
    if (!data) throw new NotFoundError('kyc document not found');
    return { data };
  }

  // PC-54 W54-14 `store-licence-reminders`: my expiring documents (self-read; static path before bare @Get()).
  @Get('expiring')
  expiring(@CurrentContext() ctx: RequestContext, @Query('days') days?: string) {
    return this.kyc.listExpiring(ctx.tenantId, ctx.userId, Number(days) || 90).then((data) => ({ data }));
  }

  // Static path declared BEFORE the bare @Get() so the catalogue route is unambiguous. Self-read of a
  // seeded vocabulary (no PII, no subject ids) — inherits AuthGuard + the 'kyc' flag from the controller.
  @Get('doc-types')
  docTypes(@CurrentContext() ctx: RequestContext) {
    return this.kyc.listDocTypes(ctx.tenantId).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('status') status?: string) {
    return this.kyc.list(ctx.tenantId, ctx.userId, status).then((data) => ({ data }));
  }

  /** The legacy review route, now ON THE DESK'S RULES (PC-56 TENANT-9a): `kyc.review`, an Idempotency-Key, maker ≠
   *  checker, evidence before decision, a coded reason. The desk's own route is `POST kyc/desk/documents/:id/acts/:act`. */
  @Post(':id/review')
  @RequirePermissions(KYC_REVIEW)
  async review(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReviewKycSchema) dto: ReviewKycDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return { data: await this.kyc.review(ctx.tenantId, actorOf(ctx, req), id, dto, key) };
  }
}
