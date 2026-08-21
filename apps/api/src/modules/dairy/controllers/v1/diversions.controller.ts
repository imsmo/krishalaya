// modules/dairy/controllers/v1/diversions.controller.ts · PC-56 TENANT-6d-6 · W170's playbook step 2.
//
// *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan"*, and *"playbook overrides are operator + dairy lead
// together"* — so this controller carries TWO permissions and hands both to every act. The service decides which one
// each act needs; a controller that resolved only the verb it thought it needed is one route away from gating on a
// decorator the service never sees (TENANT-6c-3's rule, restated on every dairy controller since).
//
// `preview` is DECLARED FIRST, above anything parameterised — the route-order trap this programme has now documented
// six times. It writes nothing and takes no idempotency key: a question asked twice is the same question.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DairyDiversionService } from '../../services/dairy-diversion.service';
import { DairyPermissions, canCloseSettlement, canManageDairy, canOverrideDairy } from '../../policies/dairy.policies';
import { DIVERSION_FLAG } from '../../domain/dairy-diversion.flags';
import {
  CancelDiversionDto, CancelDiversionSchema, PreviewDiversionDto, PreviewDiversionSchema,
  QueryDiversionsDto, QueryDiversionsSchema, RequestDiversionDto, RequestDiversionSchema,
} from '../../dto/diversion.dto';
import { MilkShift } from '../../domain/dairy.events';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/diversions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
// THREE FLAGS COMPOSING (TENANT-6d-2 made that possible): the module, and this act's own. A cooperative that is not
// licensed for dairy must not have these routes, and one that is must still be able to leave the override switched off
// — the playbook then keeps saying the step is not built, which is where TENANT-6d-1 left it.
@FeatureFlag('dairy', DIVERSION_FLAG)
export class DiversionsController {
  constructor(private readonly diversions: DairyDiversionService) {}

  private actor(ctx: RequestContext) {
    return {
      userId: ctx.userId,
      canManage: canManageDairy(ctx),
      canCloseSettlement: canCloseSettlement(ctx),
      // Dairy's second verb (0166). Resolved here for every act even though only `approve` reads it, because a
      // controller that resolves the subset it happens to need today is the shape of the next authorisation bug.
      canOverride: canOverrideDairy(ctx),
    };
  }

  /** W2521's confirm step for this act: the object, the affected member count, and every reason it would be refused. */
  @Post('preview') @RequirePermissions(DairyPermissions.Manage)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewDiversionSchema) dto: PreviewDiversionDto) {
    return this.diversions.preview(ctx.tenantId, this.actor(ctx), {
      fromMccId: dto.fromMccId, toMccId: dto.toMccId, divertedOn: dto.divertedOn,
      shift: dto.shift as MilkShift, reason: dto.reason,
    }).then((data) => ({ data }));
  }

  /** The register — every diversion this cooperative has recorded, newest shift first, both villages named. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryDiversionsSchema) q: QueryDiversionsDto) {
    return this.diversions.list(ctx.tenantId, this.actor(ctx), q).then((data) => ({ data }));
  }

  /**
   * **DID THE FAMILIES GET THE MESSAGE?** (PC-56 TENANT-6d-8.)
   *
   * Declared before the parameterised POSTs and after `preview`, and it is a GET on a sub-path of `:id` — there is no
   * `@Get(':id')` on this controller, so nothing can swallow it, and the route-order trap this programme has now
   * documented seven times does not apply. Read-only, no idempotency key: asking twice is the same question.
   */
  @Get(':id/notice') @RequirePermissions(DairyPermissions.Manage)
  notice(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.diversions.noticeReport(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /** An OPERATOR asks. It moves no milk until somebody else signs it. */
  @Post() @RequirePermissions(DairyPermissions.Manage)
  request(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
          @ZodBody(RequestDiversionSchema) dto: RequestDiversionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.diversions.request(ctx.tenantId, this.actor(ctx), key, {
      fromMccId: dto.fromMccId, toMccId: dto.toMccId, divertedOn: dto.divertedOn,
      shift: dto.shift as MilkShift, reason: dto.reason,
    }, ipOf(r)).then((data) => ({ data }));
  }

  /**
   * The DAIRY LEAD signs it — and `dairy.override` is what the decorator asks for, not `dairy.manage`.
   *
   * The route's permission and the service's verdict agree on purpose: a 403 from the guard and a `NO_OVERRIDE` refusal
   * from the service are the same rule said twice, and the second one is what a screen can print in Gujarati.
   */
  @Post(':id/approve') @RequirePermissions(DairyPermissions.Override)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
          @Param('id') id: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.diversions.approve(ctx.tenantId, this.actor(ctx), key, id, ipOf(r)).then((data) => ({ data }));
  }

  /** Called off. Either verb may do it — an operator who asked in error should not need a lead to undo it. */
  @Post(':id/cancel') @RequirePermissions(DairyPermissions.Manage)
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
         @Param('id') id: string, @ZodBody(CancelDiversionSchema) dto: CancelDiversionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.diversions.cancel(ctx.tenantId, this.actor(ctx), key, id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
