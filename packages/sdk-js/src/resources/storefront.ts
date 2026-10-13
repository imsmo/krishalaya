// @krishalaya/sdk-js · storefront resource — PC-56 STORE-1a · A3/C4. The anonymous storefront's question "which organisation is this
// page?" answered by the API from the request's own tenant context (the client's `tenantSlug` → `X-Tenant-Slug`, or a verified
// storefront host). A 404 TENANT_NOT_FOUND means no LIVE tenant resolved — never a default one.
import { HttpClient } from '../http';
import { StorefrontTenant } from '../types';

export class StorefrontResource {
  constructor(private readonly http: HttpClient) {}
  /** The context-resolved live tenant: id, slug, display name (no PII). Anonymous. */
  async tenant(signal?: AbortSignal): Promise<StorefrontTenant> {
    return (await this.http.request<StorefrontTenant>('GET', 'storefront/tenant', { anonymous: true, signal })).data;
  }
}
