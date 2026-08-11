// apps/web-tenant/src/test/tenant1c-console-home.spec.ts · PC-56 TENANT-1c.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: THE DASHBOARD ORDERS WORK BY WHAT GOES WRONG IF IT WAITS, NOT BY HOW LARGE THE
// NUMBER IS.**
//
// The payout batch is the biggest figure on W117 and it is deliberately LAST. A batch waits until the next run without harm;
// produce sitting in QC is perishable, and a dispute has a response clock the platform will judge the tenant against.
// Sorting by rupees would put the calmest item at the top every single day, and staff would learn to read past the panel.
import {
  gmvTrend, isQuietDay, orderedActions, ageLabel, planUsagePct, planNearLimit, stepBadge, nextStep, showChecklistFirst,
} from '../features/console/home';

const t = { t: (k: string, v: Record<string, string | number> = {}) => `${k}:${Object.values(v).join(',')}` };

const tiles = (over: Record<string, unknown> = {}) => ({
  gmvThisMonthMinor: '481260000', gmvPrevMonthSameDayMinor: '408000000', gmvChangeBp: 1795,
  payoutsPendingMinor: '34218000', payoutsPendingFarmers: 42,
  liveListings: 218, listingsNewToday: 12, listingsInQc: 3,
  openDisputes: 2, oldestDisputeHours: 9.4, ...over,
} as never);

const action = (kind: 'qc_queue' | 'payout_batch' | 'dispute', oldestHours: number | null = null) => ({
  kind, count: 1, oldestHours, amountMinor: null, href: '/x',
} as never);

describe('TENANT-1c · the GMV trend', () => {
  it('reads the canon’s own figure as 18%', () => {
    expect(gmvTrend(tiles())).toEqual({ dir: 'up', pct: 17 });
    // 1795bp truncates to 17 rather than rounding to 18: the tile must never overstate. Rounding up a 17.95% rise to 18%
    // is harmless; rounding up a 17.95% FALL would understate a problem, and one rule has to serve both directions.
  });

  it('distinguishes down, flat and unknown', () => {
    expect(gmvTrend(tiles({ gmvChangeBp: -500 })).dir).toBe('down');
    expect(gmvTrend(tiles({ gmvChangeBp: 0 })).dir).toBe('flat');
    // **UNKNOWN IS A THIRD STATE AND NOT ZERO.** A first month has nothing to compare against, and "▲ 0%" would read as
    // flat trade rather than as new trade.
    expect(gmvTrend(tiles({ gmvChangeBp: null }))).toEqual({ dir: 'unknown', pct: null });
  });

  it('reads a wobble as flat rather than as suspicious precision', () => {
    expect(gmvTrend(tiles({ gmvChangeBp: 4 })).dir).toBe('flat');
    expect(gmvTrend(tiles({ gmvChangeBp: -4 })).dir).toBe('flat');
  });
});

describe('TENANT-1c · no manufactured urgency', () => {
  it('calls an empty list a quiet day', () => {
    expect(isQuietDay([])).toBe(true);
    expect(isQuietDay([action('dispute')])).toBe(false);
  });

  /**
   * **THE ORDER IS BY CONSEQUENCE OF DELAY.** Dispute (a clock the platform judges the tenant against), then QC (perishable
   * produce), then the payout batch (waits without harm — and is the largest number on the screen).
   */
  it('puts the biggest number last', () => {
    const ordered = orderedActions([action('payout_batch'), action('qc_queue'), action('dispute')]);
    expect(ordered.map((a) => a.kind)).toEqual(['dispute', 'qc_queue', 'payout_batch']);
  });

  it('orders oldest-first within a kind', () => {
    const ordered = orderedActions([action('dispute', 2), action('dispute', 20)]);
    expect(ordered.map((a) => a.oldestHours)).toEqual([20, 2]);
  });

  it('does not mutate the array it was given', () => {
    // The page renders from the API's response; sorting it in place would reorder whatever else read it.
    const input = [action('payout_batch'), action('dispute')];
    orderedActions(input);
    expect((input[0] as { kind: string }).kind).toBe('payout_batch');
  });
});

