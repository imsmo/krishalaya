// PC-56 TENANT-6b-2 · W168's rules as the console applies them.
//
// This suite is strict about one thing above all: the difference between a premium a member WAS PAID and a premium they
// WOULD have earned. TENANT-6b-1 made the engine capable of paying the slab W168 advertises; whether a cooperative has
// switched it on is a treasury decision, and a tile that blurred the two would put the same false promise back on the
// screen in a new place — this time in front of the people who set the rate.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DairyFlagProtocol, DairyPremiumBand, DairyQualityFlagRow, DairyRateCardsInForce, DairyStabilityVerdict,
  DairyWorkedExample,
} from '@krishalaya/sdk-js';
import {
  RATE_CARDS_HREF, animalTypeKey, cardAmbiguityKey, cardCheckerKey, cardEffectiveKey, cardSupersedeKey,
  committeeKey, densityKey, emptyKey, exampleBasisKey, exampleLines, exampleWithheldBonusKey, flagTitleParts,
  flagsClaimKey, flagsTone, holdKey, holdTone, memberLabel, memberPresentKey, nextActKey, premiumBandKey,
  premiumBandPairText, premiumBandShareText, pricingModelKey, protocolStepKey, protocolStepTone, qualityState,
  qualityStateKey, reasonKey, reasonOrder, reviewFlagsCountText, sealedKey, slabMetricKey, slabText,
  slabsNotAppliedKey, spreadText, stabilityKey, stabilityToleranceText, stabilityTone,
} from '../features/dairy/quality';
import { DAIRY_NAV, currentDairyNavKey, dairyNavLabelKey, dairyUnbuiltCount } from '../features/dairy/nav';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const FAT_SLAB = { metric: 'fat' as const, minCentiPct: 650, bonusMinorPerLitre: 50 };

const flag = (o: Partial<DairyQualityFlagRow> = {}): DairyQualityFlagRow => ({
  reviewId: 'qr1', collectionId: 'c1', collectedOn: '2026-07-13', shift: 'morning',
  mccCode: 'MCC-AND-02', memberCodeMasked: 'AND2••87',
  // [TENANT-6d-3] The card is resolved AS OF the pour now. `false` = the route history reached that day, so the code
  // above is the one that was on the card — which is the whole point of a masked identifier on this panel.
  memberCodeIsCurrent: false,
  status: 'open', holdState: 'held', waterFlag: true, reasons: [],
  densityAtFlag: '1.024', fatPctAtFlag: '6.20', snfPctAtFlag: '8.40',
  litres: null, amountWithheldMinor: '31000', sampleSealed: false, memberPresent: null,
  retestAt: null, decidedAt: null, priorReviews90d: 0, committeeReviewRequired: false, ...o,
});

const example = (o: Partial<DairyWorkedExample> = {}): DairyWorkedExample => ({
  cardId: 'rc1', litres: '7.1', fatPct: '6.80', snfPct: '9.10', fatKg: '0.483', snfKg: '0.646',
  fatMinor: '34762', snfMinor: '21967', baseMinor: '0', bonusMinor: '355', bonusApplied: true,
  slabsEarned: [FAT_SLAB], totalMinor: '57084', fromRealPour: true, ...o,
});

const cards = (o: Partial<DairyRateCardsInForce> = {}): DairyRateCardsInForce => ({
  byAnimal: [{ animalType: 'buffalo', cards: [], effectiveId: 'rc1', ambiguous: false }],
  ambiguousAnimalTypes: [], supersedeRecorded: false, checkerRequired: false, ...o,
});

