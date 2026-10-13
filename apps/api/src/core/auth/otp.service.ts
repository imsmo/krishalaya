// core/auth/otp.service.ts
// Phone-OTP issuance/verification. OTPs live ONLY in Redis (TTL), NEVER in Postgres.
// Security controls (account-takeover & brute-force resistant):
//  • the OTP is stored HASHED (HMAC-SHA256 with a server pepper) — a Redis dump
//    never reveals codes;
//  • per-phone REQUEST rate limit (default 5/hour) + resend cooldown — stops SMS
//    bombing and enumeration-by-timing;
//  • per-OTP VERIFY attempt cap (default 5) then the phone is briefly LOCKED —
//    stops code brute-forcing;
//  • constant-time compare; single-use (deleted on success);
//  • the raw code is returned to the CALLER only so it can be dispatched via SMS
//    (the caller must never return it to the client in production).
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { CACHE_SERVICE, CacheService } from '../cache/cache.service';
import { CacheKeys } from '../cache/cache-keys';
import { AppConfig } from '../config/app-config';
import { TooManyRequestsError } from '../../shared/errors/app-error';

interface OtpRecord { hash: string; attempts: number; }

/**
 * PC-56 STORE-1a · A2(c) — what a verification attempt REALLY was, so the person is told the truth: their code was wrong (and how many
 * tries this code has left), there is no live code (expired / consumed / never sent), or the code is locked after the attempt cap (and
 * for how long). Same lock semantics as before: `maxVerifyAttempts` wrong guesses on one code, then the phone is locked for the OTP TTL.
 */
export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'expired'; attemptsLeft: 0 }
  | { ok: false; reason: 'locked'; attemptsLeft: 0; retryAfterSec: number };

const nowSec = () => Math.floor(Date.now() / 1000);
/** Seconds until an epoch-second deadline stored in the cache (never below 1 while the key still exists). */
const secondsUntil = (until: number | null | undefined, fallback: number) =>
  typeof until === 'number' && until > 0 ? Math.max(1, until - nowSec()) : Math.max(1, fallback);

@Injectable()
export class OtpService {
  constructor(
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly config: AppConfig,
  ) {}

  private hash(code: string): string {
    return createHmac('sha256', this.config.auth.hashPepper).update(code).digest('hex');
  }

  /**
   * Issue an OTP for `phone`. Returns the raw code (for SMS dispatch) + ttl. Throttled.
   * PC-56 STORE-1a · A2(b): each refusal states its wait — `details.retryAfterSec` (the resend cooldown left, or until the hourly window
   * closes) and `details.limit` naming which rule it was. The per-phone limits are unchanged.
   */
  async issue(phone: string): Promise<{ code: string; ttlSec: number }> {
    const { otp } = this.config.auth;

    const cooldownUntil = await this.cache.get<number>(CacheKeys.otpResendCooldown(phone));
    if (cooldownUntil)
      throw new TooManyRequestsError('Please wait before requesting another code', { limit: 'resend_cooldown', retryAfterSec: secondsUntil(cooldownUntil, otp.resendCooldownSec) });

    const count = (await this.cache.get<number>(CacheKeys.otpRequestCount(phone))) ?? 0;
    if (count >= otp.requestMaxPerHour)
      throw new TooManyRequestsError('Too many OTP requests; try again later', {
        limit: 'requests_per_hour', max: otp.requestMaxPerHour,
        retryAfterSec: secondsUntil(await this.cache.get<number>(CacheKeys.otpRequestWindowUntil(phone)), 3600),
      });

    const code = String(randomInt(0, 10 ** otp.length)).padStart(otp.length, '0');
    await this.cache.set<OtpRecord>(CacheKeys.otp(phone), { hash: this.hash(code), attempts: 0 }, otp.ttlSec);
    await this.cache.set(CacheKeys.otpRequestCount(phone), count + 1, 3600);
    await this.cache.set(CacheKeys.otpRequestWindowUntil(phone), nowSec() + 3600, 3600);
    // The cooldown key holds its own deadline (epoch seconds, always truthy) so a refusal can say how long is left.
    if (otp.resendCooldownSec > 0) await this.cache.set(CacheKeys.otpResendCooldown(phone), nowSec() + otp.resendCooldownSec, otp.resendCooldownSec);
    return { code, ttlSec: otp.ttlSec };
  }

