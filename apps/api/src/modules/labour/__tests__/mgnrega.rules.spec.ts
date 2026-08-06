// PC-55 A4 · MGNREGA rules. The 100-day guarantee is a LEGAL RIGHT — every gate here exists so the platform
// states a worker's entitlement precisely and never rounds it away.
import { canMuster, canTransitionWork, musterDateInWindow, observedDays, daysRemaining, mirrorShouldRise, MGNREGA_GUARANTEE_DAYS,
  DEMAND_ALLOTMENT_DAYS, allotmentDueBy, allotmentOverdue, unemploymentAllowanceDue, daysUntilDue,
  canAllotDemand, canWithdrawDemand, canCloseDemand, demandDateAcceptable, daysRequestedAcceptable,
} from '../domain/mgnrega.rules';
import { NoopStateLedgerProvider, stateLedgerProviderFromEnv } from '../providers/state-ledger.provider';

describe('work status gates', () => {
  it('musters only against a running (or completed, for late entry) work', () => {
    expect(canMuster('active')).toBe(true);
    expect(canMuster('completed')).toBe(true);      // late data entry is legitimate
    expect(canMuster('planned')).toBe(false);       // nobody worked on a work that has not begun
    expect(canMuster('suspended')).toBe(false);
  });
  it('walks planned→active→completed, allows suspension both ways, and completed is final', () => {
    expect(canTransitionWork('planned', 'active')).toBe(true);
    expect(canTransitionWork('active', 'completed')).toBe(true);
    expect(canTransitionWork('suspended', 'active')).toBe(true);
    expect(canTransitionWork('completed', 'active')).toBe(false);
    expect(canTransitionWork('planned', 'completed')).toBe(false);
  });
});

describe('musterDateInWindow (attendance is history, never a plan)', () => {
  it("refuses future dates and dates outside the work's own window", () => {
    expect(musterDateInWindow('2026-08-05', '2026-08-01', '2026-08-31', '2026-08-10')).toBe(true);
    expect(musterDateInWindow('2026-08-11', '2026-08-01', '2026-08-31', '2026-08-10')).toBe(false); // future
    expect(musterDateInWindow('2026-07-31', '2026-08-01', '2026-08-31', '2026-08-10')).toBe(false); // before start
    expect(musterDateInWindow('2026-09-01', '2026-08-01', '2026-08-31', '2026-09-10')).toBe(false); // after end
    expect(musterDateInWindow('2026-08-05', null, null, '2026-08-10')).toBe(true);                  // open-ended work
  });
});

describe('the 100-day count (never overstate what is left)', () => {
  it('sums half-days exactly and floors the used count in favour of the worker', () => {
    expect(observedDays([{ attended: true, dayFraction: 1 }, { attended: true, dayFraction: 0.5 }])).toBe(1.5);
    expect(observedDays([{ attended: false, dayFraction: 1 }])).toBe(0);              // absent is not a day used
    expect(observedDays([])).toBe(0);
    // 3 half-days = 1.5 observed → only 1 whole day counts against the cap, so 99 remain (never 98)
    expect(daysRemaining(1.5, null)).toBe(99);
    expect(daysRemaining(0, null)).toBe(MGNREGA_GUARANTEE_DAYS);
  });
  it('uses the HIGHER of observed vs state figures, so the cap can never be exceeded silently', () => {
    expect(daysRemaining(10, 40)).toBe(60);      // state says more → trust the higher
    expect(daysRemaining(40, 10)).toBe(60);      // we observed more → still the higher
    expect(daysRemaining(120, null)).toBe(0);    // never negative
  });
  it('raises the national mirror only when observation exceeds it (never lowers, never invents)', () => {
    expect(mirrorShouldRise(10, 12.9)).toBe(true);    // 12 whole days > 10
    expect(mirrorShouldRise(10, 10.9)).toBe(false);   // still 10 whole days
    expect(mirrorShouldRise(40, 12)).toBe(false);     // a lower observation NEVER reduces the state figure
  });
});

