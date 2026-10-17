// apps/web-storefront/src/test/tracking.spec.ts · PC-56 STORE-SWEEP-b · C1 (founder D1 — HOTFIX-9 Q3) — WHAT A BUYER SEES OF A DELIVERY, AS PURE RULES.
//   • the milestones are status + time ONLY, in time order; a location ping (the same status again) is not a milestone; an unknown status or a bad
//     time is dropped — and a note, a coordinate or a rider id in the read has no field to travel in;
//   • the section's state: the organisation's `logistics` flag (on / off / unreadable) before the read; a failed read is the section's own; no
//     shipment or a `pending` one → "no journey updates yet";
//   • the partner line: assigned (never who), the attempts as a plain count (0 → not printed), the partner's own reference only when set.
import { SHIPMENT_STATUSES, TRACKING_REFUSED, journeyRows, logisticsFlag, partnerLine, trackingState } from '../features/sweep/tracking';
import { SWEEP_REFUSALS } from '../features/sweep/refusals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEAKY = {
  shipment: { id: 's1', status: 'in_transit', awbNo: 'AWB-77881', riderAssigned: true, deliveryAttempts: 1, riderUserId: '0210f000-0000-7000-8000-00000000r1d3' },
  shipmentEvents: [
    { status: 'picked_up', at: '2026-10-16T05:10:00.000Z', lat: 23.123456, lng: 72.654321, note: 'rider: gate code 4412' },
    { status: 'assigned', at: '2026-10-16T04:00:00.000Z', lat: null, lng: null, note: null },
    { status: 'in_transit', at: '2026-10-16T07:00:00.000Z', lat: 23.2, lng: 72.7, note: null },
    { status: 'in_transit', at: '2026-10-16T08:30:00.000Z', lat: 23.3, lng: 72.8, note: 'ping' },        // a location ping — not a milestone
    { status: 'teleported', at: '2026-10-16T09:00:00.000Z', lat: null, lng: null, note: null },          // unknown — dropped
    { status: 'out_for_delivery', at: 'not a time', lat: null, lng: null, note: null },                  // bad time — dropped
  ],
};

describe('STORE-SWEEP-b · journeyRows', () => {
  it('status + time only, in time order, a ping folded into its milestone, unknown statuses and bad times dropped', () => {
    const rows = journeyRows(LEAKY as never);
    expect(rows).toEqual([
      { status: 'assigned', at: '2026-10-16T04:00:00.000Z' },
      { status: 'picked_up', at: '2026-10-16T05:10:00.000Z' },
      { status: 'in_transit', at: '2026-10-16T07:00:00.000Z' },
    ]);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['at', 'status']);
    expect(JSON.stringify(rows)).not.toMatch(/23\.|72\.|gate code|ping|r1d3|AWB/);
  });
  it('no read, no events → no rows; the statuses mirror the API\'s state machine', () => {
    expect(journeyRows(null)).toEqual([]);
    expect(journeyRows({ shipment: null, shipmentEvents: [] })).toEqual([]);
    const api = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'modules', 'logistics', 'domain', 'shipment.state.ts'), 'utf8');
    const m = api.match(/SHIPMENT_STATUSES = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...SHIPMENT_STATUSES]);
  });
});

describe('STORE-SWEEP-b · the section\'s state', () => {
  it('the flag: ON / OFF from the public flags; no read or no key → unknown (never a guess)', () => {
    expect(logisticsFlag({ logistics: true })).toBe('on');
    expect(logisticsFlag({ logistics: false })).toBe('off');
    expect(logisticsFlag({})).toBe('unknown');
    expect(logisticsFlag(null)).toBe('unknown');
  });
  it('off / unknown before the read; a failed read is `error`; no shipment or pending → `pending`; else the journey', () => {
    const ok = (status: string | null) => ({ ok: true as const, data: { shipment: status ? { status } : null, shipmentEvents: [] } });
    expect(trackingState('off', ok('in_transit'))).toBe('off');
    expect(trackingState('unknown', ok('in_transit'))).toBe('unknown');
    expect(trackingState('on', null)).toBe('error');
    expect(trackingState('on', { ok: false })).toBe('error');
    expect(trackingState('on', ok(null))).toBe('pending');
    expect(trackingState('on', ok('pending'))).toBe('pending');
    for (const s of ['assigned', 'in_transit', 'failed', 'delivered', 'returned']) expect(trackingState('on', ok(s))).toBe('journey');
  });
});

describe('STORE-SWEEP-b · partnerLine', () => {
  it('assigned only when the read says so — never who; attempts a plain count (0 → none); the partner\'s reference only when set', () => {
    expect(partnerLine(LEAKY.shipment)).toEqual({ assigned: true, attempts: 1, awb: 'AWB-77881' });
    expect(partnerLine({ status: 'assigned', riderAssigned: false, deliveryAttempts: 0, awbNo: null })).toEqual({ assigned: false, attempts: null, awb: null });
    expect(partnerLine({ status: 'assigned', awbNo: '   ' })).toEqual({ assigned: false, attempts: null, awb: null });
    expect(partnerLine({ status: 'failed', deliveryAttempts: 2.5 } as never).attempts).toBeNull();
    expect(partnerLine(null)).toEqual({ assigned: false, attempts: null, awb: null });
    expect(JSON.stringify(partnerLine(LEAKY.shipment))).not.toContain('r1d3');
  });
  it('every refused W292 claim is in the registry on the tracking surface', () => {
    const ids = SWEEP_REFUSALS.filter((r) => r.surfaces.includes('tracking')).map((r) => r.id);
    expect(ids).toEqual([...TRACKING_REFUSED]);
  });
});
