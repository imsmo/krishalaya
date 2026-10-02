// modules/ambassadors/controllers/v1/ambassadors.controller.ts · ambassador profiles + commission plans.
// enroll/update/suspend need ambassador.manage; payouts need ambassador.payout (tenant_admin only, 0184); `me` is the
// caller's own profile. `ambassadors` flag.
//
// PC-56 TENANT-10a — the W159 surface:
//   GET  /ambassadors                 the roster read model (name + masked phone, tier, clusters, onboarded 30d, owed, last active)
//   GET  /ambassadors/summary         the KPI tiles + tier-tab counts
//   GET  /ambassadors/candidates      the recruit form's member lookup by phone (masked)
//   POST /ambassadors/review          the recruit form's review (W2482; with refusals = W2481)
//   POST /ambassadors                 recruit (Idempotency-Key required)
//   POST /ambassadors/:id/review      the edit form's review (diff against the profile as it stands)
//   PATCH /ambassadors/:id            edit (audited before → after)
//   POST /ambassadors/:id/suspend     reason REQUIRED · /reinstate reason optional
//   POST /ambassadors/:id/payout      ambassador.payout · reason REQUIRED · Idempotency-Key
//   POST /ambassadors/payouts/run     ambassador.payout · reason REQUIRED · Idempotency-Key — the weekly earnings run (A13)
// STATIC ROUTES ARE DECLARED BEFORE `:id` (Express matches in order), and this controller is registered LAST in the module.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import type { Request } from 'express';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { normalizePhoneE164 } from '../../../../shared/utils/phone';
import { AmbassadorProfileService } from '../../services/ambassador-profile.service';
import { CommissionPlanService } from '../../services/commission-plan.service';
import { AmbassadorEarningService } from '../../services/ambassador-earning.service';
import { AmbassadorRosterReadModel, RosterSort } from '../../read-models/ambassador-roster.read-model';
import { AmbassadorsPermissions, canManageAmbassadors } from '../../policies/ambassadors.policies';
import { decodeCursor } from '../../domain/cursor';
import { AmbassadorNotFoundError } from '../../domain/ambassadors.errors';
import {
  EnrollAmbassadorSchema, EnrollAmbassadorDto, UpdateAmbassadorSchema, UpdateAmbassadorDto, ReviewRecruitSchema, ReviewRecruitDto,
  ReviewEditSchema, ReviewEditDto, SuspendSchema, ReinstateSchema, PayoutSchema,
} from '../../dto/enroll-ambassador.dto';
import { QueryAmbassadorsSchema, QueryAmbassadorsDto, CandidateQuerySchema, CandidateQueryDto } from '../../dto/query-ambassador.dto';
import { QueryEarningsSchema, QueryEarningsDto } from '../../dto/query-earning.dto';

