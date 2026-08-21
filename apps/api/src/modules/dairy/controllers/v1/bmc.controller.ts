// modules/dairy/controllers/v1/bmc.controller.ts · PC-56 TENANT-6d-1 · W170's routes.
//
// `bmc_units` has been in the schema since 0009 with **no route of any kind**. These are the first: the monitor, the
// register, the four acts on a cooler, and the reading stream.
//
// TWO THINGS ABOUT THE PERMISSIONS, both deliberate:
//   • every route is `dairy.manage` — the cooperative's own desk. The platform's fleet permission (`logistics.manage`)
//     guards logistics' own cold-chain route, and requiring it here would mean nobody at the dairy could switch on the
//     monitoring of their own tank;
//   • the READING route is `dairy.manage` too, not public. A device posts with the cooperative's credentials, which is
//     how every other write on this platform works; an unauthenticated telemetry endpoint is a way to write somebody
//     else's temperature history, and W170's whole value is that the numbers on it are trustworthy.
//
// `@Get('monitor')` IS DECLARED BEFORE `@Get(':id')` — Nest matches in declaration order, and the parameterised route
// would otherwise answer the screen with "BMC unit 'monitor' not found". The same trap TENANT-6c-6 documented on the
// cycle console, asserted the same way.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { BmcUnitService } from '../../services/bmc-unit.service';
import { BmcReadingService } from '../../services/bmc-reading.service';
import { DairyBmcReadModel, BMC_MONITOR_FLAG } from '../../read-models/dairy-bmc.read-model';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';
import {
  QueryBmcMonitorSchema, QueryBmcMonitorDto, QueryBmcUnitsSchema, QueryBmcUnitsDto,
  RegisterBmcSchema, RegisterBmcDto, ReportBmcLevelSchema, ReportBmcLevelDto,
  RecordBmcReadingSchema, RecordBmcReadingDto, SetBmcBandSchema, SetBmcBandDto,
  StateCompressorSchema, StateCompressorDto,
  // PC-56 TENANT-6d-5 · the call
  CallBmcOperatorSchema, CallBmcOperatorDto, PreviewBmcCallSchema, PreviewBmcCallDto,
} from '../../dto/bmc.dto';
import { CompressorState } from '../../domain/bmc-unit.entity';
import { PreviewBmcDto, PreviewBmcSchema } from '../../dto/dairy-form-preview.dto';
import { BmcCallService } from '../../services/bmc-call.service';
import { BMC_CALL_FLAG } from '../../domain/bmc-call.flags';

/** Same one-liner as every other dairy controller: the caller's IP for the audit row, and nothing else read off the
 *  request object. */
const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/bmc', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
// TWO FLAGS, BOTH REQUIRED (TENANT-6d-2 made them compose instead of overriding): a cooperative that is not
// licensed for the dairy module must not have BMC routes, and a cooperative that is must still be able to switch
// the monitor off on its own. Before the guard fix a screen flag CANCELLED its controller's flag, so this line
// naming only the monitor left the tank routes live on a module that was switched off.
@FeatureFlag('dairy', BMC_MONITOR_FLAG)
export class BmcController {
  constructor(
    private readonly units: BmcUnitService,
    private readonly readings: BmcReadingService,
    private readonly monitor: DairyBmcReadModel,
    // PC-56 TENANT-6d-5 · W170's call, W2521–W2523's chain.
    private readonly callSvc: BmcCallService,
  ) {}

