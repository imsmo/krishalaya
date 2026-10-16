// @krishalaya/sdk-js · PC-56 STORE-4a · B6 — the account / address / data-rights contract, pinned with an injected fake fetch (no network):
//   • `privacy.commitments()` GETs /v1/privacy/commitments (the deletion confirm's figures — money as strings);
//   • `privacy.myRequests()` carries an export request's live plane job (`export`); the deletion refusal `DSR_BLOCKED` arrives as an SdkError
//     with the figures in `details`;
//   • `addresses.get(id)` GETs one address (labelCode + deliveryNote); create REQUIRES `countryCode` (type-level) and carries the label + note;
//   • the refusal-code constants are exported.
import { createClient } from '../client';
import { SdkError } from '../errors';
import { PRIVACY_REFUSAL_CODES, ADDRESS_REFUSAL_CODES, ADDRESS_LABEL_CODES, ADDRESS_DELIVERY_NOTE_MAX } from '../index';
import type { AddressCreateInput, PrivacyCommitments, PrivacyRequest } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });
const path = (c: Call) => new URL(c.url).pathname;

describe('PC-56 STORE-4a · SDK privacy (B1 / B2)', () => {
  it('commitments() GETs /v1/privacy/commitments and returns the figures as the API sends them', async () => {
    const c: PrivacyCommitments = { openOrders: 1, escrowMinor: '250000', walletMinor: '0', currencyCode: 'INR', multiCurrency: false, invoiceCount: 2, blocked: true, retentionYears: 8, coolingDays: 90 };
    const { fn, calls } = fakeFetch(() => ({ body: { data: c } }));
    expect(await client(fn).privacy.commitments()).toEqual(c);
    expect([calls[0].init.method, path(calls[0])]).toEqual(['GET', '/v1/privacy/commitments']);
  });
  it('myRequests() carries an export request\'s live job; a deletion refused arrives as DSR_BLOCKED with the figures', async () => {
    const rows: PrivacyRequest[] = [{ id: 'd1', kind: 'export', status: 'in_progress', requestedAt: '2026-10-16T05:00:00.000Z', export: { jobId: 'j1', status: 'queued', standing: { position: 1, ahead: 0, eta: { kind: 'no_history' } }, receipt: null, download: { kind: 'not_ready' }, failure: null, expiresAt: null, generatedAt: null } }];
    const { fn } = fakeFetch((c) => (path(c) === '/v1/privacy/requests' ? { body: { data: rows } } : { status: 409, body: { error: { code: 'DSR_BLOCKED', message: 'open', details: { openOrders: 1, escrowMinor: '0', walletMinor: '0', currencyCode: null } } } }));
    expect((await client(fn).privacy.myRequests())[0].export?.standing?.position).toBe(1);
    const e = await client(fn).privacy.requestAccountDeletion({}, 'dsr-delete:k').catch((x) => x);
    expect(e).toBeInstanceOf(SdkError); expect([e.code, e.status, e.details.openOrders]).toEqual(['DSR_BLOCKED', 409, 1]);
    expect(PRIVACY_REFUSAL_CODES).toEqual(['DSR_BLOCKED']);
  });
  it('requestDataExport() POSTs privacy/export-requests under the caller\'s key', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: 'd1', kind: 'export', status: 'in_progress' } } }));
    await client(fn).privacy.requestDataExport('dsr-export:k1');
    expect([calls[0].init.method, path(calls[0]), hdr(calls[0])['idempotency-key']]).toEqual(['POST', '/v1/privacy/export-requests', 'dsr-export:k1']);
  });
});

describe('PC-56 STORE-4a · SDK addresses (B3)', () => {
  it('get(id) GETs /v1/addresses/:id; create carries the country, the label and the note, under the key', async () => {
    const { fn, calls } = fakeFetch((c) => (c.init.method === 'GET' ? { body: { data: { id: 'a1', line1: 'Plot 14', isDefault: true, labelCode: 'farm', deliveryNote: 'Gate 2' } } } : { status: 201, body: { data: { id: 'a2' } } }));
    const a = await client(fn).addresses.get('a1');
    expect([path(calls[0]), a.labelCode, a.deliveryNote]).toEqual(['/v1/addresses/a1', 'farm', 'Gate 2']);
    const input: AddressCreateInput = { line1: 'Plot 14', pincode: '362001', countryCode: 'IN', labelId: 'l1', deliveryNote: 'Gate 2' };
    await client(fn).addresses.create(input, 'address:k');
    expect([calls[1].init.method, path(calls[1]), hdr(calls[1])['idempotency-key'], JSON.parse(String(calls[1].init.body))]).toEqual(['POST', '/v1/addresses', 'address:k', input]);
    // @ts-expect-error — countryCode is REQUIRED (Rule Zero: the API and the database no longer default it)
    const noCountry: AddressCreateInput = { line1: 'x' };
    expect(noCountry.line1).toBe('x');
    expect([ADDRESS_LABEL_CODES, ADDRESS_DELIVERY_NOTE_MAX, ADDRESS_REFUSAL_CODES.includes('ADDRESS_LABEL_UNKNOWN')]).toEqual([['home', 'farm', 'shop', 'warehouse', 'delivery'], 280, true]);
  });
});
