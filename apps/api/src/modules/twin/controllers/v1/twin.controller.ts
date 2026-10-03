// modules/twin/controllers/v1/twin.controller.ts · PC-56 TENANT-12 · THE DIGITAL TWIN over HTTP (W420 · W421 · W422 + chains).
//   • behind the `digital_twin` flag (Law 10 — OFF answers 404; the console's Locked page reads `GET /twin/access`, which is NOT
//     behind the flag — TwinAccessController);
//   • every route needs `twin.view` (tenant_admin, fpo_coordinator, tenant_staff); the writes are judged by the SERVICE on `twin.run`
//     / `twin.devices.manage`, so a refusal is a sentence (TWIN_REFUSED, every code by name), not a bare 403;
//   • `POST scenarios/:id/run` is permission-gated, keyed and audited, and answers 409 TWIN_NO_MODEL_REGISTERED naming the gate —
//     the refused attempt is recorded first (twin_runs). No route here returns a band;
//   • every write takes the Idempotency-Key its review / confirm page minted (Law 3); an auditor holds no `twin.view`.
import { Controller, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE, decodeKeyset } from '../../../../shared/pagination/us-keyset';
import { TwinActor, TwinService } from '../../services/twin.service';
import { TwinDevicesService } from '../../services/twin-devices.service';
import { ScenarioStatus } from '../../domain/twin-scenario.state';
import {
  AssumptionsDto, AssumptionsSchema, DeviceInputDto, DeviceInputSchema, EmptySchema, QueryDevicesDto, QueryDevicesSchema, QueryResultsDto, QueryResultsSchema,
  QueryScenariosDto, QueryScenariosSchema, ReasonDto, ReasonSchema, ScenarioInputDto, ScenarioInputSchema,
} from '../../dto/twin.dto';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const actOf = (a: string): 'run' | 'archive' => { if (a !== 'run' && a !== 'archive') throw new BadRequestError(`'${a}' is not a scenario act (run, archive)`); return a; };

@Controller({ path: 'twin', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('digital_twin')
@RequirePermissions('twin.view')
export class TwinController {
  constructor(private readonly svc: TwinService, private readonly devices: TwinDevicesService) {}
  private actor(ctx: RequestContext, req: Request): TwinActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null }; }

  /** W420 — the ground truth: measured facts with their source and as-of; refusals by name. */
  @Get('overview')
  overview(@CurrentContext() ctx: RequestContext, @Req() req: Request) { return this.svc.overview(ctx.tenantId, this.actor(ctx, req)).then((data) => ({ data })); }

  /** The forms' vocabulary: keys + units + bounds, templates (keys, no values), device kinds, the aggregate floor, the model state. */
  @Get('catalogue')
  catalogue(@CurrentContext() ctx: RequestContext, @Req() req: Request) { return this.svc.catalogue(ctx.tenantId, this.actor(ctx, req)).then((data) => ({ data })); }

  /** W421 — the scenario list (µs keyset), counts per status, each scenario's attempts and results cell. */
  @Get('scenarios')
  list(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(QueryScenariosSchema) q: QueryScenariosDto) {
    return this.svc.listScenarios(ctx.tenantId, this.actor(ctx, req), { status: q.status as ScenarioStatus | undefined, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((data) => ({ data }));
  }
  /** W2801 — the scenario review (read-only). */
  @Post('scenarios/preview')
  previewScenario(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(ScenarioInputSchema) dto: ScenarioInputDto) {
    return this.svc.previewScenario(ctx.tenantId, this.actor(ctx, req), dto).then((data) => ({ data }));
  }
  /** W2802 — create from a template (keyed; audited). */
  @Post('scenarios')
  create(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(ScenarioInputSchema) dto: ScenarioInputDto) {
    return this.svc.createScenario(ctx.tenantId, this.actor(ctx, req), needKey(key), dto).then((data) => ({ data }));
  }
  @Get('scenarios/:id')
  get(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string) { return this.svc.scenario(ctx.tenantId, this.actor(ctx, req), idOf(id)).then((data) => ({ data })); }

  /** W2800 / W2801 — the assumptions review: every refusal by field; citation + as-of required for every value. */
  @Post('scenarios/:id/assumptions/preview')
  previewAssumptions(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @ZodBody(AssumptionsSchema) dto: AssumptionsDto) {
    return this.svc.previewAssumptions(ctx.tenantId, this.actor(ctx, req), idOf(id), dto.assumptions).then((data) => ({ data }));
  }
  /** W2802 — save the assumptions (keyed; history by trigger; audited before/after). */
  @Put('scenarios/:id/assumptions')
  saveAssumptions(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(AssumptionsSchema) dto: AssumptionsDto) {
    return this.svc.saveAssumptions(ctx.tenantId, this.actor(ctx, req), idOf(id), needKey(key), dto.assumptions).then((data) => ({ data }));
  }
  /** W2804 — the verdict at confirm (read-only): run (the gate's answer stated in advance) · archive. */
  @Post('scenarios/:id/acts/:act/preview')
  previewAct(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @Param('act') act: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.svc.previewAct(ctx.tenantId, this.actor(ctx, req), idOf(id), actOf(act), dto.reason).then((data) => ({ data }));
  }
  /** W2805 / W2806 — THE RUN: recorded, audited, and refused 409 TWIN_NO_MODEL_REGISTERED (the gate, by name). */
  @Post('scenarios/:id/run')
  run(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(EmptySchema) _dto: Record<string, never>) {
    return this.svc.run(ctx.tenantId, this.actor(ctx, req), idOf(id), needKey(key));
  }
  /** Archive with a reason (keyed; audited; final). */
  @Post('scenarios/:id/archive')
  archive(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.svc.archive(ctx.tenantId, this.actor(ctx, req), idOf(id), needKey(key), dto.reason ?? '').then((data) => ({ data }));
  }

  /** W422 — the pair: every band cell "too few runs — no registered model"; the one measured fact; "no run to cite". */
  @Get('results')
  results(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(QueryResultsSchema) q: QueryResultsDto) {
    return this.svc.results(ctx.tenantId, this.actor(ctx, req), q.a, q.b).then((data) => ({ data }));
  }

  /** The device registry (registry only — readings refused by name). */
  @Get('devices')
  listDevices(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodQuery(QueryDevicesSchema) q: QueryDevicesDto) {
    return this.devices.list(ctx.tenantId, this.actor(ctx, req), { kind: q.kind, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }).then((data) => ({ data }));
  }
  @Post('devices')
  registerDevice(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DeviceInputSchema) dto: DeviceInputDto) {
    return this.devices.register(ctx.tenantId, this.actor(ctx, req), needKey(key), dto).then((data) => ({ data }));
  }
  @Post('devices/:id/retire')
  retireDevice(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) dto: ReasonDto) {
    return this.devices.retire(ctx.tenantId, this.actor(ctx, req), idOf(id), needKey(key), dto.reason ?? '').then((data) => ({ data }));
  }
}
