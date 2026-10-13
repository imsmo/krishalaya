// @krishalaya/sdk-js · auth resource (phone-OTP login, mirrors the identity module). The SDK never stores
// tokens — it returns them to the host, which decides storage (httpOnly cookie on the server, memory in the
// browser). requestOtp is enumeration-safe by API contract (same response whether or not the phone exists).
import { HttpClient } from '../http';
import { AuthTokens, UserProfile, OtpRequestResult, OtpChannel, AuthSessionSummary } from '../types';

export class AuthResource {
  constructor(private readonly http: HttpClient) {}
  /**
   * Request a login OTP for a phone (E.164 or a national number the API's normaliser accepts). Anonymous; rate-limited + enumeration-safe.
   * PC-56 STORE-1a · B1: typed to the REAL answer — `{ sent, resendInSec, ttlSec }` (the old `{ requested }` type never existed on the
   * wire). `channel` is optional (the API defaults to `sms`); `ivr` and `whatsapp` are refused by name (409 OTP_CHANNEL_UNAVAILABLE).
   * `idempotencyKey` stays the second positional argument, so every existing caller compiles unchanged.
   */
  async requestOtp(phone: string, idempotencyKey?: string, channel?: OtpChannel): Promise<OtpRequestResult> {
    return (await this.http.request<OtpRequestResult>('POST', 'auth/otp', { anonymous: true, idempotencyKey, body: { phone, ...(channel ? { channel } : {}) } })).data;
  }
  /**
   * Verify an OTP → access + refresh tokens. Anonymous. PC-56 STORE-1a · A3: `tenantId` is OPTIONAL — when omitted, the API signs the
   * person into the LIVE tenant the request's context resolved (`X-Tenant-Slug`, or a verified storefront host), and answers 422
   * TENANT_REQUIRED when there is none. `fullName` is captured only on first-time registration of a new user.
   * A wrong / expired / locked code is `SdkError` 401 `OTP_INVALID` whose `details` is `OtpInvalidDetails`.
   */
  async verifyOtp(phone: string, code: string, idempotencyKey?: string, tenantId?: string, fullName?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'auth/verify', {
      anonymous: true, idempotencyKey,
      body: { phone, code, ...(tenantId ? { tenantId } : {}), ...(fullName ? { fullName } : {}) },
    })).data;
  }
  /** Rotate the refresh token (the API invalidates the old one). PC-56 STORE-1a: `tenantId` is optional (context fallback as verify);
   *  pass the tenant the session was minted for. */
  async refresh(refreshToken: string, tenantId?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'auth/refresh', {
      anonymous: true, body: { refreshToken, ...(tenantId ? { tenantId } : {}) },
    })).data;
  }
  /** PC-56 STORE-1a · B6 — revoke the CALLER's session server-side (bearer required), or every session of the person with
   *  `allDevices`. The refresh token of a revoked session answers REFRESH_INVALID afterwards. */
  async logout(opts: { allDevices?: boolean } = {}): Promise<{ ok: true }> {
    return (await this.http.request<{ ok: true }>('POST', 'auth/logout', { body: { allDevices: opts.allDevices === true } })).data;
  }
  /** PC-56 STORE-1a · B6/A4 — the caller's sessions: device family + last active, never an IP or a place. */
  async sessions(signal?: AbortSignal): Promise<AuthSessionSummary[]> {
    return (await this.http.request<AuthSessionSummary[]>('GET', 'auth/sessions', { signal })).data;
  }
  /** PC-56 STORE-1a · B6 — revoke one of the caller's own sessions. */
  async revokeSession(sessionId: string): Promise<{ ok: true }> {
    return (await this.http.request<{ ok: true }>('DELETE', `auth/sessions/${encodeURIComponent(sessionId)}`)).data;
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
