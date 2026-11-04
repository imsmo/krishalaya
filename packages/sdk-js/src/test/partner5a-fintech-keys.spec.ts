// @krishalaya/sdk-js · PC-56 PARTNER-5a (survey C-11 / P5-B12) — the four fintech servicing WRITES send the caller's Idempotency-Key. Since
// PARTNER-4a the server answers 400 without one, so before this wave all four were dead from the SDK. One case per write.
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch() {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { id: 'x', status: 'draft' } }) } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers as Record<string, string>)['idempotency-key'];

describe('PC-56 PARTNER-5a · fintech servicing writes carry an idempotency key', () => {
  it('kccEntry POSTs …/kcc/entries with the key', async () => {
    const { fn, calls } = fakeFetch(); const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    await c.fintech.kccEntry('l1', { entryKind: 'drawl', amountMinor: '100', narrative: 'fixture' }, 'idem-kcc-1');
    expect([calls[0].init.method, calls[0].url, hdr(calls[0])]).toEqual(['POST', 'https://api.test/v1/fintech/servicing/loans/l1/kcc/entries', 'idem-kcc-1']);
  });
  it('proposeRestructure POSTs …/restructures with the key', async () => {
    const { fn, calls } = fakeFetch(); const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    await c.fintech.proposeRestructure('l1', { reasonCode: 'other' }, 'idem-prop-1');
    expect([calls[0].init.method, calls[0].url, hdr(calls[0])]).toEqual(['POST', 'https://api.test/v1/fintech/servicing/loans/l1/restructures', 'idem-prop-1']);
  });
  it('transitionRestructure POSTs …/transition with the key and the target state only', async () => {
    const { fn, calls } = fakeFetch(); const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    await c.fintech.transitionRestructure('r1', 'mediation', 'idem-tr-1');
    expect([calls[0].init.method, calls[0].url, hdr(calls[0]), JSON.parse(String(calls[0].init.body))]).toEqual(['POST', 'https://api.test/v1/fintech/servicing/restructures/r1/transition', 'idem-tr-1', { to: 'mediation' }]);
  });
  it('writeOff POSTs …/write-off with the key (the server refuses it by name today — 409 WRITE_OFF_NOT_LIVE)', async () => {
    const { fn, calls } = fakeFetch(); const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    await c.fintech.writeOff('l1', 'a reason', 'idem-wo-1');
    expect([calls[0].init.method, calls[0].url, hdr(calls[0])]).toEqual(['POST', 'https://api.test/v1/fintech/servicing/loans/l1/write-off', 'idem-wo-1']);
  });
});
