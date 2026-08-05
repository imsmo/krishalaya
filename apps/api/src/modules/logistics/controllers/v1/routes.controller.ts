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
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { DeliveryRouteService } from '../../services/delivery-route.service';
import { ColdChainService } from '../../services/cold-chain.service';
import { CreateDeliveryRouteSchema, CreateDeliveryRouteDto, UpdateDeliveryRouteSchema, UpdateDeliveryRouteDto } from '../../dto/create-delivery-route.dto';
import { QueryDeliveryRouteSchema, QueryDeliveryRouteDto } from '../../dto/query-delivery-route.dto';
import { ZoneSetActiveSchema, ZoneSetActiveDto } from '../../dto/create-delivery-zone.dto';
import { RecordColdChainSchema, RecordColdChainDto, QueryColdChainSchema, QueryColdChainDto } from '../../dto/cold-chain.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'logistics/routes', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class RoutesController {
  constructor(private readonly routes: DeliveryRouteService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

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
  constructor(private readonly coldChain: ColdChainService, private readonly alerts: OpsAlertService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  @Post('readings') @RequirePermissions(ShipmentPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @ZodBody(RecordColdChainSchema) dto: RecordColdChainDto) {
    return this.coldChain.record(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
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
  @Get('breaches') @RequirePermissions(ShipmentPermissions.Manage)
  breaches(@CurrentContext() ctx: RequestContext, @Query('hours') hours?: string, @Query('limit') limit?: string) {
    return this.coldChain.breaches(ctx.tenantId, Number(hours) || 24, Number(limit) || 100).then((data) => ({ data }));
  }

  @Get('readings') @RequirePermissions(ShipmentPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryColdChainSchema) q: QueryColdChainDto) {
    return this.coldChain.listForSubject(ctx.tenantId, { ...q, cursor: decodeCursor(q.cursor) }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
