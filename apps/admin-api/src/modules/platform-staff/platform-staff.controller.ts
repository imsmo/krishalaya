// apps/admin-api/src/modules/platform-staff/platform-staff.controller.ts · the realm's own operators (PC-56 ADMIN-9).
//
// Law 11 + Law 5. Every route: AdminAuthGuard + OwnerPermissionsGuard. Three things are worth reading closely:
//
//   1. `GET me` AND `POST me/sessions/:sid/revoke` CARRY NO PERMISSION AT ALL. Reading your own security page and
//      signing yourself out are not privileged acts, and gating them would mean an operator whose permissions have just
//      been restricted cannot see that this is what happened — or worse, cannot sign out a device they have lost.
//   2. SUSPENSION NEEDS `staff.manage`; REINSTATEMENT NEEDS `staff.reinstate` — a different grant held by a different
//      role, so the two-person rule is enforced by the permission model and not only by a comparison of two ids.
//   3. THE ROLE MATRIX IS READ-ONLY AND THERE IS NO WRITE ROUTE. Not "not yet": granting a platform permission is a
//      deploy, and a route that pretended otherwise would write to a table nothing reads.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { PlatformStaffService } from './services/platform-staff.service';
import { RoleCatalogueService } from './services/role-catalogue.service';
import {
  QueryOperatorsSchema, QueryOperatorsDto, SuspendOperatorSchema, SuspendOperatorDto,
  RequestReinstateSchema, RequestReinstateDto, RestrictSchema, RestrictDto,
  LiftRestrictionSchema, LiftRestrictionDto, RevokeSessionSchema, RevokeSessionDto,
  SetAccessPolicySchema, SetAccessPolicyDto, QueryMatrixSchema, QueryMatrixDto,
} from './dto/platform-staff.dto';

const admin = (req: any): AdminRequestContext => req.admin;
/** Removing somebody's access to the god-mode realm is at least as consequential as approving a payout, so it carries
 *  the same elevation: hardware key plus a fresh step-up. */
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'staff', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PlatformStaffController {
  constructor(
    private readonly staff: PlatformStaffService,
    private readonly roles: RoleCatalogueService,
  ) {}

  /* ---------------- W438 / W439 · my own account (no permission required) ---------------- */

  @Get('me')
  me(@Req() req: any) {
    return this.staff.me(admin(req)).then((data) => ({ data }));
  }

  /** Sign yourself out of one session — including the one you are holding, which W439 renders with a "this device"
   *  badge and a Revoke control beside it. A console that excluded the current session would leave the one credential
   *  an attacker is actually using. */
  @Post('me/sessions/:sid/revoke')
  revokeOwnSession(@Req() req: any, @Param('sid') sid: string, @ZodBody(RevokeSessionSchema) body: RevokeSessionDto) {
    const a = admin(req);
    return this.staff.revokeSession(a, a.userId, sid, body).then((data) => ({ data }));
  }

  /* ---------------- W105 · the role matrix (read) ---------------- */

  @Get('roles')
  @RequireOwnerPermission(OwnerPermissions.RbacRead)
  matrix(@ZodQuery(QueryMatrixSchema) q: QueryMatrixDto) {
    return this.roles.matrix(q);
  }

  @Get('roles/permissions/:code')
  @RequireOwnerPermission(OwnerPermissions.RbacRead)
  holders(@Param('code') code: string) {
    return { data: this.roles.holders(code) };
  }

  /* ---------------- W104 · the roster ---------------- */

  @Get('operators')
  @RequireOwnerPermission(OwnerPermissions.StaffRead)
  operators(@ZodQuery(QueryOperatorsSchema) q: QueryOperatorsDto) {
    return this.staff.roster(q);
  }

  @Get('operators/:id')
  @RequireOwnerPermission(OwnerPermissions.StaffRead)
  operator(@Param('id') id: string) {
    return this.staff.operator(id).then((data) => ({ data }));
  }

  /* ---------------- the access controls ---------------- */

  @Post('operators/:id/suspend')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  @UseGuards(...ELEVATED)
  suspend(@Req() req: any, @Param('id') id: string, @ZodBody(SuspendOperatorSchema) body: SuspendOperatorDto) {
    return this.staff.suspend(admin(req), id, body).then((data) => ({ data }));
  }

  /** The maker's half. `staff.manage` — the same desk that suspends may ask for a reversal. */
  @Post('operators/:id/reinstate-request')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  requestReinstate(@Req() req: any, @Param('id') id: string, @ZodBody(RequestReinstateSchema) body: RequestReinstateDto) {
    return this.staff.requestReinstate(admin(req), id, body).then((data) => ({ data }));
  }

  /** The checker's half — a DIFFERENT permission, held by `platform_staff_checker` and not by `platform_staff_ops`.
   *  FOURTEENTH maker-checker site, and the only one that gates the restrictive control's reversal rather than the
   *  permissive act itself. */
  @Post('operators/:id/reinstate')
  @RequireOwnerPermission(OwnerPermissions.StaffReinstate)
  @UseGuards(...ELEVATED)
  reinstate(@Req() req: any, @Param('id') id: string) {
    return this.staff.reinstate(admin(req), id).then((data) => ({ data }));
  }

  @Post('operators/:id/restrictions')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  @UseGuards(...ELEVATED)
  restrict(@Req() req: any, @Param('id') id: string, @ZodBody(RestrictSchema) body: RestrictDto) {
    return this.staff.restrict(admin(req), id, body).then((data) => ({ data }));
  }

  @Post('operators/:id/restrictions/:rid/lift')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  @UseGuards(...ELEVATED)
  lift(@Req() req: any, @Param('id') id: string, @Param('rid') rid: string,
    @ZodBody(LiftRestrictionSchema) body: LiftRestrictionDto) {
    return this.staff.liftRestriction(admin(req), id, rid, body).then((data) => ({ data }));
  }

  /** Ending somebody ELSE's session. Same elevation as a suspension — it is the narrow version of the same act. */
  @Post('operators/:id/sessions/:sid/revoke')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  @UseGuards(...ELEVATED)
  revokeSession(@Req() req: any, @Param('id') id: string, @Param('sid') sid: string,
    @ZodBody(RevokeSessionSchema) body: RevokeSessionDto) {
    return this.staff.revokeSession(admin(req), id, sid, body).then((data) => ({ data }));
  }

  /** The two numbers that decide when the realm locks somebody out. Elevated, audited, reasoned. */
  @Post('access-policy')
  @RequireOwnerPermission(OwnerPermissions.StaffManage)
  @UseGuards(...ELEVATED)
  setPolicy(@Req() req: any, @ZodBody(SetAccessPolicySchema) body: SetAccessPolicyDto) {
    return this.staff.setPolicy(admin(req), body).then((data) => ({ data }));
  }
}
