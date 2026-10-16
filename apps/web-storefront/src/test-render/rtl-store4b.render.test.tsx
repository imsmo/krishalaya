// apps/web-storefront/src/test-render/rtl-store4b.render.test.tsx · PC-56 STORE-4b · C6 — the messages list (rows, empty, error, OFF), the thread
// (messages + composer, locked, reported success) and the report chain (confirm, failure) under dir="rtl" carry no PHYSICAL-direction class or
// inline style and no bare arrow outside .kv-dir-flip. Same guards as rtl-store4c (store1b-harness). In Hindi and Gujarati too.
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
import ThreadPage from '../app/[tenantSlug]/messages/[id]/page';
import ReportPage from '../app/[tenantSlug]/messages/[id]/report/[messageId]/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, IDS } from './store4b-fixtures';

const S = { tenantSlug: 'anand-fpo' };
const T = { ...S, id: IDS.order };
const R = { ...T, messageId: IDS.m2 };
const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
beforeEach(() => { reset(); });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W297 the rows', () => MessagesPage({ params: S, searchParams: {} })],
  ['W297 empty', async () => { C.threads = []; return MessagesPage({ params: S, searchParams: {} }); }],
  ['W297 error', async () => { C.fail.list = new SdkError('UNAVAILABLE', 503, 'x'); return MessagesPage({ params: S, searchParams: {} }); }],
  ['W297 off', async () => { C.flags = { ...C.flags, communication: false }; return MessagesPage({ params: S, searchParams: {} }); }],
  ['W298 the thread', () => ThreadPage({ params: T, searchParams: {} })],
  ['W298 locked', async () => { C.convo = { ...C.convo, isLocked: true, lockKind: 'dispute' }; return ThreadPage({ params: T, searchParams: {} }); }],
  ['W3110 reported', () => ThreadPage({ params: T, searchParams: { status: 'reported' } })],
  ['W3109 the confirm', () => ReportPage({ params: R, searchParams: {} })],
  ['W3111 a named failure', () => ReportPage({ params: R, searchParams: { failure: 'own', key: 'report:0216abcd-0000-4000-8000-000000000001', reason: 'spam' } })],
];

describe('STORE-4b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const l of ['hi', 'gu']) {
      C.lang = l;
      for (const [, make] of STATES.slice(0, 1).concat(STATES.slice(4, 5)).concat(STATES.slice(7, 8))) {
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
