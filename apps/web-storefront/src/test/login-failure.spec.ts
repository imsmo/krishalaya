// apps/web-storefront/src/test/login-failure.spec.ts · PC-56 STORE-1a · C5/C6 — every refusal the API gives is NAMED with its numbers;
// nothing is swallowed into a fake "code sent", and an unknown failure is "unavailable", never success.
import { classifyRequestFailure, classifyVerifyFailure, classifyTwoFactorFailure, failureStep } from '../features/auth/failure';

const sdk = (status: number, code: string, details: Record<string, unknown> = {}) => ({ name: 'SdkError', status, code, details });

describe('STORE-1a · sign-in failures', () => {
  it('request: cooldown / hourly cap / per-connection / invalid / channel / tenant / network', () => {
    expect(classifyRequestFailure(sdk(429, 'TOO_MANY_REQUESTS', { limit: 'resend_cooldown', retryAfterSec: 24 }))).toEqual({ err: 'rate_cooldown', n: 24 });
    expect(classifyRequestFailure(sdk(429, 'TOO_MANY_REQUESTS', { limit: 'requests_per_hour', max: 5, retryAfterSec: 1799.2 }))).toEqual({ err: 'rate_hourly', n: 1800, max: 5 });
    expect(classifyRequestFailure(sdk(429, 'TOO_MANY_REQUESTS', { limit: 5, windowSec: 60 }))).toEqual({ err: 'rate_ip', n: 60 });
    expect(classifyRequestFailure(sdk(422, 'INVALID_PHONE'))).toEqual({ err: 'phone_invalid' });
    expect(classifyRequestFailure(sdk(409, 'OTP_CHANNEL_UNAVAILABLE', { channel: 'ivr' }))).toEqual({ err: 'channel' });
    expect(classifyRequestFailure(sdk(404, 'TENANT_NOT_FOUND'))).toEqual({ err: 'tenant' });
    expect(classifyRequestFailure({ name: 'SdkTimeoutError', message: 'timed out' })).toEqual({ err: 'unavailable' });
    expect(classifyRequestFailure(sdk(500, 'INTERNAL'))).toEqual({ err: 'unavailable' });
  });
  it('verify: wrong (tries left) / expired / locked (wait) / 2FA / suspended / inactive / hourly / network', () => {
    expect(classifyVerifyFailure(sdk(401, 'OTP_INVALID', { reason: 'wrong', attemptsLeft: 2 }))).toEqual({ err: 'code_wrong', left: 2 });
    expect(classifyVerifyFailure(sdk(401, 'OTP_INVALID', { reason: 'expired', attemptsLeft: 0 }))).toEqual({ err: 'code_expired' });
    expect(classifyVerifyFailure(sdk(401, 'OTP_INVALID', {}))).toEqual({ err: 'code_expired' });
    expect(classifyVerifyFailure(sdk(401, 'OTP_INVALID', { reason: 'locked', attemptsLeft: 0, retryAfterSec: 300 }))).toEqual({ err: 'code_locked', n: 300 });
    expect(classifyVerifyFailure(sdk(403, 'TWO_FACTOR_PENDING', { challengeToken: 'c'.repeat(40), expiresInSec: 300 }))).toEqual({ err: 'two_factor', challengeToken: 'c'.repeat(40), challengeSec: 300 });
    expect(classifyVerifyFailure(sdk(403, 'TENANT_MEMBERSHIP_SUSPENDED'))).toEqual({ err: 'suspended' });
    expect(classifyVerifyFailure(sdk(403, 'USER_NOT_ACTIVE', { status: 'blocked' }))).toEqual({ err: 'inactive' });
    expect(classifyVerifyFailure(sdk(429, 'TOO_MANY_REQUESTS', { limit: 'verifications_per_hour', max: 30, retryAfterSec: 600 }))).toEqual({ err: 'rate_verify', n: 600, max: 30 });
    expect(classifyVerifyFailure(new Error('socket hang up'))).toEqual({ err: 'unavailable' });
  });
  it('2FA: invalid / replay / recovery / challenge expired', () => {
    expect(classifyTwoFactorFailure(sdk(401, 'TOTP_INVALID'))).toEqual({ err: 'totp_invalid' });
    expect(classifyTwoFactorFailure(sdk(401, 'TOTP_REPLAY'))).toEqual({ err: 'totp_replay' });
    expect(classifyTwoFactorFailure(sdk(401, 'RECOVERY_CODE_USED'))).toEqual({ err: 'recovery_used' });
    expect(classifyTwoFactorFailure(sdk(401, 'RECOVERY_CODE_INVALID'))).toEqual({ err: 'recovery_invalid' });
    expect(classifyTwoFactorFailure(sdk(401, 'TWO_FACTOR_CHALLENGE_INVALID'))).toEqual({ err: 'challenge_expired' });
    expect(failureStep({ err: 'challenge_expired' }, '2fa')).toBe('phone');
    expect(failureStep({ err: 'code_wrong' }, 'code')).toBe('code');
  });
});