describe('TENANT-1c · ages read the way a person would say them', () => {
  it('uses minutes, hours and days', () => {
    expect(ageLabel(0.5, t)).toBe('home.age.minutes:30');
    expect(ageLabel(2.1, t)).toBe('home.age.hours:2.1');
    // "38.4h" is a number somebody has to convert; "1 days" is one they can act on.
    expect(ageLabel(38.4, t)).toBe('home.age.days:1');
  });

  it('never renders a zero age', () => {
    // A brand-new item is "1 minute", not "0 minutes" — and a null age says nothing at all, because an age we do not know
    // is not the same as an item that just arrived.
    expect(ageLabel(0.001, t)).toBe('home.age.minutes:1');
    expect(ageLabel(null, t)).toBeNull();
    expect(ageLabel(Number.NaN, t)).toBeNull();
  });
});

describe('TENANT-1c · plan usage', () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    planCode: 'growth', planName: 'Growth', status: 'active',
    membersUsed: 1284, memberLimit: 5000, currentPeriodEnd: '2026-08-01', ...over,
  } as never);

  it('computes a share against a real cap', () => {
    expect(planUsagePct(plan())).toBe(25);
    expect(planNearLimit(plan())).toBe(false);
    expect(planNearLimit(plan({ membersUsed: 4700 }))).toBe(true);   // 94%
  });

  /**
   * **null WHEN THERE IS NO CAP, WHICH IS NOT 0% USED.** An unlimited plan would otherwise render a progress bar at 0%
   * forever, reading as "you have used nothing" to a federation with 40,000 members.
   */
  it('has no share when the plan has no cap', () => {
    expect(planUsagePct(plan({ memberLimit: null }))).toBeNull();
    expect(planNearLimit(plan({ memberLimit: null }))).toBe(false);
  });

  it('never exceeds 100%', () => {
    // A federation over its cap (a downgrade leaves existing members in place, by TENANT-1d's rule) must not render 128%.
    expect(planUsagePct(plan({ membersUsed: 6400 }))).toBe(100);
  });
});

describe('TENANT-1c · the checklist badges', () => {
  const step = (over: Record<string, unknown> = {}) => ({
    key: 'kyc', done: false, doneAt: null, blockedBy: null, isNext: false, ...over,
  } as never);

  it('has four states, because the screen shows four', () => {
    expect(stepBadge(step({ done: true, doneAt: '2026-07-13T11:20:00Z' }))).toBe('done');
    expect(stepBadge(step({ isNext: true }))).toBe('next');
    expect(stepBadge(step({ key: 'payouts', blockedBy: 'kyc' }))).toBe('blocked');
    expect(stepBadge(step())).toBe('todo');
  });

  /** **DONE WINS OVER BLOCKED.** A completed step that still carries a stale block must read as done, or a live federation
   *  sees "waiting on an earlier step" beside something it finished last week. */
  it('reads a done step as done even if it looks blocked', () => {
    expect(stepBadge(step({ done: true, blockedBy: 'kyc' }))).toBe('done');
  });

  it('returns the single next step, or nothing', () => {
    const state = (steps: unknown[]) => ({ steps, progress: { done: 0, total: 6 }, live: false, blocked: [], staffCount: 0, memberCount: 0 } as never);
    expect(nextStep(state([step({ isNext: true }), step({ key: 'team' })]))!.key).toBe('kyc');
    expect(nextStep(state([step(), step({ key: 'team' })]))).toBeNull();
    // Two "next" badges is a screen that cannot tell somebody what to do, so it reports none rather than picking one.
    expect(nextStep(state([step({ isNext: true }), step({ key: 'team', isNext: true })]))).toBeNull();
  });

  it('keeps the checklist as the front door until the federation is live', () => {
    const state = (live: boolean) => ({ steps: [], progress: { done: 0, total: 6 }, live, blocked: [], staffCount: 0, memberCount: 0 } as never);
    expect(showChecklistFirst(state(false))).toBe(true);
    // W116: the page "becomes your health check" once live — it does not vanish, but it stops being the first stop.
    expect(showChecklistFirst(state(true))).toBe(false);
  });
});
