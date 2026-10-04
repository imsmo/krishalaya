// modules/identity/controllers/v1/roles.controller.ts · RBAC: catalogue + assignments + overrides.
import { Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { RoleService } from '../../services/role.service';
import { PermissionService } from '../../services/permission.service';
import { UserTenantRoleService } from '../../services/user-tenant-role.service';
import { QueryRoleSchema, QueryRoleDto } from '../../dto/query-role.dto';
import { QueryUserTenantRoleSchema, QueryUserTenantRoleDto } from '../../dto/query-user-tenant-role.dto';
import { AssignRoleSchema, AssignRoleDto, StaffOverrideSchema, StaffOverrideDto, RevokeAssignmentSchema, RevokeAssignmentDto, RevokeOverrideSchema, RevokeOverrideDto, ReasonOnlySchema, ReasonOnlyDto } from '../../dto/create-user-tenant-role.dto';
import { IdentityPermissions } from '../../policies/identity.policies';

const ipOf = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;

@Controller({ path: 'rbac', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly roles: RoleService,
    private readonly perms: PermissionService,
    private readonly utr: UserTenantRoleService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  @Get('roles')
  listRoles(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRoleSchema) q: QueryRoleDto) {
    return this.roles.list(ctx.tenantId, q).then((data) => ({ data }));
  }
  @Get('permissions')
  listPerms(@CurrentContext() ctx: RequestContext, @Query('moduleCode') moduleCode?: string) {
    return this.perms.list(ctx.tenantId, moduleCode).then((data) => ({ data }));
  }

  @Get('assignments')
  @RequirePermissions(IdentityPermissions.Report)
  listAssignments(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryUserTenantRoleSchema) q: QueryUserTenantRoleDto) {
    return this.utr.list(ctx.tenantId, { userId: q.userId, roleCode: q.roleCode, pendingOnly: q.pendingOnly }).then((data) => ({ data }));
  }

  @Post('assignments')
  @RequirePermissions(IdentityPermissions.Approve)
  async assign(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(AssignRoleSchema) dto: AssignRoleDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.idem.remember(key, ctx.userId, 'identity.role.assign', () => this.utr.assign(ctx.tenantId, ctx.userId, dto, ipOf(req)));
    return { data };
  }

  @Post('assignments/:id/approve')
  @RequirePermissions(IdentityPermissions.Approve)
  approve(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string) {
    return this.utr.approve(ctx.tenantId, ctx.userId, id, ipOf(req)).then((data) => ({ data }));
  }

  /** W184 "Remove from team" (F-15): the reason is REQUIRED (≥ 10) — revokes the role, its overrides, the desk seats and this tenant's
   *  sessions (PC-56 TENANT-SW-c). The last tenant_admin and yourself are refused by name. */
  @Delete('assignments/:id')
  @RequirePermissions(IdentityPermissions.Approve)
  revoke(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(RevokeAssignmentSchema) dto: RevokeAssignmentDto) {
    return this.utr.revoke(ctx.tenantId, ctx.userId, id, dto.reason, req.ip || null).then((data) => ({ data }));
  }

  /** Per-staff override WITH a reason (F-15) and an optional expiry; a money / PII GRANT becomes a proposal a second admin confirms. */
  @Post('overrides')
  @RequirePermissions(IdentityPermissions.Approve)
  override(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(StaffOverrideSchema) dto: StaffOverrideDto) {
    return this.utr.setStaffOverride(ctx.tenantId, ctx.userId, ctx.permissions, dto, req.ip || null).then((data) => ({ data }));
  }

  @Post('overrides/revoke')
  @RequirePermissions(IdentityPermissions.Approve)
  revokeOverride(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(RevokeOverrideSchema) dto: RevokeOverrideDto) {
    return this.utr.revokeOverride(ctx.tenantId, ctx.userId, dto, req.ip || null).then((data) => ({ data }));
  }

  @Get('overrides/proposals')
  @RequirePermissions(IdentityPermissions.Approve)
  proposals(@CurrentContext() ctx: RequestContext, @Query('status') status?: string) {
    const st = status && ['proposed', 'confirmed', 'refused', 'expired'].includes(status) ? status : undefined;
    return this.utr.overrideProposals(ctx.tenantId, { status: st, limit: 50 }).then((data) => ({ data }));
  }

  @Post('overrides/proposals/:id/confirm')
  @RequirePermissions(IdentityPermissions.Approve)
  confirmProposal(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string) {
    return this.utr.confirmOverrideProposal(ctx.tenantId, ctx.userId, id, req.ip || null).then((data) => ({ data }));
  }

  @Post('overrides/proposals/:id/refuse')
  @RequirePermissions(IdentityPermissions.Approve)
  refuseProposal(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(ReasonOnlySchema) dto: ReasonOnlyDto) {
    return this.utr.refuseOverrideProposal(ctx.tenantId, ctx.userId, id, dto.reason, req.ip || null).then((data) => ({ data }));
  }
}
