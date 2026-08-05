
// --- product batches (PC-50 W10-4 store owner; server-gated by product.manage) ---
export interface ProductBatch {
  id: string; productId: string; batchNo: string; mfgDate?: string | null; expiryDate?: string | null;
  mrpMinor?: string | null; currencyCode?: string; qtyReceived?: number; unitCode?: string;
  status?: string; recalledAt?: string | null; createdAt?: string; [k: string]: unknown;
}
export interface CreateBatchInput {
  productId: string; batchNo: string; mfgDate?: string; expiryDate?: string;
  mrpMinor?: string; currencyCode?: string; qtyReceived: number; unitCode: string;
}
// @krishalaya/sdk-js · catalogue browse (GET /v1/products) — platform-master + tenant products.
import { HttpClient } from '../http';
import { ProductCard, Page } from '../types';

export class CatalogueResource {
  constructor(private readonly http: HttpClient) {}
  async browseProducts(query: { q?: string; categoryId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ProductCard>> {
    const r = await this.http.request<ProductCard[]>('GET', 'products', { signal, query });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // --- product batches (PC-50 W10-4; MRP is a bigint minor STRING — Law 2) ---
  async listBatches(params: { productId?: string; includeExpired?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<ProductBatch[]> {
    return (await this.http.request<ProductBatch[]>('GET', 'product-batches', { query: { productId: params.productId, includeExpired: params.includeExpired, limit: params.limit ?? 50 }, signal })).data;
  }
  /** Goods-inward a batch — idempotent (a stock receipt must never double-book). */
  async createBatch(input: CreateBatchInput, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'product-batches', { body: input, idempotencyKey })).data;
  }
  /** Pull a batch from sale (recall/expiry). The reason is audited server-side. */
  async recallBatch(id: string, reason: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `product-batches/${encodeURIComponent(id)}/recall`, { body: { reason } })).data;
  }
}
