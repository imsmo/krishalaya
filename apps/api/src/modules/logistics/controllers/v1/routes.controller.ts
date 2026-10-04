// modules/logistics/controllers/v1/routes.controller.ts · Village Run routes + cold-chain telemetry
// (validate→authorize→delegate, no logic). All writes need logistics.manage; gated by the `logistics` flag.
// Route creates require an Idempotency-Key; cold-chain readings are append-only (idempotency unnecessary — each
// reading is a distinct timestamped fact). Lists are keyset/bounded.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards, Query } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { OpsAlertService } from '../../services/ops-alert.service';
import { ALERT_KINDS } from '../../domain/ops-alert.rules';
import { z } from 'zod';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics, canManageColdChainDevices, DEVICES_MANAGE } from '../../policies/logistics.policies';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { ExportPlaneService } from '../../../../core/exports-plane/export-plane.service';
import { COLD_BREACHES_DATASET, COLD_TRAIL_DATASET } from '../../exports/cold-chain.datasets';
import { BREACH_ACTS } from '../../domain/logistics-ops';
import { COLD_CHAIN_SUBJECTS } from '../../domain/cold-chain-log.entity';
import { DeliveryRouteService } from '../../services/delivery-route.service';
import { ColdChainService } from '../../services/cold-chain.service';
import { ApproveDeliveryRouteSchema, ApproveDeliveryRouteDto, CreateDeliveryRouteSchema, CreateDeliveryRouteDto, UpdateDeliveryRouteSchema, UpdateDeliveryRouteDto } from '../../dto/create-delivery-route.dto';
import { QueryDeliveryRouteSchema, QueryDeliveryRouteDto, QueryRouteBoardSchema, QueryRouteBoardDto } from '../../dto/query-delivery-route.dto';
import { RouteBoardReadModel } from '../../read-models/route-board.read-model';
import { ZoneSetActiveSchema, ZoneSetActiveDto } from '../../dto/create-delivery-zone.dto';
import {
  RecordColdChainSchema, RecordColdChainDto, QueryColdChainSchema, QueryColdChainDto, ThresholdSchema, ThresholdDto, SubjectQuerySchema, SubjectQueryDto,
  BreachListSchema, BreachListDto, BreachActSchema, BreachActDto, RegisterLoggerSchema, RegisterLoggerDto, IssueKeySchema, IssueKeyDto, RevokeKeySchema,
  ColdExportTrailSchema, ColdExportTrailParams, ColdExportBreachesSchema, ColdExportBreachesParams,
} from '../../dto/cold-chain.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/routes', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class RoutesController {
  constructor(private readonly routes: DeliveryRouteService, private readonly board: RouteBoardReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  /**
   * **W231's board (PC-56 TENANT-5b)** — routes with resolved village names, the consolidation point's name and
   * tier, measured parcels per run, and the economics with the route side named as unrecorded.
   *
   * Declared before `:id` so the literal path wins. `logistics.manage`: the board carries a named person's
   * weekly commitment and the FPO's own delivery spend.
   */
  @Get('board') @RequirePermissions(ShipmentPermissions.Manage)
  routeBoard(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRouteBoardSchema) q: QueryRouteBoardDto) {
    return this.board.board(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, counts: res.counts, windowDays: res.windowDays } }));
  }

  /** W231's empty state offers a "Suggest routes" tool that does not exist. This is its honest ingredient: the
   *  corridors the tenant's parcels already travel. It creates nothing — a grouping query must not commit a
   *  vehicle and a named ambassador's day. */
  @Get('corridors') @RequirePermissions(ShipmentPermissions.Manage)
  corridors(@CurrentContext() ctx: RequestContext) {
    return this.board.corridors(ctx.tenantId).then((res) => ({ data: res.items, meta: { verdict: res.verdict } }));
  }

  @Post() @RequirePermissions(ShipmentPermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateDeliveryRouteSchema) dto: CreateDeliveryRouteDto) {
    return this.routes.create(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDeliveryRouteSchema) q: QueryDeliveryRouteDto) {
    return this.routes.list(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.routes.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id') @RequirePermissions(ShipmentPermissions.Manage)
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateDeliveryRouteSchema) dto: UpdateDeliveryRouteDto) {
    return this.routes.update(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/active') @RequirePermissions(ShipmentPermissions.Manage)
  setActive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ZoneSetActiveSchema) dto: ZoneSetActiveDto) {
    return this.routes.setActive(ctx.tenantId, this.actor(ctx), id, dto.isActive, ipOf(r)).then((data) => ({ data }));
  }

  /**
   * **W231's [Approve route] (PC-56 TENANT-5b).** Idempotency-Key required — approving twice must not write two
   * approvals, and a double-tapped button on a village network is the normal case.
   *
   * The refusals come back by name (`ROUTE_NOT_APPROVABLE` + `reason`) so the console can print which commitment
   * is missing rather than "incomplete".
   */
  @Post(':id/approve') @RequirePermissions(ShipmentPermissions.Manage)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string,
          @ZodBody(ApproveDeliveryRouteSchema) dto: ApproveDeliveryRouteDto) {
    return this.routes.approve(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}

const CreateAlertRuleSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  ruleName: z.string().trim().min(3).max(150),
  threshold: z.record(z.unknown()).optional(),          // validated PER KIND in the service (typos rejected)
  recipientUserIds: z.array(z.string().uuid()).min(1).max(50),
  channelHint: z.enum(['push', 'sms', 'whatsapp', 'email', 'inapp']).optional(),
  cooldownMinutes: z.number().int().min(5).max(10080).optional(),
}).strict();
const UpdateAlertRuleSchema = z.object({
  ruleName: z.string().trim().min(3).max(150).optional(),
  threshold: z.record(z.unknown()).optional(),
  recipientUserIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  channelHint: z.enum(['push', 'sms', 'whatsapp', 'email', 'inapp']).nullable().optional(),
  cooldownMinutes: z.number().int().min(5).max(10080).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'at least one field' });

