// apps/admin-api/src/modules/cells-ops/__tests__/admin8-map-integrity.spec.ts (PC-56 ADMIN-8)
//
// Three guards the canon states and the code did not have, plus the growth rate. Almost every assertion is about a
// REFUSAL — the routing map's job is to say no to the changes that would strand a country's onboarding.
import {
  approvalState, assertApplicable, assertReason, assertRejectable, diffOf, isNoOp, needsChecker,
  stalenessOf, NEEDS_CHECKER, PROPOSAL_STATUSES, REASON_MIN,
} from '../domain/map-approval';
import {
  assertStatusChangeAllowed, countVerdict, defaultCellBlocksStatusChange, driftIsUrgent, growthRate,
  headroomOf, isSafeSecretRef, needsScalePlan, placementDecision, secretRefDisplay, shardAcceptsPlacement,
  weeksToFull, PLAN_TRIGGER_PERCENT_USED,
} from '../domain/map-integrity';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';
import { InvalidCellsInputError } from '../domain/cells-ops.errors';

/* ================================================================================================ */
/* `weight = 0` MEANS DRAIN, AND NOTHING READ IT                                                     */
/* ================================================================================================ */

describe('shardAcceptsPlacement', () => {
  it('accepts an active shard with weight', () => {
    expect(shardAcceptsPlacement('active', 100)).toBe(true);
  });

  it('REFUSES AN ACTIVE SHARD AT WEIGHT 0 — the whole defect', () => {
    // W031: "weight 0 = drain (no new placements)". `assertWeight` bounded the value and the placement path checked only
    // `status`, so an operator who zeroed a hot shard's weight kept receiving tenants onto it while the console showed
    // weight 0 beside a rising placed_count. Fifth occurrence of a column recording an intention no code honours.
    expect(shardAcceptsPlacement('active', 0)).toBe(false);
  });

  it('refuses every non-active status regardless of weight', () => {
    for (const s of ['draining', 'readonly', 'retired', 'nonsense']) {
      expect(shardAcceptsPlacement(s, 100)).toBe(false);
    }
  });

  it('does NOT read a non-finite weight as a large one', () => {
    // `NaN > 0` is false, so the NaN refusal would happen anyway — and relying on that would make the correct behaviour an
    // accident of IEEE-754, which is the equivalence ADMIN-5f caught itself depending on in `priorityOf`.
    //
    // INFINITY IS ALSO REFUSED, and I wrote this expectation the wrong way round first: I reasoned that `Infinity > 0` is
    // true and that the finiteness check would let it through, when `Number.isFinite(Infinity)` is false by definition.
    // Refusing it is the right answer — an infinite weight is a corrupt value, not an eager shard — and the guard gets
    // there for the right reason rather than by luck. Kept as a note because "is Infinity finite" is exactly the kind of
    // thing a reviewer skims past.
    expect(shardAcceptsPlacement('active', NaN)).toBe(false);
    expect(shardAcceptsPlacement('active', Infinity)).toBe(false);
  });

  it('refuses a negative weight', () => {
    // The DB CHECK forbids it, and a guard that trusts a constraint it did not write stops being true the day the
    // constraint is relaxed.
    expect(shardAcceptsPlacement('active', -1)).toBe(false);
  });
});

