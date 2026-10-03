// modules/market-intel/__tests__/price.service.spec.ts · service unit tests with fakes.
// Pins: ingest requires market.manage; ingest fires only the alerts CROSSED by the modal (emits one event each);
// prediction.generate requires market.manage and is REFUSED (PC-56 TENANT-12); alert toggle 404s a non-owner (no IDOR).
import { MandiPriceService } from '../services/mandi-price.service';
import { PricePredictionService } from '../services/price-prediction.service';
import { PriceAlertService } from '../services/price-alert.service';
import { PriceAlert } from '../domain/price-alert.entity';
import { MarketForbiddenError, PriceAlertNotFoundError } from '../domain/market-intel.errors';

const alert = (dir: any, thr: bigint, user = 'u1') => PriceAlert.rehydrate({ id: `al-${dir}-${thr}`, tenantId: 't1', userId: user, productId: 'p1', regionId: 'r1', direction: dir, thresholdMinor: thr, isActive: true });

function priceHarness(opts: { matching?: PriceAlert[]; reference?: bigint | null; thresholdBp?: number; gatedSources?: string[] } = {}) {
  const writes: any[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn(async (_tx: any, e: any) => { writes.push(e); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  // PC-56 ADMIN-SWEEP: `insert` returns the id + partition key, and the service now reads a reference modal and may
  // enqueue an anomaly review. `referenceModal` defaults to NULL — a first-ever observation, which is ACCEPTED by design
  // (quarantining every new mandi's first report would hold the districts an expanding platform is trying to serve).
  const prices = {
    insert: jest.fn(async () => ({ id: '1', priceDate: '2026-06-20' })),
    recentModals: jest.fn(),
    referenceModal: jest.fn(async () => opts.reference ?? null),
    enqueueAnomalyReview: jest.fn(async () => undefined),
  };
  // insertTrigger: the P1-3 per-user trigger-log append (PriceAlertRepository.insertTrigger) — the service
  // calls it once per crossed alert, in-tx, alongside the PriceAlertTriggered outbox event.
  const alerts = { matchActive: jest.fn(async () => opts.matching ?? []), insertTrigger: jest.fn(async () => undefined) };
  const names = { resolveCommodityName: jest.fn(), resolveMandiName: jest.fn() }; // MarketNamesReadModel stub (7th dep)
  // The anomaly policy read model (8th dep). Defaults to the shipped threshold so a test that does not care about the
  // gate behaves as production does with no platform override set.
  const settings = { anomalyPolicy: jest.fn(async () => ({
    thresholdBp: opts.thresholdBp ?? 2_000,
    gatedSources: opts.gatedSources ?? ['ambassador_manual', 'platform_txn'],
    usedDefaults: false,
  })) };
  const svc = new MandiPriceService(uow as any, outbox as any, idem as any, metrics as any, prices as any, alerts as any, names as any, settings as any);
  return { svc, writes, prices, alerts, settings, metrics };
}
const ops = { userId: 'ops', canManage: true };
const learner = { userId: 'u1', canManage: false };

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-SWEEP · THE HIGHEST-STAKES LINE IN THE PANEL                                          */
/* ------------------------------------------------------------------------------------------------ */
// **A MUTATION SURVIVED AND THIS BLOCK IS WHY IT EXISTS.** Deleting the early return in `ingest` — the one line that
// stops a quarantined observation reaching the alert loop — broke NOTHING: the domain spec proved `mayFeedFarmerAlerts`
// returns false for 'quarantined', and nothing proved the SERVICE consulted it. Which means the sentence this whole wave
// is about ("bad data never reaches a selling decision") rested on a line no test held down.
//
// Fourth time this shape has appeared in the programme, and the sharpest instance: a rule that exists, is correct, and is
// enforced by a call somebody could delete.
describe('ADMIN-SWEEP · a quarantined price sends NO farmer alert', () => {
  const crossed = [alert('above', 600_000n)];   // a threshold this 10x typo would cross by a mile

  it('holds a 10x manual typo and fires nothing', async () => {
    // ₹6,420 reference, ₹64,200 reported: 900% off, and there is a farmer subscribed above ₹6,000.
    const h = priceHarness({ matching: crossed, reference: 642_000n });
    const out = await h.svc.ingest('t1', ops, 'idem-quarantine', {
      productId: 'p1', regionId: 'r1', priceDate: '2026-08-11', modalMinor: '6420000',
      unitCode: 'quintal', source: 'ambassador_manual',
    } as any);

    expect(out.anomalyState).toBe('quarantined');
    expect(out.alertsFired).toBe(0);
    // **NOT ONE PriceAlertTriggered EVENT.** This is the assertion the wave exists for: before the fix, this exact input
    // sent "groundnut is above your threshold" to the subscriber, in Gujarati, in this transaction.
    expect(h.writes.filter((w) => w.eventType === 'market.price_alert.triggered')).toHaveLength(0);
    expect(h.writes.some((w) => /alert/i.test(String(w.eventType)))).toBe(false);
    // And no trigger-log row either — the per-user "alerted today" count must not learn about a held price.
    expect(h.alerts.insertTrigger).not.toHaveBeenCalled();
    // The observation IS recorded, with its verdict, and a review row is enqueued.
    expect(h.prices.insert).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ state: 'quarantined' }));
    expect(h.prices.enqueueAnomalyReview).toHaveBeenCalledTimes(1);
  });

  it('still fires alerts for a plausible manual price', async () => {
    // The guard must not be a switch that turns the feature off: ₹6,500 against a ₹6,420 reference is 1.2% off.
    const h = priceHarness({ matching: crossed, reference: 642_000n });
    const out = await h.svc.ingest('t1', ops, 'idem-ok', {
      productId: 'p1', regionId: 'r1', priceDate: '2026-08-11', modalMinor: '650000',
      unitCode: 'quintal', source: 'ambassador_manual',
    } as any);
    expect(out.anomalyState).toBe('accepted');
    expect(out.alertsFired).toBe(1);
    expect(h.prices.enqueueAnomalyReview).not.toHaveBeenCalled();
    expect(h.alerts.insertTrigger).toHaveBeenCalledTimes(1);
  });

  it('PC-56 TENANT-12 (F-4): a price typed through the tenant API is a TENANT OBSERVATION — calling it "agmarknet" changes nothing, and it is gated', async () => {
    // Before 0190 a tenant desk could label a typed price 'agmarknet' and so skip the gate (government feeds are the reference,
    // never gated). The source is now FORCED to 'tenant_manual' and a tenant observation is always gated: the 10× typo is held.
    // (A real government feed arrives through kv_ingest, not this service — `gate()` itself still never holds agmarknet.)
    const h = priceHarness({ matching: crossed, reference: 642_000n });
    const out = await h.svc.ingest('t1', ops, 'idem-gov', {
      productId: 'p1', regionId: 'r1', priceDate: '2026-08-11', modalMinor: '6420000',
      unitCode: 'quintal', source: 'agmarknet',
    } as any);
    expect(out.source).toBe('tenant_manual');
    expect(out.tenantObservation).toBe(true);
    expect(out.anomalyState).toBe('quarantined');
    expect(out.alertsFired).toBe(0);
  });

  it('accepts a first-ever observation for a product and region', async () => {
    // No reference to judge against. Quarantining here would hold the FIRST report from every new mandi the platform
    // reaches — the districts an expanding agri platform is trying to serve, where no reviewer is staffed yet.
    const h = priceHarness({ matching: crossed, reference: null });
    const out = await h.svc.ingest('t1', ops, 'idem-first', {
      productId: 'p1', regionId: 'r1', priceDate: '2026-08-11', modalMinor: '6420000',
      unitCode: 'quintal', source: 'ambassador_manual',
    } as any);
    expect(out.anomalyState).toBe('accepted');
    expect(out.alertsFired).toBe(1);
  });

  /**
   * **AND HERE IS WHAT THE MUTATION RUN ACTUALLY TAUGHT, WHICH IS NOT WHAT I EXPECTED.**
   *
   * Deleting the early return survived. Deleting the belt-and-braces `mayFeedFarmerAlerts` check survived. Deleting BOTH
   * failed this suite. They are EQUIVALENT MUTANTS individually: with either one present, a held observation still
   * returns before the alert loop, so neither deletion changes behaviour on its own.
   *
   * That is defence in depth working exactly as intended — and it is also the ADMIN-9b lesson pointing the other way. There,
   * two layers each needed its own test because each bound a different writer. Here they are two guards on ONE path, and
   * the honest verification is that the PAIR is load-bearing, not that each half is independently observable. Pretending
   * otherwise would mean contorting the service so one guard could be seen without the other, which is a worse design in
   * exchange for a tidier mutation report.
   *
   * What this test adds is the property that distinguishes the two guards: the FIRST one also records the review row, so
   * removing it alone leaves a held price invisible to the queue. That is observable, and it is asserted above.
   */
  it('records the verdict on the price-ingested event too', async () => {
    // The outbox event carries the state, so any downstream consumer (analytics, the tenant's own feed) learns that this
    // observation is held rather than having to re-derive it.
    const h = priceHarness({ reference: 642_000n });
    await h.svc.ingest('t1', ops, 'idem-evt', {
      productId: 'p1', regionId: 'r1', priceDate: '2026-08-11', modalMinor: '6420000',
      unitCode: 'quintal', source: 'ambassador_manual',
    } as any);
    const ingested = h.writes.find((w) => /price/i.test(String(w.eventType)));
    expect(ingested?.payload).toMatchObject({ anomalyState: 'quarantined', deviationBp: 90_000 });
  });
});