  /** Verify; true on success (OTP consumed). Enforces attempt cap + lockout. Kept for every caller that needs only yes/no. */
  async verify(phone: string, code: string): Promise<boolean> {
    return (await this.verifyDetailed(phone, code)).ok;
  }

  /** PC-56 STORE-1a · A2(c): the same verification, answering WHY it failed. Attempt cap, lockout and single use are unchanged. */
  async verifyDetailed(phone: string, code: string): Promise<OtpVerifyResult> {
    const { otp } = this.config.auth;
    // Global per-phone verify throttle: bounds brute force across OTP re-issues AND
    // prevents an attacker hammering /auth/verify (each call would otherwise write a
    // login_event). Throws 429 before any work when exceeded.
    const vc = (await this.cache.get<number>(CacheKeys.otpVerifyCount(phone))) ?? 0;
    if (vc >= otp.verifyMaxPerHour) {
      throw new TooManyRequestsError('Too many verification attempts; try again later', {
        limit: 'verifications_per_hour', max: otp.verifyMaxPerHour,
        retryAfterSec: secondsUntil(await this.cache.get<number>(CacheKeys.otpVerifyWindowUntil(phone)), 3600),
      });
    }
    await this.cache.set(CacheKeys.otpVerifyCount(phone), vc + 1, 3600);
    await this.cache.set(CacheKeys.otpVerifyWindowUntil(phone), nowSec() + 3600, 3600);
    const lockUntil = await this.cache.get<number>(CacheKeys.otpLock(phone));
    if (lockUntil) return { ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: secondsUntil(lockUntil, otp.ttlSec) }; // locked

    const rec = await this.cache.get<OtpRecord>(CacheKeys.otp(phone));
    if (!rec) return { ok: false, reason: 'expired', attemptsLeft: 0 }; // expired, consumed, or never issued

    const attempts = rec.attempts + 1;
    if (attempts > otp.maxVerifyAttempts) {
      await this.lock(phone);
      return { ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: otp.ttlSec };
    }

    const a = Buffer.from(this.hash(code));
    const b = Buffer.from(rec.hash);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok) { await this.cache.del(CacheKeys.otp(phone)); return { ok: true }; } // single-use

    const attemptsLeft = otp.maxVerifyAttempts - attempts;
    // The cap is reached ON this wrong guess: lock now, so the screen never shows "0 tries left" for a code that still answers.
    if (attemptsLeft <= 0) {
      await this.lock(phone);
      return { ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: otp.ttlSec };
    }
    await this.cache.set<OtpRecord>(CacheKeys.otp(phone), { hash: rec.hash, attempts }, otp.ttlSec);
    return { ok: false, reason: 'wrong', attemptsLeft };
  }

  /** Brief lockout: the live code dies and the phone cannot verify for the OTP TTL (the key holds its own deadline). */
  private async lock(phone: string): Promise<void> {
    const { otp } = this.config.auth;
    await this.cache.del(CacheKeys.otp(phone));
    await this.cache.set(CacheKeys.otpLock(phone), nowSec() + otp.ttlSec, otp.ttlSec);
  }
}
export const OTP_SERVICE = Symbol('OTP_SERVICE');

/** Context for an OTP send — real (DLT) providers template on `code`; never log it. */
export interface SmsOtpContext { code: string; ttlMin: number; purpose: 'login' | 'change_phone' | 'slot_proposal' | 'parcel_handover' | 'parcel_collect'; locale?: string }

/**
 * A pluggable SMS sender. `send` delivers a pre-rendered message (used for dev/noop and free-text providers).
 * `sendOtp` is the OTP path: India's DLT regime forbids raw-text OTP, so real providers (MSG91) override it to
 * send via a DLT-approved OTP TEMPLATE with `code` as a variable. The default delegates to `send(renderedMessage)`
 * so the noop/dev path and free-text providers (Twilio) keep working. OTP codes are NEVER logged.
 */
export abstract class SmsSender {
  abstract send(phone: string, message: string): Promise<void>;
  async sendOtp(phone: string, _ctx: SmsOtpContext, renderedMessage: string): Promise<void> {
    return this.send(phone, renderedMessage);
  }
}
export const SMS_SENDER = Symbol('SMS_SENDER');
