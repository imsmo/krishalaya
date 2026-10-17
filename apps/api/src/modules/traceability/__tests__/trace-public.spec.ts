// modules/traceability/__tests__/trace-public.spec.ts · PC-56 STORE-5b · B10 (founder D3/D4/D5) — the public lot, an allow-list.
import { publicLot, effectiveCertStatus } from '../domain/trace-public';
import { lotRecordRows, lotRecordNotes, LOT_RECORD_HEADER } from '../exports/lot-record.producer';
import { verificationOf } from '../services/public-scan.service';
import { chainHashV2 } from '../domain/trace-chain';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LOT = '0219e000-0000-7000-8000-00000000c0de';
const TENANT = '0219e000-0000-7000-8000-00000000beef';
const CERT = '0219e000-0000-7000-8000-0000000cee01';
const AT1 = '2026-10-16T18:30:00.123000Z'; const AT2 = '2026-10-17T04:05:06.789000Z';
const H1 = chainHashV2(LOT, LOT, 'harvested', { variety: 'GG-20', quantity: 25, unit: 'quintal' }, AT1);
const H2 = chainHashV2(H1, LOT, 'sold', { quantity: 25, unit: 'quintal' }, AT2);
const ROW = (over: Record<string, unknown> = {}) => ({
  live: true, qrToken: 'KVTR9J4K2M', tenantId: TENANT, lotId: LOT,
  organisation: { displayName: 'Anand FPO', slug: 'anand-fpo' },
  product: { title: 'GG-20 groundnut', quantity: '25.000', unit: 'quintal' },
  place: { village: 'Vanthali', district: 'Junagadh' },
  createdAt: '2026-10-16T18:30:00.123+00:00',
  anchor: { value: H2, anchoredAt: '2026-10-17T00:00:00+00:00', anchoredEventCount: 2 },
  events: [
    { no: 1, eventCode: 'harvested', at: AT1, atUs: AT1, hashVersion: 2, eventHash: H1, meta: { variety: 'GG-20', quantity: 25, unit: 'quintal' }, metaHidden: false },
    { no: 2, eventCode: 'sold', at: AT2, atUs: AT2, hashVersion: 2, eventHash: H2, meta: { quantity: 25, unit: 'quintal' }, metaHidden: false },
  ],
  certificates: [{ id: CERT, typeCode: 'npop', status: 'verified', validUntil: '2026-12-31', expired: false }],
  ...over,
});

describe('STORE-5b · publicLot', () => {
  it('the allow-list: organisation (name + slug), product, place, events with hash + version, certificates, the seal — tenantId / lotId / atUs / metaHidden stripped; the only uuid is the certificate id', () => {
    const p = publicLot(ROW());
    expect(Object.keys(p).sort()).toEqual(['anchor', 'certificates', 'createdAt', 'events', 'organisation', 'place', 'product', 'qrToken', 'sealed']);
    expect(p.organisation).toEqual({ displayName: 'Anand FPO', slug: 'anand-fpo' });
    expect(p.product).toEqual({ title: 'GG-20 groundnut', quantity: 25, unit: 'quintal' });
    expect(p.place).toEqual({ village: 'Vanthali', district: 'Junagadh' });
    expect(p.events[0]).toEqual({ no: 1, eventCode: 'harvested', at: AT1, meta: { variety: 'GG-20', quantity: 25, unit: 'quintal' }, eventHash: H1, hashVersion: 2 });
    expect(p.certificates).toEqual([{ id: CERT, typeCode: 'npop', status: 'verified', validUntil: '2026-12-31' }]);
    expect([p.anchor.matchesHead, p.sealed]).toEqual([true, true]);
    expect(JSON.stringify(p).match(UUID)).toEqual([CERT]);
  });
  it('meta is re-judged per key (a phone run in a variety is dropped); an expired verified certificate reads expired; a stale seal is not "sealed"', () => {
    const p = publicLot(ROW({
      events: [{ no: 1, eventCode: 'harvested', at: AT1, atUs: AT1, hashVersion: 2, eventHash: H1, meta: { variety: 'call 9898012742', unit: 'quintal' } }],
      certificates: [{ id: CERT, typeCode: 'npop', status: 'verified', validUntil: '2020-01-01', expired: true }],
    }));
    expect(p.events[0].meta).toEqual({ unit: 'quintal' });
    expect(p.certificates[0].status).toBe('expired');
    expect([p.anchor.matchesHead, p.sealed]).toEqual([false, false]);   // the seal stamps H2, the head is H1
    expect(effectiveCertStatus('rejected', true)).toBe('rejected');
    expect(effectiveCertStatus('bogus', false)).toBe('pending');
  });
  it('no product / place → null (never an invented one); no money key anywhere', () => {
    const p = publicLot(ROW({ product: null, place: { village: null, district: null } }));
    expect([p.product, p.place]).toEqual([null, null]);
    expect(JSON.stringify(publicLot(ROW()))).not.toMatch(/price|amount|minor|paid|ledger|farmer/i);
  });
});

describe('STORE-5b · the verify answer and the record file', () => {
  it('verificationOf: ok chain, matchesHead, no uuid (the lot id never leaves)', () => {
    const v = verificationOf(ROW(), LOT);
    expect([v.chain, v.brokenAt, v.anchor.matchesHead, v.formula]).toEqual(['ok', null, true, 'v2']);
    expect(v.events.map((e) => e.recomputed)).toEqual(['ok', 'ok']);
    expect(JSON.stringify(v)).not.toMatch(UUID);
  });
  it('lotRecordRows: one row per event + the seal trailer; the first prev_hash is the lot (genesis); meta canonical; the verdict per row', () => {
    const rows = lotRecordRows(ROW(), LOT);
    expect(LOT_RECORD_HEADER).toEqual(['event_no', 'event_code', 'at', 'hash_version', 'event_hash', 'prev_hash', 'meta_json', 'recomputed']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([1, 'harvested', AT1, 2, H1, LOT, '{"quantity":25,"unit":"quintal","variety":"GG-20"}', 'ok']);
    expect(rows[1][5]).toBe(H1);
    expect(rows[2][0]).toBe('seal'); expect(rows[2][4]).toBe(H2); expect(rows[2][7]).toBe('head');
    expect(JSON.parse(String(rows[2][6]))).toEqual({ anchoredEventCount: 2, anchoredHead: true, brokenAt: null, chain: 'ok' });
    expect(lotRecordNotes(2, 0).join(' ')).toMatch(/not signed/);
    expect(lotRecordNotes(2, 1).join(' ')).toMatch(/unverifiable_v1/);
  });
});
