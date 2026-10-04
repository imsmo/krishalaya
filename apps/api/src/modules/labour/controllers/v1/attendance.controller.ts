// modules/labour/controllers/v1/attendance.controller.ts · PC-56 TENANT-SW-b · B — W165 (`/ops/labour/attendance`), the review desk.
//   GET  /labour/attendance?status&since&cursor   the tenant-wide list (labour.desk / booking.manage; workers masked; µs keyset)
//   GET  /labour/attendance/summary               the four tiles — Clean · Needs review · paper_backfill · Unconfirmed > 24 h (real counts)
//   POST /labour/attendance/confirm-clean         ONE keyed act over the clean set (each day confirmed individually, one tx; count back)
//   POST /labour/attendance/backfill              the desk records a paper day (evidence media + reason) → needs_review   (Idempotency-Key)
//   POST /labour/attendance/:id/vouch | /refuse   review a needs_review day (reason 10–500; never the worker; never a backfill's recorder)
//   POST /labour/attendance/:id/confirm           confirm one day (never the worker — the dual-confirm law is the DATABASE's)  (Idempotency-Key)
// The offline on-device clock store (W165 "stored on-device offline") is REFUSED BY NAME — mobile, not built (the summary says so).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AttendanceService } from '../../services/attendance.service';
import { canBookLabour, canManageLabour, canRunLabourDesk } from '../../policies/labour.policies';
import { decodeCursor } from '../../domain/cursor';
import { AttendanceRecordNotFoundError } from '../../domain/labour.errors';
import {
  AttendanceBackfillSchema, AttendanceBackfillDto, AttendanceConfirmSchema, AttendanceReviewQuerySchema, AttendanceReviewQueryDto, AttendanceReviewSchema,
} from '../../dto/swb.dto';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const idParam = (id: string) => { if (!UUID.test(id)) throw new AttendanceRecordNotFoundError(id); return id; };
const requireKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'labour/attendance', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('labour')
export class AttendanceReviewController {
  constructor(private readonly svc: AttendanceService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLabour(ctx), canDesk: canRunLabourDesk(ctx), canBook: canBookLabour(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(AttendanceReviewQuerySchema) q: AttendanceReviewQueryDto) {
    return this.svc.reviewList(ctx.tenantId, this.actor(ctx), { status: q.status, since: q.since, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('summary')
  summary(@CurrentContext() ctx: RequestContext) { return this.svc.reviewSummary(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }

  @Post('confirm-clean')
  confirmClean(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(AttendanceConfirmSchema) dto: { reason?: string }) {
    return this.svc.confirmAllClean(ctx.tenantId, this.actor(ctx), dto.reason ?? null, `att-clean:${ctx.tenantId}:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
  @Post('backfill')
  backfill(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(AttendanceBackfillSchema) dto: AttendanceBackfillDto) {
    return this.svc.backfill(ctx.tenantId, this.actor(ctx), dto, `att-backfill:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/vouch')
  vouch(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AttendanceReviewSchema) dto: { reason: string }) {
    return this.svc.review(ctx.tenantId, this.actor(ctx), idParam(id), 'vouched', dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/refuse')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AttendanceReviewSchema) dto: { reason: string }) {
    return this.svc.review(ctx.tenantId, this.actor(ctx), idParam(id), 'refused', dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(AttendanceConfirmSchema) dto: { reason?: string }) {
    return this.svc.confirmById(ctx.tenantId, this.actor(ctx), idParam(id), dto.reason ?? null, `att-confirm:${id}:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
}
