// modules/identity/controllers/v1/desks.controller.ts · PC-56 TENANT-13b · W185 DESKS + W2574–W2580 (validate → authorize → delegate).
// Every route needs `desk.manage` (tenant_admin). Desk changes are PROPOSALS a second tenant_admin confirms (0192's trigger is the wall);
// members are a direct audited act. No new flag: desks ride `tenancy` (brief B4) — the flagged-off state says so.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { IdentityPermissions } from '../../policies/identity.policies';
import { DeskActor, DeskService } from '../../services/desk.service';
import {
  DeskMemberAddDto, DeskMemberAddSchema, DeskMemberRemoveDto, DeskMemberRemoveSchema, DeskProposalDto, DeskProposalSchema,
  DeskRefuseDto, DeskRefuseSchema, QueryDeskProposalsDto, QueryDeskProposalsSchema,
} from '../../dto/desk.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const actorOf = (ctx: RequestContext): DeskActor => ({ userId: ctx.userId, canManage: ctx.permissions.has(IdentityPermissions.DeskManage) || ctx.permissions.has('*') });

@Controller({ path: 'desks', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
@RequirePermissions(IdentityPermissions.DeskManage)
export class DesksController {
  constructor(private readonly desks: DeskService) {}

  @Get()
  board(@CurrentContext() ctx: RequestContext) { return this.desks.board(ctx.tenantId, actorOf(ctx)).then((data) => ({ data })); }

  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(DeskProposalSchema) dto: DeskProposalDto) {
    return this.desks.preview(ctx.tenantId, actorOf(ctx), dto).then((data) => ({ data }));
  }
  @Get('proposals')
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDeskProposalsSchema) q: QueryDeskProposalsDto) {
    return this.desks.proposals(ctx.tenantId, actorOf(ctx), q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Get('proposals/:id')
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.desks.proposal(ctx.tenantId, actorOf(ctx), id).then((data) => ({ data })); }
  @Post('proposals')
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DeskProposalSchema) dto: DeskProposalDto) {
    return this.desks.propose(ctx.tenantId, actorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.desks.confirm(ctx.tenantId, actorOf(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(DeskRefuseSchema) dto: DeskRefuseDto) {
    return this.desks.refuse(ctx.tenantId, actorOf(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/members')
  addMember(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(DeskMemberAddSchema) dto: DeskMemberAddDto) {
    return this.desks.addMember(ctx.tenantId, actorOf(ctx), reqKey(key), id, dto.userId, dto.reason ?? null, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/members/:userId/remove')
  removeMember(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('userId') userId: string, @ZodBody(DeskMemberRemoveSchema) dto: DeskMemberRemoveDto) {
    return this.desks.removeMember(ctx.tenantId, actorOf(ctx), reqKey(key), id, userId, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
