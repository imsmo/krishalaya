// apps/web-storefront/src/test-render/trace-export.render.test.tsx · PC-56 STORE-5b · C3 (canon W3154 / W3155) — the record export, REAL (founder D2):
//   • no job → "Prepare the file" with the key MINTED AT RENDER; the act posts it and lands on ?job=; a named failure comes back with the SAME key;
//   • queued (W3154): the position and the plane's ETA, "Check ready page", Back → the verify page;
//   • ready (W3155): the receipt (file, rows, sha256, generated-at, You), "Download (link valid 15 minutes)" from the plane's TTL, every fetch
//     logged, CSV not JSON; "signed" refused.
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
import ExportPage from '../app/(platform)/trace/[qrToken]/export/page';
import TenantExportPage from '../app/[tenantSlug]/trace/[qrToken]/export/page';
import { requestTraceExportAction, mintTraceDownloadAction } from '../app/(platform)/trace/actions';
import { SdkError } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, TOKEN, JOB_ID, KEY, READY, SLUG, UUIDS } from './store5b-fixtures';
import { store5bRefusalKeys } from '../features/store5b/refusals';

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ExportPage({ params: { qrToken: TOKEN }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message).replace(/^REDIRECT /, ''); } };
beforeEach(() => { reset(); });

describe('STORE-5b · W3154 / W3155 the record export', () => {
  it('no job: "Prepare the file" with a key minted at render (trace-export:<uuid>); the act posts it and lands on ?job=', async () => {
    const html = await render();
    expect(html).toContain('data-kv-phase="none"');
    const key = html.match(/name="key" value="(trace-export:[0-9a-f-]{36})"/)?.[1];
    expect(key).toBeDefined();
    expect(text(html)).toContain(en['store5b.export.request']);
    expect(await redirectOf(requestTraceExportAction(form({ chrome: 'platform', qrToken: TOKEN, key: key! })))).toBe(`/trace/${TOKEN}/export?job=${JOB_ID}`);
    expect(C.calls).toContainEqual(['traceability.requestExport', TOKEN, key]);
  });
  it('a named failure comes back with the SAME key; Retry re-posts it (one job however often)', async () => {
    C.fail.export = new SdkError('TRACE_EXPORT_UNAVAILABLE', 503, 'x');
    const to = await redirectOf(requestTraceExportAction(form({ chrome: 'platform', qrToken: TOKEN, key: KEY })));
    expect(to).toBe(`/trace/${TOKEN}/export?failure=unavailable&k=${encodeURIComponent(KEY)}`);
    const html = await render({ failure: 'unavailable', k: KEY });
    expect(html).toContain('data-kv-failure="unavailable"');
    expect(html).toContain(`name="key" value="${KEY}"`);
    expect(text(html)).toContain(en['store5b.export.failure.unavailable']);
    expect(text(await render({ failure: 'no_longer' }))).toContain(en['store5b.export.failure.no_longer']);
    expect(await render({ failure: 'no_longer' })).not.toContain('data-kv-cta="request-export"');   // nothing to retry: the lot is gone dark
  });
  it('W3154 queued: the position and the ETA, "Check ready page" (this page again), Back → the verify page', async () => {
    const html = await render({ job: JOB_ID }); const h = text(html);
    expect(html).toContain('data-kv-phase="queued"');
    expect(html).toContain('data-kv-position="2"'); expect(html).toContain('data-kv-eta="estimate"');
    expect(html).toContain(`href="/trace/${TOKEN}/export?job=${JOB_ID}"`);
    expect(html).toContain(`href="/trace/${TOKEN}/verify"`);
    expect(h).toContain(en['store5b.export.check']);
  });
  it('W3155 ready: the receipt (file, rows, sha256, generated-at, You), "Download (link valid 15 minutes)", every fetch logged, CSV not JSON; the mint goes to this app\'s route', async () => {
    C.job = READY();
    const html = await render({ job: JOB_ID }); const h = text(html);
    expect(html).toContain('data-kv-phase="ready"');
    expect(html).toContain('data-kv-rows="4"'); expect(html).toContain('f'.repeat(64)); expect(html).toContain('data-kv-requester="you"');
    expect(h).toContain(en['store4a.data.download'].replace('{n}', '15'));
    expect(h).toContain(en['store4a.data.fetchLogged']); expect(h).toContain(en['store5b.export.csv']);
    for (const k of store5bRefusalKeys('trace_export')) expect(h).toContain(en[k as keyof typeof en]);
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/signed record|Download signed/i);
    expect(UUIDS(html)).toEqual(expect.arrayContaining([JOB_ID]));
    expect(UUIDS(html).every((u) => u === JOB_ID)).toBe(true);
    const to = await redirectOf(mintTraceDownloadAction(form({ chrome: 'platform', qrToken: TOKEN, id: JOB_ID })));
    expect(to).toMatch(new RegExp(`^/trace/${TOKEN}/export/${JOB_ID}/download\\?token=tok_`));
  });
  it('under the organisation\'s chrome: the same screen, the store\'s paths', async () => {
    const html = renderToStaticMarkup(await TenantExportPage({ params: { tenantSlug: SLUG, qrToken: TOKEN }, searchParams: { job: JOB_ID } }));
    expect(html).toContain(`data-kv-chrome="${SLUG}"`);
    expect(html).toContain(`href="/${SLUG}/trace/${TOKEN}/verify"`);
  });
});
