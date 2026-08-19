// modules/dairy/__tests__/tenant6b2-quality-desk.spec.ts · PC-56 TENANT-6b-2.
//
// W168 makes four claims in its tiles and two more in its rate-card panel, and this suite holds each to the same
// standard: a figure is measured with its basis, or refused with what it would need named. The two that turned out to be
// claims about SOFTWARE rather than about milk get their own tests, because they are the ones a cooperative would act on:
//
//   • *"rate cards are owner + checker"* — there is no second approver anywhere on that path.
//   • *"Effective 01 Jul → (v3 archived, history kept)"* — nothing archives, nothing supersedes, and TWO cards can be
//     in force at once with the pricing path silently taking whichever starts later.
import {
  STABILITY_MIN_DAYS, STABILITY_TOLERANCE_CENTI_PCT, cycleQuality, flagProtocol, kgOf, litresOf,
  lowestFatSlabCentiPct, maskMemberCode, pctOf, premiumBand, rateCardsInForce, workedExample,
} from '../domain/dairy-quality-desk';
import type { DailyQuality, RateCardSummary } from '../domain/dairy-quality-desk';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { DairyQualityReadModel } from '../read-models/dairy-quality.read-model';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';

const FAT_SLAB = { metric: 'fat' as const, minCentiPct: 650, bonusMinorPerLitre: 50 };
const SNF_SLAB = { metric: 'snf' as const, minCentiPct: 900, bonusMinorPerLitre: 25 };

const dayRow = (o: Partial<DailyQuality> = {}): DailyQuality => ({
  day: '2026-07-01', weightMilliKg: 100_000n, fatCentiPctWeighted: 640n, snfCentiPctWeighted: 890n, ...o,
});

const card = (o: Partial<RateCardSummary> = {}): RateCardSummary => ({
  id: 'rc1', defaultName: 'Buffalo two_axis v4', animalType: 'buffalo', pricingModel: 'two_axis',
  ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', baseRatePerLitreMinor: null,
  slabs: [FAT_SLAB], effectiveFrom: '2026-07-01', effectiveTo: null, ...o,
});

