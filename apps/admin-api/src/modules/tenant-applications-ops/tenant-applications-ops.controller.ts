// apps/admin-api/src/modules/tenant-applications-ops/tenant-applications-ops.controller.ts · PC-55 A1.
// Reads = TenantRead. DECISIONS = TenantManage + HardwareKey + StepUp (same double-lock as tenant approve/
// suspend — provisioning a tenant is as consequential as it gets).
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { TenantApplicationsOpsService } from './tenant-applications-ops.service';
import { z } from 'zod';

const MANAGE = [HardwareKeyGuard, StepUpReauthGuard] as const;
const decodeTsCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

const QuerySchema = z.object({
  status: z.enum(['draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn']).optional(),
  countryCode: z.string().length(2).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const ApproveSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{3,50}$/).optional(),   // explicit slug when the derived one collides
  tenantTypeId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();
const RejectSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

@Controller('tenant-applications')
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class TenantApplicationsOpsController {
  constructor(private readonly svc: TenantApplicationsOpsService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.TenantRead)
  list(@ZodQuery(QuerySchema) q: z.infer<typeof QuerySchema>) {
    return this.svc.list({ status: q.status, countryCode: q.countryCode, cursor: decodeTsCursor(q.cursor), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get(':id') @RequireOwnerPermission(OwnerPermissions.TenantRead)
  get(@Req() req: any, @Param('id') id: string) { return this.svc.get(req.admin ?? req, id).then((data) => ({ data })); }

  @Post(':id/claim') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(...MANAGE)
  claim(@Req() req: any, @Param('id') id: string) { return this.svc.claim(req.admin ?? req, id).then((data) => ({ data })); }

  @Post(':id/approve') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(...MANAGE)
  approve(@Req() req: any, @Param('id') id: string, @ZodBody(ApproveSchema) dto: z.infer<typeof ApproveSchema>) {
    return this.svc.approve(req.admin ?? req, id, dto).then((data) => ({ data }));
  }
  @Post(':id/reject') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(...MANAGE)
  reject(@Req() req: any, @Param('id') id: string, @ZodBody(RejectSchema) dto: { reason: string }) {
    return this.svc.reject(req.admin ?? req, id, dto.reason).then((data) => ({ data }));
  }
}
