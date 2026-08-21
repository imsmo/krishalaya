// modules/dairy/__tests__/tenant6b1-quality-hold.spec.ts · PC-56 TENANT-6b-1.
//
// W168's three promises about a flagged pour, and the premium band it advertises, held as tests:
//   • *"Rate card holds this pour's payment only; the member's other pours pay normally."*  → the hold
//   • *"Flag decisions are recorded."*                                                       → the review
//   • *"Repeat pattern (3+ in 90d) → dairy committee review."*                               → the count
//   • *"Bonus slab: fat ≥ 6.5 → +₹0.50/L"*                                                   → the engine
//
// Every one of them was absent: the flagged pour was billed and PAID at full price, nothing recorded a re-test or an
// outcome, nothing counted a pattern, and `bonus_rules` was read by nothing at all.
import { MilkCollection } from '../domain/milk-collection.entity';
import { MilkQualityReview } from '../domain/milk-quality-review.entity';
import { MilkRateCard, parseBonusSlabs, BonusSlab } from '../domain/milk-rate-card.entity';
import { InvalidRateCardError, InvalidCollectionError } from '../domain/dairy.errors';
import { DairyEventType } from '../domain/dairy.events';
import {
  BILLABLE_HOLD_STATES, COMMITTEE_REVIEW_THRESHOLD, COMMITTEE_REVIEW_WINDOW_DAYS, HOLD_STATES, REVIEW_STATUSES,
  assertHoldTransition, assertReviewTransition, canHoldTransition, canReviewTransition, holdFor, isBillable,
  isReviewDecided, needsCommitteeReview,
} from '../domain/milk-quality.state';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';

/* --------------------------------------------------------------------------------------------------------- */
const NOTICE = { outcome: { en: 'cleared', hi: 'theek paya gaya', gu: 'પાસ થયું' } };
const pour = (o: Partial<Parameters<typeof MilkCollection.record>[0]> = {}) => MilkCollection.record({
  id: 'c1', tenantId: 't1', mccId: 'm1', membershipId: 'mem1', shift: 'morning', collectedOn: '2026-07-13',
  weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n, density: null,
  waterFlag: false, adulterationFlags: [], rateCardId: 'rc1',
  amountMinor: 57_100n, bonusMinor: 0n, bonusApplied: false, enteredBy: 'op1', ...o,
});

const card = (o: { model?: 'two_axis' | 'fat_pooled' | 'snf_pooled'; slabs?: BonusSlab[]; base?: bigint | null } = {}) =>
  MilkRateCard.create({
    id: 'rc1', tenantId: 't1', defaultName: 'Buffalo two_axis v4', animalType: 'buffalo',
    pricingModel: o.model ?? 'two_axis', ratePerKgFatMinor: 72_000n, ratePerKgSnfMinor: 34_000n,
    baseRatePerLitreMinor: o.base ?? null, bonusSlabs: o.slabs, effectiveFrom: '2026-07-01', effectiveTo: null,
  });

const review = (o: Partial<Parameters<typeof MilkQualityReview.open>[0]> = {}, farmer: string | null = 'farmer1') =>
  MilkQualityReview.open({
    id: 'qr1', tenantId: 't1', collectionId: 'c1', collectedOn: '2026-07-13', membershipId: 'mem1', mccId: 'm1',
    shift: 'morning', waterFlag: true, reasons: [], densityAtFlag: '1.024', fatPctAtFlag: '6.20', snfPctAtFlag: '8.40',
    amountWithheldMinor: 57_100n, currencyCode: 'INR', openedBy: 'op1', priorReviews90d: 0, ...o,
  }, farmer, { mcc: 'Vanthali', shift: { en: 'evening', hi: 'shaam', gu: 'સાંજ' } });