describe('MandiPriceService.ingest', () => {
  it('requires market.manage', async () => {
    const h = priceHarness();
    await expect(h.svc.ingest('t1', learner, 'idem-1', { productId: 'p1', priceDate: '2026-06-20', modalMinor: '250000', unitCode: 'quintal', source: 'ambassador_manual' } as any)).rejects.toBeInstanceOf(MarketForbiddenError);
  });
  it('fires only the crossed alerts (one event each) + a PriceIngested event', async () => {
    const h = priceHarness({ matching: [alert('above', 200000n), alert('above', 900000n), alert('below', 300000n)] });
    const out = await h.svc.ingest('t1', ops, 'idem-2', { regionId: 'r1', productId: 'p1', priceDate: '2026-06-20', modalMinor: '250000', unitCode: 'quintal', source: 'agmarknet' } as any);
    // modal 250000: above@200000 ✓, above@900000 ✗, below@300000 ✓ → 2 fired
    expect(out.alertsFired).toBe(2);
    expect(h.writes.filter((e) => e.eventType === 'market.price_alert_triggered')).toHaveLength(2);
    expect(h.writes.some((e) => e.eventType === 'market.price_ingested')).toBe(true);
    // P1-3: the trigger-log append runs once per CROSSED alert, in the same tx as the outbox event.
    expect(h.alerts.insertTrigger).toHaveBeenCalledTimes(2);
  });
});

