// modules/fintech/controllers/v1/servicing.controller.ts · PC-54 W54-8 `fintech-servicing` (loan.manage).
import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { FintechPermissions } from '../../policies/fintech.policies';
import { ServicingService } from '../../services/servicing.service';
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
const WriteOffSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

@Controller({ path: 'fintech/servicing', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions(FintechPermissions.Manage)
export class ServicingController {
  constructor(private readonly svc: ServicingService) {}
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
  @Post('loans/:id/write-off')
  writeOff(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(WriteOffSchema) dto: { reason: string }) {
    return this.svc.writeOff(ctx.tenantId, this.actor(ctx), id, dto.reason).then((data) => ({ data }));
  }
}