  /**
   * No act on a cooler needs `settlement.close` — a tank's band moves no money — but the key is carried anyway, because
   * TENANT-6c-3's rule is that **every** dairy controller resolves the whole actor rather than the subset it happens to
   * read today. A controller that omits a key is one route away from gating on a decorator that the service never sees.
   */
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  /** W170 itself. DECLARED FIRST — see the header. */
  @Get('monitor') @RequirePermissions(DairyPermissions.Manage)
  view(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBmcMonitorSchema) q: QueryBmcMonitorDto) {
    return this.monitor.view(ctx.tenantId, this.actor(ctx), { unitId: q.unitId, hours: q.hours }).then((data) => ({ data }));
  }

  @Get() @RequirePermissions(DairyPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBmcUnitsSchema) q: QueryBmcUnitsDto) {
    return this.units.list(ctx.tenantId, this.actor(ctx), { mccId: q.mccId, includeRetired: q.includeRetired }).then((data) => ({ data }));
  }

  @Get(':id') @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.units.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /**
   * [PC-56 TENANT-6d-4 · W2518] The REVIEW step for *"Add BMC"*.
   *
   * Declared before every other POST so no parameterised route can swallow it, and it writes nothing: it answers what
   * `register` would write and every reason `register` would refuse, from the same facts and by the same function. A
   * review that says *"ready"* and is followed by W2520 is the defect this route exists to prevent.
   *
   * ITS BODY SCHEMA IS THE LENIENT ONE, on purpose: `RegisterBmcSchema` would answer a mistyped centre id with a
   * validator's 400 instead of *"no centre of this cooperative has that id"*, and its tolerance regex forbids a minus
   * sign, so `TOLERANCE_NEGATIVE` could never be reached. The review reports what the create schema would refuse
   * (`writerIssues`) rather than being replaced by it.
   */
  @Post('preview') @RequirePermissions(DairyPermissions.Manage)
  previewRegister(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewBmcSchema) dto: PreviewBmcDto) {
    return this.units.previewRegister(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }

  /**
   * [PC-56 TENANT-6d-5 · W2521] The CONFIRM step for *"Call MCC-AND-03 operator"*.
   *
   * Declared with the other literal POSTs, above anything parameterised. Writes nothing and dials nothing: it answers
   * the object under review and every reason the call would be refused, by the same function `call` uses.
   *
   * Behind `dairy_bmc_call` — its own flag, composing with the module's and the monitor's (TENANT-6d-2's guard fix), so
   * a cooperative can switch off a button that rings a person without switching off the alarm that pages them.
   */
  @Post('call/preview') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(BMC_CALL_FLAG)
  previewCall(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewBmcCallSchema) dto: PreviewBmcCallDto) {
    return this.callSvc.preview(ctx.tenantId, this.actor(ctx), dto.unitId, dto.reason ?? '').then((data) => ({ data }));
  }

  /** The act W170's *"No BMC units → Add BMC"* points at (chain screens W2517–W2520). */
  @Post() @RequirePermissions(DairyPermissions.Manage)
  register(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RegisterBmcSchema) dto: RegisterBmcDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.units.register(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }

  /**
   * [PC-56 TENANT-6d-5 · W170] *"Call MCC-AND-03 operator"* — a number-masked call to whoever holds this centre.
   *
   * An Idempotency-Key is REQUIRED and passed straight through to the masked-call service: a village tablet retrying a
   * dropped request must not ring an operator twice. This is the one act on this controller that reaches a person's
   * phone, which is also why it carries its own flag.
   */
  @Post(':id/call') @RequirePermissions(DairyPermissions.Manage) @FeatureFlag(BMC_CALL_FLAG)
  call(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
       @Param('id') id: string, @ZodBody(CallBmcOperatorSchema) dto: CallBmcOperatorDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.callSvc.place(ctx.tenantId, this.actor(ctx), key, id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }

  /** What "cold enough" means for this tank. A policy change, audited before and after. */
  @Post(':id/band') @RequirePermissions(DairyPermissions.Manage)
  band(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(SetBmcBandSchema) dto: SetBmcBandDto) {
    return this.units.setBand(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }

  /** *"41% full"*. */
  @Post(':id/level') @RequirePermissions(DairyPermissions.Manage)
  level(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReportBmcLevelSchema) dto: ReportBmcLevelDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.units.reportLevel(ctx.tenantId, this.actor(ctx), id, key, dto).then((data) => ({ data }));
  }

  /** Somebody's word about the machine — never inferred from the milk being cold. */
  @Post(':id/compressor') @RequirePermissions(DairyPermissions.Manage)
  compressor(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(StateCompressorSchema) dto: StateCompressorDto) {
    return this.units.stateCompressor(ctx.tenantId, this.actor(ctx), id, { state: dto.state as CompressorState }).then((data) => ({ data }));
  }

  /** The cooler is gone (chain screens W2521–W2523: the confirm, the success, the failure). */
  @Post(':id/retire') @RequirePermissions(DairyPermissions.Manage)
  retire(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.units.retire(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /**
   * THE STREAM. The first door a `bmc_unit` temperature has ever had.
   *
   * No Idempotency-Key: a temperature series is append-only by nature and two readings a second apart are two facts,
   * not a retry — `cold_chain_logs` has no natural key to collapse them onto, and inventing one (device + minute) would
   * silently drop a genuine second reading during exactly the minute a tank is warming fastest. The band is read from
   * the tank, so a caller cannot declare its own definition of a breach.
   */
  @Post('readings') @RequirePermissions(DairyPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @ZodBody(RecordBmcReadingSchema) dto: RecordBmcReadingDto) {
    return this.readings.record(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
}
