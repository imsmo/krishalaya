// modules/traceability/__tests__/traceability-domain.spec.ts · pure-domain invariants (no I/O).
// Pins: the tamper-evident hash chain (deterministic, prev-dependent, tamper-detectable), lot creation emits +
// requires a token, event requires a code, anchor stamps the lot.
// PC-56 STORE-5b · B11: `TraceEvent.append` writes hash VERSION 2 over the instant it is given (`createdAt`, stored as created_at) — the
// v1 `chainHash` is kept for the rows written before 0219.
import { TraceEvent, chainHash } from '../domain/trace-event.entity';
import { TraceLot } from '../domain/trace-lot.entity';
import { InvalidTraceEventError } from '../domain/traceability.errors';
import { chainHashV2, hashInstant } from '../domain/trace-chain';

const AT = new Date('2026-10-17T04:05:06.789Z');

describe('hash chain', () => {
  it('is deterministic and depends on the previous hash', () => {
    const h1 = chainHash('seed', 'lot1', 'harvested', { a: 1 });
    expect(chainHash('seed', 'lot1', 'harvested', { a: 1 })).toBe(h1);     // deterministic
    expect(chainHash('OTHER', 'lot1', 'harvested', { a: 1 })).not.toBe(h1); // prev-dependent
    expect(chainHash('seed', 'lot1', 'sold', { a: 1 })).not.toBe(h1);       // code-dependent
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a chain detects tampering — recomputing a changed link breaks the next hash', () => {
    const e1 = TraceEvent.append({ traceLotId: 'lot1', tenantId: 't1', eventCode: 'listed', meta: {}, prevHash: 'lot1', createdAt: AT });
    const e2 = TraceEvent.append({ traceLotId: 'lot1', tenantId: 't1', eventCode: 'sold', meta: { quantity: 100 }, prevHash: e1.eventHash, createdAt: AT });
    // tamper e1's meta → its hash changes → e2's prev no longer matches
    const e1Tampered = TraceEvent.append({ traceLotId: 'lot1', tenantId: 't1', eventCode: 'listed', meta: { hacked: true }, prevHash: 'lot1', createdAt: AT });
    expect(e1Tampered.eventHash).not.toBe(e1.eventHash);
    const e2Recomputed = chainHashV2(e1Tampered.eventHash, 'lot1', 'sold', { quantity: 100 }, hashInstant(AT));
    expect(e2Recomputed).not.toBe(e2.eventHash);
  });
  it('STORE-5b: a new event is VERSION 2 over the instant it is stored with (the instant is hashed)', () => {
    const e = TraceEvent.append({ traceLotId: 'lot1', tenantId: 't1', eventCode: 'harvested', meta: { variety: 'GG-20', unit: 'kg' }, prevHash: 'lot1', createdAt: AT });
    expect(e.toProps()).toMatchObject({ hashVersion: 2, createdAt: AT });
    expect(e.eventHash).toBe(chainHashV2('lot1', 'lot1', 'harvested', { unit: 'kg', variety: 'GG-20' }, '2026-10-17T04:05:06.789000Z'));
    const later = TraceEvent.append({ traceLotId: 'lot1', tenantId: 't1', eventCode: 'harvested', meta: { variety: 'GG-20', unit: 'kg' }, prevHash: 'lot1', createdAt: new Date(AT.getTime() + 1) });
    expect(later.eventHash).not.toBe(e.eventHash);
    expect(e.toJSON()).toMatchObject({ hashVersion: 2 });
  });
  it('rejects an empty event code, and a missing instant', () => {
    expect(() => TraceEvent.append({ traceLotId: 'l', tenantId: 't', eventCode: '' as any, meta: {}, prevHash: 'x', createdAt: AT })).toThrow(InvalidTraceEventError);
    expect(() => TraceEvent.append({ traceLotId: 'l', tenantId: 't', eventCode: 'sold', meta: {}, prevHash: 'x', createdAt: undefined as any })).toThrow(InvalidTraceEventError);
  });
});

describe('TraceLot', () => {
  const mk = () => TraceLot.create({ id: 'l1', tenantId: 't1', listingId: 'lst1', qrToken: 'QR123456', farmerUserId: 'u1', parcelId: null, cropSeasonId: null, declaredInputs: [], certificateIds: [] });
  it('emits LotCreated; anchor stamps + emits LotAnchored', () => {
    const l = mk(); expect(l.pullEvents().map((e) => e.type)).toContain('trace.lot_created');
    l.anchor('deadbeef'); expect(l.blockchainAnchor).toBe('deadbeef');
    expect(l.pullEvents().map((e) => e.type)).toContain('trace.lot_anchored');
  });
});
