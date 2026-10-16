// apps/web-storefront/src/test-render/data-rights.render.test.tsx · PC-56 STORE-4a · C7 — "Download my data": canon W3029 (queued) and W3030 (ready),
// REAL (components/account/DataRightsScreen.tsx + the request / mint actions + the download proxy):
//   • none → the request act with a key minted at render; the act reaches the API and answers back to the page;
//   • queued → the position and the honest ETA (an estimate in minutes; "no estimate yet" without history) + "we notify you";
//   • ready → the receipt (file, rows, sha256, generated-at, requester = you) + "Download (link valid N minutes)" with N from the plane, every
//     fetch logged; the mint → this app's download route with the token (never rendered into the page);
//   • expired → the removal date + request again; failed → the plane's code by name + request again.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4a-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import DataPage from '../app/(platform)/account/data/page';
import TenantDataPage from '../app/[tenantSlug]/account/data/page';
import { requestExportAction, mintDownloadAction } from '../app/(platform)/account/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, exportRequest, JOB, SHA } from './store4a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await DataPage({ searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
beforeEach(() => { reset(); });

describe('STORE-4a · W3029 the request and the queue', () => {
  it('no request yet → the request act with a key minted at render; it reaches the API and answers back to the page', async () => {
    const h = await page();
    expect(h).toContain('data-kv-state="none"'); expect(h).toMatch(/name="key" value="dsr-export:[0-9a-f-]{36}"/);
    expect(text(h)).toContain(en['store4a.data.lead']);
    const key = 'dsr-export:0214aaaa-0000-4000-8000-000000000001';
    expect(await redirectOf(requestExportAction(form({ chrome: 'platform', key })))).toBe('REDIRECT /account/data?ok=requested');
    expect(C.calls).toContainEqual(['privacy.requestDataExport', key]);
    C.fail.export = new SdkError('INTERNAL', 500, 'x');
    expect(await redirectOf(requestExportAction(form({ chrome: 'anand-fpo', key })))).toBe(`REDIRECT /anand-fpo/account/data?error=request&k=${encodeURIComponent(key)}`);
  });
  it('queued → position + the plane\'s ETA in minutes (rounded up) + "we notify you"; no history → "no estimate yet"', async () => {
    C.requests = [exportRequest('queued')];
    let h = await page();
    expect(h).toContain('data-kv-state="queued"'); expect(h).toContain('data-kv-position="3"');
    expect(text(h)).toContain('Position in the queue: 3'); expect(text(h)).toContain('Estimated wait: about 3 min');
    expect(text(h)).toContain(en['store4a.data.notify']); expect(h).not.toContain('data-kv-cta="request-export"');
    C.requests = [exportRequest('queued', { standing: { position: 1, ahead: 0, eta: { kind: 'no_history' } } })];
    h = await page();
    expect(h).toContain('data-kv-eta="no_history"'); expect(text(h)).toContain(en['store4a.data.etaNone']);
  });
});

describe('STORE-4a · W3030 the receipt and the download', () => {
  it('ready → file, rows, sha256, generated-at, requester = YOU; the download label from the plane\'s TTL; every fetch logged', async () => {
    C.requests = [exportRequest('ready')];
    const h = await page(); const v = text(h);
    expect(h).toContain('data-kv-receipt'); expect(v).toContain('identity-dpdp_person-my-data-2026-10-16.csv');
    expect(h).toContain('data-kv-rows="42"'); expect(h).toContain(SHA); expect(h).toContain('data-kv-requester="you"');
    expect(v).toContain('Download (link valid 15 minutes)'); expect(v).toContain(en['store4a.data.fetchLogged']);
    expect(h).toContain(`name="id" value="${JOB}"`);
    expect(h).not.toContain('tok_');                                   // no token is ever rendered into the page
  });
  it('a receipt for anyone but you is never drawn as yours', async () => {
    C.requests = [exportRequest('ready', { receipt: { ...exportRequest('ready').export.receipt, requestedBy: 'someone-else' } })];
    expect(await page()).toContain('data-kv-requester="unknown"');
  });
  it('the mint → this app\'s own download route WITH the token (the console\'s pattern); a refused mint → named on the page', async () => {
    expect(await redirectOf(mintDownloadAction(form({ chrome: 'platform', id: JOB })))).toBe(`REDIRECT /account/data/${JOB}/download?token=tok_abcdefghijklmnop.sig`);
    expect(await redirectOf(mintDownloadAction(form({ chrome: 'anand-fpo', id: JOB })))).toBe(`REDIRECT /anand-fpo/account/data/${JOB}/download?token=tok_abcdefghijklmnop.sig`);
    C.fail.mint = new SdkError('EXPORT_FILE_EXPIRED', 410, 'gone');
    expect(await redirectOf(mintDownloadAction(form({ chrome: 'platform', id: JOB })))).toBe('REDIRECT /account/data?download=EXPORT_FILE_EXPIRED');
    C.requests = [exportRequest('ready')];
    expect(text(await page({ download: 'EXPORT_FILE_EXPIRED' }))).toContain(en['store4a.data.downloadError.fileExpired']);
  });
  it('expired → the removal date + request again; failed → the plane\'s code by name + request again', async () => {
    C.requests = [exportRequest('expired')];
    let h = await page();
    expect(h).toContain('data-kv-expired'); expect(text(h)).toMatch(/The file was removed on 23 Oct 2026/); expect(h).toContain('data-kv-cta="request-export"');
    expect(h).not.toContain('data-kv-cta="download"');
    C.requests = [exportRequest('failed')];
    h = await page();
    expect(h).toContain('data-kv-failure="storage_failed"'); expect(text(h)).toContain(en['store4a.data.failure.storage_failed']); expect(h).toContain('data-kv-cta="request-export"');
  });
  it('under the organisation\'s chrome the same screen, its own hrefs; the helpline refused', async () => {
    C.requests = [exportRequest('ready')];
    const h = renderToStaticMarkup(await TenantDataPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} }));
    expect(h).toContain('data-kv-chrome="anand-fpo"'); expect(h).toContain('name="chrome" value="anand-fpo"'); expect(h).toContain('data-kv-refusal="helpline"');
  });
});
