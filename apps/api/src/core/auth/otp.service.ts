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

@Injectable()
export class OtpService {
  constructor(
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly config: AppConfig,
  ) {}

  private hash(code: string): string {
    return createHmac('sha256', this.config.auth.hashPepper).update(code).digest('hex');
  }

  /** Issue an OTP for `phone`. Returns the raw code (for SMS dispatch) + ttl. Throttled. */
  async issue(phone: string): Promise<{ code: string; ttlSec: number }> {
    const { otp } = this.config.auth;

    if (await this.cache.get<number>(CacheKeys.otpResendCooldown(phone)))
      throw new TooManyRequestsError('Please wait before requesting another code');

    const count = (await this.cache.get<number>(CacheKeys.otpRequestCount(phone))) ?? 0;
    if (count >= otp.requestMaxPerHour)
      throw new TooManyRequestsError('Too many OTP requests; try again later');

    const code = String(randomInt(0, 10 ** otp.length)).padStart(otp.length, '0');
    await this.cache.set<OtpRecord>(CacheKeys.otp(phone), { hash: this.hash(code), attempts: 0 }, otp.ttlSec);
    await this.cache.set(CacheKeys.otpRequestCount(phone), count + 1, 3600);
    if (otp.resendCooldownSec > 0) await this.cache.set(CacheKeys.otpResendCooldown(phone), 1, otp.resendCooldownSec);
    return { code, ttlSec: otp.ttlSec };
  }

  /** Verify; true on success (OTP consumed). Enforces attempt cap + lockout. */
  async verify(phone: string, code: string): Promise<boolean> {
    const { otp } = this.config.auth;
    // Global per-phone verify throttle: bounds brute force across OTP re-issues AND
    // prevents an attacker hammering /auth/verify (each call would otherwise write a
    // login_event). Throws 429 before any work when exceeded.
    const vc = (await this.cache.get<number>(CacheKeys.otpVerifyCount(phone))) ?? 0;
    if (vc >= otp.verifyMaxPerHour) throw new TooManyRequestsError('Too many verification attempts; try again later');
    await this.cache.set(CacheKeys.otpVerifyCount(phone), vc + 1, 3600);
    if (await this.cache.get<number>(CacheKeys.otpLock(phone))) return false; // locked

    const rec = await this.cache.get<OtpRecord>(CacheKeys.otp(phone));
    if (!rec) return false; // expired or never issued

    const attempts = rec.attempts + 1;
    if (attempts > otp.maxVerifyAttempts) {
      await this.cache.del(CacheKeys.otp(phone));
      await this.cache.set(CacheKeys.otpLock(phone), 1, otp.ttlSec); // brief lockout
      return false;
    }

    const a = Buffer.from(this.hash(code));
    const b = Buffer.from(rec.hash);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok) { await this.cache.del(CacheKeys.otp(phone)); return true; } // single-use

    await this.cache.set<OtpRecord>(CacheKeys.otp(phone), { hash: rec.hash, attempts }, otp.ttlSec);
    return false;
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
