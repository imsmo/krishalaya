// modules/dairy/__tests__/tenant6b1-quality-services.spec.ts · PC-56 TENANT-6b-1, the WIRING.
//
// The live suite proves this against real Postgres, and the mutation pass showed why that is not enough: every decision
// made in a SERVICE — does the flag gate the premium, does a flagged pour get its review, does the decision move the
// pour's money, does the caller's slab list survive the trip — had no fast test at all, so flipping any of them stayed
// green. This file is those decisions, with fakes in place of the database.
//
// One of them was a REAL defect the live run caught: `MilkRateCardService.create` never passed `bonusSlabs` to the
// entity, so every card came back with `bonus_rules = []` and W168's premium band still paid nothing. The DTO accepted
// it, the domain priced it, the repository persisted it — and the service in between dropped the caller's answer.
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkQualityService } from '../services/milk-quality.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkRateCard } from '../domain/milk-rate-card.entity';
import { MilkQualityReview } from '../domain/milk-quality-review.entity';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';

const actor = { userId: 'op1', canManage: true };
const tenantId = 't1';
const DAY = '2026-07-13';

/* --------------------------------------------------------------------------------------------------------- */
/* FAKES — just enough of each collaborator to make the service's own decisions observable.                  */
/* --------------------------------------------------------------------------------------------------------- */

const uow = { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: async () => ({ rows: [], rowCount: 1 }) }) };
const idem = { remember: async (_k: string, _u: string, _s: string, fn: () => unknown) => fn() };
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

const membership = (o: { farmerUserId?: string | null } = {}) => DairyMembership.rehydrate({
  id: 'mem1', tenantId, farmerUserId: o.farmerUserId ?? 'farmer1', mccId: 'm1', memberCode: 'C-001',
  paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo', isActive: true,
} as never);

const cardWith = (slabs: Array<{ metric: 'fat' | 'snf'; minCentiPct: number; bonusMinorPerLitre: number }>) =>
  MilkRateCard.create({
    id: 'rc1', tenantId, defaultName: 'Buffalo v4', animalType: 'buffalo', pricingModel: 'two_axis',
    ratePerKgFatMinor: 72_000n, ratePerKgSnfMinor: 34_000n, baseRatePerLitreMinor: null,
    bonusSlabs: slabs, effectiveFrom: '2026-07-01', effectiveTo: null,
  });

const POUR = { membershipId: 'mem1', shift: 'morning', collectedOn: DAY, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] as string[] };

