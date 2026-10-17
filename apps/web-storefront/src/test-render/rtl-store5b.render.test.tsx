// apps/web-storefront/src/test-render/rtl-store5b.render.test.tsx · PC-56 STORE-5b · C7 — the trace, verify, export (queued, ready, a failure), certificate
// (verified, rejected, the form) and dairy pages under dir="rtl" carry no PHYSICAL-direction class or inline style and no bare arrow outside
// .kv-dir-flip (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => ({ get: () => null }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5b-fixtures');
  return { getLang: () => f.C.lang, getLanguageDef: () => ({ code: f.C.lang, dir: 'ltr' }), getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, publicClientIn: f.publicClientIn };
});
jest.mock('server-only', () => ({}), { virtual: true });
import TracePage from '../app/(platform)/trace/[qrToken]/page';
import VerifyPage from '../app/(platform)/trace/[qrToken]/verify/page';
import ExportPage from '../app/(platform)/trace/[qrToken]/export/page';
import CertPage from '../app/(platform)/certificates/[id]/page';
import LookupPage from '../app/(platform)/certificates/page';
import DairyPage from '../app/(platform)/trace/[qrToken]/dairy/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, TOKEN, CERT_ID, JOB_ID, READY, CERT } from './store5b-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
beforeEach(() => { reset(); });

const STATES: Array<[string, () => Promise<React.ReactNode> | React.ReactNode]> = [
  ['W303 the trace', () => TracePage({ params: { qrToken: TOKEN }, searchParams: {} })],
  ['W304 verify', () => VerifyPage({ params: { qrToken: TOKEN }, searchParams: {} })],
  ['W3154 queued', () => ExportPage({ params: { qrToken: TOKEN }, searchParams: { job: JOB_ID } })],
  ['W3155 ready', () => { C.job = READY(); return ExportPage({ params: { qrToken: TOKEN }, searchParams: { job: JOB_ID } }); }],
  ['W3154 a failure', () => ExportPage({ params: { qrToken: TOKEN }, searchParams: { failure: 'server' } })],
  ['W305 verified', () => CertPage({ params: { id: CERT_ID }, searchParams: {} })],
  ['W305 rejected', () => { C.cert = CERT({ status: 'rejected', rejectionReason: 'x' }); return CertPage({ params: { id: CERT_ID }, searchParams: {} }); }],
  ['W305 the form', () => LookupPage({ searchParams: {} })],
  ['W306 refused', () => DairyPage({ params: { qrToken: TOKEN } })],
];

describe('STORE-5b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_n, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const l of ['hi', 'gu']) for (const i of [0, 1, 3, 5]) {
      reset(); C.lang = l;
      const html = await rtl(await STATES[i][1]());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
