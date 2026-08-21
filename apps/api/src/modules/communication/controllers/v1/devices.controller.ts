// modules/communication/controllers/v1/devices.controller.ts · register / revoke the caller's push device.
// POST   notifications/devices  — register this device's Expo/FCM token (after login)
// DELETE notifications/devices  — revoke it (on logout)
// Owner = the caller's own userId (from the token); a user can only touch their OWN devices (no IDOR).
// Behind AuthGuard + PermissionsGuard + the `communication` flag (same as the rest of the module).
import { Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { DeviceService } from '../../services/device.service';
import { RegisterDeviceSchema, RegisterDeviceDto, RevokeDeviceSchema, RevokeDeviceDto } from '../../dto/register-device.dto';

@Controller({ path: 'notifications/devices', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class DevicesController {
  constructor(private readonly svc: DeviceService) {}

  @Post()
  register(@CurrentContext() ctx: RequestContext, @ZodBody(RegisterDeviceSchema) dto: RegisterDeviceDto) {
    return this.svc.register(ctx.tenantId, ctx.userId, dto).then((data) => ({ data }));
  }

  @Delete()
  revoke(@CurrentContext() ctx: RequestContext, @ZodBody(RevokeDeviceSchema) dto: RevokeDeviceDto) {
    return this.svc.revoke(ctx.tenantId, ctx.userId, dto.token).then((data) => ({ data }));
  }
}
