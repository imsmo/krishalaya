// apps/admin-api/src/modules/catalogue-depth/catalogue-depth.controller.ts · PC-54 W54-11 admin-api depth,
// slice 1: the taxonomy pieces global-catalogue-ops's own README names as siblings — ATTRIBUTES (definitions
// + options), UNITS, and the CROPS view (the categories subtree under the 'crops' root). Reads are
// CatalogueRead; writes are CatalogueManage + hardware-key + step-up (the same double-lock as every other
// master edit — a bad unit ripples into every tenant's listings).
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { AdminAuthGuard } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { CatalogueDepthService } from './catalogue-depth.service';
import { z } from 'zod';
import { ZodBody } from '../../core/http/zod.pipe';

const CreateUnitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  defaultName: z.string().trim().min(1).max(60),
  unitClass: z.enum(['mass', 'volume', 'count', 'area', 'time', 'length']),
}).strict();

@Controller('catalogue')
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class CatalogueDepthController {
  constructor(private readonly svc: CatalogueDepthService) {}

  @Get('attributes') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  attributes(@Query('q') q?: string, @Query('limit') limit?: string) { return this.svc.attributes(q, Number(limit) || 50).then((data) => ({ data })); }
  @Get('attributes/:id/options') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  options(@Param('id') id: string) { return this.svc.options(id).then((data) => ({ data })); }

  @Get('units') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  units(@Query('activeOnly') activeOnly?: string) { return this.svc.units(activeOnly !== 'false').then((data) => ({ data })); }
  @Post('units') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createUnit(@ZodBody(CreateUnitSchema) dto: z.infer<typeof CreateUnitSchema>) { return this.svc.createUnit(dto).then((data) => ({ data })); }
  @Post('units/:code/active') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setUnitActive(@Param('code') code: string, @Body('isActive') isActive: boolean) { return this.svc.setUnitActive(code, !!isActive).then((data) => ({ data })); }

  /** The CROPS registry view: the categories subtree whose root code is 'crops'. */
  @Get('crops') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  crops() { return this.svc.crops().then((data) => ({ data })); }
}
