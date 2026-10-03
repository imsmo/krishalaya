// @krishalaya/sdk-js · tenant webhooks — PC-56 TENANT-13a. One typed method per route of `/v1/webhooks` (all need `api.manage`).
//
//   • the signing secret is returned by `register` and `rotateSecret` ONLY, in the response body, ONCE (`secretShown: true`). A replayed
//     Idempotency-Key answers `secret: null, secretShown: false` — the platform never stored the plaintext anywhere it could re-read it;
//     a caller must NEVER put the secret in a URL, a log line or a cookie;
//   • every write takes the Idempotency-Key the review / confirm page minted (Law 3); every act takes a reason;
//   • `list()` returns the delivery contract AS BUILT (`contract`) — print it, do not retype it;
//   • `deliveries()` is the tenant's log only (partner deliveries never appear), µs keyset (`nextCursor`), with the computed diagnosis.
import { HttpClient } from '../http';

export type WebhookEndpointStatus = 'active' | 'paused' | 'disabled';
export type WebhookPauseReason = 'exhausted' | 'manual' | 'unsafe_target';
export type WebhookDeliveryState = 'pending' | 'retrying' | 'delivered' | 'held' | 'exhausted' | 'cancelled';
export type WebhookEndpointAct = 'pause' | 'resume' | 'rotate' | 'delete' | 'replay-failed';
export type WebhookGuardReason = 'invalid_url' | 'not_https' | 'has_credentials' | 'bad_port' | 'no_host' | 'blocked_host' | 'single_label_host' | 'private_address' | 'unresolvable' | 'no_address';
export interface WebhookRefusal { field: string | null; code: string }

export interface WebhookCatalogueEntry { name: string; payloadVersion: number; fields: string[] }
export interface WebhookContract {
  ladder: string[]; attemptsPerCycle: number; pausesEndpointAfterExhaustion: boolean; holdsWhilePaused: boolean; rotationOverlapHours: number;
  retentionDays: number; timeoutSeconds: number; responseCapKiB: number; payloadVersion: number; signatureHeader: string;
  secretStorage: 'encrypted_at_rest_shown_once'; redirects: 'refused'; ports: number[];
}
export interface WebhookEndpointStats { attempts7d: number; okAttempts7d: number; successBp7d: number | null; delivered7d: number; failedToday: number; held: number; failedOpen: number }
export interface WebhookEndpointView {
  id: string; url: string; host: string; eventTypes: string[]; status: WebhookEndpointStatus; pausedReason: WebhookPauseReason | null; pausedAt: string | null;
  isActive: boolean; secretHint: string | null; secretRotatedAt: string | null; previousSecretSignsUntil: string | null; developerEmail: string | null;
  createdAt: string; stats: WebhookEndpointStats | null;
}
export interface WebhookEndpointList { items: WebhookEndpointView[]; total: number; contract: WebhookContract }
export interface WebhookRegistrationInput { url: string; eventTypes: string[]; developerEmail: string }
export interface WebhookRegistrationReview {
  ready: boolean; refusals: WebhookRefusal[];
  url: { value: string; verdict: 'public' | 'refused' | 'not_checked'; reason: WebhookGuardReason | null; host: string | null; addresses: string[] };
  events: WebhookCatalogueEntry[]; developerEmail: string;
}
export interface WebhookRegistered {
  id: string; url: string; eventTypes: string[]; status: 'active'; secretHint: string; developerEmail: string;
  /** shown ONCE; null on a replayed key */
  secret: string | null; secretShown: boolean;
}
export interface WebhookActVerdict {
  endpoint: WebhookEndpointView; act: WebhookEndpointAct; allowed: boolean; refusals: string[];
  effect: { holds?: number; replays?: number; cancels?: number; previousSignsUntil?: string | null; guard?: { verdict: 'public' | 'refused'; reason: WebhookGuardReason | null } };
}
export interface WebhookActResult { id: string; act: WebhookEndpointAct; moved: number; status: WebhookEndpointStatus | 'deleted' }
export interface WebhookRotated { id: string; secretHint: string; previousSecretSignsUntil: string; secret: string | null; secretShown: boolean }

export interface WebhookDelivery {
  id: string; createdAt: string; endpointId: string; endpointHost: string; endpointStatus: WebhookEndpointStatus; eventType: string; eventRef: string | null;
  payloadVersion: number | null; state: WebhookDeliveryState; attempts: number; statusCode: number | null; lastError: string | null; lastAttemptAt: string | null;
  deliveredAt: string | null; replayCount: number; nextRetryAt: string | null; nextRetryStep: string | null;
}
export interface WebhookDiagnosis { failures: number; codes: Array<{ code: string; count: number }>; endpoints: Array<{ id: string; host: string; count: number }>; since: string | null; singleCause: boolean }
export interface WebhookDeliveryPage { items: WebhookDelivery[]; nextCursor: string | null; total: number; failed: number; diagnosis: WebhookDiagnosis | null; retentionDays: number }
export interface WebhookAttempt { attemptNo: number; outcome: 'delivered' | 'failed' | 'refused'; statusCode: number | null; durationMs: number; error: string | null; signedAt: string | null; signatures: number; createdAt: string }
export interface WebhookDeliveryDetail extends WebhookDelivery { payload: unknown; masked: true; attemptsList: WebhookAttempt[] }
export interface WebhookDeliveryQuery { endpointId?: string; status?: 'all' | 'failed' | 'delivered' | 'held' | 'pending'; since?: string; cursor?: string; limit?: number }