@Controller({ path: 'logistics/cold-chain', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class ColdChainController {
  constructor(private readonly coldChain: ColdChainService, private readonly alerts: OpsAlertService, private readonly exportsPlane: ExportPlaneService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }
  private coldActor(ctx: RequestContext, r: Request) { return { userId: ctx.userId, canManage: canManageLogistics(ctx), canManageDevices: canManageColdChainDevices(ctx), ip: ipOf(r) }; }

  /** A MANUAL reading — PC-56 TENANT-SW-e: no band, no time in the body (the strict DTO refuses `allowedMinC/MaxC/recordedAt`); the
   *  band is copied from the threshold store and the time is the server's; labelled manual; never opens a breach. */
  @Post('readings') @RequirePermissions(ShipmentPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @ZodBody(RecordColdChainSchema) dto: RecordColdChainDto) {
    return this.coldChain.record(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }

  // ── PC-56 TENANT-SW-e · W234 / W239 / W240 / W2534–W2538 ──
  @Post('thresholds') @RequirePermissions(ShipmentPermissions.Manage)
  setThreshold(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ThresholdSchema) dto: ThresholdDto) {
    return this.coldChain.setThreshold(ctx.tenantId, this.coldActor(ctx, r), reqKey(key), dto).then((data) => ({ data }));
  }
  @Get('subjects') @RequirePermissions(ShipmentPermissions.Manage)
  subjects(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return this.coldChain.overview(ctx.tenantId, this.coldActor(ctx, r)).then((data) => ({ data })); }
  @Get('subjects/:type/:id') @RequirePermissions(ShipmentPermissions.Manage)
  subject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('type') type: string, @Param('id') id: string, @ZodQuery(SubjectQuerySchema) q: SubjectQueryDto) {
    if (!(COLD_CHAIN_SUBJECTS as readonly string[]).includes(type) || !UUID_RE.test(id)) throw new BadRequestError('subject type and id');
    return this.coldChain.subject(ctx.tenantId, this.coldActor(ctx, r), type as (typeof COLD_CHAIN_SUBJECTS)[number], id, { hours: q.hours, cursor: decodeCursor(q.cursor), limit: q.limit }).then((data) => ({ data }));
  }
  @Get('breaches/:id') @RequirePermissions(ShipmentPermissions.Manage)
  breach(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.coldChain.breach(ctx.tenantId, this.coldActor(ctx, r), id).then((data) => ({ data }));
  }
  @Post('breaches/:id/acts/:act') @RequirePermissions(ShipmentPermissions.Manage)
  breachAct(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Param('act') act: string, @Headers('idempotency-key') key: string, @ZodBody(BreachActSchema) dto: BreachActDto) {
    if (!UUID_RE.test(id) || !(BREACH_ACTS as readonly string[]).includes(act)) throw new BadRequestError(`act must be one of ${BREACH_ACTS.join(', ')}`);
    return this.coldChain.act(ctx.tenantId, this.coldActor(ctx, r), id, reqKey(key), act as (typeof BREACH_ACTS)[number], dto).then((data) => ({ data }));
  }
  @Get('loggers') @RequirePermissions(ShipmentPermissions.Manage)
  loggers(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return this.coldChain.loggers(ctx.tenantId, this.coldActor(ctx, r)).then((data) => ({ data })); }
  @Post('loggers') @RequirePermissions(DEVICES_MANAGE)
  registerLogger(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(RegisterLoggerSchema) dto: RegisterLoggerDto) {
    return this.coldChain.registerLogger(ctx.tenantId, this.coldActor(ctx, r), reqKey(key), dto).then((data) => ({ data }));
  }
  /** The signing key, SHOWN ONCE in this response (a replay answers `key: null`). */
  @Post('loggers/:id/keys') @RequirePermissions(DEVICES_MANAGE)
  issueKey(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(IssueKeySchema) dto: IssueKeyDto) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.coldChain.issueKey(ctx.tenantId, this.coldActor(ctx, r), id, reqKey(key), dto).then((data) => ({ data }));
  }
  @Post('loggers/:id/keys/revoke') @RequirePermissions(DEVICES_MANAGE)
  revokeKey(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(RevokeKeySchema) dto: { reason: string }) {
    if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid');
    return this.coldChain.revokeKey(ctx.tenantId, this.coldActor(ctx, r), id, reqKey(key), dto.reason).then((data) => ({ data }));
  }
  /** W2534: the trail of one subject on the 6e-2 export plane — UNSIGNED, and the receipt says so. */
  @Post('exports/trail') @RequirePermissions(ShipmentPermissions.Manage)
  exportTrail(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ColdExportTrailSchema) body: ColdExportTrailParams) {
    return this.exportsPlane.enqueue(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions }, reqKey(key), { datasetCode: COLD_TRAIL_DATASET, params: body }, ipOf(r)).then((data) => ({ data }));
  }
  @Post('exports/breaches') @RequirePermissions(ShipmentPermissions.Manage)
  exportBreaches(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ColdExportBreachesSchema) body: ColdExportBreachesParams) {
    return this.exportsPlane.enqueue(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions }, reqKey(key), { datasetCode: COLD_BREACHES_DATASET, params: body }, ipOf(r)).then((data) => ({ data }));
  }
  // --- PC-55 A6 `ops-alert-rules`: rules CRUD + fired feed. Firing goes through the EXISTING notification
  // spine (one outbox event) — this module adds no delivery channel and cannot bypass quiet hours. ---
  @Post('alert-rules') @RequirePermissions(ShipmentPermissions.Manage)
  createAlertRule(@CurrentContext() ctx: RequestContext, @ZodBody(CreateAlertRuleSchema) dto: z.infer<typeof CreateAlertRuleSchema>) {
    return this.alerts.createRule(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  @Get('alert-rules') @RequirePermissions(ShipmentPermissions.Manage)
  alertRules(@CurrentContext() ctx: RequestContext, @Query('kind') kind?: string, @Query('activeOnly') activeOnly?: string) {
    return this.alerts.rules(ctx.tenantId, this.actor(ctx), { kind, activeOnly: activeOnly === 'true' }).then((data) => ({ data }));
  }
  @Patch('alert-rules/:id') @RequirePermissions(ShipmentPermissions.Manage)
  updateAlertRule(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateAlertRuleSchema) dto: z.infer<typeof UpdateAlertRuleSchema>) {
    return this.alerts.updateRule(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get('alerts/feed') @RequirePermissions(ShipmentPermissions.Manage)
  alertFeed(@CurrentContext() ctx: RequestContext, @Query('kind') kind?: string, @Query('severity') severity?: string, @Query('unacknowledgedOnly') un?: string, @Query('limit') limit?: string) {
    return this.alerts.feed(ctx.tenantId, this.actor(ctx), { kind, severity, unacknowledgedOnly: un === 'true', limit: Number(limit) || 100 }).then((data) => ({ data }));
  }
  @Post('alerts/:id/acknowledge') @RequirePermissions(ShipmentPermissions.Manage)
  acknowledgeAlert(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.alerts.acknowledge(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }
  /** "Run now" — so an operator can test a rule they just wrote instead of waiting for the cadence. */
  @Post('alert-rules/evaluate') @RequirePermissions(ShipmentPermissions.Manage)
  evaluateNow(@CurrentContext() ctx: RequestContext) {
    return this.alerts.evaluateTenant(ctx.tenantId, ctx.userId).then((data) => ({ data }));
  }

  // PC-54 W54-12: iot-device-fleet + ops-alerting v1 (read-models over the ledgered readings).
  @Get('devices') @RequirePermissions(ShipmentPermissions.Manage)
  devices(@CurrentContext() ctx: RequestContext) { return this.coldChain.deviceFleet(ctx.tenantId).then((data) => ({ data })); }
  /** W240 (PC-56 TENANT-SW-e): every BREACH (two consecutive device readings out of band) for 12 months, µs keyset; `hours` kept for
   *  the older reader and narrows the window. `meta.window` carries the counts, the median alert → action (or refused), the recorded loss. */
  @Get('breaches') @RequirePermissions(ShipmentPermissions.Manage)
  breaches(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(BreachListSchema) q: BreachListDto) {
    return this.coldChain.breaches(ctx.tenantId, this.coldActor(ctx, r), { hours: q.hours, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, window: res.window, refused: res.refused } }));
  }

  @Get('readings') @RequirePermissions(ShipmentPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryColdChainSchema) q: QueryColdChainDto) {
    return this.coldChain.listForSubject(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
