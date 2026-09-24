// modules/education/controllers/v1/instructor-earnings.controller.ts · PC-56 TENANT-7d-money · THE EARNINGS (W418).
// `education` flag on the class (the module); the SCREEN's flag (`instructor_earnings`) is read in the service so W418's
// *"Flagged off"* is a sentence with a code (`EARNINGS_DISABLED`), not the guard's bare 404 (6e-1's ruling). Auth on
// everything; who may read whose money is judged by the service (the instructor their own; the finance desk any).
// Every write takes an Idempotency-Key (Law 3). Money is minor-unit strings on the wire (Law 2).
//
//   GET    /education/earnings                          W418 — the caller's desk (`?instructor=` for the finance desk)
//   GET    /education/earnings/statement                the keyset statement of lines
//   POST   /education/earnings/payouts/review           the confirm step's verdict (writes nothing)
//   POST   /education/earnings/payouts                  the payout request — purpose course_royalty on the EXISTING plane
//   POST   /education/earnings/export                   W418's export → the tenant export plane (dataset education.instructor_earnings)
//   GET    /education/earnings/rule                     the tenant's split rule in force, the platform default, the history
//   POST   /education/earnings/rule                     the finance desk proposes
//   POST   /education/earnings/rule/:id/decide          a different finance person approves | rejects (note)
//   POST   /education/earnings/agreements               the desk offers an instructor an agreement
//   POST   /education/earnings/agreements/:id/:act      accept | decline (the instructor) · supersede (the desk)
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ExportPlaneService } from '../../../../core/exports-plane/export-plane.service';
import { EarningsActor, InstructorEarningsService } from '../../services/instructor-earnings.service';
import { INSTRUCTOR_EARNINGS_DATASET } from '../../exports/instructor-earnings.dataset';
import { canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import {
  AgreementActSchema, DecideRuleDto, DecideRuleSchema, EarningsExportParams, EarningsExportParamsSchema, OfferAgreementDto, OfferAgreementSchema, ProposeRuleDto, ProposeRuleSchema,
  QueryEarningsDto, QueryEarningsSchema, QueryStatementDto, QueryStatementSchema, RoyaltyPayoutDto, RoyaltyPayoutSchema,
} from '../../dto/instructor-earnings.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [at, id] = Buffer.from(c, 'base64').toString().split('|'); return at && id ? { c: at, id } : undefined; };
const ipOf = (r: Request) => r.ip || null;
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };
/** W418: *"Only you and the tenant finance desk"* — the finance verbs the payments module already names. */
const canFinance = (ctx: RequestContext) => ctx.permissions.has('payout.approve') || ctx.permissions.has('wallet.adjust') || ctx.permissions.has('*');

@Controller({ path: 'education/earnings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class InstructorEarningsController {
  constructor(private readonly svc: InstructorEarningsService, private readonly exportsPlane: ExportPlaneService) {}
  private actor(ctx: RequestContext): EarningsActor { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx), canFinance: canFinance(ctx) }; }

  @Get()
  view(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryEarningsSchema) q: QueryEarningsDto) { return this.svc.view(ctx.tenantId, this.actor(ctx), q.instructor ?? null).then((data) => ({ data })); }

  @Get('statement')
  statement(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryStatementSchema) q: QueryStatementDto) {
    return this.svc.statement(ctx.tenantId, this.actor(ctx), { instructorId: q.instructor ?? null, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Post('payouts/review')
  payoutReview(@CurrentContext() ctx: RequestContext, @ZodBody(RoyaltyPayoutSchema) dto: RoyaltyPayoutDto) { return this.svc.payoutReview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }

  @Post('payouts')
  requestPayout(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @ZodBody(RoyaltyPayoutSchema) dto: RoyaltyPayoutDto) {
    return this.svc.requestPayout(ctx.tenantId, this.actor(ctx), needKey(key), dto).then((data) => ({ data }));
  }

  /** W418's export → W2553: a job on the tenant export plane, gated as the page is (the producer reads the screen's flag). */
  @Post('export')
  enqueueExport(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(EarningsExportParamsSchema) body: EarningsExportParams) {
    return this.exportsPlane.enqueue(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions }, needKey(key), { datasetCode: INSTRUCTOR_EARNINGS_DATASET, params: body }, ipOf(req)).then((data) => ({ data }));
  }

  @Get('rule')
  rule(@CurrentContext() ctx: RequestContext) { return this.svc.ruleView(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Post('rule')
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(ProposeRuleSchema) dto: ProposeRuleDto) {
    return this.svc.proposeRule(ctx.tenantId, this.actor(ctx), needKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('rule/:id/decide')
  decide(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(DecideRuleSchema) dto: DecideRuleDto) {
    return this.svc.decideRule(ctx.tenantId, this.actor(ctx), needKey(key), id, dto.act, dto.note ?? null, ipOf(r)).then((data) => ({ data }));
  }

  @Post('agreements')
  offer(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(OfferAgreementSchema) dto: OfferAgreementDto) {
    return this.svc.offerAgreement(ctx.tenantId, this.actor(ctx), needKey(key), dto.instructorId, { instructorShareBps: dto.instructorShareBps ?? null, termsNote: dto.termsNote ?? null }, ipOf(r)).then((data) => ({ data }));
  }
  @Post('agreements/:id/:act')
  actAgreement(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @Param('act') act: string) {
    const parsed = AgreementActSchema.safeParse(act);
    if (!parsed.success) throw new BadRequestError(`unknown agreement act '${act}'`);
    return this.svc.actAgreement(ctx.tenantId, this.actor(ctx), needKey(key), id, parsed.data, ipOf(r)).then((data) => ({ data }));
  }
}
