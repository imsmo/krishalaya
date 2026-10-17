// apps/web-storefront/src/test-render/trace-hotfix7.render.test.tsx · PC-56 HOTFIX-7 · B10 / B25 — the public trace page on the v2 answer (minimal;
// STORE-5b rebuilds the page):
//   • the ORGANISATION that recorded the journey is named; NO uuid reaches the DOM (the v2 answer carries none, and the page adds none);
//   • OFF ≠ NOT FOUND: TRACE_NOT_PUBLISHED renders "not published" (noindex metadata) — never the 404; TRACE_SCAN_NOT_FOUND is the 404.
// PC-56 STORE-5b: the page is now the shared TraceScreen (v3): the organisation line is `store5b.trace.recordedBy`, steps print their LABELS
// (`trace.step.*` — "in transit" was the raw code), and the page reads more mocks (env, the language-aware client for the certificate types).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

const S: { lang: 'en' | 'hi' | 'gu'; scan: () => Promise<unknown> } = { lang: 'en', scan: async () => ({}) };
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => S.lang, getTranslator: () => new Tr(S.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/api-client', () => ({ publicClient: () => ({ traceability: { scan: () => S.scan() } }), publicClientIn: () => ({ lookups: { values: async () => [] } }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('server-only', () => ({}), { virtual: true });

import TraceScanPage, { generateMetadata } from '../app/(platform)/trace/[qrToken]/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const V2 = { qrToken: 'HF7QRTOKEN000', organisation: { displayName: 'Anand FPO' }, createdAt: '2026-10-16T18:30:00.000Z', anchored: false,
  events: [{ eventCode: 'harvested', at: '2026-10-16T18:30:00.000Z', meta: { variety: 'GG-20' } }, { eventCode: 'in_transit', at: '2026-10-17T04:00:00.000Z', meta: { mode: 'road' } }] };
const render = async () => renderToStaticMarkup(await TraceScanPage({ params: { qrToken: 'HF7QRTOKEN000' }, searchParams: {} }));
beforeEach(() => { S.lang = 'en'; S.scan = async () => V2; });

describe('HOTFIX-7 · the public trace page (v2)', () => {
  it('names the ORGANISATION that recorded the journey; the steps are listed; no uuid anywhere in the markup', async () => {
    const h = await render();
    expect(h).toContain('data-kv-trace="published"');
    expect(h).toContain(en['store5b.trace.recordedBy'].replace('{org}', 'Anand FPO'));   // STORE-5b: the v3 screen's line
    expect(h).toContain(en['trace.step.harvested']); expect(h).toContain(en['trace.step.in_transit']);   // STORE-5b: labels, never the raw code
    expect(h).not.toMatch(UUID);
    S.lang = 'hi';
    expect(await render()).toContain(hi['store5b.trace.recordedBy'].replace('{org}', 'Anand FPO'));
  });
  it('TRACE_NOT_PUBLISHED → "not published" (never the 404), noindex; TRACE_SCAN_NOT_FOUND → the 404', async () => {
    S.scan = async () => { throw new SdkError('TRACE_NOT_PUBLISHED', 404, 'not published'); };
    const h = await render();
    expect(h).toContain('data-kv-trace="not-published"');
    expect(h).toContain(en['trace.notPublishedTitle']); expect(h).toContain(en['trace.notPublishedBody']);
    expect(await generateMetadata({ params: { qrToken: 'HF7QRTOKEN000' } })).toMatchObject({ title: en['trace.notPublishedTitle'], robots: { index: false } });
    S.scan = async () => { throw new SdkError('TRACE_SCAN_NOT_FOUND', 404, 'no'); };
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
