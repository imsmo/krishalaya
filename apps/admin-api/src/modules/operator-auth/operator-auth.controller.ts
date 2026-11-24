// apps/admin-api/src/modules/operator-auth/operator-auth.controller.ts · PC-56 ADMIN-AUTH-1 — the god-mode realm's sign-in.
//
// EVERY ROUTE HERE IS BEHIND THE IP ALLOWLIST: AdminModule applies IpAllowlistMiddleware to '*' before any controller runs
// (admin.module.ts; proven for these routes in operator-auth-boot.spec.ts). The allowlist must therefore contain BOTH the
// operators' egress IPs (the browser calls sso/start and the callback directly) AND web-admin's egress (its server calls
// the WebAuthn endpoints) — infra/AWS-GUIDEBOOK.md §12.2.
//
// UNAUTHENTICATED (the credential is the ticket / the IdP's code), each rate-limited per IP:
//   GET  /v1/auth/sso/start            → 302 to the IdP (+ an httpOnly browser-binding cookie on this host)
//   GET  /v1/auth/sso/callback         → 302 to web-admin /login/key?ticket=… or /login?error=signin
//   POST /v1/auth/webauthn/options     {ticket}                         → { mode: authenticate|enroll, options }
//   POST /v1/auth/webauthn/enroll      {ticket, code, label, response}  → { enrolled, keyId }
//   POST /v1/auth/webauthn/login       {ticket, response}               → { token, maxAgeSec, expiresAt }
// AUTHENTICATED (AdminAuthGuard):
//   POST /v1/auth/step-up/options · POST /v1/auth/step-up {response}    → a fresh token (same sid/exp, new auth_time)
//   POST /v1/auth/sign-out                                               → the session row is revoked
//   GET  /v1/auth/keys · POST /v1/auth/keys/options · POST /v1/auth/keys {label, response}   (add: hardware key + step-up)
//   POST /v1/auth/keys/:id/revoke {reason}                               (hardware key + step-up; another's key: staff.manage)
//   GET  /v1/auth/operators/:id/keys                                     (staff.read)
//   GET/POST /v1/auth/enrollment-codes · POST /v1/auth/enrollment-codes/:id/revoke   (staff.read / staff.enroll + key + step-up)
//
// IDEMPOTENCY (Law 3): the sign-in writes are single-use by construction (a state, a ticket, a challenge can each be spent
// once — a retry is refused, never replayed). Revocations are conditional UPDATEs (a retry changes nothing). Issuing an
// enrollment code is deliberately NOT replayable through AdminIdempotency: that would store the plaintext code in
// idempotency_keys.response_body. A lost response means "issue another"; the first expires in 24 h and can be revoked.
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { AdminConfig } from '../../core/config/admin-config';
import { OwnerPermissions, OwnerPermissionsGuard, RequireOwnerPermission } from '../../core/rbac/owner-roles';
import { ZodBody } from '../../core/http/zod.pipe';
import { OperatorAuthService, RequestMeta } from './services/operator-auth.service';
import { AuthRateLimit, AuthRateLimitGuard } from './operator-auth.rate-limit';
import { SSO_FLOW_TTL_SEC } from './domain/operator-auth.rules';
import {
  AddKeyDto, AddKeySchema, EnrollDto, EnrollSchema, IssueCodeDto, IssueCodeSchema, KeyOptionsDto, KeyOptionsSchema, LoginDto, LoginSchema,
  RevokeKeyDto, RevokeKeySchema, StepUpDto, StepUpSchema,
} from './dto/operator-auth.dto';

export const SSO_BINDING_COOKIE = 'kva_sso_bind';
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;
const admin = (req: Request): AdminRequestContext => (req as unknown as { admin: AdminRequestContext }).admin;

