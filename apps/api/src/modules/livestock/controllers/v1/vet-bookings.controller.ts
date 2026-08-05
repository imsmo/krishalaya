// modules/livestock/controllers/v1/vet-bookings.controller.ts · vet booking lifecycle + fee settlement.
// book/complete need vet.book (farmer, the payer); progress needs vet.manage (the assigned vet). Money-moving
// routes (book, pay) require an Idempotency-Key (Law 3). Ownership is resolved server-side. `livestock` flag.
import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { VetBookingService } from '../../services/vet-booking.service';
import { HealthService } from '../../services/health.service';
import { z } from 'zod';

// PC-54 W54-4 prescription DTO: drug lines are REQUIRED text (never hollow); Schedule-H flagged per line.
const WritePrescriptionSchema = z.object({
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(z.object({
    drugName: z.string().trim().min(1).max(200),
    dosage: z.string().trim().min(1).max(200),
    durationDays: z.number().int().min(1).max(365).optional(),
    isScheduleH: z.boolean().optional(),
    productId: z.string().uuid().optional(),
  }).strict()).min(1).max(30),
}).strict();
type WritePrescriptionDto = z.infer<typeof WritePrescriptionSchema>;
import { BookVetSchema, BookVetDto, VetProgressSchema, VetProgressDto } from '../../dto/create-vet-booking.dto';
import { QueryVetBookingsSchema, QueryVetBookingsDto } from '../../dto/query-vet-booking.dto';
import { LivestockPermissions, canBookVet, canManageVet, isLivestockAdmin } from '../../policies/livestock.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'livestock/vet-bookings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('livestock')
export class VetBookingsController {
  constructor(private readonly svc: VetBookingService, private readonly health: HealthService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canBook: canBookVet(ctx), canManageVet: canManageVet(ctx), isAdmin: isLivestockAdmin(ctx) }; }

  @Post() @RequirePermissions(LivestockPermissions.VetBook)
  book(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(BookVetSchema) dto: BookVetDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.book(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryVetBookingsSchema) q: QueryVetBookingsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/progress') @RequirePermissions(LivestockPermissions.VetManage)
  progress(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(VetProgressSchema) dto: VetProgressDto) { return this.svc.progress(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }

  // --- PC-54 W54-4 `vet-prescriptions` (0009): the written pad. VET-OF-RECORD only (server-enforced). ---
  @Post(':id/prescription') @RequirePermissions(LivestockPermissions.VetManage)
  writePrescription(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(WritePrescriptionSchema) dto: WritePrescriptionDto) {
    return this.health.writePrescription(ctx.tenantId, { userId: ctx.userId }, id, dto).then((data) => ({ data }));
  }
  @Get(':id/prescription')
  getPrescription(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.health.getPrescription(ctx.tenantId, { userId: ctx.userId, canManage: canManageVet(ctx) }, id).then((data) => ({ data }));
  }

  @Post(':id/cancel') @RequirePermissions(LivestockPermissions.VetBook)
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Body('reason') reason?: string) { return this.svc.cancel(ctx.tenantId, this.actor(ctx), id, reason).then((data) => ({ data })); }

  @Post(':id/complete') @RequirePermissions(LivestockPermissions.VetBook)
  complete(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.completeAndPay(ctx.tenantId, this.actor(ctx), id, key).then((data) => ({ data }));
  }
}
