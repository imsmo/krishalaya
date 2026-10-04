// @krishalaya/sdk-js · PC-56 TENANT-SW-e (F-19) — the logistics-ops resources against a fake fetch: every route the console's W228 /
// W230 / W232 / W234 / W239 / W240 pages use is a typed method with the right verb, path, query, body and Idempotency-Key; the member's
// OTP-link calls carry no bearer; a refused figure arrives as data ({ kind: 'refused', code }), never as a number.
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body(call)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const ID = '0190a0a0-0000-7000-8000-000000000001';

describe('SW-e · logistics-ops SDK (F-19)', () => {
  it('carriers: list (+ meta.onTime refused) · get · create (idempotent) · patch · active WITH a reason', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.includes('logistics/partners?') ? { data: [], meta: { nextCursor: 'cur', onTime: { kind: 'refused', code: 'NO_PROMISED_DELIVERY_TIME' } } } : { data: { id: ID } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    const page = await c.carriers.list({ activeOnly: false, partnerKind: 'rider', limit: 5 });
    expect(calls[0].url).toBe('https://api.test/v1/logistics/partners?activeOnly=false&partnerKind=rider&limit=5');
    expect(page).toEqual({ items: [], nextCursor: 'cur', onTime: { kind: 'refused', code: 'NO_PROMISED_DELIVERY_TIME' } });
    await c.carriers.get(ID);
    await c.carriers.create({ partnerKind: 'rider', defaultName: 'Ravi', riderUserId: ID }, 'k1');
    await c.carriers.patch(ID, { defaultName: 'R' });
    await c.carriers.setActive(ID, false, 'Van in the workshop');
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'GET logistics/partners?activeOnly=false&partnerKind=rider&limit=5', `GET logistics/partners/${ID}`, 'POST logistics/partners', `PATCH logistics/partners/${ID}`, `POST logistics/partners/${ID}/active`]);
    expect(hdr(calls[2], 'idempotency-key')).toBe('k1');
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ isActive: false, reason: 'Van in the workshop' });
  });

  it('pickup slots: the desk, suggestions, proposals, the member in the app, the OTP link WITHOUT a bearer', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: { items: [] } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 'tok' });
    await c.pickupSlots.desk({ limit: 10 });
    await c.pickupSlots.suggestions(ID);
    await c.pickupSlots.propose({ sellerUserId: ID, slots: [{ weekday: 2, start: '07:00', end: '09:00' }], reason: 'The van passes at 8' }, 'k2');
    await c.pickupSlots.withdraw(ID, 'Seller moved village', 'k3');
    await c.pickupSlots.myProposals();
    await c.pickupSlots.accept(ID, 'k4');
    await c.pickupSlots.decline(ID, null, 'k5');
    await c.pickupSlots.linkView(ID);
    await c.pickupSlots.linkSendCode(ID);
    await c.pickupSlots.linkDecide(ID, { code: '123456', decision: 'accept' });
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'GET logistics/slots/desk?limit=10', `GET logistics/slots/suggestions/${ID}`, 'POST logistics/slots/proposals', `POST logistics/slots/proposals/${ID}/withdraw`,
      'GET me/pickup-slot-proposals', `POST me/pickup-slot-proposals/${ID}/accept`, `POST me/pickup-slot-proposals/${ID}/decline`,
      `GET pickup-slot-proposals/${ID}`, `POST pickup-slot-proposals/${ID}/code`, `POST pickup-slot-proposals/${ID}/decide`]);
    for (const i of [0, 4, 5]) expect(hdr(calls[i], 'authorization')).toBe('Bearer tok');
    for (const i of [7, 8, 9]) expect(hdr(calls[i], 'authorization')).toBeUndefined();
    expect(hdr(calls[2], 'idempotency-key')).toBe('k2');
  });

  it('Village Run: route page · runs · candidates · drop points · draft · acts · the two OTP handovers', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: { id: ID } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const v = c.villageRun;
    await v.route(ID); await v.runs(ID); await v.candidates(ID);
    await v.addDropPoint(ID, { sequence: 1, regionId: ID, name: 'Panchayat', ambassadorUserId: ID }, 'a'); await v.deactivateDropPoint(ID, 'Keeper moved away', 'b');
    await v.draft(ID, { runDate: '2026-10-08', plan: [{ shipmentId: ID, dropPointId: ID }], reason: 'Thursday run' }, 'c'); await v.run(ID);
    await v.act(ID, 'confirm', null, 'd'); await v.sendKeeperCode(ID, ID); await v.handOver(ID, { shipmentId: ID, code: '123456' }, 'e');
    await v.keeperQueue(); await v.sendCollectCode(ID); await v.collect(ID, '654321', 'f'); await v.returnParcel(ID, 'Member away a week', 'g');
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/logistics/village-run/', '')}`)).toEqual([
      `GET routes/${ID}`, `GET routes/${ID}/runs`, `GET routes/${ID}/candidates`, `POST routes/${ID}/drop-points`, `POST drop-points/${ID}/deactivate`,
      `POST routes/${ID}/runs`, `GET runs/${ID}`, `POST runs/${ID}/acts/confirm`, `POST runs/${ID}/handovers/code`, `POST runs/${ID}/handovers`,
      'GET me/drop-point', `POST handovers/${ID}/collect-code`, `POST handovers/${ID}/collect`, `POST handovers/${ID}/return`]);
  });

  it('cold chain: a manual reading sends no band and no time; thresholds · subjects · breaches (+ window meta) · acts · loggers · keys · exports · the buyer', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.endsWith('cold-chain/breaches?limit=1') ? { data: [], meta: { nextCursor: null, window: { since: 'x', months: 12, hours: null, count: 0, open: 0,
      medianAlertToAction: { kind: 'refused', code: 'NO_ACTION_RECORDED', over: 0 }, loss: { kind: 'none_recorded', breachesWithLoss: 0 } }, refused: null } } : { data: { id: ID } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const cc = c.coldChain;
    await cc.recordReading({ subjectType: 'shipment', subjectId: ID, tempC: 4 });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ subjectType: 'shipment', subjectId: ID, tempC: 4 });
    await cc.readings({ subjectType: 'shipment', subjectId: ID }); await cc.setThreshold({ subjectType: 'shipment', subjectId: ID, minC: 2, maxC: 8, reason: 'label band 2 to 8' }, 'k');
    await cc.subjects(); await cc.subject('shipment', ID, { hours: 24 });
    const b = await cc.breaches({ limit: 1 });
    expect(b.window?.medianAlertToAction).toEqual({ kind: 'refused', code: 'NO_ACTION_RECORDED', over: 0 });
    await cc.breach(ID); await cc.breachAct(ID, 'record_action', { note: 'Re-iced the box' }, 'k');
    await cc.loggers(); await cc.registerLogger({ serial: 'RF-1' }, 'k'); await cc.issueKey(ID, { subjectType: 'shipment', subjectId: ID, reason: 'Mounted in the van' }, 'k');
    await cc.revokeKey(ID, 'Logger was stolen', 'k'); await cc.exportTrail({ subjectType: 'shipment', subjectId: ID, days: 30 }, 'k'); await cc.exportBreaches({ months: 12 }, 'k');
    await cc.myOffers(); await cc.decideOffer(ID, { decision: 'accept_with_test' }, 'k');
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'POST logistics/cold-chain/readings', `GET logistics/cold-chain/readings?subjectType=shipment&subjectId=${ID}`, 'POST logistics/cold-chain/thresholds',
      'GET logistics/cold-chain/subjects', `GET logistics/cold-chain/subjects/shipment/${ID}?hours=24`, 'GET logistics/cold-chain/breaches?limit=1',
      `GET logistics/cold-chain/breaches/${ID}`, `POST logistics/cold-chain/breaches/${ID}/acts/record_action`, 'GET logistics/cold-chain/loggers', 'POST logistics/cold-chain/loggers',
      `POST logistics/cold-chain/loggers/${ID}/keys`, `POST logistics/cold-chain/loggers/${ID}/keys/revoke`, 'POST logistics/cold-chain/exports/trail', 'POST logistics/cold-chain/exports/breaches',
      'GET me/cold-chain-offers', `POST me/cold-chain-offers/${ID}/decision`]);
  });
});
