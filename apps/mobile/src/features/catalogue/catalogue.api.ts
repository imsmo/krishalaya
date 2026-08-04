// apps/mobile/src/features/catalogue/catalogue.api.ts · data layer for the catalogue product picker used by
// create-listing. Keeps the screen thin (guide §3). Uses the typed SDK catalogue resource; degrade-never-die
// (empty array on failure). The product gives the create flow the productId + categoryId + default unit the API
// requires — we never fabricate ids.
import type { ProductCard } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';

export async function searchProducts(q: string, limit = 8): Promise<ProductCard[]> {
  if (q.trim().length < 2) return [];
  try { return (await apiClient().catalogue.browseProducts({ q: q.trim(), limit })).items; }
  catch { return []; }
}
