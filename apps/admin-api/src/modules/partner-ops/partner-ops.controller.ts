// apps/admin-api/src/modules/partner-ops/partner-ops.controller.ts · PC-56 PARTNER-1a (founder D2 + D3).
//
// The partner registry on the admin host, at /v1/partners (the admin realm's routes carry no 'admin' prefix). Reads need
// `partners.read`; both writes need `partners.manage` + FIDO2 + step-up. See the service header for why the SLA write
// takes one administrator and why the first-administrator code is handed over rather than sent.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody } from '../../core/http/zod.pipe';
import { PartnerOpsService } from './services/partner-ops.service';
import {
  InvitePartnerAdminSchema, InvitePartnerAdminDto, SetPartnerSlaSchema, SetPartnerSlaDto,
} from './dto/partner-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'partners', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PartnerOpsController {
  constructor(private readonly partners: PartnerOpsService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.PartnersRead)
  list() { return this.partners.list(); }

  @Get(':id') @RequireOwnerPermission(OwnerPermissions.PartnersRead)
  get(@Param('id') id: string) { return this.partners.get(id); }

  @Post(':id/sla')
  @RequireOwnerPermission(OwnerPermissions.PartnersManage)
  @UseGuards(...ELEVATED)
  setSla(@Req() req: any, @Param('id') id: string, @ZodBody(SetPartnerSlaSchema) body: SetPartnerSlaDto) {
    return this.partners.setSla(admin(req), id, body);
  }

  /** The raw code is in this response ONCE and nowhere else. */
  @Post(':id/admin-invite')
  @RequireOwnerPermission(OwnerPermissions.PartnersManage)
  @UseGuards(...ELEVATED)
  adminInvite(@Req() req: any, @Param('id') id: string, @ZodBody(InvitePartnerAdminSchema) body: InvitePartnerAdminDto) {
    return this.partners.inviteFirstAdmin(admin(req), id, body);
  }
}