// HOTFIX-1 (8c's F-7 class): the audit row's `ip` is an inet — the client's address (`req.ip`, behind main.ts's
// `trust proxy` hops) or NULL, never `ctx.requestId` (a UUID, which made every one of these writes a 22P02 and rolled back).
export const ipOf = (r: Pick<Request, 'ip'>): string | null => (typeof r.ip === 'string' && r.ip.length > 0 ? r.ip : null);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A path id that is not a UUID names no ambassador — 404 by name, never a 500 from a uuid cast. */
const uuidParam = (id: string) => { if (!UUID.test(id)) throw new AmbassadorNotFoundError(id); return id; };
const requireKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'ambassadors', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class AmbassadorsController {
  constructor(
    private readonly profiles: AmbassadorProfileService,
    private readonly plans: CommissionPlanService,
    private readonly earnings: AmbassadorEarningService,
    private readonly roster: AmbassadorRosterReadModel,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageAmbassadors(ctx) }; }

  /* ---- static routes first ---- */
  @Post() @RequirePermissions(AmbassadorsPermissions.Manage)
  enroll(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(EnrollAmbassadorSchema) dto: EnrollAmbassadorDto) {
    return this.profiles.enroll(ctx.tenantId, this.actor(ctx), {
      userId: dto.userId, phone: dto.phone, clusterRegionIds: dto.clusterRegionIds, tierId: dto.tierId ?? undefined, mentorAmbassadorId: dto.mentorAmbassadorId ?? undefined,
      kioskEnabled: dto.kioskEnabled, aepsEnabled: dto.aepsEnabled, monthlyStipendMinor: dto.monthlyStipendMinor,
    }, `ambenroll:${requireKey(key)}`, ipOf(r)).then((data) => ({ data }));
  }
  @Get() @RequirePermissions(AmbassadorsPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAmbassadorsSchema) q: QueryAmbassadorsDto) {
    return this.profiles.roster(ctx.tenantId, this.actor(ctx), { activeOnly: q.activeOnly, tier: q.tier, inactive: q.inactive, sort: q.sort as RosterSort, cursor: q.cursor, limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, total: res.total } }));
  }
  @Get('summary') @RequirePermissions(AmbassadorsPermissions.Manage)
  summary(@CurrentContext() ctx: RequestContext) { return this.profiles.summary(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('candidates') @RequirePermissions(AmbassadorsPermissions.Manage)
  async candidate(@CurrentContext() ctx: RequestContext, @ZodQuery(CandidateQuerySchema) q: CandidateQueryDto) {
    const phone = normalizePhoneE164(q.phone);
    const found = phone ? await this.roster.memberByPhone(ctx.tenantId, phone) : null;
    // A person who is not a member of THIS cooperative is not named to it (no name, no masked phone) — only the fact.
    return { data: found && !found.isMember ? { userId: null, displayName: null, phoneMasked: null, isMember: false, ambassadorId: null } : found };
  }
  @Post('review') @RequirePermissions(AmbassadorsPermissions.Manage)
  reviewRecruit(@CurrentContext() ctx: RequestContext, @ZodBody(ReviewRecruitSchema) dto: ReviewRecruitDto) {
    return this.profiles.reviewRecruit(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  @Post('payouts/run') @RequirePermissions(AmbassadorsPermissions.Payout)
  runPayouts(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(PayoutSchema) dto: { reason: string }) {
    return this.earnings.runPayouts(ctx.tenantId, { userId: ctx.userId }, `ambbatch:${ctx.tenantId}:${requireKey(key)}`, dto.reason).then((data) => ({ data }));
  }
  @Get('me')
  mine(@CurrentContext() ctx: RequestContext) { return this.profiles.getMine(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('plans')
  plansList(@CurrentContext() ctx: RequestContext) { return this.plans.list(ctx.tenantId).then((data) => ({ data })); }

  /* ---- parametric routes ---- */
  @Get(':id') @RequirePermissions(AmbassadorsPermissions.Manage)
  async get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    // the detail page names the person exactly as the roster does (short name, masked phone, tier code, clusters, owed)
    const row = await this.roster.row(ctx.tenantId, uuidParam(id));
    if (!row) throw new AmbassadorNotFoundError(id);
    return { data: row };
  }
  @Post(':id/review') @RequirePermissions(AmbassadorsPermissions.Manage)
  reviewEdit(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(ReviewEditSchema) dto: ReviewEditDto) {
    return this.profiles.reviewEdit(ctx.tenantId, this.actor(ctx), uuidParam(id), dto).then((data) => ({ data }));
  }
  @Patch(':id') @RequirePermissions(AmbassadorsPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateAmbassadorSchema) dto: UpdateAmbassadorDto) {
    return this.profiles.update(ctx.tenantId, this.actor(ctx), uuidParam(id), {
      ...dto, tierId: dto.tierId === null ? '' : dto.tierId, mentorAmbassadorId: dto.mentorAmbassadorId === null ? '' : dto.mentorAmbassadorId,
    }, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/suspend') @RequirePermissions(AmbassadorsPermissions.Manage)
  suspend(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SuspendSchema) dto: { reason: string }) {
    return this.profiles.setActive(ctx.tenantId, this.actor(ctx), uuidParam(id), false, ipOf(r), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/reinstate') @RequirePermissions(AmbassadorsPermissions.Manage)
  reinstate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ReinstateSchema) dto: { reason?: string }) {
    return this.profiles.setActive(ctx.tenantId, this.actor(ctx), uuidParam(id), true, ipOf(r), dto.reason ?? null).then((data) => ({ data }));
  }
  @Get(':id/earnings') @RequirePermissions(AmbassadorsPermissions.Manage)
  earningsList(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryEarningsSchema) q: QueryEarningsDto) {
    return this.earnings.listForAmbassador(ctx.tenantId, uuidParam(id), { unpaidOnly: q.unpaidOnly, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Post(':id/payout') @RequirePermissions(AmbassadorsPermissions.Payout)
  payout(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PayoutSchema) dto: { reason: string }) {
    return this.earnings.payoutAmbassador(ctx.tenantId, { userId: ctx.userId }, uuidParam(id), `ambpayout:${id}:${requireKey(key)}`, dto.reason).then((data) => ({ data }));
  }
}
