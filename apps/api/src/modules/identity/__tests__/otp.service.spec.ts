// modules/identity/__tests__/otp.service.spec.ts · OTP security: single-use, attempt cap +
// lockout, rate limit, resend cooldown — all proven against the real in-memory cache.
import { OtpService } from '../../../core/auth/otp.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { AppConfig } from '../../../core/config/app-config';
import { TooManyRequestsError } from '../../../shared/errors/app-error';

function cfg(overrides: Record<string, string> = {}): AppConfig {
  return new AppConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'test-secret-test-secret',
    AUTH_HASH_PEPPER: 'pepper-pepper-pepper-pepper-32!!', OTP_LENGTH: '6', OTP_MAX_VERIFY_ATTEMPTS: '3',
    OTP_REQUEST_MAX_PER_HOUR: '2', OTP_RESEND_COOLDOWN_SEC: '0', ...overrides,
  });
}
const phone = '+919876543210';

describe('OtpService', () => {
  it('issues then verifies the correct code once (single-use)', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());
    const { code } = await svc.issue(phone);
    expect(await svc.verify(phone, code)).toBe(true);
    expect(await svc.verify(phone, code)).toBe(false); // consumed
  });
  it('rejects wrong codes and locks after the attempt cap', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());
    await svc.issue(phone);
    expect(await svc.verify(phone, '000000')).toBe(false);
    expect(await svc.verify(phone, '000000')).toBe(false);
    expect(await svc.verify(phone, '000000')).toBe(false);
    expect(await svc.verify(phone, '000000')).toBe(false); // exceeds cap → locked
  });
  it('enforces the per-hour request rate limit', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());
    await svc.issue(phone); await svc.issue(phone);
    await expect(svc.issue(phone)).rejects.toBeInstanceOf(TooManyRequestsError);
  });
  it('throttles verify attempts per hour (anti brute-force / DB-write amplification)', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg({ OTP_VERIFY_MAX_PER_HOUR: '3' }));
    await svc.issue(phone);
    await svc.verify(phone, '000000'); await svc.verify(phone, '000000'); await svc.verify(phone, '000000');
    await expect(svc.verify(phone, '000000')).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('enforces resend cooldown', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg({ OTP_RESEND_COOLDOWN_SEC: '60' }));
    await svc.issue(phone);
    await expect(svc.issue(phone)).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  // ── PC-56 STORE-1a · A2 — the refusals state their wait, and a failed verification says which of the three it was ──
  it('STORE-1a · a cooldown refusal carries retryAfterSec (≤ the cooldown) and names its rule', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg({ OTP_RESEND_COOLDOWN_SEC: '60' }));
    expect((await svc.issue(phone)).ttlSec).toBe(300);
    const e = await svc.issue(phone).catch((x) => x);
    expect(e).toBeInstanceOf(TooManyRequestsError);
    expect(e.details.limit).toBe('resend_cooldown');
    expect(e.details.retryAfterSec).toBeGreaterThan(0);
    expect(e.details.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it('STORE-1a · the hourly request cap carries retryAfterSec (≤ 3600) and its max', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());
    await svc.issue(phone); await svc.issue(phone);
    const e = await svc.issue(phone).catch((x) => x);
    expect(e.details).toMatchObject({ limit: 'requests_per_hour', max: 2 });
    expect(e.details.retryAfterSec).toBeGreaterThan(3500);
    expect(e.details.retryAfterSec).toBeLessThanOrEqual(3600);
  });
  it('STORE-1a · wrong → attemptsLeft counts down, the cap LOCKS (with the wait), a locked phone stays locked', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());   // OTP_MAX_VERIFY_ATTEMPTS 3
    const { code } = await svc.issue(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await svc.verifyDetailed(phone, wrong)).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 2 });
    expect(await svc.verifyDetailed(phone, wrong)).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 1 });
    expect(await svc.verifyDetailed(phone, wrong)).toEqual({ ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: 300 });
    const again = await svc.verifyDetailed(phone, code);              // even the right code: locked
    expect(again).toMatchObject({ ok: false, reason: 'locked', attemptsLeft: 0 });
    expect((again as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
  });
  it('STORE-1a · no live code (never sent / consumed) → expired', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg());
    expect(await svc.verifyDetailed(phone, '123456')).toEqual({ ok: false, reason: 'expired', attemptsLeft: 0 });
    const { code } = await svc.issue(phone);
    expect(await svc.verifyDetailed(phone, code)).toEqual({ ok: true });
    expect(await svc.verifyDetailed(phone, code)).toEqual({ ok: false, reason: 'expired', attemptsLeft: 0 });
  });
  it('STORE-1a · the hourly verify cap is a 429 with retryAfterSec', async () => {
    const svc = new OtpService(new InMemoryCacheService(), cfg({ OTP_VERIFY_MAX_PER_HOUR: '1' }));
    await svc.issue(phone);
    await svc.verifyDetailed(phone, '000000');
    const e = await svc.verifyDetailed(phone, '000000').catch((x) => x);
    expect(e).toBeInstanceOf(TooManyRequestsError);
    expect(e.details).toMatchObject({ limit: 'verifications_per_hour', max: 1 });
    expect(e.details.retryAfterSec).toBeGreaterThan(0);
  });
});
