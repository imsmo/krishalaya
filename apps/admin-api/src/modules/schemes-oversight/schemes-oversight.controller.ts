// apps/admin-api/src/modules/schemes-oversight/schemes-oversight.controller.ts · the cross-tenant scheme OVERSIGHT
// plane (W074 / W076 / W078). Law 11 god-mode reads over tenant data.
//
// THE PERMISSIONS ARE THE POINT OF THIS MODULE EXISTING SEPARATELY FROM schemes-registry-ops:
//   `schemes.applications.read` — applications, INCLUDING applicant PII (W074's restricted state names it)
//   `schemes.dbt.read`          — DBT credit observations (W076's restricted state names it)
//   `schemes.registry.read`     — the PERFORMANCE report, which is aggregate-only and names nobody (W078 says
//                                 "Needs schemes.read; per-farmer drill needs applications permission" — so the
//                                 report is the lower bar and the drill-in is not on this route)
// A single "schemes oversight" permission would have made the drill-in and the dashboard the same grant, which is
// exactly the collapse W078's own restricted state warns against.
//
// EVERY ROUTE IS A READ. There is one POST — the export — and it is a POST because it MUTATES THE AUDIT LEDGER, and
// one PII disclosure, which is a POST because it writes an audit row. Nothing here changes an application's state:
// moving a farmer's application is the tenant's act, in apps/api, with the tenant's own permissions.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { ApplicationOversightService } from './services/application-oversight.service';
import { DbtMonitorService } from './services/dbt-monitor.service';
import { SchemePerformanceService } from './services/scheme-performance.service';
import { OversightExportService } from './services/oversight-export.service';
import {
  QueryApplicationsSchema, QueryApplicationsDto, QueryCountsSchema, QueryCountsDto,
  UnmaskApplicantSchema, UnmaskApplicantDto, QueryDbtSchema, QueryDbtDto,
  QueryBouncesSchema, QueryBouncesDto, OversightExportSchema, OversightExportDto,
} from './dto/schemes-oversight.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'schemes-oversight', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SchemesOversightController {
  constructor(
    private readonly applications: ApplicationOversightService,
    private readonly dbt: DbtMonitorService,
    private readonly performance: SchemePerformanceService,
    private readonly exports: OversightExportService,
  ) {}

  /* ======================= W074 · applications ======================= */

  @Get('applications/counts') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  counts(@ZodQuery(QueryCountsSchema) q: QueryCountsDto) {
    return this.applications.counts(q).then((data) => ({ data }));
  }
  @Get('applications') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  listApplications(@ZodQuery(QueryApplicationsSchema) q: QueryApplicationsDto) {
    return this.applications.list({ ...q, cursor: decodeCursor(q.cursor) }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('applications/:id') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  getApplication(@Param('id') id: string) {
    return this.applications.get(id).then((data) => ({ data }));
  }
  /** The ONLY route that returns a real name and phone. POST because it writes an audit row, and the reason is
   *  mandatory with a real floor — this row is the only record of why a farmer's number was read. */
  @Post('applications/:id/unmask') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  unmask(@Req() req: any, @Param('id') id: string, @ZodBody(UnmaskApplicantSchema) dto: UnmaskApplicantDto) {
    return this.applications.unmaskApplicant(admin(req), id, dto.reason).then((data) => ({ data }));
  }

  /* ======================= W076 · DBT / PFMS ======================= */

  @Get('dbt') @RequireOwnerPermission(OwnerPermissions.SchemesDbtRead)
  dbtMonitor(@ZodQuery(QueryDbtSchema) q: QueryDbtDto) {
    return this.dbt.monitor({ days: q.days }).then((data) => ({ data }));
  }
  @Get('dbt/credits') @RequireOwnerPermission(OwnerPermissions.SchemesDbtRead)
  dbtCredits(@ZodQuery(QueryDbtSchema) q: QueryDbtDto) {
    return this.dbt.recent({ days: q.days, schemeId: q.schemeId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { windowDays: r.windowDays, notificationStateAvailable: r.notificationStateAvailable, nextCursor: r.nextCursor } }));
  }
  @Get('dbt/bounces') @RequireOwnerPermission(OwnerPermissions.SchemesDbtRead)
  dbtBounces(@ZodQuery(QueryBouncesSchema) q: QueryBouncesDto) {
    return this.dbt.bounces(q).then((r) => ({ data: r.items, meta: { windowDays: r.windowDays } }));
  }

  /* ======================= W078 · performance ======================= */

  /** Aggregate-only and names nobody, so the REGISTRY read permission is the right bar — W078's own restricted state
   *  says "Needs schemes.read; per-farmer drill needs applications permission". */
  @Get('performance') @RequireOwnerPermission(OwnerPermissions.SchemesRegistryRead)
  performanceReport() {
    return this.performance.report().then((data) => ({ data }));
  }

  /* ======================= exports (W2131 / W2132) ======================= */

  /** One route, but the permission depends on the report, so the gate is the STRICTER of the two and the service
   *  narrows from there. Guarding this with the registry permission and letting the report choose the data would have
   *  been the same mistake ADMIN-4 re-gated away from. */
  @Post('exports') @RequireOwnerPermission(OwnerPermissions.SchemesApplicationsRead)
  exportOversight(@Req() req: any, @ZodBody(OversightExportSchema) dto: OversightExportDto) {
    return this.exports.export(admin(req), dto).then((data) => ({ data }));
  }
}
