// modules/dairy/__tests__/tenant6a-counter.spec.ts · PC-56 TENANT-6a — W167 (Dairy — collections).
//
// W167's lead makes four claims in one sentence — 312 pourers, two shifts, Lactoscan-metered fat/SNF, every drop rated
// by the active rate card, on a cycle that closes Wednesday and pays Friday. The suite is organised around which of
// them the database can support, because this screen is about 312 families' milk money and a plausible figure here
// becomes somebody's week.
//
// Behaviour, not source text: the verdicts run, the SQL is EXECUTED against capturing fakes, and the aggregate
// arithmetic is checked at the boundaries where a mean-of-means or a float would show up.
import {
  POUR_UNIQUENESS, SHIFTS,
  accrualVerdict, analyzerVerdict, bmcTempVerdict, boardTotals, coverage, cycleWindow, flagSummary, isShift,
  litresText, paydayVerdict, pctText, shiftClockVerdict,
  type CentreShiftRow,
} from '../domain/dairy-counter';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyCounterReadModel } from '../read-models/dairy-counter.read-model';

/* ----------------------------------------------------------------------------------------------------------- */
/* helpers                                                                                                     */
/* ----------------------------------------------------------------------------------------------------------- */

const centre = (o: Partial<CentreShiftRow> = {}): CentreShiftRow => ({
  mccId: 'm1', code: 'MCC-AND-01', name: 'Vanthali',
  analyzerModel: 'Lactoscan SP', analyzerSerial: 'LS-412',
  pours: 102, pourers: 102, weightMilliKg: 824_000n,
  fatCentiPctWeighted: 660n, snfCentiPctWeighted: 900n,
  amountMinor: 4_500_000n, flags: 0, membershipsEnrolled: 108,
  // [TENANT-6d-2] The centre's own hours for the shift shown (0163). Null is the pre-6d-2 world and still the
  // honest value for a cooperative that has recorded none.
  shiftWindow: null, ...o,
});