function meta(req: Request): RequestMeta {
  return {
    ip: String(req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
    requestId: String(req.headers['x-request-id'] ?? '').slice(0, 60) || null,
  };
}

/** Read one cookie without a cookie-parser dependency. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

@Controller({ path: 'auth', version: '1' })
@UseGuards(AuthRateLimitGuard)
export class OperatorAuthController {
  constructor(private readonly auth: OperatorAuthService, private readonly config: AdminConfig) {}

  private bindingCookie(value: string, maxAgeSec: number): string {
    // Host-only (no Domain), scoped to the SSO paths, Lax so the IdP's top-level redirect back carries it.
    return `${SSO_BINDING_COOKIE}=${encodeURIComponent(value)}; Path=/v1/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${this.config.isProd ? '; Secure' : ''}`;
  }

  @Get('sso/start') @AuthRateLimit('sso_start', 20)
  async ssoStart(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const { redirectUrl, binding } = await this.auth.startSso(meta(req));
      res.setHeader('Set-Cookie', this.bindingCookie(binding, SSO_FLOW_TTL_SEC));
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, redirectUrl);
    } catch {
      // IdP discovery down / misconfigured: back to the console with the generic message — never a stack trace.
      res.redirect(302, `${this.config.env.ADMIN_CONSOLE_URL}/login?error=signin`);
    }
  }

  @Get('sso/callback') @AuthRateLimit('sso_callback', 20)
  async ssoCallback(@Req() req: Request, @Res() res: Response,
    @Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string): Promise<void> {
    const bindingValue = readCookie(req.headers.cookie, SSO_BINDING_COOKIE);
    let target: string;
    try { target = await this.auth.handleCallback({ code, state, error }, bindingValue, meta(req)); }
    catch { target = `${this.config.env.ADMIN_CONSOLE_URL}/login?error=signin`; }
    res.setHeader('Set-Cookie', this.bindingCookie('', 0));   // single use: the binding dies with the flow
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target);
  }

  @Post('webauthn/options') @HttpCode(200) @AuthRateLimit('webauthn', 120)
  keyOptions(@Req() req: Request, @ZodBody(KeyOptionsSchema) body: KeyOptionsDto) {
    return this.auth.keyOptions(body.ticket, meta(req)).then((data) => ({ data }));
  }

  @Post('webauthn/enroll') @HttpCode(200) @AuthRateLimit('webauthn', 120)
  enroll(@Req() req: Request, @ZodBody(EnrollSchema) body: EnrollDto) {
    return this.auth.enroll(body, meta(req)).then((data) => ({ data }));
  }

  @Post('webauthn/login') @HttpCode(200) @AuthRateLimit('webauthn', 120)
  login(@Req() req: Request, @ZodBody(LoginSchema) body: LoginDto) {
    return this.auth.login(body, meta(req)).then((data) => ({ data }));
  }

  /* ---------------- inside a session ---------------- */

  @Post('step-up/options') @HttpCode(200) @AuthRateLimit('webauthn', 120) @UseGuards(AdminAuthGuard)
  stepUpOptions(@Req() req: Request) { return this.auth.stepUpOptions(admin(req)).then((data) => ({ data })); }

  @Post('step-up') @HttpCode(200) @AuthRateLimit('webauthn', 120) @UseGuards(AdminAuthGuard)
  stepUp(@Req() req: Request, @ZodBody(StepUpSchema) body: StepUpDto) {
    return this.auth.stepUp(admin(req), body.response, 'POST /v1/auth/step-up').then((data) => ({ data }));
  }

  @Post('sign-out') @HttpCode(200) @UseGuards(AdminAuthGuard)
  signOut(@Req() req: Request) { return this.auth.signOut(admin(req)).then((data) => ({ data })); }

  @Get('keys') @UseGuards(AdminAuthGuard)
  myKeys(@Req() req: Request) { return this.auth.myKeys(admin(req)).then((data) => ({ data })); }

  @Post('keys/options') @HttpCode(200) @AuthRateLimit('webauthn', 120) @UseGuards(AdminAuthGuard, ...ELEVATED)
  addKeyOptions(@Req() req: Request) { return this.auth.addKeyOptions(admin(req)).then((data) => ({ data })); }

  @Post('keys') @HttpCode(200) @AuthRateLimit('webauthn', 120) @UseGuards(AdminAuthGuard, ...ELEVATED)
  addKey(@Req() req: Request, @ZodBody(AddKeySchema) body: AddKeyDto) { return this.auth.addKey(admin(req), body).then((data) => ({ data })); }

  @Post('keys/:id/revoke') @HttpCode(200) @UseGuards(AdminAuthGuard, ...ELEVATED)
  revokeKey(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @ZodBody(RevokeKeySchema) body: RevokeKeyDto) {
    return this.auth.revokeKey(admin(req), id, body.reason).then((data) => ({ data }));
  }

  @Get('operators/:id/keys') @UseGuards(AdminAuthGuard, OwnerPermissionsGuard) @RequireOwnerPermission(OwnerPermissions.StaffRead)
  operatorKeys(@Param('id', new ParseUUIDPipe()) id: string) { return this.auth.operatorKeys(id).then((data) => ({ data })); }

  @Get('enrollment-codes') @UseGuards(AdminAuthGuard, OwnerPermissionsGuard) @RequireOwnerPermission(OwnerPermissions.StaffRead)
  listCodes() { return this.auth.listCodes().then((data) => ({ data })); }

  @Post('enrollment-codes') @HttpCode(200) @UseGuards(AdminAuthGuard, OwnerPermissionsGuard, ...ELEVATED) @RequireOwnerPermission(OwnerPermissions.StaffEnroll)
  issueCode(@Req() req: Request, @ZodBody(IssueCodeSchema) body: IssueCodeDto) {
    return this.auth.issueCode(admin(req), body).then((data) => ({ data }));
  }

  @Post('enrollment-codes/:id/revoke') @HttpCode(200) @UseGuards(AdminAuthGuard, OwnerPermissionsGuard, HardwareKeyGuard) @RequireOwnerPermission(OwnerPermissions.StaffEnroll)
  revokeCode(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.auth.revokeCode(admin(req), id).then((data) => ({ data }));
  }
}
