// modules/platform-api-ops/platform-api-ops.controller.ts · W106 / W007 (PC-56 ADMIN-11c).
//
// W106 names both grants by hand — "Needs platform.api.read; revoking needs platform.api.manage + reason" — and
// `grep -rn "platform.api" apps packages` returned nothing, so its restricted state could not happen and one grant
// would have covered reading a tenant's integration list and switching it off.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { PlatformApiOpsService } from './services/platform-api-ops.service';
import {
  QueryKeysSchema, QueryKeysDto, RevokeKeySchema, RevokeKeyDto,
  QueryInboundSchema, QueryInboundDto, QueryCircuitHistorySchema, QueryCircuitHistoryDto,
} from './dto/platform-api-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'platform-api', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PlatformApiOpsController {
  constructor(private readonly svc: PlatformApiOpsService) {}

  @Get('keys') @RequireOwnerPermission(OwnerPermissions.PlatformApiRead)
  keys(@ZodQuery(QueryKeysSchema) q: QueryKeysDto) { return this.svc.listKeys(q); }

  @Get('webhooks/health') @RequireOwnerPermission(OwnerPermissions.PlatformApiRead)
  webhookHealth() { return this.svc.webhookHealth(); }

  /** The inbound receipt log. Empty before this release, and its meta says so — an audit log that starts today reads
   *  exactly like a clean one. */
  @Get('webhooks/inbound') @RequireOwnerPermission(OwnerPermissions.PlatformApiRead)
  inbound(@ZodQuery(QueryInboundSchema) q: QueryInboundDto) { return this.svc.inbound(q); }

  /** W007. **`providers.secrets.read` IS NOT REQUIRED HERE** — the canon is explicit that "health metrics remain visible
   *  to all ops roles; only the raw secret references are gated", and this route returns no secret reference at all. */
  @Get('providers/health') @RequireOwnerPermission(OwnerPermissions.PlatformApiRead)
  providerHealth() { return this.svc.providerHealth(); }

  @Get('providers/:dep/circuit') @RequireOwnerPermission(OwnerPermissions.PlatformApiRead)
  circuitHistory(@Param('dep') dep: string, @ZodQuery(QueryCircuitHistorySchema) q: QueryCircuitHistoryDto) {
    return this.svc.circuitHistory(dep, q);
  }

  /**
   * Revoke a key. Elevated: this breaks a live integration within a minute, and scheduled jobs using it fail closed.
   *
   * **THERE IS NO ISSUE ROUTE, DELIBERATELY.** Law 11 — the platform does not mint a credential that acts as a tenant.
   * Oversight takes access away; it does not hand it out.
   */
  @Post('keys/:id/revoke')
  @RequireOwnerPermission(OwnerPermissions.PlatformApiManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  revoke(@Req() req: any, @Param('id') id: string, @ZodBody(RevokeKeySchema) body: RevokeKeyDto) {
    return this.svc.revokeKey(admin(req), id, body).then((data) => ({ data }));
  }
}
