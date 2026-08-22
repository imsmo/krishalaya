// apps/web-tenant/src/test/tenant6e1-insights.spec.ts · PC-56 TENANT-6e-1 · W172's own words.
//
// The API refuses two of W172's eleven figures and bounds a third. This suite is about the page not quietly undoing
// that: a helper that turned a refusal into a zero, or printed a rate at four decimal places, or drew an arrow over a
// flag being switched on, would put the canon's claims back on the screen with the API's honesty stripped out.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  COHORT_BASIS_KEY, INSIGHT_WINDOWS, INSIGHTS_HREF, PAYOUT_STREAK_KEY, PAYOUT_STREAK_SUBSTITUTE_KEY,
  RATE_CARD_NO_VERSION_KEY, SPOILAGE_KEY,
  barPct, bpsToPercentText, changeAbsentKey, changeDirection, cohortsKey, historyKey, insightsHref, insightsState,
  insightsStateKey, insightsTransportState, isPartialBucket, litresText, peakMilli, premiumIncomparableKey, premiumKey,
  rateBasisKey, ratePerLitreMinor, shiftKey, slabMetricKey, slabText, windowLabelKey,
} from '../features/dairy/insights';
import { DAIRY_NAV, dairyUnbuiltCount } from '../features/dairy/nav';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CAT = { en, hi, gu } as Record<string, Record<string, string>>;
const has = (key: string) => Object.keys(CAT).filter((l) => typeof CAT[l][key] === 'string' && CAT[l][key].length > 0);

