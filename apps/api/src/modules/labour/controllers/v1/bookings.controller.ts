// modules/labour/controllers/v1/bookings.controller.ts · employer booking lifecycle + wage settlement.
// PC-56 TENANT-11b: the route guards accept `worker.book` OR `labour.desk` (F-8) — the per-booking rule lives in the
// service: the employer acts for themself; the desk acts FOR an employer only with their recorded consent (A6); paying a
// desk-run booking is `labour.wages.approve`. Money-moving routes (create, assign, confirm-roster, pay) require an
// Idempotency-Key (Law 3). Every act records actor, reason, before / after and ip (F-24). Gated by the `labour` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { LabourBookingService } from '../../services/labour-booking.service';
import { CreateBookingSchema, CreateBookingDto } from '../../dto/create-labour-booking.dto';
import { QueryBookingsSchema, QueryBookingsDto } from '../../dto/query-labour-booking.dto';
import { AssignWorkerSchema, AssignWorkerDto } from '../../dto/create-booking-assignment.dto';
import { BookingActDto, CancelBookingSchema, CancelBookingDto, ConfirmRosterDto, OptionalBookingActSchema, OptionalConfirmRosterSchema } from '../../dto/labour-act.dto';
import { labourActor } from '../../policies/labour.policies';
import { decodeCursor } from '../../domain/cursor';
import { ApiScopes } from '../../../../core/auth/api-key.port';

const ipOf = (req: Request) => req.ip || null;
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'labour/bookings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class BookingsController {
  constructor(private readonly svc: LabourBookingService) {}

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateBookingSchema) dto: CreateBookingDto) {
    return this.svc.create(ctx.tenantId, labourActor(ctx), needKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get() @ApiScopes('labour.bookings.read')
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBookingsSchema) q: QueryBookingsDto) {
    return this.svc.listBookings(ctx.tenantId, labourActor(ctx), { box: q.box, status: q.status, taskSkillId: q.taskSkillId, sort: q.sort, counts: q.counts === '1', cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, counts: res.counts, unreachableStatuses: res.unreachableStatuses } }));
  }

  @Get(':id') @ApiScopes('labour.bookings.read')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getBooking(ctx.tenantId, labourActor(ctx), id).then((data) => ({ data })); }

  @Post(':id/assignments')
  assign(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(AssignWorkerSchema) dto: AssignWorkerDto) {
    return this.svc.assign(ctx.tenantId, labourActor(ctx), id, needKey(key), { workerId: dto.workerId, wageMinor: dto.wageMinor, consent: dto.consent }, ipOf(r)).then((data) => ({ data }));
  }

  /** WORKER self-applies to an open booking (any authenticated worker — not the employer's worker.book). The
   *  caller's own worker profile is resolved from the token (no IDOR); idempotent on the caller's key (Law 3). */
  @Post(':id/apply')
  apply(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.svc.applyAsWorker(ctx.tenantId, ctx.userId, id, needKey(key), ipOf(r)).then((data) => ({ data }));
  }

  /** A3 — confirm the roster: the wages + the platform fee are set aside (employer Main → Hold) in this call. */
  @Post(':id/confirm-roster')
  confirmRoster(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(OptionalConfirmRosterSchema) dto: ConfirmRosterDto) {
    return this.svc.confirmRoster(ctx.tenantId, labourActor(ctx), id, needKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/start')
  start(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(OptionalBookingActSchema) dto: BookingActDto) {
    return this.svc.start(ctx.tenantId, labourActor(ctx), id, ipOf(r), dto.reason ?? null).then((data) => ({ data }));
  }

  @Post(':id/complete')
  complete(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(OptionalBookingActSchema) dto: BookingActDto) {
    return this.svc.complete(ctx.tenantId, labourActor(ctx), id, ipOf(r), dto.reason ?? null).then((data) => ({ data }));
  }

  /** A7 — cancel with a reason from the lookup (`other` needs the words); workers are told; escrow back, fee kept. */
  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelBookingSchema) dto: CancelBookingDto) {
    return this.svc.cancel(ctx.tenantId, labourActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** A2 / A4 — the pay run: confirmed attendance × rate (+ OT) from the escrow; on completion the remainder goes home. */
  @Post(':id/pay')
  pay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(OptionalBookingActSchema) dto: BookingActDto) {
    return this.svc.payWages(ctx.tenantId, labourActor(ctx), id, needKey(key), ipOf(r), dto.reason ?? null).then((data) => ({ data }));
  }
}
