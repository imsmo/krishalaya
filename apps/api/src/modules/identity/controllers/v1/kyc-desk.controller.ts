// modules/identity/controllers/v1/kyc-desk.controller.ts · PC-56 TENANT-9a · THE KYC DESK (W121, W122, W2319–W2325).
//
// Behind the `kyc` flag (FeatureFlagGuard answers OFF with 404 → the console's "Flagged off" state). The verbs are judged
// by the service so a refusal is a sentence on the screen, never a bare 403: the desk reads need `kyc.review` or
// `kyc.manage` (`KYC_DESK_RESTRICTED`), the acts return every refusal by name (`KYC_DESK_REFUSED`). Every write takes the
// Idempotency-Key the review / confirm page minted.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { KycDeskService } from '../../services/kyc-desk.service';
import { DeskActSchema, DeskActDto, DeskQueueSchema, DeskQueueDto, DeskSubmitSchema, DeskSubmitDto } from '../../dto/create-kyc-document.dto';
import { decodeKeyset, UUID_RE } from '../../domain/kyc-cursor';
import { isKycAct } from '../../domain/kyc-acts';

const actorOf = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null });
const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const actOf = (a: string) => { if (!isKycAct(a)) throw new BadRequestError(`'${a}' is not a KYC desk act (verify, reject, request_more, reveal)`); return a; };

@Controller({ path: 'kyc/desk', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('kyc')
export class KycDeskController {
  constructor(private readonly desk: KycDeskService) {}

  /** W121: the organisation's documents (verified computed, the missing types named) + the member desk tiles. */
  @Get()
  overview(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.desk.overview(ctx.tenantId, actorOf(ctx, req)).then((data) => ({ data }));
  }

  /** W121's queue — GET-form filters, keyset on the microsecond instant. */
  @Get('queue')
  queue(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(DeskQueueSchema) q: DeskQueueDto) {
    return this.desk.queue(ctx.tenantId, actorOf(ctx, req), { ...q, cursor: decodeKeyset(q.cursor, UUID_RE) })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  /** The submit form's catalogue: document types per subject, what each evidences, the member's held roles, the reasons. */
  @Get('catalogue')
  catalogue(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Query('userId') userId?: string) {
    const u = userId && UUID_RE.test(userId) ? userId : null;
    return this.desk.catalogue(ctx.tenantId, actorOf(ctx, req), u).then((data) => ({ data }));
  }

  /** W2320: the review the API computes (read-only). */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(DeskSubmitSchema) dto: DeskSubmitDto) {
    return this.desk.previewSubmit(ctx.tenantId, actorOf(ctx, req), dto).then((data) => ({ data }));
  }

  /** W2321: submit (keyed). */
  @Post('documents')
  submit(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DeskSubmitSchema) dto: DeskSubmitDto) {
    return this.desk.submit(ctx.tenantId, actorOf(ctx, req), dto, needKey(key)).then((data) => ({ data }));
  }

  /** W122: the document record — roles, validity, history, the acts as verdicts. */
  @Get('documents/:id')
  record(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.desk.record(ctx.tenantId, actorOf(ctx, req), id).then((data) => ({ data }));
  }

  /** W2323: the verdict at confirm (read-only). */
  @Post('documents/:id/acts/:act/preview')
  previewAct(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @Param('act') act: string, @ZodBody(DeskActSchema) dto: DeskActDto) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.desk.previewAct(ctx.tenantId, actorOf(ctx, req), id, actOf(act), dto).then((data) => ({ data }));
  }

  /** W2324: the act (keyed): verify · reject · request_more · reveal (the reveal answers a 15-minute signed link). */
  @Post('documents/:id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(DeskActSchema) dto: DeskActDto) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.desk.act(ctx.tenantId, actorOf(ctx, req), id, actOf(act), dto, needKey(key)).then((data) => ({ data }));
  }
}
