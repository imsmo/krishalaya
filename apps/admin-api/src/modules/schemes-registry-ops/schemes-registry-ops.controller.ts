// apps/admin-api/src/modules/schemes-registry-ops/schemes-registry-ops.controller.ts · god-mode government-scheme
// MASTER registry (Law 11). Every route: AdminAuthGuard + OwnerPermissionsGuard. Reads need schemes.registry.read;
// every MUTATION (a master edit ripples into every tenant's scheme catalogue + applications) needs
// schemes.registry.manage + HardwareKeyGuard (FIDO2) + StepUpReauthGuard. validate (zod) → authorize → delegate
// ONLY. Static/sub routes (calendar) are declared before the :id params so Nest matches them first.
import { Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SchemesDepthService } from './depth.service';
import { SchemeCrudService } from './services/scheme-crud.service';
import { EligibilityRulesEditorService } from './services/eligibility-rules-editor.service';
import { WindowCalendarService } from './services/window-calendar.service';
import {
  CreateAuthoritySchema, CreateAuthorityDto, UpdateAuthoritySchema, UpdateAuthorityDto,
  CreateSchemeSchema, CreateSchemeDto, UpdateSchemeMetaSchema, UpdateSchemeMetaDto,
  UpdateSchemeRulesSchema, UpdateSchemeRulesDto, SetWindowSchema, SetWindowDto, SetActiveSchema, SetActiveDto,
  QueryAuthoritiesSchema, QueryAuthoritiesDto, QuerySchemesSchema, QuerySchemesDto,
  QueryCalendarSchema, QueryCalendarDto, QueryChangesSchema, QueryChangesDto,
} from './dto/schemes-registry.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeTsCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const bool = (v?: string) => (v === undefined ? undefined : v === 'true');

@Controller({ path: 'schemes-registry', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SchemesRegistryOpsController {
  constructor(
    private readonly depth: SchemesDepthService,
    private readonly crud: SchemeCrudService,
    private readonly rules: EligibilityRulesEditorService,
    private readonly window: WindowCalendarService,
  ) {}

  /* ======================= authorities ======================= */
  @Get('authorities') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  listAuthorities(@ZodQuery(QueryAuthoritiesSchema) q: QueryAuthoritiesDto) {
    return this.crud.listAuthorities({ level: q.level, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Post('authorities') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createAuthority(@Req() req: any, @ZodBody(CreateAuthoritySchema) dto: CreateAuthorityDto) {
    return this.crud.createAuthority(admin(req), dto).then((data) => ({ data }));
  }
  @Get('authorities/:id') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  getAuthority(@Param('id') id: string) { return this.crud.getAuthority(id).then((data) => ({ data })); }
  @Get('authorities/:id/history') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  authorityHistory(@Param('id') id: string, @ZodQuery(QueryChangesSchema) q: QueryChangesDto) {
    return this.crud.authorityHistory({ entityId: id, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Patch('authorities/:id') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateAuthority(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateAuthoritySchema) dto: UpdateAuthorityDto) {
    return this.crud.updateAuthority(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ======================= schemes ======================= */
  // PC-54 W54-11 slice 2: CROSS-TENANT scheme-applications oversight (read-only; the god-mode view the
  // gov console can't have — gov tokens are tenant-scoped, this realm is not).
  @Get('applications') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  applications(@Query('tenantId') tenantId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.depth.applications({ tenantId, status, limit: Number(limit) || 100 }).then((data) => ({ data }));
  }
  @Get('applications/stats') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  applicationStats() { return this.depth.applicationStats().then((data) => ({ data })); }

  @Get('schemes') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  listSchemes(@ZodQuery(QuerySchemesSchema) q: QuerySchemesDto) {
    return this.crud.listSchemes({ authorityId: q.authorityId, categoryId: q.categoryId, isActive: bool(q.isActive), cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('schemes/calendar') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  calendar(@ZodQuery(QueryCalendarSchema) q: QueryCalendarDto) {
    return this.window.calendar({ onDate: q.onDate, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { onDate: r.onDate, nextCursor: r.nextCursor } }));
  }
  @Post('schemes') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createScheme(@Req() req: any, @ZodBody(CreateSchemeSchema) dto: CreateSchemeDto) {
    return this.crud.createScheme(admin(req), dto).then((data) => ({ data }));
  }
  @Get('schemes/:id') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  getScheme(@Param('id') id: string) { return this.crud.getScheme(id).then((data) => ({ data })); }
  @Get('schemes/:id/history') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  schemeHistory(@Param('id') id: string, @ZodQuery(QueryChangesSchema) q: QueryChangesDto) {
    return this.crud.schemeHistory({ entityId: id, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Patch('schemes/:id') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateMeta(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateSchemeMetaSchema) dto: UpdateSchemeMetaDto) {
    return this.crud.updateMeta(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('schemes/:id/rules') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateRules(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateSchemeRulesSchema) dto: UpdateSchemeRulesDto) {
    return this.rules.updateRules(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('schemes/:id/window') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setWindow(@Req() req: any, @Param('id') id: string, @ZodBody(SetWindowSchema) dto: SetWindowDto) {
    return this.window.setWindow(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('schemes/:id/active') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  setActive(@Req() req: any, @Param('id') id: string, @ZodBody(SetActiveSchema) dto: SetActiveDto) {
    return this.crud.setActive(admin(req), id, dto).then((data) => ({ data }));
  }
}
