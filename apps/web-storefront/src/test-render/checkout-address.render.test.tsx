// apps/web-storefront/src/test-render/checkout-address.render.test.tsx · PC-56 STORE-2c · C2 — canon W283 and the "+ Add address" chain W3048–W3051,
// rendered to the markup a buyer receives (and the chain's Server Action driven):
//   • the address cards: the label (the vocabulary's name), the lines, the receiver with the phone MASKED (never the raw number);
//   • the delivery methods are quoted for the SELECTED address's postal code (never the default's), with the fee in the data's currency;
//   • the add-address chain: form-error re-renders every field's refusal with the values KEPT (W3048); success = back to the address step with
//     the NEW address SELECTED and its methods re-quoted (W3050); failure is named, the values kept (W3051);
//   • unserviceable is said kindly; a load error has Retry (W3052–W3054 DECOR); the W283 refusals printed by name; no slot, pickup, GSTIN,
//     vehicle-note, 3PL, per-km, ₹50 slab, ₹450 minimum or "+18% GST" OFFERED.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store2c-fixtures').C.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2c-fixtures').C.sessionTenant }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2c-fixtures').shell(s) }));
jest.mock('../lib/checkout-flow', () => jest.requireActual('./store2c-fixtures').checkoutFlow);
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});

import TenantCheckout from '../app/[tenantSlug]/checkout/page';
import { addAddressAction, chooseDeliveryAction } from '../app/[tenantSlug]/checkout/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, A, Z } from './store2c-fixtures';
import { store2cRefusalKeys } from '../features/store2/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantCheckout({ params: { tenantSlug: 'anand-fpo' }, searchParams: { step: 'address', ...sp } }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<void>) => p.then(() => 'no redirect', (e: Error) => e.message.replace(/^REDIRECT /, ''));
beforeEach(() => reset());

