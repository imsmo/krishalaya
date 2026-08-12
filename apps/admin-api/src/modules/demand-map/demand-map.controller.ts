// apps/admin-api/src/modules/demand-map/demand-map.controller.ts · W108 + W2136–W2140 (PC-56 ADMIN-SWEEP-c3).
//
// RIDES `analytics.read` — W108's own restricted state names that permission, it exists in the catalog, and it is
// granted (platform_analytics_ops, platform_analytics_viewer, platform_market_ops, platform_farmer360): nothing
// new to leave ungrantable. NO `analytics.demand` permission is minted (0120's rule held from the other side — a
// grant is only cut when a surface needs a NARROWER door, and district aggregates are the widest analytics read).
//
// TWO ROUTES, AND THE SECOND IS THE ONLY WRITE-SHAPED THING HERE — the export, which writes a receipt. The canon's
// W2138–W2140 "Retry" mutate chain is deliberately ABSENT, not disabled: there is no build to retry (the read
// recomputes per request), so a rebuild route would queue an act nobody performs (ADMIN-10-Q1, third refusal).
// Export is step-up gated (it produces a file that leaves) and the service enforces the analytics.export
// conjunction — looking is not taking away.
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { DemandMapService } from './services/demand-map.service';
import { DemandWeekSchema, DemandWeekDto, ExportDemandSchema, ExportDemandDto } from './dto/demand-map.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'analytics/demand-map', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class DemandMapController {
  constructor(private readonly svc: DemandMapService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.AnalyticsRead)
  page(@ZodQuery(DemandWeekSchema) q: DemandWeekDto) {
    return this.svc.page(q.week).then((data) => ({ data }));
  }

  @Post('export') @RequireOwnerPermission(OwnerPermissions.AnalyticsRead) @UseGuards(StepUpReauthGuard)
  export(@ZodBody(ExportDemandSchema) dto: ExportDemandDto, @Req() req: any) {
    return this.svc.exportCells(admin(req), dto).then((data) => ({ data }));
  }
}
