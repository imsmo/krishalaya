// apps/web-storefront/src/test-render/store4a-fixtures.ts · PC-56 STORE-4a — the shared world of the account / addresses / data-rights render tests
// (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the screen
// under test and the test read the same mutable state `C`: the person's profile (as the API answers it — masked), the address book (labelCode,
// note), the `address_label` vocabulary, the business-KYC read, the saved instruments, the wallet, the privacy requests and commitments, and
// every SDK call made. A field set to an SdkError makes that read fail.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const ME_ID = '0214f000-0000-7000-8000-0000000000b1';
export const ADDR = Object.freeze({ farm: '0214d000-0000-7000-8000-000000000001', shop: '0214d000-0000-7000-8000-000000000002' });
export const LABEL = Object.freeze({ home: '0214e000-0000-7000-8000-000000000001', farm: '0214e000-0000-7000-8000-000000000002', shop: '0214e000-0000-7000-8000-000000000003', warehouse: '0214e000-0000-7000-8000-000000000004', delivery: '0214e000-0000-7000-8000-000000000005' });
export const JOB = '0214a000-0000-7000-8000-000000000001';
export const RECEIVER_PHONE = '+919898012742';
export const SHA = 'ab'.repeat(32);

export const C: {
  lang: string; storeCountry: string | null; storeCurrency: string | null; storeFails: boolean;
  me: any; addresses: any; labels: any[]; kyc: any; instruments: any; balance: any; requests: any; commitments: any;
  calls: any[]; cookies: Map<string, string>; fail: Record<string, SdkError | undefined>;
} = {} as any;

export function reset(): void {
  Object.assign(C, {
    lang: 'en', storeCountry: 'GB', storeCurrency: 'INR', storeFails: false,
    // the API's answer (HOTFIX-6 + STORE-4a B4): masked phone and email, the name, the language — and displayName / locale said twice
    me: { id: ME_ID, displayName: 'Nilesh Shah', roles: ['customer'], locale: 'gu', fullName: 'Nilesh Shah', languageCode: 'gu', countryCode: null, phone: '+9198****2742', email: 'n***@shahtrading.in' },
    addresses: [
      { id: ADDR.farm, line1: 'Plot 14, GIDC Vadal', line2: null, village: 'Vadal', pincode: '362001', countryCode: 'IN', contactName: 'Nilesh', contactPhone: RECEIVER_PHONE,
        isDefault: true, labelId: LABEL.farm, labelCode: 'farm', deliveryNote: 'Gate 2 — weighbridge inside.' },
      { id: ADDR.shop, line1: 'Shop 3, Kalupur lane', line2: null, village: null, pincode: '380001', countryCode: 'IN', contactName: null, contactPhone: null,
        isDefault: false, labelId: LABEL.shop, labelCode: 'shop', deliveryNote: null },
    ],
    labels: [
      { id: LABEL.home, code: 'home', name: 'Home', sortOrder: 1, meta: {} }, { id: LABEL.farm, code: 'farm', name: 'Farm', sortOrder: 2, meta: {} },
      { id: LABEL.shop, code: 'shop', name: 'Shop', sortOrder: 3, meta: {} }, { id: LABEL.warehouse, code: 'warehouse', name: 'Warehouse', sortOrder: 4, meta: {} },
      { id: LABEL.delivery, code: 'delivery', name: 'Delivery point', sortOrder: 5, meta: {} },
    ],
    kyc: { status: 'verified', businessType: 'trader', legalName: 'Shah Trading Co.', gstinMasked: '24AAACS••••F1Z5', panMasked: 'AAACS••••F', docMediaIds: [] },
    instruments: { mandates: [{ kind: 'upi_autopay', id: 'm1', handleMasked: 'ni***@okaxis', status: 'active', purpose: 'subscription', maxAmountMinor: '100000', currencyCode: 'INR' }],
      accounts: [{ kind: 'bank', id: 'b1', last4: '4417', ifsc: 'HDFC0001234', upiMasked: null, holderName: 'Nilesh Shah', isPrimary: true, verified: true }] },
    balance: { userId: ME_ID, currencyCode: 'INR', availableMinor: '125050', heldMinor: '0', isFrozen: false },
    requests: [],
    commitments: { openOrders: 0, escrowMinor: '0', walletMinor: '125050', currencyCode: 'INR', multiCurrency: false, invoiceCount: 17, blocked: true, retentionYears: 8, coolingDays: 90 },
    calls: [], cookies: new Map(), fail: {},
  });
}
reset();

const maybe = async <T>(name: string, v: () => T): Promise<T> => { const f = C.fail[name]; if (f) throw f; return v(); };

