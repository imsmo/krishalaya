// modules/payments/controllers/v1/settlement-cycles.controller.ts · W147/W148 (PC-56 TENANT-4c).
// Every route needs `settlement.close` — 0144 seeds the permission W147 names twice and no file seeded —
// and the CHECKER must be a different person than the requester, which the service and 0144's CHECK both
// enforce. There is deliberately NO route that closes a cycle in one call.
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { SettlementCycleService } from '../../services/settlement-cycle.service';
import { OrgStatementService } from '../../services/org-statement.service';
import { SettlementConsoleReadModel } from '../../read-models/settlement-console.read-model';
import { DecideCycleCloseSchema, DecideCycleCloseDto } from '../../dto/settlement-cycle.dto';

const PERM = 'settlement.close';
const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => {
  if (!c) return undefined;
  const [iso, id] = Buffer.from(c, 'base64').toString().split('|');
  return iso && id && !Number.isNaN(Date.parse(iso)) ? { c: iso, id } : undefined;
};

@Controller({ path: 'settlements', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class SettlementCyclesController {
  constructor(
    private readonly cycles: SettlementCycleService,
    private readonly console: SettlementConsoleReadModel,
    private readonly orgStatement: OrgStatementService,
  ) {}

  /** W147 whole: the live cycle with its progress, the per-seller table, the basis for the deduction
   *  columns, and how many of this tenant's statements are still daily ones. */
  @Get() @RequirePermissions(PERM)
  async overview(@CurrentContext() ctx: RequestContext) {
    const cycle = await this.cycles.ensureLive(ctx.tenantId, ctx.userId);
    return { data: await this.console.overview(ctx.tenantId, cycle) };
  }

  /** Step one of W147's "Close current cycle". A request, not a close. */
  @Post(':id/close-request') @RequirePermissions(PERM)
  requestClose(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request) {
    return this.cycles.requestClose(ctx.tenantId, ctx.userId, id, ipOf(req)).then((data) => ({ data }));
  }

  /** Step two: a different holder of the same key approves or rejects with a reason. */
  @Post(':id/close-decision') @RequirePermissions(PERM)
  decide(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(DecideCycleCloseSchema) dto: DecideCycleCloseDto, @Req() req: Request) {
    return this.cycles.decideClose(ctx.tenantId, ctx.userId, id, dto, ipOf(req)).then((data) => ({ data }));
  }

  /** ONE bounded, resumable generation pass. The console calls it so an operator can watch the count climb;
   *  the same method is what a worker would call. Deliberately not "generate everything" — see the service. */
  @Post(':id/generate') @RequirePermissions(PERM)
  generate(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request) {
    return this.cycles.generatePass(ctx.tenantId, ctx.userId, id, ipOf(req)).then((data) => ({ data }));
  }

  /** W148's list: every statement this tenant has issued, keyset, each row saying whether its period is a
   *  cycle or one of the pre-wave daily ones. */
  @Get('statements') @RequirePermissions(PERM)
  statements(@CurrentContext() ctx: RequestContext, @Query('cycleId') cycleId?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.console.statements(ctx.tenantId, { cycleId: cycleId || undefined, cursor: decodeCursor(cursor), limit: lim }).then((data) => ({ data }));
  }

  /** W148's "Download org statement — June": DERIVED from the tenant's own ledger, with a receipt, and
   *  refused by name for a month that has not ended or a statement that does not reconcile. */
  @Get('org-statement') @RequirePermissions(PERM)
  orgStatementFor(@CurrentContext() ctx: RequestContext, @Query('period') period: string) {
    return this.orgStatement.forMonth(ctx.tenantId, ctx.userId, period).then((data) => ({ data }));
  }
}
