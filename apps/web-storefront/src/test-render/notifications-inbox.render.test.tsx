// apps/web-storefront/src/test-render/notifications-inbox.render.test.tsx · PC-56 STORE-4c · C6 — canon W299 "Notifications" at /<slug>/notifications
// (app/[tenantSlug]/notifications/page.tsx; the platform /notifications is a door):
//   • the tier chip ×4 (critical · important · promotional pinned); the words SENT (the API's rendering), else the payload's, else the event's name;
//   • the ladder: "also by phone notification · sent", "also by SMS · failed", held for quiet hours (the reason by name), opted out;
//   • All lists READ rows (the strict boolean); Unread asks `true`;
//   • "Open" only for a SAME-ORIGIN link the payload carries — never an off-site one, never invented;
//   • mark read carries the row's instant and a key minted at render; "Mark all read" (an EXTRA) its own key; the acts send those keys;
//   • empty: "All caught up — payment notices always reach you here"; an error is NOT empty (a Retry that reloads); no "Flagged off" state;
//   • the refused canon claims printed by name (features/store4c/refusals.ts, surface `inbox`).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4c-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4c-fixtures');
  return { LANG_COOKIE: 'kv_lang', getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import InboxPage from '../app/[tenantSlug]/notifications/page';
import PlatformDoor from '../app/(platform)/notifications/page';
import { markReadAction, markAllReadAction } from '../app/[tenantSlug]/notifications/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, N, reset } from './store4c-fixtures';
import { STORE4C_REFUSALS } from '../features/store4c/refusals';

const P = { tenantSlug: 'anand-fpo' };
const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await InboxPage({ params: P, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return String((e as Error).message); } return 'NO REDIRECT'; };
beforeEach(() => { reset(); });

describe('STORE-4c · W299 the items', () => {
  it('the tier chip per item (critical · important · promotional) from the API\'s `tier`, worded ×3', async () => {
    const h = await page();
    expect(h).toContain('data-kv-tier="critical"'); expect(h).toContain('data-kv-tier="important"'); expect(h).toContain('data-kv-tier="promotional"');
    expect(text(h)).toContain(en['store4c.tier.critical']); expect(text(h)).toContain(en['store4c.tier.promotional']);
    C.lang = 'gu';
    expect(text(await page())).toContain('અતિ જરૂરી');
  });
  it('the words: what was SENT (rendered) · else the payload\'s own (an announcement) · else the event\'s name — never invented', async () => {
    const h = await page(); const v = text(h);
    expect(v).toContain('Payment received'); expect(v).toContain('We received your payment.');
    expect(h).toMatch(/data-kv-body="rendered"/);
    expect(v).toContain('Mandi closed Friday'); expect(h).toMatch(/data-kv-body="payload"/);
    expect(v).toContain(en['store4c.event.order.created']);   // order.created: no words served → its name
  });
  it('the ladder: every OTHER channel as its own row says — sent, failed, held for quiet hours (named), opted out (named)', async () => {
    const h = await page(); const v = text(h);
    expect(h).toMatch(/data-kv-also="push" data-kv-outcome="sent"/);
    expect(h).toMatch(/data-kv-also="sms" data-kv-outcome="failed"/);
    expect(v).toContain(`${en['store4c.inbox.alsoBy'].replace('{channel}', en['store4c.channel.sms'])} · ${en['store4c.outcome.failed']}`);
    expect(h).toMatch(/data-kv-outcome="held"[^>]*>.*?data-kv-reason="quiet_hours"/s);
    expect(h).toContain('data-kv-reason="opted_out"');
    expect(v).toContain(en['store4c.suppressed.quiet_hours']);
    // the order-placed item went in-app only: no ladder at all (never "app + SMS")
    expect(h).not.toMatch(/data-kv-item="order.created"[^]*?data-kv-ladder[^]*?data-kv-item="order.delivered"/);
  });
  it('"Open" only for a same-origin link the payload carries — never the off-site one, never on an item without one', async () => {
    const h = await page();
    expect((h.match(/data-kv-open/g) ?? []).length).toBe(1);
    expect(h).toContain('data-kv-open="true" href="/anand-fpo/orders"');
    expect(h).not.toContain('evil.example');
  });
});

describe('STORE-4c · W299 All / Unread, the acts', () => {
  it('All → `unreadOnly: false`: the READ outbid row is listed; Unread → `true`', async () => {
    const h = await page();
    expect(C.calls[0]).toEqual(['notifications.inbox', { unreadOnly: false, cursor: undefined, limit: 30 }]);
    expect(h).toContain('data-kv-item="bid.outbid" data-kv-unread="false"');
    reset();
    const u = await page({ unread: '1' });
    expect(C.calls[0]).toEqual(['notifications.inbox', { unreadOnly: true, cursor: undefined, limit: 30 }]);
    expect(u).not.toContain('data-kv-item="bid.outbid"');
  });
  it('mark read: a key minted at render per row + the row\'s instant; the act sends both (a double submit replays the SAME key)', async () => {
    const h = await page();
    const keys = [...h.matchAll(/name="key" value="(read:[0-9a-f-]{36})"/g)].map((m) => m[1]);
    expect(keys.length).toBe(4);                                     // the four unread rows
    expect(new Set(keys).size).toBe(4);
    expect(h).toContain(`name="at" value="2026-10-16T05:00:00.123456Z"`);
    const fd = form({ slug: 'anand-fpo', id: N.pay, at: '2026-10-16T05:00:00.123456Z', key: keys[0] });
    expect(await redirectOf(markReadAction(fd))).toBe('REDIRECT /anand-fpo/notifications?ok=read');
    expect(await redirectOf(markReadAction(fd))).toBe('REDIRECT /anand-fpo/notifications?ok=read');
    expect(C.calls.filter((c) => c[0] === 'notifications.markRead')).toEqual([
      ['notifications.markRead', N.pay, { at: '2026-10-16T05:00:00.123456Z', idempotencyKey: keys[0] }],
      ['notifications.markRead', N.pay, { at: '2026-10-16T05:00:00.123456Z', idempotencyKey: keys[0] }],
    ]);
  });
  it('"Mark all read" (an EXTRA) carries its own key; a refused act is said by name; a forged key is refused before the API', async () => {
    const h = await page();
    const key = /name="key" value="(readall:[0-9a-f-]{36})"/.exec(h)![1];
    expect(await redirectOf(markAllReadAction(form({ slug: 'anand-fpo', key })))).toBe('REDIRECT /anand-fpo/notifications?ok=all_read');
    expect(C.calls).toContainEqual(['notifications.markAllRead', key]);
    C.fail.markAllRead = new SdkError('SERVER', 500, 'x');
    expect(await redirectOf(markAllReadAction(form({ slug: 'anand-fpo', key })))).toBe('REDIRECT /anand-fpo/notifications?failure=all_read');
    expect(text(await page({ failure: 'all_read' }))).toContain(en['store4c.inbox.failure.all_read']);
    const before = C.calls.length;
    expect(await redirectOf(markReadAction(form({ slug: 'anand-fpo', id: N.pay, key: 'read:nope' })))).toBe('REDIRECT /anand-fpo/notifications?failure=read');
    expect(C.calls.length).toBe(before);
  });
  it('keyset Next only — no "Showing N of M", no day count', async () => {
    C.nextCursor = 'MjAyNi0xMC0xNnxu';
    const h = await page();
    expect(h).toContain('href="/anand-fpo/notifications?cursor=MjAyNi0xMC0xNnxu"');
    expect(text(h)).not.toMatch(/Showing \d+ of|\d+ days/);
  });
});

describe('STORE-4c · W299 states and refusals', () => {
  it('empty: "All caught up — payment notices always reach you here" (TRUE since 0215)', async () => {
    C.inbox = [];
    const h = await page();
    expect(h).toContain('data-kv-state="empty"'); expect(text(h)).toContain(en['store4c.inbox.empty']);
  });
  it('an error is NOT empty: said, with a Retry that reloads (W3118–W3120 DECOR); there is no "Flagged off" state', async () => {
    C.fail.inbox = new SdkError('NOT_FOUND', 404, 'x');
    const h = await page();
    expect(h).toContain('data-kv-state="error"'); expect(h).toContain('data-kv-retry="reload"'); expect(h).not.toContain('data-kv-state="empty"');
    expect(text(h)).not.toMatch(/Flagged off/);
  });
  it('every refused canon claim of the inbox is printed by name', async () => {
    const h = await page();
    for (const r of STORE4C_REFUSALS.filter((x) => (x.surfaces as readonly string[]).includes('inbox'))) {
      expect(h).toContain(`data-kv-refusal="${r.id}"`); expect(text(h)).toContain(en[r.key as keyof typeof en]);
    }
  });
  it('Preferences → the person\'s page under THIS chrome', async () => {
    expect(await page()).toContain('data-kv-link="preferences" href="/anand-fpo/account/preferences"');
  });
  it('the platform /notifications is a DOOR to the session store\'s inbox, carrying the tab and the cursor', async () => {
    expect(await redirectOf(PlatformDoor({ searchParams: { unread: '1', cursor: 'abc', x: 'y' } }))).toBe('REDIRECT /anand-fpo/notifications?unread=1&cursor=abc');
  });
});
