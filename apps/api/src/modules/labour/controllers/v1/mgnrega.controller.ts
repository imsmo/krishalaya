// modules/labour/controllers/v1/mgnrega.controller.ts · PC-54 W54-3 `mgnrega-program` (job-card slice;
// canon W346). Self-service register + self-read; the cross-region LIST is the gov/ops oversight read
// (labour.manage). Work-demand/muster/wage sync remain gated (`mgnrega-works`) — the state ledger side.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { LabourPermissions } from '../../policies/labour.policies';
import { MgnregaService } from '../../services/mgnrega.service';
import { z } from 'zod';

const RegisterCardSchema = z.object({
  jobCardNo: z.string().trim().min(4).max(30),
  regionId: z.string().uuid().optional(),
}).strict();
const CreateWorkSchema = z.object({
  workCode: z.string().trim().min(2).max(60),
  workName: z.string().trim().min(2).max(250),
  workCategory: z.string().trim().max(40).optional(),
  regionId: z.string().uuid().optional(),
  siteNote: z.string().trim().max(2000).optional(),
  sanctionedDays: z.number().int().min(0).max(1000000).optional(),
  sanctionedAmountMinor: z.string().regex(/^\d{1,15}$/).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
const UpdateWorkSchema = z.object({
  workName: z.string().trim().min(2).max(250).optional(),
  siteNote: z.string().trim().max(2000).optional(),
  sanctionedDays: z.number().int().min(0).max(1000000).optional(),
  status: z.enum(['planned', 'active', 'completed', 'suspended']).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'at least one field' });
const RecordMusterSchema = z.object({
  workId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  musterNo: z.string().trim().max(60).optional(),
  attendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attended: z.boolean().optional(),
  dayFraction: z.number().min(0.25).max(1).optional(),          // half-days are real on MGNREGA sites
  wageMinor: z.string().regex(/^\d{1,15}$/).optional(),         // BANK-SIDE informational only
}).strict();
const QueryWorksSchema = z.object({
  status: z.enum(['planned', 'active', 'completed', 'suspended']).optional(),
  regionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
const QueryCardsSchema = z.object({ regionId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();


// ===== PC-55 B2 · work demands + the audit-stamped export =====
const RecordDemandSchema = z.object({
  jobCardId: z.string().uuid(),
  demandedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),        // the date the HOUSEHOLD asked — starts the clock
  daysRequested: z.number().int().min(1).max(100),
  applicants: z.number().int().min(1).max(20).optional(),
  regionId: z.string().uuid().optional(),
  note: z.string().trim().max(2000).optional(),
}).strict();
const TransitionDemandSchema = z.object({
  to: z.enum(['allotted', 'withdrawn', 'closed']),
  workId: z.string().uuid().optional(),
  allottedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(2000).optional(),
}).strict();
const QueryDemandsSchema = z.object({
  status: z.enum(['demanded', 'allotted', 'withdrawn', 'closed']).optional(),
  regionId: z.string().uuid().optional(),
  jobCardId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();
const ExportSchema = z.object({
  report: z.enum(['job_cards', 'works', 'demands']),
  status: z.string().trim().max(20).optional(),
  regionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
}).strict();

@Controller({ path: 'labour/mgnrega', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class MgnregaController {
  constructor(private readonly svc: MgnregaService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: ctx.permissions.has('booking.manage') || ctx.permissions.has('*') }; }

  /** Worker self-registers their job card (idempotent by law — the number is nationally UNIQUE). */
  @Post('job-cards')
  register(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RegisterCardSchema) dto: { jobCardNo: string; regionId?: string }) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.register(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }
  @Get('job-cards/mine')
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.mine(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  // ===== PC-55 A4 · works, musters and the 100-day ledger =====
  @Post('works') @RequirePermissions(LabourPermissions.Manage)
  createWork(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateWorkSchema) dto: z.infer<typeof CreateWorkSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.createWork(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get('works') @RequirePermissions(LabourPermissions.Manage)
  works(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryWorksSchema) q: z.infer<typeof QueryWorksSchema>) {
    return this.svc.works(ctx.tenantId, this.actor(ctx), q).then((data) => ({ data }));
  }
  @Patch('works/:id') @RequirePermissions(LabourPermissions.Manage)
  updateWork(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateWorkSchema) dto: z.infer<typeof UpdateWorkSchema>) {
    return this.svc.updateWork(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Post('musters') @RequirePermissions(LabourPermissions.Manage)
  recordMuster(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RecordMusterSchema) dto: z.infer<typeof RecordMusterSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.recordMuster(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }

  // ===== PC-55 B2 · WORK DEMANDS (MGNREGA §3 — the 15-day clock) + the audit-stamped export =====
  // Static 'demands'/'exports'/'summary' paths are declared BEFORE any parameterised route so they stay unambiguous.
  @Post('demands') @RequirePermissions(LabourPermissions.Manage)
  recordDemand(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RecordDemandSchema) dto: z.infer<typeof RecordDemandSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.recordDemand(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get('demands') @RequirePermissions(LabourPermissions.Manage)
  demands(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDemandsSchema) q: z.infer<typeof QueryDemandsSchema>) {
    return this.svc.demands(ctx.tenantId, this.actor(ctx), q).then((data) => ({ data }));
  }
  @Patch('demands/:id') @RequirePermissions(LabourPermissions.Manage)
  transitionDemand(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(TransitionDemandSchema) dto: z.infer<typeof TransitionDemandSchema>) {
    return this.svc.transitionDemand(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  /** Programme counters for the GW-5 dashboard — computed over the whole register, with the state ledger's own
   *  availability so the console can say "sync pending" instead of implying the numbers are the state's. */
  @Get('summary') @RequirePermissions(LabourPermissions.Manage)
  summary(@CurrentContext() ctx: RequestContext) {
    return this.svc.programSummary(ctx.tenantId, this.actor(ctx)).then((data) => ({ data }));
  }

  /** An export is a READ THAT LEAVES A TRAIL: rows + an audit receipt written in the same breath (Appendix 5 law). */
  @Post('exports') @RequirePermissions(LabourPermissions.Manage)
  export(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(ExportSchema) dto: z.infer<typeof ExportSchema>) {
    const ip = (req.ip || null) as string | null;
    return this.svc.export(ctx.tenantId, this.actor(ctx), ip, dto).then((data) => ({ data }));
  }

  /** The worker's own 100-day ledger (self-read; no Manage needed for one's own card). */
  @Get('job-cards/:id/ledger')
  cardLedger(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.cardLedger(ctx.tenantId, this.actor(ctx), id, { self: false }).then((data) => ({ data }));
  }

  @Get('job-cards') @RequirePermissions(LabourPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCardsSchema) q: { regionId?: string; limit: number }) {
    return this.svc.list(ctx.tenantId, q).then((data) => ({ data }));
  }
}
