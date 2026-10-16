// apps/web-storefront/src/test-render/messages-list.render.test.tsx · PC-56 STORE-4b · C1 — canon W297 "Messages" under the organisation's chrome:
//   • `communication` OFF → the honest sentence and NO conversations call; flags unreadable → the load error (never a guessed ON);
//   • the list reads `scope: 'organisation'` (never platform support) — rows: the organisation's name, the context chip (order number /
//     listing title), "You: …", a reported preview → "hidden pending review", the unread count, the lock with its kind;
//   • no person's name or uuid anywhere in the page; keyset Next; empty (the true sentence); error ≠ empty, Retry = a reload;
//   • an entry point's failure is said by name; the refusals by name; the platform /messages is a door to /<slug>/messages.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import MessagesPage from '../app/[tenantSlug]/messages/page';
import PlatformMessagesDoor from '../app/(platform)/messages/page';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, IDS, FARMER_UUID } from './store4b-fixtures';
import { store4bRefusalKeys } from '../features/store4b/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await MessagesPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
beforeEach(() => { reset(); });

describe('STORE-4b · W297 the flag', () => {
  it('`communication` OFF → the honest sentence and NO conversations call (no "Flagged off — see store settings")', async () => {
    C.flags = { ...C.flags, communication: false };
    const h = await page();
    expect(h).toContain('data-kv-state="off"');
    expect(text(h)).toContain(en['store4b.messages.off']);
    expect(C.calls.some((c) => c[0] === 'conversations.list')).toBe(false);
    expect(text(h)).not.toMatch(/See store settings/i);
  });
  it('the store\'s switches unreadable → the load error with a Retry (never a guessed ON), still no conversations call', async () => {
    C.fail.flags = new SdkError('UNAVAILABLE', 503, 'x');
    const h = await page();
    expect(h).toContain('data-kv-state="error"');
    expect(C.calls.some((c) => c[0] === 'conversations.list')).toBe(false);
  });
});

describe('STORE-4b · W297 the rows', () => {
  it('reads the ORGANISATION scope (20 a page) — never platform support', async () => {
    await page();
    expect(C.calls.find((c) => c[0] === 'conversations.list')?.[1]).toEqual({ scope: 'organisation', cursor: undefined, limit: 20 });
  });
  it('the organisation\'s name, the order number and the listing title as chips, "You: …", a hidden preview, the unread count, the lock\'s kind', async () => {
    const h = await page();
    const tx = text(h);
    expect(tx).toContain('Anand FPO');
    expect(h).toContain('data-kv-chip="order"'); expect(tx).toContain('Order KV2026-0A1B2C3D');
    expect(h).toContain('data-kv-chip="listing"'); expect(tx).toContain('Listing · GG-20 Groundnut');
    expect(h).toContain('data-kv-preview="text"'); expect(tx).toContain('You: Gate 2, tell the driver');
    expect(h).toContain('data-kv-preview="hidden"'); expect(tx).toContain(en['store4b.messages.hiddenPreview']);
    expect(h).toContain('data-kv-unread="1"'); expect(tx).toContain('1 unread');
    expect(h).toContain('data-kv-lock="dispute"'); expect(tx).toContain(en['store4b.lock.dispute']);
    expect(h).toContain(`href="/anand-fpo/messages/${IDS.order}"`);
  });
  it('no person: no name, no person uuid — only the threads\' own ids', async () => {
    C.threads = C.threads.map((t) => ({ ...t, counterpartyUserId: FARMER_UUID }));   // even if a pre-HOTFIX-6 API served one, the page prints none
    const h = await page();
    expect(h).not.toContain(FARMER_UUID);
    expect(new Set((h.match(UUID_RE) ?? []).map((u) => u.toLowerCase()))).toEqual(new Set([IDS.order, IDS.listing, IDS.locked]));
  });
  it('no preview at all → "No messages yet"; a voice note → its label; someone else\'s text has no "You:"', async () => {
    C.threads = [{ ...C.threads[0], lastMessageBody: null, lastMessageFromYou: false }, { ...C.threads[1], id: IDS.listing, lastMessageHidden: false, lastMessageHasVoice: true },
      { ...C.threads[2], lastMessageFromYou: false }];
    const tx = text(await page());
    expect(tx).toContain(en['store4b.messages.noPreview']);
    expect(tx).toContain(en['messages.voiceMessage']);
    expect(tx).toContain('Refund decided'); expect(tx).not.toContain('You: Refund decided');
  });
  it('keyset Next carries the cursor; never "Showing N of M"', async () => {
    C.nextCursor = 'MjAyNi0xMC0xNlQwNTowMDowMC4xMjM0NTZafDAyMTY';
    const h = await page();
    expect(h).toContain('href="/anand-fpo/messages?cursor=MjAyNi0xMC0xNlQwNTowMDowMC4xMjM0NTZafDAyMTY"');
    expect(text(h)).not.toMatch(/Showing \S+ of/);
  });
});

describe('STORE-4b · W297 states', () => {
  it('empty → the TRUE sentence (threads start from an order, an offer or a listing)', async () => {
    C.threads = [];
    const h = await page();
    expect(h).toContain('data-kv-state="empty"');
    expect(text(h)).toContain(en['store4b.messages.empty']);
  });
  it('a load error is NOT empty — said, with a Retry that reloads (W3112–W3114 DECOR)', async () => {
    C.fail.list = new SdkError('UNAVAILABLE', 503, 'x');
    const h = await page({ cursor: 'abc' });
    expect(h).toContain('data-kv-state="error"');
    expect(h).toContain('data-kv-retry="reload"');
    expect(h).toContain('href="/anand-fpo/messages?cursor=abc"');
    expect(text(h)).not.toContain(en['store4b.messages.empty']);
  });
  it('an entry point\'s failure is said by name; an unknown code is ignored', async () => {
    expect(text(await page({ failure: 'open', code: 'no_responder' }))).toContain(en['store4b.open.failure.no_responder']);
    expect(await page({ failure: 'open', code: 'whatever' })).not.toContain('data-kv-failure');
  });
  it('the refusals by name (block, counts, platform support, read ticks, offline queue, flagged off, unread badge) — in Gujarati too', async () => {
    const h = await page();
    expect(h).toContain('data-kv-refused="messages"');
    for (const k of store4bRefusalKeys('messages')) expect(text(h)).toContain(en[k as keyof typeof en]);
    C.lang = 'gu';
    const g = text(await page());
    for (const k of store4bRefusalKeys('messages')) expect(g).toContain(gu[k as keyof typeof gu]);
  });
});

describe('STORE-4b · the platform /messages is a door', () => {
  it('→ the session store\'s /<slug>/messages, carrying the cursor; an unreadable store → said, with a Retry', async () => {
    await expect(PlatformMessagesDoor({ searchParams: { cursor: 'abc' } })).rejects.toThrow('REDIRECT /anand-fpo/messages?cursor=abc');
    C.fail.storeSlug = new SdkError('UNAVAILABLE', 503, 'x');
    const h = renderToStaticMarkup(await PlatformMessagesDoor({ searchParams: {} }));
    expect(h).toContain('data-kv-retry="reload"');
  });
});
