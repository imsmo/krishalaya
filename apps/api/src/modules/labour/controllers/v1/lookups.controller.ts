// modules/labour/controllers/v1/lookups.controller.ts · GET labour/lookups — the taxonomy catalogue clients
// need to render pickers (work-type, skill tree, region, skill-level) with real server ids instead of
// hard-coded UUIDs. Read-only; any authenticated user; gated by the `labour` flag.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { LabourLookupsService } from '../../services/labour-lookups.service';

const FloorQuerySchema = z.object({
  regionId: z.string().uuid(),
  skillLevel: z.enum(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled']),
  wageKind: z.enum(['per_day', 'per_hour', 'per_task']).default('per_day'),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
type FloorQuery = z.infer<typeof FloorQuerySchema>;

@Controller({ path: 'labour/lookups', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class LookupsController {
  constructor(private readonly svc: LabourLookupsService) {}

  @Get()
  all(@CurrentContext() ctx: RequestContext) { return this.svc.getAll(ctx.tenantId).then((data) => ({ data })); }

  /** PC-56 TENANT-11b · W2657 — the statutory floor for (region, skill level, wage kind, date), so the post-job form shows the
   *  offered wage against the floor LIVE. Read-only; the create re-resolves it and refuses below it. */
  @Get('floor')
  floor(@CurrentContext() ctx: RequestContext, @ZodQuery(FloorQuerySchema) q: FloorQuery) {
    return this.svc.floor(ctx.tenantId, q.regionId, q.skillLevel, q.wageKind, q.onDate).then((data) => ({ data }));
  }
}