describe('state-ledger port (wired now, faking never)', () => {
  it('the noop refuses to claim a sync and says the state remains authoritative', async () => {
    const p = new NoopStateLedgerProvider();
    const r = await p.fetchCardStatus(['GJ-05-001234']);
    expect(p.name).toBe('noop');
    expect(r.providerAvailable).toBe(false);
    expect(r.cards).toHaveLength(0);
    expect(r.note.toLowerCase()).toContain('authoritative');
  });
  it('env selection fails CLOSED', () => {
    expect(stateLedgerProviderFromEnv({}).name).toBe('noop');
    expect(stateLedgerProviderFromEnv({ STATE_LEDGER_PROVIDER: 'made-up' }).name).toBe('noop');
  });
});

// ===== PC-55 B2 · the work-demand clock (MGNREGA §3 + Schedule II) =====
// A day either way changes who owes what: one day harsh overstates the state's default, one day lenient
// understates a household's entitlement. So the boundary is pinned on both sides.
describe('mgnrega work-demand clock', () => {
  it('the deadline is 15 CALENDAR days after the demand — weekends do not pause a statutory clock', () => {
    expect(DEMAND_ALLOTMENT_DAYS).toBe(15);
    expect(allotmentDueBy('2026-08-06')).toBe('2026-08-21');
    expect(allotmentDueBy('2026-02-20')).toBe('2026-03-07');   // crosses a month end
    expect(allotmentDueBy('2024-02-20')).toBe('2024-03-06');   // and a leap year
    expect(allotmentDueBy('2026-12-25')).toBe('2027-01-09');   // and a year end
  });

  it('is not overdue ON the due day — the household still has the whole fifteenth day', () => {
    expect(allotmentOverdue('2026-08-06', 'demanded', '2026-08-20')).toBe(false);
    expect(allotmentOverdue('2026-08-06', 'demanded', '2026-08-21')).toBe(false); // the due day itself
    expect(allotmentOverdue('2026-08-06', 'demanded', '2026-08-22')).toBe(true);  // the day after: overdue
  });

  it('an allotted, withdrawn or closed demand is never overdue (the clock stopped when it ended)', () => {
    for (const s of ['allotted', 'withdrawn', 'closed'] as const) {
      expect(allotmentOverdue('2026-01-01', s, '2026-08-06')).toBe(false);
      expect(unemploymentAllowanceDue('2026-01-01', s, '2026-08-06')).toBe(false);
    }
  });

  it('the allowance question is the SAME arithmetic as overdue, so the two can never disagree', () => {
    for (const today of ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-09-30']) {
      expect(unemploymentAllowanceDue('2026-08-06', 'demanded', today)).toBe(allotmentOverdue('2026-08-06', 'demanded', today));
    }
  });

  it('counts down to the deadline and keeps counting negative afterwards', () => {
    expect(daysUntilDue('2026-08-06', '2026-08-06')).toBe(15);
    expect(daysUntilDue('2026-08-06', '2026-08-21')).toBe(0);
    expect(daysUntilDue('2026-08-06', '2026-08-25')).toBe(-4);
  });

  it('only an open demand can be allotted, withdrawn or closed', () => {
    expect(canAllotDemand('demanded')).toBe(true);
    expect(canWithdrawDemand('demanded')).toBe(true);
    expect(canCloseDemand('demanded')).toBe(true);
    for (const s of ['allotted', 'withdrawn', 'closed'] as const) {
      expect(canAllotDemand(s)).toBe(false);
      expect(canWithdrawDemand(s)).toBe(false);
      expect(canCloseDemand(s)).toBe(false);
    }
  });

  it('a demand cannot be dated in the future, nor back-dated beyond the register window', () => {
    expect(demandDateAcceptable('2026-08-06', '2026-08-06')).toBe(true);
    expect(demandDateAcceptable('2026-08-05', '2026-08-06')).toBe(true);
    expect(demandDateAcceptable('2026-08-07', '2026-08-06')).toBe(false);   // the clock cannot start before the ask
    expect(demandDateAcceptable('06-08-2026', '2026-08-06')).toBe(false);
    expect(demandDateAcceptable('2024-01-01', '2026-08-06')).toBe(false);   // far outside the register window
  });

  it('days requested must fit inside the 100-day guarantee itself', () => {
    expect(daysRequestedAcceptable(1)).toBe(true);
    expect(daysRequestedAcceptable(100)).toBe(true);
    expect(daysRequestedAcceptable(0)).toBe(false);
    expect(daysRequestedAcceptable(101)).toBe(false);
    expect(daysRequestedAcceptable(12.5)).toBe(false);
  });
});
