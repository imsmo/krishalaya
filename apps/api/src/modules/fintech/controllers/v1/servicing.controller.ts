// modules/fintech/controllers/v1/servicing.controller.ts · PC-54 W54-8 `fintech-servicing` (loan.manage).
import { Controller, Get, Param, Post, Query, UseGuards, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { FintechPermissions } from '../../policies/fintech.policies';
import { ServicingService } from '../../services/servicing.service';
import { LoanDisbursementService } from '../../services/loan-disbursement.service';
import { LoanDisbursementExecuteHandler } from '../../jobs/loan-disbursement-execute.handler';
import { z } from 'zod';

const minorStr = z.string().regex(/^\d{1,15}$/);
const KccEntrySchema = z.object({
  entryKind: z.enum(['drawl', 'repayment', 'interest']),
  amountMinor: minorStr,
  narrative: z.string().trim().min(3).max(300),
  destinationKind: z.enum(['supplier_direct', 'other']).optional(),
  repaymentChannel: z.string().max(30).optional(),
}).strict();
const RestructureSchema = z.object({
  caseRef: z.string().max(60).optional(),
  reasonCode: z.enum(['weather_distress', 'other']),
  evidenceMediaId: z.string().uuid().optional(),
  oldInstalmentMinor: minorStr, newInstalmentMinor: minorStr,
  oldTenorMonths: z.number().int().min(1).max(360), newTenorMonths: z.number().int().min(1).max(360),
  rateAprBps: z.number().int().min(0).max(100000),
  holidayMonths: z.number().int().min(0).max(24).optional(),
  holidayStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  penalInterestWaived: z.boolean().optional(),
  totalInterestDeltaMinor: minorStr,
}).strict();
const TransitionSchema = z.object({ to: z.enum(['mediation', 'accepted', 'checker_approved', 'activated', 'rejected', 'expired']) }).strict();
// PC-55 A9 · a disbursement run REQUIRES a second human (maker != checker).
const DisbursementRunSchema = z.object({
  confirmedBy: z.string().uuid(),
  applicationIds: z.array(z.string().uuid()).min(1).max(2000).optional(),   // omit ⇒ every eligible approved loan
}).strict();
const WriteOffSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

@Controller({ path: 'fintech/servicing', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions(FintechPermissions.Manage)
export class ServicingController {
  constructor(private readonly svc: ServicingService, private readonly disbursements: LoanDisbursementService, private readonly executor: LoanDisbursementExecuteHandler) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: true }; } // class-level guard already requires loan.manage

  @Get('dpd')
  dpd(@CurrentContext() ctx: RequestContext) { return this.svc.dpd(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('collections')
  collections(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.svc.collections(ctx.tenantId, this.actor(ctx), Number(limit) || 100).then((data) => ({ data }));
  }
  @Post('loans/:id/kcc/entries')
  kccEntry(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(KccEntrySchema) dto: z.infer<typeof KccEntrySchema>) {
    return this.svc.kccEntry(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get('loans/:id/kcc/ledger')
  kccLedger(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.kccLedger(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post('loans/:id/restructures')
  propose(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(RestructureSchema) dto: z.infer<typeof RestructureSchema>) {
    return this.svc.proposeRestructure(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get('loans/:id/restructures')
  restructures(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.listRestructures(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post('restructures/:id/transition')
  transition(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(TransitionSchema) dto: { to: string }) {
    return this.svc.transitionRestructure(ctx.tenantId, this.actor(ctx), id, dto.to).then((data) => ({ data }));
  }
  // --- PC-55 A9 `loan-disbursement-batches`: approved credit → QUEUED payouts. Cooling-off is sacred:
  // an application inside its window is HELD BACK and reported with the instant it becomes eligible. ---
  @Get('disbursement-preview')
  disbursementPreview(@CurrentContext() ctx: RequestContext) {
    return this.disbursements.preview(ctx.tenantId, this.actor(ctx)).then((data) => ({ data }));
  }
  @Post('disbursement-batches')
  createDisbursementRun(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DisbursementRunSchema) dto: z.infer<typeof DisbursementRunSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.disbursements.run(ctx.tenantId, this.actor(ctx), key, dto, r.ip || null).then((data) => ({ data }));
  }
  @Get('disbursement-batches')
  disbursementRuns(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.disbursements.runs(ctx.tenantId, this.actor(ctx), Number(limit) || 50).then((data) => ({ data }));
  }
  @Get('disbursement-batches/:id')
  disbursementRun(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.disbursements.getRun(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
  /** Execute is deliberately honest: without live payout credentials it refuses and explains, so no borrower
   *  is ever marked as having received money that did not move. */
  @Post('disbursement-batches/:id/execute')
  executeDisbursementRun(@Param('id') id: string) {
    return this.executor.execute(id).then((data) => ({ data }));
  }

  @Post('loans/:id/write-off')
  writeOff(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(WriteOffSchema) dto: { reason: string }) {
    return this.svc.writeOff(ctx.tenantId, this.actor(ctx), id, dto.reason).then((data) => ({ data }));
  }
}
