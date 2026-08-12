// modules/payments/controllers/v1/settlement-statements.controller.ts
// A seller reads THEIR settlement statements; finance (payout.approve) generates a statement for a
// seller+cycle. Generation is idempotent (per seller+period). Reads are owner-scoped (404 to others).
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { SettlementStatementService } from '../../services/settlement-statement.service';
import { GenerateStatementSchema, GenerateStatementDto } from '../../dto/create-settlement-statement.dto';
import { canModeratePayment } from '../../policies/payments.policies';

const ipOf = (req: Request) => req.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'settlement-statements', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class SettlementStatementsController {
  constructor(private readonly statements: SettlementStatementService) {}

  // finance generates a seller's statement for a cycle (payout.approve permission)
  @Post('generate') @RequirePermissions('payout.approve')
  generate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(GenerateStatementSchema) dto: GenerateStatementDto) {
    return this.statements.generate(ctx.tenantId, dto.sellerUserId, dto.from, dto.to, ctx.userId, ipOf(r)).then((data) => ({ data }));
  }

  // a seller lists their own statements
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.statements.listForSeller(ctx.tenantId, ctx.userId, { cursor: decodeCursor(cursor), limit: lim }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.statements.getById(ctx.tenantId, { userId: ctx.userId, canModerate: canModeratePayment(ctx) }, id).then((data) => ({ data }));
  }
}
