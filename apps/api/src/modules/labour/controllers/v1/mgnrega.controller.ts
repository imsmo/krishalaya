// modules/labour/controllers/v1/mgnrega.controller.ts · PC-54 W54-3 `mgnrega-program` (job-card slice;
// canon W346). Self-service register + self-read; the cross-region LIST is the gov/ops oversight read
// (labour.manage). Work-demand/muster/wage sync remain gated (`mgnrega-works`) — the state ledger side.
import { Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
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
const QueryCardsSchema = z.object({ regionId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

@Controller({ path: 'labour/mgnrega', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class MgnregaController {
  constructor(private readonly svc: MgnregaService) {}

  /** Worker self-registers their job card (idempotent by law — the number is nationally UNIQUE). */
  @Post('job-cards')
  register(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RegisterCardSchema) dto: { jobCardNo: string; regionId?: string }) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.register(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }
  @Get('job-cards/mine')
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.mine(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Get('job-cards') @RequirePermissions(LabourPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCardsSchema) q: { regionId?: string; limit: number }) {
    return this.svc.list(ctx.tenantId, q).then((data) => ({ data }));
  }
}