describe('placementDecision', () => {
  const ok = {
    cellStatus: 'active', cellPlacedCount: 10, cellCapacity: 100,
    shardStatus: 'active', shardWeight: 100, shardCellId: 'c1', targetCellId: 'c1',
  };

  it('permits a clean placement', () => {
    expect(placementDecision(ok)).toEqual({ ok: true });
  });

  it('reports a shard in the wrong cell FIRST, before any capacity condition', () => {
    // Reporting it as "at capacity" would send somebody to raise a cap that was never the problem.
    expect(placementDecision({ ...ok, shardCellId: 'c2', cellPlacedCount: 100 }))
      .toEqual({ ok: false, reason: 'shard_not_in_cell' });
  });

  it('separates draining-by-weight from draining-by-status', () => {
    // They send an operator to different places: one means the shard is being retired, the other means somebody took it
    // out of rotation without changing its status — usually a colleague mid-incident.
    expect(placementDecision({ ...ok, shardWeight: 0 }))
      .toEqual({ ok: false, reason: 'shard_draining_by_weight' });
    expect(placementDecision({ ...ok, shardStatus: 'draining' }))
      .toMatchObject({ ok: false, reason: 'shard_not_active' });
  });

  it('refuses at the cap, not past it', () => {
    // `>=`: a cell with 100 of 100 is full. `>` would admit the 101st.
    expect(placementDecision({ ...ok, cellPlacedCount: 100 }))
      .toEqual({ ok: false, reason: 'cell_at_capacity', placed: 100, capacity: 100 });
    expect(placementDecision({ ...ok, cellPlacedCount: 99 })).toEqual({ ok: true });
  });

  it('permits an uncapped cell at any count', () => {
    expect(placementDecision({ ...ok, cellCapacity: null, cellPlacedCount: 1_000_000 })).toEqual({ ok: true });
  });
});

/* ================================================================================================ */
/* THE DEFAULT CELL MAY NOT BE DRAINED                                                               */
/* ================================================================================================ */

describe('defaultCellBlocksStatusChange', () => {
  it('BLOCKS every non-active target on a default cell', () => {
    // W030 says it twice: "default flag must move to another IN cell first" and "blocked while is_default=true".
    // `setCellStatus` checked retire-when-empty and nothing else, so the default landing cell for IN could be drained by
    // one operator — and every new Indian tenant registration would then fail at placement while existing tenants kept
    // working. The platform does not go down; it stops taking customers.
    for (const to of ['draining', 'readonly', 'retired']) {
      const msg = defaultCellBlocksStatusChange(true, to);
      expect(msg).not.toBeNull();
      // Asserting the SENTENCE has substance, not merely that one exists — ADMIN-6's M23 lesson.
      expect(msg).toMatch(/default landing cell/);
      expect(msg).toMatch(/stopped taking customers/);
    }
  });

  it('permits returning a default cell to active', () => {
    expect(defaultCellBlocksStatusChange(true, 'active')).toBeNull();
  });

  it('permits any transition on a non-default cell', () => {
    for (const to of ['draining', 'readonly', 'retired', 'active']) {
      expect(defaultCellBlocksStatusChange(false, to)).toBeNull();
    }
  });

  it('throws through the assertion form', () => {
    expect(() => assertStatusChangeAllowed(true, 'draining')).toThrow(InvalidCellsInputError);
    expect(() => assertStatusChangeAllowed(false, 'draining')).not.toThrow();
  });
});

/* ================================================================================================ */
/* THE COUNT NOBODY VERIFIED                                                                         */
/* ================================================================================================ */

describe('countVerdict', () => {
  it('agrees when the two match', () => {
    expect(countVerdict(214, 214)).toEqual({ kind: 'match', count: 214 });
  });

  it('separates OVER from UNDER, because they cost different things', () => {
    // `over` refuses placements on a cell with room (visible: somebody complains). `under` admits them past the cap
    // (invisible until a shard falls over).
    expect(countVerdict(220, 214)).toEqual({ kind: 'over', stored: 220, derived: 214, drift: 6 });
    expect(countVerdict(210, 214)).toEqual({ kind: 'under', stored: 210, derived: 214, drift: -4 });
  });

  it('drift is stored minus derived, matching the CHECK in 0116', () => {
    // `ck_pcc_drift` holds the same arithmetic in the database, so a disagreement here would fail the INSERT rather than
    // storing a record whose own operands contradict it.
    const v = countVerdict(5, 9);
    expect((v as { drift: number }).drift).toBe(5 - 9);
  });
});

describe('driftIsUrgent', () => {
  it('is urgent on a CAPPED node, because the cap is what the guard compares against', () => {
    expect(driftIsUrgent(countVerdict(220, 214), 2000)).toBe(true);
  });
  it('is not urgent on an uncapped cell — a bookkeeping error rather than a routing risk', () => {
    expect(driftIsUrgent(countVerdict(220, 214), null)).toBe(false);
  });
  it('is never urgent when the counts agree', () => {
    expect(driftIsUrgent(countVerdict(1, 1), 2000)).toBe(false);
  });
});

