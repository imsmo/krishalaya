// modules/identity/controllers/v1/team.controller.ts · PC-56 TENANT-SW-c · W183 `/settings/team` + W184 `/settings/team/[id]`.
//
// "Team restricted — only tenant_admin manages staff": every route needs `user.approve` (tenant_admin). The service says so by name
// (`TEAM_RESTRICTED`) as well. Inviting is behind the `staff_invites` flag (OFF = 404); the admin-add exception is not.
// The remove act stays where it was — `DELETE /v1/rbac/assignments/:id`, now with a REQUIRED reason.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { IdentityPermissions } from '../../policies/identity.policies';
import { TeamService } from '../../services/team.service';
import { ConflictService } from '../../services/conflict.service';
import {
  AddStaffDirectlySchema, AddStaffDirectlyDto, DeclareConflictSchema, DeclareConflictDto, InviteStaffSchema, InviteStaffDto, InvitesQuerySchema, InvitesQueryDto,
  TeamQuerySchema, TeamQueryDto,
} from '../../dto/verification-team.dto';
import { ReasonOnlySchema, ReasonOnlyDto } from '../../dto/create-user-tenant-role.dto';

const actorOf = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null });
const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };

@Controller({ path: 'team', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@RequirePermissions(IdentityPermissions.Approve)
export class TeamController {
  constructor(private readonly team: TeamService, private readonly conflicts: ConflictService) {}

  /** W183: seats · staff (µs keyset) · maker-checker pairs (derived) · pending invites · privileged-override proposals. */
  @Get()
  overview(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(TeamQuerySchema) q: TeamQueryDto) {
    return this.team.overview(ctx.tenantId, actorOf(ctx, req), { cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((data) => ({ data }));
  }

  @Get('invites')
  invites(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(InvitesQuerySchema) q: InvitesQueryDto) {
    return this.team.invites(ctx.tenantId, actorOf(ctx, req), { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  /** W2335–W2337 "Invite staff": the token is in THIS response once; the SMS leaves through the outbox. */
  @Post('invites') @FeatureFlag('staff_invites')
  invite(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(InviteStaffSchema) dto: InviteStaffDto) {
    return this.team.invite(ctx.tenantId, actorOf(ctx, req), dto, needKey(key)).then((data) => ({ data }));
  }

  @Post('invites/:id/revoke')
  revokeInvite(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(ReasonOnlySchema) dto: ReasonOnlyDto) {
    return this.team.revokeInvite(ctx.tenantId, actorOf(ctx, req), idOf(id), dto.reason).then((data) => ({ data }));
  }

  /** "Add staff directly" — the exception act (no invite), with a reason. */
  @Post('staff')
  addDirectly(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(AddStaffDirectlySchema) dto: AddStaffDirectlyDto) {
    return this.team.addDirectly(ctx.tenantId, actorOf(ctx, req), dto, needKey(key)).then((data) => ({ data }));
  }

  /** W184: one staff member. */
  @Get('staff/:userId')
  staff(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('userId') userId: string) {
    return this.team.staff(ctx.tenantId, actorOf(ctx, req), idOf(userId)).then((data) => ({ data }));
  }

  @Get('staff/:userId/conflicts')
  conflictsOf(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('userId') userId: string) {
    return this.conflicts.ofStaff(ctx.tenantId, actorOf(ctx, req), idOf(userId)).then((data) => ({ data }));
  }

  /** A tenant_admin records a conflict FOR a staff member (declared_via 'admin'). */
  @Post('staff/:userId/conflicts')
  declareFor(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('userId') userId: string, @ZodBody(DeclareConflictSchema) dto: DeclareConflictDto) {
    return this.conflicts.declare(ctx.tenantId, actorOf(ctx, req), idOf(userId), dto, needKey(key)).then((data) => ({ data }));
  }

  /** Lift a declaration (a tenant_admin who is not the declared person), with a reason. */
  @Post('conflicts/:id/lift')
  lift(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(ReasonOnlySchema) dto: ReasonOnlyDto) {
    return this.conflicts.lift(ctx.tenantId, actorOf(ctx, req), idOf(id), dto.reason).then((data) => ({ data }));
  }

  @Get('members')
  members(@CurrentContext() ctx: RequestContext, @Query('q') q?: string) {
    return this.conflicts.members(ctx.tenantId, String(q ?? '')).then((data) => ({ data }));
  }
}
