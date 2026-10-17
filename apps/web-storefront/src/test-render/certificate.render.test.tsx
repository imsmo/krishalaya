// apps/web-storefront/src/test-render/certificate.render.test.tsx · PC-56 STORE-5b · C4 (canon W305) — the certificate page:
//   • by id: the type from the vocabulary, the status with its meaning, "Checked by <organisation> (<role>) on <date>" — never a person, never
//     "platform-verified"; the number, issuer, validity, what it covers; a rejected certificate shows its reason; expired / pending meanings;
//   • the lookup FORM by number (the store's organisation; the platform asks for the organisation too); not published ≠ not found;
//   • the refusals by name; no uuid in the markup.
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
import CertPage from '../app/(platform)/certificates/[id]/page';
import LookupPage from '../app/(platform)/certificates/page';
import TenantLookupPage from '../app/[tenantSlug]/certificates/page';
import { SdkError } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, CERT, CERT_ID, TOKEN, SLUG, UUIDS } from './store5b-fixtures';
import { store5bRefusalKeys } from '../features/store5b/refusals';

jest.mock('../lib/storefront-data', () => ({ loadTenantShell: async () => ({ kind: 'ok', tenant: { slug: 'anand-fpo', displayName: 'Anand FPO' }, branding: null }) }));
const byId = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CertPage({ params: { id: CERT_ID }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('STORE-5b · W305 the certificate', () => {
  it('verified: the type label, the status + meaning, "Checked by Anand FPO (its FPO coordinator) on <date>", the facts; no person, no uuid', async () => {
    const html = await byId({ lot: TOKEN }); const h = text(html);
    expect(html).toContain('data-kv-status="verified"');
    expect(h).toContain('NPOP (India Organic)');
    expect(h).toContain(en['store5b.cert.meaning.verified']);
    expect(h).toMatch(/Checked by Anand FPO \(its FPO coordinator\) on /);
    expect(h).toContain('NPOP-26-0419'); expect(h).toContain('APEDA-accredited certification body');
    expect(h).toContain('a listing: GG-20 groundnut');
    expect(html).toContain(`href="/trace/${TOKEN}"`);   // back to the lot
    expect(UUIDS(html)).toEqual([]);
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/platform-verified|verified by platform|platform verification|krishalaya\.in|polygon|anchored/i);
  });
  it('rejected shows its reason; expired and pending say what is true; an unnamed role reads "a staff member"', async () => {
    C.cert = CERT({ status: 'rejected', rejectionReason: 'The lab could not confirm the number', checkedBy: { organisation: 'Anand FPO', role: 'support_agent', at: null } });
    let h = text(await byId());
    expect(h).toContain('The lab could not confirm the number'); expect(h).toContain('Checked by Anand FPO (a staff member).');
    C.cert = CERT({ status: 'expired' });
    h = text(await byId());
    expect(h).toContain(en['store5b.cert.meaning.expired']); expect(h).not.toMatch(/lost the badge the same day/);
    C.cert = CERT({ status: 'pending', checkedBy: null });
    h = text(await byId());
    expect(h).toContain('Not yet checked by Anand FPO.'); expect(h).toContain('organic (self-declared)');
  });
  it('the states: not published ≠ not found; the error with Retry (a reload)', async () => {
    C.fail.cert = new SdkError('CERTIFICATE_NOT_PUBLISHED', 404, 'x');
    expect(await byId()).toContain('data-kv-cert="not-published"');
    C.fail.cert = new SdkError('CERTIFICATE_NOT_FOUND', 404, 'x');
    expect(await byId()).toContain('data-kv-cert="not-found"');
    C.fail.cert = new SdkError('UNAVAILABLE', 503, 'x');
    const e = await byId();
    expect(e).toContain('data-kv-cert="error"'); expect(e).toContain('data-kv-retry="reload"');
  });
  it('the lookup FORM: none yet; the platform asks for the organisation (need-org without it); the store looks within its organisation', async () => {
    let html = renderToStaticMarkup(await LookupPage({ searchParams: {} }));
    expect(html).toContain('data-kv-cert="none-yet"'); expect(html).toContain('name="org"');
    html = renderToStaticMarkup(await LookupPage({ searchParams: { no: 'NPOP-26-0419' } }));
    expect(html).toContain('data-kv-cert="need-org"');
    html = renderToStaticMarkup(await LookupPage({ searchParams: { no: 'NPOP-26-0419', org: SLUG } }));
    expect(html).toContain('data-kv-status="verified"');
    expect(C.calls).toContainEqual(['certificates.publicByNo', { no: 'NPOP-26-0419' }, SLUG]);
    reset();
    html = renderToStaticMarkup(await TenantLookupPage({ params: { tenantSlug: SLUG }, searchParams: {} }));
    expect(html).not.toContain('name="org"'); expect(text(html)).toContain('Looked up among Anand FPO\'s certificates.');
  });
  it('the refusals by name: platform verification, the brand QR, findings, issuer contact, the phone line, "lost the badge the same day" reworded', async () => {
    const h = text(await byId());
    for (const k of store5bRefusalKeys('certificate')) expect(h).toContain(en[k as keyof typeof en]);
    expect(store5bRefusalKeys('certificate')).toEqual(expect.arrayContaining(['store5b.refusal.platformVerified', 'store5b.refusal.brandQr', 'store5b.refusal.findings', 'store5b.refusal.issuerContact', 'store5b.refusal.phoneLine', 'store5b.refusal.badgeSameDay']));
  });
});
