// modules/disputes/controllers/v1/disputes.controller.ts · dispute lifecycle (validate→authorize→
// delegate). Raise needs dispute.raise + Idempotency-Key (eligibility enforced in the service); respond/
// withdraw are party actions; review/escalate/resolve need dispute.resolve. Threaded evidence via
// messages. Party-vs-party authority is enforced per-row. Gated by the `disputes` feature flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DisputeService } from '../../services/dispute.service';
import { CreateDisputeSchema, CreateDisputeDto } from '../../dto/create-dispute.dto';
import { ResolveDisputeSchema, ResolveDisputeDto } from '../../dto/update-dispute.dto';
import { CreateDisputeMessageSchema, CreateDisputeMessageDto } from '../../dto/create-dispute-message.dto';
import { QueryDisputesSchema, QueryDisputesDto } from '../../dto/query-dispute.dto';
import { QueryDisputeMessagesSchema, QueryDisputeMessagesDto } from '../../dto/query-dispute-message.dto';
import { DisputePermissions, canModerateDispute, canRefund } from '../../policies/disputes.policies';
import { DisputeConsoleReadModel } from '../../read-models/dispute-console.read-model';
import {
  QueryDisputeConsoleSchema, QueryDisputeConsoleDto, RefundStateQuerySchema, RefundStateQueryDto,
  parseDisputeCursor, buildDisputeCursor,
} from '../../dto/query-dispute-console.dto';
import { DisputeView } from '../../domain/dispute-console';
import { disputeMoneyState } from '../../domain/dispute-money-state';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'disputes', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputeService, private readonly console: DisputeConsoleReadModel) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModerateDispute(ctx), canRefund: canRefund(ctx) }; }

  @Post() @RequirePermissions(DisputePermissions.Raise)
  raise(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateDisputeSchema) dto: CreateDisputeDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.disputes.raise(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDisputesSchema) q: QueryDisputesDto) {
    return this.disputes.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** W140's four KPI cards + tab counts. `dispute.resolve` only — these are tenant-wide figures, not one party's
   *  own cases, and a buyer must not learn how often this FPO loses disputes. */
  @Get('console/kpis') @RequirePermissions(DisputePermissions.Resolve)
  kpis(@CurrentContext() ctx: RequestContext) {
    return Promise.all([this.console.kpis(ctx.tenantId), this.console.viewCounts(ctx.tenantId)])
      .then(([kpis, counts]) => ({ data: { kpis, counts } }));
  }

  /** W140's table: one tab at a time, keyset only. */
  @Get('console/list') @RequirePermissions(DisputePermissions.Resolve)
  consoleList(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDisputeConsoleSchema) q: QueryDisputeConsoleDto) {
    return this.console.queue(ctx.tenantId, { view: q.view as DisputeView | undefined, cursor: parseDisputeCursor(q.cursor), limit: q.limit })
      .then((rows) => ({
        data: rows,
        meta: { nextCursor: rows.length === q.limit && rows.length > 0 ? buildDisputeCursor(rows[rows.length - 1]) : null },
      }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.disputes.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  /** W141's money card. **THE ONE SURFACE THAT MUST NOT REPEAT THE CANON'S SENTENCE**: it reports what the platform
   *  actually holds and states that the undisputed remainder is held too (see domain/dispute-money-state.ts). */
  @Get(':id/money')
  money(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.disputes.getById(ctx.tenantId, this.actor(ctx), id).then(async () => {
      const f = await this.console.moneyFacts(ctx.tenantId, id);
      if (!f) return { data: null };
      const view = disputeMoneyState({
        paymentGrossMinor: f.paymentGrossMinor == null ? null : BigInt(f.paymentGrossMinor),
        settled: !!f.settled,
        disputedAmountMinor: f.disputedAmountMinor == null ? null : BigInt(f.disputedAmountMinor),
        disputedQuantity: f.disputedQuantity,
      });
      return {
        data: {
          orderId: f.orderId, orderNo: f.orderNo, currencyCode: f.currencyCode,
          basis: view.basis,
          heldMinor: view.heldMinor?.toString() ?? null,
          disputedMinor: view.scope.kind === 'recorded' ? view.scope.amountMinor.toString() : null,
          disputedQuantity: view.scope.kind === 'recorded' ? view.scope.quantity : null,
          scopeRecorded: view.scope.kind === 'recorded',
          undisputedMinor: view.undisputedMinor?.toString() ?? null,
          undisputedHeldToo: view.undisputedHeldToo,
          maxRefundableMinor: view.maxRefundableMinor?.toString() ?? null,
          resolutionAmountMinor: f.resolutionAmountMinor, resolutionTxnId: f.resolutionTxnId,
        },
      };
    });
  }

  /** The refund gate as a READ, so the console can show "needs a checker" before anybody presses anything. */
  @Get(':id/refund-state') @RequirePermissions(DisputePermissions.Resolve)
  refundState(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(RefundStateQuerySchema) q: RefundStateQueryDto) {
    return this.disputes.refundState(ctx.tenantId, this.actor(ctx), id, BigInt(q.amountMinor)).then((data) => ({ data }));
  }

  @Post(':id/respond')
  respond(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.disputes.respond(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/withdraw')
  withdraw(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.disputes.withdraw(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/messages')
  postMessage(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(CreateDisputeMessageSchema) dto: CreateDisputeMessageDto) {
    return this.disputes.postMessage(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get(':id/messages')
  listMessages(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryDisputeMessagesSchema) q: QueryDisputeMessagesDto) {
    return this.disputes.listMessages(ctx.tenantId, this.actor(ctx), id, { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Post(':id/review') @RequirePermissions(DisputePermissions.Resolve)
  review(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.disputes.startReview(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }

  @Post(':id/escalate') @RequirePermissions(DisputePermissions.Resolve)
  escalate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.disputes.escalate(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data })); }

  @Post(':id/resolve') @RequirePermissions(DisputePermissions.Resolve)
  resolve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ResolveDisputeSchema) dto: ResolveDisputeDto) {
    return this.disputes.resolve(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
