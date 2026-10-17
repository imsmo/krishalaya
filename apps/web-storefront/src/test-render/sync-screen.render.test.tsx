// apps/web-storefront/src/test-render/sync-screen.render.test.tsx · PC-56 STORE-6b · B8 / C3 (canon W315 REBUILT; the discard chain W3151–W3153) —
// "ON THIS PHONE", UNDER BOTH CHROMES:
//   • the server page reads NO session (no session cookie read, no API call) — the list is the phone's, read by the island; without JavaScript
//     the honest sentence; "this page loaded at" (AsOf) instead of "Last full sync … on Wi-Fi"; the rules rewritten to the truth;
//   • the rows from a fixture phone (through the real sweep): store, kind, first words, age, "Send now" = a LINK to the live page `?draft=<id>`
//     (nothing is posted from here), "Discard" → `?discard=<id>`; another owner's and expired drafts never shown; under a store only its own;
//     the 7-day question (Keep / Discard) and the 30-day notice;
//   • the chain: W3151 confirm ("Nothing on the server changes", Proceed = a button — the client act, Cancel → the list), W3152 "Discarded from
//     this phone", W3153 "the draft is kept" + Retry → the confirm; no audit / zero-sum / on-call sentence; the refusals by name;
//   • never marked cacheable; `/sync` on a store's own host is the organisation's page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import PlatformSync from '../app/(platform)/sync/page';
import TenantSync from '../app/[tenantSlug]/sync/page';
import { SyncListView } from '../components/sync/SyncList';
import { store6bRefusalKeys, STORE6B_CHAIN_PAGES } from '../features/store6b/refusals';
import { cacheableScope } from '../features/store6/sw-rules';
import { hostRewritePath } from '../features/branding/brand-theme';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, SESSION, reset, withCookies } from './store6a-fixtures';
import { phone, SYNC_LABELS as L, NOW, SLUG, CONVO, ORDER, ORDER2 } from './store6b-fixtures';

beforeEach(() => reset());
const plat = (sp: Record<string, string> = {}) => renderToStaticMarkup(PlatformSync({ searchParams: sp }));
const ten = (sp: Record<string, string> = {}) => renderToStaticMarkup(TenantSync({ params: { tenantSlug: SLUG }, searchParams: sp }));
const ID = 'd_msg0000000000000000000';

