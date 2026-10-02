// @krishalaya/sdk-js · PC-56 TENANT-11b · A12 — the labour resource speaks the API's 11b contract: confirm-roster (Idempotency-Key,
// consent for the desk), cancel with a reason code, the pay run with a reason, the console page with tab counts, the summary,
// the live floor, an assignment's days. Pinned with an injected fake fetch (no network).
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (body: unknown) => { const f = fakeFetch(body); return { c: createClient({ baseUrl: 'https://api.test', fetchImpl: f.fn, getToken: () => 'tok' }), calls: f.calls }; };
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const json = (c: Call) => JSON.parse(String(c.init.body));

describe('A12 · labour resource ↔ the 11b API', () => {
  it('confirmRoster carries the Idempotency-Key and the desk\'s consent', async () => {
    const { c, calls } = client({ data: { id: 'b1', status: 'accepted', escrowedMinor: '252000', platformFeeMinor: '2000', employerTotalMinor: '254000' } });
    const r = await c.labour.confirmRoster('b1', 'idem-r', { consent: { channel: 'otp' } });
    expect(calls[0].url).toBe('https://api.test/v1/labour/bookings/b1/confirm-roster');
    expect(calls[0].init.method).toBe('POST'); expect(hdr(calls[0])['idempotency-key']).toBe('idem-r');
    expect(json(calls[0])).toEqual({ consent: { channel: 'otp' } });
    expect(r.employerTotalMinor).toBe('254000');
  });
  it('cancel sends a reason code (and text for other)', async () => {
    const { c, calls } = client({ data: { id: 'b1', status: 'cancelled', releasedMinor: '126000', feeKeptMinor: '2000', workersNotified: 1 } });
    const r = await c.labour.cancelBooking('b1', { reasonCode: 'other', reasonText: 'tractor broke down' });
    expect(calls[0].url).toBe('https://api.test/v1/labour/bookings/b1/cancel');
    expect(json(calls[0])).toEqual({ reasonCode: 'other', reasonText: 'tractor broke down' });
    expect(r.feeKeptMinor).toBe('2000');
  });
  it('the pay run carries the key and an optional reason; start / complete send an act body', async () => {
    const { c, calls } = client({ data: { id: 'b1', status: 'in_progress', movedMinor: '126000', lines: [], outstanding: 0 } });
    const r = await c.labour.payWages('b1', 'idem-p', 'week one');
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-p'); expect(json(calls[0])).toEqual({ reason: 'week one' });
    expect(r.movedMinor).toBe('126000');
    await c.labour.startBooking('b1'); expect(json(calls[1])).toEqual({});
    await c.labour.completeBooking('b1', 'all three days done'); expect(json(calls[2])).toEqual({ reason: 'all three days done' });
  });
  it('consoleBookings asks for counts and returns them with the unreachable statuses', async () => {
    const { c, calls } = client({ data: [{ id: 'b1' }], meta: { nextCursor: 'cur', counts: { open: 2 }, unreachableStatuses: ['draft'] } });
    const p = await c.labour.consoleBookings({ status: 'open', sort: 'starts' });
    expect(calls[0].url).toBe('https://api.test/v1/labour/bookings?box=all&status=open&sort=starts&counts=1&limit=25');
    expect(p).toEqual({ items: [{ id: 'b1' }], nextCursor: 'cur', counts: { open: 2 }, unreachableStatuses: ['draft'] });
  });
  it('summary, floor and an assignment\'s days', async () => {
    const { c, calls } = client({ data: { minWageMinor: '38200', reason: null } });
    await c.labour.summary(); expect(calls[0].url).toBe('https://api.test/v1/labour/summary');
    await c.labour.floor({ regionId: 'r1', skillLevel: 'unskilled', wageKind: 'per_day', onDate: '2026-07-14' });
    expect(calls[1].url).toBe('https://api.test/v1/labour/lookups/floor?regionId=r1&skillLevel=unskilled&wageKind=per_day&onDate=2026-07-14');
    await c.labour.assignmentDays('a1'); expect(calls[2].url).toBe('https://api.test/v1/labour/assignments/a1/days');
  });
  it('the desk posts FOR an employer with consent; the desk fills with consent', async () => {
    const { c, calls } = client({ data: { id: 'b1' } });
    await c.labour.createBooking({ demandTypeCode: 'daily_multi', taskSkillId: 's1', regionId: 'r1', skillLevel: 'unskilled', workersNeeded: 2, startDate: '2026-07-14', endDate: '2026-07-16',
      wageOfferedMinor: '42000', farmLat: 22.3, farmLng: 71.1, transportProvided: true, transportPickupPoint: 'Vanthali chowk', transportPickupTime: '06:30', toiletConfirmed: true,
      onBehalf: { employerUserId: 'u1', consent: { channel: 'voice', mediaId: 'm1' } } }, 'idem-c');
    expect(json(calls[0]).onBehalf).toEqual({ employerUserId: 'u1', consent: { channel: 'voice', mediaId: 'm1' } });
    await c.labour.assignWorker('b1', { workerId: 'w1', consent: { channel: 'otp' } }, 'idem-f');
    expect(json(calls[1])).toEqual({ workerId: 'w1', consent: { channel: 'otp' } });
  });
});
