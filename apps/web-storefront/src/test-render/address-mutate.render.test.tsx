// apps/web-storefront/src/test-render/address-mutate.render.test.tsx · PC-56 STORE-4a · C7 — the address MUTATE chain (canon W3038 confirm → W3039
// success / W3040 failure) on the book (components/account/AddressesScreen.tsx + the remove / make-default actions):
//   • remove confirm: "orders already heading there keep their copy" (TRUE — soft-retire) + "your newest other address becomes the default" for
//     the default, or "no default until you add one" for the last; a key minted at render;
//   • make-default confirm: before → after;
//   • W3039: the act reaches the API; the outcome said on the book; W3040: not found / concurrency / server named, Retry with the SAME key.
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

import AddressBook from '../app/(platform)/account/addresses/page';
import TenantBook from '../app/[tenantSlug]/account/addresses/page';
import { removeAddressAction, makeDefaultAddressAction } from '../app/(platform)/account/addresses/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, ADDR } from './store4a-fixtures';

const KEY = 'address:0214beef-0000-4000-8000-000000000001';
const book = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await AddressBook({ searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
beforeEach(() => { reset(); });

describe('STORE-4a · W3038 the confirms', () => {
  it('remove the DEFAULT: "orders keep their copy" + "your newest other address becomes the default"; a key minted at render', async () => {
    const h = await book({ confirm: 'remove', id: ADDR.farm }); const v = text(h);
    expect(h).toContain(`data-kv-confirm="remove" data-kv-target="${ADDR.farm}"`);
    expect(v).toContain(en['store4a.mutate.remove.keepCopy']); expect(v).toContain(en['store4a.mutate.remove.reassign']);
    expect(h).toMatch(/<input type="hidden" name="key" value="address:[0-9a-f-]{36}"/);
  });
  it('remove a non-default → no reassignment sentence; remove the ONLY address → "no default until you add one"', async () => {
    expect(text(await book({ confirm: 'remove', id: ADDR.shop }))).not.toContain(en['store4a.mutate.remove.reassign']);
    C.addresses = [C.addresses[0]];
    expect(text(await book({ confirm: 'remove', id: ADDR.farm }))).toContain(en['store4a.mutate.remove.noneLeft']);
  });
  it('make default: before → after, from the book\'s own cards (the label + the lines)', async () => {
    const h = await book({ confirm: 'default', id: ADDR.shop });
    expect(h).toContain('data-kv-before-after'); expect(text(h)).toMatch(/Default now\s*Farm · Plot 14/); expect(text(h)).toMatch(/Default after\s*Shop · Shop 3/);
  });
  it('a confirm for an address not in the book says "not found" — no form', async () => {
    const h = await book({ confirm: 'remove', id: '0214d000-0000-7000-8000-0000000000ff' });
    expect(h).toContain('data-kv-failure="not_found"'); expect(h).not.toContain('data-kv-proceed');
  });
  it('the tenant chrome\'s confirm posts with its own chrome field (one action module)', async () => {
    const h = renderToStaticMarkup(await TenantBook({ params: { tenantSlug: 'anand-fpo' }, searchParams: { confirm: 'remove', id: ADDR.farm } }));
    expect(h).toContain('name="chrome" value="anand-fpo"');
  });
});

describe('STORE-4a · W3039 success / W3040 failure', () => {
  it('remove reaches the API; the book says removed and that the newest other address is now the default', async () => {
    expect(await redirectOf(removeAddressAction(form({ chrome: 'platform', id: ADDR.farm, key: KEY })))).toBe(`REDIRECT /account/addresses?ok=removed&id=${ADDR.shop}`);
    expect(C.calls).toContainEqual(['addresses.remove', ADDR.farm]);
    const h = await book({ ok: 'removed', id: ADDR.shop });
    expect(h).toContain('data-kv-ok="removed"'); expect(text(h)).toContain(en['store4a.addresses.newDefault']);
  });
  it('make default reaches the API with the KEY minted at render; the tenant chrome answers back to /<slug>/…', async () => {
    expect(await redirectOf(makeDefaultAddressAction(form({ chrome: 'anand-fpo', id: ADDR.shop, key: KEY })))).toBe(`REDIRECT /anand-fpo/account/addresses?ok=default&id=${ADDR.shop}`);
    expect(C.calls).toContainEqual(['addresses.update', ADDR.shop, { isDefault: true }, KEY]);
  });
  it.each([['not_found', new SdkError('ADDRESS_NOT_FOUND', 404, 'nf')], ['concurrency', new SdkError('CONFLICT', 409, 'x')], ['server', new SdkError('INTERNAL', 500, 'x')]])(
    'W3040 %s → the confirm again, named, Retry with the SAME key', async (name, err) => {
      C.fail.remove = err;
      expect(await redirectOf(removeAddressAction(form({ chrome: 'platform', id: ADDR.farm, key: KEY }))))
        .toBe(`REDIRECT /account/addresses?confirm=remove&id=${ADDR.farm}&k=${encodeURIComponent(KEY)}&failure=${name}`);
      const h = await book({ confirm: 'remove', id: ADDR.farm, k: KEY, failure: name });
      expect(h).toContain(`data-kv-failure="${name}"`); expect(h).toContain(`name="key" value="${KEY}"`); expect(text(h)).toContain(en['store4a.mutate.retry']);
      expect(h).toContain('data-kv-refusal="oncall"');
    });
});