export function serverClient(slug?: string): any {
  return {
    _slug: slug ?? null,
    auth: { me: () => maybe('me', () => C.me) },
    users: {
      me: () => maybe('me', () => C.me),
      updateMe: async (p: any) => { C.calls.push(['users.updateMe', p]); return C.me; },
    },
    addresses: {
      list: () => maybe('addresses', () => C.addresses),
      get: (id: string) => maybe('address', () => { const a = C.addresses.find((x: any) => x.id === id); if (!a) throw new SdkError('ADDRESS_NOT_FOUND', 404, 'nf'); return a; }),
      create: async (input: any, key?: string) => { C.calls.push(['addresses.create', input, key]); const f = C.fail.create; if (f) throw f; return { id: 'new-address' }; },
      update: async (id: string, p: any, key?: string) => { C.calls.push(['addresses.update', id, p, key]); const f = C.fail.update; if (f) throw f; return { id: p.isDefault ? id : 'copy-address', ok: true, copied: !p.isDefault, previousId: p.isDefault ? null : id }; },
      remove: async (id: string) => { C.calls.push(['addresses.remove', id]); const f = C.fail.remove; if (f) throw f; return { ok: true, defaultId: ADDR.shop }; },
    },
    lookups: { values: (type: string) => maybe('labels', () => (type === 'address_label' ? C.labels : [])) },
    kyc: { businessStatus: () => maybe('kyc', () => C.kyc) },
    wallet: {
      instruments: () => maybe('instruments', () => C.instruments),
      balance: async (currency: string) => { C.calls.push(['wallet.balance', currency]); const f = C.fail.balance; if (f) throw f; return { ...C.balance, currencyCode: currency }; },
    },
    privacy: {
      myRequests: () => maybe('requests', () => C.requests),
      commitments: () => maybe('commitments', () => C.commitments),
      requestDataExport: async (key: string) => { C.calls.push(['privacy.requestDataExport', key]); const f = C.fail.export; if (f) throw f; return {}; },
      requestAccountDeletion: async (input: any, key: string) => { C.calls.push(['privacy.requestAccountDeletion', input, key]); const f = C.fail.deletion; if (f) throw f; return {}; },
    },
    exportsPlane: {
      mintLink: async (id: string) => { C.calls.push(['exportsPlane.mintLink', id]); const f = C.fail.mint; if (f) throw f; return { token: 'tok_abcdefghijklmnop.sig', jti: 'j', expiresAt: '', ttlSec: 900, downloadPath: '' }; },
      openDownload: async (id: string, token: string) => { C.calls.push(['exportsPlane.openDownload', id, token]); return new Response('x', { headers: { 'content-type': 'text/csv' } }); },
    },
  };
}
export function sessionTenantClient(): any {
  return { storefront: {
    tenant: async () => { if (C.storeFails) throw new SdkError('UNAVAILABLE', 503, 'down'); return { slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: C.storeCountry }; },
    profile: async () => { if (C.storeFails) throw new SdkError('UNAVAILABLE', 503, 'down'); return { currencyCode: C.storeCurrency }; },
  } };
}
export const publicClient = (_slug?: string) => sessionTenantClient();
export function cookieJar(): any {
  return { get: (k: string) => (C.cookies.has(k) ? { name: k, value: C.cookies.get(k) } : undefined), set: (k: string, v: string, o?: any) => { if (o?.maxAge === 0) C.cookies.delete(k); else C.cookies.set(k, v); }, delete: (k: string) => { C.cookies.delete(k); } };
}
/** An export request as the API answers it (the plane's live job joined). */
export function exportRequest(status: string, over: Record<string, unknown> = {}): any {
  const ready = status === 'ready' || status === 'expired';
  return {
    id: 'dsr-1', kind: 'export', status: ready ? 'completed' : 'in_progress', coolingEndsAt: null, requestedAt: '2026-10-16T05:00:00.000Z',
    export: {
      jobId: JOB, status,
      standing: status === 'queued' ? { position: 3, ahead: 2, eta: { kind: 'estimate', seconds: 130, basis: 'median_of_recent_runs', sample: 5, runsIncluded: 5 } } : null,
      receipt: ready ? { fileName: 'identity-dpdp_person-my-data-2026-10-16.csv', rowCount: 42, sha256: SHA, byteSize: 9001, contentType: 'text/csv', generatedAt: '2026-10-16T05:02:00.000Z', requestedBy: ME_ID, notes: [] } : null,
      download: status === 'ready' ? { kind: 'available', linkTtlSec: 900 } : status === 'expired' ? { kind: 'file_expired', expiredAt: '2026-10-23T05:02:00.000Z' } : status === 'failed' ? { kind: 'failed' } : { kind: 'not_ready' },
      failure: status === 'failed' ? { code: 'storage_failed', detail: null } : null,
      expiresAt: ready ? '2026-10-23T05:02:00.000Z' : null, generatedAt: ready ? '2026-10-16T05:02:00.000Z' : null,
      ...over,
    },
  };
}
