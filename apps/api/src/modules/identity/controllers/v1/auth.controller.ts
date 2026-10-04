// modules/identity/controllers/v1/auth.controller.ts · phone-OTP login, refresh, logout, sessions.
// Login endpoints are @Public (anonymous can authenticate); tenant is taken from the body
// for login/refresh and from the token context for session management.
import { Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { AuditorReadAct } from '../../../../core/auth/auditor-read-only.guard';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { ChangePhoneService } from '../../services/change-phone.service';
import { RequestOtpSchema, RequestOtpDto, VerifyOtpSchema, VerifyOtpDto, RefreshSchema, RefreshDto, LogoutSchema, LogoutDto, ChangePhoneStartSchema, ChangePhoneStartDto, ChangePhoneConfirmSchema, ChangePhoneConfirmDto, VerifyTwoFactorSchema, VerifyTwoFactorDto } from '../../dto/auth.dto';
// PC-56 TENANT-SW-c: the second factor at sign-in, and the staff invite (lookup + accept: token + OTP on the invited phone).
import { TwoFactorExempt } from '../../../../core/auth/session-posture.guard';
import { TeamService } from '../../services/team.service';
import { AcceptInviteSchema, AcceptInviteDto, InviteLookupSchema, InviteLookupDto } from '../../dto/verification-team.dto';

const ipOf = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;

@Controller({ path: 'auth', version: '1' })
@TwoFactorExempt()   // PC-56 TENANT-SW-c: signing in, out and the session list stay reachable for a staff member still setting up 2FA
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: SessionService, private readonly changePhone: ChangePhoneService, private readonly team: TeamService) {}

  /** PC-56 TENANT-SW-c · B3: finish a sign-in waiting for its second factor (TOTP or one recovery code). */
  @Public() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('2fa/verify')
  async verifyTwoFactor(@Req() req: Request, @ZodBody(VerifyTwoFactorSchema) dto: VerifyTwoFactorDto) {
    return { data: await this.auth.verifyTwoFactor(dto, req.ip || null) };
  }

  /** PC-56 TENANT-SW-c · B2: what an invite is (organisation, role, masked phone, status) — for the accept page. */
  @Public() @RateLimit({ limit: 20, windowSec: 60, by: 'ip' }) @Post('invites/lookup')
  async lookupInvite(@ZodBody(InviteLookupSchema) dto: InviteLookupDto) {
    return { data: await this.team.lookup(dto.tenantId, dto.token) };
  }

  /** PC-56 TENANT-SW-c · B2: accept a staff invite — the token AND the OTP on the invited phone; signs the person in. */
  @Public() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('invites/accept')
  async acceptInvite(@Req() req: Request, @ZodBody(AcceptInviteSchema) dto: AcceptInviteDto) {
    return { data: await this.team.accept(dto, req.ip || null) };
  }

  @Public() @RateLimit({ limit: 5, windowSec: 60, by: 'ip' }) @Post('otp')
  requestOtp(@ZodBody(RequestOtpSchema) dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone, dto.channel).then((data) => ({ data }));
  }

  @Public() @RateLimit({ limit: 10, windowSec: 60, by: 'ip' }) @Post('verify')
  async verify(@Req() req: Request, @ZodBody(VerifyOtpSchema) dto: VerifyOtpDto) {
    return { data: await this.auth.verifyOtp(dto, ipOf(req)) };
  }

  @Public() @RateLimit({ limit: 30, windowSec: 60, by: 'ip' }) @Post('refresh')
  async refresh(@Req() req: Request, @ZodBody(RefreshSchema) dto: RefreshDto) {
    return { data: await this.auth.refreshSession(dto, ipOf(req)) };
  }

  // PC-56 TENANT-9c: ending one's own session is not business data — the auditor's named carve-out (`session.logout`).
  @UseGuards(AuthGuard, PermissionsGuard) @AuditorReadAct('session.logout') @Post('logout')
  async logout(@CurrentContext() ctx: RequestContext, @ZodBody(LogoutSchema) dto: LogoutDto) {
    return { data: await this.auth.logout(ctx.tenantId, ctx.userId, ctx.sessionId, dto.allDevices) };
  }

  @UseGuards(AuthGuard, PermissionsGuard) @Get('sessions')
  async list(@CurrentContext() ctx: RequestContext) {
    return { data: await this.sessions.list(ctx.tenantId, ctx.userId) };
  }

  @UseGuards(AuthGuard, PermissionsGuard) @Delete('sessions/:id')
  async revoke(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.sessions.revoke(ctx.tenantId, ctx.userId, id) };
  }

  // --- phone-number change (API-W12): OTP the new number, then swap the caller's own identity phone ---
  @UseGuards(AuthGuard, PermissionsGuard) @RateLimit({ limit: 5, windowSec: 60, by: 'user' }) @Post('change-phone/start')
  async startPhoneChange(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(ChangePhoneStartSchema) dto: ChangePhoneStartDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return { data: await this.changePhone.start(ctx.tenantId, ctx.userId, dto.newPhone, key) };
  }
  @UseGuards(AuthGuard, PermissionsGuard) @RateLimit({ limit: 10, windowSec: 60, by: 'user' }) @Post('change-phone/confirm')
  async confirmPhoneChange(@CurrentContext() ctx: RequestContext, @ZodBody(ChangePhoneConfirmSchema) dto: ChangePhoneConfirmDto) {
    return { data: await this.changePhone.confirm(ctx.tenantId, ctx.userId, dto.newPhone, dto.code) };
  }
}