/** A repository over a fake replica that records the SQL it was asked to run. */
function capturing(rowsFor: (sql: string) => unknown[] = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: rowsFor(sql), rowCount: rowsFor(sql).length }; });
  return {
    reviews: new MilkQualityReviewRepository({ forTenant: () => ({ query }) } as never),
    collections: new MilkCollectionRepository({ forTenant: () => ({ query }) } as never),
    tx: { query } as never,
    calls, sqlOf: (n: string) => calls.find((c) => c.sql.includes(n)),
  };
}

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the pour that used to be paid for anyway', () => {
  it('holds a pour the moment it is flagged, without the caller having to remember', () => {
    expect(pour({ waterFlag: true }).holdState).toBe('held');
    expect(pour({ adulterationFlags: ['starch'] }).holdState).toBe('held');
    expect(pour({ waterFlag: true, adulterationFlags: ['urea'] }).holdState).toBe('held');
  });

  it('leaves a clean pour alone — the hold is for flags, not for caution', () => {
    expect(pour().holdState).toBe('none');
    expect(pour().isFlagged).toBe(false);
  });

  it('does not treat an empty-string flag as a reason to withhold a family\'s money', () => {
    expect(pour({ adulterationFlags: [''] }).holdState).toBe('none');
  });

  it('bills only the pours whose money is the cooperative\'s to move', () => {
    expect([...BILLABLE_HOLD_STATES]).toEqual(['none', 'released']);
    expect(HOLD_STATES.filter(isBillable)).toEqual(['none', 'released']);
    expect(isBillable('held')).toBe(false);
    expect(isBillable('rejected')).toBe(false);
  });

  it('moves a hold only along the machine — a released pour cannot be re-held behind the member\'s back', () => {
    expect(canHoldTransition('none', 'held')).toBe(true);
    expect(canHoldTransition('held', 'released')).toBe(true);
    expect(canHoldTransition('held', 'rejected')).toBe(true);
    expect(canHoldTransition('released', 'held')).toBe(false);
    expect(canHoldTransition('rejected', 'released')).toBe(false);
    expect(canHoldTransition('none', 'released')).toBe(false);
    expect(() => assertHoldTransition('released', 'held')).toThrow(/HOLD_ILLEGAL_TRANSITION|Cannot move/);
  });

  /* [MUTATION GAP] `moveHold` is the only way the pour's hold may change (Law 5), and nothing exercised it — so
   * removing the assertion inside it survived, which would let a caller assign any hold it liked. */
  it('moves the pour\'s hold ONLY through the machine', () => {
    const p = pour({ waterFlag: true });
    p.moveHold('released');
    expect(p.holdState).toBe('released');
    expect(() => p.moveHold('held')).toThrow(/HOLD_ILLEGAL_TRANSITION|Cannot move/);

    const clean = pour();
    expect(() => clean.moveHold('released')).toThrow(/HOLD_ILLEGAL_TRANSITION|Cannot move/);
    expect(clean.holdState).toBe('none');                  // …and the refusal left it untouched

    const rejected = pour({ adulterationFlags: ['urea'] });
    rejected.moveHold('rejected');
    expect(() => rejected.moveHold('released')).toThrow(/HOLD_ILLEGAL_TRANSITION|Cannot move/);
  });

  it('refuses a bonus larger than the price it is part of', () => {
    expect(() => pour({ amountMinor: 100n, bonusMinor: 101n, bonusApplied: true })).toThrow(InvalidCollectionError);
    expect(() => pour({ bonusMinor: -1n })).toThrow(InvalidCollectionError);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the review that records what humans did', () => {
  it('needs a reason: money is not withheld on a flag with nothing behind it', () => {
    expect(() => review({ waterFlag: false, reasons: [] })).toThrow(InvalidCollectionError);
    expect(() => review({ waterFlag: false, reasons: [''] })).toThrow(InvalidCollectionError);
    expect(review({ waterFlag: false, reasons: ['starch'] }).toJSON().reasons).toEqual(['starch']);
    // [MUTATION GAP] The stored array must also be CLEANED, not merely non-empty: a nameless flag beside a real one
    // would reach a committee as a reason somebody has to interpret.
    expect(review({ waterFlag: false, reasons: ['starch', '', 'urea'] }).toJSON().reasons).toEqual(['starch', 'urea']);
    expect(review({ waterFlag: true, reasons: [''] }).toJSON().reasons).toEqual([]);
  });

  /* [MUTATION GAP] Nothing asserted the withheld amount's floor, so a negative figure could be recorded against a
   * member — a "hold" that owes them money. */
  it('refuses a negative withheld amount', () => {
    expect(() => review({ amountWithheldMinor: -1n })).toThrow(InvalidCollectionError);
    expect(review({ amountWithheldMinor: 0n }).toJSON().amountWithheldMinor).toBe('0');
  });

  it('opens held, with the pour\'s own evidence copied onto it', () => {
    const j = review({ reasons: ['water_flag'] }).toJSON();
    expect(j.status).toBe('open');
    expect(j.holdState).toBe('held');
    expect(j.densityAtFlag).toBe('1.024');       // W168's "density 1.024 (low)"
    expect(j.fatPctAtFlag).toBe('6.20');
    expect(j.amountWithheldMinor).toBe('57100');
  });

  it('does not claim the sample was sealed until somebody says so', () => {
    const r = review();
    expect(r.toJSON().sampleSealed).toBe(false);
    r.markSampleSealed();
    expect(r.toJSON().sampleSealed).toBe(true);
  });

  it('carries the FARMER\'s user id in the opened event, so the promised message has a recipient', () => {
    // ADMIN-6b's finding: a notification map row pointing at a payload with no recipient looks like a fix and sends
    // nothing. W168 promises "member notified in Gujarati", so the id travels with the event.
    const e = review().pullEvents();
    expect(e.map((x) => x.type)).toEqual([DairyEventType.QualityFlagOpened]);
    expect(e[0].payload.userId).toBe('farmer1');
    expect(e[0].payload.amountWithheldMinor).toBe('57100');
    expect(e[0].payload.windowDays).toBe(COMMITTEE_REVIEW_WINDOW_DAYS);
  });

  it('still opens the review when the membership has no user to notify — the hold does not wait for a phone', () => {
    const r = review({}, null);
    expect(r.toJSON().status).toBe('open');
    expect(r.pullEvents()[0].payload.userId).toBeNull();
  });

  it('records the re-test with WHO, WHEN and whether the member was actually there', () => {
    const r = review();
    r.pullEvents();
    r.retest('op2', new Date('2026-07-13T17:30:00Z'), true, 'member watched the second run');
    const j = r.toJSON();
    expect(j.status).toBe('retested');
    expect(j.retestBy).toBe('op2');
    expect(j.memberPresent).toBe(true);
    expect(j.retestAt).toBe('2026-07-13T17:30:00.000Z');
    expect(j.holdState).toBe('held');            // tested is not cleared: money does not move yet
  });

  it('records a re-test the member did NOT attend as exactly that, rather than assuming presence', () => {
    const r = review();
    r.retest('op2', new Date('2026-07-13T17:30:00Z'), false, null);
    expect(r.toJSON().memberPresent).toBe(false);
  });

  it('releases the pour when the sample is cleared, and never pays it when it is rejected', () => {
    const cleared = review(); cleared.pullEvents();
    cleared.decide('cleared', 'sec1', new Date('2026-07-14T05:00:00Z'), 'rain water in the can', 'farmer-1', NOTICE);
    expect(cleared.toJSON().holdState).toBe('released');
    expect(isBillable(cleared.holdState)).toBe(true);

    const rejected = review(); rejected.pullEvents();
    rejected.decide('rejected', 'sec1', new Date('2026-07-14T05:00:00Z'), null, 'farmer-1', NOTICE);
    expect(rejected.toJSON().holdState).toBe('rejected');
    expect(isBillable(rejected.holdState)).toBe(false);
  });

  it('emits the decision with its outcome and whether a re-test actually happened', () => {
    const r = review(); r.pullEvents();
    r.decide('cleared', 'sec1', new Date(), null, 'farmer-1', NOTICE);
    const e = r.pullEvents();
    expect(e[0].type).toBe(DairyEventType.QualityFlagDecided);
    expect(e[0].payload).toMatchObject({ outcomeCode: 'cleared', holdState: 'released', retested: false, memberPresent: null });
    // [PC-56 TENANT-6d-7] `{{outcome}}` is the WORD in the member's own language; the enum kept a name of its own.
    expect(e[0].payload.outcome).toMatchObject({ gu: 'પાસ થયું' });
    expect(e[0].payload.userId).toBe('farmer-1');
  });

  it('lets a decision be taken without a re-test, but never hides that it was', () => {
    const r = review();
    r.decide('rejected', 'sec1', new Date(), 'member said so at the counter', 'farmer-1', NOTICE);
    const j = r.toJSON();
    expect(j.status).toBe('rejected');
    expect(j.retestAt).toBeNull();               // the skipped step stays visible
    expect(j.decidedBy).toBe('sec1');
  });

  it('refuses to reopen or re-decide: a reversal is a new dispute, not an edit to the old one', () => {
    const r = review();
    r.decide('cleared', 'sec1', new Date(), null, 'farmer-1', NOTICE);
    expect(() => r.decide('rejected', 'sec2', new Date(), null, 'farmer-1', NOTICE)).toThrow(/ILLEGAL_TRANSITION|Cannot move/);
    expect(() => r.retest('op2', new Date(), true, null)).toThrow(/ILLEGAL_TRANSITION|Cannot move/);
    expect(canReviewTransition('cleared', 'open')).toBe(false);
    expect(canReviewTransition('retested', 'open')).toBe(false);
    expect(() => assertReviewTransition('rejected', 'cleared')).toThrow();
  });

  /**
   * [MUTATION NOTE] `MilkQualityService.decide` passes `holdFor(before)` as the compare-and-set value, and replacing it
   * with a literal `'held'` is currently INDISTINGUISHABLE — because every status a decision is legal from implies a
   * held pour. That equivalence is the thing worth pinning: it is what makes the literal look harmless, and it would
   * stop being true the moment the review machine allowed deciding from a decided state. Then the literal would move a
   * RELEASED pour on a stale request, and this test is what fails first.
   */
  it('invariant: every status a decision is legal FROM implies a held pour', () => {
    const decidableFrom = REVIEW_STATUSES.filter((s) => canReviewTransition(s, 'cleared') || canReviewTransition(s, 'rejected'));
    expect(decidableFrom).toEqual(['open', 'retested']);
    for (const s of decidableFrom) expect(holdFor(s)).toBe('held');
  });

  it('keeps the review status and the pour\'s hold in step through ONE function', () => {
    expect(holdFor('open')).toBe('held');
    expect(holdFor('retested')).toBe('held');
    expect(holdFor('cleared')).toBe('released');
    expect(holdFor('rejected')).toBe('rejected');
    expect(REVIEW_STATUSES.filter(isReviewDecided)).toEqual(['cleared', 'rejected']);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the repeat pattern W168 counts', () => {
  it('flags a committee review on the THIRD flag in the window, not the third prior', () => {
    expect(COMMITTEE_REVIEW_THRESHOLD).toBe(3);
    expect(needsCommitteeReview(0)).toBe(false);      // first ever
    expect(needsCommitteeReview(1)).toBe(false);      // second
    expect(needsCommitteeReview(2)).toBe(true);       // third → "3+ in 90d"
    expect(needsCommitteeReview(9)).toBe(true);
  });

  it('stamps the count and the requirement onto the review when it opens', () => {
    const j = review({ priorReviews90d: 2 }).toJSON();
    expect(j.priorReviews90d).toBe(2);
    expect(j.committeeReviewRequired).toBe(true);
    expect(review({ priorReviews90d: 1 }).toJSON().committeeReviewRequired).toBe(false);
  });

  it('counts the window in the DATABASE\'s 90 days, over reviews OPENED', async () => {
    const { reviews, tx, sqlOf } = capturing((sql) => (sql.includes('count(*)') ? [{ n: 2 }] : []));
    expect(await reviews.priorReviews90d(tx, 't1', 'mem1')).toBe(2);
    const q = sqlOf('milk_quality_reviews')!;
    expect(q.sql).toContain("opened_at >= now() - ($3 || ' days')::interval");
    expect(q.params).toEqual(['t1', 'mem1', '90']);
    expect(q.sql).toContain('deleted_at IS NULL');
    // NOT filtered to rejected: three flags in three weeks is a pattern even if two were cleared, and a committee that
    // only sees confirmed cases cannot notice a centre whose analyzer is drifting.
    expect(q.sql).not.toMatch(/status\s*=/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the premium band the engine never applied', () => {
  const slab: BonusSlab = { metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 };

  it('prices W168\'s own worked example, to the paisa', () => {
    // W168: "7.1 L @ fat 6.8 / SNF 9.1 → fat 0.483 kg x Rs 720 + SNF 0.646 kg x Rs 340 + bonus ~= Rs 571".
    // 7.1kg x 6.80% = 0.4828kg fat x 72000 = 34,761.6 → 34,762 minor (rounded half up)
    // 7.1kg x 9.10% = 0.6461kg snf x 34000 = 21,967.4 → 21,967 minor
    // bonus 7.1 L x 50 = 355 minor
    const c = card({ slabs: [slab] });
    expect(c.priceMinor(7_100n, 680n, 910n, false)).toBe(34_762n + 21_967n);
    expect(c.bonusMinor(7_100n, 680n, 910n)).toBe(355n);
    expect(c.priceMinor(7_100n, 680n, 910n, true)).toBe(34_762n + 21_967n + 355n);
    // The canon's own "≈ ₹571" — 57,084 paisa with the bonus.
    expect(c.priceMinor(7_100n, 680n, 910n, true)).toBe(57_084n);
  });

  it('pays NOTHING extra when the slabs are not applied — which is the state the platform shipped in for a year', () => {
    const c = card({ slabs: [slab] });
    expect(c.priceMinor(7_100n, 680n, 910n)).toBe(c.priceMinor(7_100n, 680n, 910n, false));
    expect(c.hasBonusSlabs).toBe(true);          // the card PROMISES it, which is why the desk must say so
  });

  it('includes a pour that reads EXACTLY the threshold — "fat >= 6.5" is the canon\'s own wording', () => {
    const c = card({ slabs: [slab] });
    expect(c.bonusMinor(10_000n, 650n, 900n)).toBe(500n);   // 6.50 is IN the band
    expect(c.bonusMinor(10_000n, 649n, 900n)).toBe(0n);     // 6.49 is not
    expect(c.slabsEarned(650n, 900n)).toEqual([slab]);
    expect(c.slabsEarned(649n, 900n)).toEqual([]);
  });

  it('adds a fat slab and an snf slab together, because they are two separate promises', () => {
    const c = card({ slabs: [slab, { metric: 'snf', minCentiPct: 900, bonusMinorPerLitre: 25 }] });
    expect(c.bonusMinor(10_000n, 680n, 910n)).toBe(500n + 250n);
    expect(c.bonusMinor(10_000n, 680n, 890n)).toBe(500n);
    expect(c.slabsEarned(680n, 910n)).toHaveLength(2);
  });

  it('stacks two thresholds on one metric, and the desk shows WHICH slabs paid', () => {
    const c = card({ slabs: [{ metric: 'fat', minCentiPct: 600, bonusMinorPerLitre: 25 }, slab] });
    expect(c.bonusMinor(10_000n, 680n, 900n)).toBe(250n + 500n);
    expect(c.slabsEarned(680n, 900n).map((s) => s.minCentiPct)).toEqual([600, 650]);
    expect(c.slabsEarned(620n, 900n).map((s) => s.minCentiPct)).toEqual([600]);
  });

  it('rounds the premium half up in integer arithmetic, never through a float', () => {
    const c = card({ slabs: [{ metric: 'fat', minCentiPct: 1, bonusMinorPerLitre: 50 }] });
    expect(c.bonusMinor(1_500n, 680n, 900n)).toBe(75n);      // 1.5 L × 50 = 75 exactly
    expect(c.bonusMinor(1_510n, 680n, 900n)).toBe(76n);      // 75.5 → 76, half UP
    expect(c.bonusMinor(1_509n, 680n, 900n)).toBe(75n);      // 75.45 → 75
  });

  it('refuses a slab on an axis the card does not price', () => {
    expect(() => card({ model: 'snf_pooled', slabs: [slab] })).toThrow(InvalidRateCardError);
    expect(() => card({ model: 'fat_pooled', slabs: [{ metric: 'snf', minCentiPct: 900, bonusMinorPerLitre: 25 }] })).toThrow(InvalidRateCardError);
    expect(() => card({ model: 'fat_pooled', slabs: [slab] })).not.toThrow();
  });

  it('refuses two slabs at the same threshold, because additive slabs would DOUBLE the premium silently', () => {
    expect(() => card({ slabs: [slab, { ...slab, bonusMinorPerLitre: 10 }] })).toThrow(/duplicate bonus slab/);
    expect(() => card({ slabs: [slab, { metric: 'snf', minCentiPct: 650, bonusMinorPerLitre: 10 }] })).not.toThrow();
  });

  it('parses the jsonb column strictly — a malformed slab THROWS rather than vanishing into a filter', () => {
    expect(parseBonusSlabs(null)).toEqual([]);
    expect(parseBonusSlabs([])).toEqual([]);
    expect(parseBonusSlabs([{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }])).toEqual([slab]);
    expect(() => parseBonusSlabs({})).toThrow(InvalidRateCardError);
    expect(() => parseBonusSlabs([{ metric: 'protein', minCentiPct: 650, bonusMinorPerLitre: 50 }])).toThrow(InvalidRateCardError);
    expect(() => parseBonusSlabs([{ metric: 'fat', minCentiPct: 6.5, bonusMinorPerLitre: 50 }])).toThrow(InvalidRateCardError);
    expect(() => parseBonusSlabs([{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 0 }])).toThrow(InvalidRateCardError);
    expect(() => parseBonusSlabs([{ metric: 'fat', minCentiPct: 0, bonusMinorPerLitre: 50 }])).toThrow(InvalidRateCardError);
  });

  it('a card with no slabs prices exactly as it always did', () => {
    const c = card();
    expect(c.hasBonusSlabs).toBe(false);
    expect(c.bonusMinor(7_100n, 680n, 910n)).toBe(0n);
    expect(c.priceMinor(7_100n, 680n, 910n, true)).toBe(c.priceMinor(7_100n, 680n, 910n, false));
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-1 · the SQL that stopped paying for water', () => {
  it('excludes held and rejected pours from a bill, and REPORTS what it excluded', async () => {
    const rows = [
      { id: 'a', collected_on: '2026-07-13', weight_kg: '10.000', amount_minor: '50000', bonus_minor: '500', hold_state: 'none' },
      { id: 'b', collected_on: '2026-07-14', weight_kg: '6.200', amount_minor: '31000', bonus_minor: '0', hold_state: 'held' },
      { id: 'c', collected_on: '2026-07-15', weight_kg: '8.000', amount_minor: '40000', bonus_minor: '0', hold_state: 'released' },
      { id: 'd', collected_on: '2026-07-16', weight_kg: '9.000', amount_minor: '45000', bonus_minor: '0', hold_state: 'rejected' },
    ];
    const { collections, tx } = capturing((sql) => (sql.includes('FOR UPDATE') ? rows : []));
    const agg = await collections.aggregateUnbilledForUpdate(tx, 't1', 'mem1', '2026-07-01', '2026-07-15');
    expect(agg.count).toBe(2);                                   // a and c only
    expect(agg.ids.map((i) => i.id)).toEqual(['a', 'c']);
    expect(agg.grossMinor).toBe(90_000n);                        // NOT 166,000 — the old query paid for all four
    expect(agg.bonusMinor).toBe(500n);
    expect(agg.heldCount).toBe(2);
    expect(agg.heldMinor).toBe(76_000n);                         // named, so "empty bill" can be told from "all held"
    expect(agg.totalWeightMilliKg).toBe(18_000n);
  });

  it('treats a NULL hold state as billable, so a row written before 0156 is unaffected', async () => {
    const { collections, tx } = capturing((sql) => (sql.includes('FOR UPDATE')
      ? [{ id: 'a', collected_on: '2026-07-13', weight_kg: '1.000', amount_minor: '100', bonus_minor: null, hold_state: null }] : []));
    const agg = await collections.aggregateUnbilledForUpdate(tx, 't1', 'mem1', '2026-07-01', '2026-07-15');
    expect(agg.count).toBe(1);
    expect(agg.heldCount).toBe(0);
  });

  it('moves a hold with the EXPECTED previous state in the predicate, so a concurrent decision loses loudly', async () => {
    const { collections, tx, sqlOf } = capturing((sql) => (sql.includes('SET hold_state') ? [{}] : []));
    await collections.setHoldState(tx, 't1', { id: 'c1', collectedOn: '2026-07-13' }, 'released', 'held');
    const q = sqlOf('SET hold_state')!;
    expect(q.sql).toContain('AND collected_on=$2::date');        // the partition key, so the row is reachable
    expect(q.sql).toContain('AND hold_state=$4');                // the compare-and-set
    expect(q.params).toEqual(['c1', '2026-07-13', 't1', 'held', 'released']);
  });

  it('FAILS CLOSED when a hold move matches no row', async () => {
    const { collections, tx } = capturing(() => []);
    await expect(collections.setHoldState(tx, 't1', { id: 'c1', collectedOn: '2026-07-13' }, 'released', 'held'))
      .rejects.toThrow(/COLLECTION_STAMP_LOST|matched no collection row/);
  });

  it('FAILS CLOSED when the bill-attach stamp matches no row — the proven double-payment', async () => {
    const { collections, tx } = capturing(() => []);
    await expect(collections.attachToBill(tx, 't1', [{ id: 'c1', collectedOn: '2026-07-13' }], 'bill1'))
      .rejects.toThrow(/COLLECTION_STAMP_LOST|matched no collection row/);
  });

  /* [MUTATION GAP] The caller read the row FOR UPDATE in this same transaction, so a zero-row update means the
   * predicate is wrong — and passing silently would move the pour's hold while its record stayed behind. */
  it('FAILS CLOSED when the review update matches no row', async () => {
    const { reviews, tx } = capturing(() => []);
    await expect(reviews.update(tx, 't1', review())).rejects.toThrow(/vanished mid-transaction/);
  });

  it('writes the review in the same shape the desk reads it, reaching the pour by its partition day', async () => {
    const { reviews, tx, sqlOf } = capturing();
    await reviews.insert(tx, review({ reasons: ['urea'] }));
    const q = sqlOf('INSERT INTO milk_quality_reviews')!;
    expect(q.sql).toContain('$4::date');                          // collected_on cast, so the FK matches the partition
    expect(q.sql).toContain('$9::jsonb');                         // reasons as a real array
    expect(q.params).toContain('1.024');
    expect(q.params).toContain('57100');
  });

  it('lists the working queue as open PLUS re-tested — the pours whose money is held right now', async () => {
    const { reviews, sqlOf } = capturing();
    await reviews.listFor('t1', { status: 'open_any', limit: 50 });
    const sql = sqlOf('FROM milk_quality_reviews')!.sql;
    expect(sql).toContain("status IN ('open','retested')");
    expect(sql).toContain('ORDER BY opened_at DESC, id DESC');
  });

  it('clamps the review page so one bad cycle cannot ask for everything', async () => {
    const { reviews, sqlOf } = capturing();
    await reviews.listFor('t1', { limit: 10_000 });
    // Clamped as a BOUND PARAMETER, not interpolated: the value is asserted rather than the SQL text, because a test
    // that greps for "LIMIT 100" would pass on a statement that never binds it.
    expect(sqlOf('FROM milk_quality_reviews')!.params).toContain(100);
    await reviews.listFor('t1', { limit: 0 });
    expect(sqlOf('FROM milk_quality_reviews')!.params).toContain(100);   // first call's params, still 100
  });

  it('counts the cycle\'s flags by status and by reason, keeping water separate', async () => {
    const { reviews, sqlOf } = capturing((sql) => {
      if (sql.includes('GROUP BY status')) return [{ status: 'open', n: 1, withheld: '31000' }, { status: 'rejected', n: 1, withheld: '0' }];
      if (sql.includes('jsonb_array_elements_text')) return [{ reason: 'starch', n: 1 }];
      if (sql.includes('water_flag = true')) return [{ n: 3 }];
      return [];
    });
    const out = await reviews.countsForWindow('t1', '2026-07-01', '2026-07-15');
    expect(out.total).toBe(2);
    expect(out.byStatus).toEqual({ open: 1, rejected: 1 });
    expect(out.byReason).toEqual({ starch: 1, water_flag: 3 });   // W168's "3 water_flag · 1 starch"
    expect(out.withheldMinor).toBe(31_000n);                      // only what is STILL held
    expect(sqlOf('jsonb_array_elements_text')!.sql).toContain('LIMIT 20');
    // [MUTATION GAP] The fake answers regardless of the SQL, so the FILTER that makes "withheld" mean STILL-withheld
    // has to be asserted on the statement — without it the tile would add back money already released or written off.
    expect(sqlOf('GROUP BY status')!.sql).toContain("FILTER (WHERE status IN ('open','retested'))");
  });
});
