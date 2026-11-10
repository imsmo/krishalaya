// modules/gov-console/services/gov-auth.service.ts · PC-56 GOV-0 · SIGN-IN TO A GOVERNMENT AUTHORITY (GOV-1 Q2-A + Q5-A).
//
//   otp      → the platform's phone OTP (AuthService.requestOtp — hashed, rate-limited, enumeration-safe; nothing new is issued).
//   verify   → the OTP proves the phone. Nothing is registered: an unknown phone and a phone with no LIVE authority membership answer the same
//              403 GOV_ACCESS_NONE. One live authority → that one; several → 403 GOV_CHOICE_REQUIRED with a 5-minute single-use choice token
//              (sha256-keyed in the cache, never a URL). THEN Q5-A: every government account must hold a CONFIRMED authenticator before ANY
//              gov session is opened —
//                no confirmed TOTP → 403 GOV_TWO_FACTOR_REQUIRED with a 10-minute `enrolToken` (sha256-keyed, no session row exists): the
//                                    person enrols (`2fa/enrol`) and confirms (`2fa/confirm`) with it, then signs in again;
//                confirmed TOTP    → a PENDING gov session → 403 TWO_FACTOR_PENDING with its challenge; `2fa/verify` finishes it.
//              There is no SSO, departmental-ID or hardware-key route (none exists; the paths answer 404).
//   refresh  → rotates a GOV session's refresh token (a tenant or partner refresh token is not one); refused (401) when the session was
//              revoked (a removal cuts them) or the person no longer holds a LIVE membership there — an EXPIRED membership refreshes to 401.
//   me       → the authority (id, name, level) and the person (roles, permissions, phone by its last 3, when their access ends).
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../../../core/auth/otp.service';
import { GovRealmUnitOfWork } from '../../../core/database/gov-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { AuthService, AuthTokens, DeviceInput, TwoFactorPendingError } from '../../identity/services/auth.service';
import { UserRepository } from '../../identity/repositories/user.repository';
import { TwoFactorService } from '../../identity/services/two-factor.service';
import { InvalidOtpError, InvalidPhoneError, InvalidRefreshError } from '../../identity/domain/identity.errors';
import { GovConsoleRepository } from '../repositories/gov-console.repository';
import { chooseAuthority, maskPhoneTail } from '../domain/gov-membership.rules';
import { govRefused, namedGovRefusal } from '../domain/gov-console.errors';
import { GovSession } from '../guards/gov-session.guard';

