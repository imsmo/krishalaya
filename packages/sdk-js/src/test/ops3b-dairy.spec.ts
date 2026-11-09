// @krishalaya/sdk-js · PC-56 OPS-3b · OPS3-B17 — `recordBmcReading` speaks the API: `POST dairy/bmc/readings` with the four keys the strict DTO
// accepts (`unitId` | `deviceRef`, `tempC`, `humidityPct`) and NEVER `recordedAt` — a manual reading is recorded at the SERVER's time, and the API
// refuses the key by name. A caller that passes `recordedAt` anyway (untyped JS, a cast) still does not send it. The answer's type is the
// service's return, field for field. Pinned with a fake fetch.
import { createClient } from '../client';
import type { DairyBmcReading, DairyBmcReadingInput } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => { calls.push({ url: String(url), init: init ?? {} }); return { ok: true, status: 201, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any; }) as unknown as typeof fetch;
  return { fn, calls };
}
const ANSWER: DairyBmcReading = { id: '42', unitId: 'u1', tempC: '3.8', isBreach: false, verdict: 'in_range', recordedAt: '2026-11-09T03:10:44.000Z', band: { minC: '2.0', maxC: '4.5' } };
const client = () => { const f = fakeFetch({ data: ANSWER }); return { c: createClient({ baseUrl: 'https://api.test', fetchImpl: f.fn, getToken: () => 'tok', retries: 0 }), calls: f.calls }; };
const json = (c: Call) => JSON.parse(String(c.init.body));

describe('PC-56 OPS-3b · OPS3-B17 · recordBmcReading sends no recordedAt', () => {
  it('POST dairy/bmc/readings with exactly { unitId, tempC } — and the server\'s answer back', async () => {
    const { c, calls } = client();
    const r = await c.dairy.recordBmcReading({ unitId: 'u1', tempC: '3.8' });
    expect([calls[0].url, calls[0].init.method]).toEqual(['https://api.test/v1/dairy/bmc/readings', 'POST']);
    expect(json(calls[0])).toEqual({ tempC: '3.8', unitId: 'u1' });
    expect(r).toEqual(ANSWER);
  });
  it('a recordedAt passed anyway (a cast) is NOT sent; nor is any other key the DTO refuses', async () => {
    const { c, calls } = client();
    await c.dairy.recordBmcReading({ unitId: 'u1', tempC: '3.8', recordedAt: '2026-01-01T00:00:00Z', band: { minC: '9' } } as unknown as DairyBmcReadingInput);
    expect(Object.keys(json(calls[0])).sort()).toEqual(['tempC', 'unitId']);
  });
  it('the sensor path and the humidity are sent as given', async () => {
    const { c, calls } = client();
    await c.dairy.recordBmcReading({ deviceRef: 'dev-1', tempC: '4.0', humidityPct: '61.5' });
    expect(json(calls[0])).toEqual({ deviceRef: 'dev-1', tempC: '4.0', humidityPct: '61.5' });
  });
  it('the input type has no recordedAt (a compile-time pin, read from the source)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'types.ts'), 'utf8') as string;
    const body = src.slice(src.indexOf('export interface DairyBmcReadingInput'), src.indexOf('}', src.indexOf('export interface DairyBmcReadingInput')));
    expect(body).toMatch(/tempC: string;/); expect(/recordedAt/.test(body)).toBe(false);
  });
});