/* ================================================================================================ */
/* HEADROOM AND GROWTH                                                                               */
/* ================================================================================================ */

describe('headroomOf', () => {
  it('reports headroom as a percentage', () => {
    expect(headroomOf(1182, 2000)).toEqual({ known: true, percent: 40, placed: 1182, capacity: 2000 });
  });

  it('FLOORS rather than rounds, so the figure never overstates the room', () => {
    // 59.1% used → 40.9% headroom → reported 40. The direction ADMIN-5f chose rounding value-at-stake half up: err toward
    // the reading that triggers action.
    expect(headroomOf(591, 1000)).toMatchObject({ known: true, percent: 40 });
  });

  it('reports UNCAPPED rather than 0 or 100', () => {
    // 0 would read as "full" and 100 as "plenty"; the truth is that no guard protects this cell at all.
    expect(headroomOf(500, null)).toEqual({ known: false, reason: 'uncapped' });
  });

  it('never reports negative headroom on an over-full cell', () => {
    expect(headroomOf(3000, 2000)).toMatchObject({ known: true, percent: 0 });
  });

  it('treats a zero or non-finite capacity as no capacity recorded', () => {
    expect(headroomOf(0, 0)).toEqual({ known: false, reason: 'no_capacity_recorded' });
    expect(headroomOf(0, NaN)).toEqual({ known: false, reason: 'no_capacity_recorded' });
  });
});

describe('growthRate', () => {
  const ev = (action: string, n: number) => Array.from({ length: n }, () => ({ action }));

  it('counts NET placements per week', () => {
    // 80 placed over 8 weeks = +10/week.
    expect(growthRate(ev('placed', 80), 8)).toMatchObject({ known: true, perWeek: 10 });
  });

  it('SUBTRACTS removals, because a cell whose tenants arrive and leave is not filling up', () => {
    // A gross arrival count would forecast a cell full in 21 weeks that will still be half empty — which is how a
    // platform buys infrastructure it does not need.
    expect(growthRate([...ev('placed', 80), ...ev('removed', 40)], 8)).toMatchObject({ perWeek: 5 });
  });

  it('does NOT count a move as growth', () => {
    // A move is one tenant leaving one cell and arriving at another. Counted here it would make an internal rebalance look
    // like new business.
    expect(growthRate(ev('moved', 100), 8)).toMatchObject({ known: true, perWeek: 0 });
  });

  it('reports NO HISTORY rather than a rate of 0', () => {
    // "Nobody joined" and "we have no history" are the same number and different findings, and W036's "full in ≈ 21 weeks"
    // is meaningless without knowing which.
    expect(growthRate([], 8)).toEqual({ known: false, reason: 'no_history' });
  });

  it('refuses a non-positive window rather than dividing by zero', () => {
    expect(growthRate(ev('placed', 10), 0)).toEqual({ known: false, reason: 'no_history' });
  });

  it('can report a NEGATIVE rate — a shrinking cell is a real finding', () => {
    expect(growthRate([...ev('placed', 10), ...ev('removed', 50)], 8)).toMatchObject({ perWeek: -5 });
  });
});

describe('weeksToFull', () => {
  it('projects from the rate', () => {
    expect(weeksToFull(1182, 2000, { known: true, perWeek: 38, windowWeeks: 8, sample: 300 }))
      .toEqual({ known: true, weeks: 21 });
  });

  it('says NOT FILLING rather than putting a number on "never"', () => {
    // Reporting Infinity, or a very large number, would put a figure on the screen that means never and invite somebody to
    // plan against it.
    expect(weeksToFull(100, 2000, { known: true, perWeek: 0, windowWeeks: 8, sample: 1 }))
      .toEqual({ known: false, reason: 'not_filling' });
    expect(weeksToFull(100, 2000, { known: true, perWeek: -5, windowWeeks: 8, sample: 1 }))
      .toEqual({ known: false, reason: 'not_filling' });
  });

  it('reports already_full and uncapped as their own answers', () => {
    expect(weeksToFull(2000, 2000, { known: true, perWeek: 5, windowWeeks: 8, sample: 1 }))
      .toEqual({ known: false, reason: 'already_full' });
    expect(weeksToFull(10, null, { known: true, perWeek: 5, windowWeeks: 8, sample: 1 }))
      .toEqual({ known: false, reason: 'uncapped' });
  });

  it('never projects fewer than one week', () => {
    // A cell one tenant from full at +38/week would floor to 0, which reads as "already full" — a different state that has
    // its own answer.
    expect(weeksToFull(1999, 2000, { known: true, perWeek: 38, windowWeeks: 8, sample: 1 }))
      .toEqual({ known: true, weeks: 1 });
  });
});

