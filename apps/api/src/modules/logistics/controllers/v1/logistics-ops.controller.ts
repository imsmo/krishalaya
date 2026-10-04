// modules/logistics/controllers/v1/logistics-ops.controller.ts · PC-56 TENANT-SW-e — the logistics-ops routes (validate → authorize →
// delegate, no logic). Every write takes the Idempotency-Key its confirm page minted (Law 3).
//   logistics/slots/*                 W230 desk read, suggestions, proposals (logistics.manage; proposals also `logistics_slot_proposals`)
//   me/pickup-slot-proposals/*        the member's own answer in the app (their session)
//   pickup-slot-proposals/:id/*       the OTP link — PUBLIC, rate-limited; the code goes to the member's own phone
//   logistics/village-run/*           W232 + chains (logistics.manage); the driver's and the keeper's handover acts (their sessions)
//   me/cold-chain-offers/*            the buyer's accept / accept-with-test / reject
//   ingest/cold-chain/readings        the DEVICE route — PUBLIC, signed per device (HMAC), kv_ingest
import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { SlotProposalService } from '../../services/slot-proposal.service';
import { VillageRunService } from '../../services/village-run.service';
import { ColdChainService } from '../../services/cold-chain.service';
import { ColdChainIngestService } from '../../services/cold-chain-ingest.service';
import { RUN_ACTS } from '../../domain/route-run.state';
import { SLOT_DECISIONS, SLOT_PROPOSAL_STATUSES } from '../../domain/logistics-ops';
import { BuyerDecisionSchema, BuyerDecisionDto } from '../../dto/cold-chain.dto';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id ?? '')) throw new BadRequestError('id must be a uuid'); return id; };
const ipOf = (r: Request) => r.ip || null;
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Window = z.object({ weekday: z.number().int().min(0).max(6), start: HHMM, end: HHMM }).strict();
const ProposeSchema = z.object({ sellerUserId: z.string().uuid(), slots: z.array(Window).min(1).max(14), reason: z.string().trim().min(10).max(500) }).strict();
const ReasonSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const OptReasonSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict();
const PageSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const ProposalListSchema = PageSchema.extend({ status: z.enum(SLOT_PROPOSAL_STATUSES).optional(), sellerUserId: z.string().uuid().optional() }).strict();
const LinkDecideSchema = z.object({ code: z.string().regex(/^\d{4,8}$/), decision: z.enum(SLOT_DECISIONS), reason: z.string().trim().max(500).nullable().optional() }).strict();
const DropPointSchema = z.object({
  sequence: z.number().int().min(1).max(99), regionId: z.string().uuid(), name: z.string().trim().min(2).max(120), ambassadorUserId: z.string().uuid(),
  windowStart: HHMM.nullable().optional(), windowEnd: HHMM.nullable().optional(),
}).strict().refine((d) => !!d.windowStart === !!d.windowEnd && (!d.windowStart || (d.windowStart as string) < (d.windowEnd as string)), { message: 'a window is a start before its end', path: ['windowEnd'] });
const DraftSchema = z.object({
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plan: z.array(z.object({ shipmentId: z.string().uuid(), dropPointId: z.string().uuid() }).strict()).min(1).max(500),
  partnerId: z.string().uuid().nullable().optional(), vehicleId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(10).max(500),
}).strict();
const RunActSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict();
const KeeperCodeSchema = z.object({ shipmentId: z.string().uuid() }).strict();
const HandoverSchema = z.object({ shipmentId: z.string().uuid(), code: z.string().regex(/^\d{4,8}$/) }).strict();
const CollectSchema = z.object({ code: z.string().regex(/^\d{4,8}$/) }).strict();

