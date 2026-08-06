// PC-56 ADMIN-5 · the erasure plane. Pure domain only — no DB.
// The claims here are about what the platform must REFUSE to say. The most important one is that an erasure cannot be
// recorded as completed unless something actually erased something.
import {
  computeScope, withCounts, assertErasureCompletable, assertRejectionGround, isRejectionGround,
  groundIsFixableByPrincipal, isKeptByLaw, actionIsRunnable, acknowledgeSla, resolveSla, summariseSla,
  REJECTION_GROUNDS, ACKNOWLEDGE_HOURS, RESOLVE_DAYS, ACTIONS_WITH_NO_PIPELINE,
  type RetentionPolicyRow,
} from '../domain/erasure-scope';
import { InvalidDsrInputError } from '../domain/compliance-ops.errors';
import { assertSecondPerson, isSecondPerson, SecondPersonRequiredError, makerNeCheckerConstraint } from '../../../core/approval/two-person-rule';

const pol = (over: Partial<RetentionPolicyRow> = {}): RetentionPolicyRow => ({
  tableName: 'users', action: 'delete', legalBasis: null, activeMonths: 0, archiveMonths: null, isActive: true, ...over,
});

const HOUR = 3_600_000;
const NOW = new Date('2026-08-07T12:00:00.000Z');

describe('ADMIN-5 · the erasure scope', () => {
  it('an EMPTY policy table is "no policy", NOT an empty scope', () => {
    // `data_retention_policies` had no seed until 0107. An empty list under a heading that says "erasure scope" reads as
    // "nothing of yours will be kept" — the opposite of the truth, which is that nobody decided anything.
    expect(computeScope([])).toEqual({ kind: 'no_policy' });
  });
  it('policies that all exist but are switched off is its OWN state', () => {
    const r = computeScope([pol({ isActive: false }), pol({ tableName: 'orders', isActive: false })]);
    expect(r).toEqual({ kind: 'all_inactive', policyCount: 2 });
  });
  it('orders lines by what a person needs answered first — deleted before kept', () => {
    const r = computeScope([
      pol({ tableName: 'audit_log', action: 'keep_forever' }),
      pol({ tableName: 'orders', action: 'archive', archiveMonths: 72 }),
      pol({ tableName: 'users', action: 'delete' }),
      pol({ tableName: 'listings', action: 'anonymise' }),
    ]);
    expect(r.kind).toBe('scope');
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.lines.map((l) => l.dataClass)).toEqual(['users', 'listings', 'orders', 'audit_log']);
  });
  it('drops an UNKNOWN action rather than defaulting it to delete', () => {
    // Guessing what to do with a farmer's data is the one thing this must never do.
    const r = computeScope([pol({ tableName: 'weird', action: 'incinerate' }), pol()]);
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.lines.map((l) => l.dataClass)).toEqual(['users']);
  });
  it('only keep_forever counts as kept BY LAW — archive is kept temporarily by a commercial rule', () => {
    expect(isKeptByLaw('keep_forever')).toBe(true);
    expect(isKeptByLaw('archive')).toBe(false);
    expect(isKeptByLaw('delete')).toBe(false);
    expect(isKeptByLaw('anonymise')).toBe(false);
  });
  it('names the actions the platform has no pipeline for', () => {
    // The retention worker implements action='delete' only and says so in its own comment.
    expect(actionIsRunnable('delete')).toBe(true);
    expect(actionIsRunnable('keep_forever')).toBe(true);
    expect(actionIsRunnable('anonymise')).toBe(false);
    expect(actionIsRunnable('archive')).toBe(false);
    expect([...ACTIONS_WITH_NO_PIPELINE].sort()).toEqual(['anonymise', 'archive']);
    const r = computeScope([pol({ tableName: 'listings', action: 'anonymise' })]);
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.unrunnable).toEqual(['anonymise']);
  });
  it('keep_forever has no retention window; archive reports the archive months', () => {
    const r = computeScope([
      pol({ tableName: 'audit_log', action: 'keep_forever', activeMonths: 84 }),
      pol({ tableName: 'orders', action: 'archive', activeMonths: 24, archiveMonths: 72 }),
    ]);
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.lines.find((l) => l.dataClass === 'audit_log')!.retainedMonths).toBeNull();
    expect(r.lines.find((l) => l.dataClass === 'orders')!.retainedMonths).toBe(72);
  });
  it('an uncounted class stays NULL and never becomes 0', () => {
    // "0 records" beside kyc_documents tells a farmer who completed onboarding that they have no KYC on file.
    const r = withCounts(computeScope([pol({ tableName: 'kyc_documents' }), pol({ tableName: 'orders' })]), { orders: 368 });
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.lines.find((l) => l.dataClass === 'kyc_documents')!.rows).toBeNull();
    expect(r.lines.find((l) => l.dataClass === 'orders')!.rows).toBe(368);
  });
  it('a negative or non-finite count is treated as uncounted', () => {
    const r = withCounts(computeScope([pol()]), { users: -1 });
    if (r.kind !== 'scope') throw new Error('unreachable');
    expect(r.lines[0].rows).toBeNull();
  });
});

