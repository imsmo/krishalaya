// apps/web-storefront/src/test/store6b-idb.spec.ts · PC-56 STORE-6b · C1 — THE INDEXEDDB ADAPTER (lib/draft-store-idb.ts) against a small FAKE
// `indexedDB` (jsdom and fake-indexeddb are not installed in this repo; the double below implements just the calls the adapter makes: open with
// an upgrade, one object store keyed by `id`, one index, getAll / put / delete in a transaction that completes after its requests). Proves:
// DB `kv-drafts` · store `drafts` · index `scope` · put / list (by full scope through the index, by host through getAll) / remove / clear;
// a record never carries anything but the draft + its scope string; and every failure (no IndexedDB, open refused, a write that errors, a
// transaction that throws) is a NAMED outcome — never a throw into the page. (The real browser's IndexedDB is the browser proof, §8.)
import { idbDraftStore, DB_NAME, STORE_NAME, SCOPE_INDEX, DB_VERSION } from '../lib/draft-store-idb';
import type { Draft } from '../features/store6b/drafts';

type Req = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void };
const later = (fn: () => void) => setImmediate(fn);

class FakeDB {
  stores = new Map<string, { keyPath: string; rows: Map<string, Record<string, unknown>>; indexes: Map<string, string> }>();
  failWrites = false; throwTx = false; opened: Array<[string, number]> = [];
  objectStoreNames = { contains: (n: string) => this.stores.has(n) };
  createObjectStore(name: string, o: { keyPath: string }) {
    const s = { keyPath: o.keyPath, rows: new Map<string, Record<string, unknown>>(), indexes: new Map<string, string>() };
    this.stores.set(name, s);
    return { createIndex: (iname: string, path: string) => { s.indexes.set(iname, path); } };
  }
  transaction(name: string, mode: string) {
    if (this.throwTx) throw new Error('InvalidStateError');
    const s = this.stores.get(name)!;
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: (n: string) => unknown } = { objectStore: () => store };
    let pending = 0; let failed = false;
    const req = (work: () => unknown, write: boolean): Req => {
      const r: Req = {}; pending++;
      later(() => {
        if (write && this.failWrites) { failed = true; r.onerror?.(); } else { r.result = work(); r.onsuccess?.(); }
        if (--pending === 0) later(() => (failed ? tx.onerror?.() : tx.oncomplete?.()));
      });
      return r;
    };
    const store = {
      put: (v: Record<string, unknown>) => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); return req(() => { s.rows.set(String(v[s.keyPath]), structuredClone(v)); return v[s.keyPath]; }, true); },
      delete: (k: string) => req(() => { s.rows.delete(k); }, true),
      getAll: () => req(() => [...s.rows.values()].map((x) => structuredClone(x)), false),
      index: (iname: string) => ({ getAll: (key: string) => req(() => [...s.rows.values()].filter((x) => x[s.indexes.get(iname)!] === key).map((x) => structuredClone(x)), false) }),
    };
    return tx;
  }
}
class FakeFactory {
  db = new FakeDB(); refuse = false; blocked = false;
  open(name: string, version: number): Req {
    this.db.opened.push([name, version]);
    const r: Req = {};
    later(() => {
      if (this.refuse) { r.onerror?.(); return; }
      if (this.blocked) { r.onblocked?.(); return; }
      r.result = this.db;
      if (!this.db.stores.size) r.onupgradeneeded?.();
      r.onsuccess?.();
    });
    return r;
  }
}

const A = 'AAAAAAAAAAAAAAAAAAAAAA'; const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const draft = (o: Partial<Draft> = {}): Draft => ({ id: 'd_one00000000000000000000', kind: 'message', host: 'h.example', slug: 'anand-fpo', owner: A, ref: '0190a8b2-0000-7000-8000-00000000c0c0', fields: { body: 'hello' }, savedAt: 1, ...o });