const protocol = (o: Partial<DairyFlagProtocol> = {}): DairyFlagProtocol => ({
  retest: 'recorded', decision: 'recorded', committee: 'not_modelled', pourLevelHold: true, walletUntouched: true, ...o,
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the stability claim the canon states as a fact', () => {
  const measured = (fat: string, snf: string, days = 13, within = true): DairyStabilityVerdict =>
    ({ kind: 'measured', days, fatSpreadCentiPct: fat, snfSpreadCentiPct: snf, withinTolerance: within, toleranceCentiPct: 10 });

  it('reads "stable" only when the spread is inside the canon\'s own ±0.1', () => {
    expect(stabilityKey(measured('8', '4', 13, true))).toBe('dairy.quality.stability.stable');
    expect(stabilityKey(measured('40', '4', 13, false))).toBe('dairy.quality.stability.swinging');
    expect(hasKey('dairy.quality.stability.stable')).toBe(true);
    expect(hasKey('dairy.quality.stability.swinging')).toBe(true);
  });

  it('refuses the claim outright under two days rather than dressing a single day as stability', () => {
    const s: DairyStabilityVerdict = { kind: 'insufficient_days', days: 1, needed: 2 };
    expect(stabilityKey(s)).toBe('dairy.quality.stability.tooFewDays');
    expect(stabilityTone(s)).toBe('muted');
    expect(stabilityToleranceText(s)).toBeNull();
    expect(hasKey('dairy.quality.stability.tooFewDays')).toBe(true);
  });

  it('tones a swing as a problem and stability as fine, because the word alone is easy to skim past', () => {
    expect(stabilityTone(measured('8', '4', 13, true))).toBe('ok');
    expect(stabilityTone(measured('40', '4', 13, false))).toBe('bad');
  });

  /* [FOUND BY THIS TEST] One decimal was not enough. The tolerance IS 0.1, so a spread of 0.08 printed as "0.1" reads
   * as exactly at the limit while being inside it, and 0.04 and 0.14 print the same — a reader cannot tell a comfortable
   * cycle from a marginal one. Two decimals, formatted from the integer. */
  it('prints the SPREAD behind the word at the precision the tolerance demands', () => {
    expect(spreadText('8')).toBe('0.08');
    expect(spreadText('4')).toBe('0.04');
    expect(spreadText('0')).toBe('0.00');
    expect(spreadText('10')).toBe('0.10');      // exactly the tolerance, and it LOOKS like it
    expect(spreadText('14')).toBe('0.14');      // …and this one is distinguishable from it
    expect(spreadText('105')).toBe('1.05');
  });

  it('prints the tolerance the claim was judged against, so "stable" is falsifiable', () => {
    expect(stabilityToleranceText(measured('8', '4'))).toBe('±0.1');
    expect(hasKey('dairy.quality.stability.spread')).toBe(true);
    expect(hasKey('dairy.quality.stability.days')).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the flags tile', () => {
  it('checks W168\'s "all resolved or in review" rather than printing it', () => {
    expect(flagsClaimKey({ total: 4, allResolvedOrInReview: true, openCount: 0 })).toBe('dairy.quality.flags.allHandled');
    expect(flagsClaimKey({ total: 4, allResolvedOrInReview: false, openCount: 1 })).toBe('dairy.quality.flags.awaiting');
    expect(flagsClaimKey({ total: 0, allResolvedOrInReview: true, openCount: 0 })).toBe('dairy.quality.flags.none');
    for (const k of ['dairy.quality.flags.allHandled', 'dairy.quality.flags.awaiting', 'dairy.quality.flags.none']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('tones an untouched flag as a problem — it is money being held with nobody looking at it', () => {
    expect(flagsTone({ total: 4, allResolvedOrInReview: false })).toBe('bad');
    expect(flagsTone({ total: 4, allResolvedOrInReview: true })).toBe('ok');
    expect(flagsTone({ total: 0, allResolvedOrInReview: true })).toBe('muted');
  });

  it('puts water first and a tenant\'s own invention last, so the list reads the same as the canon\'s', () => {
    expect(reasonOrder(['starch', 'water_flag', 'neutraliser', 'urea']))
      .toEqual(['water_flag', 'starch', 'urea', 'neutraliser']);
  });

  it('shares the counter board\'s flag-kind keys, so one flag reads the same on both dairy screens', () => {
    for (const k of ['water_flag', 'urea', 'starch', 'detergent']) {
      expect(reasonKey(k)).toBe(`dairy.flagKind.${k}`);
      expect(hasKey(reasonKey(k))).toBe(true);
    }
    expect(reasonKey('neutraliser')).toBe('dairy.flagKind.other');
    expect(reasonKey('')).toBe('dairy.flagKind.other');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the premium band — paid, or merely earnable', () => {
  const measured = (basis: 'earned' | 'would_qualify'): DairyPremiumBand =>
    ({ kind: 'measured', basis, qualifying: 184, pourers: 312, shareBps: 5897, slabs: [FAT_SLAB] });

  it('says EARNED and WOULD QUALIFY with different words, because they are different facts', () => {
    expect(premiumBandKey(measured('earned'))).toBe('dairy.quality.premium.earned');
    expect(premiumBandKey(measured('would_qualify'))).toBe('dairy.quality.premium.wouldQualify');
    expect(hasKey('dairy.quality.premium.earned')).toBe(true);
    expect(hasKey('dairy.quality.premium.wouldQualify')).toBe(true);
    // …and the copy itself has to carry the distinction, not just the key name.
    expect(dict('en')).toMatch(/'dairy\.quality\.premium\.wouldQualify': '[^']*WOULD/);
  });

  it('gives W168\'s pair AND its share', () => {
    expect(premiumBandPairText(measured('earned'))).toBe('184 / 312');
    expect(premiumBandShareText(measured('earned'))).toBe('59.0%');
  });

  it('refuses a band with no slabs and no pourers, rather than printing 0 / 312', () => {
    expect(premiumBandKey({ kind: 'no_slabs' })).toBe('dairy.quality.premium.noSlabs');
    expect(premiumBandKey({ kind: 'no_pours', slabs: [FAT_SLAB] })).toBe('dairy.quality.premium.noPours');
    expect(premiumBandPairText({ kind: 'no_slabs' })).toBeNull();
    expect(premiumBandShareText({ kind: 'no_pours', slabs: [] })).toBeNull();
    for (const k of ['dairy.quality.premium.noSlabs', 'dairy.quality.premium.noPours']) expect(hasKey(k)).toBe(true);
  });

  it('warns that configured slabs are NOT being applied — the defect TENANT-6b-1 made fixable', () => {
    expect(slabsNotAppliedKey(false, measured('would_qualify'))).toBe('dairy.quality.premium.notApplied');
    expect(slabsNotAppliedKey(true, measured('earned'))).toBeNull();
    // …and says nothing on a card that promises no premium: there is nothing to switch on.
    expect(slabsNotAppliedKey(false, { kind: 'no_slabs' })).toBeNull();
    expect(hasKey('dairy.quality.premium.notApplied')).toBe(true);
  });

  it('prints the band from the CARD rather than the canon\'s 6.5', () => {
    expect(slabText(FAT_SLAB)).toBe('fat ≥ 6.5');
    expect(slabText({ metric: 'snf', minCentiPct: 900, bonusMinorPerLitre: 25 })).toBe('SNF ≥ 9.0');
    // [FOUND BY THIS TEST] `(605/100).toFixed(1)` is "6.0" in JavaScript — 6.05 has no exact float representation — so
    // a member would be told the band is 6.0 when the card says 6.05. Formatted from the integer instead.
    expect(slabText({ metric: 'fat', minCentiPct: 605, bonusMinorPerLitre: 10 })).toBe('fat ≥ 6.05');
    expect(slabText({ metric: 'fat', minCentiPct: 700, bonusMinorPerLitre: 10 })).toBe('fat ≥ 7.0');
    expect(slabText({ metric: 'snf', minCentiPct: 1_000, bonusMinorPerLitre: 10 })).toBe('SNF ≥ 10.0');
    expect(hasKey(slabMetricKey(FAT_SLAB))).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the rate cards, and the two claims the platform cannot keep', () => {
  it('always says a rate card has no second approver — W168 promises "owner + checker"', () => {
    expect(cardCheckerKey(cards())).toBe('dairy.quality.card.noChecker');
    expect(hasKey('dairy.quality.card.noChecker')).toBe(true);
    expect(cards().checkerRequired).toBe(false);
  });

  it('always says nothing archives a card, while keeping the canon\'s true half about history', () => {
    expect(cardSupersedeKey(cards())).toBe('dairy.quality.card.noArchive');
    expect(hasKey('dairy.quality.card.noArchive')).toBe(true);
    // The copy has to say BOTH: history is kept, and no archive exists. One without the other is a different claim.
    expect(dict('en')).toMatch(/'dairy\.quality\.card\.noArchive': '[^']*history is kept[^']*ARCHIVE/);
  });

  it('raises the ambiguity only when two cards really are in force for one animal type', () => {
    expect(cardAmbiguityKey(cards({ ambiguousAnimalTypes: ['buffalo'] }))).toBe('dairy.quality.card.ambiguous');
    expect(cardAmbiguityKey(cards())).toBeNull();
    expect(hasKey('dairy.quality.card.ambiguous')).toBe(true);
  });

  it('marks which card is pricing and which is shadowed, so a rate change cannot go unnoticed', () => {
    expect(cardEffectiveKey('rc1', 'rc1')).toBe('dairy.quality.card.pricingWith');
    expect(cardEffectiveKey('rc0', 'rc1')).toBe('dairy.quality.card.shadowed');
    expect(cardEffectiveKey('rc1', null)).toBeNull();
    for (const k of ['dairy.quality.card.pricingWith', 'dairy.quality.card.shadowed']) expect(hasKey(k)).toBe(true);
  });

  it('names the pricing model and the animal type in all three languages', () => {
    for (const m of ['two_axis', 'fat_pooled', 'snf_pooled']) expect(hasKey(pricingModelKey(m))).toBe(true);
    for (const a of ['cow', 'buffalo', 'mixed']) expect(hasKey(animalTypeKey(a))).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the arithmetic, line by line', () => {
  it('gives one line per thing the card actually charges for', () => {
    const lines = exampleLines(example());
    expect(lines.map((l) => l.key)).toEqual([
      'dairy.quality.example.fat', 'dairy.quality.example.snf', 'dairy.quality.example.bonus',
    ]);
    expect(lines[0]).toMatchObject({ qty: '0.483', amountMinor: '34762' });
    for (const l of lines) expect(hasKey(l.key)).toBe(true);
  });

  it('omits an axis the card does not charge for — a "SNF ₹0" line teaches a farmer the wrong thing', () => {
    const lines = exampleLines(example({ snfMinor: '0' }));
    expect(lines.map((l) => l.key)).not.toContain('dairy.quality.example.snf');
  });

  /* [MUTATION GAP] The first version of this test set bonusMinor to '0' as well, so dropping the `bonusApplied` guard
   * survived — and a pour that EARNED a premium the tenant is not paying would have had it printed as a paid line. */
  it('omits the bonus line when the slabs are not applied, even where a premium was EARNED', () => {
    const notApplied = exampleLines(example({ bonusApplied: false, bonusMinor: '355' }));
    expect(notApplied.map((l) => l.key)).not.toContain('dairy.quality.example.bonus');
    const zero = exampleLines(example({ bonusApplied: false, bonusMinor: '0' }));
    expect(zero.map((l) => l.key)).not.toContain('dairy.quality.example.bonus');
    // …and it IS printed once the tenant is actually paying it.
    expect(exampleLines(example()).map((l) => l.key)).toContain('dairy.quality.example.bonus');
  });

  it('but SAYS a premium was earned and not paid — the omission must not be silent', () => {
    expect(exampleWithheldBonusKey(example({ bonusApplied: false, bonusMinor: '355' }))).toBe('dairy.quality.example.bonusNotApplied');
    expect(exampleWithheldBonusKey(example({ bonusApplied: false, bonusMinor: '0', slabsEarned: [] }))).toBeNull();
    expect(exampleWithheldBonusKey(example())).toBeNull();
    expect(hasKey('dairy.quality.example.bonusNotApplied')).toBe(true);
  });

  it('shows a base-rate line when the card has one', () => {
    const lines = exampleLines(example({ baseMinor: '10000' }));
    expect(lines.map((l) => l.key)).toContain('dairy.quality.example.base');
  });

  it('says out loud when the example is illustrative rather than from a real pour', () => {
    expect(exampleBasisKey(example({ fromRealPour: true }))).toBe('dairy.quality.example.fromPour');
    expect(exampleBasisKey(example({ fromRealPour: false }))).toBe('dairy.quality.example.illustrative');
    for (const k of ['dairy.quality.example.fromPour', 'dairy.quality.example.illustrative']) expect(hasKey(k)).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · the flag panel', () => {
  it('shows the masked member and never has the whole code to leak', () => {
    expect(memberLabel(flag())).toEqual({ text: 'AND2••87', key: null });
    expect(memberLabel(flag({ memberCodeMasked: null }))).toEqual({ text: null, key: 'dairy.quality.flag.memberGone' });
    expect(hasKey('dairy.quality.flag.memberGone')).toBe(true);
  });

  it('names the centre and the shift the canon puts in its own panel title', () => {
    expect(flagTitleParts(flag())).toEqual({ mcc: 'MCC-AND-02', shiftKey: 'dairy.shift.morning' });
    expect(hasKey('dairy.shift.morning')).toBe(true);
    expect(hasKey('dairy.shift.evening')).toBe(true);
  });

  it('names a missing density instead of leaving a blank that reads as "nothing unusual"', () => {
    expect(densityKey(flag({ densityAtFlag: '1.024' }))).toBe('dairy.quality.flag.density');
    expect(densityKey(flag({ densityAtFlag: null }))).toBe('dairy.quality.flag.densityNotRecorded');
    for (const k of ['dairy.quality.flag.density', 'dairy.quality.flag.densityNotRecorded']) expect(hasKey(k)).toBe(true);
  });

  it('shows where the pour\'s money stands, in the counter board\'s own vocabulary', () => {
    expect(holdKey(flag({ holdState: 'held' }))).toBe('dairy.hold.held');
    expect(holdTone(flag({ holdState: 'held' }))).toBe('muted');
    expect(holdTone(flag({ holdState: 'released' }))).toBe('ok');
    expect(holdTone(flag({ holdState: 'rejected' }))).toBe('bad');
    for (const s of ['none', 'held', 'released', 'rejected']) expect(hasKey(`dairy.hold.${s}`)).toBe(true);
  });

  it('tells the operator the NEXT act rather than a status word', () => {
    expect(nextActKey(flag({ status: 'open' }))).toBe('dairy.quality.flag.needsRetest');
    expect(nextActKey(flag({ status: 'retested' }))).toBe('dairy.quality.flag.needsDecision');
    expect(nextActKey(flag({ status: 'cleared' }))).toBe('dairy.quality.flag.decided');
    expect(nextActKey(flag({ status: 'rejected' }))).toBe('dairy.quality.flag.decided');
    for (const k of ['dairy.quality.flag.needsRetest', 'dairy.quality.flag.needsDecision', 'dairy.quality.flag.decided']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('records the sealed sample as an assertion, and its absence as an absence', () => {
    expect(sealedKey(flag({ sampleSealed: true }))).toBe('dairy.quality.flag.sealed');
    expect(sealedKey(flag({ sampleSealed: false }))).toBe('dairy.quality.flag.notSealed');
    // The copy must attribute it to a person, not to the system.
    expect(dict('en')).toMatch(/'dairy\.quality\.flag\.sealed': '[^']*operator/);
  });

  it('says nothing about the member\'s presence until a re-test has happened', () => {
    expect(memberPresentKey(flag({ retestAt: null }))).toBeNull();
    expect(memberPresentKey(flag({ retestAt: 'x', memberPresent: true }))).toBe('dairy.quality.flag.memberPresent');
    expect(memberPresentKey(flag({ retestAt: 'x', memberPresent: false }))).toBe('dairy.quality.flag.memberAbsent');
    for (const k of ['dairy.quality.flag.memberPresent', 'dairy.quality.flag.memberAbsent']) expect(hasKey(k)).toBe(true);
  });

  it('asks for a committee only when one is owed', () => {
    expect(committeeKey(flag({ committeeReviewRequired: true }))).toBe('dairy.quality.flag.committeeOwed');
    expect(committeeKey(flag({ committeeReviewRequired: false }))).toBeNull();
    expect(hasKey('dairy.quality.flag.committeeOwed')).toBe(true);
  });

  it('marks the two protocol steps this platform records and the one it does not', () => {
    const p = protocol();
    expect(protocolStepKey('retest', p)).toBe('dairy.quality.protocol.retest.recorded');
    expect(protocolStepKey('decision', p)).toBe('dairy.quality.protocol.decision.recorded');
    expect(protocolStepKey('committee', p)).toBe('dairy.quality.protocol.committee.notModelled');
    expect(protocolStepTone('retest', p)).toBe('ok');
    expect(protocolStepTone('committee', p)).toBe('muted');
    for (const step of ['retest', 'decision', 'committee']) {
      expect(hasKey(`dairy.quality.protocol.${step}.recorded`)).toBe(true);
      expect(hasKey(`dairy.quality.protocol.${step}.notModelled`)).toBe(true);
    }
  });

  it('states the pour-level hold, which is the one promise on this screen kept end to end', () => {
    expect(hasKey('dairy.quality.protocol.holdOnly')).toBe(true);
    expect(hasKey('dairy.quality.quarantinePour')).toBe(true);
    // …and the copy has to say the wallet is untouched, because W168 promises exactly that.
    expect(dict('en')).toMatch(/'dairy\.quality\.protocol\.holdOnly': '[^']*wallet/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6b-2 · states, empties and the way in', () => {
  it('separates the flag guard\'s 404 from a permission\'s 403 from a real failure', () => {
    expect(qualityState(null)).toBe('ok');
    expect(qualityState('NOT_FOUND')).toBe('flaggedOff');
    expect(qualityState('generic', 404)).toBe('flaggedOff');
    expect(qualityState('FORBIDDEN')).toBe('restricted');
    expect(qualityState('generic', 403)).toBe('restricted');
    expect(qualityState('generic', 500)).toBe('error');
    for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) {
      expect(qualityStateKey(s)).toBe(`dairy.quality.state.${s}`);
      expect(hasKey(qualityStateKey(s))).toBe(true);
    }
    expect(hasKey('dairy.quality.buffersAtMcc')).toBe(true);
  });

  it('keeps the canon\'s TWO empty states apart — a clean cycle is not the same as nothing open', () => {
    expect(emptyKey(0, 0)).toBe('dairy.quality.empty.cycleClean');
    expect(emptyKey(4, 0)).toBe('dairy.quality.empty.noneOpen');
    expect(emptyKey(4, 1)).toBeNull();
    for (const k of ['dairy.quality.empty.cycleClean', 'dairy.quality.empty.noneOpen']) expect(hasKey(k)).toBe(true);
  });

  it('points the canon\'s decorative "Rate cards" button at the only surface that can write one', () => {
    expect(RATE_CARDS_HREF).toBe('/dairy/console');
    expect(DAIRY_NAV.find((i) => i.key === 'console')?.href).toBe('/dairy/console');
    expect(hasKey('dairy.quality.action.rateCards')).toBe(true);
    expect(hasKey('dairy.quality.action.reviewFlags')).toBe(true);
  });

  it('shows the open-flag count on the button only when there is one', () => {
    expect(reviewFlagsCountText(3)).toBe('3');
    expect(reviewFlagsCountText(0)).toBeNull();
  });

  /**
   * W168 IS LINKED FROM NOWHERE IN THE CANON — `grep -rl W168-tenant-dairy-quality` across all 1,955 screens returns
   * zero hits, the third instance of that defect after W241 (5c) and W244 (5d). The sub-nav is the fix, so this is the
   * test that would fail if a later wave quietly unbuilt it.
   */
  it('gives W168 a way in: the dairy sub-nav now points at it', () => {
    const quality = DAIRY_NAV.find((i) => i.key === 'quality');
    expect(quality).toEqual({ key: 'quality', href: '/dairy/quality', built: true });
    expect(hasKey(dairyNavLabelKey(quality!))).toBe(true);
    expect(currentDairyNavKey('/dairy/quality')).toBe('quality');
    // …and it must not light up the collections tab as well.
    expect(currentDairyNavKey('/dairy')).toBe('collections');
  });

  it('counts down the unbuilt dairy sections as each wave lands one', () => {
    expect(dairyUnbuiltCount()).toBe(1);            // insights only — 6c-6 built cycles, 6d-1 the BMC, 6d-2 the centres
    expect(DAIRY_NAV.filter((i) => i.built).map((i) => i.key).sort()).toEqual(['bmc', 'centres', 'collections', 'console', 'cycles', 'quality']);
    for (const i of DAIRY_NAV) expect(i.built).toBe(i.href !== null);
  });

  it('links the quality desk from the counter board too, since the canon links it from nowhere', () => {
    const page = fs.readFileSync(path.join(__dirname, '../app/dairy/page.tsx'), 'utf8');
    expect(page).toContain('/dairy/quality');
    expect(hasKey('dairy.quality.reviewOnDesk')).toBe(true);
  });

  it('has the desk\'s own chrome in all three languages', () => {
    for (const k of ['dairy.quality.title', 'dairy.quality.lead', 'dairy.quality.tile.fat', 'dairy.quality.tile.snf',
      'dairy.quality.tile.flags', 'dairy.quality.tile.premium', 'dairy.quality.tile.noHerd',
      'dairy.quality.col.flag', 'dairy.quality.col.evidence', 'dairy.quality.col.money', 'dairy.quality.col.protocol',
      'dairy.quality.card.heading', 'dairy.quality.card.none', 'dairy.quality.card.noSlabs',
      'dairy.quality.card.openEnded', 'dairy.quality.example.heading', 'dairy.quality.example.line',
      'dairy.quality.example.qty', 'dairy.quality.example.amount', 'dairy.quality.example.total',
      'dairy.quality.example.nothingCharged', 'dairy.quality.flags.heading', 'dairy.quality.flags.withheld',
      'dairy.quality.viewCollections', 'dairy.rate.bonusSlab', 'dairy.quality.metric.fat', 'dairy.quality.metric.snf']) {
      expect(hasKey(k)).toBe(true);
    }
  });
});
