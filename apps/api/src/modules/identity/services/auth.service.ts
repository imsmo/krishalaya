// modules/identity/services/auth.service.ts
// THE authentication flow (phone-OTP first, the rural-friendly path). Security:
//  • OTP issuance/verification + rate-limit/lockout in core OtpService (Redis, hashed);
//  • on success we register-or-load the global user, bind a device, open a SESSION,
//    and mint a short-lived ACCESS token (HS256) carrying the DB-RESOLVED roles/perms
//    (RoleCache — never client-supplied) + an opaque rotating REFRESH token (only its
//    hash is stored);
//  • EVERY attempt (success or failure) is written to the append-only login_events
//    trail in its own transaction, so failed attempts are never lost on rollback;
//  • generic responses (no account enumeration); all writes idempotent-safe.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { OTP_SERVICE, OtpService, SMS_SENDER, SmsSender } from '../../../core/auth/otp.service';
import { TokenService } from '../../../core/auth/token.service';
import { RefreshTokenService } from '../../../core/auth/refresh-token.service';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { TranslationService } from '../../../core/i18n/translation.service';
import { tryGetRequestContext } from '../../../core/tenancy-context/request-context';
import { AppConfig } from '../../../core/config/app-config';
import { uuidv7 } from '../../../core/database/uuid.util';
import { normalizePhoneE164 } from '../../../shared/utils/phone';
import { InvalidPhoneError, InvalidOtpError, InvalidRefreshError, UserNotActiveError, TenantMembershipSuspendedError } from '../domain/identity.errors';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { User } from '../domain/user.entity';
import { Session } from '../domain/session.entity';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { DeviceRepository } from '../repositories/device.repository';
import { LoginEventRepository } from '../repositories/login-event.repository';
import { VerifyOtpDto, RefreshDto } from '../dto/auth.dto';

/** What `openSessionIn` accepts for a device — the same shape `DeviceSchema` validates on the login route. */
export interface DeviceInput { fingerprint: string; platform?: string; model?: string; osVersion?: string; appVersion?: string; pushToken?: string }

export interface AuthTokens { accessToken: string; refreshToken: string; expiresInSec: number; user: ReturnType<User['toPublic']>; }