const enc = encodeURIComponent;

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /** The public catalogue: name, payload version, the fields a v1 payload carries. */
  async events(signal?: AbortSignal): Promise<WebhookCatalogueEntry[]> {
    return (await this.http.request<WebhookCatalogueEntry[]>('GET', 'webhooks/events', { signal })).data;
  }
  /** The endpoints (never a secret), their 7-day figures, the count and the delivery contract as built. */
  async list(signal?: AbortSignal): Promise<WebhookEndpointList> {
    return (await this.http.request<WebhookEndpointList>('GET', 'webhooks', { signal })).data;
  }
  /** The registration review (live guard verdict). Writes nothing. */
  async preview(input: Partial<WebhookRegistrationInput>): Promise<WebhookRegistrationReview> {
    return (await this.http.request<WebhookRegistrationReview>('POST', 'webhooks/preview', { body: input })).data;
  }
  /** Register. The returned `secret` is shown ONCE — store it to verify signatures. */
  async register(input: WebhookRegistrationInput, idempotencyKey: string): Promise<WebhookRegistered> {
    return (await this.http.request<WebhookRegistered>('POST', 'webhooks', { body: input, idempotencyKey })).data;
  }
  /** Change the event subscriptions (reasoned). */
  async update(id: string, input: { eventTypes: string[]; reason: string }, idempotencyKey: string): Promise<{ id: string; eventTypes: string[] }> {
    return (await this.http.request<{ id: string; eventTypes: string[] }>('PATCH', `webhooks/${enc(id)}`, { body: input, idempotencyKey })).data;
  }
  /** The confirm step's verdict for an act (read-only). Pass `reason` to have it judged too. */
  async previewAct(id: string, act: WebhookEndpointAct, reason?: string): Promise<WebhookActVerdict> {
    return (await this.http.request<WebhookActVerdict>('POST', `webhooks/${enc(id)}/acts/${enc(act)}/preview`, { body: reason === undefined ? {} : { reason } })).data;
  }
  async pause(id: string, reason: string, idempotencyKey: string): Promise<WebhookActResult> {
    return (await this.http.request<WebhookActResult>('POST', `webhooks/${enc(id)}/pause`, { body: { reason }, idempotencyKey })).data;
  }
  async resume(id: string, reason: string, idempotencyKey: string): Promise<WebhookActResult> {
    return (await this.http.request<WebhookActResult>('POST', `webhooks/${enc(id)}/resume`, { body: { reason }, idempotencyKey })).data;
  }
  async replayFailed(id: string, reason: string, idempotencyKey: string): Promise<WebhookActResult> {
    return (await this.http.request<WebhookActResult>('POST', `webhooks/${enc(id)}/replay-failed`, { body: { reason }, idempotencyKey })).data;
  }
  /** Rotate; returns the new `secret` ONCE. The previous secret keeps signing for 24 h. */
  async rotateSecret(id: string, reason: string, idempotencyKey: string): Promise<WebhookRotated> {
    return (await this.http.request<WebhookRotated>('POST', `webhooks/${enc(id)}/rotate-secret`, { body: { reason }, idempotencyKey })).data;
  }
  /** Soft delete (reasoned); the open deliveries are cancelled. */
  async remove(id: string, reason: string, idempotencyKey: string): Promise<WebhookActResult> {
    return (await this.http.request<WebhookActResult>('DELETE', `webhooks/${enc(id)}`, { body: { reason }, idempotencyKey })).data;
  }

  /** The delivery log (tenant endpoints only), µs keyset, with the window's counts and the computed diagnosis. */
  async deliveries(q: WebhookDeliveryQuery = {}, signal?: AbortSignal): Promise<WebhookDeliveryPage> {
    return (await this.http.request<WebhookDeliveryPage>('GET', 'webhooks/deliveries', { query: { ...q }, signal })).data;
  }
  /** One delivery: the payload MASKED and every attempt. */
  async delivery(id: string, signal?: AbortSignal): Promise<WebhookDeliveryDetail> {
    return (await this.http.request<WebhookDeliveryDetail>('GET', `webhooks/deliveries/${enc(id)}`, { signal })).data;
  }
  async previewReplay(id: string, reason?: string): Promise<{ delivery: WebhookDelivery; allowed: boolean; refusals: string[] }> {
    return (await this.http.request<{ delivery: WebhookDelivery; allowed: boolean; refusals: string[] }>('POST', `webhooks/deliveries/${enc(id)}/acts/replay/preview`, { body: reason === undefined ? {} : { reason } })).data;
  }
  /** Replay one delivery: the original payload, a fresh signature. */
  async replay(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; state: 'pending' }> {
    return (await this.http.request<{ id: string; state: 'pending' }>('POST', `webhooks/deliveries/${enc(id)}/replay`, { body: { reason }, idempotencyKey })).data;
  }
}
