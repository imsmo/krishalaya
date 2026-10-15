// apps/web-storefront/src/test-render/store2c-fixtures.ts · PC-56 STORE-2c — the shared world of the checkout / pay / confirm / auction render tests
// (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under
// test and the test read the same mutable state `C`: the session, the switches, the cart, the address book and its labels, the delivery methods,
// the preview (or its named refusal), the wallet, the orders and their payment attempts, the public auction read, the server-held checkout state
// (the `kv_checkout` cookie), and every call the Server Actions made.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const T = '0209a000-0000-7000-8000-000000000001';           // Anand FPO (the page's store)
export const T_OTHER = '0209a000-0000-7000-8000-000000000002';
export const A = Object.freeze({ home: '0209c000-0000-7000-8000-000000000001', shop: '0209c000-0000-7000-8000-000000000002' });
export const Z = Object.freeze({ jun: '0209d000-0000-7000-8000-000000000001', exp: '0209d000-0000-7000-8000-000000000002' });
export const O = Object.freeze({ a: '0209e000-0000-7000-8000-00000000000a', b: '0209e000-0000-7000-8000-00000000000b' });
export const LABEL_WAREHOUSE = '0209f000-0000-7000-8000-000000000001';
export const AUCTION = '0209aa00-0000-7000-8000-000000000001';

export const SELLER = (id: string, total: string, over: Record<string, unknown> = {}) => ({
  sellerUserId: id, items: [{ listingId: `l-${id}`, title: 'GG-20 Groundnut · Grade A', quantity: 10, unitCode: 'quintal', unitPriceMinor: '615000', lineTotalMinor: '6150000' }],
  subtotalMinor: '6150000', deliveryFeeMinor: '7500', platformFeeMinor: '15375', buyerCommissionMinor: '0', discountMinor: '0', totalMinor: total, ...over,
});
export const PREVIEW = () => ({
  currencyCode: 'INR', sellers: [SELLER('s1', '6172875'), SELLER('s2', '2063500', { items: [{ listingId: 'l-s2', title: 'Lokwan Wheat', quantity: 8, unitCode: 'quintal', unitPriceMinor: '256000', lineTotalMinor: '2048000' }],
    subtotalMinor: '2048000', platformFeeMinor: '8000' })],
  subtotalMinor: '8198000', deliveryFeeMinor: '15000', platformFeeMinor: '23375', buyerCommissionMinor: '0', discountMinor: '0', deliveryNeedsAddress: false,
  grandTotalMinor: '8236375', couponCode: null, qualityWindowHours: 24,
});
export const ORDER = (id: string, paymentState: string, over: Record<string, unknown> = {}) => ({
  id, orderNo: `KV2026-${id.slice(-4).toUpperCase()}`, status: paymentState === 'paid' ? 'confirmed' : paymentState === 'pending' ? 'payment_pending' : paymentState === 'cancelled' ? 'cancelled' : 'created',
  paymentState, source: 'direct', buyerUserId: 'buyer-uuid', sellerUserId: 'farmer-uuid', currencyCode: 'INR', checkoutGroupId: null,
  subtotalMinor: '6150000', deliveryFeeMinor: '7500', discountMinor: '0', taxMinor: '0', commissionMinor: '0', platformFeeMinor: '15375', buyerCommissionMinor: '0',
  totalMinor: '6172875', items: [{ listing_id: 'l1', title_snapshot: 'GG-20 Groundnut', quantity: 10, unit_code: 'quintal', line_total_minor: '6150000' }], ...over,
});
export const AUCTION_VIEW = (over: Record<string, unknown> = {}) => ({
  auctionId: AUCTION, auctionNo: 'AUC-1', status: 'live', kind: 'english_open', isOpen: true,
  lot: { title: 'Bold Groundnut — 60 qtl, Grade A', unitCode: 'quintal', quantity: '60.000', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, district: 'Junagadh' },
  currencyCode: 'INR', exponent: 2, reserveMet: true, hasBids: true, bidCount: 2, sealedHidden: false,
  currentBidMinor: '632000', lotTotalMinor: '37920000', minNextBidMinor: '634000', minNextLotTotalMinor: '38040000',
  startsAt: '2026-10-15T05:30:00.000Z', endsAt: '2099-10-15T12:30:00.000Z', antiSnipe: { triggerSec: 90, extendSec: 120 },
  emd: { flatMinor: null, pctBps: 200 }, balanceDueHours: 48,
  bids: [{ at: '2026-10-15T10:14:00.000Z', amountMinor: '632000' }, { at: '2026-10-15T09:31:00.000Z', amountMinor: '620000' }],
  viewer: null, ...over,
});