function recordHarness(o: { slabs?: Array<{ metric: 'fat' | 'snf'; minCentiPct: number; bonusMinorPerLitre: number }>; flagOn?: boolean; priors?: number; farmerUserId?: string | null } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const reviewsInserted: MilkQualityReview[] = [];
  const outbox: Array<{ aggregateType: string; eventType: string; payload: Record<string, unknown> }> = [];
  const flagAsked: string[] = [];

  const repo = { insert: jest.fn(async (_tx: unknown, c: { toProps(): Record<string, unknown> }) => { inserted.push(c.toProps()); }) };
  const rateCards = { resolveActive: jest.fn(async () => cardWith(o.slabs ?? [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }])) };
  const memberships = { getById: jest.fn(async () => membership({ farmerUserId: o.farmerUserId })) };
  const reviews = {
    priorReviews90d: jest.fn(async () => o.priors ?? 0),
    insert: jest.fn(async (_tx: unknown, r: MilkQualityReview) => { reviewsInserted.push(r); }),
  };
  const flags = { isEnabled: jest.fn(async (key: string) => { flagAsked.push(key); return o.flagOn === true; }) };
  const outboxWriter = { write: jest.fn(async (_tx: unknown, e: { aggregateType: string; eventType: string; payload: Record<string, unknown> }) => { outbox.push(e); }) };

  const svc = new MilkCollectionService(uow as never, outboxWriter as never, idem as never, metrics as never,
    repo as never, rateCards as never, memberships as never, reviews as never, flags as never);
  return { svc, inserted, reviewsInserted, outbox, flagAsked, flags, reviews, repo };
}

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · recording a pour: the flag, the hold, and the review', () => {
  it('asks the BONUS flag before applying a premium, and does not apply it when the answer is no', async () => {
    const h = recordHarness({ flagOn: false });
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR } as never);
    expect(h.flagAsked).toContain(BONUS_SLABS_FLAG);
    expect(h.flags.isEnabled).toHaveBeenCalledWith(BONUS_SLABS_FLAG, { tenantId, userId: 'op1' });
    expect(out.bonusMinor).toBe('0');
    expect(out.bonusApplied).toBe(false);
    expect(out.amountMinor).toBe('56729');                    // 34,762 fat + 21,967 snf, no premium
  });

  it('applies the premium — and RECORDS that it did — when the tenant has switched it on', async () => {
    const h = recordHarness({ flagOn: true });
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR } as never);
    expect(out.bonusMinor).toBe('355');                       // 7.1 L × ₹0.50, W168's own slab
    expect(out.bonusApplied).toBe(true);
    expect(out.amountMinor).toBe('57084');                    // the canon's "≈ ₹571"
  });

  it('never asks the flag for a card with no slabs, and never records a premium regime it did not use', async () => {
    const h = recordHarness({ slabs: [], flagOn: true });
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR } as never);
    expect(h.flagAsked).not.toContain(BONUS_SLABS_FLAG);      // short-circuited: no slabs, nothing to ask about
    expect(out.bonusApplied).toBe(false);
    expect(out.bonusMinor).toBe('0');
  });

  it('records a premium of ZERO for a pour that cleared no slab, while still marking the regime as applied', async () => {
    const h = recordHarness({ flagOn: true });
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR, fatPct: '6.40' } as never);
    expect(out.bonusMinor).toBe('0');
    expect(out.bonusApplied).toBe(true);                      // "was my milk ever eligible?" is answerable
  });

  it('OPENS a review for a flagged pour, in the same call that holds it', async () => {
    const h = recordHarness();
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR, waterFlag: true, density: '1.024' } as never);
    expect(out.holdState).toBe('held');
    expect(h.reviewsInserted).toHaveLength(1);
    const j = h.reviewsInserted[0].toJSON();
    expect(j.status).toBe('open');
    expect(j.densityAtFlag).toBe('1.024');
    expect(j.amountWithheldMinor).toBe(out.amountMinor);      // the whole pour is what is being withheld
    expect(out.review).not.toBeNull();
  });

  it('opens NO review for a clean pour — and asks the database for no pattern count either', async () => {
    const h = recordHarness();
    const out = await h.svc.record(tenantId, actor, 'idem-1', { ...POUR } as never);
    expect(out.holdState).toBe('none');
    expect(h.reviewsInserted).toHaveLength(0);
    expect(h.reviews.priorReviews90d).not.toHaveBeenCalled();
    expect(out.review).toBeNull();
  });

  it('puts the FARMER\'s user id on the opened event, so W168\'s promised message has a recipient', async () => {
    const h = recordHarness({ farmerUserId: 'farmer-42' });
    await h.svc.record(tenantId, actor, 'idem-1', { ...POUR, adulterationFlags: ['urea'] } as never);
    const opened = h.outbox.find((e) => e.eventType === 'dairy.quality_flag_opened');
    expect(opened).toBeDefined();
    expect(opened!.payload.userId).toBe('farmer-42');
    expect(opened!.aggregateType).toBe('milk_quality_review');   // its own aggregate, not the collection's
  });

  it('carries the pattern count from the database onto the review, and asks for a committee at three', async () => {
    const h = recordHarness({ priors: 2 });
    await h.svc.record(tenantId, actor, 'idem-1', { ...POUR, waterFlag: true } as never);
    const j = h.reviewsInserted[0].toJSON();
    expect(h.reviews.priorReviews90d).toHaveBeenCalled();
    expect(j.priorReviews90d).toBe(2);
    expect(j.committeeReviewRequired).toBe(true);
  });

  it('writes the pour\'s density through to the row — the column that was dead until this wave', async () => {
    const h = recordHarness();
    await h.svc.record(tenantId, actor, 'idem-1', { ...POUR, density: '1.028' } as never);
    expect(h.inserted[0].density).toBe('1.028');
    const h2 = recordHarness();
    await h2.svc.record(tenantId, actor, 'idem-1', { ...POUR } as never);
    expect(h2.inserted[0].density).toBeNull();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · deciding a review moves the pour\'s money', () => {
  function decideHarness(status: 'open' | 'retested' = 'open') {
    const review = MilkQualityReview.open({
      id: 'qr1', tenantId, collectionId: 'c1', collectedOn: DAY, membershipId: 'mem1', mccId: 'm1', shift: 'morning',
      waterFlag: true, reasons: [], densityAtFlag: '1.024', fatPctAtFlag: '6.20', snfPctAtFlag: '8.40',
      amountWithheldMinor: 31_000n, currencyCode: 'INR', openedBy: 'op1', priorReviews90d: 0,
    }, 'farmer1');
    review.pullEvents();
    if (status === 'retested') review.retest('op2', new Date(), true, null);

    const holdMoves: Array<{ to: string; from: string; ref: { id: string; collectedOn: string } }> = [];
    const outbox: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const audits: Array<Record<string, unknown>> = [];
    const reviews = { getForUpdate: jest.fn(async () => review), update: jest.fn(async () => undefined) };
    const collections = { setHoldState: jest.fn(async (_tx: unknown, _t: string, ref: { id: string; collectedOn: string }, to: string, from: string) => { holdMoves.push({ to, from, ref }); }) };
    const outboxWriter = { write: jest.fn(async (_tx: unknown, e: { eventType: string; payload: Record<string, unknown> }) => { outbox.push(e); }) };
    const audit = { write: jest.fn(async (_tx: unknown, e: Record<string, unknown>) => { audits.push(e); }) };
    const svc = new MilkQualityService(uow as never, outboxWriter as never, idem as never, metrics as never,
      audit as never, reviews as never, collections as never);
    return { svc, review, holdMoves, outbox, audits, reviews, collections };
  }

  it('RELEASES the pour when the sample is cleared, in the same transaction as the decision', async () => {
    const h = decideHarness('retested');
    const out = await h.svc.decide(tenantId, actor, 'idem-d', 'qr1', { outcome: 'cleared', note: 'rain water' });
    expect(out.status).toBe('cleared');
    expect(h.reviews.update).toHaveBeenCalled();
    expect(h.holdMoves).toEqual([{ to: 'released', from: 'held', ref: { id: 'c1', collectedOn: DAY } }]);
  });

  it('marks the pour REJECTED when the dilution is confirmed', async () => {
    const h = decideHarness('retested');
    await h.svc.decide(tenantId, actor, 'idem-d', 'qr1', { outcome: 'rejected', note: null });
    expect(h.holdMoves[0]).toMatchObject({ to: 'rejected', from: 'held' });
  });

  it('passes the PREVIOUS hold as the compare-and-set value, so a second decision cannot overwrite the first', async () => {
    const h = decideHarness('open');
    await h.svc.decide(tenantId, actor, 'idem-d', 'qr1', { outcome: 'cleared', note: null });
    // `from` comes from the review's status BEFORE the decision, never a hardcoded 'held' — a released pour must not be
    // movable by a stale request.
    expect(h.holdMoves[0].from).toBe('held');
    expect(h.collections.setHoldState).toHaveBeenCalledTimes(1);
  });

  it('publishes the decision and audits it with both sides of the change', async () => {
    const h = decideHarness('retested');
    await h.svc.decide(tenantId, actor, 'idem-d', 'qr1', { outcome: 'cleared', note: null });
    const ev = h.outbox.find((e) => e.eventType === 'dairy.quality_flag_decided');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ outcome: 'cleared', holdState: 'released', retested: true, memberPresent: true });
    expect(h.audits[0]).toMatchObject({
      action: 'dairy.quality_review.cleared', entityType: 'milk_quality_review',
      oldValue: { status: 'retested' }, newValue: { status: 'cleared', holdState: 'released' },
    });
  });

  it('does not claim a sealed sample when the caller did not say one was sealed', async () => {
    const h = decideHarness('open');
    const out = await h.svc.retest(tenantId, actor, 'idem-r', 'qr1', { memberPresent: true });
    expect(out.sampleSealed).toBe(false);      // a PHYSICAL act this platform cannot witness stays unclaimed
  });

  it('does not move any money on a RE-TEST — a sample tested is not a sample cleared', async () => {
    const h = decideHarness('open');
    const out = await h.svc.retest(tenantId, actor, 'idem-r', 'qr1', { memberPresent: false, sampleSealed: true });
    expect(out.status).toBe('retested');
    expect(out.memberPresent).toBe(false);                     // recorded as given, never assumed
    expect(h.holdMoves).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: 'dairy.quality_review.retested', newValue: { memberPresent: false, sampleSealed: true } });
  });

  it('refuses both acts without dairy.manage', async () => {
    const h = decideHarness();
    const reader = { userId: 'u9', canManage: false };
    await expect(h.svc.decide(tenantId, reader, 'i', 'qr1', { outcome: 'cleared' })).rejects.toThrow(/DAIRY_FORBIDDEN|dairy.manage/);
    await expect(h.svc.retest(tenantId, reader, 'i', 'qr1', { memberPresent: true })).rejects.toThrow(/DAIRY_FORBIDDEN|dairy.manage/);
    expect(h.holdMoves).toEqual([]);
  });

  it('404s a review that is not this tenant\'s, without moving any pour', async () => {
    const reviews = { getForUpdate: jest.fn(async () => null), update: jest.fn() };
    const collections = { setHoldState: jest.fn() };
    const svc = new MilkQualityService(uow as never, { write: jest.fn() } as never, idem as never, metrics as never,
      { write: jest.fn() } as never, reviews as never, collections as never);
    await expect(svc.decide(tenantId, actor, 'i', 'nope', { outcome: 'cleared' })).rejects.toThrow(/QUALITY_REVIEW_NOT_FOUND|not found/);
    expect(collections.setHoldState).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the rate card keeps the slabs it was given', () => {
  function cardHarness() {
    const inserted: Array<Record<string, unknown>> = [];
    const repo = { insert: jest.fn(async (_tx: unknown, c: { toProps(): Record<string, unknown> }) => { inserted.push(c.toProps()); }) };
    const svc = new MilkRateCardService(uow as never, { write: jest.fn() } as never, idem as never, metrics as never, repo as never);
    return { svc, inserted };
  }

  /* [THE LIVE FINDING] This assertion is the one that was missing. The service built the entity without `bonusSlabs`,
   * so the caller's premium band was silently discarded and `bonus_rules` stayed `[]` — the defect the whole wave is
   * about, reintroduced one layer up. */
  it('passes the caller\'s premium slabs through to the entity, rather than dropping them', async () => {
    const h = cardHarness();
    const slabs = [{ metric: 'fat' as const, minCentiPct: 650, bonusMinorPerLitre: 50 }];
    const out = await h.svc.create(tenantId, actor, 'idem-rc', {
      defaultName: 'Buffalo v4', animalType: 'buffalo', pricingModel: 'two_axis',
      ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-07-01', bonusSlabs: slabs,
    } as never);
    expect(h.inserted[0].bonusSlabs).toEqual(slabs);
    expect(out.bonusSlabs).toEqual(slabs);
  });

  it('leaves a card with no slabs empty rather than undefined, so every reader can iterate it', async () => {
    const h = cardHarness();
    const out = await h.svc.create(tenantId, actor, 'idem-rc', {
      defaultName: 'Cow', animalType: 'cow', pricingModel: 'two_axis',
      ratePerKgFatMinor: '50000', ratePerKgSnfMinor: '30000', effectiveFrom: '2026-07-01',
    } as never);
    expect(h.inserted[0].bonusSlabs).toEqual([]);
    expect(out.bonusSlabs).toEqual([]);
  });

  it('refuses a slab the card\'s own pricing model cannot honour', async () => {
    const h = cardHarness();
    await expect(h.svc.create(tenantId, actor, 'idem-rc', {
      defaultName: 'SNF only', animalType: 'cow', pricingModel: 'snf_pooled', ratePerKgSnfMinor: '30000',
      effectiveFrom: '2026-07-01', bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }],
    } as never)).rejects.toThrow(/RATE_CARD_INVALID|prices fat/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · a bill that has nothing to bill says WHY', () => {
  function billHarness(agg: { count: number; heldCount: number; heldMinor: bigint }) {
    const collections = {
      aggregateUnbilledForUpdate: jest.fn(async () => ({
        count: agg.count, totalWeightMilliKg: 0n, grossMinor: 0n, bonusMinor: 0n,
        heldCount: agg.heldCount, heldMinor: agg.heldMinor, ids: [],
      })),
      attachToBill: jest.fn(),
    };
    const memberships = { getById: jest.fn(async () => membership()) };
    const svc = new MilkBillService(uow as never, { write: jest.fn() } as never, idem as never, metrics as never,
      { post: jest.fn() } as never, { write: jest.fn() } as never, { insert: jest.fn() } as never,
      collections as never, memberships as never, { disputeWindowHours: jest.fn(async () => 24) } as never,
      // [PC-56 TENANT-6c-4] the deduction's destination: lines, vocabulary, credits, consent, applier, flags.
      { linesForBill: jest.fn(async () => []), insert: jest.fn(), listForUpdate: jest.fn(async () => []), markApplied: jest.fn() } as never,
      { byCode: jest.fn(async () => null), byIds: jest.fn(async () => new Map()) } as never,
      { getForUpdate: jest.fn(async () => null) } as never,
      { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null), insert: jest.fn() } as never,
      { applyAll: jest.fn(async () => []) } as never,
      { isEnabled: jest.fn(async () => true) } as never);
    return { svc, collections };
  }

  it('says ALL_POURS_HELD when every unbilled pour is under review', async () => {
    const h = billHarness({ count: 0, heldCount: 3, heldMinor: 91_000n });
    await expect(h.svc.generate(tenantId, actor, 'idem-b', { membershipId: 'mem1', periodStart: DAY, periodEnd: DAY, deductions: [] } as never))
      .rejects.toMatchObject({ code: 'ALL_POURS_HELD', details: { heldCount: 3, heldMinor: '91000' } });
  });

  it('still says EMPTY_BILL when nobody poured at all — two different facts, two different errors', async () => {
    const h = billHarness({ count: 0, heldCount: 0, heldMinor: 0n });
    await expect(h.svc.generate(tenantId, actor, 'idem-b', { membershipId: 'mem1', periodStart: DAY, periodEnd: DAY, deductions: [] } as never))
      .rejects.toMatchObject({ code: 'EMPTY_BILL' });
  });
});
