// @krishalaya/sdk-js · tenant webhooks resource (P1-11). A tenant admin registers https endpoints, subscribes to
// events, and rotates the signing secret. The signing secret is returned ONLY by register + rotateSecret (shown
// once — the server stores it encrypted and never returns it again). Authed; gated by tenant.settings server-side.
import { HttpClient } from '../http';
import { WebhookEndpoint } from '../types';

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /** The event types an endpoint may subscribe to (allow-list). */
  async events(signal?: AbortSignal): Promise<string[]> {
    return (await this.http.request<string[]>('GET', 'webhooks/events', { signal })).data;
  }
  /** The tenant's endpoints (masked — never includes the secret). */
  async list(signal?: AbortSignal): Promise<WebhookEndpoint[]> {
    return (await this.http.request<WebhookEndpoint[]>('GET', 'webhooks', { signal })).data;
  }
  /** Register an endpoint. The returned `secret` is shown ONCE — store it to verify signatures. */
  async register(input: { url: string; eventTypes: string[] }): Promise<WebhookEndpoint & { secret: string }> {
    return (await this.http.request<WebhookEndpoint & { secret: string }>('POST', 'webhooks', { body: input })).data;
  }
  /** Update an endpoint's event subscriptions / active flag. */
  async update(id: string, patch: { eventTypes?: string[]; isActive?: boolean }): Promise<{ id: string; ok: boolean }> {
    return (await this.http.request<{ id: string; ok: boolean }>('PATCH', `webhooks/${encodeURIComponent(id)}`, { body: patch })).data;
  }
  /** Rotate the signing secret; returns the new `secret` ONCE. */
  async rotateSecret(id: string): Promise<{ id: string; secret: string }> {
    return (await this.http.request<{ id: string; secret: string }>('POST', `webhooks/${encodeURIComponent(id)}/rotate-secret`, {})).data;
  }
  /** Delete an endpoint. */
  async remove(id: string): Promise<{ id: string; ok: boolean }> {
    return (await this.http.request<{ id: string; ok: boolean }>('DELETE', `webhooks/${encodeURIComponent(id)}`, {})).data;
  }
}
