// @krishalaya/sdk-js · DPDP privacy resource (P-23 data-download / account-delete / change-phone).
// LIVE (identity PrivacyController): consents (list/grant), data-export requests, account-DELETION requests
// (erasure — server records the request, runs a statutory 90-day cooling-off + retention/anti-fraud holds, then
// erases; the app NEVER deletes locally — Law 11), and a `myRequests` status read. Phone change is OTP-verified
// server-side. All writes are idempotent (Law 3). The app never fabricates an export file or a deletion outcome.
import { HttpClient } from '../http';
import { PrivacyRequest, ConsentRecord } from '../types';

export class PrivacyResource {
  constructor(private readonly http: HttpClient) {}
  /** The caller's DPDP consent records (purpose → granted). Live surface (append-only grants). */
  async listConsents(signal?: AbortSignal): Promise<ConsentRecord[]> {
    return (await this.http.request<ConsentRecord[]>('GET', 'privacy/consents', { signal })).data;
  }
  /** Grant or withdraw a consent purpose (server appends a new consent record; the app never mutates in place).
   *  Idempotent (Law 3). */
  async setConsent(purposeCode: string, granted: boolean, idempotencyKey: string): Promise<ConsentRecord> {
    return (await this.http.request<ConsentRecord>('POST', 'privacy/consents', { idempotencyKey, body: { purposeCode, granted } })).data;
  }
  /** Request a DPDP data export (the server compiles + emails/links it). Optional `format` ('data' = CSV+JSON
   *  bundle, 'pdf' = report). Idempotent. */
  async requestDataExport(idempotencyKey: string, format?: string): Promise<PrivacyRequest> {
    const body = format ? { format } : {};
    return (await this.http.request<PrivacyRequest>('POST', 'privacy/export-requests', { idempotencyKey, body })).data;
  }
  /** Request account deletion (DPDP erasure; server runs retention/anti-fraud holds then erases). Idempotent. */
  async requestAccountDeletion(input: { reason?: string }, idempotencyKey: string): Promise<PrivacyRequest> {
    return (await this.http.request<PrivacyRequest>('POST', 'privacy/deletion-requests', { idempotencyKey, body: input })).data;
  }
  /** The caller's own data-subject requests (status tracking). */
  async myRequests(signal?: AbortSignal): Promise<PrivacyRequest[]> {
    return (await this.http.request<PrivacyRequest[]>('GET', 'privacy/requests', { signal })).data;
  }
  /** Start a phone-number change — the server sends an OTP to the NEW number (enumeration-safe). An optional
   *  `reason` is recorded for audit/risk. Idempotent. */
  async startPhoneChange(newPhone: string, idempotencyKey: string, reason?: string): Promise<{ ok: boolean }> {
    const body = reason ? { newPhone, reason } : { newPhone };
    return (await this.http.request<{ ok: boolean }>('POST', 'auth/change-phone/start', { idempotencyKey, body })).data;
  }
  /** Confirm the phone change with the OTP sent to the new number. */
  async confirmPhoneChange(newPhone: string, code: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', 'auth/change-phone/confirm', { body: { newPhone, code } })).data;
  }
}
