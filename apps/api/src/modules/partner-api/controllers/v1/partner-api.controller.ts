// modules/partner-api/controllers/v1/partner-api.controller.ts · PC-55 A10. The machine-to-machine surface a bank,
// NBFC or insurer calls directly: `/v1/partner-api/*`.
//
// EVERYTHING ABOUT THIS CONTROLLER IS READ-ONLY AND FLAG-DARK.
//   • @FeatureFlag('partner_api') runs FIRST and answers 404 while the flag is off (the realm is invisible, not
//     merely forbidden) — the flag row ships is_enabled=false (0090) and stays off until the S2 review signs off.
//   • Every route declares @PartnerScope. The guard REFUSES any partner route that forgets to.
//   • There is not one mutation here, by design: the first version of a partner realm should be incapable of
//     changing a farmer's loan or policy. Writes (claim decisions, disbursal instructions) are a later, separately
//     reviewed wave with maker-checker and idempotency of their own.
//   • No tenant is named anywhere. A partner's book spans tenants; the partner's own identity (from the API key) is
//     the only scope, and RLS on the partner axis enforces it in the database (0090).
//   • @RateLimit here is the IP-level backstop; the real quota is per-KEY inside the guard.
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { AuthenticatedPartner, CurrentPartner, PartnerKeyGuard, PartnerScope } from '../../guards/partner-key.guard';
import { PartnerBookService } from '../../services/partner-book.service';

@Controller({ path: 'partner-api', version: '1' })
@UseGuards(FeatureFlagGuard, PartnerKeyGuard)
@FeatureFlag('partner_api')
@RateLimit({ limit: 600, windowSec: 60, by: 'ip' })
export class PartnerApiController {
  constructor(private readonly svc: PartnerBookService) {}

  /** Who this key is and what it may do — the endpoint an integrator hits first to prove their credential works
   *  WITHOUT touching a single farmer's record. Returns no secret and no key material. */
  @Get('me')
  @PartnerScope('partner:identity:read')
  me(@CurrentPartner() p: AuthenticatedPartner) {
    return { data: { partnerId: p.partnerId, keyId: p.keyId, scopes: p.scopes, rateLimitPerHour: p.rateLimitPerHour, capabilities: 'read-only' } };
  }

  /** The lending servicing book: this partner's loans across every tenant they lend into. */
  @Get('lending/loans')
  @PartnerScope('lending:book:read')
  loans(@CurrentPartner() p: AuthenticatedPartner, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.svc.loans(p.partnerId, { status, cursor, limit }).then((page) => ({ data: page.rows, meta: { nextCursor: page.nextCursor, limit: page.limit } }));
  }

  /** One loan's repayment schedule + what has actually been collected. A loan id outside this partner's book returns
   *  an empty page, never a 404 — the realm is not an existence oracle. */
  @Get('lending/loans/:id/repayments')
  @PartnerScope('lending:book:read')
  repayments(@CurrentPartner() p: AuthenticatedPartner, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.loanRepayments(p.partnerId, id, limit).then((page) => ({ data: page.rows, meta: { nextCursor: page.nextCursor, limit: page.limit } }));
  }

  /** The insurer book: policies written on this insurer's products, across tenants. */
  @Get('insurance/policies')
  @PartnerScope('insurance:book:read')
  policies(@CurrentPartner() p: AuthenticatedPartner, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.svc.policies(p.partnerId, { status, cursor, limit }).then((page) => ({ data: page.rows, meta: { nextCursor: page.nextCursor, limit: page.limit } }));
  }
}