describe('PC-56 TENANT-6e-1 · the insights page, as words', () => {
  it('lights the last dark entry in the dairy sub-nav', () => {
    const insights = DAIRY_NAV.find((i) => i.key === 'insights');
    expect(insights).toMatchObject({ href: INSIGHTS_HREF, built: true });
    // TENANT-6a drew all six sections and marked five "not built". This is the last of them.
    expect(dairyUnbuiltCount()).toBe(0);
  });

  it('offers exactly the windows the API accepts, and keeps 90 on the bare URL', () => {
    expect([...INSIGHT_WINDOWS]).toEqual([30, 90, 180]);
    // The canon's own window is the default, so the bookmarkable URL for it carries no query at all.
    expect(insightsHref(90)).toBe('/dairy/insights');
    expect(insightsHref(30)).toBe('/dairy/insights?window=30');
    expect(insightsHref(180)).toBe('/dairy/insights?window=180');
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it("maps the API's five named states, and a 404 to \"not switched on\" rather than an error", () => {
    expect(insightsState({ kind: 'not_enabled', flag: 'dairy_insights' })).toBe('notEnabled');
    expect(insightsState({ kind: 'unavailable', missing: ['x'] })).toBe('unavailable');
    expect(insightsState({ kind: 'no_data' } as never)).toBe('noData');
    expect(insightsState({ kind: 'not_enough_history' } as never)).toBe('notEnoughHistory');
    expect(insightsState({ kind: 'ready' } as never)).toBe('ok');

    // A 404 from the guard means the DAIRY MODULE is off for this cooperative. Rendering "something went wrong" over
    // that would send an operator to support about a module their society is not licensed for.
    expect(insightsTransportState('NOT_FOUND', 404)).toBe('notEnabled');
    expect(insightsTransportState('FORBIDDEN', 403)).toBe('restricted');
    expect(insightsTransportState('SOMETHING', 500)).toBe('error');
    expect(insightsTransportState(null)).toBeNull();
  });

  it('has copy in all three languages for every state, and none of it says zero', () => {
    for (const s of ['ok', 'notEnabled', 'unavailable', 'noData', 'notEnoughHistory', 'restricted', 'error'] as const) {
      expect(has(insightsStateKey(s))).toEqual(['en', 'hi', 'gu']);
    }
    // The flagged-off sentence must say the page is OFF, not that there is no milk: a cooperative reading "0 L/day"
    // learns something false about itself. This is 0168.5's promise, checked in the copy.
    expect(en[insightsStateKey('notEnabled')]).toMatch(/not switched on/i);
    expect(en[insightsStateKey('notEnabled')]).toMatch(/unaffected|Nothing is missing/i);
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('draws an arrow only for a real movement, and a sentence for each way there is none', () => {
    expect(changeDirection({ kind: 'changed', deltaBps: 900, delta: '1', from: '1', to: '2' })).toBe('up');
    expect(changeDirection({ kind: 'changed', deltaBps: -900, delta: '-1', from: '2', to: '1' })).toBe('down');
    expect(changeDirection({ kind: 'changed', deltaBps: 0, delta: '0', from: '1', to: '1' })).toBe('flat');
    for (const c of [
      { kind: 'from_zero', to: '1' }, { kind: 'to_zero', from: '1' }, { kind: 'both_zero' }, { kind: 'no_previous' },
    ] as const) {
      expect(changeDirection(c)).toBe('none');
      const key = changeAbsentKey(c);
      expect(key).not.toBeNull();
      expect(has(key!)).toEqual(['en', 'hi', 'gu']);
    }
    expect(changeAbsentKey({ kind: 'changed', deltaBps: 1, delta: '1', from: '1', to: '2' })).toBeNull();
    // "no milk in either period" is its own sentence and not a shrug.
    expect(changeAbsentKey({ kind: 'both_zero' })).not.toBe(changeAbsentKey({ kind: 'no_previous' }));
  });

  it('prints a percent to ONE decimal, without losing the tens place', () => {
    expect(bpsToPercentText(900)).toBe('9.0');
    expect(bpsToPercentText(912)).toBe('9.1');
    // The bug this replaced: 905 through `abs % 100` printed "9.00" — a percent with two decimals and a lost digit.
    expect(bpsToPercentText(905)).toBe('9.1');
    expect(bpsToPercentText(904)).toBe('9.0');
    expect(bpsToPercentText(10_000)).toBe('100.0');
    // The sign is dropped because the arrow carries it: "▼ -9.1%" reads as a double negative.
    expect(bpsToPercentText(-912)).toBe('9.1');
    expect(bpsToPercentText(0)).toBe('0.0');
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('converts milli-litres by string arithmetic, so a union total does not drift', () => {
    expect(litresText('4180000')).toBe('4180.0');
    expect(litresText('19845')).toBe('19.8');   // 19.845 kg, to a tenth
    expect(litresText('19850')).toBe('19.9');   // half rounds up
    expect(litresText('0')).toBe('0.0');
    // 2^53 + 1 litres in milli — the first integer a float cannot hold. `Number(x)/1000` loses it; bigint does not.
    expect(litresText('9007199254740993000')).toBe('9007199254740993.0');
  });

  it("shows the rate at the CURRENCY's precision, not at the ratio's", () => {
    // The API carries two extra places for COMPARING windows. Showing them would quote a member a rate in
    // ten-thousandths of a rupee, which nobody can check against their slip.
    expect(ratePerLitreMinor('516000')).toBe('5160');     // ₹51.60
    expect(ratePerLitreMinor('516049')).toBe('5160');
    expect(ratePerLitreMinor('516050')).toBe('5161');     // half up
    expect(ratePerLitreMinor('-21000')).toBe('-210');     // a delta keeps its sign
    expect(ratePerLitreMinor('')).toBe('0');
  });

  it('never omits the "before deductions" line beside the rate', () => {
    const key = rateBasisKey({ kind: 'measured', basis: 'gross_at_counter', centiMinorPerLitre: '1', amountMinor: '1', milli: '1', change: { kind: 'no_previous' } });
    expect(key).toBe('dairy.insights.rate.grossAtCounter');
    expect(has(key!)).toEqual(['en', 'hi', 'gu']);
    // The English copy has to name what is deducted, or "gross" is a word a member cannot act on.
    expect(en[key!]).toMatch(/feed credit/i);
    expect(en[key!]).toMatch(/before/i);
    expect(rateBasisKey({ kind: 'no_pours' })).toBeNull();
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('names the cohort bound on the screen, so "new" is not read as "new ever"', () => {
    expect(has(COHORT_BASIS_KEY)).toEqual(['en', 'hi', 'gu']);
    expect(cohortsKey({ kind: 'no_pourers', lookbackDays: 365 })).toBe('dairy.insights.pourers.none');
    expect(cohortsKey({ kind: 'inconsistent', active: 1, newcomers: 2, winBacks: 0, lookbackDays: 365 }))
      .toBe('dairy.insights.pourers.inconsistent');
    // A measured partition needs no explanatory line — the numbers speak.
    expect(cohortsKey({ kind: 'measured', active: 3, newcomers: 1, winBacks: 1, continuing: 1, lookbackDays: 365, basis: 'first_pour_within_lookback', change: { kind: 'no_previous' } })).toBeNull();
    // The inconsistent copy must read as a platform fault, not as the cooperative's records being wrong.
    expect(en['dairy.insights.pourers.inconsistent']).toMatch(/platform/i);
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('scales a bar against the peak, and never divides by an empty series', () => {
    const series = {
      buckets: [
        { from: 'a', to: 'b', days: 6, byShift: { morning: '0', evening: '0' }, totalMilli: '0' },
        { from: 'c', to: 'd', days: 7, byShift: { morning: '600', evening: '400' }, totalMilli: '1000' },
        { from: 'e', to: 'f', days: 7, byShift: { morning: '250', evening: '250' }, totalMilli: '500' },
      ],
      shifts: ['morning', 'evening'], bucketDays: 7, firstBucketDays: 6,
    };
    expect(peakMilli(series)).toBe(1000n);
    expect(barPct('1000', 1000n)).toBe(100);
    expect(barPct('500', 1000n)).toBe(50);
    expect(barPct('0', 1000n)).toBe(0);
    // An empty chart is a MESSAGE ("no milk in this period"), not a flat axis — so the peak is zero and no bar is drawn.
    const empty = { ...series, buckets: [series.buckets[0]] };
    expect(peakMilli(empty)).toBe(0n);
    expect(barPct('0', 0n)).toBe(0);

    // Only the OLDEST bucket can be partial, and only when it is genuinely short.
    expect(isPartialBucket(series, 0)).toBe(true);
    expect(isPartialBucket(series, 1)).toBe(false);
    expect(isPartialBucket({ ...series, firstBucketDays: 7 }, 0)).toBe(false);
  });

  it('reuses the shift word every other dairy screen already uses', () => {
    // A second `morning` in the catalogue is a second place for it to be translated differently.
    expect(shiftKey('morning')).toBe('dairy.shift.morning');
    expect(has('dairy.shift.morning')).toEqual(['en', 'hi', 'gu']);
    expect(has('dairy.shift.evening')).toEqual(['en', 'hi', 'gu']);
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('keeps "earned" and "would qualify" apart, in three languages', () => {
    const slabs = [{ metric: 'fat' as const, minCentiPct: 620, bonusMinorPerLitre: 50 }];
    const band = (basis: 'earned' | 'would_qualify') =>
      ({ kind: 'measured' as const, basis, qualifying: 184, pourers: 312, shareBps: 5897, slabs });

    expect(premiumKey({ current: band('earned'), previous: band('earned'), change: null, comparable: true }))
      .toBe('dairy.insights.premium.earned');
    expect(premiumKey({ current: band('would_qualify'), previous: band('would_qualify'), change: null, comparable: true }))
      .toBe('dairy.insights.premium.wouldQualify');
    expect(premiumKey({ current: { kind: 'no_slabs' }, previous: { kind: 'no_slabs' }, change: null, comparable: false }))
      .toBe('dairy.insights.premium.noSlabs');
    expect(premiumKey({ current: { kind: 'no_pours', slabs }, previous: { kind: 'no_pours', slabs }, change: null, comparable: false }))
      .toBe('dairy.insights.premium.noPours');

    for (const k of ['earned', 'wouldQualify', 'noSlabs', 'noPours', 'was', 'basisChanged', 'basisUnknown', 'noPrevious', 'paid']) {
      expect(has(`dairy.insights.premium.${k}`)).toEqual(['en', 'hi', 'gu']);
    }
    // The would-qualify sentence must contain the conditional. "184 pourers in the premium band" while nobody was paid
    // is the exact claim TENANT-6b-2 spent a wave removing.
    expect(en['dairy.insights.premium.wouldQualify']).toMatch(/WOULD|would/);
    expect(en['dairy.insights.premium.wouldQualify']).toMatch(/nobody was paid/i);
    // ...and "no slabs" must not read as a shortfall in the milk.
    expect(en['dairy.insights.premium.noSlabs']).toMatch(/pricing decision/i);
  });

  it('gives each reason there is no "was 141" its own sentence', () => {
    const slabs = [{ metric: 'fat' as const, minCentiPct: 620, bonusMinorPerLitre: 50 }];
    const earned = { kind: 'measured' as const, basis: 'earned' as const, qualifying: 184, pourers: 312, shareBps: 5897, slabs };
    const would = { kind: 'measured' as const, basis: 'would_qualify' as const, qualifying: 141, pourers: 294, shareBps: 4796, slabs };

    // Mixed bases: a configuration change, not milk improving.
    expect(premiumIncomparableKey({ current: earned, previous: would, change: null, comparable: false }))
      .toBe('dairy.insights.premium.basisChanged');
    // No previous window at all is a different sentence.
    expect(premiumIncomparableKey({ current: earned, previous: { kind: 'no_pours', slabs }, change: null, comparable: false }))
      .toBe('dairy.insights.premium.noPrevious');
    // **THE ONE THE MUTATION PASS ADDED.** Premiums are paid now, nothing was paid in the previous window, and this
    // platform holds no flag history — so whether the slabs were off then, or on with nobody clearing the band, is not
    // recorded. Printing "was 0" here would invent a collapse in milk quality out of an unrecorded setting.
    expect(premiumIncomparableKey({ current: earned, previous: { kind: 'basis_unknown', slabs }, change: null, comparable: false }))
      .toBe('dairy.insights.premium.basisUnknown');
    expect(has('dairy.insights.premium.basisUnknown')).toEqual(['en', 'hi', 'gu']);
    expect(en['dairy.insights.premium.basisUnknown']).toMatch(/not recorded/i);
    // ...and it is NOT the same sentence as a plain basis change.
    expect(en['dairy.insights.premium.basisUnknown']).not.toBe(en['dairy.insights.premium.basisChanged']);
    // Comparable, so nothing to explain.
    expect(premiumIncomparableKey({ current: earned, previous: earned, change: null, comparable: true })).toBeNull();
  });

  it('prints the slab threshold from the card, and there is no 6.5 in this app', () => {
    expect(slabText({ metric: 'fat', minCentiPct: 620, bonusMinorPerLitre: 50 })).toBe('6.20');
    expect(slabText({ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 })).toBe('6.50');
    expect(slabText({ metric: 'snf', minCentiPct: 905, bonusMinorPerLitre: 10 })).toBe('9.05');
    expect(has(slabMetricKey('fat'))).toEqual(['en', 'hi', 'gu']);
    expect(has(slabMetricKey('snf'))).toEqual(['en', 'hi', 'gu']);

    // The canon's threshold must appear nowhere as a literal in the feature or the page — it is one seed's number.
    const src = ['../features/dairy/insights.ts', '../app/dairy/insights/page.tsx']
      .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    // Strip every comment — JSX `{/* */}`, block and line — because the PROSE quotes the canon's own 6.5 on purpose.
    // What must not contain it is the code.
    const code = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b650\b/);
    expect(code).not.toMatch(/6\.5\b/);
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('keeps the two refusals as sentences, in three languages', () => {
    expect(has(PAYOUT_STREAK_KEY)).toEqual(['en', 'hi', 'gu']);
    expect(has(PAYOUT_STREAK_SUBSTITUTE_KEY)).toEqual(['en', 'hi', 'gu']);
    expect(has('dairy.insights.payout.cyclesClosed')).toEqual(['en', 'hi', 'gu']);
    expect(has('dairy.insights.payout.cyclesApproved')).toEqual(['en', 'hi', 'gu']);
    // The substitute copy has to say WHY, or a reader takes "cannot be measured" as a bug rather than a gap.
    expect(en[PAYOUT_STREAK_SUBSTITUTE_KEY]).toMatch(/PROMISED|promised/);
    expect(en[PAYOUT_STREAK_SUBSTITUTE_KEY]).toMatch(/never/i);
    // No copy on this page may claim a streak.
    expect(Object.entries(en).filter(([k, v]) => k.startsWith('dairy.insights.') && /\b24 cycles\b/.test(v))).toEqual([]);
  });

  it("reuses TENANT-6d-2's spoilage sentence rather than writing a second one", () => {
    // W170's "0 L milk lost to temperature" and W172's "zero spoilage" are one claim about one absence. Two keys is two
    // places for a translator to say it differently.
    expect(SPOILAGE_KEY).toBe('dairy.bmc.quarter.litresLostUnknown');
    expect(has(SPOILAGE_KEY)).toEqual(['en', 'hi', 'gu']);
    expect(en[SPOILAGE_KEY]).toMatch(/cannot be measured/i);
    expect(has('dairy.insights.spoilage.title')).toEqual(['en', 'hi', 'gu']);
  });

  it('says the rate cards carry no version, which is what the schema shows', () => {
    expect(has(RATE_CARD_NO_VERSION_KEY)).toEqual(['en', 'hi', 'gu']);
    expect(en[RATE_CARD_NO_VERSION_KEY]).toMatch(/no version/i);
    // And the ambiguity 6b-2 found, restated where it changes what a manager believes about their own prices.
    expect(has('dairy.insights.rateCard.ambiguous')).toEqual(['en', 'hi', 'gu']);
    expect(en['dairy.insights.rateCard.ambiguous']).toMatch(/two cards/i);
  });

  /* ----------------------------------------------------------------------------------------------------------- */

  it('names the cycle in the history gate, because "two cycles" alone means nothing', () => {
    expect(historyKey({ kind: 'no_data' })).toBe('dairy.insights.history.noData');
    expect(historyKey({ kind: 'not_enough_history', days: 23, needDays: 30, cycle: 'fortnightly', cycleDays: 15, haveCycles: 1, atLeast: false }))
      .toBe('dairy.insights.history.notEnough');
    expect(historyKey({ kind: 'ready', days: 400, cycle: 'monthly', cycleDays: 30, haveCycles: 13, atLeast: true }))
      .toBe('dairy.insights.history.ready');
    for (const k of ['noData', 'notEnough', 'ready']) expect(has(`dairy.insights.history.${k}`)).toEqual(['en', 'hi', 'gu']);
    // The page pairs the gate with the cycle's own word, which every dairy screen already has.
    for (const c of ['daily', 'weekly', 'fortnightly', 'monthly']) expect(has(`dairy.window.${c}`)).toEqual(['en', 'hi', 'gu']);
  });

  it('has all three languages for every key the page renders, and no orphans', () => {
    const page = fs.readFileSync(path.join(__dirname, '../app/dairy/insights/page.tsx'), 'utf8');
    const keys = new Set<string>();
    for (const m of page.matchAll(/'(dairy\.insights\.[a-zA-Z0-9._]+)'/g)) keys.add(m[1]);
    for (const w of INSIGHT_WINDOWS) keys.add(windowLabelKey(w));
    expect(keys.size).toBeGreaterThan(15);
    const missing = [...keys].filter((k) => has(k).length !== 3);
    expect(missing).toEqual([]);

    // ...and every key added to the catalogue is reachable: an orphan is copy a translator paid for that nobody reads.
    const referenced = new Set(keys);
    const feature = fs.readFileSync(path.join(__dirname, '../features/dairy/insights.ts'), 'utf8');
    for (const m of feature.matchAll(/'(dairy\.[a-zA-Z0-9._$]+)'/g)) referenced.add(m[1]);
    for (const stem of ['state', 'history', 'change', 'premium', 'pourers', 'payout', 'rateCard', 'window']) {
      // The template-built keys (`dairy.insights.state.${s}` etc.) are covered by the assertions above; this checks the
      // catalogue holds nothing under those stems that no helper or page can produce.
      const owned = Object.keys(en).filter((k) => k.startsWith(`dairy.insights.${stem}.`));
      expect(owned.length).toBeGreaterThan(0);
    }
    expect(Object.keys(en).filter((k) => k.startsWith('dairy.insights.')).every((k) => has(k).length === 3)).toBe(true);
  });

  it('has the same insights keys in all three catalogues — no language quietly short', () => {
    const keysOf = (c: Record<string, string>) => Object.keys(c).filter((k) => k.startsWith('dairy.insights.')).sort();
    expect(keysOf(hi)).toEqual(keysOf(en));
    expect(keysOf(gu)).toEqual(keysOf(en));
    // Vernacular first (Law 7): no key may fall back to English by being absent.
    for (const k of keysOf(en)) {
      expect(hi[k]).toBeTruthy();
      expect(gu[k]).toBeTruthy();
    }
  });
});
