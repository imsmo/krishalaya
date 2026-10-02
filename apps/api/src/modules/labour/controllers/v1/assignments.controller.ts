// modules/labour/controllers/v1/assignments.controller.ts · the WORKER side: respond to + list assignments.
// Responding (accept/reject) acts on the caller's OWN assignment (ownership resolved server-side from the
// caller's worker profile — anti-IDOR). Listing 'mine' is the caller's; 'booking' is the employer's view.
// Gated by the `labour` flag.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { LabourBookingService } from '../../services/labour-booking.service';
import { AttendanceService } from '../../services/attendance.service';
import { RespondAssignmentSchema, RespondAssignmentDto } from '../../dto/create-booking-assignment.dto';
import { QueryAssignmentsSchema, QueryAssignmentsDto } from '../../dto/query-booking-assignment.dto';
import { ClockInSchema, ClockInDto, ClockOutSchema, ClockOutDto, ConfirmAttendanceSchema, ConfirmAttendanceDto } from '../../dto/create-attendance.dto';
import { canManageLabour, canRunLabourDesk, labourActor } from '../../policies/labour.policies';
import { decodeCursor } from '../../domain/cursor';
const ipOf = (req: Request) => req.ip || null;

@Controller({ path: 'labour/assignments', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class AssignmentsController {
  constructor(private readonly svc: LabourBookingService, private readonly attendance: AttendanceService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAssignmentsSchema) q: QueryAssignmentsDto) {
    return this.svc.listAssignments(ctx.tenantId, labourActor(ctx), { box: q.box, bookingId: q.bookingId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** The caller's OWN attendance work-history (keyset). Declared BEFORE ':id' so the literal path wins. */
  @Get('attendance/history')
  history(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.attendance.workHistory(ctx.tenantId, ctx.userId, { cursor: decodeCursor(cursor), limit: lim })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** F-19: the assigned worker, the booking's employer, or the labour desk / booking.manage — anyone else 404. */
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getAssignment(ctx.tenantId, labourActor(ctx), id).then((data) => ({ data })); }

  /** The attendance days of one assignment (employer / desk) — the per-day confirm list on the job detail. */
  @Get(':id/days')
  days(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.assignmentDays(ctx.tenantId, labourActor(ctx), id).then((data) => ({ data })); }

  @Post(':id/respond')
  respond(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RespondAssignmentSchema) dto: RespondAssignmentDto) {
    return this.svc.respond(ctx.tenantId, ctx.userId, id, { decision: dto.decision, voiceConsentMediaId: dto.voiceConsentMediaId }, ipOf(r)).then((data) => ({ data }));
  }

  /** WORKER clocks in for today on their OWN accepted assignment. The device sends only its GPS fix; the
   *  ≤100m farm fence is computed + enforced SERVER-side (anti-spoof). State-advancing → Idempotency-Key (Law 3). */
  @Post(':id/attendance')
  clockIn(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ClockInSchema) dto: ClockInDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.attendance.clockIn(ctx.tenantId, ctx.userId, id, { lat: dto.lat, lng: dto.lng }, key).then((data) => ({ data }));
  }

  /** WORKER clocks out of TODAY's open attendance on their OWN assignment. The SERVER stamps the time +
   *  computes hours/overtime; the worker only declares the break taken. State-advancing → Idempotency-Key (Law 3). */
  @Post(':id/attendance/clock-out')
  clockOut(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ClockOutSchema) dto: ClockOutDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.attendance.clockOut(ctx.tenantId, ctx.userId, id, { breakMinutes: dto.breakMinutes }, key).then((data) => ({ data }));
  }

  /** EMPLOYER dual-confirms a worker's clocked-out day (booking owner OR a booking.manage admin, Law 11).
   *  A non-owner without booking.manage gets 404 (no enumeration). State-advancing → Idempotency-Key (Law 3). */
  @Post(':id/attendance/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ConfirmAttendanceSchema) dto: ConfirmAttendanceDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.attendance.confirmDay(ctx.tenantId, { userId: ctx.userId, canManage: canManageLabour(ctx), canDesk: canRunLabourDesk(ctx) }, id, dto.workDate, key, ipOf(r)).then((data) => ({ data }));
  }
}