/* ───────────────────────────────── W230 · the pickup desk ───────────────────────────────── */
@Controller({ path: 'logistics/slots', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class PickupSlotDeskController {
  constructor(private readonly svc: SlotProposalService) {}
  private actor(ctx: RequestContext, r: Request) { return { userId: ctx.userId, canManage: canManageLogistics(ctx), ip: ipOf(r) }; }

  @Get('desk') @RequirePermissions(ShipmentPermissions.Manage)
  desk(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(PageSchema) q: z.infer<typeof PageSchema>) {
    return this.svc.desk(ctx.tenantId, this.actor(ctx, r), { cursor: q.cursor, limit: q.limit }).then((data) => ({ data }));
  }
  @Get('suggestions/:sellerId') @RequirePermissions(ShipmentPermissions.Manage)
  suggestions(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('sellerId') sellerId: string) {
    return this.svc.suggestions(ctx.tenantId, this.actor(ctx, r), idOf(sellerId)).then((data) => ({ data }));
  }
  @Get('proposals') @RequirePermissions(ShipmentPermissions.Manage)
  proposals(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(ProposalListSchema) q: z.infer<typeof ProposalListSchema>) {
    return this.svc.list(ctx.tenantId, this.actor(ctx, r), { status: q.status, sellerUserId: q.sellerUserId, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((data) => ({ data }));
  }
  @Get('proposals/:id') @RequirePermissions(ShipmentPermissions.Manage)
  proposal(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.svc.get(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data }));
  }
  @Post('proposals') @RequirePermissions(ShipmentPermissions.Manage)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ProposeSchema) dto: z.infer<typeof ProposeSchema>) {
    return this.svc.propose(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }
  @Post('proposals/:id/withdraw') @RequirePermissions(ShipmentPermissions.Manage)
  withdraw(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: z.infer<typeof ReasonSchema>) {
    return this.svc.withdraw(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
}

/** The member's own proposals, answered in the app — the member's session is the only one the database lets decide. */
@Controller({ path: 'me/pickup-slot-proposals', version: '1' })
@UseGuards(AuthGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class MyPickupSlotProposalsController {
  constructor(private readonly svc: SlotProposalService) {}
  @Get()
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.mine(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post(':id/accept')
  accept(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.svc.decideInApp(ctx.tenantId, ctx.userId, idOf(id), 'accept', needKey(key)).then((data) => ({ data }));
  }
  @Post(':id/decline')
  decline(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(OptReasonSchema) dto: z.infer<typeof OptReasonSchema>) {
    return this.svc.decideInApp(ctx.tenantId, ctx.userId, idOf(id), 'decline', needKey(key), dto.reason ?? null).then((data) => ({ data }));
  }
}

/** The OTP link — no session. The proposal id is the link; the code sent to the member's own phone is the proof. */
@Controller({ path: 'pickup-slot-proposals', version: '1' })
@UseGuards(AuthGuard)
export class PickupSlotProposalLinkController {
  constructor(private readonly svc: SlotProposalService) {}
  @Public() @RateLimit({ limit: 30, windowSec: 60, by: 'ip' }) @Get(':id')
  view(@Param('id') id: string) { return this.svc.linkView(idOf(id)).then((data) => ({ data })); }
  @Public() @RateLimit({ limit: 5, windowSec: 60, by: 'ip' }) @Post(':id/code')
  code(@Param('id') id: string) { return this.svc.linkSendCode(idOf(id)).then((data) => ({ data })); }
  @Public() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post(':id/decide')
  decide(@Param('id') id: string, @ZodBody(LinkDecideSchema) dto: z.infer<typeof LinkDecideSchema>) {
    return this.svc.linkDecide(idOf(id), dto.code, dto.decision, dto.reason ?? null).then((data) => ({ data }));
  }
}

/* ───────────────────────────────── W232 · the Village Run ───────────────────────────────── */
@Controller({ path: 'logistics/village-run', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class VillageRunController {
  constructor(private readonly svc: VillageRunService) {}
  private actor(ctx: RequestContext, r: Request) { return { userId: ctx.userId, canManage: canManageLogistics(ctx), ip: ipOf(r) }; }

  @Get('routes/:routeId') @RequirePermissions(ShipmentPermissions.Manage)
  detail(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('routeId') routeId: string) {
    return this.svc.detail(ctx.tenantId, this.actor(ctx, r), idOf(routeId)).then((data) => ({ data }));
  }
  @Get('routes/:routeId/runs') @RequirePermissions(ShipmentPermissions.Manage)
  runs(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('routeId') routeId: string, @ZodQuery(PageSchema) q: z.infer<typeof PageSchema>) {
    return this.svc.runs(ctx.tenantId, this.actor(ctx, r), idOf(routeId), { cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((data) => ({ data }));
  }
  @Get('routes/:routeId/candidates') @RequirePermissions(ShipmentPermissions.Manage)
  candidates(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('routeId') routeId: string) {
    return this.svc.candidates(ctx.tenantId, this.actor(ctx, r), idOf(routeId)).then((data) => ({ data }));
  }
  @Post('routes/:routeId/drop-points') @RequirePermissions(ShipmentPermissions.Manage)
  addDropPoint(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('routeId') routeId: string, @Headers('idempotency-key') key: string, @ZodBody(DropPointSchema) dto: z.infer<typeof DropPointSchema>) {
    return this.svc.addDropPoint(ctx.tenantId, this.actor(ctx, r), idOf(routeId), needKey(key), dto).then((data) => ({ data }));
  }
  @Post('drop-points/:id/deactivate') @RequirePermissions(ShipmentPermissions.Manage)
  deactivateDropPoint(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: z.infer<typeof ReasonSchema>) {
    return this.svc.deactivateDropPoint(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post('routes/:routeId/runs') @RequirePermissions(ShipmentPermissions.Manage)
  draft(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('routeId') routeId: string, @Headers('idempotency-key') key: string, @ZodBody(DraftSchema) dto: z.infer<typeof DraftSchema>) {
    return this.svc.draft(ctx.tenantId, this.actor(ctx, r), idOf(routeId), needKey(key), dto).then((data) => ({ data }));
  }
  @Get('runs/:runId') @RequirePermissions(ShipmentPermissions.Manage)
  run(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string) {
    return this.svc.run(ctx.tenantId, this.actor(ctx, r), idOf(runId)).then((data) => ({ data }));
  }
  @Post('runs/:runId/acts/:act') @RequirePermissions(ShipmentPermissions.Manage)
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string, @Param('act') act: string, @Headers('idempotency-key') key: string, @ZodBody(RunActSchema) dto: z.infer<typeof RunActSchema>) {
    if (!(RUN_ACTS as readonly string[]).includes(act)) throw new BadRequestError(`act must be one of ${RUN_ACTS.join(', ')}`);
    return this.svc.act(ctx.tenantId, this.actor(ctx, r), idOf(runId), act as (typeof RUN_ACTS)[number], needKey(key), dto.reason ?? null).then((data) => ({ data }));
  }
  /* the driver at the drop point — a logistics manager, or the run's own rider (judged in the service) */
  @Post('runs/:runId/handovers/code')
  keeperCode(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string, @ZodBody(KeeperCodeSchema) dto: z.infer<typeof KeeperCodeSchema>) {
    return this.svc.sendKeeperCode(ctx.tenantId, this.actor(ctx, r), idOf(runId), dto.shipmentId).then((data) => ({ data }));
  }
  @Post('runs/:runId/handovers')
  handover(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string, @Headers('idempotency-key') key: string, @ZodBody(HandoverSchema) dto: z.infer<typeof HandoverSchema>) {
    return this.svc.recordHandover(ctx.tenantId, this.actor(ctx, r), idOf(runId), needKey(key), dto).then((data) => ({ data }));
  }
  /* the drop point's own ambassador */
  @Get('me/drop-point')
  keeperQueue(@CurrentContext() ctx: RequestContext) { return this.svc.keeperQueue(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post('handovers/:id/collect-code')
  collectCode(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.svc.sendCollectCode(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data }));
  }
  @Post('handovers/:id/collect')
  collect(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(CollectSchema) dto: z.infer<typeof CollectSchema>) {
    return this.svc.collect(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.code).then((data) => ({ data }));
  }
  @Post('handovers/:id/return')
  returnParcel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: z.infer<typeof ReasonSchema>) {
    return this.svc.returnParcel(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
}

/* ───────────────────────────────── the buyer's decision on a breach offer ───────────────────────────────── */
@Controller({ path: 'me/cold-chain-offers', version: '1' })
@UseGuards(AuthGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class MyColdChainOffersController {
  constructor(private readonly svc: ColdChainService) {}
  @Get()
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.buyerOffers(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post(':id/decision')
  decide(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(BuyerDecisionSchema) dto: BuyerDecisionDto) {
    return this.svc.decide(ctx.tenantId, ctx.userId, idOf(id), needKey(key), dto.decision, dto.reason ?? null).then((data) => ({ data }));
  }
}

/* ───────────────────────────────── the DEVICE ingest route ───────────────────────────────── */
@Controller({ path: 'ingest/cold-chain', version: '1' })
@UseGuards(AuthGuard)
export class ColdChainIngestController {
  constructor(private readonly svc: ColdChainIngestService) {}
  /** Signed per device (X-KV-Device · X-KV-Timestamp · X-KV-Nonce · X-KV-Signature over `${ts}.${nonce}.${raw body}`); kv_ingest only. */
  @Public() @RateLimit({ limit: 600, windowSec: 60, by: 'ip' }) @Post('readings')
  readings(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown, @Query() _q: unknown) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    return this.svc.ingest(req.headers as Record<string, string | string[] | undefined>, raw).then((data) => ({ data }));
  }
}
