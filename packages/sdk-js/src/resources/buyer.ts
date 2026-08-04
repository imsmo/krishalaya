// @krishalaya/sdk-js · buyer favourites (module: buyer). The caller's OWN saves + saved searches —
// the server scopes everything to the authenticated user (a non-owner read is impossible; no IDOR).
// Saves are keyset-paginated; add/remove are idempotent server-side.
import { HttpClient } from '../http';
import { SavedItem, SavedSearch, SavedEntityType, Page } from '../types';

export class BuyerResource {
  constructor(private readonly http: HttpClient) {}

  // --- saved items (favourites / watchlist) ---
  /** Save a listing/seller/product/… (idempotent — re-saving is a no-op). */
  async save(entityType: SavedEntityType, entityId: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', 'buyer/saves', { body: { entityType, entityId } })).data;
  }
  /** The caller's saves (optionally filtered by entity type), keyset-paginated. */
  async listSaves(opts: { entityType?: SavedEntityType; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<SavedItem>> {
    const r = await this.http.request<SavedItem[]>('GET', 'buyer/saves', { query: { entityType: opts.entityType, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Un-save (idempotent — ok whether or not it existed). */
  async unsave(entityType: SavedEntityType, entityId: string): Promise<{ ok: boolean; removed: boolean }> {
    return (await this.http.request<{ ok: boolean; removed: boolean }>('DELETE', `buyer/saves/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`)).data;
  }

  // --- saved searches (re-runnable filters) ---
  async createSavedSearch(input: { name: string; query: Record<string, unknown>; notifyNewMatches?: boolean }): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'buyer/saved-searches', { body: input })).data;
  }
  async listSavedSearches(signal?: AbortSignal): Promise<SavedSearch[]> {
    return (await this.http.request<SavedSearch[]>('GET', 'buyer/saved-searches', { signal })).data;
  }
  async deleteSavedSearch(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('DELETE', `buyer/saved-searches/${encodeURIComponent(id)}`)).data;
  }
}
