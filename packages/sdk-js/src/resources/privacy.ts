// @krishalaya/sdk-js · DPDP privacy resource (P-23 data-download / account-delete / change-phone).
// LIVE (identity PrivacyController): consents (list/grant), data-export requests, account-DELETION requests
// (erasure — server records the request, runs a statutory 90-day cooling-off + retention/anti-fraud holds, then
// erases; the app NEVER deletes locally — Law 11), and a `myRequests` status read. Phone change is OTP-verified
// server-side. All writes are idempotent (Law 3). The app never fabricates an export file or a deletion outcome.
import { HttpClient } from '../http';
import { PrivacyRequest, ConsentRecord, ConsentGrantResult, PrivacyCommitments } from '../types';

/** PC-56 HOTFIX-6 · B5: the ONE consent route (apps/api identity `consents.controller.ts`, `@Controller({ path: 'consents', version: '1' })`). */
export const CONSENTS_PATH = 'consents';

export class PrivacyResource {
  constructor(private readonly http: HttpClient) {}
  /** The caller's DPDP consent records — the LATEST decision per purpose (`{ purposeCode, granted, version, channel, updatedAt }`).
   *  PC-56 HOTFIX-6 · B5 (survey STORE-4 F-4 / C-10): the route is `/v1/consents` (identity ConsentsController) — this called
   *  `privacy/consents`, which does not exist, so mobile's privacy screen and web-partner's /consents failed on every call. */
  async listConsents(signal?: AbortSignal): Promise<ConsentRecord[]> {
    return (await this.http.request<ConsentRecord[]>('GET', CONSENTS_PATH, { signal })).data;
  }
  /** Grant or withdraw a consent purpose (the server APPENDS a record — a withdrawal is a `granted=false` row; history is never mutated).
   *  Idempotent on the key (Law 3): a replay returns the first answer and appends nothing. */
  async setConsent(purposeCode: string, granted: boolean, idempotencyKey: string): Promise<ConsentGrantResult> {
    return (await this.http.request<ConsentGrantResult>('POST', CONSENTS_PATH, { idempotencyKey, body: { purposeCode, granted } })).data;
  }
  /** Request a DPDP data export. PC-56 STORE-4a (founder D2): the server COMPILES it on the export plane (one CSV of everything held about you,
   *  across every organisation, with an audit receipt) — the answer's `export` is the live job (position + ETA while queued). A second request
   *  while one is open answers the SAME request and job. Idempotent on the key. The `format` argument is not read by the server (kept for old
   *  callers). */
  async requestDataExport(idempotencyKey: string, format?: string): Promise<PrivacyRequest> {
    const body = format ? { format } : {};
    return (await this.http.request<PrivacyRequest>('POST', 'privacy/export-requests', { idempotencyKey, body })).data;
  }
  /** Request account deletion (DPDP erasure). PC-56 STORE-4a (founder D1 / D3): REFUSED (`DSR_BLOCKED`, 409, the figures in `details`) while
   *  any order is open, money is in escrow or a wallet balance is above zero — read `commitments()` first; an accepted request cools for 90 days
   *  (`coolingEndsAt`) and is then erased by the platform's data-protection desk. Idempotent. */
  async requestAccountDeletion(input: { reason?: string }, idempotencyKey: string): Promise<PrivacyRequest> {
    return (await this.http.request<PrivacyRequest>('POST', 'privacy/deletion-requests', { idempotencyKey, body: input })).data;
  }
  /** The caller's own data-subject requests (newest first, at most 50). PC-56 STORE-4a: an export request carries its live job (`export`). */
  async myRequests(signal?: AbortSignal): Promise<PrivacyRequest[]> {
    return (await this.http.request<PrivacyRequest[]>('GET', 'privacy/requests', { signal })).data;
  }
  /** PC-56 STORE-4a · B1 (founder D1): the deletion confirm's figures — open orders, escrow, wallet, invoices kept and for how many years, the
   *  cooling days. The caller's own; a read (nothing moves). */
  async commitments(signal?: AbortSignal): Promise<PrivacyCommitments> {
    return (await this.http.request<PrivacyCommitments>('GET', 'privacy/commitments', { signal })).data;
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
