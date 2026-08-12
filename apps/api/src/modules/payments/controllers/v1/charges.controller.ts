// modules/payments/controllers/v1/charges.controller.ts · W150 (PC-56 TENANT-3c-2).
// validate → authorize → delegate. Reads and writes both need `tenant.settings` — W150: "Charge edits are owner +
// checker; tax rules are read-only at tenant level by design" — and the CHECKER must be a different person, which the
// service and 0141's CHECK both enforce. There is deliberately NO endpoint that edits a charge row in place, and none
// that writes a tax rule at all.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ChargeChangeService } from '../../services/charge-change.service';
import { ChargeConsoleReadModel } from '../../read-models/charge-console.read-model';
import { ProposeChargeSchema, ProposeChargeDto, DecideChargeSchema, DecideChargeDto } from '../../dto/charge-change.dto';
import { ChargeAction } from '../../domain/charge-change';

const ipOf = (r: Request) => r.ip || null;
const CHARGE_PERM = 'tenant.settings';

@Controller({ path: 'charges', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class ChargesController {
  constructor(
    private readonly charges: ChargeChangeService,
    private readonly console: ChargeConsoleReadModel,
  ) {}
  private actor(ctx: RequestContext) {
    return { userId: ctx.userId, canManage: ctx.permissions.has(CHARGE_PERM) || ctx.permissions.has('*') };
  }

  /** W150's two tables plus the proposal history, in one read: the fee rows (with which one is IN FORCE today and
   *  which surface reads each code) and the statutory rules (with the code path that reads each, or none). */
  @Get() @RequirePermissions(CHARGE_PERM)
  overview(@CurrentContext() ctx: RequestContext) {
    return Promise.all([
      this.console.charges(ctx.tenantId),
      this.console.taxRules(ctx.tenantId),
      this.console.proposals(ctx.tenantId),
    ]).then(([charges, taxRules, proposals]) => ({ data: { charges, taxRules, proposals } }));
  }

  /** W150's "Add charge" / "Propose change (checker)" — one route, because the ACTION is derived from what the tenant
   *  already owns rather than trusted from the client. */
  @Post('proposals') @RequirePermissions(CHARGE_PERM)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(ProposeChargeSchema) dto: ProposeChargeDto) {
    return this.charges.propose(ctx.tenantId, this.actor(ctx), {
      chargeCode: dto.chargeCode, action: dto.action as ChargeAction, label: dto.label ?? null,
      calcMethod: dto.calcMethod ?? null, config: dto.config, currencyCode: dto.currencyCode,
      effectiveFrom: dto.effectiveFrom, note: dto.note,
    }, ipOf(r)).then((data) => ({ data }));
  }

  /** The checker's signature or refusal — never the proposer (service + 0141's CHECK). */
  @Post('proposals/:id/decision') @RequirePermissions(CHARGE_PERM)
  decide(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(DecideChargeSchema) dto: DecideChargeDto) {
    return this.charges.decide(ctx.tenantId, this.actor(ctx), id, dto.decision, dto.note ?? null, ipOf(r)).then((data) => ({ data }));
  }

  /** Apply an approved proposal: a NEW dated row, and the old one end-dated the day before. Never an edit. */
  @Post('proposals/:id/apply') @RequirePermissions(CHARGE_PERM)
  apply(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.charges.apply(ctx.tenantId, this.actor(ctx), id, ipOf(r)).then((data) => ({ data }));
  }
}
