// modules/labour/controllers/v1/summary.controller.ts · PC-56 TENANT-11b · A11 — GET labour/summary, the console KPIs (W163):
// open jobs + workers still needed, in_progress today + clocked in now, awaiting the employer's confirm (+ the wages it
// unlocks), fill rate over 30 days + median time-to-fill (null with the reason when there is nothing to measure).
// labour.desk or booking.manage (the service refuses everyone else). Gated by the `labour` flag.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { LabourBookingService } from '../../services/labour-booking.service';
import { labourActor } from '../../policies/labour.policies';

@Controller({ path: 'labour/summary', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class LabourSummaryController {
  constructor(private readonly svc: LabourBookingService) {}

  @Get()
  get(@CurrentContext() ctx: RequestContext) { return this.svc.summary(ctx.tenantId, labourActor(ctx)).then((data) => ({ data })); }
}
