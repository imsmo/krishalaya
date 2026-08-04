// apps/mobile/src/features/buyer/saved.api.ts · the buyer's SAVED lists (listings / sellers / searches).
// SERVER-BACKED (module: buyer — BuyerResource): the server owns MEMBERSHIP (which listings/sellers/searches are
// saved), scoped to the signed-in user (no IDOR), so saves sync across devices. Add/remove are idempotent
// server-side (Law 3), so no Idempotency-Key is required. We ALSO keep an on-device mirror (AsyncStorage,
// non-secret, scoped to the user via currentScope()) as an OFFLINE CACHE: reads reconcile against the server when
// online and DEGRADE to the last-known local snapshot when the network is unreachable (degrade-never-die), and
// writes update the local mirror optimistically then best-effort sync to the server (a failed sync leaves the
// optimistic state to be reconciled on the next successful online read). For saved LISTINGS the server stores only
// the listing id, so the local mirror also holds a small ListingCard snapshot to render offline; on load we keep
// the snapshots whose id is still saved server-side (server-side removals sync in). Money stays a bigint-minor
// string (Law 2). Lists are deduped + capped via the pure saved-set helpers (bounded storage, guide §5).
// §13: a listing saved on ANOTHER device (id present server-side, no local snapshot yet) is omitted rather than
// rendered from fabricated data — it hydrates once the buyer opens it on this device.
import type { ListingCard, SavedEntityType, SavedSearch as ServerSavedSearch } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { asyncStorageKv as kv } from '../../core/offline/kv';
import { currentScope } from '../../core/offline/scope';
import { newId } from '../../core/util/ids';
import { toggleId, dedupeBy, capList, upsertFront } from './saved-set';
import { describeSearch, type FilterForm } from './search-query';

const MAX = 200;
const key = (kind: string) => `buyer.saved.${kind}:${currentScope()}`;

export interface SavedSearch { id: string; label: string; form: FilterForm; savedAt: number }

async function load<T>(kind: string): Promise<T[]> {
  try { const raw = await kv.get(key(kind)); return raw ? (JSON.parse(raw) as T[]) : []; }
  catch { return []; }
}
async function save<T>(kind: string, list: T[]): Promise<void> {
  try { await kv.set(key(kind), JSON.stringify(list)); } catch { /* best-effort; degrade-never-die */ }
}

/** The server's authoritative saved entity-ids for a type (most-recent-first, capped). Throws on failure so the
 * caller can fall back to the local mirror. */
async function serverSavedIds(entityType: SavedEntityType): Promise<string[]> {
  const page = await apiClient().buyer.listSaves({ entityType, limit: MAX });
  return page.items.map((it) => it.entityId);
}

// --- saved listings (server owns membership; local mirror holds render snapshots) ---
export async function getSavedListings(): Promise<ListingCard[]> {
  const local = await load<ListingCard>('listings');
  try {
    const ids = await serverSavedIds('listing');
    // Server is source of truth for WHICH listings are saved; local snapshots provide the card to render.
    const byId = new Map(local.map((l) => [l.id, l] as const));
    const reconciled = ids.map((id) => byId.get(id)).filter((c): c is ListingCard => !!c);
    await save('listings', reconciled);
    return reconciled;
  } catch { return local; } // offline → last-known snapshots
}
export async function toggleSavedListing(card: ListingCard): Promise<ListingCard[]> {
  const list = await load<ListingCard>('listings');
  const exists = list.some((l) => l.id === card.id);
  const next = exists ? list.filter((l) => l.id !== card.id) : capList(dedupeBy([card, ...list], (l) => l.id), MAX);
  await save('listings', next);                                       // optimistic (offline-safe render)
  try { if (exists) await apiClient().buyer.unsave('listing', card.id); else await apiClient().buyer.save('listing', card.id); }
  catch { /* degrade: keep optimistic local state; server reconciles on next online read */ }
  return next;
}

// --- saved sellers (server stores the seller ids; screen hydrates public profiles separately) ---
export async function getSavedSellers(): Promise<string[]> {
  const local = await load<string>('sellers');
  try { const ids = await serverSavedIds('seller'); await save('sellers', ids); return ids; }
  catch { return local; }
}
export async function toggleSavedSeller(sellerUserId: string): Promise<string[]> {
  const cur = await load<string>('sellers');
  const exists = cur.includes(sellerUserId);
  const next = capList(toggleId(cur, sellerUserId), MAX);
  await save('sellers', next);
  try { if (exists) await apiClient().buyer.unsave('seller', sellerUserId); else await apiClient().buyer.save('seller', sellerUserId); }
  catch { /* degrade */ }
  return next;
}

// --- saved searches (server CRUD: name + query) ---
function fromServerSearch(s: ServerSavedSearch): SavedSearch {
  const ts = Date.parse(s.createdAt);
  return { id: s.id, label: s.name, form: (s.query ?? {}) as FilterForm, savedAt: Number.isFinite(ts) ? ts : Date.now() };
}
export async function getSavedSearches(): Promise<SavedSearch[]> {
  const local = await load<SavedSearch>('searches');
  try { const mapped = (await apiClient().buyer.listSavedSearches()).map(fromServerSearch); await save('searches', mapped); return mapped; }
  catch { return local; }
}
export async function addSavedSearch(label: string, form: FilterForm): Promise<SavedSearch[]> {
  try {
    await apiClient().buyer.createSavedSearch({ name: (label || describeSearch(form)).slice(0, 120), query: form as Record<string, unknown> });
    return getSavedSearches();                                        // refetch the authoritative list (with server id)
  } catch {
    // offline: keep a local entry so the UI reflects intent; server reconciles on next successful load.
    const entry: SavedSearch = { id: newId(), label, form, savedAt: Date.now() };
    const next = upsertFront(await load<SavedSearch>('searches'), entry, (s) => JSON.stringify(s.form), MAX);
    await save('searches', next);
    return next;
  }
}
export async function removeSavedSearch(id: string): Promise<SavedSearch[]> {
  try { await apiClient().buyer.deleteSavedSearch(id); return getSavedSearches(); }
  catch { const next = (await load<SavedSearch>('searches')).filter((s) => s.id !== id); await save('searches', next); return next; }
}

// --- recent searches (screen 128 "Recent searches") — the raw query terms the buyer actually typed, most-recent-
// first, deduped (case-insensitive) + capped. Recorded by the Search screen (67) on leave; the Saved screen offers
// "+ Save" to promote one into a saved-search alert. Purely a LOCAL device-UX affordance (not a server concept):
// on-device (non-secret), user-scoped. ---
const RECENT_MAX = 10;
export function getRecentSearches(): Promise<string[]> { return load<string>('recent'); }
export async function pushRecentSearch(q: string): Promise<string[]> {
  const term = (q ?? '').trim();
  if (!term) return getRecentSearches();
  const next = capList(dedupeBy([term, ...(await getRecentSearches())], (s) => s.toLowerCase()), RECENT_MAX);
  await save('recent', next);
  return next;
}
export async function clearRecentSearches(): Promise<void> { await save('recent', []); }