describe('ADMIN-5 · THE COMPLETION GUARD — the point of the wave', () => {
  const scope = computeScope([
    pol({ tableName: 'users', action: 'delete' }),
    pol({ tableName: 'ledger_entries', action: 'keep_forever', legalBasis: 'RBI PSS — 10 years' }),
  ]);

  it('REFUSES completion when nothing has been recorded', () => {
    // This is the state the platform is in TODAY for every erasure: the cooling job announces readiness and nothing
    // listens, so no class has been touched. Refusing is correct, not a bug to route around.
    const c = assertErasureCompletable(scope, []);
    expect(c.ok).toBe(false);
    if (c.ok) throw new Error('unreachable');
    if (c.reason !== 'missing_evidence') throw new Error('unreachable');
    expect(c.missing.sort()).toEqual(['ledger_entries', 'users']);
    expect(c.classesInScope).toBe(2);
  });
  it('REFUSES completion when only SOME classes are recorded', () => {
    const c = assertErasureCompletable(scope, [{ dataClass: 'users', action: 'deleted' }]);
    if (c.ok || c.reason !== 'missing_evidence') throw new Error('unreachable');
    expect(c.missing).toEqual(['ledger_entries']);
  });
  it('a KEPT-BY-LAW class still needs a row — silence is not the same as "we considered it"', () => {
    // The difference between "the RBI requires us to keep your ledger history" and "we never got to your ledger
    // history". A farmer is entitled to the first.
    const c = assertErasureCompletable(scope, [
      { dataClass: 'users', action: 'deleted' },
      { dataClass: 'ledger_entries', action: 'blocked_by_law' },
    ]);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    expect(c.classesEvidenced).toBe(2);
  });
  it('a RETRACTED row does not count as evidence — that is what retracting means', () => {
    const c = assertErasureCompletable(scope, [
      { dataClass: 'users', action: 'retracted' },
      { dataClass: 'ledger_entries', action: 'blocked_by_law' },
    ]);
    if (c.ok || c.reason !== 'missing_evidence') throw new Error('unreachable');
    expect(c.missing).toEqual(['users']);
  });
  it('with NO scope, completability has no answer — it is not vacuously true', () => {
    // The dangerous shortcut: an empty scope makes "every in-scope class is evidenced" trivially satisfiable, which
    // would let an unconfigured platform complete every erasure instantly.
    expect(assertErasureCompletable({ kind: 'no_policy' }, [])).toEqual({ ok: false, reason: 'no_scope' });
    expect(assertErasureCompletable({ kind: 'all_inactive', policyCount: 3 }, [])).toEqual({ ok: false, reason: 'no_scope' });
  });
});

describe('ADMIN-5 · rejection grounds', () => {
  it('accepts only the three lawful grounds W042 names', () => {
    expect([...REJECTION_GROUNDS]).toEqual(['identity_unverified', 'legal_hold', 'manifestly_unfounded']);
    for (const g of REJECTION_GROUNDS) expect(assertRejectionGround(g)).toBe(g);
  });
  it('THROWS on anything else, including a plausible-sounding one', () => {
    expect(() => assertRejectionGround('too_expensive')).toThrow(InvalidDsrInputError);
    expect(() => assertRejectionGround('')).toThrow(InvalidDsrInputError);
    expect(() => assertRejectionGround(undefined)).toThrow(InvalidDsrInputError);
    expect(() => assertRejectionGround(42)).toThrow(InvalidDsrInputError);
    expect(isRejectionGround('other')).toBe(false);
  });
  it('separates the ground the farmer can fix from the two they cannot', () => {
    // Collapsing these into "rejected" tells somebody nothing they can act on, which is how a lawful refusal becomes a
    // grievance.
    expect(groundIsFixableByPrincipal('identity_unverified')).toBe(true);
    expect(groundIsFixableByPrincipal('legal_hold')).toBe(false);
    expect(groundIsFixableByPrincipal('manifestly_unfounded')).toBe(false);
  });
});

