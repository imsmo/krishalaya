// apps/web-admin/src/test/sweep-mandi-pulse.spec.ts · PC-56 ADMIN-SWEEP console spec.
//
// **THE PAIR THIS SCREEN MUST KEEP APART IS THE MOST CONSEQUENTIAL ONE IN THE PANEL:** an empty anomaly queue because
// the data is clean, and an empty anomaly queue because nothing is checking. Before this wave the second was always the
// answer — `MandiPriceService.ingest` fired farmer price alerts off a manually typed observation in the same
// transaction that inserted it, while W107 promised "bad data never reaches a selling decision".
import { guardClass, lagCellKey, moveClass, moveKey, pctFromBp, rupees } from '../features/market/pulse';
import { canDecide, decidedNoticeKey, severityClass, severityKey } from '../features/market/quarantine';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;

describe('ADMIN-SWEEP · money is rendered, never computed', () => {
  it('formats bigint paise as rupees without float arithmetic', () => {
    expect(rupees('642000')).toBe('₹6,420');
    expect(rupees('2485000')).toBe('₹24,850');
    // A quantity larger than Number.MAX_SAFE_INTEGER in paise still renders — the value never becomes a JS number.
    expect(rupees('99999999999999999900')).toContain('₹');
  });

  it('renders a day-over-day move from server basis points', () => {
    expect(pctFromBp(320)).toBe('+3.2%');
    expect(pctFromBp(-410)).toBe('-4.1%');
    expect(moveKey(320)).toBe('mp11.move.up');
    expect(moveKey(-410)).toBe('mp11.move.down');
    expect(moveKey(0)).toBe('mp11.move.flat');
    expect(moveKey(null)).toBe('mp11.move.noPrior');
  });

  // **NEITHER DIRECTION IS "GOOD".** A price rise is good for a seller and bad for a buyer, and this platform serves
  // both — so the mark is on MAGNITUDE rather than sentiment.
  it('marks magnitude rather than sentiment', () => {
    expect(moveClass(1_200)).toContain('is-warn');
    expect(moveClass(-1_200)).toContain('is-warn');
    expect(moveClass(300)).not.toContain('is-warn');
    expect(moveClass(null)).toBe('');
  });
});

describe('ADMIN-SWEEP · the ingest-lag tile says why it is empty', () => {
  it('distinguishes "no source at all" from "nothing stamped yet"', () => {
    expect(lagCellKey(null, 0)).toBe('mp11.lag.noSource');
    expect(lagCellKey(null, 12)).toBe('mp11.lag.noSamples');
    expect(lagCellKey(41, 500)).toBe('mp11.lag.value');
  });

  it('records in the copy that the column did not exist and is not backfilled', () => {
    expect(dict['mp11.lag.noSource']).toMatch(/no arrival timestamp at all/);
    expect(dict['mp11.lag.noSource']).toMatch(/not backfilled/);
    expect(dict['mp11.lag.noSource']).toMatch(/fabricate/);
  });
});

describe('ADMIN-SWEEP · the guard tile is the finding', () => {
  it('has a distinct line for each of its three meanings', () => {
    for (const k of ['mp11.guard.holding', 'mp11.guard.noneHeldWithManual', 'mp11.guard.noManual']) {
      expect(dict[k]).toBeTruthy();
    }
    // Holding is a warning; the other two are notes — nothing is wrong with a clean day.
    expect(guardClass('mp11.guard.holding')).toContain('is-warn');
    expect(guardClass('mp11.guard.noManual')).not.toContain('is-warn');
  });

  it('says what nothing-held means, in both readings', () => {
    expect(dict['mp11.guard.noneHeldWithManual']).toMatch(/either clean reporting or a threshold set too wide/);
    expect(dict['mp11.guard.holding']).toMatch(/nothing held anything/);
    expect(dict['mp11.q.emptyMeaning']).toMatch(/the answer was always the second/);
  });
});

describe('ADMIN-SWEEP · the quarantine controls', () => {
  it('ranks an order-of-magnitude typo above a merely odd price', () => {
    expect(severityKey(90_000)).toBe('mp11.sev.extreme');
    expect(severityKey(6_000)).toBe('mp11.sev.high');
    expect(severityKey(2_500)).toBe('mp11.sev.moderate');
    expect(severityKey(null)).toBe('mp11.sev.unknown');
    expect(severityClass(90_000)).toContain('is-danger');
    expect(severityClass(null)).toContain('is-warn');
  });

  it('withholds the decide controls on a decided row and says what happened', () => {
    expect(canDecide('quarantined')).toBe(true);
    expect(canDecide('released')).toBe(false);
    expect(canDecide('rejected')).toBe(false);
    expect(canDecide('accepted')).toBe(false);
    expect(decidedNoticeKey('released')).toBe('mp11.decided.released');
    expect(decidedNoticeKey('rejected')).toBe('mp11.decided.rejected');
    expect(decidedNoticeKey('accepted')).toBe('mp11.decided.notHeld');
    expect(decidedNoticeKey('quarantined')).toBeNull();
  });

  // The mirror of the admin-api domain: the same three thresholds, asserted here so the console and the server cannot
  // drift the way ADMIN-11's flag preview drifted from its evaluator.
  it('uses the same thresholds the server does', () => {
    expect(severityKey(10_000)).toBe('mp11.sev.extreme');
    expect(severityKey(9_999)).toBe('mp11.sev.high');
    expect(severityKey(5_000)).toBe('mp11.sev.high');
    expect(severityKey(4_999)).toBe('mp11.sev.moderate');
  });
});

describe('ADMIN-SWEEP · the sentences that make the plane honest', () => {
  it('states that releasing does not re-send the held alerts', () => {
    expect(dict['mp11.release.noBackfill']).toMatch(/DOES NOT SEND THE ALERTS THAT WERE HELD/);
    expect(dict['mp11.release.noBackfill']).toMatch(/window that has shut/);
  });

  it('states that a rejected observation is kept for ever', () => {
    expect(dict['mp11.decided.rejected']).toMatch(/destroys the evidence of how it got in/);
  });

  it('does not claim the reporter has been told', () => {
    // The note is recorded; delivering it to the ambassador's own console is not built, and the page says so.
    expect(dict['mp11.q.feedback']).toMatch(/not yet built/);
    expect(dict['mp11.q.feedback']).toMatch(/does not pretend/);
  });

  it('keeps a held price out of the movers table too', () => {
    // An operator must not act on a number the platform has refused to send a farmer.
    expect(dict['mp11.movers.acceptedOnly']).toMatch(/refused to send a farmer/);
  });

  it('says staleness is day-granular rather than implying an hour clock', () => {
    expect(dict['mp11.stale.basis']).toMatch(/day-granular/);
  });

  it('calls the note coaching rather than a verdict', () => {
    expect(dict['mp11.q.noteHelp']).toMatch(/coaching, not a verdict/);
  });
});
