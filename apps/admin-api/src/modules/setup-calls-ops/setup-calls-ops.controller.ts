// apps/admin-api/src/modules/setup-calls-ops/setup-calls-ops.controller.ts · PC-56 TENANT-SW-d · C1 — the Krishalaya team's setup-call queue.
// Reads = TenantRead (the queue is masked; the case read discloses the phone and is audited). Acts = TenantManage + StepUp (a person's
// call is booked or closed; not money — no hardware key).
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SetupCallsOpsService } from './setup-calls-ops.service';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const ListSchema = z.object({ status: z.enum(['requested', 'scheduled', 'done', 'cancelled']).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const ScheduleSchema = z.object({ scheduledAt: z.string().max(40) }).strict();
const DoneSchema = z.object({ outcomeNote: z.string().max(500) }).strict();
const CancelSchema = z.object({ reason: z.string().max(300) }).strict();

@Controller('setup-calls')
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SetupCallsOpsController {
  constructor(private readonly svc: SetupCallsOpsService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.TenantRead)
  list(@ZodQuery(ListSchema) q: z.infer<typeof ListSchema>) {
    return this.svc.list({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('notices') @RequireOwnerPermission(OwnerPermissions.TenantRead)
  notices() { return this.svc.notices().then((data) => ({ data })); }
  @Get(':id') @RequireOwnerPermission(OwnerPermissions.TenantRead)
  get(@Req() req: any, @Param('id') id: string) { return this.svc.get(req.admin ?? req, id).then((data) => ({ data })); }

  @Post(':id/schedule') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(StepUpReauthGuard)
  schedule(@Req() req: any, @Param('id') id: string, @ZodBody(ScheduleSchema) dto: z.infer<typeof ScheduleSchema>) { return this.svc.schedule(req.admin ?? req, id, dto).then((data) => ({ data })); }
  @Post(':id/done') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(StepUpReauthGuard)
  done(@Req() req: any, @Param('id') id: string, @ZodBody(DoneSchema) dto: z.infer<typeof DoneSchema>) { return this.svc.done(req.admin ?? req, id, dto).then((data) => ({ data })); }
  @Post(':id/cancel') @RequireOwnerPermission(OwnerPermissions.TenantManage) @UseGuards(StepUpReauthGuard)
  cancel(@Req() req: any, @Param('id') id: string, @ZodBody(CancelSchema) dto: z.infer<typeof CancelSchema>) { return this.svc.cancel(req.admin ?? req, id, dto).then((data) => ({ data })); }
}