function capturing(rowsFor: (sql: string) => unknown[] = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: rowsFor(sql) }; });
  return { repo: new DairyQualityRepository({ forTenant: () => ({ query }) } as never), calls, sqlOf: (n: string) => calls.find((c) => c.sql.includes(n)) };
}

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the cycle\'s quality, and the stability W168 asserts', () => {
  it('weights the cycle\'s averages BY LITRES across the window, not as a mean of daily means', () => {
    // 900 L at 7.00 fat and 100 L at 5.00 fat is 6.80 weighted; a mean of the two days' means would say 6.00.
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', weightMilliKg: 900_000n, fatCentiPctWeighted: 700n, snfCentiPctWeighted: 900n }),
      dayRow({ day: '2026-07-02', weightMilliKg: 100_000n, fatCentiPctWeighted: 500n, snfCentiPctWeighted: 800n }),
    ]);
    expect(pctOf(q.fatCentiPctWeighted!)).toBe('6.80');
    expect(pctOf(q.snfCentiPctWeighted!)).toBe('8.90');
    expect(litresOf(q.weightMilliKg)).toBe('1000.0');   // 1,000,000 milli-kg
  });

  /* [MUTATION GAP] Every weighted case divided exactly, so truncating the cycle average survived. A centi-percent lost
   * here moves a whole cooperative's reported quality, and the tile is what a buyer is shown. */
  it('rounds the cycle average half up rather than truncating the last centi-percent', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', weightMilliKg: 1_000n, fatCentiPctWeighted: 700n, snfCentiPctWeighted: 701n }),
      dayRow({ day: '2026-07-02', weightMilliKg: 1_000n, fatCentiPctWeighted: 701n, snfCentiPctWeighted: 700n }),
    ]);
    expect(q.fatCentiPctWeighted).toBe(701n);      // 1401/2 = 700.5 → 701, not 700
    expect(q.snfCentiPctWeighted).toBe(701n);
  });

  it('measures the ±0.1 claim as a SPREAD of the daily averages, and says how many days it saw', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', fatCentiPctWeighted: 640n, snfCentiPctWeighted: 890n }),
      dayRow({ day: '2026-07-02', fatCentiPctWeighted: 648n, snfCentiPctWeighted: 894n }),
      dayRow({ day: '2026-07-03', fatCentiPctWeighted: 645n, snfCentiPctWeighted: 892n }),
    ]);
    expect(q.stability.kind).toBe('measured');
    if (q.stability.kind !== 'measured') return;
    expect(q.stability.days).toBe(3);
    expect(q.stability.fatSpreadCentiPct).toBe(8n);          // 648 − 640
    expect(q.stability.snfSpreadCentiPct).toBe(4n);          // 894 − 890
    expect(q.stability.withinTolerance).toBe(true);
    expect(q.stability.toleranceCentiPct).toBe(STABILITY_TOLERANCE_CENTI_PCT);
  });

  it('calls a swing a swing — the canon prints "stable" as a fact and a cooperative is paid on it', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', fatCentiPctWeighted: 600n }),
      dayRow({ day: '2026-07-02', fatCentiPctWeighted: 700n }),
    ]);
    expect(q.stability.kind === 'measured' && q.stability.withinTolerance).toBe(false);
  });

  it('holds BOTH axes to the tolerance, because a cooperative is paid on fat as well as SNF', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', fatCentiPctWeighted: 640n, snfCentiPctWeighted: 800n }),
      dayRow({ day: '2026-07-02', fatCentiPctWeighted: 645n, snfCentiPctWeighted: 900n }),   // SNF swings a whole point
    ]);
    expect(q.stability.kind === 'measured' && q.stability.withinTolerance).toBe(false);
  });

  it('includes a spread of exactly the tolerance — ±0.1 means 0.1 is still stable', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01', fatCentiPctWeighted: 640n, snfCentiPctWeighted: 890n }),
      dayRow({ day: '2026-07-02', fatCentiPctWeighted: 650n, snfCentiPctWeighted: 890n }),   // exactly 10 centi-pct
    ]);
    expect(q.stability.kind === 'measured' && q.stability.withinTolerance).toBe(true);
  });

  it('refuses the claim under two days, rather than printing a reassuring 0.0', () => {
    const one = cycleQuality([dayRow()]);
    expect(one.stability).toEqual({ kind: 'insufficient_days', days: 1, needed: STABILITY_MIN_DAYS });
    expect(cycleQuality([]).stability).toEqual({ kind: 'insufficient_days', days: 0, needed: STABILITY_MIN_DAYS });
  });

  it('counts only days that carried milk — a centre closed on Sunday is not an unstable Sunday', () => {
    const q = cycleQuality([
      dayRow({ day: '2026-07-01' }),
      dayRow({ day: '2026-07-02', weightMilliKg: 0n, fatCentiPctWeighted: null, snfCentiPctWeighted: null }),
      dayRow({ day: '2026-07-03' }),
    ]);
    expect(q.stability.kind === 'measured' && q.stability.days).toBe(2);
  });

  it('reports no quality at all for a cycle that carried nothing', () => {
    const q = cycleQuality([dayRow({ weightMilliKg: 0n, fatCentiPctWeighted: null, snfCentiPctWeighted: null })]);
    expect(q.fatCentiPctWeighted).toBeNull();
    expect(q.snfCentiPctWeighted).toBeNull();
    expect(litresOf(q.weightMilliKg)).toBe('0.0');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the premium band, and what "earns" means', () => {
  it('says EARNED when the slabs are being applied — counted from money that moved', () => {
    const b = premiumBand({ slabs: [FAT_SLAB], slabsApplied: true, pourers: 312, earnedCount: 184, wouldQualifyCount: 200 });
    expect(b).toMatchObject({ kind: 'measured', basis: 'earned', qualifying: 184, pourers: 312 });
    expect(b.kind === 'measured' && b.shareBps).toBe(5897);
  });

  it('says WOULD QUALIFY when they are not — nobody was paid, and the tile must not imply they were', () => {
    const b = premiumBand({ slabs: [FAT_SLAB], slabsApplied: false, pourers: 312, earnedCount: 0, wouldQualifyCount: 200 });
    expect(b).toMatchObject({ kind: 'measured', basis: 'would_qualify', qualifying: 200 });
  });

  it('refuses a band on a card that promises none, rather than reporting zero of 312', () => {
    expect(premiumBand({ slabs: [], slabsApplied: true, pourers: 312, earnedCount: 0, wouldQualifyCount: 0 }))
      .toEqual({ kind: 'no_slabs' });
  });

  it('refuses a share with no pourers instead of dividing by zero', () => {
    expect(premiumBand({ slabs: [FAT_SLAB], slabsApplied: true, pourers: 0, earnedCount: 0, wouldQualifyCount: 0 }))
      .toEqual({ kind: 'no_pours', slabs: [FAT_SLAB] });
  });

  it('takes the LOWEST fat threshold as the band to clear, and ignores SNF slabs for that question', () => {
    expect(lowestFatSlabCentiPct([FAT_SLAB, { metric: 'fat', minCentiPct: 600, bonusMinorPerLitre: 25 }])).toBe(600);
    expect(lowestFatSlabCentiPct([SNF_SLAB])).toBeNull();
    expect(lowestFatSlabCentiPct([])).toBeNull();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the rate cards, and the two claims the software does not support', () => {
  it('never reports a checker or an archive, because neither exists on this platform', () => {
    const r = rateCardsInForce([card()]);
    // W168's restricted state: "rate cards are owner + checker". One dairy.manage holder changes what every member is
    // paid, alone, in one call. And nothing supersedes or deactivates a card.
    expect(r.checkerRequired).toBe(false);
    expect(r.supersedeRecorded).toBe(false);
  });

  it('names the card the pricing path would actually use — the LATEST effective_from', () => {
    const r = rateCardsInForce([
      card({ id: 'v3', effectiveFrom: '2026-06-01' }),
      card({ id: 'v4', effectiveFrom: '2026-07-01' }),
    ]);
    expect(r.byAnimal[0].effectiveId).toBe('v4');
    expect(r.byAnimal[0].cards.map((c) => c.id)).toEqual(['v4', 'v3']);   // newest first, as the panel reads
  });

  it('FLAGS the ambiguity, because "Active rate card" in the singular over two rows is how a rate change goes unnoticed', () => {
    const r = rateCardsInForce([
      card({ id: 'v3', effectiveFrom: '2026-06-01' }),
      card({ id: 'v4', effectiveFrom: '2026-07-01' }),
    ]);
    expect(r.byAnimal[0].ambiguous).toBe(true);
    expect(r.ambiguousAnimalTypes).toEqual(['buffalo']);
  });

  it('does not cry ambiguity over one card per animal type', () => {
    const r = rateCardsInForce([card({ animalType: 'buffalo' }), card({ id: 'rc2', animalType: 'cow' })]);
    expect(r.ambiguousAnimalTypes).toEqual([]);
    expect(r.byAnimal.map((g) => g.animalType)).toEqual(['buffalo', 'cow']);
    for (const g of r.byAnimal) expect(g.effectiveId).toBe(g.cards[0].id);
  });

  it('handles no cards at all — a cooperative that cannot price a pour', () => {
    const r = rateCardsInForce([]);
    expect(r.byAnimal).toEqual([]);
    expect(r.ambiguousAnimalTypes).toEqual([]);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the arithmetic W168 promises the farmer', () => {
  it('reproduces the canon\'s own worked example, line by line, to the paisa', () => {
    // W168: "7.1 L @ fat 6.8 / SNF 9.1 → fat 0.483 kg × ₹720 + SNF 0.646 kg × ₹340 + bonus ≈ ₹571".
    const e = workedExample({ card: card(), weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n, slabsApplied: true });
    expect(kgOf(e.fatKgMilli)).toBe('0.483');                // the canon's own 0.483 kg
    expect(kgOf(e.snfKgMilli)).toBe('0.646');                // …and its 0.646 kg
    expect(e.fatMinor).toBe(34_762n);
    expect(e.snfMinor).toBe(21_967n);
    expect(e.bonusMinor).toBe(355n);
    expect(e.totalMinor).toBe(57_084n);                      // ₹570.84 — the canon's "≈ ₹571"
    expect(e.slabsEarned).toEqual([FAT_SLAB]);
  });

  it('computes the money from the RAW inputs, not from the rounded kg it prints', () => {
    // If the money were derived from the displayed 0.483 kg, it would be 0.483 × 72000 = 34,776 rather than 34,762 —
    // and the desk's arithmetic would disagree with the counter's by 14 paisa, which is exactly the kind of gap that
    // teaches a farmer to distrust both.
    const e = workedExample({ card: card(), weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n, slabsApplied: false });
    expect(e.fatMinor).not.toBe((483n * 72_000n) / 1000n);
    expect(e.fatMinor).toBe(34_762n);
  });

  it('leaves the bonus OUT when the slabs are not applied, and still says which were earned', () => {
    const e = workedExample({ card: card(), weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n, slabsApplied: false });
    expect(e.bonusMinor).toBe(0n);
    expect(e.bonusApplied).toBe(false);
    expect(e.slabsEarned).toEqual([FAT_SLAB]);               // earned but not paid — the desk must be able to say so
    expect(e.totalMinor).toBe(34_762n + 21_967n);
  });

  /* [MUTATION GAP] The example's own slab test used fat 6.80 against a 6.5 threshold, so `>=` → `>` survived — the
   * boundary a member's premium turns on. */
  it('counts a pour reading EXACTLY the threshold as earning the slab', () => {
    const at = workedExample({ card: card(), weightMilliKg: 10_000n, fatCentiPct: 650n, snfCentiPct: 900n, slabsApplied: true });
    expect(at.slabsEarned).toEqual([FAT_SLAB]);
    expect(at.bonusMinor).toBe(500n);
    const below = workedExample({ card: card(), weightMilliKg: 10_000n, fatCentiPct: 649n, snfCentiPct: 900n, slabsApplied: true });
    expect(below.slabsEarned).toEqual([]);
    expect(below.bonusMinor).toBe(0n);
  });

  /* [MUTATION GAP] The axis test only covered `fat_pooled`, so forcing `usesFat` true survived. Both directions now. */
  it('charges nothing for FAT on a card that prices only SNF', () => {
    const e = workedExample({ card: card({ pricingModel: 'snf_pooled' }), weightMilliKg: 10_000n, fatCentiPct: 700n, snfCentiPct: 900n, slabsApplied: false });
    expect(e.fatMinor).toBe(0n);
    expect(e.fatKgMilli).toBe(0n);
    expect(e.snfMinor).toBeGreaterThan(0n);
  });

  it('charges nothing on an axis the card does not price', () => {
    const e = workedExample({ card: card({ pricingModel: 'fat_pooled' }), weightMilliKg: 10_000n, fatCentiPct: 700n, snfCentiPct: 900n, slabsApplied: true });
    expect(e.snfMinor).toBe(0n);
    expect(e.snfKgMilli).toBe(0n);
    expect(e.fatMinor).toBeGreaterThan(0n);
  });

  it('adds a base rate per litre when the card carries one', () => {
    const e = workedExample({ card: card({ baseRatePerLitreMinor: '1000' }), weightMilliKg: 10_000n, fatCentiPct: 600n, snfCentiPct: 850n, slabsApplied: false });
    expect(e.baseMinor).toBe(10_000n);                       // 10 L × ₹10.00
    expect(e.totalMinor).toBe(e.fatMinor + e.snfMinor + 10_000n);
  });

  it('renders litres, percents and kilos at the precision each is stored in', () => {
    expect(litresOf(7_100n)).toBe('7.1');
    expect(litresOf(0n)).toBe('0.0');
    // [MUTATION GAP] Every litre value divided exactly, so truncation survived. Milk is bought by the tenth of a litre.
    expect(litresOf(7_150n)).toBe('7.2');        // 71.5 tenths → 72, half UP
    expect(litresOf(7_149n)).toBe('7.1');
    expect(pctOf(680n)).toBe('6.80');
    expect(pctOf(605n)).toBe('6.05');
    expect(kgOf(483n)).toBe('0.483');
    expect(kgOf(1_004n)).toBe('1.004');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the flag panel', () => {
  it('masks the member, because W168 masks them on a screen about somebody\'s honesty', () => {
    expect(maskMemberCode('AND2-0087')).toBe('AND2••87');
    expect(maskMemberCode('  AND2-0087  ')).toBe('AND2••87');
  });

  it('does not "mask" a code too short to hide, which would protect nobody and hide the member from the operator', () => {
    expect(maskMemberCode('A1')).toBe('A1');
    expect(maskMemberCode('ABCD')).toBe('ABCD');
    expect(maskMemberCode('ABCDE')).toBe('ABCD••DE');
  });

  it('reports which of W168\'s three steps this platform can witness', () => {
    const p = flagProtocol();
    expect(p.retest).toBe('recorded');                       // TENANT-6b-1 built it
    expect(p.decision).toBe('recorded');
    expect(p.committee).toBe('not_modelled');                // a governance body with no representation here
    expect(p.pourLevelHold).toBe(true);
    expect(p.walletUntouched).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the SQL behind the desk', () => {
  it('bounds every window read by the partition key, so a cycle prunes to its own partitions', async () => {
    const { repo, calls } = capturing();
    await repo.dailyQuality('t1', '2026-07-01', '2026-07-15');
    await repo.premiumBandCounts('t1', '2026-07-01', '2026-07-15', 650);
    await repo.animalMix('t1', '2026-07-01', '2026-07-15');
    await repo.exemplarPour('t1', '2026-07-01', '2026-07-15', 'rc1');
    for (const c of calls) {
      expect(c.sql).toMatch(/collected_on >= \$\d::date/);
      expect(c.sql).toMatch(/collected_on <= \$\d::date/);
      expect(c.params[0]).toBe('t1');
    }
  });

  it('weights the daily averages inside the DATABASE, per litre', async () => {
    const { repo, sqlOf } = capturing();
    await repo.dailyQuality('t1', '2026-07-01', '2026-07-15');
    const sql = sqlOf('GROUP BY collected_on')!.sql;
    expect(sql).toContain('sum(fat_pct * weight_kg) / sum(weight_kg)');
    expect(sql).toContain('sum(snf_pct * weight_kg) / sum(weight_kg)');
    expect(sql).toContain('ORDER BY collected_on');
  });

  it('counts the premium band as MEMBERS both ways — paid, and would-qualify', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('would_qualify') ? [{ pourers: 312, earned: 184, would_qualify: 200 }] : []));
    const out = await repo.premiumBandCounts('t1', '2026-07-01', '2026-07-15', 650);
    expect(out).toEqual({ pourers: 312, earned: 184, wouldQualify: 200 });
    const q = sqlOf('would_qualify')!;
    // [MUTATION GAP] Asserting that the string appears SOMEWHERE let the denominator become `count(*)`, because the
    // filtered counts still used it. W168's denominator is "of 312 POURERS", so it is pinned to its own line.
    expect(q.sql).toMatch(/SELECT count\(DISTINCT membership_id\)::int AS pourers/);
    expect(q.sql).toContain('FILTER (WHERE bonus_minor > 0)');            // earned = money that moved
    expect(q.sql).toContain('fat_pct * 100 >= $4::int');                  // would-qualify against the card's slab
    expect(q.params[3]).toBe(650);
  });

  it('asks for no would-qualify count when the card has no fat slab to clear', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('would_qualify') ? [{ pourers: 10, earned: 0, would_qualify: 0 }] : []));
    await repo.premiumBandCounts('t1', '2026-07-01', '2026-07-15', null);
    // The NULL is passed and the SQL guards on it, so a card with only an SNF slab cannot silently count everybody.
    expect(sqlOf('would_qualify')!.sql).toContain('$4::int IS NOT NULL');
    expect(sqlOf('would_qualify')!.params[3]).toBeNull();
  });

  /* [MUTATION GAP] Nothing asserted the herd ordering, and the read model takes row 0 as the lead herd — so reversing
   * it measured the premium band against a card almost nobody pours on. */
  it('names the herd that poured MOST first, because the band is measured against its card', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('default_animal_type')
      ? [{ animal_type: 'buffalo', pours: 90 }, { animal_type: 'cow', pours: 10 }] : []));
    const mix = await repo.animalMix('t1', '2026-07-01', '2026-07-15');
    expect(mix[0]).toEqual({ animalType: 'buffalo', pours: 90 });
    expect(sqlOf('default_animal_type')!.sql).toContain('ORDER BY pours DESC');
  });

  it('reads EVERY card in force, with the SAME predicate the pricing path uses and NO limit', async () => {
    const { repo, sqlOf } = capturing();
    await repo.cardsInForce('t1', '2026-07-13');
    const sql = sqlOf('FROM milk_rate_cards')!.sql;
    expect(sql).toContain('effective_from <= $2::date');
    expect(sql).toContain('(effective_to IS NULL OR effective_to >= $2::date)');
    expect(sql).toContain('is_active = true');
    expect(sql).toContain('deleted_at IS NULL');
    // The point of this read: NOT LIMIT 1. `resolveActive` takes one; the desk shows what the database actually holds.
    expect(sql).not.toMatch(/LIMIT/);
  });

  it('parses the bonus slabs out of the jsonb column the repository used not to select', async () => {
    const { repo } = capturing((sql) => (sql.includes('FROM milk_rate_cards')
      ? [{ id: 'rc1', default_name: 'v4', animal_type: 'buffalo', pricing_model: 'two_axis', rate_per_kg_fat_minor: '72000',
        rate_per_kg_snf_minor: '34000', base_rate_per_litre_minor: null, bonus_rules: [FAT_SLAB],
        effective_from: '2026-07-01', effective_to: null }] : []));
    const cards = await repo.cardsInForce('t1', '2026-07-13');
    expect(cards[0].slabs).toEqual([FAT_SLAB]);
    expect(cards[0].effectiveTo).toBeNull();
  });

  it('takes the exemplar from the window\'s BIGGEST pour on that card', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('ORDER BY weight_kg DESC')
      ? [{ weight_milli_kg: '7100', fat_centi: '680', snf_centi: '910' }] : []));
    const out = await repo.exemplarPour('t1', '2026-07-01', '2026-07-15', 'rc1');
    expect(out).toEqual({ weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n });
    const q = sqlOf('ORDER BY weight_kg DESC')!;
    expect(q.sql).toContain('rate_card_id = $4');
    expect(q.sql).toContain('LIMIT 1');
  });

  it('returns null when the cycle holds no pour on the card, rather than an invented one', async () => {
    const { repo } = capturing(() => []);
    expect(await repo.exemplarPour('t1', '2026-07-01', '2026-07-15', 'rc1')).toBeNull();
  });

  it('asks the DATABASE for its own calendar day, unshifted', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('current_date') ? [{ d: '2026-07-13' }] : []));
    expect(await repo.today('t1')).toBe('2026-07-13');
    expect(sqlOf('current_date')!.sql).not.toMatch(/current_date\s*[-+]/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6b-2 · the read model composes W168', () => {
  function harness(o: {
    daily?: DailyQuality[]; cards?: RateCardSummary[]; mix?: Array<{ animalType: string; pours: number }>;
    band?: { pourers: number; earned: number; wouldQualify: number };
    counts?: { total: number; byStatus: Record<string, number>; byReason: Record<string, number>; withheldMinor: bigint };
    reviews?: unknown[]; exemplar?: { weightMilliKg: bigint; fatCentiPct: bigint; snfCentiPct: bigint } | null;
    flagOn?: boolean; today?: string; cycleMix?: Array<{ paymentCycle: string; members: number }>;
  } = {}) {
    const repo = {
      today: jest.fn(async () => o.today ?? '2026-07-13'),
      membershipCycleMix: jest.fn(async () => o.cycleMix ?? [{ paymentCycle: 'fortnightly', members: 312 }]),
      dailyQuality: jest.fn(async () => o.daily ?? [dayRow(), dayRow({ day: '2026-07-02' })]),
      cardsInForce: jest.fn(async () => o.cards ?? [card()]),
      animalMix: jest.fn(async () => o.mix ?? [{ animalType: 'buffalo', pours: 40 }]),
      premiumBandCounts: jest.fn(async () => o.band ?? { pourers: 312, earned: 0, wouldQualify: 184 }),
      exemplarPour: jest.fn(async () => (o.exemplar === undefined ? { weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n } : o.exemplar)),
      reviewContext: jest.fn(async () => ({ memberCode: 'AND2-0087', mccCode: 'MCC-AND-02' })),
    };
    const reviews = {
      countsForWindow: jest.fn(async () => o.counts ?? { total: 0, byStatus: {}, byReason: {}, withheldMinor: 0n }),
      listFor: jest.fn(async () => o.reviews ?? []),
    };
    const flags = { isEnabled: jest.fn(async () => o.flagOn === true) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    return { rm: new DairyQualityReadModel(repo as never, reviews as never, flags as never, metrics as never), repo, reviews, flags };
  }

  it('derives the cycle the same way the counter board does, from the DATABASE day and the members\' preference', async () => {
    const h = harness({ today: '2026-07-13' });
    const v = await h.rm.view('t1', {});
    expect(h.repo.today).toHaveBeenCalled();
    expect(v.window).toMatchObject({ from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly', basis: 'derived_from_membership_preference' });
  });

  it('honours an explicitly asked-for cycle and day', async () => {
    const h = harness();
    const v = await h.rm.view('t1', { day: '2026-07-20', cycle: 'monthly' });
    expect(v.window).toMatchObject({ from: '2026-07-01', to: '2026-07-31', cycle: 'monthly' });
    expect(h.repo.today).not.toHaveBeenCalled();
  });

  it('asks the bonus flag ONCE and carries the answer into every figure that depends on it', async () => {
    const h = harness({ flagOn: false });
    const v = await h.rm.view('t1', {});
    expect(h.flags.isEnabled).toHaveBeenCalledTimes(1);
    expect(h.flags.isEnabled).toHaveBeenCalledWith(BONUS_SLABS_FLAG, { tenantId: 't1' });
    expect(v.slabsApplied).toBe(false);
    expect(v.premiumBand.kind === 'measured' && v.premiumBand.basis).toBe('would_qualify');
    expect(v.example!.bonusApplied).toBe(false);
    expect(v.example!.bonusMinor).toBe(0n);
  });

  it('switches the band and the example to EARNED together when the flag is on', async () => {
    const h = harness({ flagOn: true, band: { pourers: 312, earned: 184, wouldQualify: 200 } });
    const v = await h.rm.view('t1', {});
    expect(v.premiumBand).toMatchObject({ basis: 'earned', qualifying: 184 });
    expect(v.example!.bonusApplied).toBe(true);
    expect(v.example!.bonusMinor).toBe(355n);
  });

  it('measures the band against the card the BIGGEST herd is actually on', async () => {
    const h = harness({
      cards: [card({ id: 'buf', animalType: 'buffalo', slabs: [FAT_SLAB] }), card({ id: 'cow', animalType: 'cow', slabs: [] })],
      mix: [{ animalType: 'cow', pours: 90 }, { animalType: 'buffalo', pours: 10 }],
    });
    const v = await h.rm.view('t1', {});
    // The cow herd poured most, and its card promises no slab — so the band is refused rather than borrowed from buffalo.
    expect(v.premiumBand).toEqual({ kind: 'no_slabs' });
    expect(v.example!.cardId).toBe('cow');
  });

  it('falls back to an illustrative example when the cycle has no pour on the card, and SAYS so', async () => {
    const h = harness({ exemplar: null });
    const v = await h.rm.view('t1', {});
    expect(v.example!.fromRealPour).toBe(false);
    expect(v.example!.litres).toBe('7.1');                    // the canon's own illustration
    const real = await harness({}).rm.view('t1', {});
    expect(real.example!.fromRealPour).toBe(true);
  });

  /* [MUTATION GAP] The default exemplar happened to be 7.1 L — the same as the canon's illustration — so ignoring the
   * real pour entirely survived. The example has to come from THIS cooperative's milk, or a farmer cannot recognise it. */
  it('works the example from the tenant\'s OWN pour, not from the canon\'s illustration', async () => {
    const h = harness({ exemplar: { weightMilliKg: 12_500n, fatCentiPct: 590n, snfCentiPct: 870n } });
    const v = await h.rm.view('t1', {});
    expect(v.example!.litres).toBe('12.5');
    expect(v.example!.fatPct).toBe('5.90');
    expect(v.example!.fromRealPour).toBe(true);
    expect(v.example!.slabsEarned).toEqual([]);               // 5.90 does not clear the 6.5 band
  });

  /* [MUTATION GAP] No read-model test looked at the flag rows, so shipping the WHOLE member code out of the API
   * survived — on a screen the canon deliberately masks. */
  it('MASKS the member on every flag row it emits', async () => {
    const review = {
      toJSON: () => ({
        id: 'qr1', collectionId: 'c1', collectedOn: '2026-07-13', membershipId: 'mem1', mccId: 'm1', shift: 'morning',
        status: 'open', holdState: 'held', waterFlag: true, reasons: [], densityAtFlag: '1.024',
        fatPctAtFlag: '6.20', snfPctAtFlag: '8.40', amountWithheldMinor: '31000', currencyCode: 'INR',
        sampleSealed: false, openedAt: null, openedBy: 'op1', retestAt: null, retestBy: null, memberPresent: null,
        outcomeNote: null, decidedAt: null, decidedBy: null, priorReviews90d: 0, committeeReviewRequired: false,
      }),
    };
    const h = harness({ reviews: [review], counts: { total: 1, byStatus: { open: 1 }, byReason: { water_flag: 1 }, withheldMinor: 31_000n } });
    const v = await h.rm.view('t1', {});
    expect(v.openFlags).toHaveLength(1);
    expect(v.openFlags[0].memberCodeMasked).toBe('AND2••87');
    expect(v.openFlags[0].memberCodeMasked).not.toContain('0087');
    expect(v.openFlags[0].mccCode).toBe('MCC-AND-02');
    expect(v.currencyCode).toBe('INR');
  });

  it('has no example at all when no card is in force — there is nothing to work an example from', async () => {
    const h = harness({ cards: [] });
    const v = await h.rm.view('t1', {});
    expect(v.example).toBeNull();
    expect(v.rateCards.byAnimal).toEqual([]);
  });

  it('checks W168\'s "all resolved or in review" claim instead of printing it', async () => {
    const open = await harness({ counts: { total: 4, byStatus: { open: 1, cleared: 3 }, byReason: { water_flag: 3, starch: 1 }, withheldMinor: 31_000n } }).rm.view('t1', {});
    expect(open.flags.allResolvedOrInReview).toBe(false);
    expect(open.flags.openCount).toBe(1);

    const handled = await harness({ counts: { total: 4, byStatus: { retested: 1, cleared: 3 }, byReason: {}, withheldMinor: 0n } }).rm.view('t1', {});
    expect(handled.flags.allResolvedOrInReview).toBe(true);    // re-tested IS in review
  });

  it('bounds the flag queue to the cycle and to the pours whose money is held NOW', async () => {
    const h = harness();
    const v = await h.rm.view('t1', {});
    expect(h.reviews.listFor).toHaveBeenCalledWith('t1', { status: 'open_any', from: v.window.from, to: v.window.to, limit: 20 });
  });

  it('states the promises TENANT-6b-1 made true, and refuses the committee', async () => {
    const v = await harness().rm.view('t1', {});
    expect(v.quarantineScope).toBe('pour');
    expect(v.protocol).toMatchObject({ retest: 'recorded', decision: 'recorded', committee: 'not_modelled' });
    expect(v.rateCards.checkerRequired).toBe(false);
    expect(v.rateCards.supersedeRecorded).toBe(false);
  });
});
