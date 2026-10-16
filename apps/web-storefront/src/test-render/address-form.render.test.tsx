// apps/web-storefront/src/test-render/address-form.render.test.tsx · PC-56 STORE-4a · C7 — the address FORM chain (canon W3034 → W3035 → W3036 /
// W3037, components/account/AddressFormScreen.tsx + app/(platform)/account/addresses/actions.ts):
//   • W3034: every field's refusal at once by the one rule + the label + the note's bound, the values KEPT (a server-held draft, not the URL);
//   • W3035: the create shows everything read-only (the phone masked); an EDIT shows the diff against the current row, field by field;
//   • the key minted at render rides the chain to Submit — and back on Retry; a blank phone on an edit keeps the current one;
//   • W3036: success for a copied edit → the book `?ok=copied`; W3037: each named failure (validation / label / not found / concurrency /
//     server), the values and the key kept.
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

import NewAddress from '../app/(platform)/account/addresses/new/page';
import EditAddress from '../app/(platform)/account/addresses/[id]/edit/page';
import { reviewAddressAction, submitAddressAction } from '../app/(platform)/account/addresses/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, ADDR, LABEL, RECEIVER_PHONE } from './store4a-fixtures';

const KEY = 'address:0214c0de-0000-4000-8000-000000000001';
const newPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await NewAddress({ searchParams: sp }));
const editPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await EditAddress({ params: { id: ADDR.farm }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
beforeEach(() => { reset(); });

describe('STORE-4a · W3034 the form — every refusal, the values kept', () => {
  it('the label select from the vocabulary (worded by code), the country defaulted from the data (never a literal), a key minted at render', async () => {
    const h = await newPage();
    for (const code of ['home', 'farm', 'shop', 'warehouse', 'delivery']) expect(h).toContain(`data-kv-label-code="${code}"`);
    expect(h).toMatch(/<input id="ad-cc" name="countryCode"[^>]*value="GB"/);        // the person names no country → the session store's
    expect(h).toMatch(/<input type="hidden" name="key" value="address:[0-9a-f-]{36}"/);
    expect(h).toContain('pattern="\\d{4,10}"');
    C.me = { ...C.me, countryCode: 'IN' };
    expect(await newPage()).toMatch(/<input id="ad-cc" name="countryCode"[^>]*value="IN"/);   // the person's own country first
    C.me = { ...C.me, countryCode: null }; C.storeFails = true;
    expect((await newPage()).match(/<input id="ad-cc"[^>]*>/)![0]).not.toMatch(/value="[A-Z]{2}"/);
  });
  it('a refused submit lists EVERY field\'s refusal at once, keeps the values (in an httpOnly draft — never the URL) and the key', async () => {
    const r = await redirectOf(reviewAddressAction(form({ chrome: 'platform', key: KEY, line1: 'ab', pincode: '123', countryCode: 'X', labelId: '0214e000-0000-7000-8000-0000000000ff', deliveryNote: 'n'.repeat(281), contactPhone: '+919898012742' })));
    expect(r).toBe(`REDIRECT /account/addresses/new?k=${encodeURIComponent(KEY)}&error=form`);
    expect(r).not.toContain('9898012742');
    const h = await newPage({ k: KEY, error: 'form' }); const v = text(h);
    expect(h).toContain('data-kv-state="form-error"');
    for (const f of ['line1', 'pincode', 'countryCode', 'labelId', 'deliveryNote']) expect(h).toContain(`data-kv-field-error="${f}"`);
    expect(v).toContain(en['store4a.address.err.noteTooLong']);
    expect(h).toMatch(/<input id="ad-l1" name="line1"[^>]*value="ab"/);
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(C.calls.filter((c) => c[0] === 'addresses.create')).toEqual([]);
  });
});

describe('STORE-4a · W3035 review → W3036 success / W3037 failure', () => {
  const good = { chrome: 'platform', key: KEY, line1: '14 Mill Lane', pincode: '12345', countryCode: 'gb', labelId: LABEL.home, contactPhone: '+447700900123', deliveryNote: 'Side gate' };
  it('create: the review shows every value read-only (the phone MASKED), Submit carries the SAME key; success → the book', async () => {
    expect(await redirectOf(reviewAddressAction(form(good)))).toBe(`REDIRECT /account/addresses/new?k=${encodeURIComponent(KEY)}&step=review`);
    const h = await newPage({ k: KEY, step: 'review' }); const v = text(h);
    expect(h).toContain('data-kv-screen="address-review"'); expect(h).toContain('data-kv-review="create"');
    expect(v).toContain('14 Mill Lane'); expect(v).toContain('Home'); expect(v).toContain('Side gate'); expect(v).toContain('GB');
    expect(h).not.toContain('7700900123');
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(await redirectOf(submitAddressAction(form({ chrome: 'platform', key: KEY })))).toBe('REDIRECT /account/addresses?ok=created&id=new-address');
    expect(C.calls).toContainEqual(['addresses.create', { line1: '14 Mill Lane', pincode: '12345', countryCode: 'GB', contactPhone: '+447700900123', labelId: LABEL.home, deliveryNote: 'Side gate' }, KEY]);
    expect(C.cookies.size).toBe(0);   // the draft is spent
  });
  it('edit: the review shows the DIFF against the current row, field by field; a blank phone keeps the current one; a copied edit → ?ok=copied', async () => {
    const e = await editPage();
    expect(e).toMatch(/<input id="ad-cp" name="contactPhone"[^>]*value=""/);          // never pre-filled (PII)
    expect(text(e)).toContain('Current number +91 98••• ••742');
    expect(e).not.toContain(RECEIVER_PHONE);
    await redirectOf(reviewAddressAction(form({ chrome: 'platform', id: ADDR.farm, key: KEY, line1: 'Plot 14, GIDC Vadal', village: 'Vadal', pincode: '362001', countryCode: 'IN', contactName: 'Nilesh', contactPhone: '', labelId: LABEL.warehouse, deliveryNote: 'Gate 3 now' })));
    const h = await editPage({ k: KEY, step: 'review' });
    expect(h).toContain('data-kv-diff="2"');
    expect(h).toContain('data-kv-diff-field="labelId"'); expect(h).toContain('data-kv-diff-field="deliveryNote"'); expect(h).not.toContain('data-kv-diff-field="contactPhone"');
    expect(text(h)).toContain('Farm'); expect(text(h)).toContain('Warehouse'); expect(text(h)).toContain('Gate 3 now');
    expect(text(h)).toContain(en['store4a.review.copyRule']);
    expect(await redirectOf(submitAddressAction(form({ chrome: 'platform', id: ADDR.farm, key: KEY })))).toBe('REDIRECT /account/addresses?ok=copied&id=copy-address');
    expect(C.calls).toContainEqual(['addresses.update', ADDR.farm, { labelId: LABEL.warehouse, deliveryNote: 'Gate 3 now' }, KEY]);
  });
  it.each([
    ['validation', new SdkError('VALIDATION_FAILED', 422, 'bad')], ['label', new SdkError('ADDRESS_LABEL_UNKNOWN', 422, 'x')],
    ['not_found', new SdkError('ADDRESS_NOT_FOUND', 404, 'nf')], ['concurrency', new SdkError('CONFLICT', 409, 'in flight')], ['server', new SdkError('INTERNAL', 500, 'x')],
  ])('W3037 %s → named on the review, values kept, the SAME key (Retry), never a W316 link', async (name, err) => {
    await redirectOf(reviewAddressAction(form(good)));
    C.fail.create = err;
    expect(await redirectOf(submitAddressAction(form({ chrome: 'platform', key: KEY })))).toBe(`REDIRECT /account/addresses/new?k=${encodeURIComponent(KEY)}&step=review&failure=${name}`);
    const h = await newPage({ k: KEY, step: 'review', failure: name });
    expect(h).toContain(`data-kv-failure="${name}"`); expect(text(h)).toContain(en[`store4a.failure.${name}` as keyof typeof en]);
    expect(h).toContain(`name="key" value="${KEY}"`); expect(text(h)).toContain('14 Mill Lane');
    expect(h).toContain(`href="/account/addresses/new?k=${encodeURIComponent(KEY)}"`);   // Back to edit — the form itself
    expect(h).not.toMatch(/W316/);
  });
  it('a malformed key is never trusted: the review step refuses to start without the render key', async () => {
    expect(await redirectOf(reviewAddressAction(form({ ...good, key: 'not-a-key' })))).toBe('REDIRECT /account/addresses/new');
  });
});
