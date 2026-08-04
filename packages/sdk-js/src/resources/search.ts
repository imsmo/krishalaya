// @krishalaya/sdk-js · unified cross-entity search (P1-14). One call returns a single ranked list across
// entity types (listings, products, …) from the server's OpenSearch index plane — replacing the old honest
// client-side fan-out. Tenant-isolated server-side; the response says which `engine` answered (`opensearch` or
// the `postgres` fallback) so a degrade is observable. Keyset via an opaque federated `cursor`. Gated by the
// `unified_search` flag (a disabled feature 404s → callers keep their per-entity browse).
import { HttpClient } from '../http';
import { SearchHit, SearchEngine } from '../types';

export interface UnifiedSearchPage { items: SearchHit[]; engine: SearchEngine; nextCursor: string | null; }

export class SearchResource {
  constructor(private readonly http: HttpClient) {}

  /** Search across entity types. `types` is a csv subset (omit for all). `cursor` pages forward. */
  async query(params: { q: string; types?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<UnifiedSearchPage> {
    const r = await this.http.request<SearchHit[]>('GET', 'search', {
      query: { q: params.q, types: params.types, cursor: params.cursor, limit: params.limit ?? 20 }, signal,
    });
    return {
      items: r.data,
      engine: ((r.meta?.engine as SearchEngine) ?? 'postgres'),
      nextCursor: (r.meta?.nextCursor as string | null) ?? null,
    };
  }
}
