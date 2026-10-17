// apps/web-storefront/src/test-render/store5b-fixtures.ts · PC-56 STORE-5b — the shared world of the trace, verify, export, certificate and dairy
// render tests (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so
// the page under test and the test read the same mutable state `C`: the v3 scan answer, the verify answer, the certificate, the export job, the
// signed-in person, the `cert_type` vocabulary, every API call made, and the failures to answer with.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const TOKEN = 'KVTR9J4K2M7Q';
export const CERT_ID = '0219c000-0000-7000-8000-0000000c0001';
export const JOB_ID = '0219a000-0000-7000-8000-00000000j0b1'.replace('j0b1', '0b01');
export const ME = '0219b000-0000-7000-8000-00000000beef';
export const KEY = 'trace-export:0219d000-0000-4000-8000-000000000001';
const H = (c: string) => c.repeat(64).slice(0, 64);
export const HASHES = [H('3f9a'), H('88d1'), H('a3ce'), H('e07b')];

export const SCAN = (over: Record<string, unknown> = {}) => ({
  qrToken: TOKEN, organisation: { displayName: 'Anand FPO', slug: SLUG }, createdAt: '2026-10-16T18:30:00.000Z',
  product: { title: 'GG-20 groundnut', quantity: 25, unit: 'quintal' }, place: { village: 'Vanthali', district: 'Junagadh' },
  events: [
    { no: 1, eventCode: 'harvested', at: '2026-10-16T18:30:00.123Z', meta: { variety: 'GG-20', quantity: 25, unit: 'quintal' }, eventHash: HASHES[0], hashVersion: 2 },
    { no: 2, eventCode: 'in_transit', at: '2026-10-17T04:00:00.000Z', meta: { mode: 'road' }, eventHash: HASHES[1], hashVersion: 2 },
    { no: 3, eventCode: 'sold', at: '2026-10-17T05:00:00.000Z', meta: { quantity: 25, unit: 'quintal' }, eventHash: HASHES[2], hashVersion: 2 },
  ],
  certificates: [{ id: CERT_ID, typeCode: 'npop', status: 'verified', validUntil: '2026-12-31' }],
  anchor: { value: HASHES[2], anchoredAt: '2026-10-17T06:00:00.000Z', anchoredEventCount: 3, matchesHead: true }, sealed: true,
  ...over,
});
export const VERIFY = (over: Record<string, unknown> = {}) => ({
  qrToken: TOKEN, organisation: { displayName: 'Anand FPO', slug: SLUG },
  events: [
    { no: 1, eventCode: 'harvested', at: '2026-10-16T18:30:00.123Z', hashVersion: 2, eventHash: HASHES[0], prevHash: null, recomputed: 'ok' },
    { no: 2, eventCode: 'in_transit', at: '2026-10-17T04:00:00.000Z', hashVersion: 2, eventHash: HASHES[1], prevHash: HASHES[0], recomputed: 'ok' },
  ],
  chain: 'ok', brokenAt: null, v1Count: 0,
  anchor: { value: HASHES[1], anchoredAt: '2026-10-17T06:00:00.000Z', anchoredEventCount: 2, matchesHead: true }, formula: 'v2',
  ...over,
});
export const CERT = (over: Record<string, unknown> = {}) => ({
  id: CERT_ID, organisation: { displayName: 'Anand FPO', slug: SLUG }, typeCode: 'npop', certNo: 'NPOP-26-0419', issuingBody: 'APEDA-accredited certification body',
  validFrom: '2026-01-01', validUntil: '2026-12-31', status: 'verified', subjectType: 'listing', coversListing: 'GG-20 groundnut',
  checkedBy: { organisation: 'Anand FPO', role: 'fpo_coordinator', at: '2026-06-08T04:30:00.000Z' }, rejectionReason: null,
  ...over,
});
export const JOB = (over: Record<string, unknown> = {}) => ({
  id: JOB_ID, datasetCode: 'traceability.lot_record', params: { qrToken: TOKEN }, status: 'queued', attempts: 0, requestedBy: ME,
  queuedAt: '2026-10-17T06:00:00.000Z', startedAt: null, generatedAt: null, failedAt: null, expiredAt: null, expiresAt: null,
  receipt: null, failure: null, standing: { position: 2, eta: { kind: 'estimate', seconds: 90 } }, fetches: null, download: { kind: 'not_ready' },
  ...over,
});
export const READY = () => JOB({ status: 'ready', standing: null, generatedAt: '2026-10-17T06:01:00.000Z', expiresAt: '2026-10-24T06:01:00.000Z',
  receipt: { fileName: 'traceability-lot-record-record-2026-10-17.csv', rowCount: 4, sha256: 'f'.repeat(64), byteSize: 900, contentType: 'text/csv; charset=utf-8',
    generatedAt: '2026-10-17T06:01:00.000Z', requestedBy: ME, notes: [] }, fetches: { served: 0, refused: 0 }, download: { kind: 'available', linkTtlSec: 900 } });
export const VOCAB = [
  { id: 'v1', code: 'npop', name: 'NPOP (India Organic)', sortOrder: 1, meta: { organic: true } },
  { id: 'v5', code: 'lab_report', name: 'Laboratory test report', sortOrder: 5, meta: { organic: false } },
];

export const C: { lang: string; scan: any; verify: any; cert: any; job: any; vocab: any; calls: any[]; fail: Record<string, any> } = {} as any;
export function reset(): void {
  Object.assign(C, { lang: 'en', scan: SCAN(), verify: VERIFY(), cert: CERT(), job: JOB(), vocab: VOCAB, calls: [], fail: {} });
}
reset();

const failIf = (k: string) => { const f = C.fail[k]; if (f) throw (f instanceof SdkError ? f : new SdkError(f.code, f.status ?? 404, f.code)); };
const answer = (k: string, v: any) => { failIf(k); return v; };
export function publicClient(slug?: string): any {
  return {
    traceability: {
      scan: async (t: string) => { C.calls.push(['traceability.scan', t]); return answer('scan', C.scan); },
      verify: async (t: string) => { C.calls.push(['traceability.verify', t]); return answer('verify', C.verify); },
    },
    certificates: {
      public: async (id: string) => { C.calls.push(['certificates.public', id]); return answer('cert', C.cert); },
      publicByNo: async (q: any) => { C.calls.push(['certificates.publicByNo', q, slug ?? null]); return answer('cert', C.cert); },
    },
    lookups: { values: async (type: string) => { C.calls.push(['lookups.values', type]); return answer('vocab', C.vocab); } },
  };
}
export function publicClientIn(lang: string, slug?: string): any { C.calls.push(['publicClientIn', lang]); return publicClient(slug); }
export function serverClient(): any {
  return {
    traceability: { requestExport: async (t: string, key: string) => { C.calls.push(['traceability.requestExport', t, key]); failIf('export'); return { jobId: JOB_ID }; } },
    exportsPlane: {
      get: async (id: string) => { C.calls.push(['exportsPlane.get', id]); return answer('job', C.job); },
      mintLink: async (id: string) => { C.calls.push(['exportsPlane.mintLink', id]); failIf('mint'); return { token: 'tok_'.padEnd(40, 'x'), jti: 'j', expiresAt: '', ttlSec: 900, downloadPath: '' }; },
    },
    auth: { me: async () => ({ id: ME }) },
  };
}
export const UUIDS = (html: string) => html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
