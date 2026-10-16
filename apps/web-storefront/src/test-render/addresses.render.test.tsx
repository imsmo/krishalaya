// apps/web-storefront/src/test-render/addresses.render.test.tsx · PC-56 STORE-4a · C7 — canon W301 "Addresses" (components/account/AddressesScreen.tsx)
// under BOTH chromes: the label BY CODE in three languages, the note, the receiver's phone MASKED, the country, the default badge, the empty
// state with the add CTA, a load error that is not an empty book, both chromes' hrefs, the refusals (unserviceable, flagged off, driver view).
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

import PlatformBook from '../app/(platform)/account/addresses/page';
import TenantBook from '../app/[tenantSlug]/account/addresses/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, ADDR, RECEIVER_PHONE } from './store4a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PlatformBook({ searchParams: sp }));
const tenantPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantBook({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('STORE-4a · W301 the address book', () => {
  it('each card: the label by code, the lines, the country, the receiver MASKED, the delivery note, the default badge', async () => {
    const h = await page(); const v = text(h);
    expect(h).toContain(`data-kv-address="${ADDR.farm}" data-kv-label="farm"`);
    expect(v).toContain('Farm'); expect(v).toContain('Shop');
    expect(v).toContain('Plot 14, GIDC Vadal, Vadal, 362001'); expect(h).toContain('data-kv-country="true">IN<');
    expect(v).toContain('Receiving: Nilesh · +91 98••• ••742');
    expect(h).not.toContain(RECEIVER_PHONE); expect(h).not.toContain('9898012742');
    expect(v).toContain('Note for delivery: Gate 2 — weighbridge inside.');
    expect((h.match(/data-kv-default="true"/g) ?? []).length).toBe(1);
  });
  it('the five labels are worded by code in hi and gu (the storefront catalogues — founder D4)', async () => {
    for (const [lang, cat] of [['hi', hi], ['gu', gu]] as const) {
      C.lang = lang;
      const v = text(await page());
      expect(v).toContain((cat as Record<string, string>)['store4a.label.farm']); expect(v).toContain((cat as Record<string, string>)['store4a.label.shop']);
    }
    for (const code of ['home', 'farm', 'shop', 'warehouse', 'delivery']) for (const cat of [en, hi, gu]) expect((cat as Record<string, string>)[`store4a.label.${code}`]).toBeTruthy();
  });
  it('the empty book says so with the add CTA; a load error is NOT an empty book (Retry reloads)', async () => {
    C.addresses = [];
    let h = await page();
    expect(h).toContain('data-kv-state="empty"'); expect(h).toContain('data-kv-cta="add-empty"'); expect(text(h)).toContain(en['store4a.addresses.empty']);
    C.fail.addresses = new SdkError('UNAVAILABLE', 503, 'down');
    h = await page();
    expect(h).toContain('data-kv-state="error"'); expect(h).not.toContain('data-kv-state="empty"'); expect(h).toContain('data-kv-retry="reload"');
  });
  it('BOTH chromes: the platform\'s /account/addresses… and the organisation\'s /<slug>/account/addresses… — one component', async () => {
    const p = await page();
    expect(p).toContain('href="/account/addresses/new"'); expect(p).toContain(`href="/account/addresses/${ADDR.farm}/edit"`);
    expect(p).toContain(`href="/account/addresses?confirm=remove&amp;id=${ADDR.farm}"`);
    const t = await tenantPage();
    expect(t).toContain('data-kv-chrome="anand-fpo"');
    expect(t).toContain('href="/anand-fpo/account/addresses/new"'); expect(t).toContain(`href="/anand-fpo/account/addresses/${ADDR.shop}/edit"`);
    expect(t).toContain(`href="/anand-fpo/account/addresses?confirm=default&amp;id=${ADDR.shop}"`);
  });
  it('the canon\'s refused claims are said by name: unserviceable pincode, flagged off, the driver\'s view', async () => {
    const h = await page();
    for (const id of ['unserviceable', 'flagged_off', 'driver_view']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(text(h)).toContain(en['store4a.addresses.labelsFootnote']);
  });
  it('W3036 success on the book: a copied edit says orders already placed keep the old address (TRUE — HOTFIX-6)', async () => {
    const h = await page({ ok: 'copied', id: ADDR.farm });
    expect(h).toContain('data-kv-ok="copied"'); expect(h).toContain('data-kv-copied'); expect(text(h)).toContain(en['store4a.addresses.copiedKeep']);
    expect(text(await page({ ok: 'saved' }))).not.toContain(en['store4a.addresses.copiedKeep']);
  });
});