describe('needsScalePlan', () => {
  it('trips at W037\'s own figure', () => {
    expect(PLAN_TRIGGER_PERCENT_USED).toBe(70);
    expect(needsScalePlan({ known: true, percent: 30, placed: 700, capacity: 1000 })).toBe(true);
    expect(needsScalePlan({ known: true, percent: 31, placed: 690, capacity: 1000 })).toBe(false);
  });
  it('does not flag an uncapped cell, which has no utilisation to measure', () => {
    expect(needsScalePlan({ known: false, reason: 'uncapped' })).toBe(false);
  });
});

/* ================================================================================================ */
/* THE SECRET THAT MUST NOT LEAK                                                                     */
/* ================================================================================================ */

describe('the DSN guard', () => {
  it('accepts a vault reference', () => {
    expect(isSafeSecretRef('vault://kv/cells/in-west-1/shard-0')).toBe(true);
  });
  it('REFUSES ANYTHING THAT IS NOT ONE — an ALLOW-list, deliberately', () => {
    // W031: "Raw DSNs never appear here … even platform owners see only the reference." The deny-list version ("does it
    // look like a DSN") is exactly the check that fails on the format nobody anticipated, so this is an allow-list.
    for (const bad of [
      'postgres://user:pw@host:5432/db',
      'postgresql://host/db',
      'vault://kv/x?token=abc',
      'host=db user=kv password=secret',
    ]) expect(isSafeSecretRef(bad)).toBe(false);
  });
  it('treats null and empty as safe absences', () => {
    expect(isSafeSecretRef(null)).toBe(true);
    expect(isSafeSecretRef('  ')).toBe(true);
  });
  it('renders an unsafe value as NOTHING rather than as itself', () => {
    // A raw DSN in this column is a secret-management incident, not a display bug — and printing it would put a production
    // database password in a screenshot.
    expect(secretRefDisplay('postgres://u:p@h/db')).toEqual({ safe: false, text: null });
    expect(secretRefDisplay('vault://kv/a')).toEqual({ safe: true, text: 'vault://kv/a' });
  });
});

/* ================================================================================================ */
/* THE TWELFTH MAKER-CHECKER SITE                                                                    */
/* ================================================================================================ */

describe('needsChecker', () => {
  it('gates the changes that move existing data or redirect new tenants', () => {
    expect(needsChecker('cell', 'status_changed')).toBe(true);
    expect(needsChecker('cell', 'updated')).toBe(true);
    expect(needsChecker('shard', 'status_changed')).toBe(true);
    expect(needsChecker('shard', 'updated')).toBe(true);
    expect(needsChecker('placement', 'moved')).toBe(true);
  });

  it('does NOT gate a new tenant landing, and the omission is the design', () => {
    // Putting a checker in front of every signup would mean a farmer's co-operative waits for two Krishalaya employees
    // before it can exist. Same line ADMIN-6b drew at the payout gate.
    expect(needsChecker('placement', 'placed')).toBe(false);
    // Nor un-placing, which is how a drain FINISHES — gating it would make the safe direction the expensive one.
    expect(needsChecker('placement', 'removed')).toBe(false);
    expect(needsChecker('shard', 'created')).toBe(false);
  });

  it('an UNKNOWN entity or action REQUIRES a checker', () => {
    // The opposite of the usual allow-list default, and deliberate: a new action type added by a future migration should
    // arrive gated rather than ungated on a routing map.
    expect(needsChecker('quantum', 'status_changed')).toBe(true);
    expect(needsChecker('cell', 'teleported')).toBe(true);
  });

  it('the gated set is data rather than scattered conditionals', () => {
    expect(Object.keys(NEEDS_CHECKER).sort()).toEqual(['cell', 'placement', 'shard']);
  });
});

