// modules/traceability/__tests__/trace-chain.spec.ts · PC-56 STORE-5b · B11 (founder D3) — the v2 chain hash and the forward recompute.
//   (1) chainHashV2 reproduces the SHARED vectors (an independent implementation wrote them); v1 kept;
//   (2) the instant text: UTC, six fractional digits;
//   (3) verifyChain: all v2 → ok; a tampered meta → mismatch AT that event and EVERY event after, chain broken_at n; a v1 event →
//       unverifiable_v1, never mismatch, the walk carries its stored hash; metaHidden → mismatch; the seal's matchesHead; the first event's
//       prevHash is null (the lot's id is never public).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chainHashV1, chainHashV2, hashInstant, verifyChain, sealMatchesHead, ChainEvent } from '../domain/trace-chain';

const V = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'hash', '__fixtures__', 'canonical-json.vectors.json'), 'utf8')) as {
  chainV2: Array<{ prev: string; lotId: string; eventCode: string; meta: Record<string, unknown>; at: string; input: string; hash: string }>;
  v1: { prev: string; lotId: string; eventCode: string; meta: Record<string, unknown>; hash: string };
};
const LOT = V.chainV2[0].lotId;
const events = (): ChainEvent[] => V.chainV2.map((c, i) => ({ no: i + 1, eventCode: c.eventCode, at: c.at, atUs: c.at, hashVersion: 2, eventHash: c.hash, meta: { ...c.meta } }));

describe('STORE-5b · trace chain v2', () => {
  it('(1) chainHashV2 reproduces every shared vector; the chain links (each prev = the previous hash); v1 is the old formula', () => {
    for (const c of V.chainV2) expect(chainHashV2(c.prev, c.lotId, c.eventCode, c.meta, c.at)).toBe(c.hash);
    expect(V.chainV2[1].prev).toBe(V.chainV2[0].hash);
    expect(chainHashV1(V.v1.prev, V.v1.lotId, V.v1.eventCode, V.v1.meta)).toBe(V.v1.hash);
    // key order never changes a v2 hash (it did change v1's)
    const c = V.chainV2[0];
    const reordered = Object.fromEntries(Object.entries(c.meta).reverse());
    expect(chainHashV2(c.prev, c.lotId, c.eventCode, reordered, c.at)).toBe(c.hash);
    expect(chainHashV1(c.prev, c.lotId, c.eventCode, reordered)).not.toBe(chainHashV1(c.prev, c.lotId, c.eventCode, c.meta));
  });
  it('(2) the hashed instant: UTC, six fractional digits — the text trace_scan_v3 prints as atUs', () => {
    expect(hashInstant(new Date('2026-10-16T18:30:00.123Z'))).toBe('2026-10-16T18:30:00.123000Z');
    expect(hashInstant(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)))).toBe('2026-01-02T03:04:05.006000Z');
  });
  it('(3a) an untouched v2 chain → every event ok, chain ok; the first prevHash is null, the rest the previous stored hash', () => {
    const v = verifyChain(LOT, events(), { value: null, anchoredAt: null, anchoredEventCount: null });
    expect(v.events.map((e) => e.recomputed)).toEqual(['ok', 'ok', 'ok']);
    expect([v.chain, v.brokenAt, v.v1Count]).toEqual(['ok', null, 0]);
    expect(v.events.map((e) => e.prevHash)).toEqual([null, V.chainV2[0].hash, V.chainV2[1].hash]);
    expect(JSON.stringify(v)).not.toContain(LOT);
  });
  it('(3b) a tampered meta at event 2 → mismatch at 2 AND 3 ("every hash after it breaks"), chain broken_at 2', () => {
    const ev = events(); ev[1].meta = { ...ev[1].meta, packCount: 49 };
    const v = verifyChain(LOT, ev, { value: null, anchoredAt: null, anchoredEventCount: null });
    expect(v.events.map((e) => e.recomputed)).toEqual(['ok', 'mismatch', 'mismatch']);
    expect([v.chain, v.brokenAt]).toEqual(['broken_at', 2]);
    // a tampered instant breaks it too (time is hashed in v2)
    const t = events(); t[0].atUs = '2026-10-16T18:31:00.123000Z';
    expect(verifyChain(LOT, t, { value: null, anchoredAt: null, anchoredEventCount: null }).brokenAt).toBe(1);
  });
  it('(3c) a v1 event → unverifiable_v1 (never mismatch); the walk carries its STORED hash so the v2 events after it still verify', () => {
    const v1Hash = chainHashV1(LOT, LOT, 'harvested', { a: 1, b: 2 });
    const at = '2026-10-17T06:00:00.000000Z';
    const ev: ChainEvent[] = [
      { no: 1, eventCode: 'harvested', at, atUs: at, hashVersion: 1, eventHash: v1Hash, meta: { b: 2, a: 1 } },
      { no: 2, eventCode: 'in_transit', at, atUs: at, hashVersion: 2, eventHash: chainHashV2(v1Hash, LOT, 'in_transit', { mode: 'road' }, at), meta: { mode: 'road' } },
    ];
    const v = verifyChain(LOT, ev, { value: null, anchoredAt: null, anchoredEventCount: null });
    expect(v.events.map((e) => e.recomputed)).toEqual(['unverifiable_v1', 'ok']);
    expect([v.chain, v.v1Count]).toEqual(['ok', 1]);
  });
  it('(3d) metaHidden (a key the public allow-list drops — impossible through the API door) → mismatch', () => {
    const ev = events(); ev[2].metaHidden = true;
    expect(verifyChain(LOT, ev, { value: null, anchoredAt: null, anchoredEventCount: null }).events[2].recomputed).toBe('mismatch');
  });
  it('(3e) the seal: matchesHead only when it stamps the LAST stored hash; a stale or absent seal does not', () => {
    const ev = events();
    expect(verifyChain(LOT, ev, { value: V.chainV2[2].hash, anchoredAt: '2026-10-17T00:00:00Z', anchoredEventCount: 3 }).anchor.matchesHead).toBe(true);
    expect(verifyChain(LOT, ev, { value: V.chainV2[1].hash, anchoredAt: '2026-10-17T00:00:00Z', anchoredEventCount: 2 }).anchor.matchesHead).toBe(false);
    expect(sealMatchesHead(null, ev)).toBe(false);
    expect(sealMatchesHead('x', [])).toBe(false);
  });
});
