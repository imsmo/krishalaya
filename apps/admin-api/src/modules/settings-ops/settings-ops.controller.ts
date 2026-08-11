// apps/admin-api/src/modules/settings-ops/settings-ops.controller.ts · W103 (PC-56 ADMIN-11).
//
// The registry no surface could reach. Reads need `settings.read`; every write needs `settings.manage` + FIDO2 +
// step-up, and money-path/security keys additionally need a second administrator (enforced in the service, by the same
// helper the other fourteen sites use).
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SettingsOpsService } from './services/settings-ops.service';
import {
  QuerySettingsSchema, QuerySettingsDto, DefineSettingSchema, DefineSettingDto,
  SetSettingValueSchema, SetSettingValueDto, RevertSettingSchema, RevertSettingDto,
  RetypeSettingSchema, RetypeSettingDto, ReclassifySettingSchema, ReclassifySettingDto,
} from './dto/settings-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
/** A platform setting reaches every tenant that has not overridden it. Same elevation as a payout approval. */
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'settings', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SettingsOpsController {
  constructor(private readonly settings: SettingsOpsService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.SettingsRead)
  list(@ZodQuery(QuerySettingsSchema) q: QuerySettingsDto) { return this.settings.list(q); }

  @Get(':key') @RequireOwnerPermission(OwnerPermissions.SettingsRead)
  get(@Param('key') key: string) { return this.settings.get(key).then((data) => ({ data })); }

  /** **A NEW SETTING IS AN INSERT, NEVER A MIGRATION.** W103's own sentence, and this is the route that makes it true. */
  @Post()
  @RequireOwnerPermission(OwnerPermissions.SettingsManage)
  @UseGuards(...ELEVATED)
  define(@Req() req: any, @ZodBody(DefineSettingSchema) body: DefineSettingDto) {
    return this.settings.define(admin(req), body).then((data) => ({ data }));
  }

  @Post(':key/value')
  @RequireOwnerPermission(OwnerPermissions.SettingsManage)
  @UseGuards(...ELEVATED)
  setValue(@Req() req: any, @Param('key') key: string, @ZodBody(SetSettingValueSchema) body: SetSettingValueDto) {
    return this.settings.setValue(admin(req), key, body).then((data) => ({ data }));
  }

  @Post(':key/revert')
  @RequireOwnerPermission(OwnerPermissions.SettingsManage)
  @UseGuards(...ELEVATED)
  revert(@Req() req: any, @Param('key') key: string, @ZodBody(RevertSettingSchema) body: RevertSettingDto) {
    return this.settings.revert(admin(req), key, body).then((data) => ({ data }));
  }

  @Post(':key/retype')
  @RequireOwnerPermission(OwnerPermissions.SettingsManage)
  @UseGuards(...ELEVATED)
  retype(@Req() req: any, @Param('key') key: string, @ZodBody(RetypeSettingSchema) body: RetypeSettingDto) {
    return this.settings.retype(admin(req), key, body).then((data) => ({ data }));
  }

  /** Re-classify a key's risk. Raising it takes one person; LOWERING it takes two, because it removes the two-person
   *  rule from every future change to that key — the one edit on this plane that can disable a control. */
  @Post(':key/reclassify')
  @RequireOwnerPermission(OwnerPermissions.SettingsManage)
  @UseGuards(...ELEVATED)
  reclassify(@Req() req: any, @Param('key') key: string, @ZodBody(ReclassifySettingSchema) body: ReclassifySettingDto) {
    return this.settings.reclassify(admin(req), key, body).then((data) => ({ data }));
  }
}
