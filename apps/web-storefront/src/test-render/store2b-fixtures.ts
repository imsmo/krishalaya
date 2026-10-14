// apps/web-storefront/src/test-render/store2b-fixtures.ts · PC-56 STORE-2b — the shared world of the cart / chain / listing-add render tests (not a
// test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under
// test and the test read the same mutable state `W`: the session (a token or none, which organisation it was minted for), the platform
// switch, the cart the API answers (or how it fails — an outage, or the named STOREFRONT_CART_OFF), and the calls the Server Actions made.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const T = '0208a000-0000-7000-8000-000000000001';           // Anand FPO (the page's store)
export const T_OTHER = '0208a000-0000-7000-8000-000000000002';     // Kisan Sathi FPC (another store)
export const ID = Object.freeze({
  ok: '0208b000-0000-7000-8000-000000000001', drift: '0208b000-0000-7000-8000-000000000002', sold: '0208b000-0000-7000-8000-000000000003',
  lic: '0208b000-0000-7000-8000-000000000004', below: '0208b000-0000-7000-8000-000000000005', susp: '0208b000-0000-7000-8000-000000000006',
  paused: '0208b000-0000-7000-8000-000000000007',
});

export const LINE = (id: string, over: Record<string, unknown> = {}) => ({
  listingId: id, title: 'GG-20 Groundnut · Grade A', quantity: 10, quantityDecimal: '10.000', unitCode: 'quintal', minOrderQty: '5.000',
  quantityAvailable: '34.000', available: 34, addedPriceMinor: '615000', currentPriceMinor: '615000', priceChanged: false, priceDeltaMinor: null,
  unitPriceMinor: '615000', lineTotalMinor: '6150000', currencyCode: 'INR', purchasable: true, reason: null, belowMin: false, overAvailable: false,
  organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Junagadh', ...over,
});
export const DRIFT = LINE(ID.drift, { title: 'Lokwan Wheat · Grade A', quantity: 8, quantityDecimal: '8.000', minOrderQty: '2.000', addedPriceMinor: '252000',
  currentPriceMinor: '256000', priceChanged: true, priceDeltaMinor: '4000', unitPriceMinor: '256000', lineTotalMinor: '2048000', district: 'Anand' });
export const REASON = (id: string, reason: string) => LINE(id, { title: `Lot ${reason}`, purchasable: false, reason, quantityAvailable: reason === 'not_found' ? null : '0.000' });

export const W: {
  lang: string; token: string | null; sessionTenant: string | null; home: any; flags: any; cart: any; calls: any[]; fail: any;
} = {} as any;
export function reset(): void {
  Object.assign(W, {
    lang: 'en', token: 'tok', sessionTenant: T, home: { tenantId: T_OTHER, slug: 'kisan-sathi', displayName: 'Kisan Sathi FPC', countryCode: 'IN', defaultLang: null, phoneDefaultCountry: 'IN' },
    flags: { org_self_signup: true, storefront_browse: true, storefront_cart: true },
    cart: { items: [LINE(ID.ok)], subtotalMinor: '6150000', currencyCode: 'INR' }, calls: [], fail: {},
  });
}
reset();

/** A read that answers `v`: an Error → an outage; 'OFF' → the named kill-switch refusal; else the value. */
const answer = (v: any) => {
  if (v === 'OFF') throw new SdkError('STOREFRONT_CART_OFF', 503, 'paused');
  if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down');
  return v;
};
/** The authed client the cart page and the Server Actions use: reads the cart; records every act; an act may be told to fail with an SdkError. */
export function serverClient(): any {
  const act = (name: string) => async (...args: unknown[]) => {
    W.calls.push([name, ...args]);
    const f = W.fail[name];
    if (f) throw new SdkError(f.code, f.status ?? 409, f.code, undefined, f.details ?? {});
    return name === 'acceptPrice' ? { accepted: { changed: true }, cart: W.cart } : { ok: true };
  };
  return {
    cart: { get: async () => answer(W.cart), addItem: act('addItem'), updateItem: act('updateItem'), removeItem: act('removeItem'), acceptPrice: act('acceptPrice') },
  };
}
export function publicClient(): any {
  return {
    storefront: { flags: async () => answer(W.flags) },
    listings: { media: async (id: string) => (id === ID.ok ? [{ mediaId: 'm1', url: 'https://cdn.test/gg20.jpg', sortOrder: 0 }] : []) },
  };
}
export function sessionTenantClient(): any {
  return { storefront: { tenant: async () => answer(W.home) } };
}
export const shell = async (slug: string) => ({
  kind: 'ok', tenant: { tenantId: T, slug, displayName: 'Anand FPO', countryCode: 'IN', defaultLang: null, phoneDefaultCountry: 'IN' },
  branding: { displayName: 'Anand FPO', logoUrl: null, brand: null },
});