export const C: {
  lang: string; token: string | null; sessionTenant: string | null; flags: any; cart: any; addresses: any; labels: any; methods: any; preview: any;
  wallet: any; orders: Record<string, any>; group: any; attempts: Record<string, any>; auction: any; state: any; calls: any[]; fail: Record<string, any>; created: any; pending?: boolean;
} = {} as any;
export function reset(): void {
  Object.assign(C, {
    lang: 'en', token: 'tok', sessionTenant: T,
    flags: { org_self_signup: true, storefront_browse: true, storefront_cart: true, online_payments: true, auctions: true },
    cart: { items: [{ listingId: 'l-s1' }, { listingId: 'l-s2' }], subtotalMinor: '8198000', currencyCode: 'INR' },
    addresses: [
      { id: A.home, line1: 'Plot 14, Naroda GIDC', village: 'Ahmedabad', pincode: '382330', labelId: LABEL_WAREHOUSE, contactName: 'Nilesh Shah', contactPhone: '+91 9876543742', isDefault: true },
      { id: A.shop, line1: 'Shop 6, Kalupur', village: 'Ahmedabad', pincode: '380002', isDefault: false },
    ],
    labels: [{ id: LABEL_WAREHOUSE, code: 'warehouse', name: 'Warehouse', sortOrder: 1, meta: {} }],
    methods: { [A.home]: [{ id: Z.jun, name: 'Ahmedabad zone', feeMinor: '7500' }, { id: Z.exp, name: 'Express van', feeMinor: '12000' }], [A.shop]: [{ id: Z.jun, name: 'Ahmedabad zone', feeMinor: '9500' }] },
    preview: PREVIEW(), wallet: { userId: 'u', currencyCode: 'INR', availableMinor: '9000000', heldMinor: '0', isFrozen: false },
    orders: {}, group: null, attempts: {}, auction: AUCTION_VIEW(),
    state: { v: 1, slug: 'anand-fpo', addressId: A.home, methodId: Z.jun, pay: null, coupon: null, draft: null }, calls: [], fail: {}, created: null, pending: false,
  });
}
reset();

const answer = (v: any) => {
  if (v === 'OFF') throw new SdkError('STOREFRONT_CART_OFF', 503, 'paused');
  if (v instanceof SdkError) throw v;
  if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down');
  return v;
};
const act = (name: string, result: (...a: any[]) => any) => async (...args: any[]) => {
  C.calls.push([name, ...args]);
  const f = C.fail[name];
  if (f) throw new SdkError(f.code, f.status ?? 409, f.code, undefined, f.details ?? {});
  return result(...args);
};
export function serverClient(): any {
  return {
    cart: { get: async () => answer(C.cart) },
    addresses: { list: async () => answer(C.addresses), create: act('addresses.create', () => ({ id: C.created ?? '0209c000-0000-7000-8000-0000000000ff' })) },
    checkout: {
      deliveryMethods: async (q: { pincode?: string }) => {
        C.calls.push(['deliveryMethods', q]);
        const a = (C.addresses as any[]).find((x) => x.pincode === q.pincode);
        const m = a ? C.methods[a.id] : undefined;
        if (m instanceof Error) throw m;
        return { currencyCode: 'INR', subtotalMinor: '8198000', methods: m ?? [] };
      },
      preview: async (q: unknown) => { C.calls.push(['preview', q]); return answer(C.preview); },
      checkout: act('checkout', () => C.created),
    },
    wallet: { balance: async (cur: string) => { C.calls.push(['wallet.balance', cur]); return answer(C.wallet); } },
    orders: {
      get: async (id: string) => { const o = C.orders[id]; if (!o) throw new SdkError('ORDER_NOT_FOUND', 404, 'nf'); return o; },
      checkoutGroup: async () => C.group,
      payFromWallet: act('payFromWallet', (id: string) => ({ orderId: id, status: 'success' })),
    },
    payments: {
      orderAttempts: async (id: string) => answer(C.attempts[id] ?? { latest: null, attempts: 0, nextAttempt: 1, liveAttempt: false, ttlSeconds: 900 }),
      createOrderAttempt: act('createOrderAttempt', (i: any) => ({ paymentId: 'p', gatewayOrderId: 'order_x', provider: 'razorpay', amountMinor: i.amountMinor, status: 'initiated', attempt: i.attempt, expiresAt: null })),
    },
    storefront: { auction: async () => answer(C.auction) },
    auctions: { placeBid: act('placeBid', () => ({})), watch: act('watch', () => ({})), unwatch: act('unwatch', () => ({})) },
  };
}
export function publicClient(): any {
  return {
    storefront: { flags: async () => answer(C.flags), auction: async () => { const v = answer(C.auction); return { ...v, viewer: null }; } },
    lookups: { values: async () => answer(C.labels) },
  };
}
export function sessionTenantClient(): any {
  return { storefront: { tenant: async () => ({ tenantId: T_OTHER, slug: 'kisan-sathi', displayName: 'Kisan Sathi FPC' }) } };
}
export const shell = async (slug: string) => ({
  kind: 'ok', tenant: { tenantId: T, slug, displayName: 'Anand FPO', countryCode: 'IN', defaultLang: null, phoneDefaultCountry: 'IN' },
  branding: { displayName: 'Anand FPO', logoUrl: null, brand: null },
});
export const checkoutFlow = {
  readCheckout: () => C.state,
  writeCheckout: (s: any) => { C.calls.push(['writeCheckout', s]); C.state = s; },
  clearCheckout: () => { C.calls.push(['clearCheckout']); },
};
