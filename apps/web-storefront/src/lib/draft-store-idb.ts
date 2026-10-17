// apps/web-storefront/src/lib/draft-store-idb.ts · PC-56 STORE-6b · C1 — THE PHONE'S DRAFT STORE: plain IndexedDB (no library), database
// `kv-drafts`, object store `drafts` (key = the draft's opaque id), ONE index `scope` (`host|slug|owner`). BROWSER ONLY (the client components
// open it; nothing here runs on the server). Every call is wrapped: an unavailable or blocked IndexedDB (a private window, a full disk, a
// browser setting) is a NAMED outcome (`unavailable` / `blocked` / `write`) — never a throw into the page; the page then keeps nothing and
// says so (the keeper's `off`, the discard chain's W3153).
//
// HOTFIX-8's law holds: drafts live HERE, never in a Cache Storage cache (the worker never sees them); `Clear-Site-Data: "storage"` deletes this
// database on sign-out and on another person's sign-in; the `kvs_wipe` marker clears it at the next load where the header is ignored.
import { type Draft, type DraftScope, type DraftStore, type StoreResult, inScope } from '../features/store6b/drafts';

export const DB_NAME = 'kv-drafts';
export const DB_VERSION = 1;
export const STORE_NAME = 'drafts';
export const SCOPE_INDEX = 'scope';

type Row = Draft & { scope: string };
const scopeKey = (d: Pick<Draft, 'host' | 'slug' | 'owner'>) => `${d.host}|${d.slug}|${d.owner}`;
const strip = (r: Row): Draft => { const { scope: _scope, ...d } = r; void _scope; return d; };

/** The adapter over an `IDBFactory` (the browser's `indexedDB`; a double in test/store6b-idb.spec.ts). */
export function idbDraftStore(factory: IDBFactory | null | undefined = typeof indexedDB !== 'undefined' ? indexedDB : null): DraftStore {
  let opening: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    if (!factory) return Promise.resolve(null);
    if (opening) return opening;
    opening = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' }).createIndex(SCOPE_INDEX, 'scope', { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    }).then((db) => { if (!db) opening = null; return db; });
    return opening;
  };
  const run = <T>(mode: IDBTransactionMode, body: (s: IDBObjectStore, done: (v: T) => void) => void): Promise<StoreResult<T>> =>
    open().then((db) => new Promise<StoreResult<T>>((resolve) => {
      if (!db) { resolve({ ok: false, reason: 'unavailable' }); return; }
      try {
        const tx = db.transaction(STORE_NAME, mode);
        let value: T | undefined; let settled = false;
        const finish = (r: StoreResult<T>) => { if (!settled) { settled = true; resolve(r); } };
        tx.oncomplete = () => finish({ ok: true, value: value as T });
        tx.onerror = () => finish({ ok: false, reason: mode === 'readonly' ? 'blocked' : 'write' });
        tx.onabort = () => finish({ ok: false, reason: mode === 'readonly' ? 'blocked' : 'write' });
        body(tx.objectStore(STORE_NAME), (v) => { value = v; });
      } catch { resolve({ ok: false, reason: mode === 'readonly' ? 'blocked' : 'write' }); }
    }), () => ({ ok: false, reason: 'unavailable' } as StoreResult<T>));

  return {
    list(scope: DraftScope) {
      return run<Draft[]>('readonly', (s, done) => {
        const full = scope.slug !== undefined && scope.owner !== undefined;
        const req = full ? s.index(SCOPE_INDEX).getAll(`${scope.host}|${scope.slug}|${scope.owner}`) : s.getAll();
        req.onsuccess = () => done((req.result as Row[]).filter((r) => inScope(r, scope)).map(strip));
      });
    },
    put(draft: Draft) {
      return run<true>('readwrite', (s, done) => { const req = s.put({ ...draft, scope: scopeKey(draft) } as Row); req.onsuccess = () => done(true); });
    },
    remove(id: string) {
      return run<true>('readwrite', (s, done) => { const req = s.delete(id); req.onsuccess = () => done(true); });
    },
    clear(scope: DraftScope) {
      return run<number>('readwrite', (s, done) => {
        const req = s.getAll();
        req.onsuccess = () => {
          const gone = (req.result as Row[]).filter((r) => inScope(r, scope));
          for (const r of gone) s.delete(r.id);
          done(gone.length);
        };
      });
    },
  };
}
