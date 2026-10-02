// modules/requirements/controllers/v1/requirements.controller.ts · demand posts + seller quotes + the buyer desk's pooled quotes
// (validate→authorize→delegate). Gated by the `requirements` flag (the API's flag — a switched-off flag answers 404).
//
// PC-56 TENANT-11d:
//   • POST /requirements — `requirement.post` for one's own; `requirement.desk` + `onBehalf { buyerUserId, consent }` for a named
//     buyer (A3). The route guard no longer demands requirement.post (tenant_admin, the desk, never held it — F-8); the service
//     decides which of the two applies and refuses the rest. Idempotency-Key on post and quote (Law 3).
//   • GET /requirements?box=open|mine|all&status&sort=recent|need_by&counts=1 — µs keyset; counts per status; responsesCount per row.
//   • GET /requirements/:id/matches — the rule-based member-stock read (desk) (A6).
//   • /requirements/:id/response-groups[/:gid[/lines[/:lid[/consent|/remove]]|/send|/withdraw]] — the pooled quote (A1).
//   • close takes an optional reason (a moderator's is required); every write is audited with the request ip.
import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { RequirementService } from '../../services/requirement.service';
import { RequirementResponseService } from '../../services/requirement-response.service';
import { ResponseGroupService } from '../../services/response-group.service';
import { CreateRequirementSchema, CreateRequirementDto } from '../../dto/create-requirement.dto';
import { UpdateRequirementSchema, UpdateRequirementDto } from '../../dto/update-requirement.dto';
import { CreateResponseSchema, CreateResponseDto } from '../../dto/create-requirement-response.dto';
import { QueryRequirementsSchema, QueryRequirementsDto } from '../../dto/query-requirement.dto';
import { QueryResponsesSchema, QueryResponsesDto } from '../../dto/query-requirement-response.dto';
import {
  AddLineSchema, AddLineDto, CloseRequirementSchema, CreateGroupSchema, EditLineSchema, EditLineDto, LineConsentSchema, ConsentDto, WithdrawGroupSchema,
} from '../../dto/requirement-desk.dto';
import { decodeCursor } from '../../domain/cursor';
import { RequirementPermissions, requirementActor } from '../../policies/requirements.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'requirements', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementService, private readonly responses: RequirementResponseService, private readonly groups: ResponseGroupService) {}

  @Post()
  post(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateRequirementSchema) dto: CreateRequirementDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.requirements.create(ctx.tenantId, requirementActor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRequirementsSchema) q: QueryRequirementsDto) {
    return this.requirements.list(ctx.tenantId, requirementActor(ctx), { box: q.box, status: q.status, categoryId: q.categoryId, sort: q.sort, counts: !!q.counts,
      cursor: decodeCursor(q.cursor, q.sort === 'need_by' ? 'need_by' : 'created'), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, counts: res.counts, total: res.total } }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.requirements.getById(ctx.tenantId, id, requirementActor(ctx)).then((data) => ({ data })); }

  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(UpdateRequirementSchema) dto: UpdateRequirementDto) {
    return this.requirements.update(ctx.tenantId, requirementActor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/close')
  close(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CloseRequirementSchema) dto: { reason?: string }) {
    return this.requirements.close(ctx.tenantId, requirementActor(ctx), id, ipOf(r), dto.reason ?? null).then((data) => ({ data }));
  }

  @Post(':id/responses') @RequirePermissions(RequirementPermissions.Quote)
  quote(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(CreateResponseSchema) dto: CreateResponseDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.responses.submit(ctx.tenantId, ctx.userId, id, key, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get(':id/responses')
  listResponses(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryResponsesSchema) q: QueryResponsesDto) {
    return this.responses.listForRequirement(ctx.tenantId, requirementActor(ctx), id, { status: q.status, cursor: decodeCursor(q.cursor, 'created'), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // ---- A6 · member stock (rule-based) ----
  @Get(':id/matches')
  matches(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.groups.matches(ctx.tenantId, requirementActor(ctx), id).then((data) => ({ data })); }

  // ---- A1 · the pooled quote ----
  @Get(':id/response-groups')
  listGroups(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.groups.listFor(ctx.tenantId, requirementActor(ctx), id).then((data) => ({ data })); }

  @Post(':id/response-groups')
  createGroup(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CreateGroupSchema) _dto: Record<string, never>) {
    return this.groups.createDraft(ctx.tenantId, requirementActor(ctx), id, ipOf(r)).then((data) => ({ data }));
  }

  @Get(':id/response-groups/:gid')
  getGroup(@CurrentContext() ctx: RequestContext, @Param('gid') gid: string) { return this.groups.get(ctx.tenantId, requirementActor(ctx), gid).then((data) => ({ data })); }

  @Post(':id/response-groups/:gid/lines')
  addLine(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @ZodBody(AddLineSchema) dto: AddLineDto) {
    return this.groups.addLine(ctx.tenantId, requirementActor(ctx), gid, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Patch(':id/response-groups/:gid/lines/:lid')
  editLine(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @Param('lid') lid: string, @ZodBody(EditLineSchema) dto: EditLineDto) {
    return this.groups.editLine(ctx.tenantId, requirementActor(ctx), gid, lid, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/response-groups/:gid/lines/:lid/remove')
  removeLine(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @Param('lid') lid: string) {
    return this.groups.removeLine(ctx.tenantId, requirementActor(ctx), gid, lid, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/response-groups/:gid/lines/:lid/consent')
  consent(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @Param('lid') lid: string, @ZodBody(LineConsentSchema) dto: ConsentDto) {
    return this.groups.recordConsent(ctx.tenantId, requirementActor(ctx), gid, lid, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/response-groups/:gid/send')
  send(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string) {
    return this.groups.send(ctx.tenantId, requirementActor(ctx), gid, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/response-groups/:gid/withdraw')
  withdraw(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('gid') gid: string, @ZodBody(WithdrawGroupSchema) dto: { reason: string }) {
    return this.groups.withdraw(ctx.tenantId, requirementActor(ctx), gid, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