describe('assertReason', () => {
  it('enforces the platform-wide floor', () => {
    expect(REASON_MIN).toBe(20);
    expect(() => assertReason('rebalance')).toThrow(/20 characters/);
  });
  it('counts TRIMMED length, so whitespace does not buy a reason', () => {
    expect(() => assertReason(`${' '.repeat(40)}hot`)).toThrow(/20 characters/);
  });
  it('returns the trimmed value', () => {
    expect(assertReason('  shard 2 is a hot partition, rebalancing  ')).toBe('shard 2 is a hot partition, rebalancing');
  });
});

describe('stalenessOf — what makes an approval mean something', () => {
  it('is fresh when the observed fields still match', () => {
    expect(stalenessOf({ status: 'active' }, { status: 'active', placedCount: 999 })).toEqual({ stale: false });
  });

  it('IGNORES fields the maker did not record', () => {
    // A cell's `placed_count` moves continuously as tenants land. If every field were compared, no capacity proposal could
    // ever survive long enough to be signed.
    expect(stalenessOf({ capacityTenants: 1800 }, { capacityTenants: 1800, placedCount: 1183, status: 'draining' }))
      .toEqual({ stale: false });
  });

  it('names the fields that moved', () => {
    expect(stalenessOf({ status: 'active', capacityTenants: 1800 }, { status: 'draining', capacityTenants: 1800 }))
      .toEqual({ stale: true, reason: 'observed_changed', fields: ['status'] });
  });

  it('reports a missing entity distinctly', () => {
    expect(stalenessOf({ status: 'active' }, null)).toEqual({ stale: true, reason: 'entity_missing' });
  });

  it('compares by VALUE, not by reference', () => {
    // A placement's observed state is a nested `{cellId, shardId}` pair, and reference equality would report every such
    // proposal as stale.
    expect(stalenessOf({ at: { cellId: 'c1', shardId: 's1' } }, { at: { cellId: 'c1', shardId: 's1' } }))
      .toEqual({ stale: false });
    expect(stalenessOf({ at: { cellId: 'c1', shardId: 's1' } }, { at: { cellId: 'c1', shardId: 's2' } }).stale)
      .toBe(true);
  });

  it('detects a field changing to undefined', () => {
    // A column being cleared is a change. `JSON.stringify(undefined)` is `undefined` and `JSON.stringify(null)` is
    // `"null"`, so the two are distinguished — which matters here because null capacity means UNCAPPED.
    expect(stalenessOf({ capacityTenants: 2000 }, {}).stale).toBe(true);
    expect(stalenessOf({ capacityTenants: null }, { capacityTenants: 2000 }).stale).toBe(true);
  });
});

