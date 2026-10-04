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
  /**
   * PC-56 TENANT-SW-c · B3 — a person with confirmed 2FA gets `SdkError` code `TWO_FACTOR_PENDING` from `verifyOtp` (or an invite
   * accept), its `details.challengeToken` naming the pending session (5 minutes). Finish here with a 6-digit TOTP or ONE recovery code.
   */
  async verifyTwoFactor(input: { tenantId: string; challengeToken: string; code?: string; recoveryCode?: string }): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'auth/2fa/verify', { anonymous: true, body: input })).data;
  }
  /** PC-56 TENANT-SW-c · B2 — what a staff invite is (organisation, role, masked phone, status), for the accept page. */
  async lookupInvite(tenantId: string, token: string): Promise<{ organisation: string; roleCode: string; phoneMasked: string; status: string; expiresAt: string }> {
    return (await this.http.request<{ organisation: string; roleCode: string; phoneMasked: string; status: string; expiresAt: string }>('POST', 'auth/invites/lookup', { anonymous: true, body: { tenantId, token } })).data;
  }
  /** PC-56 TENANT-SW-c · B2 — accept: the token AND the OTP sent to the invited phone (request it with `requestOtp`). Signs the person in. */
  async acceptInvite(input: { tenantId: string; token: string; phone: string; code: string; fullName?: string }): Promise<AuthTokens & { invite: { id: string; roleCode: string } }> {
    return (await this.http.request<AuthTokens & { invite: { id: string; roleCode: string } }>('POST', 'auth/invites/accept', { anonymous: true, body: input })).data;
  }
  /** The authenticated caller's profile (uses the bearer token). */
  async me(signal?: AbortSignal): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('GET', 'users/me', { signal })).data;
  }
}
