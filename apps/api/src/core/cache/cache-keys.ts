// core/cache/cache-keys.ts · ALL cache keys in ONE place. Tenant-prefixed where the
// datum is tenant-scoped; user/phone-scoped for identity. Centralising keys prevents
// collisions and makes invalidation auditable.
export const CacheKeys = {
  // OTP (Redis only; never Postgres). Phone is E.164.
  otp: (phone: string) => `auth:otp:${phone}`,
  otpRequestCount: (phone: string) => `auth:otp:reqcount:${phone}`,
  otpResendCooldown: (phone: string) => `auth:otp:cooldown:${phone}`,
  otpLock: (phone: string) => `auth:otp:lock:${phone}`,
  otpVerifyCount: (phone: string) => `auth:otp:verifycount:${phone}`,
  // PC-56 STORE-1a · A2(b): when the per-phone hourly windows close (epoch seconds) — so a 429 can state its wait (`retryAfterSec`).
  otpRequestWindowUntil: (phone: string) => `auth:otp:requntil:${phone}`,
  otpVerifyWindowUntil: (phone: string) => `auth:otp:verifyuntil:${phone}`,
  // effective RBAC permissions for a user within a tenant (resolved from DB)
  effectivePerms: (tenantId: string, userId: string) => `rbac:perms:${tenantId}:${userId}`,
  // single listing detail cache (used by listings module)
  listing: (tenantId: string, id: string) => `t:${tenantId}:listing:${id}`,
} as const;
