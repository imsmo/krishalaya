// modules/identity/controllers/v1/me-security.controller.ts · PC-56 TENANT-SW-c · `/me/security` — the person's OWN second factor (B3)
// and their OWN conflict declarations (A3).
//
// The 2FA routes are `@TwoFactorExempt()` (a staff member whose organisation requires 2FA must still be able to set it up) and carry
// the auditor's named carve-out `two_factor.self` (the auditor is staff; refusing these would lock the auditor out instead of letting
// them comply — 9c's guard enumerates every carve-out). The secret / otpauth URI and the recovery codes are in the response ONCE.
import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { AuditorReadAct } from '../../../../core/auth/auditor-read-only.guard';
import { TwoFactorExempt } from '../../../../core/auth/session-posture.guard';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { Headers } from '@nestjs/common';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TwoFactorService } from '../../services/two-factor.service';
import { ConflictService } from '../../services/conflict.service';
import { DeclareConflictSchema, DeclareConflictDto, DisableTwoFactorSchema, DisableTwoFactorDto, TotpCodeSchema, TotpCodeDto } from '../../dto/verification-team.dto';

const tf = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, tenantId: ctx.tenantId, ip: req.ip || null, requestId: ctx.requestId || null });
const ca = (ctx: RequestContext, req: Request) => ({ userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null });

@Controller({ path: 'me', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class MeSecurityController {
  constructor(private readonly twoFactor: TwoFactorService, private readonly conflicts: ConflictService) {}

  @TwoFactorExempt() @Get('2fa')
  state(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.twoFactor.state(tf(ctx, req)).then((data) => ({ data }));
  }
  @TwoFactorExempt() @AuditorReadAct('two_factor.self') @RateLimit({ limit: 10, windowSec: 60, by: 'user' }) @Post('2fa/enrol')
  enrol(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.twoFactor.enrol(tf(ctx, req)).then((data) => ({ data }));
  }
  @TwoFactorExempt() @AuditorReadAct('two_factor.self') @RateLimit({ limit: 10, windowSec: 60, by: 'user' }) @Post('2fa/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(TotpCodeSchema) dto: TotpCodeDto) {
    return this.twoFactor.confirm(tf(ctx, req), dto.code).then((data) => ({ data }));
  }
  @TwoFactorExempt() @AuditorReadAct('two_factor.self') @RateLimit({ limit: 10, windowSec: 60, by: 'user' }) @Post('2fa/disable')
  disable(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(DisableTwoFactorSchema) dto: DisableTwoFactorDto) {
    return this.twoFactor.disable(tf(ctx, req), dto).then((data) => ({ data }));
  }

  /** My conflict declarations (active and lifted). */
  @Get('conflicts')
  myConflicts(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.conflicts.mine(ctx.tenantId, ca(ctx, req)).then((data) => ({ data }));
  }
  /** Members I may name (a name search over this organisation's members — never phones). */
  @Get('conflicts/members')
  members(@CurrentContext() ctx: RequestContext, @Query('q') q?: string) {
    return this.conflicts.members(ctx.tenantId, String(q ?? '')).then((data) => ({ data }));
  }
  /** Declare a conflict (self) — recuses me mechanically from that member's KYC. */
  @Post('conflicts')
  declare(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DeclareConflictSchema) dto: DeclareConflictDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.conflicts.declare(ctx.tenantId, ca(ctx, req), ctx.userId, dto, key).then((data) => ({ data }));
  }
}