describe('STORE-6b · W315 rebuilt — "On this phone" under both chromes, no session read', () => {
  it('both chromes: the title, the lead, "this page loaded at", the no-JavaScript sentence, the rules, the refusals', () => {
    for (const [h, lead] of [[plat(), en['store6b.sync.leadPlatform']], [ten(), en['store6b.sync.lead']]] as const) {
      const w = text(h);
      expect(w).toContain(en['store6b.sync.title']); expect(w).toContain(lead);
      expect(w).toContain(en['store6b.sync.loadedAt']);
      expect(h).toContain('data-kv-sync="noscript"'); expect(w).toContain(en['store6b.sync.noscript']);
      for (const r of ['kept', 'send', 'age', 'wiped', 'server-wins', 'you-decide', 'reconfirm']) expect(h).toContain(`data-kv-rule="${r}"`);
      expect(w).toContain(en['store6b.sync.rules.youDecide']); expect(w).toContain(en['store6b.sync.rules.serverWins']);
      expect(w).toContain(en['store6b.sync.rules.age'].replace('{days}', '7').replace('{expire}', '30'));
      for (const k of store6bRefusalKeys('sync')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    }
    expect(store6bRefusalKeys('sync').length).toBe(12);
  });
  it('the links are THIS chrome\'s: /offline + /queued, or /<slug>/offline + /<slug>/queued', () => {
    expect(plat()).toContain('href="/offline"'); expect(plat()).toContain('href="/queued"');
    expect(ten()).toContain(`href="/${SLUG}/offline"`); expect(ten()).toContain(`href="/${SLUG}/queued"`);
  });
  it('NO session: with every session cookie on the device, none is read, no API is called, no session string is printed', () => {
    withCookies(SESSION);
    for (const h of [plat(), ten()]) {
      for (const c of ['kv_session', 'kv_refresh', 'kv_tid', 'kvs_owner']) expect([c, C.read.includes(c)]).toEqual([c, false]);
      for (const v of Object.values(SESSION)) expect(h).not.toContain(v);
      expect(text(h)).not.toMatch(/Sign out|Account/);
    }
    expect(C.api).toEqual([]);
  });
  it('outside the refusals, the page claims no sync: no "sync", "synced", "Wi-Fi", "Last full sync", "Merge by hand"', () => {
    const w = text(plat().replace(/<section class="kv-refused"[\s\S]*<\/section>/, ''));
    expect(w).not.toMatch(/\bsync(ed|ing)?\b|wi-?fi|last full sync|merge by hand|keep (phone|computer) version/i);
  });
  it('never marked cacheable; `/sync` on a store\'s own host is the organisation\'s page', () => {
    expect(cacheableScope(`/${SLUG}/sync`)).toBeNull(); expect(cacheableScope('/sync')).toBeNull();
    expect(hostRewritePath(SLUG, '/sync')).toBe(`/${SLUG}/sync`);
  });
  it('the 8 canon files of the wave are recorded with their verdicts', () => {
    expect(STORE6B_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W315-', 'W3151', 'W3152', 'W3153', 'W3137', 'W3138', 'W3139', 'W3140']);
  });
});

describe('STORE-6b · the list, from a fixture phone (the real sweep)', () => {
  it('the platform: every store\'s drafts of THIS owner — never another owner\'s, never an expired one — each with Send now (a link) and Discard', async () => {
    const drafts = await (await phone()).visible();
    const h = renderToStaticMarkup(<SyncListView chrome={PLATFORM_CHROME} state={{ kind: 'list' }} view={{ kind: 'ready', drafts, now: NOW, expired: 0 }} labels={L} />);
    expect(h).toContain('data-kv-drafts="4"');
    expect(h).not.toContain('SOMEONE ELSE'); expect(h).not.toContain('EXPIRED WORDS');
    expect(h).toContain(`href="/${SLUG}/messages/${CONVO}?draft=${ID}"`);
    expect(h).toContain(`href="/${SLUG}/orders/${ORDER}/review?draft=d_rev0000000000000000000"`);
    expect(h).toContain(`href="/${SLUG}/orders/${ORDER2}/review/edit?draft=d_edt0000000000000000000"`);
    expect(h).toContain(`href="/sync?discard=${ID}"`);
    expect(text(h)).toContain('2 h ago'); expect(text(h)).toContain('stars only'); expect(text(h)).toContain('Change to your review');
    expect(text(h)).toContain('bhavnagar-fpo');
    expect(h).not.toMatch(/<form|method="post"/i);                                // nothing is posted from /sync
    expect(text(h)).toContain('Is the GG-20 groundnut still there? I would take two quintals if the price…');   // whole words, ≤ 80
  });
  it('under an organisation: ONLY its own drafts (another organisation\'s never on its page)', async () => {
    const drafts = await (await phone()).visible();
    const h = renderToStaticMarkup(<SyncListView chrome={tenantChrome(SLUG)} state={{ kind: 'list' }} view={{ kind: 'ready', drafts, now: NOW, expired: 0 }} labels={L} />);
    expect(h).toContain('data-kv-drafts="3"');
    expect(h).not.toContain('bhavnagar-fpo'); expect(h).not.toContain('Another organisation');
    expect(h).toContain(`href="/${SLUG}/sync?discard=${ID}"`);
  });
  it('the 7-day question (Keep — a button; Discard — the confirm) and the 30-day notice', async () => {
    const drafts = await (await phone()).visible();
    const h = renderToStaticMarkup(<SyncListView chrome={tenantChrome(SLUG)} state={{ kind: 'list' }} view={{ kind: 'ready', drafts, now: NOW, expired: 1 }} labels={L} />);
    expect(h).toContain('data-kv-sync-ask="1"'); expect(h).toContain('data-kv-ask="d_rev0000000000000000000"');
    expect(h).toMatch(/<button[^>]*data-kv-act="keep"/);
    expect(h).toContain(`href="/${SLUG}/sync?discard=d_rev0000000000000000000"`);
    expect(h).toContain('data-kv-sync-expired="1"'); expect(text(h)).toContain(L.expired);
  });
  it('empty · no owner marker (OFF) · storage unreadable · no JavaScript — each says so', () => {
    const r = (view: Parameters<typeof SyncListView>[0]['view']) => renderToStaticMarkup(<SyncListView chrome={PLATFORM_CHROME} state={{ kind: 'list' }} view={view} labels={L} />);
    expect(r({ kind: 'ready', drafts: [], now: NOW, expired: 0 })).toContain('data-kv-sync="empty"');
    expect(r({ kind: 'off' })).toContain('data-kv-sync="off"');
    expect(r({ kind: 'unavailable' })).toContain('data-kv-sync="unavailable"');
    expect(r({ kind: 'noscript' })).toContain('data-kv-sync="noscript"');
  });
});

describe('STORE-6b · the discard chain (W3151 → W3152 / W3153) — a REAL device act', () => {
  it('W3151 confirm: "Discard this draft? Nothing on the server changes"; Proceed is a client button; Cancel → the list', async () => {
    const h = ten({ discard: ID }); const w = text(h);
    expect(h).toContain('data-kv-sync-state="confirm"');
    expect(w).toContain(en['store6b.sync.confirm.title']); expect(w).toContain(en['store6b.sync.confirm.body']);
    expect(h).toContain(`href="/${SLUG}/sync" class="kv-btn--link" data-kv-cancel="discard"`);
    const drafts = await (await phone()).visible();
    const v = renderToStaticMarkup(<SyncListView chrome={tenantChrome(SLUG)} state={{ kind: 'confirm', id: ID }} view={{ kind: 'ready', drafts, now: NOW, expired: 0 }} labels={L} />);
    expect(v).toMatch(/<button[^>]*data-kv-act="discard"/); expect(text(v)).toContain('Discard from this phone');
    const gone = renderToStaticMarkup(<SyncListView chrome={tenantChrome(SLUG)} state={{ kind: 'confirm', id: 'd_frn0000000000000000000' }} view={{ kind: 'ready', drafts, now: NOW, expired: 0 }} labels={L} />);
    expect(gone).toContain('data-kv-sync="gone"'); expect(gone).not.toContain('SOMEONE ELSE');          // another owner's id is never confirmable
  });
  it('W3152 "Discarded from this phone"; W3153 "the draft is kept" + Retry → the confirm, Back → the list', () => {
    const ok = text(plat({ done: 'discarded' }));
    expect(ok).toContain(en['store6b.sync.done.title']); expect(ok).toContain(en['store6b.sync.done.body']);
    const f = plat({ done: 'failed', discard: ID });
    expect(text(f)).toContain(en['store6b.sync.failed.title']); expect(text(f)).toContain(en['store6b.sync.failed.body']);
    expect(f).toContain(`href="/sync?discard=${ID}" class="kv-btn" data-kv-retry="discard"`);
    expect(f).toContain('href="/sync" class="kv-btn--link" data-kv-back="list"');
  });
  it('no audit, zero-sum or on-call sentence on any state (a device act) — the refusal says so instead', () => {
    for (const h of [plat({ discard: ID }), plat({ done: 'discarded' }), plat({ done: 'failed', discard: ID })]) {
      const w = text(h.replace(/<section class="kv-refused"[\s\S]*<\/section>/, ''));
      expect(w).not.toMatch(/audit trail|zero-sum|on-call/i);
      expect(text(h)).toContain(en['store6b.refusal.chainSentences']);
    }
  });
  it('a malformed id in the query is the plain list (never an error page)', () => {
    expect(plat({ discard: '<script>' })).toContain('data-kv-sync-state="list"');
  });
});