function capturing(rowsFor: (sql: string) => unknown[] = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: rowsFor(sql) };
  });
  return { repo: new DairyCounterRepository({ forTenant: () => ({ query }) } as never), calls, sqlOf: (n: string) => calls.find((c) => c.sql.includes(n)) };
}

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the shift, and the clock nobody set', () => {
  it('accepts only the two shifts the column allows', () => {
    expect(SHIFTS).toEqual(['morning', 'evening']);
    expect(isShift('morning')).toBe(true);
    expect(isShift('night')).toBe(false);
    expect(isShift(undefined)).toBe(false);
  });

  // [PC-56 TENANT-6d-2] THE REFUSAL SURVIVES, AS A CONDITION. When TENANT-6a wrote this there was no column, no
  // setting and no schedule anywhere on the platform; migration 0163 put a window on the CENTRE, per shift, so the
  // verdict became a function of the board. What the assertion protects now is that the refusal still happens for a
  // cooperative that has recorded nothing — and that it names columns which EXIST, so a secretary can act on it.
  it('refuses to print a shift hour while no centre has recorded one, naming the columns to fill', () => {
    expect(shiftClockVerdict('evening', [])).toEqual({
      kind: 'not_recorded', missing: ['mcc_centres.evening_opens_at', 'mcc_centres.evening_closes_at'],
    });
    expect(shiftClockVerdict('morning', [null, null, null])).toEqual({
      kind: 'not_recorded', missing: ['mcc_centres.morning_opens_at', 'mcc_centres.morning_closes_at'],
    });
  });

  it('prints W167\'s hour when every centre on the board keeps the same one', () => {
    const w = { opens: '17:00', closes: '20:00' };
    expect(shiftClockVerdict('evening', [w, { ...w }, { ...w }]))
      .toEqual({ kind: 'recorded', opens: '17:00', closes: '20:00', centres: 3 });
  });

  it('refuses a tenant-level hour when the centres disagree, or when only some have recorded one', () => {
    // Three villages, three evenings. A single "evening starts 17:00" over that is the sentence that sends a farmer
    // to a closed door — which is the whole reason TENANT-6a refused to print one.
    expect(shiftClockVerdict('evening', [{ opens: '17:00', closes: '20:00' }, { opens: '17:30', closes: '20:30' }]))
      .toEqual({ kind: 'mixed', centres: 2, recorded: 2 });
    // And a board where two of three have recorded hours is MIXED, not "recorded" — the third centre's farmers would
    // otherwise read an opening time that is nobody's.
    expect(shiftClockVerdict('morning', [{ opens: '06:00', closes: '09:00' }, { opens: '06:00', closes: '09:00' }, null]))
      .toEqual({ kind: 'mixed', centres: 3, recorded: 2 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the cycle window, derived because nothing defines one', () => {
  it('gives the canon\'s own fortnight for a day in either half of the month', () => {
    expect(cycleWindow('2026-07-13', 'fortnightly')).toEqual({
      from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly', basis: 'derived_from_membership_preference',
    });
    expect(cycleWindow('2026-07-16', 'fortnightly')).toMatchObject({ from: '2026-07-16', to: '2026-07-31' });
    // February, and a leap February, end where the month ends — not on the 30th.
    expect(cycleWindow('2027-02-20', 'fortnightly')).toMatchObject({ from: '2027-02-16', to: '2027-02-28' });
    expect(cycleWindow('2028-02-20', 'fortnightly')).toMatchObject({ from: '2028-02-16', to: '2028-02-29' });
    // The 15th belongs to the FIRST half and the 16th to the second — the boundary the canon prints.
    expect(cycleWindow('2026-07-15', 'fortnightly')).toMatchObject({ to: '2026-07-15' });
  });

  it('runs a week Monday to Sunday, including on a Sunday', () => {
    // 2026-07-13 is a Monday. Sunday must go BACK six days, not forward one — `getUTCDay()` is 0 on Sunday, which is
    // exactly how a week silently starts on the wrong day.
    expect(cycleWindow('2026-07-13', 'weekly')).toMatchObject({ from: '2026-07-13', to: '2026-07-19' });
    expect(cycleWindow('2026-07-19', 'weekly')).toMatchObject({ from: '2026-07-13', to: '2026-07-19' });
    expect(cycleWindow('2026-07-18', 'weekly')).toMatchObject({ from: '2026-07-13', to: '2026-07-19' });
  });

  it('gives the day for daily and the calendar month for monthly', () => {
    expect(cycleWindow('2026-07-13', 'daily')).toMatchObject({ from: '2026-07-13', to: '2026-07-13' });
    expect(cycleWindow('2026-07-13', 'monthly')).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('labels the window DERIVED, because deriving one is not the same as reading a row', () => {
    // [PC-56 TENANT-6c-6] `dairy_memberships.payment_cycle` was read by nothing when 6a wrote this. The cycle is a ROW
    // now (0157) — and it is created from THIS function, so the derived window and the recorded one are the same
    // window by construction. The label stays `derived` because that is still what the boards computed.
    for (const c of ['daily', 'weekly', 'fortnightly', 'monthly'] as const) {
      expect(cycleWindow('2026-07-13', c).basis).toBe('derived_from_membership_preference');
    }
  });

  it('names the RECORDED payday, and refuses only when no cycle row exists for the window', () => {
    const w = cycleWindow('2026-07-13', 'fortnightly');
    // [PC-56 TENANT-6c-6] This assertion used to demand an unconditional refusal, which is how the counter board came
    // to tell every operator for five waves that the platform could not say when they would be paid. 0157 says when.
    expect(paydayVerdict(w, { id: 'c1', payday: '2026-07-17', status: 'closed' })).toEqual({
      kind: 'recorded', closesOn: '2026-07-15', payday: '2026-07-17', cycleId: 'c1', cycleStatus: 'closed', batchBuilt: false,
    });
    // No row for the window ⇒ the cadence has not run for this tenant. A different sentence, and an actionable one.
    expect(paydayVerdict(w)).toEqual({
      kind: 'not_recorded', closesOn: '2026-07-15', missing: ['dairy_cycle_row_for_window', 'dairy_cycle_close_flag'],
    });
    // What stays refused either way: the canon's "one bank trip". No payout batch over a cycle exists anywhere.
    expect(paydayVerdict(w, { id: 'c1', payday: '2026-07-17', status: 'closed' })).toMatchObject({ batchBuilt: false });
  });

});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the day\'s arithmetic', () => {
  it('renders litres from milli-kg with one decimal, rounding half up', () => {
    expect(litresText(824_000n)).toBe('824.0');
    expect(litresText(2_148_450n)).toBe('2148.5');
    expect(litresText(50n)).toBe('0.1');
    expect(litresText(49n)).toBe('0.0');
    expect(litresText(0n)).toBe('0.0');
  });

  it('renders fat/SNF from centi-percent, and NOTHING when there was nothing to average', () => {
    expect(pctText(660n)).toBe('6.6');
    expect(pctText(895n)).toBe('9.0');
    // A centre with no pours has no quality; "0.0" would read as water.
    expect(pctText(null)).toBeNull();
  });

  it('weights the tenant\'s averages BY LITRES, not as a mean of the centres\' means', () => {
    // 900 L at 7.0 fat and 100 L at 5.0 fat is 6.8 weighted — a mean of means would say 6.0 and put the whole
    // tenant in a different quality band.
    const t = boardTotals([
      centre({ mccId: 'a', weightMilliKg: 900_000n, fatCentiPctWeighted: 700n, snfCentiPctWeighted: 900n }),
      centre({ mccId: 'b', weightMilliKg: 100_000n, fatCentiPctWeighted: 500n, snfCentiPctWeighted: 800n }),
    ]);
    expect(pctText(t.fatCentiPctWeighted)).toBe('6.8');
    expect(pctText(t.snfCentiPctWeighted)).toBe('8.9');
  });

  /* [MUTATION GAP] Every weighted case above divided exactly, so truncating the weighted average instead of rounding
   * it survived. A centi-percent lost here is a quality BAND a whole tenant can fall out of. */
  it('rounds the weighted average half up rather than truncating the last centi-percent', () => {
    const t = boardTotals([
      centre({ mccId: 'a', weightMilliKg: 1_000n, fatCentiPctWeighted: 700n, snfCentiPctWeighted: 701n }),
      centre({ mccId: 'b', weightMilliKg: 1_000n, fatCentiPctWeighted: 701n, snfCentiPctWeighted: 700n }),
    ]);
    expect(t.fatCentiPctWeighted).toBe(701n);      // 1401/2 = 700.5 → 701, not 700
    expect(t.snfCentiPctWeighted).toBe(701n);
  });

  it('sums litres, money, pours, pourers and flags across centres', () => {
    const t = boardTotals([
      centre({ weightMilliKg: 824_000n, amountMinor: 4_500_000n, pours: 102, pourers: 102, flags: 0, membershipsEnrolled: 108 }),
      centre({ mccId: 'm2', weightMilliKg: 716_000n, amountMinor: 3_900_000n, pours: 98, pourers: 98, flags: 1, membershipsEnrolled: 104 }),
      centre({ mccId: 'm3', weightMilliKg: 608_000n, amountMinor: 3_300_000n, pours: 87, pourers: 87, flags: 0, membershipsEnrolled: 100 }),
    ]);
    expect(litresText(t.weightMilliKg)).toBe('2148.0');   // the canon's own morning total
    expect(t.amountMinor).toBe(11_700_000n);
    expect(t.pourers).toBe(287);
    expect(t.membershipsEnrolled).toBe(312);
    expect(t.flags).toBe(1);
  });

  it('reports no quality at all when nothing was poured anywhere', () => {
    const t = boardTotals([centre({ weightMilliKg: 0n, fatCentiPctWeighted: null, snfCentiPctWeighted: null, pours: 0, pourers: 0 })]);
    expect(t.fatCentiPctWeighted).toBeNull();
    expect(pctText(t.snfCentiPctWeighted)).toBeNull();
  });

  it('gives W167\'s "287 of 312" as a pair AND a share, and refuses a share with no roll', () => {
    expect(coverage({ pourers: 287, membershipsEnrolled: 312 })).toEqual({ kind: 'measured', poured: 287, enrolled: 312, shareBps: 9199 });
    expect(coverage({ pourers: 0, membershipsEnrolled: 0 })).toEqual({ kind: 'no_memberships' });
    // Everybody poured: exactly 100%, not 99.99 from a float.
    expect(coverage({ pourers: 312, membershipsEnrolled: 312 })).toMatchObject({ shareBps: 10_000 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the analyzer, the cooler and the flags', () => {
  it('says an analyzer is ON FILE FOR THE CENTRE and never that it metered a pour', () => {
    // `milk_collections.device_payload` — the column built for the analyzer's own reading — is dead: no writer, no
    // reader, anywhere. W168 hangs an adulteration flag and a member's money on that reading.
    const v = analyzerVerdict({ model: 'Lactoscan SP', serial: 'LS-412' });
    expect(v).toEqual({ kind: 'on_file', model: 'Lactoscan SP', serial: 'LS-412', perPourEvidence: false });
    expect(analyzerVerdict({ model: null, serial: null })).toEqual({ kind: 'none_on_file' });
    // A serial-less analyzer is still on file; the serial is what a service engineer needs, not what makes it real.
    expect(analyzerVerdict({ model: 'Lactoscan SP', serial: null })).toMatchObject({ kind: 'on_file', serial: null });
  });

  it('distinguishes no cooler, a cooler with no readings, and a reading over target', () => {
    // `bmc_units` has had no application code since 0007 and no cold-chain reading has ever been written for one, so
    // the middle case is today's reality on every tenant — and it is NOT the same as having no cooler.
    expect(bmcTempVerdict({ unitId: null, targetC: null, tempC: null, recordedAt: null })).toEqual({ kind: 'no_unit' });
    expect(bmcTempVerdict({ unitId: 'b1', targetC: '4.0', tempC: null, recordedAt: null }))
      .toEqual({ kind: 'no_readings', unitId: 'b1', targetC: '4.0' });
    expect(bmcTempVerdict({ unitId: 'b1', targetC: '4.0', tempC: '3.8', recordedAt: 'x' }))
      .toEqual({ kind: 'reading', tempC: '3.8', recordedAt: 'x', targetC: '4.0', overTarget: false });
    expect(bmcTempVerdict({ unitId: 'b1', targetC: '4.0', tempC: '6.9', recordedAt: 'x' })).toMatchObject({ overTarget: true });
    // Exactly at target is not over it — the canon's own tolerance talk starts above the target.
    expect(bmcTempVerdict({ unitId: 'b1', targetC: '4.0', tempC: '4.0', recordedAt: 'x' })).toMatchObject({ overTarget: false });
    // A reading with no target cannot be judged, and is not silently called fine... it is reported as a reading with
    // overTarget false, because there is nothing to exceed. The console prints the number either way.
    expect(bmcTempVerdict({ unitId: 'b1', targetC: null, tempC: '9.9', recordedAt: 'x' })).toMatchObject({ kind: 'reading', overTarget: false });
  });

  it('counts flags by kind, keeps water separate, and says the workflow does not exist', () => {
    const f = flagSummary([
      { waterFlag: true, adulterationFlags: [] },
      { waterFlag: false, adulterationFlags: ['starch'] },
      { waterFlag: true, adulterationFlags: ['urea', 'detergent'] },
      { waterFlag: false, adulterationFlags: [] },
    ]);
    expect(f.water).toBe(2);
    expect(f.other).toBe(2);
    expect(f.kinds).toEqual(['detergent', 'starch', 'urea', 'water_flag']);
    // W167 promises "sample retained · handled with dignity". Nothing after the flag is recorded anywhere.
    expect(f.workflow).toBe('not_built');
  });

  /* [LIVE FINDING] The tile counted MARKERS while the table's own column counts POURS, so one doubly-flagged pour
   * printed 2 above a row that said 1 — two mechanisms over one fact, on the number that decides how many samples
   * get re-tested. `total` is now flagged POURS, the same quantity the SQL column counts. */
  it('counts flagged POURS, so a pour flagged twice is ONE sample to chase', () => {
    const f = flagSummary([{ waterFlag: true, adulterationFlags: ['urea', 'detergent'] }]);
    expect(f.total).toBe(1);
    expect(f.water).toBe(1);
    expect(f.other).toBe(1);
    expect(f.kinds).toEqual(['detergent', 'urea', 'water_flag']);
  });

  it('never lets water and other be added together into a total larger than the pours', () => {
    const rows = [
      { waterFlag: true, adulterationFlags: [] },
      { waterFlag: false, adulterationFlags: ['starch'] },
      { waterFlag: true, adulterationFlags: ['urea'] },
    ];
    const f = flagSummary(rows);
    expect(f.total).toBe(3);
    expect(f.water + f.other).toBeGreaterThan(f.total);   // OVERLAPPING subsets, documented as such
  });

  it('skips a row carrying no flag at all rather than counting the query\'s mistake as a flag', () => {
    expect(flagSummary([{ waterFlag: false, adulterationFlags: [] }]).total).toBe(0);
  });

  it('ignores an empty string in the flags array rather than counting a nameless flag', () => {
    expect(flagSummary([{ waterFlag: false, adulterationFlags: [''] }])).toMatchObject({ total: 0, other: 0, kinds: [] });
  });

  it('reports a clean day as zero, with no kinds', () => {
    expect(flagSummary([])).toEqual({ total: 0, water: 0, other: 0, kinds: [], workflow: 'not_built' });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the accrual, and the premium it does not contain', () => {
  const w = cycleWindow('2026-07-13', 'fortnightly');

  it('reports the money as an ACCRUAL with its window and currency', () => {
    const a = accrualVerdict({ amountMinor: 248_820_000n, currencyCode: 'INR', window: w, cardsWithBonusRules: 0, membersWithPours: 312, billsExisting: 0 });
    expect(a).toMatchObject({ kind: 'accrued', amountMinor: '248820000', currencyCode: 'INR', membersWithPours: 312, billsExisting: 0 });
    expect(a.window.from).toBe('2026-07-01');
  });

  it('flags that the bonus slab was ignored whenever a card carrying one priced the window', () => {
    // `milk_rate_cards.bonus_rules` is read by NOTHING: the pricing engine's own header calls the slabs "DEFERRED",
    // so W168's "fat ≥ 6.5 → +₹0.50/L" has never been paid to anybody.
    expect(accrualVerdict({ amountMinor: 1n, currencyCode: 'INR', window: w, cardsWithBonusRules: 1, membersWithPours: 1, billsExisting: 0 }).bonusRulesIgnored).toBe(true);
    expect(accrualVerdict({ amountMinor: 1n, currencyCode: 'INR', window: w, cardsWithBonusRules: 0, membersWithPours: 1, billsExisting: 0 }).bonusRulesIgnored).toBe(false);
  });

  it('carries the tenant\'s own currency rather than assuming rupees', () => {
    // Rule Zero: a hardcoded ₹ caps the platform to one country, and dairy cooperatives are the first thing a
    // neighbouring country's federation would run.
    expect(accrualVerdict({ amountMinor: 1n, currencyCode: 'BDT', window: w, cardsWithBonusRules: 0, membersWithPours: 1, billsExisting: 0 }).currencyCode).toBe('BDT');
  });

  it('keeps members-who-poured and bills-that-exist as SEPARATE numbers', () => {
    // W167 prints "312 milk_bills building". Nothing generates bills on a clock (MilkBillCycleCloseJob is
    // instantiated nowhere), so the gap between these two numbers IS the finding.
    const a = accrualVerdict({ amountMinor: 1n, currencyCode: 'INR', window: w, cardsWithBonusRules: 0, membersWithPours: 312, billsExisting: 0 });
    expect(a.membersWithPours).not.toBe(a.billsExisting);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the SQL that did not exist', () => {
  it('bounds the board by the DAY, which is also the partition key', async () => {
    const { repo, sqlOf } = capturing();
    await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    const sql = sqlOf('FROM milk_collections c')!.sql;
    expect(sql).toContain('c.collected_on = $2::date');
    expect(sql).toContain('c.tenant_id=$1');
    expect(sql).toContain('c.shift = $3');
  });

  it('weights the averages inside the DATABASE, per litre', async () => {
    const { repo, sqlOf } = capturing();
    await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    const sql = sqlOf('FROM milk_collections c')!.sql;
    expect(sql).toContain('sum(c.fat_pct * c.weight_kg) / sum(c.weight_kg)');
    expect(sql).toContain('sum(c.snf_pct * c.weight_kg) / sum(c.weight_kg)');
  });

  it('keeps a centre that collected NOTHING on the board', async () => {
    // It is 09:00 and Keshod has collected nothing — that is the row an operator most needs to see, and a centre
    // missing from a board reads as "no centre".
    const { repo, sqlOf } = capturing((sql) => (sql.includes('FROM mcc_centres m')
      ? [{ mcc_id: 'm3', code: 'MCC-AND-03', default_name: 'Keshod', analyzer_model: 'Lactoscan SP', analyzer_serial: null,
          pours: 0, pourers: 0, weight_milli_kg: '0', fat_centi: null, snf_centi: null, amount_minor: '0', flags: 0, memberships: 100 }]
      : []));
    const rows = await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    expect(sqlOf('FROM mcc_centres m')!.sql).toContain('LEFT JOIN pours');
    expect(rows[0]).toMatchObject({ pours: 0, weightMilliKg: 0n, fatCentiPctWeighted: null, membershipsEnrolled: 100 });
  });

  it('counts the accrual over the WINDOW and the cards whose bonus rules were ignored', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('cards_with_bonus') ? [{ amount_minor: '248820000', members: 312, cards_with_bonus: 1 }] : []));
    const out = await repo.accrual('t1', '2026-07-01', '2026-07-15');
    expect(out).toEqual({ amountMinor: 248_820_000n, membersWithPours: 312, cardsWithBonusRules: 1 });
    const sql = sqlOf('cards_with_bonus')!.sql;
    expect(sql).toContain('c.collected_on >= $2::date');
    expect(sql).toContain('c.collected_on <= $3::date');
    expect(sql).toContain('rc.bonus_rules IS NOT NULL');
    /* [MUTATION GAP] `IS NOT NULL` alone counts an EMPTY `{}`/`[]` as a bonus band the engine ignored, which would
     * print "your premium band pays nothing" on every tenant whose card simply has no bands — crying wolf about a
     * real defect until nobody reads the sentence. Both empty shapes must be excluded. */
    expect(sql).toContain("rc.bonus_rules <> '{}'::jsonb");
    expect(sql).toContain("rc.bonus_rules <> '[]'::jsonb");
  });

  it('reads the cooler stream by subject_type = bmc_unit, bounded to a day of readings', async () => {
    const { repo, sqlOf } = capturing();
    await repo.bmcForCentres('t1');
    const sql = sqlOf('bmc_units')!.sql;
    expect(sql).toContain("subject_type = 'bmc_unit'");
    expect(sql).toContain("recorded_at >= (now() - interval '24 hours')");
    // LATERAL + LIMIT 1: the LATEST reading per centre, not a join that multiplies rows by readings.
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('ORDER BY recorded_at DESC, id DESC LIMIT 1');
  });

  it('counts only ACTIVE, undeleted centres and memberships', async () => {
    const { repo, calls } = capturing();
    await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    await repo.membershipCycleMix('t1');
    for (const c of calls) {
      expect(c.sql).toContain('is_active = true');
      expect(c.sql).toContain('deleted_at IS NULL');
    }
  });

  /* [MUTATION GAP] The read model takes `mix[0]` as the tenant's default cycle, so the ORDER of this result IS the
   * decision — ordered the other way, a tenant with 200 fortnightly and 4 daily members gets a one-day window. */
  it('returns the membership mix MOST COMMON FIRST, because the desk takes the first row as the default', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('payment_cycle')
      ? [{ payment_cycle: 'fortnightly', n: 200 }, { payment_cycle: 'daily', n: 4 }] : []));
    const mix = await repo.membershipCycleMix('t1');
    expect(mix[0]).toEqual({ paymentCycle: 'fortnightly', members: 200 });
    expect(sqlOf('payment_cycle')!.sql).toContain('ORDER BY n DESC');
  });

  /* [MUTATION GAP] "Today" shifting by a day would move an entire morning's milk onto the wrong board — and a
   * board asked for `today` on a day nobody poured looks exactly like a centre that has not opened. */
  it('asks the DATABASE for its own calendar day, unshifted', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('current_date') ? [{ d: '2026-07-13' }] : []));
    expect(await repo.today('t1')).toBe('2026-07-13');
    const sql = sqlOf('current_date')!.sql;
    expect(sql).toContain('current_date::text');
    expect(sql).not.toMatch(/current_date\s*[-+]/);
  });

  /* [MUTATION GAP] The loop above passes as long as EACH clause appears SOMEWHERE in the statement, so dropping
   * `m.is_active` from the centre list — or `deleted_at` from the roll — left it green while a closed centre came back
   * onto the board and deleted memberships inflated the denominator of W167's turnout. Each clause is now pinned to
   * the relation it guards. */
  it('guards the centre list and the membership roll SEPARATELY, each on its own alias', async () => {
    const { repo, sqlOf } = capturing();
    await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    const sql = sqlOf('WITH pours')!.sql;
    // the centre list: a closed or deleted MCC is not a row on today's board
    expect(sql).toContain('m.deleted_at IS NULL AND m.is_active = true');
    // the roll: a deleted membership must not make turnout look worse than it was
    expect(sql).toContain('m.is_active = true AND m.deleted_at IS NULL');
    expect(sql).toContain('r.deleted_at IS NULL');
  });

  /**
   * [PC-56 TENANT-6d-3] THE ROLL IS AS OF THIS BOARD'S DAY.
   *
   * It counted `dairy_memberships GROUP BY mcc_id` — the CURRENT routing — for a board whose day is a parameter, so
   * last Tuesday's *"104 pourers against a roll of 108"* was measured against this morning's roll. Once a membership
   * can move (TENANT-6d-3) that is not merely imprecise: the denominator lands at the wrong centre.
   */
  it('counts the roll from the ROUTE HISTORY, bounded by the board\'s own day', async () => {
    const { repo, sqlOf } = capturing();
    await repo.centreShiftRows('t1', '2026-07-13', 'morning');
    const sql = sqlOf('WITH pours')!.sql;
    expect(sql).toContain('FROM dairy_membership_routes r');
    // Inclusive at both ends, matching 0164's exclusion constraint and `dairy_route_asof` — a half-open convention
    // here would leave one day a year counted at two centres.
    expect(sql).toContain('r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)');
    expect(sql).toContain('GROUP BY r.mcc_id');
    // …and it must not have gone back to the current-routing shortcut.
    expect(sql).not.toMatch(/FROM dairy_memberships\s+WHERE tenant_id=\$1 AND is_active = true/);
  });

  it('reads the tenant\'s currency from its country rather than hardcoding one', async () => {
    const { repo, sqlOf } = capturing((sql) => (sql.includes('currency_code') ? [{ currency_code: 'BDT' }] : []));
    expect(await repo.currencyCode('t1')).toBe('BDT');
    expect(sqlOf('currency_code')!.sql).toContain('JOIN countries');
  });

  it('falls back to INR only when the tenant has no country currency at all', async () => {
    const { repo } = capturing(() => []);
    expect(await repo.currencyCode('t1')).toBe('INR');
  });

  it('clamps the flag list so a bad day cannot ask for the whole partition', async () => {
    const { repo, sqlOf } = capturing();
    await repo.flagsForDay('t1', '2026-07-13', 'morning', 10_000);
    expect(sqlOf('water_flag')!.sql).toContain('LIMIT 500');
  });

  /* [LIVE FINDING] This read was day-wide beside a shift-wide table, so the morning tile counted the evening's
   * flags. The board is a shift; so is the tile. */
  it('bounds the flag list by the SHIFT as well as the day, so the tile matches the table beside it', async () => {
    const { repo, sqlOf } = capturing();
    await repo.flagsForDay('t1', '2026-07-13', 'evening');
    const q = sqlOf('water_flag')!;
    expect(q.sql).toContain('collected_on = $2::date');
    expect(q.sql).toContain('shift = $3');
    expect(q.params).toEqual(['t1', '2026-07-13', 'evening']);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-6a · the read model composes W167', () => {
  function harness(o: {
    cycleRow?: { id: string; payday: string; status: string };
    rows?: unknown[]; bmc?: unknown[]; flags?: unknown[];
    accrual?: { amountMinor: bigint; membersWithPours: number; cardsWithBonusRules: number };
    bills?: number; mix?: Array<{ paymentCycle: string; members: number }>; today?: string; currency?: string;
  } = {}) {
    const repo = {
      today: jest.fn(async () => o.today ?? '2026-07-13'),
      membershipCycleMix: jest.fn(async () => o.mix ?? [{ paymentCycle: 'fortnightly', members: 200 }, { paymentCycle: 'weekly', members: 112 }]),
      centreShiftRows: jest.fn(async () => o.rows ?? [centre()]),
      bmcForCentres: jest.fn(async () => o.bmc ?? [{ mccId: 'm1', unitId: null, targetC: null, tempC: null, recordedAt: null }]),
      flagsForDay: jest.fn(async (t: string, day: string, shift: string) => { void t; void day; void shift; return o.flags ?? []; }),
      accrual: jest.fn(async (t: string, from: string, to: string) => { void t; void from; void to; return o.accrual ?? { amountMinor: 4_500_000n, membersWithPours: 102, cardsWithBonusRules: 0 }; }),
      billsInWindow: jest.fn(async () => o.bills ?? 0),
      currencyCode: jest.fn(async () => o.currency ?? 'INR'),
    };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    // [PC-56 TENANT-6c-6] The board now reads the CYCLE ROW for the window it is showing, because the payday tile
    // stopped refusing unconditionally: 0157 records a payday and this desk told operators otherwise for five waves.
    // `o.cycleRow === undefined` keeps the old behaviour (no row for the window ⇒ still refused).
    const cycles = { findByWindow: jest.fn(async () => (o.cycleRow ? { toProps: () => o.cycleRow } : null)) };
    const replica = { forTenant: () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })) }) };
    // [PC-56 TENANT-6d-6] Both sides of a diversion for the day and shift being shown — empty here, because this
    // harness is about the board's own arithmetic and a cooperative with no diversions is the ordinary case.
    const diversions = { sidesFor: jest.fn(async () => new Map()) };
    return {
      rm: new DairyCounterReadModel(repo as never, cycles as never, diversions as never, replica as never, metrics as never),
      repo, cycles, diversions,
    };
  }

  it('the board reads the cycle row for the window it is showing, and names its payday', async () => {
    const h = harness({ cycleRow: { id: 'c1', payday: '2026-07-17', status: 'closed' } });
    const board = await h.rm.board('t1', { shift: 'morning' });
    expect(h.cycles.findByWindow).toHaveBeenCalled();
    expect(board.payday).toMatchObject({ kind: 'recorded', payday: '2026-07-17', cycleId: 'c1' });
    const none = await harness().rm.board('t1', { shift: 'morning' });
    expect(none.payday.kind).toBe('not_recorded');
  });

  it('resolves the day from the DATABASE when none was asked for', async () => {
    // A counter stamping `current_date` and a desk reading a JS date must not disagree about which day a pour is in.
    const h = harness({ today: '2026-07-14' });
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.day).toBe('2026-07-14');
    expect(h.repo.today).toHaveBeenCalled();
  });

  it('defaults the accrual window to the tenant\'s MOST COMMON membership preference', async () => {
    const h = harness({ mix: [{ paymentCycle: 'weekly', members: 214 }, { paymentCycle: 'fortnightly', members: 64 }] });
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.window.cycle).toBe('weekly');
    expect(h.repo.accrual).toHaveBeenCalledWith('t1', b.window.from, b.window.to);
    // …and reports the mix, because a weekly window is the wrong answer for the 64 fortnightly members.
    expect(b.cycleMix).toHaveLength(2);
  });

  /* [LIVE FINDING] Both halves of the same defect, held from the composing end: the tile and the table must count the
   * same flagged pours over the same shift. */
  it('reads the flags for the SHIFT it is drawing, and agrees with the table\'s own flag column', async () => {
    const h = harness({
      rows: [centre({ mccId: 'm1', flags: 2 })],
      flags: [
        { waterFlag: true, adulterationFlags: ['urea'] },      // one pour, flagged twice
        { waterFlag: false, adulterationFlags: ['starch'] },
      ],
    });
    const b = await h.rm.board('t1', { shift: 'evening' });
    expect(h.repo.flagsForDay).toHaveBeenCalledWith('t1', b.day, 'evening');
    expect(b.flagSummary.total).toBe(2);
    expect(b.totals.flags).toBe(2);                            // the SQL column, summed across centres
    expect(b.flagSummary.total).toBe(b.totals.flags);           // one fact, one number
  });

  it('honours an explicitly asked-for cycle', async () => {
    const h = harness();
    const b = await h.rm.board('t1', { shift: 'evening', cycle: 'monthly' });
    expect(b.window).toMatchObject({ from: '2026-07-01', to: '2026-07-31', cycle: 'monthly' });
    expect(b.shift).toBe('evening');
  });

  it('falls back to a fortnight when the tenant has no memberships at all', async () => {
    const h = harness({ mix: [] });
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.window.cycle).toBe('fortnightly');
    expect(b.coverage.kind).toBe('measured');   // the centre row still carries its roll
  });

  it('attaches each centre\'s own cooler verdict, and no_unit where there is none', async () => {
    const h = harness({
      rows: [centre({ mccId: 'm1' }), centre({ mccId: 'm2', code: 'MCC-AND-02' })],
      bmc: [{ mccId: 'm1', unitId: 'b1', targetC: '4.0', tempC: '6.9', recordedAt: '2026-07-13T14:20:00Z' }],
    });
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.centres[0].bmc).toMatchObject({ kind: 'reading', overTarget: true });
    expect(b.centres[1].bmc).toEqual({ kind: 'no_unit' });
  });

  it('carries every refusal onto the board', async () => {
    const h = harness();
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.shiftClock.kind).toBe('not_recorded');
    expect(b.payday.kind).toBe('not_recorded');
    expect(b.window.basis).toBe('derived_from_membership_preference');
    expect(b.flagSummary.workflow).toBe('not_built');
    expect(b.centres[0].analyzer).toMatchObject({ perPourEvidence: false });
    // And the one promise that IS kept.
    expect(b.pourUniqueness).toBe(POUR_UNIQUENESS);
  });

  it('renders the totals as strings the console prints without arithmetic', async () => {
    const h = harness({ rows: [
      centre({ weightMilliKg: 824_000n, amountMinor: 4_500_000n, pourers: 102, membershipsEnrolled: 108 }),
      centre({ mccId: 'm2', weightMilliKg: 716_000n, amountMinor: 3_900_000n, pourers: 98, membershipsEnrolled: 104, fatCentiPctWeighted: 630n, snfCentiPctWeighted: 890n }),
    ] });
    const b = await h.rm.board('t1', { shift: 'morning' });
    expect(b.totals).toMatchObject({ litres: '1540.0', pourers: 200, amountMinor: '8400000' });
    expect(b.totals.fatPct).toBe('6.5');
    expect(b.coverage).toMatchObject({ kind: 'measured', poured: 200, enrolled: 212 });
  });
});