export const GOV_CHOICE_TTL_SEC = 300;
export const GOV_ENROL_TTL_SEC = 600;
const keyOf = (kind: 'choice' | 'enrol', token: string) => `gov:${kind}:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
interface ChoiceRecord { userId: string; authorityIds: string[] }
interface EnrolRecord { userId: string; authorityId: string }

export type GovVerifyInput = { phone: string; code: string; authorityId?: string; device?: DeviceInput } | { choiceToken: string; authorityId: string; device?: DeviceInput };

@Injectable()
export class GovAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly uow: GovRealmUnitOfWork,
    private readonly repo: GovConsoleRepository,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  requestOtp(phone: string) { return this.auth.requestOtp(phone, 'sms'); }

  async verify(dto: GovVerifyInput, ip: string | null): Promise<AuthTokens> {
    let userId: string; let requested: string | undefined; let phone: string | null = null;
    if ('choiceToken' in dto) {
      const rec = await this.cache.get<ChoiceRecord>(keyOf('choice', dto.choiceToken)).catch(() => null);
      await this.cache.del(keyOf('choice', dto.choiceToken)).catch(() => undefined);
      if (!rec || !rec.authorityIds.includes(dto.authorityId)) throw govRefused('GOV_CHOICE_INVALID');
      userId = rec.userId; requested = dto.authorityId;
    } else {
      phone = normalizePhoneE164(dto.phone);
      if (!phone) throw new InvalidPhoneError();
      const v = await this.otp.verifyDetailed(phone, dto.code);
      if (!v.ok) {
        await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone, method: 'otp', ip, deviceFingerprint: dto.device?.fingerprint ?? null }));
        this.metrics.inc('gov_console.login_failed', { method: 'otp' });
        throw new InvalidOtpError(v.reason === 'locked' ? { reason: v.reason, attemptsLeft: 0, retryAfterSec: v.retryAfterSec } : { reason: v.reason, attemptsLeft: v.attemptsLeft });
      }
      const p = phone;
      const found = await this.uow.run(null, async (tx) => {
        const u = await this.users.getByPhoneForUpdate(tx, p);
        return u && u.isLoginable ? u.id : null;
      });
      if (!found) { this.metrics.inc('gov_console.refused', { reason: 'no_access' }); throw govRefused('GOV_ACCESS_NONE'); }
      userId = found; requested = dto.authorityId;
    }

    const memberOf = await this.uow.run(null, (tx) => this.repo.myAuthoritiesTx(tx), { userId });
    const choice = chooseAuthority(memberOf.map((m) => m.authorityId), requested);
    if (choice.kind === 'none') { this.metrics.inc('gov_console.refused', { reason: 'no_access' }); throw govRefused('GOV_ACCESS_NONE'); }
    if (choice.kind === 'choose') {
      const token = randomBytes(32).toString('base64url');
      await this.cache.set<ChoiceRecord>(keyOf('choice', token), { userId, authorityIds: choice.authorityIds }, GOV_CHOICE_TTL_SEC);
      throw govRefused('GOV_CHOICE_REQUIRED', {
        choiceToken: token, expiresInSec: GOV_CHOICE_TTL_SEC,
        authorities: memberOf.filter((m) => choice.authorityIds.includes(m.authorityId)).map((m) => ({ id: m.authorityId, name: m.name })),
      });
    }
    const authorityId = choice.authorityId;
    const out = await this.uow.run(authorityId, async (tx) => {
      const user = await this.users.getForUpdate(tx, userId);
      if (!user || !user.isLoginable) throw govRefused('GOV_ACCESS_NONE');
      const access = await this.repo.accessTx(tx, userId, authorityId);
      if (access.roles.length === 0) throw govRefused('GOV_ACCESS_NONE');
      // GOV-1 Q5-A: NO confirmed authenticator → NO session row at all; the enrolment step instead.
      if (!(await this.auth.hasConfirmedTotpIn(tx, userId))) return { user, access, s: null };
      user.touchActive(); await this.users.update(tx, user);
      const s = await this.auth.openProvenSessionIn(tx, userId, { ip, device: dto.device, phone, authorityId });
      return { user, access, s };
    }, { userId });
    if (!out.s) {
      const token = randomBytes(32).toString('base64url');
      await this.cache.set<EnrolRecord>(keyOf('enrol', token), { userId, authorityId }, GOV_ENROL_TTL_SEC);
      this.metrics.inc('gov_console.two_factor_required');
      throw govRefused('GOV_TWO_FACTOR_REQUIRED', { enrolToken: token, expiresInSec: GOV_ENROL_TTL_SEC });
    }
    if (out.s.pending) { this.metrics.inc('gov_console.two_factor_pending'); throw new TwoFactorPendingError(out.s.refreshToken); }
    this.metrics.inc('gov_console.login_success');
    return this.auth.mintGov(out.user, authorityId, out.s.sessionId, out.s.refreshToken, out.access);
  }

  async verifyTwoFactor(dto: { challengeToken: string; code?: string; recoveryCode?: string }, ip: string | null): Promise<AuthTokens> {
    try {
      const out = await this.uow.run(null, async (tx) => {
        const done = await this.auth.completeGovTwoFactorIn(tx, dto.challengeToken, { code: dto.code ?? null, recoveryCode: dto.recoveryCode ?? null }, ip);
        await this.repo.setSessionUserTx(tx, done.userId);
        const access = await this.repo.accessTx(tx, done.userId, done.authorityId);
        if (access.roles.length === 0) throw govRefused('GOV_ACCESS_NONE');
        const user = await this.users.getForUpdate(tx, done.userId);
        return { done, access, user };
      });
      if (!out.user) throw govRefused('GOV_ACCESS_NONE');
      return this.auth.mintGov(out.user, out.done.authorityId, out.done.sessionId, out.done.refreshToken, out.access);
    } catch (e) {
      await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone: null, method: 'totp', ip })).catch(() => undefined);
      throw namedGovRefusal(e);
    }
  }

  // ─── the enrolment step (Q5-A): no session exists; the enrol token (phone proven + live membership) is the only credential
  private async enrolRecord(enrolToken: string): Promise<EnrolRecord> {
    const rec = await this.cache.get<EnrolRecord>(keyOf('enrol', enrolToken)).catch(() => null);
    if (!rec) throw govRefused('GOV_ENROL_TOKEN_INVALID');
    return rec;
  }
  async enrol(enrolToken: string, ip: string | null) {
    const rec = await this.enrolRecord(enrolToken);
    return this.twoFactor.enrol({ userId: rec.userId, tenantId: '', authorityId: rec.authorityId, ip, requestId: null });
  }
  async confirm(enrolToken: string, code: string, ip: string | null) {
    const rec = await this.enrolRecord(enrolToken);
    const out = await this.twoFactor.confirm({ userId: rec.userId, tenantId: '', authorityId: rec.authorityId, ip, requestId: null }, code);
    await this.cache.del(keyOf('enrol', enrolToken)).catch(() => undefined);   // single use once it has done its job
    return { ...out, next: 'sign_in_again' as const };
  }

  async refresh(refreshToken: string, ip: string | null): Promise<AuthTokens> {
    const out = await this.uow.run(null, async (tx) => {
      const r = await this.auth.rotateGovSessionIn(tx, refreshToken, ip);
      if (!r) return null;
      await this.repo.setSessionUserTx(tx, r.userId);
      const access = await this.repo.accessTx(tx, r.userId, r.authorityId);
      if (access.roles.length === 0) return null;   // removed, or the membership's end has passed
      const user = await this.users.getForUpdate(tx, r.userId);
      if (!user || !user.isLoginable) return null;
      return { r, access, user };
    });
    if (!out) {
      await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone: null, method: 'refresh', ip })).catch(() => undefined);
      this.metrics.inc('gov_console.refresh_failed');
      throw new InvalidRefreshError();
    }
    return this.auth.mintGov(out.user, out.r.authorityId, out.r.sessionId, out.r.refreshToken, out.access);
  }

  async logout(s: GovSession): Promise<{ ok: true }> {
    await this.uow.run(s.authorityId, (tx) => this.auth.revokeSessionIn(tx, s.sessionId, s.userId), { userId: s.userId });
    return { ok: true };
  }

  async me(s: GovSession) {
    return this.uow.run(s.authorityId, async (tx) => {
      const authority = await this.repo.authorityTx(tx, s.authorityId);
      const phone = await this.repo.userPhoneTx(tx, s.userId);
      return {
        authority,
        person: { userId: s.userId, roles: s.roles, permissions: [...s.permissions].sort(), phoneMasked: maskPhoneTail(phone), accessEndsAt: s.expiresAt },
        realm: 'gov' as const,
      };
    }, { userId: s.userId });
  }
}
