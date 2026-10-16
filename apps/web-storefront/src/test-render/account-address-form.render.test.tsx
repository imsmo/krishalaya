// apps/web-storefront/src/test-render/account-address-form.render.test.tsx · PC-56 HOTFIX-6 · C1 (survey STORE-4 F-5, Rule Zero / PII) — KEPT, and
// RETARGETED by PC-56 STORE-4a: the address book left the /account page for /account/addresses (W301) and its form chain (W3034–W3037), so
// HOTFIX-6's five proofs now read the new form and the new book:
//   • the add form carries a COUNTRY field whose default comes from the data (a GB store prints GB; nothing readable prints nothing — never a
//     literal), the postal field on the one rule (4–10 digits, no six-digit pin), and a key minted at render;
//   • a NON-INDIAN postal code (five digits, GB) is accepted and sent with the country and the key; a missing country is refused by name;
//   • the receiver phone is printed MASKED on every card — the full number never reaches the page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import AddressBook from '../app/(platform)/account/addresses/page';
import { reviewAddressAction, submitAddressAction } from '../app/(platform)/account/addresses/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, RECEIVER_PHONE } from './store4a-fixtures';

const KEY = 'address:0213c0de-0000-4000-8000-000000000001';
const newPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await NewAddress({ searchParams: sp }));
const book = async () => renderToStaticMarkup(await AddressBook({ searchParams: {} }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
beforeEach(() => { reset(); });

describe('HOTFIX-6 · C1 the account address form (Rule Zero) — on the STORE-4a form', () => {
  it('a country field defaulted from the SESSION STORE (GB), the postal field on the 4–10 digit rule, a key minted at render', async () => {
    const h = await newPage();
    expect(h).toMatch(/<input id="ad-cc" name="countryCode"[^>]*value="GB"/);
    expect(text(h)).toContain(en['account.countryCode']);
    expect(h).toContain('pattern="\\d{4,10}"');
    expect(h).not.toContain('pattern="\\d{6}"');
    expect(h).toMatch(/<input type="hidden" name="key" value="address:[0-9a-f-]{36}"/);
  });
  it('the store cannot be read → the country field is EMPTY (never a literal "IN")', async () => {
    C.storeFails = true;
    const field = (await newPage()).match(/<input id="ad-cc"[^>]*>/)![0];
    expect(field).not.toMatch(/value="[A-Z]{2}"/);
    expect(field).not.toContain('IN');
  });
  it('a NON-INDIAN postal code (5 digits, GB) is accepted and sent with the country and the render key', async () => {
    expect(await redirectOf(reviewAddressAction(form({ chrome: 'platform', key: KEY, line1: '14 Mill Lane', pincode: '12345', countryCode: 'gb', contactPhone: '+44 7700 900123' })))).toContain('step=review');
    expect(await redirectOf(submitAddressAction(form({ chrome: 'platform', key: KEY })))).toBe('REDIRECT /account/addresses?ok=created&id=new-address');
    expect(C.calls).toContainEqual(['addresses.create', { line1: '14 Mill Lane', pincode: '12345', countryCode: 'GB', contactPhone: '+44 7700 900123' }, KEY]);
  });
  it('no country → refused by name (the API\'s default is gone, and this form never relied on it); a 3-digit code → the postal refusal', async () => {
    await redirectOf(reviewAddressAction(form({ chrome: 'platform', key: KEY, line1: '14 Mill Lane', pincode: '123' })));
    const h = await newPage({ k: KEY, error: 'form' });
    expect(h).toContain('data-kv-field-error="countryCode"'); expect(h).toContain('data-kv-field-error="pincode"');
    expect(C.calls.filter((c) => c[0] === 'addresses.create')).toEqual([]);
  });
  it('the receiver phone is MASKED on every card — the full number never reaches the page', async () => {
    const h = await book();
    expect(text(h)).toContain('Nilesh · +91 98••• ••742');
    expect(h).not.toContain(RECEIVER_PHONE);
    expect(h).not.toContain('9898012742');
  });
});
