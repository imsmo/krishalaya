// apps/web-storefront/src/components/drafts/phone.ts · PC-56 STORE-6b — THIS PHONE, for the client islands (DraftKeeper, DraftDone, DraftsChip,
// the "On this phone" list). BROWSER ONLY (called from effects, never during the server render). One place that:
//   • reads the owner marker (`kvs_owner`, HOTFIX-8 — JS-readable, random, non-secret) and the host; no marker → drafts OFF (null);
//   • honours the wipe marker (`kvs_wipe=1`, set by the armed clear pass at sign-out / another person's sign-in): every draft on this phone is
//     cleared, then the marker is dropped (kept while the clear fails — it is tried again at the next load);
//   • runs the sweep (another owner's drafts removed unseen; expired ones removed and counted for the one-line notice on "On this phone");
//   • tells the other islands on the page that the drafts changed (`kv-drafts-changed`).
import { idbDraftStore } from '../../lib/draft-store-idb';
import { DRAFTS_WIPE_COOKIE, type Draft, type DraftStore, isOwner, newDraftId, runSweep } from '../../features/store6b/drafts';
import { cookieValue } from '../../features/store6b/install';

export const DRAFTS_EVENT = 'kv-drafts-changed';
const NOTICE_KEY = 'kv-drafts-expired';

let shared: DraftStore | null = null;
export function phoneStore(): DraftStore { if (!shared) shared = idbDraftStore(); return shared; }

export function phoneOwner(): string | null {
  try { const v = cookieValue(document.cookie, 'kvs_owner'); return isOwner(v) ? v : null; } catch { return null; }
}
export function phoneHost(): string { try { return window.location.host; } catch { return ''; } }
export function phoneNewId(): string {
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
  return newDraftId(b);
}
export function announce(): void { try { window.dispatchEvent(new Event(DRAFTS_EVENT)); } catch { /* nothing to tell */ } }

/** The one-line 30-day notice, for this owner only (a count, never words). */
function noteExpired(owner: string, n: number): void {
  try { const prev = readNotice(owner); window.localStorage.setItem(NOTICE_KEY, `${owner}:${prev + n}`); } catch { /* storage blocked: no notice */ }
}
function readNotice(owner: string): number {
  try { const v = window.localStorage.getItem(NOTICE_KEY) ?? ''; const [o, n] = v.split(':'); return o === owner ? Number(n) || 0 : 0; } catch { return 0; }
}
/** Read and clear the notice ("an unsent draft older than 30 days was removed"). */
export function takeExpiredNotice(owner: string): number {
  const n = readNotice(owner);
  try { window.localStorage.removeItem(NOTICE_KEY); } catch { /* nothing */ }
  return n;
}

export interface Settled { owner: string; host: string; store: DraftStore; kept: Draft[]; ask: string[]; ok: boolean }

/** Wipe if asked, sweep, and return what this owner may see — or null (no marker: drafts OFF; the store unreadable: nothing shown). */
export async function settlePhone(now = Date.now()): Promise<Settled | null> {
  const store = phoneStore();
  const host = phoneHost();
  try {
    if (cookieValue(document.cookie, DRAFTS_WIPE_COOKIE) === '1') {
      const r = await store.clear({ host });
      if (r.ok) document.cookie = `${DRAFTS_WIPE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  } catch { /* the marker stays; tried again next load */ }
  const owner = phoneOwner();
  const sw = await runSweep(store, host, owner, now);
  if (owner && sw.expired > 0) noteExpired(owner, sw.expired);
  if (!owner) return null;
  if (!sw.ok && sw.kept.length === 0) return { owner, host, store, kept: [], ask: [], ok: false };
  return { owner, host, store, kept: sw.kept, ask: sw.ask, ok: sw.ok };
}
