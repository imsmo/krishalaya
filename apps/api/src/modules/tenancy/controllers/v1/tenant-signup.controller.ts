// modules/tenancy/controllers/v1/tenant-signup.controller.ts · the only public route that may create a tenant (TENANT-1d-3a).
//
// **PUBLIC BY NECESSITY, NOT BY CONVENIENCE.** W113 is a page for somebody who has no organisation and therefore no session:
// `VerifyOtpSchema` requires a `tenantId`, so a person outside every tenant cannot authenticate at all. There is no
// authenticated shape this route could have taken.
//
// The controls that make that safe are on the route itself, and each is here for a stated reason:
//   * A per-IP rate limit here, and the PER-PHONE limit is already upstream and stronger: `OtpService.issue` caps requests
//     per phone (5/hour) and caps verify attempts per code, and this route cannot proceed without a fresh unused code. A
//     second per-phone counter on this handler would look more rigorous and add nothing — the binding constraint is the
//     one that gates the SMS. (Said precisely because a comment that claims a control the code does not have is worse
//     than no comment: that exact shape was caught by a mutation in TENANT-1b.)
//   * An Idempotency-Key is REQUIRED, so a retry on a dropped connection returns the first organisation rather than a
//     second one.
//   * The OTP is verified inside the service through the same `OtpService` login uses — attempt-capped, hashed, single-use.
import { Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { Inject } from '@nestjs/common';
import { TenantSignupService } from '../../services/tenant-signup.service';
import { TenantSignupSchema, TenantSignupDto } from '../../dto/tenant-signup.dto';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'tenant-signup', version: '1' })
@UseGuards(AuthGuard)
export class TenantSignupController {
  constructor(
    private readonly signup: TenantSignupService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  /**
   * Create an organisation from a verified phone — or return the one this phone already administers.
   *
   * The response carries tokens, because the phone was verified in this very call and sending somebody who just proved
   * their number back to a login screen to prove it again is how a signup loses the person it just gained.
   */
  @Public()
  @RateLimit({ limit: 5, windowSec: 3600, by: 'ip' })
  @Post()
  create(@Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(TenantSignupSchema) dto: TenantSignupDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    // Keyed by the CALLER's key scoped to the phone, so two different people cannot collide on a guessed key, and one
    // person's retry always lands on their own first result.
    return this.idem
      .remember(`${key}:${dto.phone}`, dto.phone, 'tenancy.self_serve_signup', () => this.signup.signUp(dto, ipOf(r)))
      .then((data) => ({ data }));
  }
}
