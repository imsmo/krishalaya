// apps/web-storefront/src/test-render/account-address-form.render.test.tsx · PC-56 HOTFIX-6 · C1 (survey STORE-4 F-5, Rule Zero / PII) — the
// /account address book:
//   • the add form carries a COUNTRY field whose default is the session store's country (never a literal — a GB store prints GB; an
//     unreadable store prints nothing), the postal field on the one rule (pattern 4–10 digits, no six-digit pin), and a key minted at render;
//   • the action accepts a NON-INDIAN postal code (five digits, GB) and sends the country and the key; a missing country is refused by name;
//   • the receiver phone is printed MASKED (the five-of-ten policy) — the full number never reaches the page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./hotfix6-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./hotfix6-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./hotfix6-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import AccountPage from '../app/(platform)/account/page';
import { addAddressAction } from '../app/(platform)/account/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, RECEIVER_PHONE } from './hotfix6-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await AccountPage({ searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
beforeEach(() => { reset(); });

describe('HOTFIX-6 · C1 the /account address form (Rule Zero)', () => {
  it('a country field defaulted from the SESSION STORE (GB), the postal field on the 4–10 digit rule, a key minted at render', async () => {
    const h = await page();
    expect(h).toMatch(/<input id="ad-cc" name="countryCode"[^>]*value="GB"/);
    expect(text(h)).toContain(en['account.countryCode']);
    expect(h).toContain('pattern="\\d{4,10}"');
    expect(h).not.toContain('pattern="\\d{6}"');
    expect(h).toMatch(/<input type="hidden" name="key" value="address:[0-9a-f-]{36}"/);
    expect(text(h)).toContain(en['account.pincode']);
  });
  it('the store cannot be read → the country field is EMPTY (never a literal "IN")', async () => {
    C.storeFails = true;
    const h = await page();
    const field = h.match(/<input id="ad-cc"[^>]*>/)![0];
    expect(field).not.toMatch(/value="[A-Z]{2}"/);
    expect(field).not.toContain('IN');
  });
  it('a NON-INDIAN postal code (5 digits, GB) is accepted and sent with the country and the render key', async () => {
    const r = await redirectOf(addAddressAction(form({ key: 'address:k-1', line1: '14 Mill Lane', pincode: '12345', countryCode: 'gb', contactPhone: '+44 7700 900123' })));
    expect(r).toBe('REDIRECT /account?ok=address');
    expect(C.calls).toEqual([['addresses.create', { line1: '14 Mill Lane', pincode: '12345', countryCode: 'GB', contactPhone: '+447700900123' }, 'address:k-1']]);
  });
  it('no country → refused by name (the API\'s IN default is never reached from this form); a 3-digit code → the postal refusal', async () => {
    expect(await redirectOf(addAddressAction(form({ line1: '14 Mill Lane', pincode: '12345' })))).toBe('REDIRECT /account?error=country');
    expect(await redirectOf(addAddressAction(form({ line1: '14 Mill Lane', pincode: '123', countryCode: 'IN' })))).toBe('REDIRECT /account?error=pincode');
    expect(C.calls).toEqual([]);
    expect(text(await page({ error: 'country' }))).toContain(en['account.error.country']);
    expect(text(await page({ error: 'pincode' }))).toContain('4 to 10 digits');
  });
  it('the receiver phone is MASKED on every card — the full number never reaches the page', async () => {
    const h = await page();
    expect(text(h)).toContain('Asha · +91 98••• ••742');
    expect(h).not.toContain(RECEIVER_PHONE);
    expect(h).not.toContain('9898012742');
  });
});
