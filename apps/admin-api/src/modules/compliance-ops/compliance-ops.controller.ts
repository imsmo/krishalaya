// apps/admin-api/src/modules/compliance-ops/compliance-ops.controller.ts · god-mode DPDP/compliance surface
// (Law 11). Every route: AdminAuthGuard + OwnerPermissionsGuard. MUTATIONS (DSR decisions, export approvals,
// retention config, breach lifecycle) additionally require HardwareKeyGuard (FIDO2) + StepUpReauthGuard.
// validate (zod) → authorize (owner perm) → delegate. No business logic here.
import { Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { DataSubjectRequestsQueueService } from './services/data-subject-requests-queue.service';
import { TenantExportApprovalsService } from './services/tenant-export-approvals.service';
import { AuditLogExplorerService } from './services/audit-log-explorer.service';
import { RetentionPolicyAdminService } from './services/retention-policy-admin.service';
import { BreachResponseConsoleService } from './services/breach-response-console.service';
import {
  QueryDsrSchema, QueryDsrDto, UpdateDsrSchema, UpdateDsrDto,
  QueryExportsSchema, QueryExportsDto, DecideExportSchema, DecideExportDto,
  QueryAuditSchema, QueryAuditDto, UpsertRetentionSchema, UpsertRetentionDto,
  QueryBreachesSchema, QueryBreachesDto, OpenBreachSchema, OpenBreachDto, UpdateBreachSchema, UpdateBreachDto,
  AcknowledgeDsrSchema, AcknowledgeDsrDto, RecordErasureActionSchema, RecordErasureActionDto,
} from './dto/compliance-ops.dto';

/** Indian financial year (1 April). Same reasoning as the scheme-performance report: W041's "SLA breaches YTD" on a
 *  compliance screen must agree with the year a regulator counts in. */
function financialYearStartIso(now = new Date()): string {
  const y = now.getUTCFullYear();
  const apr1 = Date.UTC(y, 3, 1);
  return new Date(now.getTime() >= apr1 ? apr1 : Date.UTC(y - 1, 3, 1)).toISOString();
}

const ksCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const auditCursor = (c?: string) => { if (!c) return undefined; const [ts, id] = Buffer.from(c, 'base64').toString().split('|'); return ts && id ? { ts, id } : undefined; };
const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'compliance', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class ComplianceOpsController {
  constructor(
    private readonly dsr: DataSubjectRequestsQueueService,
    private readonly exports: TenantExportApprovalsService,
    private readonly audit: AuditLogExplorerService,
    private readonly retention: RetentionPolicyAdminService,
    private readonly breaches: BreachResponseConsoleService,
  ) {}

  // ---- DSR queue ----
  // ADMIN-5 RE-GATED THE DSR ROUTES ONTO `compliance.dsr`. They shipped under the generic compliance permissions, so
  // anybody who could edit a retention policy could also open a named farmer's rights request — and adding a
  // permission while leaving the routes behind would have made it decorative (the same correction ADMIN-4b made).
  @Get('dsr') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr)
  listDsr(@ZodQuery(QueryDsrSchema) q: QueryDsrDto) {
    return this.dsr.list({ status: q.status, requestType: q.requestType, cursor: ksCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  /** W041's SLA tiles. Declared BEFORE `dsr/:id` so Nest does not read 'sla' as a request id. */
  @Get('dsr/sla') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr)
  dsrSla() { return this.dsr.slaSummary(financialYearStartIso()).then((data) => ({ data })); }

  @Get('dsr/:id') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr)
  getDsr(@Param('id') id: string) { return this.dsr.get(id).then((data) => ({ data })); }

  @Patch('dsr/:id') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateDsr(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateDsrSchema) dto: UpdateDsrDto) {
    return this.dsr.update(admin(req), id, dto).then((data) => ({ data }));
  }

  /** Stamp the DPDP acknowledgement (the 72-hour clock).
   *
   *  NOT elevated — no hardware key, no step-up. Telling somebody you received their request is not a decision about
   *  their data, and a FIDO2 ceremony in front of it is how the 72 hours get missed. It is audited like everything else,
   *  and it is the only mutation in this module that is not elevated, which is why the reason is written here. */
  @Post('dsr/:id/acknowledge') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr)
  acknowledgeDsr(@Req() req: any, @Param('id') id: string, @ZodBody(AcknowledgeDsrSchema) dto: AcknowledgeDsrDto) {
    return this.dsr.acknowledge(admin(req), id, dto.note ?? null).then((data) => ({ data }));
  }

  /** Record what was ACTUALLY done to one data class — the interim path until an erasure executor exists. Elevated,
   *  because this is the row the completion guard trusts. */
  @Post('dsr/:id/erasure-actions') @RequireOwnerPermission(OwnerPermissions.ComplianceDsr) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  recordErasureAction(@Req() req: any, @Param('id') id: string, @ZodBody(RecordErasureActionSchema) dto: RecordErasureActionDto) {
    return this.dsr.recordErasureAction(admin(req), id, { dataClass: dto.dataClass, action: dto.action, rowsAffected: dto.rowsAffected, note: dto.note ?? null }).then((data) => ({ data }));
  }

  // ---- export approvals ----
  @Get('exports') @RequireOwnerPermission(OwnerPermissions.ComplianceRead)
  listExports(@ZodQuery(QueryExportsSchema) q: QueryExportsDto) {
    return this.exports.list({ approvalStatus: q.approvalStatus, jobKind: q.jobKind, cursor: ksCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Post('exports/:id/decision') @RequireOwnerPermission(OwnerPermissions.ComplianceManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  decideExport(@Req() req: any, @Param('id') id: string, @ZodBody(DecideExportSchema) dto: DecideExportDto) {
    return this.exports.decide(admin(req), id, dto).then((data) => ({ data }));
  }

  // ---- audit-log explorer (read-only) ----
  @Get('audit') @RequireOwnerPermission(OwnerPermissions.ComplianceRead)
  exploreAudit(@ZodQuery(QueryAuditSchema) q: QueryAuditDto) {
    return this.audit.explore({ actorUserId: q.actorUserId, entityType: q.entityType, entityId: q.entityId, action: q.action, tenantId: q.tenantId, from: q.from, to: q.to, cursor: auditCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  // ---- retention policies ----
  @Get('retention') @RequireOwnerPermission(OwnerPermissions.ComplianceRead)
  listRetention() { return this.retention.list().then((r) => ({ data: r.items })); }
  @Post('retention') @RequireOwnerPermission(OwnerPermissions.ComplianceManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  upsertRetention(@Req() req: any, @ZodBody(UpsertRetentionSchema) dto: UpsertRetentionDto) {
    return this.retention.upsert(admin(req), dto).then((data) => ({ data }));
  }

  // ---- breach console ----
  @Get('breaches') @RequireOwnerPermission(OwnerPermissions.ComplianceRead)
  listBreaches(@ZodQuery(QueryBreachesSchema) q: QueryBreachesDto) {
    return this.breaches.list({ status: q.status, cursor: ksCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('breaches/:id') @RequireOwnerPermission(OwnerPermissions.ComplianceRead)
  getBreach(@Param('id') id: string) { return this.breaches.get(id).then((data) => ({ data })); }
  @Post('breaches') @RequireOwnerPermission(OwnerPermissions.ComplianceManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  openBreach(@Req() req: any, @ZodBody(OpenBreachSchema) dto: OpenBreachDto) {
    return this.breaches.open(admin(req), dto).then((data) => ({ data }));
  }
  @Patch('breaches/:id') @RequireOwnerPermission(OwnerPermissions.ComplianceManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateBreach(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateBreachSchema) dto: UpdateBreachDto) {
    return this.breaches.update(admin(req), id, dto).then((data) => ({ data }));
  }
}
