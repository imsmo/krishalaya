// modules/ambassadors/controllers/v1/referrals.controller.ts · the referral engine (caller-owned) + activation.
// create/claim/list are any authenticated user (own referrals); create needs an Idempotency-Key. activate needs
// ambassador.manage (it accrues commission). `ambassadors` flag.
//
// PC-56 TENANT-10a · W162 — `GET /ambassadors/referrals/all` (the tenant's desk: every referral, masked names, status
// filter, µs keyset, total), `GET /ambassadors/referrals/:id` (one desk row) and `GET /ambassadors/referrals/summary` (the KPI tiles; "Rewards paid" is null with its reason —
// no reward rule exists, F-11) — both ambassador.manage. Activation REQUIRES a reason and is audited (F-12).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ReferralService } from '../../services/referral.service';
import { ReferralDeskReadModel } from '../../read-models/referral-desk.read-model';
import { ReferralNotFoundError } from '../../domain/ambassadors.errors';
import { decodeCursor } from '../../domain/cursor';
import { ActivateReferralSchema } from '../../dto/enroll-ambassador.dto';
import { ipOf } from './ambassadors.controller';
import { AmbassadorsPermissions, canManageAmbassadors } from '../../policies/ambassadors.policies';
import { CreateReferralSchema, CreateReferralDto, ClaimReferralSchema, ClaimReferralDto } from '../../dto/create-referral.dto';
import { QueryReferralsSchema, QueryReferralsDto } from '../../dto/query-referral.dto';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Controller({ path: 'ambassadors/referrals', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class ReferralsController {
  constructor(private readonly svc: ReferralService, private readonly desk: ReferralDeskReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageAmbassadors(ctx) }; }

  @Post()
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateReferralSchema) dto: CreateReferralDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Post('claim')
  claim(@CurrentContext() ctx: RequestContext, @ZodBody(ClaimReferralSchema) dto: ClaimReferralDto) { return this.svc.claim(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryReferralsSchema) q: QueryReferralsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('all') @RequirePermissions(AmbassadorsPermissions.Manage)
  all(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryReferralsSchema) q: QueryReferralsDto) {
    return this.desk.list(ctx.tenantId, { status: q.status, cursor: q.cursor, limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } }));
  }
  @Get('summary') @RequirePermissions(AmbassadorsPermissions.Manage)
  summary(@CurrentContext() ctx: RequestContext) { return this.desk.summary(ctx.tenantId).then((data) => ({ data })); }
  @Get(':id') @RequirePermissions(AmbassadorsPermissions.Manage)
  async one(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!UUID.test(id)) throw new ReferralNotFoundError(id);
    const row = await this.desk.one(ctx.tenantId, id);
    if (!row) throw new ReferralNotFoundError(id);
    return { data: row };
  }
  @Post(':id/activate') @RequirePermissions(AmbassadorsPermissions.Manage)
  activate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ActivateReferralSchema) dto: { reason: string }) {
    if (!UUID.test(id)) throw new ReferralNotFoundError(id);
    return this.svc.activate(ctx.tenantId, this.actor(ctx), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
