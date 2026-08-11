// modules/market-ops/market-ops.controller.ts · W107 (PC-56 ADMIN-SWEEP).
//
// W107's restricted state: "Needs analytics.read; export additionally needs analytics.export." Reading the pulse
// therefore reuses ADMIN-10's grants rather than inventing a fifth analytics permission. **DECIDING on a held price is
// different and gets its own grant**: it is the act that lets a number reach a farmer's selling decision, which is not
// the same authority as reading a chart.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { MarketOpsService } from './services/market-ops.service';
import {
  QueryPulseSchema, QueryPulseDto, QueryQuarantineSchema, QueryQuarantineDto, DecidePriceSchema, DecidePriceDto,
} from './dto/market-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'market', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class MarketOpsController {
  constructor(private readonly svc: MarketOpsService) {}

  @Get('pulse') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  pulse(@ZodQuery(QueryPulseSchema) q: QueryPulseDto) { return this.svc.pulse(q); }

  @Get('quarantine') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  quarantine(@ZodQuery(QueryQuarantineSchema) q: QueryQuarantineDto) { return this.svc.quarantine(q); }

  /** **THE ACT THAT LETS A NUMBER REACH A FARMER.** Not elevated with a hardware key: unlike a payout or a platform
   *  setting this decision is bounded to one observation and is reversible in effect (the price simply stops or starts
   *  being eligible), and a step-up on a queue that must be cleared within the trading day would be a control that gets
   *  worked around. The reason of record and the audit row are the weight it carries. */
  @Post('quarantine/:id/decide')
  @RequireOwnerPermission(OwnerPermissions.MarketPriceReview)
  decide(@Req() req: any, @Param('id') id: string, @ZodBody(DecidePriceSchema) body: DecidePriceDto) {
    return this.svc.decide(admin(req), id, body).then((data) => ({ data }));
  }
}