describe('approvalState / assertApplicable', () => {
  const fresh = { stale: false as const };
  const ok = { status: 'open', proposedByAdminId: 'op1', approverAdminId: 'op2', staleness: fresh };

  it('is approvable for a second operator over a fresh proposal', () => {
    expect(approvalState({ status: 'open', proposedByAdminId: 'op1', viewerAdminId: 'op2', staleness: fresh }))
      .toEqual({ kind: 'approvable' });
  });

  it('withholds the control from the MAKER', () => {
    expect(approvalState({ status: 'open', proposedByAdminId: 'op1', viewerAdminId: 'op1', staleness: fresh }))
      .toEqual({ kind: 'needs_other_operator' });
  });

  it('reports STALENESS BEFORE the two-person rule', () => {
    // So an operator learns the proposal is out of date before being told to find a colleague — the sequence ADMIN-7
    // settled on, and for the same reason.
    const s = { stale: true as const, reason: 'observed_changed' as const, fields: ['status'] };
    expect(approvalState({ status: 'open', proposedByAdminId: 'op1', viewerAdminId: 'op1', staleness: s }).kind)
      .toBe('stale');
  });

  it('reports a decided proposal as decided', () => {
    expect(approvalState({ status: 'applied', proposedByAdminId: 'op1', viewerAdminId: 'op2', staleness: fresh }))
      .toEqual({ kind: 'already', status: 'applied' });
  });

  it('treats an unrecognised status as decided rather than approvable', () => {
    expect(approvalState({ status: 'quantum', proposedByAdminId: 'op1', viewerAdminId: 'op2', staleness: fresh }).kind)
      .toBe('already');
  });

  it('THROWS SecondPersonRequiredError for self-approval', () => {
    expect(() => assertApplicable({ ...ok, approverAdminId: 'op1' })).toThrow(SecondPersonRequiredError);
  });

  it('refuses a STALE proposal before the two-person rule, with the fields in the sentence', () => {
    try {
      assertApplicable({
        ...ok, approverAdminId: 'op1',
        staleness: { stale: true, reason: 'observed_changed', fields: ['status', 'capacityTenants'] },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidCellsInputError);
      expect(e).not.toBeInstanceOf(SecondPersonRequiredError);
      // Asserting the MESSAGE, not only the type — ADMIN-6's M23.
      expect((e as InvalidCellsInputError).getResponse()).toMatchObject({
        message: expect.stringMatching(/status, capacityTenants/),
      });
    }
  });

  it('refuses a proposal that is not open', () => {
    expect(() => assertApplicable({ ...ok, status: 'rejected' })).toThrow(/only an open proposal/);
  });

  it('permits application when the MAKER IS UNRECORDED, deliberately', () => {
    // The shared helper's documented rule: refusing an unknown initiator means nobody can ever approve a backfilled row.
    expect(() => assertApplicable({ ...ok, proposedByAdminId: null })).not.toThrow();
  });

  it('every proposal status is reachable in the union', () => {
    expect([...PROPOSAL_STATUSES]).toEqual(['open', 'applied', 'rejected', 'stale']);
  });
});

describe('assertRejectable', () => {
  it('needs a reason of at least the floor', () => {
    expect(() => assertRejectable({ status: 'open', note: 'no', deciderAdminId: 'op1' })).toThrow(/20 characters/);
  });
  it('is NOT subject to the two-person rule — the maker may withdraw their own', () => {
    // Refusing your own proposal is withdrawing it, and needing a colleague to help you STOP a routing change would make
    // the safe action the expensive one. Same asymmetry as ADMIN-6b's batch return and ADMIN-7's model withdrawal.
    expect(() => assertRejectable({
      status: 'open', note: 'My own error: the wrong shard index was named.', deciderAdminId: 'op1',
    })).not.toThrow();
  });
  it('refuses a decided proposal', () => {
    expect(() => assertRejectable({ status: 'applied', note: 'x'.repeat(30), deciderAdminId: 'op1' }))
      .toThrow(/already applied/);
  });
});

describe('diffOf / isNoOp', () => {
  it('lists only the fields that actually change', () => {
    expect(diffOf({ status: 'active', weight: 100 }, { status: 'draining', weight: 100 }))
      .toEqual([{ field: 'status', from: 'active', to: 'draining' }]);
  });
  it('sorts for a stable render', () => {
    expect(diffOf({ b: 1, a: 1 }, { b: 2, a: 2 }).map((d) => d.field)).toEqual(['a', 'b']);
  });
  it('shows a field being SET with no prior value recorded', () => {
    // `from: undefined` is honest — the maker did not record one — and omitting the line would hide a field being set.
    expect(diffOf({}, { capacityTenants: 2000 })).toEqual([{ field: 'capacityTenants', from: undefined, to: 2000 }]);
  });
  it('distinguishes null from undefined, because null capacity means UNCAPPED', () => {
    expect(diffOf({ capacityTenants: 2000 }, { capacityTenants: null }))
      .toEqual([{ field: 'capacityTenants', from: 2000, to: null }]);
  });
  it('detects a no-op so nobody is asked to sign one', () => {
    expect(isNoOp({ status: 'active' }, { status: 'active' })).toBe(true);
    expect(isNoOp({ status: 'active' }, { status: 'draining' })).toBe(false);
  });
});
