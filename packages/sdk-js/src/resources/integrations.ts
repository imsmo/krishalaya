// @krishalaya/sdk-js · tenant integrations resource (P1-11). A tenant admin connects/disconnects its OWN
// third-party provider credentials. The raw credential is sent once on connect and is vaulted SERVER-SIDE (only a
// ref is stored — the app never sees it again); reads are masked (no secret). Authed; gated by tenant.settings.
import { HttpClient } from '../http';
import { IntegrationProvider, TenantIntegration } from '../types';

export class IntegrationsResource {
  constructor(private readonly http: HttpClient) {}

  /** The provider catalogue a tenant may connect. */
  async providers(signal?: AbortSignal): Promise<IntegrationProvider[]> {
    return (await this.http.request<IntegrationProvider[]>('GET', 'integrations/providers', { signal })).data;
  }
  /** The tenant's own integrations (masked — never includes the credential). */
  async list(signal?: AbortSignal): Promise<TenantIntegration[]> {
    return (await this.http.request<TenantIntegration[]>('GET', 'integrations', { signal })).data;
  }
  /** Connect/replace a provider's credentials. The credential is vaulted server-side. Idempotent (Law 3). */
  async connect(input: { providerCode: string; credential: string; config?: Record<string, string | number | boolean> }, idempotencyKey: string): Promise<{ id: string; providerCode: string; connected: boolean }> {
    return (await this.http.request<{ id: string; providerCode: string; connected: boolean }>('POST', 'integrations', { idempotencyKey, body: input })).data;
  }
  /** Disconnect a provider. */
  async disconnect(providerCode: string): Promise<{ providerCode: string; connected: boolean }> {
    return (await this.http.request<{ providerCode: string; connected: boolean }>('DELETE', `integrations/${encodeURIComponent(providerCode)}`, {})).data;
  }
}
