// modules/dairy/controllers/v1/deduction-instructions.controller.ts · PC-56 TENANT-6c-5 · the standing instruction.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."* These
// are the routes for the other half of that sentence.
//
// NO `@RequirePermissions` on the member's acts — the third dairy surface with none, after 6c-2's dispute and 6c-4's
// consent. Requiring `dairy.manage` to arrange or stop a deduction from your own milk cheque would mean the only
// people who can agree to a withholding are the people doing it, and it is the same reasoning that let TENANT-6c-3
// take `dairy.manage` off the farmer role without breaking anything a member does.
//
// NOT behind the assembly flag. `dairy_deduction_assembly` gates whether the CYCLE acts on these arrangements; a
// member must be able to record or revoke one either way — 0156's ruling for the pour-level hold, applied again: a
// farmer's control over their own money does not depend on whether a console feature is switched on.
import { Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { DairyDeductionInstructionService } from '../../services/dairy-deduction-instruction.service';
import { AuthoriseDeductionInstructionSchema, AuthoriseDeductionInstructionDto } from '../../dto/deduction-instruction.dto';
import { canCloseSettlement, canManageDairy } from '../../policies/dairy.policies';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'dairy/deduction-instructions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class DeductionInstructionsController {
  constructor(private readonly instructions: DairyDeductionInstructionService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  /** The MEMBER arranges routine recovery from their own milk bill. Ownership-checked, 404 not 403. */
  @Post()
  authorise(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string,
            @ZodBody(AuthoriseDeductionInstructionSchema) dto: AuthoriseDeductionInstructionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.instructions.authorise(ctx.tenantId, ctx.userId, key, dto, ipOf(r)).then((data) => ({ data }));
  }

  /**
   * End one. The member, or the desk — a member must always be able to stop a deduction from their own cheque, and an
   * operator must be able to close an arrangement whose debt is settled. Neither may EDIT one.
   */
  @Delete(':id')
  revoke(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.instructions.revoke(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data }));
  }

  /** One membership's arrangements — the member's own, or the desk's. `includeRevoked` for the history. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query('membershipId') membershipId: string,
       @Query('includeRevoked') includeRevoked?: string, @Query('limit') limit?: string) {
    if (!membershipId) throw new BadRequestError('membershipId is required');
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    return this.instructions.listFor(ctx.tenantId, this.actor(ctx), membershipId, includeRevoked === 'true', n).then((data) => ({ data }));
  }
}
