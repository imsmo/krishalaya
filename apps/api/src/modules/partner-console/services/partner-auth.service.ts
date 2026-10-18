// modules/partner-console/services/partner-auth.service.ts · PC-56 PARTNER-0 · founder D1 — SIGN-IN TO THE PARTNER.
//
//   otp      → the platform's phone OTP (AuthService.requestOtp — the same hashed, rate-limited, enumeration-safe code; nothing new is issued).
//   verify   → the OTP proves the phone; the person's ACTIVE partner memberships decide (domain chooseSignIn):
//                none          → 403 PARTNER_ACCESS_NONE (an unknown phone and a phone with no membership answer the SAME — and the caller
//                                already proved they own the phone, so this teaches nothing about anybody else);
//                exactly one   → a partner session (sessions.realm = 'partner') and a token `{ sub, pid, sid, roles, perms, realm }` — no tid;
//                several       → 403 PARTNER_CHOICE_REQUIRED with `{ choiceToken, partners: [{ id, name }] }`; the second verify sends
//                                `{ choiceToken, partnerId }`. The OTP is single use, so the choice rides a 5-minute, single-use token kept
//                                ONLY as its sha256 in the cache (never in a URL) — nothing is minted until a partner is chosen.
//            A person with CONFIRMED TOTP gets a PENDING partner session → 403 TWO_FACTOR_PENDING with the challenge, exactly the tenant flow;
//            `POST /partner/auth/2fa/verify` finishes it (AuthService.completePartnerTwoFactorIn — partner realm only).
//   refresh  → rotates a PARTNER session's refresh token (a tenant refresh token is not one); refused when the session was revoked (a
//              removal revokes them) or the person no longer holds an active membership in that partner (the backstop).
//   me       → the organisation (name, kind, regulator reference by its last 4, the published `sla`) and the person (roles, permissions,
//              phone by its last 3).
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../../../core/auth/otp.service';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { AuthService, AuthTokens, DeviceInput, TwoFactorPendingError } from '../../identity/services/auth.service';
import { UserRepository } from '../../identity/repositories/user.repository';
import { TwoFactorService } from '../../identity/services/two-factor.service';
import { InvalidOtpError, InvalidPhoneError, InvalidRefreshError } from '../../identity/domain/identity.errors';
import { slaDecisionHours } from '../domain/partner-dashboard.rules';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { chooseSignIn, maskPhoneTail, maskRegulatorRef } from '../domain/partner-console.rules';
import { namedPartnerRefusal, partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

export const PARTNER_CHOICE_TTL_SEC = 300;
const choiceKey = (token: string) => `partner:choice:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
interface ChoiceRecord { userId: string; partnerIds: string[] }

export type PartnerVerifyInput = { phone: string; code: string; partnerId?: string; device?: DeviceInput } | { choiceToken: string; partnerId: string; device?: DeviceInput };

@Injectable()
export class PartnerAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly repo: PartnerConsoleRepository,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  requestOtp(phone: string) { return this.auth.requestOtp(phone, 'sms'); }

  async verify(dto: PartnerVerifyInput, ip: string | null): Promise<AuthTokens> {
    let userId: string; let requested: string | undefined; let phone: string | null = null;
    if ('choiceToken' in dto) {
      // THE CHOOSER'S SECOND STEP: single use (deleted before it is honoured), 5 minutes, sha256-keyed.
      const rec = await this.cache.get<ChoiceRecord>(choiceKey(dto.choiceToken)).catch(() => null);
      await this.cache.del(choiceKey(dto.choiceToken)).catch(() => undefined);
      if (!rec || !rec.partnerIds.includes(dto.partnerId)) throw partnerRefused('PARTNER_CHOICE_INVALID');
      userId = rec.userId; requested = dto.partnerId;
    } else {
      phone = normalizePhoneE164(dto.phone);
      if (!phone) throw new InvalidPhoneError();
      const v = await this.otp.verifyDetailed(phone, dto.code);
      if (!v.ok) {
        await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone, method: 'otp', ip, deviceFingerprint: dto.device?.fingerprint ?? null }));
        this.metrics.inc('partner_console.login_failed', { method: 'otp' });
        throw new InvalidOtpError(v.reason === 'locked' ? { reason: v.reason, attemptsLeft: 0, retryAfterSec: v.retryAfterSec } : { reason: v.reason, attemptsLeft: v.attemptsLeft });
      }
      const p = phone;
      const found = await this.uow.run(null, async (tx) => {
        const u = await this.users.getByPhoneForUpdate(tx, p);
        return u && u.isLoginable ? u.id : null;
      });
      if (!found) { this.metrics.inc('partner_console.refused', { reason: 'no_access' }); throw partnerRefused('PARTNER_ACCESS_NONE'); }
      userId = found; requested = dto.partnerId;
    }

    // the person's partners (their OWN rows: app.user_id = them), then the rule
    const memberOf = await this.uow.run(null, (tx) => this.repo.membershipsOfUserTx(tx, userId), { userId });
    const choice = chooseSignIn(memberOf.map((m) => m.partnerId), requested);
    if (choice.kind === 'none') { this.metrics.inc('partner_console.refused', { reason: 'no_access' }); throw partnerRefused('PARTNER_ACCESS_NONE'); }
    if (choice.kind === 'choose') {
      const token = randomBytes(32).toString('base64url');
      await this.cache.set<ChoiceRecord>(choiceKey(token), { userId, partnerIds: choice.partnerIds }, PARTNER_CHOICE_TTL_SEC);
      this.metrics.inc('partner_console.choice_required');
      throw partnerRefused('PARTNER_CHOICE_REQUIRED', {
        choiceToken: token, expiresInSec: PARTNER_CHOICE_TTL_SEC,
        partners: memberOf.filter((m) => choice.partnerIds.includes(m.partnerId)).map((m) => ({ id: m.partnerId, name: m.name })),
      });
    }
    const partnerId = choice.partnerId;
    const out = await this.uow.run(partnerId, async (tx) => {
      const user = await this.users.getForUpdate(tx, userId);
      if (!user || !user.isLoginable) throw partnerRefused('PARTNER_ACCESS_NONE');
      const access = await this.repo.accessTx(tx, userId, partnerId);
      if (access.roles.length === 0) throw partnerRefused('PARTNER_ACCESS_NONE');
      user.touchActive(); await this.users.update(tx, user);
      const s = await this.auth.openProvenSessionIn(tx, userId, { ip, device: dto.device, phone, partnerId });
      return { user, access, s };
    }, { userId });
    if (out.s.pending) { this.metrics.inc('partner_console.two_factor_pending'); throw new TwoFactorPendingError(out.s.refreshToken); }
    this.metrics.inc('partner_console.login_success');
    return this.auth.mintPartner(out.user, partnerId, out.s.sessionId, out.s.refreshToken, out.access);
  }

  async verifyTwoFactor(dto: { challengeToken: string; code?: string; recoveryCode?: string }, ip: string | null): Promise<AuthTokens> {
    try {
      const out = await this.uow.run(null, async (tx) => {
        const done = await this.auth.completePartnerTwoFactorIn(tx, dto.challengeToken, { code: dto.code ?? null, recoveryCode: dto.recoveryCode ?? null }, ip);
        await this.repo.setSessionUserTx(tx, done.userId);
        const access = await this.repo.accessTx(tx, done.userId, done.partnerId);
        if (access.roles.length === 0) throw partnerRefused('PARTNER_ACCESS_NONE');
        const user = await this.users.getForUpdate(tx, done.userId);
        return { done, access, user };
      });
      if (!out.user) throw partnerRefused('PARTNER_ACCESS_NONE');
      return this.auth.mintPartner(out.user, out.done.partnerId, out.done.sessionId, out.done.refreshToken, out.access);
    } catch (e) {
      await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone: null, method: 'totp', ip })).catch(() => undefined);
      throw namedPartnerRefusal(e);
    }
  }

  async refresh(refreshToken: string, ip: string | null): Promise<AuthTokens> {
    const out = await this.uow.run(null, async (tx) => {
      const r = await this.auth.rotatePartnerSessionIn(tx, refreshToken, ip);
      if (!r) return null;
      await this.repo.setSessionUserTx(tx, r.userId);
      const access = await this.repo.accessTx(tx, r.userId, r.partnerId);
      if (access.roles.length === 0) return null;   // removed from the partner (the backstop: a removal also revokes the sessions)
      const user = await this.users.getForUpdate(tx, r.userId);
      if (!user || !user.isLoginable) return null;
      return { r, access, user };
    });
    if (!out) {
      await this.uow.run(null, (tx) => this.auth.recordFailedLoginIn(tx, { phone: null, method: 'refresh', ip })).catch(() => undefined);
      this.metrics.inc('partner_console.refresh_failed');
      throw new InvalidRefreshError();
    }
    return this.auth.mintPartner(out.user, out.r.partnerId, out.r.sessionId, out.r.refreshToken, out.access);
  }

  async logout(s: PartnerSession): Promise<{ ok: true }> {
    await this.uow.run(s.partnerId, (tx) => this.auth.revokeSessionIn(tx, s.sessionId, s.userId), { userId: s.userId });
    return { ok: true };
  }

  async me(s: PartnerSession) {
    return this.uow.run(s.partnerId, async (tx) => {
      const org = await this.repo.partnerOrgTx(tx, s.partnerId);
      const phone = await this.repo.userPhoneTx(tx, s.userId);
      return {
        // PC-56 PARTNER-1a (D5): + the partner code (the settings page's identity block) and the published decision promise as a number
        organisation: org ? { id: org.id, code: org.code, name: org.name, kind: org.kind, regulatorRefMasked: maskRegulatorRef(org.regulatorRef), sla: org.sla, slaDecisionHours: slaDecisionHours(org.sla) } : null,
        person: { userId: s.userId, roles: s.roles, permissions: [...s.permissions].sort(), phoneMasked: maskPhoneTail(phone) },
        realm: 'partner' as const,
      };
    }, { userId: s.userId });
  }

  // ─── the person's OWN second factor, through the per-person TwoFactorService in the partner-realm unit of work
  private tf(s: PartnerSession) { return { userId: s.userId, tenantId: '', partnerId: s.partnerId, ip: s.ip, requestId: s.requestId }; }
  twoFactorState(s: PartnerSession) { return this.twoFactor.state(this.tf(s)); }
  twoFactorEnrol(s: PartnerSession) { return this.twoFactor.enrol(this.tf(s)); }
  twoFactorConfirm(s: PartnerSession, code: string) { return this.twoFactor.confirm(this.tf(s), code); }
}
