// modules/communication/controllers/v1/preferences.controller.ts · the caller's notification preferences + quiet
// hours (own userId only). Disabling a mandatory event throws (service, Law 6). `communication` flag.
import { Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { PreferenceService } from '../../services/preference.service';
import { SetPreferencesSchema, SetPreferencesDto } from '../../dto/set-notification-preference.dto';
import { SetQuietHoursSchema, SetQuietHoursDto } from '../../dto/set-quiet-hours.dto';

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class PreferencesController {
  constructor(private readonly svc: PreferenceService) {}

  @Get('preferences')
  list(@CurrentContext() ctx: RequestContext) { return this.svc.list(ctx.userId).then((data) => ({ data })); }
  @Put('preferences')
  set(@CurrentContext() ctx: RequestContext, @ZodBody(SetPreferencesSchema) dto: SetPreferencesDto) { return this.svc.setPreferences(ctx.tenantId, ctx.userId, dto.preferences).then((data) => ({ data })); }

  @Get('quiet-hours')
  getQuiet(@CurrentContext() ctx: RequestContext) { return this.svc.getQuietHours(ctx.userId).then((data) => ({ data })); }
  @Put('quiet-hours')
  setQuiet(@CurrentContext() ctx: RequestContext, @ZodBody(SetQuietHoursSchema) dto: SetQuietHoursDto) { return this.svc.setQuietHours(ctx.tenantId, ctx.userId, dto).then((data) => ({ data })); }
}
