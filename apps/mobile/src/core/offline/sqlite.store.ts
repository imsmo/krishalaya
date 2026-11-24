// apps/mobile/src/core/offline/sqlite.store.ts · the durable read-cache store, backed by expo-sqlite. Implements the
// CacheStore port the SWR engine depends on (one table: key → JSON value + fetchedAt). SQLite (not AsyncStorage)
// because the cache holds many list/detail rows and we need prefix deletes for scope/namespace invalidation.
// NON-SECRET reads only — tokens never touch this (those live in SecureStore). Fails soft: a storage error
// degrades to "no cache" rather than crashing a read (Law 12).
import * as SQLite from 'expo-sqlite';
import type { CacheEntry } from './cache-policies';
import { Cache, type CacheStore } from './cache';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('kv_cache.db').then(async (d) => {
      await d.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);');
      return d;
    });
  }
  return dbPromise;
}

const sqliteStore: CacheStore = {
  async get(key) {
    try {
      const d = await db();
      const row = await d.getFirstAsync<{ value: string; fetched_at: number }>('SELECT value, fetched_at FROM cache WHERE key = ?', key);
      if (!row) return undefined;
      return { value: JSON.parse(row.value), fetchedAt: row.fetched_at } as CacheEntry;
    } catch { return undefined; } // soft-fail → treated as cache miss
  },
  async set(key, entry) {
    try {
      const d = await db();
      await d.runAsync('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)', key, JSON.stringify(entry.value), entry.fetchedAt);
    } catch { /* cache write is best-effort */ }
  },
  async remove(key) {
    try { const d = await db(); await d.runAsync('DELETE FROM cache WHERE key = ?', key); } catch { /* noop */ }
  },
  async removeByPrefix(prefix) {
    try { const d = await db(); await d.runAsync('DELETE FROM cache WHERE key LIKE ?', `${prefix}%`); } catch { /* noop */ }
  },
};

/** The app-wide read cache (SQLite-backed). Feature data layers call `cache.read({...})`. */
export const cache = new Cache(sqliteStore);
