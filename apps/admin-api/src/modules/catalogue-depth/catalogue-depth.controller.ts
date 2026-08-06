// apps/admin-api/src/modules/catalogue-depth/catalogue-depth.controller.ts · the EAV DEFINITION plane
// (PC-54 W54-11 slice 1, deepened by PC-56 ADMIN-3 — canon W020's bindings tab, W024, W025, W026, W027).
//
// Reads are CatalogueRead; writes are CatalogueManage + hardware key + step-up — the same double lock every other master
// edit carries, for the reason the original header already gave: a bad unit ripples into every tenant's listings.
//
// WHAT ADMIN-3 CHANGED HERE, AND IT IS A BREAKING CHANGE ON PURPOSE. The two unit writes that existed took no `reason`
// and wrote no audit row. They now require a reason, like every other mutation in this domain and like every mutation in
// the sibling `global-catalogue-ops` module has always required. Safe to change without a deprecation window because
// nothing consumed them: the survey grepped every app and package for these paths and found zero callers — the module
// had no UI at all, which is precisely how the audit gap survived this long.
//
// ON THE MISSING `version: '1'`: it is not missing in effect. main.ts sets `defaultVersion: '1'` with URI versioning, so
// `@Controller('catalogue')` already serves `/v1/catalogue/...`, the same prefix global-catalogue-ops declares
// explicitly. Left as-is rather than "fixed", because changing it would alter nothing and imply it had been broken.
import { Controller, Delete, Get, Param, Post, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { CatalogueDepthService } from './catalogue-depth.service';
import { EavAdminService } from './services/eav-admin.service';
import { CropLensService } from './services/crop-lens.service';
import {
  QueryAttributesSchema, QueryAttributesDto,
  CreateAttributeSchema, CreateAttributeDto, UpdateAttributeSchema, UpdateAttributeDto,
  SetActiveSchema, SetActiveDto,
  CreateOptionSchema, CreateOptionDto, UpdateOptionSchema, UpdateOptionDto,
  CreateBindingSchema, CreateBindingDto, UpdateBindingSchema, UpdateBindingDto, UnbindSchema, UnbindDto,
  CreateUnitSchema, CreateUnitDto, UpsertConversionSchema, UpsertConversionDto,
  QueryCropsSchema, QueryCropsDto, CreateCalendarSchema, CreateCalendarDto,
  UpdateCalendarSchema, UpdateCalendarDto, UpsertMappingSchema, UpsertMappingDto,
  RemoveMappingSchema, RemoveMappingDto,
} from './dto/catalogue-depth.dto';

/** The admin actor, as every other controller in this realm extracts it. */
const admin = (req: any): AdminRequestContext => req.admin as AdminRequestContext;

@Controller('catalogue')
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class CatalogueDepthController {
  constructor(
    private readonly svc: CatalogueDepthService,
    private readonly eav: EavAdminService,
    private readonly crops_: CropLensService,
  ) {}

  // -------------------------------------------------------------------------
  // ATTRIBUTE DEFINITIONS (W026 list, W027 editor)
  // -------------------------------------------------------------------------
  @Get('attributes') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  attributes(@ZodQuery(QueryAttributesSchema) q: QueryAttributesDto) {
    return this.eav.attributes(q).then((data) => ({ data }));
  }

  @Get('attributes/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  attribute(@Param('id') id: string) { return this.eav.attribute(id).then((data) => ({ data })); }

  @Post('attributes') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createAttribute(@Req() req: any, @ZodBody(CreateAttributeSchema) dto: CreateAttributeDto) {
    return this.eav.createAttribute(admin(req), dto).then((data) => ({ data }));
  }

  /** PATCH, not PUT: `code` is immutable and a PUT would imply the whole definition is replaceable. A change that
   *  re-interprets stored data is refused unless the body carries `acknowledgeConsequences` — the service returns the
   *  consequences in its 409 so the operator reads what the change does before confirming it. */
  @Patch('attributes/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateAttribute(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateAttributeSchema) dto: UpdateAttributeDto) {
    return this.eav.updateAttribute(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('attributes/:id/active') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setAttributeActive(@Req() req: any, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.eav.setAttributeActive(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // ATTRIBUTE OPTIONS (W024)
  // -------------------------------------------------------------------------
  /** `categoryId` narrows to a branch's own options PLUS the global ones — what a farmer actually sees on the form. */
  @Get('attributes/:id/options') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  options(@Param('id') id: string, @Query('categoryId') categoryId?: string) {
    return this.eav.options(id, categoryId).then((data) => ({ data }));
  }

  @Post('attributes/:id/options') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createOption(@Req() req: any, @Param('id') id: string, @ZodBody(CreateOptionSchema) dto: CreateOptionDto) {
    return this.eav.createOption(admin(req), id, dto).then((data) => ({ data }));
  }

  @Patch('options/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateOption(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateOptionSchema) dto: UpdateOptionDto) {
    return this.eav.updateOption(admin(req), id, dto).then((data) => ({ data }));
  }

  /** Deactivate, never delete. An option a farmer has already chosen must stay readable on their listing. */
  @Post('options/:id/active') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setOptionActive(@Req() req: any, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.eav.setOptionActive(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // CATEGORY→ATTRIBUTE BINDINGS (W020's Attributes tab) — no surface existed for these at all
  // -------------------------------------------------------------------------
  @Get('categories/:id/bindings') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  bindings(@Param('id') id: string) { return this.eav.bindings(id).then((data) => ({ data })); }

  @Post('categories/:id/bindings') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  bind(@Req() req: any, @Param('id') id: string, @ZodBody(CreateBindingSchema) dto: CreateBindingDto) {
    return this.eav.bind(admin(req), id, dto).then((data) => ({ data }));
  }

  @Patch('bindings/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateBinding(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateBindingSchema) dto: UpdateBindingDto) {
    return this.eav.updateBinding(admin(req), id, dto).then((data) => ({ data }));
  }

  /** DELETE, and a SOFT one. The verb is honest about the operator's intent; the storage keeps the row because the
   *  binding explains how listings were validated while it existed. */
  @Delete('bindings/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  unbind(@Req() req: any, @Param('id') id: string, @ZodBody(UnbindSchema) dto: UnbindDto) {
    return this.eav.unbind(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // UNITS + CONVERSIONS (W025)
  // -------------------------------------------------------------------------
  @Get('units') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  units(@Query('activeOnly') activeOnly?: string, @Query('unitClass') unitClass?: string) {
    // default FALSE, unlike the old handler's `activeOnly !== 'false'`: a registry screen that hides inactive units by
    // default makes a deactivated unit look deleted, and somebody then creates a duplicate of it
    return this.eav.units({ activeOnly: activeOnly === 'true', unitClass }).then((data) => ({ data }));
  }

  @Get('units/:code/history') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  unitHistory(@Param('code') code: string) { return this.eav.unitHistory(code).then((data) => ({ data })); }

  @Post('units') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createUnit(@Req() req: any, @ZodBody(CreateUnitSchema) dto: CreateUnitDto) {
    return this.eav.createUnit(admin(req), dto).then((data) => ({ data }));
  }

  @Post('units/:code/active') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setUnitActive(@Req() req: any, @Param('code') code: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.eav.setUnitActive(admin(req), code, dto).then((data) => ({ data }));
  }

  /** The conversion FACTOR — the most consequential number in this domain. Upsert rather than POST+PATCH because
   *  (from, to) is the natural key and an operator setting `quintal→kg` does not care whether a row already existed. */
  @Post('unit-conversions') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  upsertConversion(@Req() req: any, @ZodBody(UpsertConversionSchema) dto: UpsertConversionDto) {
    return this.eav.upsertConversion(admin(req), dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // THE CROPS LENS (W023) — unchanged, read-only, and honest about what it is
  // -------------------------------------------------------------------------
  /**
   * There is no crops table: crops ARE the `crops.*` category branch, so this is a LENS. DELTA-008 is closed without a
   * new table — seasons are DERIVED from each crop's sourced calendars, and the mandi mapping lives in
   * `external_entity_refs` keyed to a PRODUCT because `mandi_prices.product_id` is what prices key on.
   */
  @Get('crops') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  crops(@ZodQuery(QueryCropsSchema) q: QueryCropsDto) { return this.crops_.crops(q).then((data) => ({ data })); }

  /** The rollup's drill-in: this crop's products and which carry a commodity code. */
  @Get('crops/:id/mappings') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  cropMappings(@Param('id') id: string) { return this.crops_.cropMappings(id).then((data) => ({ data })); }

  // -------------------------------------------------------------------------
  // CROP CALENDARS (W110) — editorial agronomy, and the source rule is the point
  // -------------------------------------------------------------------------
  @Get('crop-calendars') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  calendars(@Query('categoryId') categoryId?: string, @Query('season') season?: string) {
    return this.crops_.calendars({ categoryId, season }).then((data) => ({ data }));
  }

  @Get('crop-calendars/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  calendar(@Param('id') id: string) { return this.crops_.calendar(id).then((data) => ({ data })); }

  /** ELEVATED. This is advice a farmer plants by: a wrong sowing window is discovered at harvest. */
  @Post('crop-calendars') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createCalendar(@Req() req: any, @ZodBody(CreateCalendarSchema) dto: CreateCalendarDto) {
    return this.crops_.createCalendar(admin(req), dto).then((data) => ({ data }));
  }

  /** A whole-object replace, not a patch: a stage timeline is only coherent as a set. */
  @Post('crop-calendars/:id') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateCalendar(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateCalendarSchema) dto: UpdateCalendarDto) {
    return this.crops_.updateCalendar(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('crop-calendars/:id/active') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setCalendarActive(@Req() req: any, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.crops_.setCalendarActive(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // THE MANDI MAPPING (DELTA-008's other half) — product ↔ Agmarknet commodity code
  // -------------------------------------------------------------------------
  @Post('mandi-mappings') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  upsertMapping(@Req() req: any, @ZodBody(UpsertMappingSchema) dto: UpsertMappingDto) {
    return this.crops_.upsertMapping(admin(req), dto).then((data) => ({ data }));
  }

  @Delete('mandi-mappings/:productId') @RequireOwnerPermission(OwnerPermissions.CatalogueManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  removeMapping(@Req() req: any, @Param('productId') productId: string, @ZodBody(RemoveMappingSchema) dto: RemoveMappingDto) {
    return this.crops_.removeMapping(admin(req), productId, dto).then((data) => ({ data }));
  }
}
