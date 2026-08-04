// @krishalaya/sdk-js · auth resource (phone-OTP login, mirrors the identity module). The SDK never stores
// tokens — it returns them to the host, which decides storage (httpOnly cookie on the server, memory in the
// browser). requestOtp is enumeration-safe by API contract (same response whether or not the phone exists).
import { HttpClient } from '../http';
import { AuthTokens, UserProfile } from '../types';

export class AuthResource {
  constructor(private readonly http: HttpClient) {}
  /** Request a login OTP for a phone (E.164). Anonymous; rate-limited + enumeration-safe by the API. */
  async requestOtp(phone: string, idempotencyKey: string): Promise<{ requested: boolean }> {
    return (await this.http.request<{ requested: boolean }>('POST', 'auth/otp', { anonymous: true, idempotencyKey, body: { phone } })).data;
  }
  /**
   * Verify an OTP → access + refresh tokens. Anonymous. The API scopes login to a tenant, so `tenantId` is
   * required by the server; `fullName` is captured only on first-time registration of a new user.
   */
  async verifyOtp(phone: string, code: string, idempotencyKey: string, tenantId?: string, fullName?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'auth/verify', {
      anonymous: true, idempotencyKey,
      body: { phone, code, ...(tenantId ? { tenantId } : {}), ...(fullName ? { fullName } : {}) },
    })).data;
  }
  /** Rotate the refresh token (the API invalidates the old one). The API scopes refresh to a tenant, so `tenantId`
   *  is required by the server (same tenant the session was minted for). */
  async refresh(refreshToken: string, tenantId?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'auth/refresh', {
      anonymous: true, body: { refreshToken, ...(tenantId ? { tenantId } : {}) },
    })).data;
  }
  /** The authenticated caller's profile (uses the bearer token). */
  async me(signal?: AbortSignal): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('GET', 'users/me', { signal })).data;
  }
}
