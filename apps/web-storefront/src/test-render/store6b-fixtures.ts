// apps/web-storefront/src/test-render/store6b-fixtures.ts · PC-56 STORE-6b — the drafts a fixture PHONE holds, for the "On this phone", keeper and
// chip render tests (not a test file: jest.render.config.js matches *.render.test.tsx only). The list goes through the real pure rules
// (features/store6b/drafts.ts `shown`) and a `MemoryDraftStore`, exactly as the client island would read IndexedDB.
import { DAY_MS, MemoryDraftStore, shown, type Draft } from '../features/store6b/drafts';

export const NOW = Date.parse('2026-10-17T10:00:00.000Z');
export const OWNER = 'AAAAAAAAAAAAAAAAAAAAAA';
export const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
export const HOST = 'storefront.test';
export const SLUG = 'anand-fpo';
export const CONVO = '0190a8b2-0000-7000-8000-00000000c0c0';
export const ORDER = '0190a8b2-0000-7000-8000-00000000a0a0';
export const ORDER2 = '0190a8b2-0000-7000-8000-00000000a0a1';

export const DRAFTS: Draft[] = [
  { id: 'd_msg0000000000000000000', kind: 'message', host: HOST, slug: SLUG, owner: OWNER, ref: CONVO, fields: { body: 'Is the GG-20 groundnut still there? I would take two quintals if the price holds this week.' }, savedAt: NOW - 2 * 3600000 },
  { id: 'd_rev0000000000000000000', kind: 'review', host: HOST, slug: SLUG, owner: OWNER, ref: ORDER, fields: { stars: 4, subRatings: { quality: 5 }, body: 'Fresh and well packed' }, savedAt: NOW - 8 * DAY_MS },
  { id: 'd_edt0000000000000000000', kind: 'review', host: HOST, slug: SLUG, owner: OWNER, ref: ORDER2, edit: true, fields: { stars: 3, subRatings: {}, body: '' }, savedAt: NOW - 30 * 60000 },
  { id: 'd_oth0000000000000000000', kind: 'message', host: HOST, slug: 'bhavnagar-fpo', owner: OWNER, ref: CONVO, fields: { body: 'Another organisation\'s thread' }, savedAt: NOW - DAY_MS },
  { id: 'd_frn0000000000000000000', kind: 'message', host: HOST, slug: SLUG, owner: OTHER, ref: CONVO, fields: { body: 'SOMEONE ELSE\'S PRIVATE WORDS' }, savedAt: NOW - 3600000 },
  { id: 'd_old0000000000000000000', kind: 'message', host: HOST, slug: SLUG, owner: OWNER, ref: CONVO, fields: { body: 'EXPIRED WORDS' }, savedAt: NOW - 31 * DAY_MS },
];

/** A phone with the fixture drafts; `visible()` = what the sweep leaves this owner (another owner's and expired ones never shown). */
export async function phone(): Promise<{ store: MemoryDraftStore; visible: () => Promise<Draft[]> }> {
  const store = new MemoryDraftStore();
  for (const d of DRAFTS) await store.put(d);
  return { store, visible: async () => { const r = await store.list({ host: HOST }); return r.ok ? shown(r.value, OWNER, NOW) : []; } };
}

export const SYNC_LABELS = {
  noscript: 'NOSCRIPT', empty: 'EMPTY', off: 'OFF', unavailable: 'UNAVAILABLE', message: 'Message', review: 'Review', reviewEdit: 'Change to your review',
  noWords: 'stars only', sendNow: 'Send now', sendNowHint: 'hint', discard: 'Discard', askTitle: 'Still want to send these?', askBody: 'ask body',
  keep: 'Keep it', expired: 'An unsent draft older than 30 days was removed from this phone.', proceed: 'Discard from this phone', gone: 'GONE', listTitle: 'Your unsent drafts',
  now: 'just now', minutes: '{n} min ago', hours: '{n} h ago', days: '{n} d ago',
};
