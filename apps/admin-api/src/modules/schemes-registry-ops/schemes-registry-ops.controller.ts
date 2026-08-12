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
import { SchemeVersionService } from './services/scheme-version.service';
import { AuthorityPortalService } from './services/authority-portal.service';
import { SchemeExportService } from './services/scheme-export.service';
import { PortalSyncService } from './services/portal-sync.service';
import {
  CreateAuthoritySchema, CreateAuthorityDto, UpdateAuthoritySchema, UpdateAuthorityDto,
  CreateSchemeSchema, CreateSchemeDto, UpdateSchemeMetaSchema, UpdateSchemeMetaDto,
  UpdateSchemeRulesSchema, UpdateSchemeRulesDto, DryRunRulesSchema, DryRunRulesDto, SetWindowSchema, SetWindowDto, SetActiveSchema, SetActiveDto,
  QueryAuthoritiesSchema, QueryAuthoritiesDto, QuerySchemesSchema, QuerySchemesDto,
  QueryCalendarSchema, QueryCalendarDto, QueryChangesSchema, QueryChangesDto,
  SaveDraftSchema, SaveDraftDto, PublishVersionSchema, PublishVersionDto,
  DiscardDraftSchema, DiscardDraftDto, QueryVersionsSchema, QueryVersionsDto,
  MapPortalSchema, MapPortalDto, UnmapPortalSchema, UnmapPortalDto,
  SchemeExportSchema, SchemeExportDto,
} from './dto/schemes-registry.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeTsCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const bool = (v?: string) => (v === undefined ? undefined : v === 'true');

@Controller({ path: 'schemes-registry', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SchemesRegistryOpsController {
  constructor(
    private readonly portalSyncSvc: PortalSyncService,
    private readonly depth: SchemesDepthService,
    private readonly crud: SchemeCrudService,
    private readonly rules: EligibilityRulesEditorService,
    private readonly window: WindowCalendarService,
    private readonly versions: SchemeVersionService,
    private readonly portals: AuthorityPortalService,
    private readonly exports: SchemeExportService,
  ) {}

  /* ======================= authorities ======================= */
  /* ============ ADMIN-SWEEP-c1 · W077: the portal sync registry — a read that cannot lie ============
     Rides on `schemes.registry.read`, DELIBERATELY not a new `schemes.sync` grant: nothing writes sync state yet
     (no pull worker, no portal client exists), and a permission with no route behind it is a promise nothing
     keeps (0120's rule). The day a pull worker lands, its trigger route brings the grant with it. */
  @Get('portal-sync') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  portalSync() {
    return this.portalSyncSvc.registry().then((data) => ({ data }));
  }

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
  /* DELTA-018 — which government portal an authority files through. A mapping, never a claim of a working sync. */
  @Post('authorities/:id/portal') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  mapPortal(@Req() req: any, @Param('id') id: string, @ZodBody(MapPortalSchema) dto: MapPortalDto) {
    return this.portals.mapPortal(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('authorities/:id/portal/unmap') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  unmapPortal(@Req() req: any, @Param('id') id: string, @ZodBody(UnmapPortalSchema) dto: UnmapPortalDto) {
    return this.portals.unmapPortal(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ======================= schemes ======================= */
  // PC-54 W54-11 slice 2: CROSS-TENANT scheme-applications oversight (read-only; the god-mode view the
  // gov console can't have — gov tokens are tenant-scoped, this realm is not).
  //
  // ADMIN-4b RE-GATED THESE TWO ONTO `schemes.applications.read`. They shipped under the REGISTRY read permission,
  // which meant a scheme-catalogue editor could already enumerate every application on the platform — and adding a
  // new permission while leaving these two behind would have made the new permission decorative. Nothing here
  // returns PII (the SELECT never joined `users`), but the row set itself is cross-tenant application data, and the
  // boundary belongs at the row set rather than at the columns: the next person to add a name to this query would
  // find it already gated.
  @Get('applications') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  applications(@Query('tenantId') tenantId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.depth.applications({ tenantId, status, limit: Number(limit) || 100 }).then((data) => ({ data }));
  }
  @Get('applications/stats') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  applicationStats() { return this.depth.applicationStats().then((data) => ({ data })); }

  /* W2251/W2252 — the receipt law's fifth surface. POST because it MUTATES the audit ledger: no receipt, no file.
     Declared ahead of `schemes/:id` so Nest does not read 'exports' as a scheme id. */
  @Post('exports') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  exportRegistry(@Req() req: any, @ZodBody(SchemeExportSchema) dto: SchemeExportDto) {
    return this.exports.export(admin(req), dto).then((data) => ({ data }));
  }

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

  /* ======================= the version plane (0105) =======================
     READS are ordinary registry reads. WRITES: drafting and publishing are both `schemes.registry.manage` +
     FIDO2 + step-up, and the maker-checker split is enforced by identity (assertPublishable + a CHECK constraint),
     not by a second permission — a separate 'publish' permission would be handed to the same person. */

  /** Version history + what it cannot tell you (`coverage.unrecordedBelow`). */
  @Get('schemes/:id/versions') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  listVersions(@Param('id') id: string, @ZodQuery(QueryVersionsSchema) q: QueryVersionsDto) {
    return this.versions.listVersions(id, q.limit).then((r) => ({ data: r.items, meta: { coverage: r.coverage, liveVersion: r.liveVersion } }));
  }
  /** One version with its diff against the version below — the W2254 review step. */
  @Get('schemes/:id/versions/:versionId') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  getVersion(@Param('versionId') versionId: string) {
    return this.versions.getVersion(versionId).then((data) => ({ data }));
  }
  /** MAKER — opens a draft, or edits the open one. Publishes nothing. */
  /* ADMIN-SWEEP-c2 · W071: the cohort dry run. Manage-gated (it is the author's loop) but NOT step-up/FIDO2
     gated, deliberately: it is a pure computation that saves nothing — over-gating a harmless control trains
     people to click through elevation prompts (the macro precedent), and the response carries savedNothing:true
     so no caller can mistake a test for a change. */
  @Post('schemes/:id/versions/dry-run') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage)
  dryRun(@Param('id') id: string, @ZodBody(DryRunRulesSchema) dto: DryRunRulesDto) {
    return this.rules.dryRun(id, dto.eligibilityRules).then((data) => ({ data }));
  }

  @Post('schemes/:id/versions') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  saveDraft(@Req() req: any, @Param('id') id: string, @ZodBody(SaveDraftSchema) dto: SaveDraftDto) {
    const { reason, ...patch } = dto;
    return this.versions.saveDraft(admin(req), id, patch, reason).then((data) => ({ data }));
  }
  /** CHECKER — a DIFFERENT operator makes the draft live and the scheme row is reprojected onto it. */
  @Post('schemes/:id/versions/publish') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  publishVersion(@Req() req: any, @Param('id') id: string, @ZodBody(PublishVersionSchema) dto: PublishVersionDto) {
    return this.versions.publish(admin(req), id, dto.versionId, dto.checkerNote).then((data) => ({ data }));
  }
  /** Discard — not checker-gated: nothing a farmer can see has changed, and the maker is the likeliest to know. */
  @Post('schemes/:id/versions/discard') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  discardDraft(@Req() req: any, @Param('id') id: string, @ZodBody(DiscardDraftSchema) dto: DiscardDraftDto) {
    return this.versions.discardDraft(admin(req), id, dto.versionId, dto.reason).then((data) => ({ data }));
  }
}
