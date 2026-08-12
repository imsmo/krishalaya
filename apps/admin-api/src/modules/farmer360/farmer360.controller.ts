// apps/admin-api/src/modules/farmer360/farmer360.controller.ts · W109 + W2161–W2165 (PC-56 ADMIN-SWEEP-b4).
//
// Everything here needs `analytics.farmer360` — W109's restricted state ("the deepest per-person view on the
// platform, so the narrowest grant"), 0120's deliberately deferred permission landing with its route. The export
// additionally needs `analytics.export`, enforced in the SERVICE as a conjunction: the reviewer who may look is
// not automatically the one who may take the file away. Export is step-up gated (it produces a file that leaves).
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { Farmer360Service } from './services/farmer360.service';
import { SearchFarmersSchema, SearchFarmersDto, ExportProfileSchema, ExportProfileDto } from './dto/farmer360.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'analytics/farmer360', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class Farmer360Controller {
  constructor(private readonly svc: Farmer360Service) {}

  @Get('search') @RequireOwnerPermission(OwnerPermissions.AnalyticsFarmer360)
  search(@ZodQuery(SearchFarmersSchema) q: SearchFarmersDto) {
    return this.svc.searchFarmers(q.q, q.limit).then((data) => ({ data }));
  }

  @Get(':userId') @RequireOwnerPermission(OwnerPermissions.AnalyticsFarmer360)
  profile(@Param('userId') userId: string, @Req() req: any) {
    return this.svc.profile(userId, admin(req)).then((data) => ({ data }));
  }

  @Post(':userId/export') @RequireOwnerPermission(OwnerPermissions.AnalyticsFarmer360) @UseGuards(StepUpReauthGuard)
  export(@Param('userId') userId: string, @ZodBody(ExportProfileSchema) dto: ExportProfileDto, @Req() req: any) {
    return this.svc.exportProfile(userId, admin(req), dto).then((data) => ({ data }));
  }
}
