// apps/web-storefront/src/test-render/trace.render.test.tsx · PC-56 STORE-5b · C1 (canon W303) — the trace page under the platform chrome:
//   • the product line, the ONLY farmer line (organisation + village — never a person), the step LABELS (never a raw code), the meta with labels,
//     "step n of N" and SHORT hashes, the sold line with NO money, the seal sentence (or "not yet sealed"), the certificates (type from the
//     vocabulary, linked to W305), "Check the record yourself" → W304, the refusals; no uuid in the markup but the certificate id;
//   • the states: in progress (no events), not published, NO LONGER published, not found (404), the error with Retry (a reload).
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
import { SdkError } from '@krishalaya/sdk-js';
import TracePage, { generateMetadata } from '../app/(platform)/trace/[qrToken]/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { C, reset, TOKEN, CERT_ID, HASHES, SCAN, UUIDS } from './store5b-fixtures';
import { store5bRefusalKeys } from '../features/store5b/refusals';

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TracePage({ params: { qrToken: TOKEN }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('STORE-5b · W303 the trace', () => {
  it('the product line, the organisation-only farmer line with the village and district, recorded by the organisation', async () => {
    const h = text(await render());
    expect(h).toContain('GG-20 groundnut · 25 quintal lot');
    expect(h).toContain('Grown by a verified member farmer of Anand FPO, Vanthali, Junagadh.');
    expect(h).toContain(en['store5b.trace.recordedBy'].replace('{org}', 'Anand FPO'));
    expect(h).not.toMatch(/Ramesh|shared with his consent|Hear a greeting/);
  });
  it('every step by its LABEL (never the raw code), the meta with labels, step n of N, the SHORT hash; sold says no money', async () => {
    const html = await render(); const h = text(html);
    for (const k of ['trace.step.harvested', 'trace.step.in_transit', 'trace.step.sold'] as const) expect(h).toContain(en[k]);
    expect(h).not.toMatch(/\bin transit\b|\bin_transit\b/);
    expect(h).toContain('Variety: GG-20'); expect(h).toContain('Quantity: 25 quintal'); expect(h).toContain('How it travelled: road');
    expect(h).toContain('step 2 of 3'); expect(h).toContain(`hash ${HASHES[0].slice(0, 4)}…${HASHES[0].slice(-4)}`);
    expect(html).not.toContain(HASHES[0]);   // the full hash lives on the verify page
    expect(h).toContain(en['store5b.trace.soldLine']);
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/₹|escrow|Ramesh Bhai was paid|ledger entry|per quintal|94\.7/);
  });
  it('the seal: "Sealed by the platform at <time>" when it stamps the head; "not yet sealed" otherwise; never "Anchored ✓"', async () => {
    expect(text(await render())).toMatch(/Sealed by the platform at /);
    C.scan = SCAN({ anchor: { value: HASHES[0], anchoredAt: '2026-10-17T06:00:00.000Z', anchoredEventCount: 1, matchesHead: false } });
    const h = text(await render());
    expect(h).toContain(en['store5b.trace.notSealed']);
    expect(h).not.toMatch(/Anchored ✓|tamper-anchored/);
  });
  it('the certificates: type from the vocabulary (the page\'s language asked), status, valid until → W305 with the lot; Check the record → W304', async () => {
    const html = await render();
    expect(text(html)).toMatch(/NPOP \(India Organic\) · verified · valid until/);
    expect(html).toContain(`href="/certificates/${CERT_ID}?lot=${TOKEN}"`);
    expect(html).toContain(`href="/trace/${TOKEN}/verify"`);
    expect(C.calls).toContainEqual(['publicClientIn', 'en']);
    expect(C.calls).toContainEqual(['lookups.values', 'cert_type']);
  });
  it('the refusals by name (money split, was paid, the farmer\'s name, signed, public ledger, platform-verified …); no uuid but the certificate id', async () => {
    const html = await render();
    for (const k of store5bRefusalKeys('trace')) expect(text(html)).toContain(en[k as keyof typeof en]);
    expect(store5bRefusalKeys('trace')).toEqual(expect.arrayContaining(['store5b.refusal.moneySplit', 'store5b.refusal.wasPaid', 'store5b.refusal.farmerName', 'store5b.refusal.signed', 'store5b.refusal.publicLedger']));
    expect(UUIDS(html)).toEqual([CERT_ID]);
  });
  it('no events yet → "journey still in progress"; Hindi labels', async () => {
    C.scan = SCAN({ events: [], anchor: { value: null, anchoredAt: null, anchoredEventCount: null, matchesHead: false } });
    expect(text(await render())).toContain(en['store5b.trace.inProgress']);
    reset(); C.lang = 'hi';
    const h = text(await render());
    expect(h).toContain(hi['trace.step.harvested']); expect(h).toContain(hi['trace.step.in_transit']);
  });
  it('not published / NO LONGER published (noindex) / not found (404) / the error with Retry (a reload)', async () => {
    C.fail.scan = new SdkError('TRACE_NOT_PUBLISHED', 404, 'x');
    expect(await render()).toContain('data-kv-trace="not-published"');
    C.fail.scan = new SdkError('TRACE_NO_LONGER_PUBLISHED', 404, 'x');
    const h = await render();
    expect(h).toContain('data-kv-trace="no-longer"'); expect(text(h)).toContain(en['store5b.trace.noLongerBody']);
    expect(await generateMetadata({ params: { qrToken: TOKEN } })).toMatchObject({ title: en['store5b.trace.noLongerTitle'], robots: { index: false } });
    C.fail.scan = new SdkError('TRACE_SCAN_NOT_FOUND', 404, 'x');
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    C.fail.scan = new SdkError('UNAVAILABLE', 503, 'x');
    const e = await render();
    expect(e).toContain('data-kv-trace="error"'); expect(e).toContain('data-kv-retry="reload"');
  });
});