describe('ADMIN-5 · the SLA clocks', () => {
  const created = new Date('2026-08-05T12:00:00.000Z');   // 48h before NOW

  it('states the canon SLA', () => {
    expect(ACKNOWLEDGE_HOURS).toBe(72);
    expect(RESOLVE_DAYS).toBe(30);
  });
  it('an unacknowledged request inside the window is DUE, with hours left', () => {
    expect(acknowledgeSla(created, null, NOW)).toEqual({ kind: 'due', hoursLeft: 24 });
  });
  it('an unacknowledged request past the window is BREACHED', () => {
    const late = new Date(created.getTime() + 80 * HOUR);
    const s = acknowledgeSla(created, null, late);
    expect(s.kind).toBe('breached');
    expect(s.kind === 'breached' && s.hoursOver).toBe(8);
  });
  it('acknowledged in time is MET; acknowledged late is BREACHED even though it happened', () => {
    expect(acknowledgeSla(created, new Date(created.getTime() + 4 * HOUR), NOW)).toEqual({ kind: 'met' });
    const s = acknowledgeSla(created, new Date(created.getTime() + 100 * HOUR), NOW);
    expect(s.kind).toBe('breached');
  });
  it('NO CREATION DATE is UNMEASURED, not met', () => {
    // Before 0107 every request was unmeasurable, and "0 breaches" over unmeasurable requests is an absent measurement
    // wearing a clean record's clothes.
    expect(acknowledgeSla(null, null, NOW)).toEqual({ kind: 'unmeasured' });
    expect(acknowledgeSla(null, created, NOW)).toEqual({ kind: 'unmeasured' });
  });
  it('a cooling window is NOT a resolve breach — it is the farmer exercising a right', () => {
    // Counting it as a breach would create pressure to shorten the very window that protects them.
    const cooling = new Date('2026-10-08T00:00:00.000Z');
    const s = resolveSla(created, null, cooling, new Date('2026-09-20T00:00:00.000Z'));
    expect(s.kind).toBe('due');
    // and without the cooling window the same request WOULD be breached by then
    const noCooling = resolveSla(created, null, null, new Date('2026-09-20T00:00:00.000Z'));
    expect(noCooling.kind).toBe('breached');
  });
  it('summarises breached, due, met and unmeasured SEPARATELY', () => {
    const s = summariseSla([
      { kind: 'met' }, { kind: 'met' }, { kind: 'breached', hoursOver: 3 },
      { kind: 'due', hoursLeft: 10 }, { kind: 'unmeasured' }, { kind: 'unmeasured' },
    ]);
    expect(s).toEqual({ met: 2, breached: 1, due: 1, unmeasured: 2 });
  });
});

describe('ADMIN-5 · the shared two-person rule (extracted at its third instance)', () => {
  it('THROWS when the approver is the initiator', () => {
    expect(() => assertSecondPerson('beginning an erasure', 'op-a', 'op-a')).toThrow(SecondPersonRequiredError);
  });
  it('allows a different operator', () => {
    expect(() => assertSecondPerson('beginning an erasure', 'op-a', 'op-b')).not.toThrow();
  });
  it('an UNKNOWN initiator is allowed through rather than creating a permanent dead end', () => {
    // A request filed from the app has no operator initiator. Refusing would mean nobody can ever countersign it, and
    // there is no second field to appeal to — a recoverable risk versus an unrecoverable block.
    expect(() => assertSecondPerson('x', null, 'op-b')).not.toThrow();
    expect(() => assertSecondPerson('x', undefined, 'op-b')).not.toThrow();
  });
  it('refuses when the approver cannot be identified — with EITHER a known or an unknown initiator', () => {
    // MY FIRST VERSION OF THIS TEST WAS MISLABELLED and a mutation test caught it. It was called "two nulls must not
    // compare equal" and asserted `assertSecondPerson('x', null, '')`, which passes through the `!approver` guard and
    // never reaches the comparison at all — so reordering the comparison above the null-initiator return changed
    // nothing and the mutant survived. The comparison ORDER genuinely does not matter here, because `!approver` runs
    // first and a null initiator can never equal a non-empty approver. What actually protects the both-unknown case is
    // this guard, so that is what the test says now.
    expect(() => assertSecondPerson('x', null, '')).toThrow(SecondPersonRequiredError);
    expect(() => assertSecondPerson('x', 'op-a', '')).toThrow(SecondPersonRequiredError);
    expect(() => assertSecondPerson('x', undefined, undefined as unknown as string)).toThrow(SecondPersonRequiredError);
  });
  it('is a 409 and not a 403 — the operator has the permission, they lack a colleague', () => {
    try { assertSecondPerson('beginning an erasure', 'op-a', 'op-a'); throw new Error('should have thrown'); }
    catch (e) { expect((e as { getStatus?: () => number }).getStatus?.()).toBe(409); }
  });
  it('the display-side counterpart shows the control when the viewer is unknown', () => {
    // Safe direction for a DISPLAY decision: a redundant refusal is recoverable, a wrongly hidden control blocks work
    // with no explanation on screen.
    expect(isSecondPerson('op-a', null)).toBe(true);
    expect(isSecondPerson('op-a', 'op-a')).toBe(false);
    expect(isSecondPerson('op-a', 'op-b')).toBe(true);
    expect(isSecondPerson(null, 'op-b')).toBe(true);
  });
  it('the constraint idiom keeps BOTH null escapes', () => {
    // Without them the constraint refuses every row where either party is unrecorded — which includes every backfilled
    // row — and the migration fails on data that is perfectly lawful.
    const sql = makerNeCheckerConstraint('widgets', 'made_by', 'checked_by');
    expect(sql).toContain('checked_by IS NULL OR made_by IS NULL OR checked_by <> made_by');
  });
});