describe('PricePredictionService.generate', () => {
  function predHarness(modals: bigint[]) {
    const tx = { query: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const predictions = { insert: jest.fn(), latest: jest.fn() };
    const prices = { recentModals: jest.fn(async () => modals) };
    const svc = new PricePredictionService(uow as any, outbox as any, metrics as any, predictions as any, prices as any);
    return { svc, predictions };
  }
  it('requires market.manage', async () => {
    const h = predHarness([1n, 2n, 3n]);
    await expect(h.svc.generate('t1', learner, { productId: 'p1', regionId: 'r1', targetDate: '2026-06-25', lookbackDays: 90 } as any)).rejects.toBeInstanceOf(MarketForbiddenError);
  });
  it('PC-56 TENANT-12 (F-4 / F-1): REFUSES to type a band from the tenant API (409) and writes nothing', async () => {
    const h = predHarness([100n, 200n, 300n, 400n, 500n]);
    await expect(h.svc.generate('t1', ops, { productId: 'p1', regionId: 'r1', targetDate: '2026-06-25', lookbackDays: 90 } as any))
      .rejects.toMatchObject({ code: 'MARKET_PREDICTION_REFUSED', httpStatus: 409 });
    expect(h.predictions.insert).not.toHaveBeenCalled();
  });
});

describe('PriceAlertService.setActive', () => {
  it('404s a non-owner (no IDOR)', async () => {
    const tx = { query: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const repo = { getForUpdate: jest.fn(async () => alert('above', 100n, 'someone-else')), update: jest.fn() };
    const svc = new PriceAlertService(uow as any, { write: jest.fn() } as any, { inc: jest.fn(), observe: jest.fn() } as any, repo as any);
    await expect(svc.setActive('t1', learner, 'al-above-100', false)).rejects.toBeInstanceOf(PriceAlertNotFoundError);
  });
});
