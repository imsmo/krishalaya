// @krishalaya/sdk-js · catalogue browse (GET /v1/products) — platform-master + tenant products.
import { HttpClient } from '../http';
import { ProductCard, Page } from '../types';

export class CatalogueResource {
  constructor(private readonly http: HttpClient) {}
  async browseProducts(query: { q?: string; categoryId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ProductCard>> {
    const r = await this.http.request<ProductCard[]>('GET', 'products', { signal, query });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
