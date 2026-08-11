// modules/market-intel/__tests__/sweep-price-anomaly.spec.ts · PC-56 ADMIN-SWEEP.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A QUARANTINED PRICE MUST NOT SEND A FARMER AN ALERT.**
//
// W107 says "ambassador_manual entries > 20% off modal are quarantined for review before feeding farmer alerts — bad
// data never reaches a selling decision." Before this wave, `ingest` inserted the observation and fired every matching
// alert in the same transaction with no check anywhere, so an ambassador typing ₹64,200 instead of ₹6,420 sent
// "groundnut is above your threshold" to every subscribed farmer in the region — and W109's timeline shows the farmer
// then "listed same day".
import { deviationBp, gate, gatedSourcesFrom, mayFeedFarmerAlerts, canDecide, thresholdFrom, DEFAULT_THRESHOLD_BP, DEFAULT_GATED_SOURCES } from '../domain/price-anomaly';

const base = { thresholdBp: 2_000, gatedSources: ['ambassador_manual', 'platform_txn'] };

describe('ADMIN-SWEEP · the deviation is computed in bigint, on money', () => {
  it('measures an absolute deviation in basis points, either direction', () => {
    // ₹6,420/qtl = 642000 paise. A 10× typo is 900% high.
    expect(deviationBp(6_420_000n, 642_000n)).toBe(90_000);
    expect(deviationBp(642_000n, 6_420_000n)).toBe(9_000);   // and the other way is 90% low
    expect(deviationBp(700_000n, 642_000n)).toBe(903);       // 9.03%
    expect(deviationBp(642_000n, 642_000n)).toBe(0);
  });

  it('never divides floats on money', () => {
    // At real magnitudes (a quintal of cumin is 2,485,000 paise) float division loses precision exactly where this
    // number decides whether a farmer is told a price. The multiplication happens first, in bigint.
    expect(deviationBp(2_485_000n, 2_484_999n)).toBe(0);
    // 1% of ₹24,850 is exactly 100 basis points, and it lands on 100 rather than 99.999…
    expect(deviationBp(2_485_000n + 24_850n, 2_485_000n)).toBe(100);
    // **AND THE RESULT IS FLOORED, WHICH IS THE SAFE DIRECTION HERE.** A deviation just under the threshold reads as
    // just under: rounding UP would quarantine a price that policy says is fine, and a reviewer who sees clean prices in
    // the queue stops trusting the queue.
    expect(deviationBp(2_485_000n + 2_484n, 2_485_000n)).toBe(9);
  });

  it('returns 0 rather than dividing by zero on a nonsense reference', () => {
    expect(deviationBp(642_000n, 0n)).toBe(0);
    expect(deviationBp(642_000n, -5n)).toBe(0);
  });
});

describe('ADMIN-SWEEP · the gate', () => {
  it('QUARANTINES a manual price far off the reference', () => {
    const v = gate({ ...base, source: 'ambassador_manual', modalMinor: 6_420_000n, referenceModalMinor: 642_000n });
    expect(v.state).toBe('quarantined');
    expect(v.deviationBp).toBe(90_000);
    expect(v.reason).toBe('deviation_exceeds_threshold');
    // The reference is carried on the verdict so the decision is reproducible months later — recomputing it at review
    // time would compare today's market to yesterday's typo.
    expect(v.referenceModalMinor).toBe(642_000n);
  });

  it('accepts a manual price inside the threshold', () => {
    const v = gate({ ...base, source: 'ambassador_manual', modalMinor: 700_000n, referenceModalMinor: 642_000n });
    expect(v.state).toBe('accepted');
    expect(v.reason).toBe('within_threshold');
    expect(v.deviationBp).toBe(903);
  });

  it('holds a deviation exactly ON the threshold', () => {
    // `>=` and not `>`. The canon says "> 20% off modal"; the stricter reading is the right one for a control whose
    // failure mode is a farmer selling on a wrong number.
    expect(gate({ ...base, source: 'ambassador_manual', modalMinor: 770_400n, referenceModalMinor: 642_000n }).state)
      .toBe('quarantined');
  });

  // **A GOVERNMENT FEED AND A PERSON WITH A PHONE ARE NOT THE SAME RISK.** Gating agmarknet would quarantine a whole
  // day's ingest the first time a market moved, and nobody can review 48,000 rows.
  it('does not gate the reference sources', () => {
    for (const source of ['agmarknet', 'enam']) {
      const v = gate({ ...base, source, modalMinor: 6_420_000n, referenceModalMinor: 642_000n });
      expect(v.state).toBe('accepted');
      expect(v.reason).toBe('not_gated_source');
    }
  });

  it('gates platform_txn as well as ambassador_manual', () => {
    expect(gate({ ...base, source: 'platform_txn', modalMinor: 6_420_000n, referenceModalMinor: 642_000n }).state)
      .toBe('quarantined');
  });

  /**
   * **THE DECISION THAT GOES AGAINST THIS PROGRAMME'S OWN HABIT, AND WHY.** Five waves have now treated unknown as
   * exclusion. Here, quarantining every first-ever observation for a product × region would hold the FIRST price report
   * from every new mandi the platform reaches — the exact districts an expanding agri platform is trying to serve, where
   * no reviewer is staffed yet — and a farmer in a newly-covered district would get no price signal at all.
   *
   * So a first observation is accepted, and the reason is RECORDED so the console can show how many of today's accepts
   * had nothing to check against. The judgement is visible rather than hidden, which is the part that makes it honest.
   */
  it('accepts a first-ever observation and says WHY it could not be checked', () => {
    const v = gate({ ...base, source: 'ambassador_manual', modalMinor: 6_420_000n, referenceModalMinor: null });
    expect(v.state).toBe('accepted');
    expect(v.reason).toBe('no_reference');
    expect(v.deviationBp).toBeNull();
    // And a zero reference is the same case, not a division.
    expect(gate({ ...base, source: 'ambassador_manual', modalMinor: 100n, referenceModalMinor: 0n }).reason).toBe('no_reference');
  });

  it('honours a tightened threshold', () => {
    // The threshold is a platform setting (0124) precisely so it can be tightened after an incident without a deploy.
    const tight = { ...base, thresholdBp: 500 };
    expect(gate({ ...tight, source: 'ambassador_manual', modalMinor: 700_000n, referenceModalMinor: 642_000n }).state)
      .toBe('quarantined');
  });
});