@Injectable()
export class AuthService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OTP_SERVICE) private readonly otp: OtpService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly tokens: TokenService,
    private readonly refresh: RefreshTokenService,
    private readonly roleCache: RoleCacheService,
    private readonly i18n: TranslationService,
    private readonly config: AppConfig,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly devices: DeviceRepository,
    private readonly loginEvents: LoginEventRepository,
  ) {}

  /** Step 1: send an OTP. Enumeration-safe (same response whether or not the user exists). */
  async requestOtp(rawPhone: string, _channel: string): Promise<{ sent: true; resendInSec: number; devCode?: string }> {
    const phone = normalizePhoneE164(rawPhone);
    if (!phone) throw new InvalidPhoneError();
    return timed(this.metrics, 'auth.request_otp', {}, async () => {
      const { code, ttlSec } = await this.otp.issue(phone); // throttled inside
      const lang = tryGetRequestContext()?.lang ?? 'en';
      const ttlMin = Math.round(ttlSec / 60);
      const message = this.i18n.t('sms.otp', lang, { code, minutes: ttlMin });
      await this.sms.sendOtp(phone, { code, ttlMin, purpose: 'login', locale: lang }, message);
      this.metrics.inc('auth.otp_requested');
      // dev affordance ONLY outside production, so integration tests/local can complete login.
      return { sent: true, resendInSec: this.config.auth.otp.resendCooldownSec, ...(this.config.auth.exposeOtp ? { devCode: code } : {}) };
    });
  }

  /** Step 2: verify OTP → register-or-login, open a session, mint tokens. */
  async verifyOtp(dto: VerifyOtpDto, ip: string | null): Promise<AuthTokens> {
    const phone = normalizePhoneE164(dto.phone);
    if (!phone) throw new InvalidPhoneError();
    const ok = await this.otp.verify(phone, dto.code);
    if (!ok) {
      await this.uow.run(dto.tenantId, (tx) => this.loginEvents.record(tx, { userId: null, phone, succeeded: false, method: 'otp', ip, deviceFingerprint: dto.device?.fingerprint ?? null }));
      this.metrics.inc('auth.login_failed', { method: 'otp' });
      throw new InvalidOtpError();
    }

    const out = await timed(this.metrics, 'auth.verify_otp', {}, () => this.uow.run(dto.tenantId, async (tx) => {
      let user = await this.users.getByPhoneForUpdate(tx, phone);
      if (!user) {
        user = User.register({ id: uuidv7(), phone, fullName: dto.fullName ?? null });
        await this.users.insert(tx, user);
        await this.flush(tx, user.id, user.pullEvents());
      } else {
        if (!user.isLoginable) throw new UserNotActiveError(user.toProps().status);
        // **AND THEN THE TENANT-SCOPED CHECK, WHICH IS A DIFFERENT QUESTION (PC-56 TENANT-1b-2).** `isLoginable` above
        // asks whether the PLATFORM has stopped this person; this asks whether THIS organisation has suspended their
        // membership. A farmer suspended by Anand FPO signs into their other FPO on the very next line of this method.
        //
        // The refusal is EXPLICIT rather than letting `RoleCacheService` mint a token with zero permissions: an empty
        // permission set produces a console that looks broken, and a member who is being told "your membership is paused"
        // needs to be told that, not shown a blank screen. Both guards exist — see the note on `assertNotSuspended`.
        await this.assertNotSuspended(tx, dto.tenantId, user.id);
        user.touchActive();
        await this.users.update(tx, user);
      }
      const { sessionId, refreshToken } = await this.openSessionIn(tx, user.id, { ip, device: dto.device, phone, method: 'otp' });
      const r = { token: refreshToken };
      await this.outbox.write(tx, { tenantId: dto.tenantId, aggregateType: 'user', aggregateId: user.id, eventType: 'identity.logged_in', payload: { v: 1, userId: user.id, sessionId } });
      return { user, sessionId, refreshToken: r.token };
    }, { userId: undefined }));

    const tokens = await this.mint(out.user, dto.tenantId, out.sessionId, out.refreshToken);
    this.metrics.inc('auth.login_success', { method: 'otp' });
    return tokens;
  }

  /** Step 3: rotate the refresh token → new access+refresh (theft-resistant rotation). */
  async refreshSession(dto: RefreshDto, ip: string | null): Promise<AuthTokens> {
    const hash = this.tokens.hashRefreshToken(dto.refreshToken);
    const out = await this.uow.run(dto.tenantId, async (tx) => {
      const session = await this.sessions.getByRefreshHashForUpdate(tx, hash);
      if (!session || !session.isValid()) return null;
      const user = await this.users.getForUpdate(tx, session.userId);
      if (!user || !user.isLoginable) return null;
      // A live refresh token must not survive a suspension for THIS tenant — otherwise the member keeps renewing access
      // for thirty days. Their refresh token still works for other tenants, which is correct: the token identifies the
      // person, the suspension concerns one relationship. Thrown rather than returned as null so the client gets
      // TENANT_MEMBERSHIP_SUSPENDED instead of a generic invalid-refresh (which would make them re-enter an OTP and hit
      // the same wall without ever learning why).
      await this.assertNotSuspended(tx, dto.tenantId, user.id);
      const r = this.refresh.issue();
      session.rotate(r.hash, r.expiresAt);
      await this.sessions.rotate(tx, session);
      await this.loginEvents.record(tx, { userId: user.id, phone: null, succeeded: true, method: 'refresh', ip, deviceFingerprint: null });
      return { user, sessionId: session.id, refreshToken: r.token };
    });
    if (!out) {
      await this.uow.run(dto.tenantId, (tx) => this.loginEvents.record(tx, { userId: null, phone: null, succeeded: false, method: 'refresh', ip, deviceFingerprint: null }));
      this.metrics.inc('auth.refresh_failed');
      throw new InvalidRefreshError();
    }
    this.metrics.inc('auth.refresh_success');
    return this.mint(out.user, dto.tenantId, out.sessionId, out.refreshToken);
  }

  /** Revoke the current session (or all sessions for the user). */
  async logout(tenantId: string, userId: string, sessionId: string, allDevices: boolean): Promise<{ ok: true }> {
    await this.uow.run(tenantId, async (tx) => {
      if (allDevices) await this.sessions.revokeAllForUser(tx, userId);
      else if (sessionId) await this.sessions.revoke(tx, sessionId, userId);
    }, { userId });
    this.metrics.inc('auth.logout', { all: String(allDevices) });
    return { ok: true };
  }

  // --- helpers ---
  /**
   * Open a session for a user INSIDE the caller's transaction, and record the login.
   *
   * **EXTRACTED FROM `verifyOtp`'s TAIL IN PC-56 TENANT-1d-3a, NOT WRITTEN A SECOND TIME.** Self-serve signup needs the
   * same thing login needs — a device row, a session, a rotated refresh token, a login event — and the one place in this
   * platform that mints credentials must stay one place. A second copy is how a hardening fix lands on one path only.
   */
  async openSessionIn(
    tx: TxContext,
    userId: string,
    ctx: { ip: string | null; device?: DeviceInput; phone?: string | null; method: 'otp' | 'signup' },
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const deviceId = ctx.device ? await this.devices.upsert(tx, userId, ctx.device) : null;
    const sessionId = uuidv7();
    const r = this.refresh.issue();
    const session = Session.create({ id: sessionId, userId, deviceId, refreshTokenHash: r.hash, ip: ctx.ip, expiresAt: r.expiresAt });
    await this.sessions.insert(tx, session);
    // A signup is a login too, and it belongs in the same ledger: an operator investigating an account takeover must see
    // the first session as well as every one after it.
    await this.loginEvents.record(tx, {
      userId, phone: ctx.phone ?? null, succeeded: true, method: ctx.method === 'signup' ? 'otp' : ctx.method,
      ip: ctx.ip, deviceFingerprint: ctx.device?.fingerprint ?? null,
    });
    return { sessionId, refreshToken: r.token };
  }

  /**
   * Open a session in its OWN transaction and mint tokens for it — the entry point self-serve signup uses once the tenant
   * exists. An access token carries the tenant id, so it cannot be minted before there is a tenant to carry.
   */
  async openSessionFor(user: User, tenantId: string, ip: string | null, device?: DeviceInput): Promise<AuthTokens> {
    const out = await this.uow.run(tenantId, (tx) => this.openSessionIn(tx, user.id, { ip, device, method: 'signup' }));
    return this.mint(user, tenantId, out.sessionId, out.refreshToken);
  }

  private async mint(user: User, tenantId: string, sessionId: string, refreshToken: string): Promise<AuthTokens> {
    const access = await this.roleCache.effectiveAccess(user.id, tenantId);
    const accessToken = this.tokens.mintAccessToken({ sub: user.id, tid: tenantId, sid: sessionId, roles: access.roles, perms: access.permissions });
    return { accessToken, refreshToken, expiresInSec: this.config.auth.accessTtlSec, user: user.toPublic() };
  }
  /**
   * Refuse a token for a tenant that has suspended this member (PC-56 TENANT-1b-2).
   *
   * **THIS IS THE SECOND OF TWO GUARDS ON THE SAME OUTCOME, AND THAT IS DELIBERATE.** `RoleCacheService.resolveFromDb`
   * also returns zero roles and zero permissions for a suspended member, so deleting EITHER guard alone leaves the member
   * unable to do anything — which means each is an equivalent mutant of the other and neither can be killed on its own.
   * ADMIN-SWEEP hit exactly this shape and the lesson stands: **verify the PAIR, and keep both.** This one gives the
   * member a sentence they can act on; that one is the backstop that holds for any future path which resolves access
   * without coming through here.
   *
   * No tenant id means no tenant to be suspended from (the anonymous/self-service path), so there is nothing to check.
   */
  private async assertNotSuspended(tx: TxContext, tenantId: string | undefined, userId: string): Promise<void> {
    if (!tenantId) return;
    const r = await tx.query<{ suspended: boolean }>(
      `SELECT ${memberSuspendedSql('$2', '$1')} AS suspended`, [userId, tenantId]);
    if (r.rows[0]?.suspended === true) {
      this.metrics.inc('auth.refused_tenant_suspended');
      throw new TenantMembershipSuspendedError();
    }
  }

  private async flush(tx: TxContext, userId: string, events: { type: string; payload: Record<string, unknown> }[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId: null, aggregateType: 'user', aggregateId: userId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