describe('STORE-2c · W283 the address step', () => {
  it('the cards: the label name, the lines, the receiver with the phone MASKED; the selected address marked', async () => {
    const html = await page();
    expect(html).toContain(`data-kv-address="${A.home}"`);
    expect(html).toContain('data-kv-address-label="">Warehouse</span>');
    expect(text(html)).toContain('Plot 14, Naroda GIDC, Ahmedabad, 382330');
    expect(text(html)).toContain('Receiving: Nilesh Shah · +91 98••• ••742');
    expect(html).not.toContain('9876543742');
    expect(html).toContain(`name="addressId" checked="" value="${A.home}"`);
  });
  it('the methods are quoted for the SELECTED address (the chosen one, not the default), each fee in the data\'s currency', async () => {
    C.state = { ...C.state, addressId: A.shop, methodId: null };
    const html = await page();
    expect(C.calls.filter((c) => c[0] === 'deliveryMethods')).toEqual([['deliveryMethods', { pincode: '380002' }]]);
    expect(html).toContain(`data-kv-methods-for="${A.shop}"`);
    expect(text(html)).toContain('Ahmedabad zone');
    expect(text(html)).toMatch(/₹\s?95\.00/);
    expect(C.calls.find((c) => c[0] === 'preview')![1]).toEqual({ deliveryAddressId: A.shop });
  });
  it('choosing ANOTHER address re-quotes first (a method quoted for the old address is never carried); the same address continues to payment', async () => {
    expect(await redirectOf(chooseDeliveryAction(form({ slug: 'anand-fpo', addressId: A.shop, quotedFor: A.home, methodId: Z.jun, go: 'payment' })))).toBe('/anand-fpo/checkout?step=address&status=requoted');
    expect(C.state).toMatchObject({ addressId: A.shop, methodId: null });
    expect(await redirectOf(chooseDeliveryAction(form({ slug: 'anand-fpo', addressId: A.shop, quotedFor: A.shop, methodId: Z.jun, go: 'payment' })))).toBe('/anand-fpo/checkout?step=payment');
    expect(C.state).toMatchObject({ addressId: A.shop, methodId: Z.jun });
  });
  it('an unserviceable address is said kindly (no Continue); a methods load error has Retry (a reload)', async () => {
    C.preview = new SdkError('UNSERVICEABLE_PINCODE', 422, 'x', undefined, { pincode: '382330' });
    let html = await page();
    expect(html).toContain('data-kv-state="unserviceable"');
    expect(text(html)).toContain(en['store2c.method.unserviceable']);
    expect(html).not.toContain('data-kv-go="payment"');
    reset();
    C.methods[A.home] = new Error('down');
    html = await page();
    expect(html).toContain('data-kv-state="methods-error"');
    expect(html).toContain('href="/anand-fpo/checkout?step=address" class="kv-btn" data-kv-retry="reload"');
  });
  it('the W283 refusals are printed by name, and none of the refused claims is OFFERED anywhere on the page', async () => {
    const html = await page();
    for (const k of store2cRefusalKeys('checkout-address')) expect([k, text(html).includes(en[k as keyof typeof en])]).toEqual([k, true]);
    expect(html).not.toMatch(/name="(slot|pickup|gstin|vehicle)/i);
    expect(text(html)).not.toMatch(/₹\s?80\/qtl|₹\s?50 slab|₹\s?450|\+18% GST|3PL quote/i);
  });
});

describe('STORE-2c · W3048–W3051 the add-address chain', () => {
  it('the form opens inline (no review page — W3049 DELTA)', async () => {
    const html = await page({ add: '1' });
    expect(html).toContain('data-kv-form="add-address"');
    expect(html).toContain('name="pincode"');
  });
  it('W3048 form-error: every field\'s refusal, the values KEPT, nothing sent to the API', async () => {
    const r = await redirectOf(addAddressAction(form({ slug: 'anand-fpo', line1: 'ab', pincode: '12', countryCode: 'I1', contactName: 'Meera', contactPhone: 'x' })));
    expect(r).toBe('/anand-fpo/checkout?step=address&add=1&status=form_error');
    expect(C.calls.some((c) => c[0] === 'addresses.create')).toBe(false);
    expect(C.state.draft.errors).toEqual({ line1: 'too_short', pincode: 'postal', contactPhone: 'phone', countryCode: 'country' });
    const html = await page({ add: '1', status: 'form_error' });
    expect(html).toContain('data-kv-chain="form-error"');
    for (const f of ['line1', 'pincode', 'contactPhone', 'countryCode']) expect(html).toContain(`data-kv-field-error="${f}"`);
    expect(html).toContain('value="ab"');
    expect(html).toContain('value="Meera"');
    expect(text(html)).toContain(en['store2c.address.err.postal']);
  });
  it('a 4-digit postal code (a non-Indian country) is accepted by the same rule the API uses', async () => {
    C.created = '0209c000-0000-7000-8000-0000000000aa';
    const r = await redirectOf(addAddressAction(form({ slug: 'anand-fpo', line1: '12 Market Road', pincode: '1010', countryCode: 'us' })));
    expect(r).toBe('/anand-fpo/checkout?step=address&status=address_added');
    expect(C.calls.find((c) => c[0] === 'addresses.create')![1]).toEqual({ line1: '12 Market Road', pincode: '1010', countryCode: 'US' });
  });
  it('W3050 success: back to the address step with the NEW address SELECTED and its methods re-quoted', async () => {
    C.created = A.shop;
    expect(await redirectOf(addAddressAction(form({ slug: 'anand-fpo', line1: 'Shop 6, Kalupur', pincode: '380002', countryCode: 'IN' })))).toBe('/anand-fpo/checkout?step=address&status=address_added');
    expect(C.state).toMatchObject({ addressId: A.shop, methodId: null, draft: null });
    const html = await page({ status: 'address_added' });
    expect(html).toContain('data-kv-chain="success"');
    expect(html).toContain(`name="addressId" checked="" value="${A.shop}"`);
    expect(C.calls.filter((c) => c[0] === 'deliveryMethods').pop()).toEqual(['deliveryMethods', { pincode: '380002' }]);
  });
  it('W3051 failure: named ("not saved"), the values kept; the on-call claim refused', async () => {
    C.fail['addresses.create'] = { code: 'INTERNAL', status: 500 };
    expect(await redirectOf(addAddressAction(form({ slug: 'anand-fpo', line1: 'Shop 6, Kalupur', pincode: '380002', countryCode: 'IN' })))).toBe('/anand-fpo/checkout?step=address&add=1&status=address_failed');
    const html = await page({ add: '1', status: 'address_failed' });
    expect(html).toContain('data-kv-chain="failure"');
    expect(text(html)).toContain(en['store2c.address.failed.server']);
    expect(html).toContain('value="Shop 6, Kalupur"');
    expect(text(html)).toContain(en['store2c.refusal.oncall']);
  });
});
