// modules/disputes/controllers/v1/refund-approvals.controller.ts · the refund maker-checker plane (PC-56 TENANT-3b).
// validate → authorize → delegate. PROPOSING needs `dispute.resolve` (the person working the case states the figure);
// DECIDING needs `order.refund` — the money key 0139 seeds for the first time — and the service refuses a checker who
// is the proposer (0139's CHECK says the same thing one layer down). Gated by the `disputes` feature flag.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { RefundApprovalService } from '../../services/refund-approval.service';
import {
  ProposeRefundSchema, ProposeRefundDto, DecideRefundSchema, DecideRefundDto,
  QueryRefundApprovalsSchema, QueryRefundApprovalsDto,
} from '../../dto/refund-approval.dto';
import { RefundSubject } from '../../domain/refund-gate';
import { DisputePermissions, canModerateDispute, canRefund } from '../../policies/disputes.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'refund-approvals', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('disputes')
export class RefundApprovalsController {
  constructor(private readonly approvals: RefundApprovalService) {}
  private actor(ctx: RequestContext) {
    return { userId: ctx.userId, canResolve: canModerateDispute(ctx), canRefund: canRefund(ctx) };
  }

  /** The maker's proposal. `dispute.resolve` only — a support agent may ask for a refund they cannot execute. */
  @Post() @RequirePermissions(DisputePermissions.Resolve)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(ProposeRefundSchema) dto: ProposeRefundDto) {
    return this.approvals.propose(ctx.tenantId, this.actor(ctx), {
      subjectType: dto.subjectType as RefundSubject, subjectId: dto.subjectId,
      amountMinor: BigInt(dto.amountMinor), resolutionType: dto.resolutionType ?? null, note: dto.note,
    }, ipOf(r)).then((data) => ({ data }));
  }

  /** The checker's signature or refusal. `order.refund`, and never the same human as the proposer. */
  @Post(':id/decision') @RequirePermissions(DisputePermissions.Refund)
  decide(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DecideRefundSchema) dto: DecideRefundDto) {
    return this.approvals.decide(ctx.tenantId, this.actor(ctx), id, dto.decision, dto.note ?? null, ipOf(r)).then((data) => ({ data }));
  }

  /** The checker queue — oldest first, keyset, never a page number. */
  @Get() @RequirePermissions(DisputePermissions.Resolve)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRefundApprovalsSchema) q: QueryRefundApprovalsDto) {
    return this.approvals.listPending(ctx.tenantId, this.actor(ctx), { cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** One case's approval history — what was asked, by whom, and what the checker said. */
  @Get(':subjectType/:subjectId') @RequirePermissions(DisputePermissions.Resolve)
  history(@CurrentContext() ctx: RequestContext, @Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    const st: RefundSubject = subjectType === 'return' ? 'return' : 'dispute';
    return this.approvals.historyFor(ctx.tenantId, this.actor(ctx), st, subjectId).then((data) => ({ data }));
  }
}