describe('STORE-6b · the IndexedDB adapter (a fake indexedDB)', () => {
  it('opens `kv-drafts` v1, creates the `drafts` store keyed by id with ONE index `scope`', async () => {
    const f = new FakeFactory();
    const st = idbDraftStore(f as unknown as IDBFactory);
    expect(await st.list({ host: 'h.example' })).toEqual({ ok: true, value: [] });
    expect([DB_NAME, DB_VERSION, STORE_NAME, SCOPE_INDEX]).toEqual(['kv-drafts', 1, 'drafts', 'scope']);
    expect(f.db.opened).toEqual([['kv-drafts', 1]]);
    const s = f.db.stores.get('drafts')!;
    expect(s.keyPath).toBe('id');
    expect([...s.indexes]).toEqual([['scope', 'scope']]);
  });
  it('put → list by full scope (through the index) and by host; the record is the draft + its scope string, nothing else', async () => {
    const f = new FakeFactory();
    const st = idbDraftStore(f as unknown as IDBFactory);
    const a = draft(); const b = draft({ id: 'd_two00000000000000000000', owner: B }); const c = draft({ id: 'd_six00000000000000000000', slug: 'other-org' });
    for (const x of [a, b, c]) expect(await st.put(x)).toEqual({ ok: true, value: true });
    const rec = f.db.stores.get('drafts')!.rows.get(a.id)!;
    expect(Object.keys(rec).sort()).toEqual(['fields', 'host', 'id', 'kind', 'owner', 'ref', 'savedAt', 'scope', 'slug']);
    expect(rec.scope).toBe(`h.example|anand-fpo|${A}`);
    const mine = await st.list({ host: 'h.example', slug: 'anand-fpo', owner: A });
    expect(mine).toEqual({ ok: true, value: [a] });                                  // the scope string is stripped on the way out
    const all = await st.list({ host: 'h.example' });
    expect(all.ok && all.value.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect((await st.list({ host: 'h.example', owner: B })).ok && (await st.list({ host: 'h.example', owner: B }) as { value: Draft[] }).value.map((x) => x.id)).toEqual([b.id]);
  });
  it('remove and clear(scope)', async () => {
    const f = new FakeFactory();
    const st = idbDraftStore(f as unknown as IDBFactory);
    await st.put(draft()); await st.put(draft({ id: 'd_two00000000000000000000', owner: B })); await st.put(draft({ id: 'd_six00000000000000000000', owner: B, slug: 'x-org' }));
    expect(await st.remove('d_one00000000000000000000')).toEqual({ ok: true, value: true });
    expect(await st.clear({ host: 'h.example', owner: B, slug: 'x-org' })).toEqual({ ok: true, value: 1 });
    expect([...f.db.stores.get('drafts')!.rows.keys()]).toEqual(['d_two00000000000000000000']);
    expect(await st.clear({ host: 'h.example' })).toEqual({ ok: true, value: 1 });
    expect(f.db.stores.get('drafts')!.rows.size).toBe(0);
  });
  it('every failure is a NAMED outcome, never a throw: no IndexedDB · open refused · open blocked · a write that errors · a transaction that throws', async () => {
    expect(await idbDraftStore(null).list({ host: 'h' })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await idbDraftStore(null).put(draft())).toEqual({ ok: false, reason: 'unavailable' });
    const refused = new FakeFactory(); refused.refuse = true;
    expect(await idbDraftStore(refused as unknown as IDBFactory).put(draft())).toEqual({ ok: false, reason: 'unavailable' });
    const blocked = new FakeFactory(); blocked.blocked = true;
    expect(await idbDraftStore(blocked as unknown as IDBFactory).list({ host: 'h' })).toEqual({ ok: false, reason: 'unavailable' });
    const f = new FakeFactory(); const st = idbDraftStore(f as unknown as IDBFactory);
    await st.list({ host: 'h' });
    f.db.failWrites = true;
    expect(await st.put(draft())).toEqual({ ok: false, reason: 'write' });
    expect(await st.remove('x')).toEqual({ ok: false, reason: 'write' });
    f.db.failWrites = false; f.db.throwTx = true;
    expect(await st.list({ host: 'h' })).toEqual({ ok: false, reason: 'blocked' });
    expect(await st.put(draft())).toEqual({ ok: false, reason: 'write' });
    const thrower = { open: () => { throw new Error('SecurityError'); } };
    expect(await idbDraftStore(thrower as unknown as IDBFactory).list({ host: 'h' })).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('a refused open is retried on the next call (not cached as dead)', async () => {
    const f = new FakeFactory(); f.refuse = true;
    const st = idbDraftStore(f as unknown as IDBFactory);
    expect((await st.list({ host: 'h' })).ok).toBe(false);
    f.refuse = false;
    expect(await st.list({ host: 'h' })).toEqual({ ok: true, value: [] });
  });
});
