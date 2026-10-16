// apps/web-storefront/src/test-render/rtl-store4c.render.test.tsx · PC-56 STORE-4c · C6 — the inbox (items with ladders, empty, error) and the
// preferences page (the form, the W3134 review, a W3136 failure, the W3135 success, the load error) under dir="rtl" carry no PHYSICAL-direction
// class or inline style and no bare arrow outside .kv-dir-flip. Same guards as rtl-store4a (store1b-harness). In Hindi and Gujarati too.
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
import PrefsPage from '../app/[tenantSlug]/account/preferences/page';
import { reviewPreferencesAction } from '../app/(platform)/account/preferences/actions';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset } from './store4c-fixtures';

const P = { tenantSlug: 'anand-fpo' };
const KEY = 'prefs:0215cafe-0000-4000-8000-000000000002';
const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const quiet = async (p: Promise<unknown>) => { try { await p; } catch { /* the action redirects */ } };
const review = async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ chrome: 'anand-fpo', key: KEY, language: 'hi', starts: '22:30', ends: '07:00', zone: '', promo: 'on' })) f.set(k, v);
  for (const c of ['order.created::push', 'order.created::inapp', 'bid.outbid::push', 'bid.outbid::inapp', 'chat.message_posted::push', 'chat.message_posted::inapp']) f.append('cell', c);
  await quiet(reviewPreferencesAction(f));
};
beforeEach(() => { reset(); });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W299 the inbox with ladders', () => InboxPage({ params: P, searchParams: {} })],
  ['W299 empty', async () => { C.inbox = []; return InboxPage({ params: P, searchParams: {} }); }],
  ['W299 error', async () => { C.fail.inbox = new SdkError('UNAVAILABLE', 503, 'x'); return InboxPage({ params: P, searchParams: {} }); }],
  ['W302 the page', () => PrefsPage({ params: P, searchParams: {} })],
  ['W3134 the review', async () => { await review(); return PrefsPage({ params: P, searchParams: { step: 'review', k: KEY } }); }],
  ['W3136 a named failure', async () => { await review(); return PrefsPage({ params: P, searchParams: { step: 'review', k: KEY, failure: 'zone' } }); }],
  ['W3135 saved', () => PrefsPage({ params: P, searchParams: { ok: 'saved' } })],
  ['W302 load error', async () => { C.fail.matrix = new SdkError('UNAVAILABLE', 503, 'x'); return PrefsPage({ params: P, searchParams: {} }); }],
];

describe('STORE-4c · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const lang of ['hi', 'gu']) {
      for (const [, make] of STATES) {
        reset(); C.lang = lang;
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