describe('ADMIN-SWEEP · only an accepted or released price may reach a farmer', () => {
  it('names the rule the alert loop depends on', () => {
    expect(mayFeedFarmerAlerts('accepted')).toBe(true);
    // Released = a reviewer looked and judged it correct after all.
    expect(mayFeedFarmerAlerts('released')).toBe(true);
    expect(mayFeedFarmerAlerts('quarantined')).toBe(false);
    expect(mayFeedFarmerAlerts('rejected')).toBe(false);
  });

  it('refuses an unrecognised state', () => {
    // Fourth wave running: a state this code cannot describe is a state whose safety it cannot assert.
    expect(mayFeedFarmerAlerts('pending')).toBe(false);
    expect(mayFeedFarmerAlerts('')).toBe(false);
  });

  it('lets a reviewer decide only from quarantined', () => {
    expect(canDecide('quarantined', 'released')).toBe(true);
    expect(canDecide('quarantined', 'rejected')).toBe(true);
    // Re-deciding would overwrite the note the ambassador was shown.
    expect(canDecide('released', 'rejected')).toBe(false);
    expect(canDecide('rejected', 'released')).toBe(false);
    // An accepted row is not under review.
    expect(canDecide('accepted', 'released')).toBe(false);
  });
});

describe('ADMIN-SWEEP · a broken setting must never open the gate', () => {
  it('takes a valid threshold', () => {
    expect(thresholdFrom(2_000)).toEqual({ bp: 2_000, usedDefault: false });
    expect(thresholdFrom('500')).toEqual({ bp: 500, usedDefault: false });
  });

  // **A ZERO OR NEGATIVE THRESHOLD IS NOT A STRICTER GUARD.** It quarantines every gated observation, which in practice
  // is a price feed switched off behind a queue nobody can clear.
  it('falls back to the shipped default on a value that would break the plane', () => {
    for (const bad of [0, -1, 10_001, 1.5, 'twenty', null, undefined, {}]) {
      expect(thresholdFrom(bad)).toEqual({ bp: DEFAULT_THRESHOLD_BP, usedDefault: true });
    }
  });

  it('honours an empty gated-source list, because that is a real decision', () => {
    // A founder may legitimately decide to gate nothing. That is configuration, not corruption.
    expect(gatedSourcesFrom([])).toEqual({ sources: [], usedDefault: false });
    expect(gatedSourcesFrom(['ambassador_manual'])).toEqual({ sources: ['ambassador_manual'], usedDefault: false });
  });

  it('refuses a MALFORMED source list, because guessing "gate nothing" ships bad prices', () => {
    for (const bad of [null, undefined, 'ambassador_manual', [1, 2], {}, [true]]) {
      const r = gatedSourcesFrom(bad);
      expect(r.usedDefault).toBe(true);
      expect(r.sources).toEqual([...DEFAULT_GATED_SOURCES]);
    }
  });
});
