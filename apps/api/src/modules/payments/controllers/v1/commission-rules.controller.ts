// modules/payments/controllers/v1/commission-rules.controller.ts · PC-56 TENANT-SW-a · W149 — a tenant's commission rules, owner + checker
// (validate → authorize → delegate, no logic). Reads: any signed-in member of the tenant (the table is "visible, never hidden"). Writes:
// `commission.manage` (tenant_admin) behind the `tenant_commission_rules` flag (OFF = platform defaults govern, no tenant overrides),
// every write keyed (Idempotency-Key). There is NO direct create/edit any more: a rule is proposed and a second tenant_admin confirms it
// (0196). The platform share is not a field — the DTO is .strict() and refuses `platformShareBps` by name (400).
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { CommissionRuleService } from '../../services/commission-rule.service';
import {
  CreateCommissionRuleSchema, CreateCommissionRuleDto, DeactivateCommissionRuleSchema, DeactivateCommissionRuleDto,
  RefuseCommissionProposalSchema, RefuseCommissionProposalDto, CommissionResolutionQuerySchema, CommissionResolutionQueryDto,
} from '../../dto/create-commission-rule.dto';
import { QueryCommissionRuleSchema, QueryCommissionRuleDto, QueryCommissionProposalSchema, QueryCommissionProposalDto } from '../../dto/query-commission-rule.dto';
import { canManageCommissionRules, COMMISSION_MANAGE } from '../../policies/payments.policies';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'commission-rules', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
export class CommissionRulesController {
  constructor(private readonly rules: CommissionRuleService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageCommissionRules(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCommissionRuleSchema) q: QueryCommissionRuleDto) {
    return this.rules.list(ctx.tenantId, q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, platformShareBps: res.platformShareBps } }));
  }
  /** "Platform share is set by your plan" + the earliest date a change may carry (7-day notice from the next IST midnight). */
  @Get('policy')
  policy(@CurrentContext() ctx: RequestContext) { return this.rules.policy(ctx.tenantId).then((data) => ({ data })); }
  @Get('resolution')
  resolution(@CurrentContext() ctx: RequestContext, @ZodQuery(CommissionResolutionQuerySchema) q: CommissionResolutionQueryDto) {
    return this.rules.resolution(ctx.tenantId, q).then((data) => ({ data }));
  }
  @Get('proposals')
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCommissionProposalSchema) q: QueryCommissionProposalDto) {
    return this.rules.listProposals(ctx.tenantId, ctx.userId, q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals/:id')
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.rules.getProposal(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }

  /** Propose a NEW effective-dated rule (W2431–W2433 "Propose rule change (checker)"). */
  @Post('proposals') @RequirePermissions(COMMISSION_MANAGE) @FeatureFlag('tenant_commission_rules')
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateCommissionRuleSchema) dto: CreateCommissionRuleDto) {
    return this.rules.proposeCreate(ctx.tenantId, this.actor(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  /** Propose ending one of the tenant's own rules from an IST midnight ≥ 7 days out. */
  @Post(':id/deactivate') @RequirePermissions(COMMISSION_MANAGE) @FeatureFlag('tenant_commission_rules')
  deactivate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(DeactivateCommissionRuleSchema) dto: DeactivateCommissionRuleDto) {
    return this.rules.proposeDeactivate(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm') @RequirePermissions(COMMISSION_MANAGE) @FeatureFlag('tenant_commission_rules')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Body() _b: unknown) {
    return this.rules.confirm(ctx.tenantId, this.actor(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse') @RequirePermissions(COMMISSION_MANAGE) @FeatureFlag('tenant_commission_rules')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseCommissionProposalSchema) dto: RefuseCommissionProposalDto) {
    return this.rules.refuse(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
