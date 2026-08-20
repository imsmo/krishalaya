// modules/dairy/__tests__/tenant6c3-second-signature.spec.ts · PC-56 TENANT-6c-3 · W169's control, twice stated.
//
// *"Preview/approve needs dairy-desk + `settlement.close` + checker — this is 312 families' milk money."*
//
// Three things were wrong and the first is the worst: **the roles seed granted `dairy.manage` to `dairy_farmer`**, so
// any member could create the rate card that sets what every other member is paid, generate a bill and pay it out of
// the cooperative's wallet. `settlement.close` was checked on neither act. And nothing anywhere stopped one person
// previewing a cycle and approving it.
import { DairyBillCycle } from '../domain/dairy-bill-cycle.entity';
import {
  CYCLE_STATUSES, canTransition, cycleApprovalRefusal,
} from '../domain/dairy-cycle';
import { DairyPermissions, canCloseSettlement, canManageDairy } from '../policies/dairy.policies';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBill } from '../domain/milk-bill.entity';
import { CycleApprovalRefusedError } from '../domain/dairy.errors';
import { RequestContext } from '../../../core/tenancy-context/request-context';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fakeReplica = () => {
  const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  return { provider: { forTenant: () => exec } as never, exec };
};
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

const CLOSES = new Date('2026-07-15T18:30:00.000Z');
const PREVIEWED_AT = new Date('2026-07-16T04:00:00.000Z');
const APPROVED_AT = new Date('2026-07-16T13:00:00.000Z');   // W169's "Thu evening"

function cycle(over: Partial<Parameters<typeof DairyBillCycle.rehydrate>[0]> = {}) {
  return DairyBillCycle.rehydrate({
    id: 'cyc1', tenantId: 'tA', paymentCycle: 'fortnightly',
    periodStart: '2026-07-01', periodEnd: '2026-07-15',
    closesAt: CLOSES, payday: '2026-07-17', status: 'previewed', closedAt: CLOSES,
    billsGeneratedAt: CLOSES, billsGenerated: 3, billsSkipped: 0, billsFailed: 0,
    previewedAt: PREVIEWED_AT, previewedBy: 'desk1', billsPreviewed: 3,
    approvedAt: null, approvedBy: null, billsApproved: null, ...over,
  });
}

const MIGRATION = '../../../../../../db/migrations/0159_dairy_cycle_second_signature.sql';

const ctxWith = (perms: string[]): RequestContext => ({ permissions: new Set(perms) } as unknown as RequestContext);

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE GRANT A FARMER SHOULD NEVER HAVE HAD', () => {
  const seed = () => fs.readFileSync(path.join(__dirname, '../../../../../../db/seeds/core/0004_roles_permissions.sql'), 'utf8');
  const migration = () => fs.readFileSync(path.join(__dirname, MIGRATION), 'utf8');

  it('the roles seed no longer gives `dairy_farmer` the manage verb', () => {
    // THE DEFECT, held as a test. The grant read `('dairy_farmer','tenant_admin') AND p.code IN ('dairy.manage')`,
    // while the permission's own description is "Manage dairy MCC + collections + milk bills" and the policy file
    // documents it as the OPERATOR's verb with "Members READ their own data (no perm)". The comment and the grant
    // contradicted each other and the grant won: a member could set what every member is paid, and pay a bill.
    expect(seed()).not.toMatch(/'dairy_farmer'[^)]*\)\s*AND p\.code IN \('dairy\.manage'\)/);
    expect(seed()).toMatch(/OR \(r\.code IN \('tenant_admin'\) AND p\.code IN \('dairy\.manage'\)\)/);
  });

  it('and a migration removes it from installs that already ran the seed', () => {
    // Correcting the seed fixes a FRESH install only. These are not two mechanisms for one fact: the seed states the
    // desired matrix, and a migration is the only thing that can change state a previous seed already wrote.
    //
    // ANCHORED AT THE START OF A LINE, and this is not pedantry. The first version of this test matched
    // `/DELETE FROM role_permissions/` anywhere in the file — which a `-- DELETE FROM role_permissions` still
    // satisfies, so commenting the repair out passed the test while leaving every existing cooperative's farmers
    // holding the pay verb. A mutation run caught it. Same shape as TENANT-6c-2's substring guard: a source-level
    // assertion has to be anchored to the thing that RUNS.
    expect(migration()).toMatch(/^DELETE FROM role_permissions$/m);
    expect(migration()).toMatch(/^ WHERE permission_code = 'dairy\.manage'$/m);
    expect(migration()).toMatch(/^   AND role_id IN \(SELECT id FROM roles WHERE code = 'dairy_farmer'\);$/m);
  });

  it('every sibling vertical in that file has TWO verbs — dairy had only the manage one', () => {
    // Which is WHY farmers were given it: there was nothing else to give them. Recorded as a test so the next person
    // to add a vertical sees the pattern rather than repeating the shortcut.
    for (const pair of [['loan.borrow', 'loan.manage'], ['insurance.enrol', 'insurance.manage'], ['contract.grow', 'contract.manage']]) {
      expect(seed()).toContain(pair[0]);
      expect(seed()).toContain(pair[1]);
    }
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the two keys', () => {
  it('reuses 0144\'s `settlement.close` rather than inventing a dairy twin', () => {
    // An access review that has to check two different keys both meaning "may close money" is an access review nobody
    // completes. W169 names this exact permission, and 0144 seeded it after W147 named it twice with no grant anywhere.
    expect(DairyPermissions.SettlementClose).toBe('settlement.close');
    expect(DairyPermissions.Manage).toBe('dairy.manage');
  });

  it('reads both from the request context, and god mode satisfies either', () => {
    expect(canManageDairy(ctxWith(['dairy.manage']))).toBe(true);
    expect(canCloseSettlement(ctxWith(['dairy.manage']))).toBe(false);
    expect(canCloseSettlement(ctxWith(['settlement.close']))).toBe(true);
    expect(canCloseSettlement(ctxWith(['*']))).toBe(true);
    expect(canManageDairy(ctxWith([]))).toBe(false);
  });

  it('the routes require BOTH, and the approve route is behind its own flag', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/v1/bill-cycles.controller.ts'), 'utf8');
    for (const act of ['preview', 'approve']) {
      expect(src).toMatch(new RegExp(`@Post\\(':id/${act}'\\) @RequirePermissions\\(DairyPermissions\\.Manage, DairyPermissions\\.SettlementClose\\)`));
    }
    // A SECOND flag, not a reuse: killing approval must not stop members being told what they are owed, and killing
    // preview must not leave an already-previewed cycle unapprovable.
    expect(src).toMatch(/@FeatureFlag\('dairy_cycle_approve'\)/);
    expect(src).toMatch(/@FeatureFlag\('dairy_cycle_preview'\)/);
  });

  it('every dairy controller PASSES the key into the actor — a decorator alone is not the guard', () => {
    // A mutation survivor: dropping `canCloseSettlement` from `actor()` left all four route decorators intact and the
    // suite green, while the service — where `canCloseSettlement` is OPTIONAL so existing callers compile — read the
    // absent field as false and refused every legitimate approval. The decorator and the actor are two halves of one
    // control and both have to be asserted.
    const dir = path.join(__dirname, '../controllers/v1');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.controller.ts'));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/private actor\(/.test(src)) continue;
      expect(src).toMatch(/canCloseSettlement: canCloseSettlement\(ctx\)/);
    }
  });

  it('the single-bill approve route carries them too', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/v1/milk-bills.controller.ts'), 'utf8');
    expect(src).toMatch(/@Post\(':id\/approve'\) @RequirePermissions\(DairyPermissions\.Manage, DairyPermissions\.SettlementClose\)/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the checker rule', () => {
  it('refuses the person who previewed it — unconditionally, with no threshold', () => {
    expect(cycleApprovalRefusal({ status: 'previewed', previewedBy: 'desk1' }, 'desk1')).toBe('DAIRY_CYCLE_CHECKER_IS_PREVIEWER');
    expect(cycleApprovalRefusal({ status: 'previewed', previewedBy: 'desk1' }, 'admin1')).toBeNull();
    // 0144's ruling, borrowed: "a cycle close is not an amount — it is a decision that turns a fortnight of trade into
    // documents a member will hold and a bank manager will read. Every one of them gets two humans." No amount appears
    // anywhere in this function, and that is the assertion.
    expect(cycleApprovalRefusal.length).toBe(2);
  });

  it('refuses a cycle no member has been shown', () => {
    for (const status of ['open', 'closed'] as const) {
      expect(cycleApprovalRefusal({ status, previewedBy: null }, 'admin1')).toBe('DAIRY_CYCLE_NOT_PREVIEWED');
    }
    // Approving a cycle nobody was told about is approving money in silence, which is the exact opposite of W169's
    // subtitle.
    expect(cycleApprovalRefusal({ status: 'approved', previewedBy: 'desk1' }, 'admin1')).toBe('DAIRY_CYCLE_NOT_PREVIEWED');
  });

  it('a cycle with NO recorded previewer does not block anybody — the stamp is what it compares', () => {
    // Defensive rather than theoretical: a hand-repaired row could be `previewed` with a null author, and the checker
    // rule must then refuse nobody rather than refuse everybody.
    expect(cycleApprovalRefusal({ status: 'previewed', previewedBy: null }, 'anyone')).toBeNull();
  });

  it('the aggregate throws with the previewer named, so a console can say WHO must not approve', () => {
    const c = cycle();
    try {
      c.approve(APPROVED_AT, 'desk1');
      throw new Error('should have refused');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(CycleApprovalRefusedError);
      expect(e).toMatchObject({ code: 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER', details: { previewedBy: 'desk1' } });
    }
    expect(c.status).toBe('previewed');
    expect(c.pullEvents()).toHaveLength(0);
  });

  it('approves for a different human, stamps both, and publishes who signed', () => {
    const c = cycle();
    c.approve(APPROVED_AT, 'admin1');
    expect(c.status).toBe('approved');
    expect(c.approvedBy).toBe('admin1');
    expect(c.approvedAt).toEqual(APPROVED_AT);
    const [e] = c.pullEvents();
    expect(e.type).toBe('dairy.cycle_approved');
    // Both humans on the event: an auditor asking "who signed this fortnight" gets both names from one row.
    expect(e.payload).toMatchObject({ cycleId: 'cyc1', previewedBy: 'desk1', approvedBy: 'admin1', payday: '2026-07-17' });
    // NO member-facing recipient: the member was told at preview what they are owed, and "two of our staff agreed with
    // each other" is not news for them.
    expect(e.payload.userId).toBeUndefined();
  });

  it('cannot be approved twice', () => {
    const c = cycle({ status: 'approved', approvedAt: APPROVED_AT, approvedBy: 'admin1' });
    expect(() => c.approve(APPROVED_AT, 'admin2')).toThrow(CycleApprovalRefusedError);
  });

  it('the state machine allows previewed → approved and nothing else out of it', () => {
    expect([...CYCLE_STATUSES]).toEqual(['open', 'closed', 'previewed', 'approved']);
    expect(canTransition('previewed', 'approved')).toBe(true);
    expect(canTransition('closed', 'approved')).toBe(false);
    // NOTHING leaves `approved` — asserted over the whole vocabulary rather than target by target, because a
    // self-transition (`approved: ['approved']`) survived a mutation run against the target-by-target version. A
    // re-approvable cycle is a second signature that can be overwritten.
    for (const to of CYCLE_STATUSES) expect(canTransition('approved', to)).toBe(false);
    // `paid` is still not in the vocabulary: no payout batch exists (`payout_id` has never been written) and a bill
    // carrying a deduction cannot be paid at all, so it would be a state nothing could reach.
    expect([...CYCLE_STATUSES]).not.toContain('paid');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the SQL and the constraint', () => {
  it('persists the approval stamps through the granted columns', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const c = cycle();
    c.approve(APPROVED_AT, 'admin1');
    await new DairyBillCycleRepository(fakeReplica().provider).updateState(tx as never, c);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/approved_at=\$12, approved_by=\$13, bills_approved=\$14/);
    expect(params[11]).toEqual(APPROVED_AT);
    expect(params[12]).toBe('admin1');
    // Still never the window, the close instant or the payday — 0157's grant, unchanged.
    for (const forbidden of ['period_start=', 'closes_at=', 'payday=']) expect(sql).not.toContain(forbidden);
  });

  const migrationText = () => fs.readFileSync(path.join(__dirname, MIGRATION), 'utf8');

  it('the checker rule is a DATABASE constraint as well as a domain refusal', () => {
    const mig = migrationText();
    // Both deliberately: the domain gives the operator a readable error; the constraint makes the rule true of the ROW
    // whatever wrote it — a hand-run UPDATE during an incident, a future job, a bug. 0143 did the same on payout_batches.
    expect(mig).toMatch(/ck_dairy_bill_cycle_maker_ne_checker/);
    expect(mig).toMatch(/approved_by IS NULL OR previewed_by IS NULL OR approved_by <> previewed_by/);
    // And an approval cannot exist without the preview that preceded it.
    expect(mig).toMatch(/status <> 'approved' OR \(approved_at IS NOT NULL AND previewed_at IS NOT NULL\)/);
    // No threshold column anywhere: this control is unconditional (contrast payout_batches.checker_threshold_minor).
    expect(mig).not.toMatch(/checker_threshold/);
    // Anchored, for the reason the grant repair is: a constraint renamed or commented out is a constraint that is not
    // there, and the un-anchored version of these three passed while it was.
    expect(mig).toMatch(/^ALTER TABLE dairy_bill_cycles ADD CONSTRAINT ck_dairy_bill_cycle_maker_ne_checker$/m);
    expect(mig).toMatch(/^  CHECK \(status IN \('open','closed','previewed','approved'\)\);$/m);
  });

  it('the migration ships the flag OFF and grants the app role exactly the stamps', () => {
    const mig = migrationText();
    // Law 10, and the same anchoring lesson: `true, 100, 'experiment'` would ship approval switched on to every
    // cooperative on this platform the moment the migration ran.
    expect(mig).toMatch(/^   false, 100, 'experiment'\)$/m);
    expect(mig).toMatch(/^GRANT UPDATE \(approved_at, approved_by, bills_approved\) ON dairy_bill_cycles TO kv_app;$/m);
    // A SECOND flag, not a rename of the preview's: killing approval must not stop members being told what they owe.
    expect(mig).toMatch(/'dairy_cycle_approve'/);
    expect(mig).not.toMatch(/DROP .*dairy_cycle_preview/);
  });

  it('the approval pass claims PREVIEWED bills only — disputed ones are held out', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkBillRepository(fakeReplica().provider).previewedForCycle(tx as never, 'tA', 'cyc1', 500);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND cycle_id=\$2 AND status='previewed'/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(params).toEqual(['tA', 'cyc1', 500]);
    // W169's "disputed pauses one bill, never the cycle", made literal by a predicate rather than by a comment.
    expect(sql).not.toMatch(/disputed/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('approveCycle — the cycle moves as one', () => {
  function harness(over: { cycle?: DairyBillCycle; pending?: string[]; approve?: jest.Mock; counts?: Record<string, number> } = {}) {
    const c = over.cycle ?? cycle();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    const cycles = { getForUpdate: jest.fn(async () => c), updateState: jest.fn(), today: jest.fn(), activePaymentCycles: jest.fn(), ensure: jest.fn(), dueToClose: jest.fn(), needingBills: jest.fn(), listFor: jest.fn() };
    const collections = { membershipsToBillForCycle: jest.fn(async () => []) };
    const bills = { approve: over.approve ?? jest.fn(async () => ({ id: 'b' })), preview: jest.fn(), generate: jest.fn() };
    const billRepo = {
      previewedForCycle: jest.fn(async () => (over.pending ?? ['b1', 'b2']).map((id) => ({ id }))),
      statusCountsForCycle: jest.fn(async () => over.counts ?? { approved: 2 }),
      draftsForCycle: jest.fn(async () => []), billAttemptsByMembership: jest.fn(async () => new Map()),
    };
    const memberships = { getById: jest.fn() };
    const svc = new DairyBillCycleService(uow as never, outbox as never, metrics as never, idem as never,
      cycles as never, collections as never, bills as never, billRepo as never, memberships as never,
      // [PC-56 TENANT-6c-5] W169's deduction tile, and the flag that gates assembly.
      { cycleTotals: jest.fn(async () => ({ totalMinor: 0n, byType: {} })) } as never,
      { isEnabled: jest.fn(async () => false) } as never);
    return { svc, cycles, bills, billRepo, outbox, idem, c };
  }
  const checker = { userId: 'admin1', canManage: true, canCloseSettlement: true };

  it('signs the cycle, then approves each bill in its own transaction', async () => {
    const { svc, cycles, bills, c } = harness();
    const out = await svc.approveCycle('tA', checker, 'cyc1');
    expect(c.status).toBe('approved');
    expect(c.approvedBy).toBe('admin1');
    expect(cycles.updateState).toHaveBeenCalled();
    expect(bills.approve).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ approved: 2, failed: 0, remaining: 0, skippedDisputed: 0 });
  });

  it('publishes the cycle-level signature ONCE', async () => {
    const { svc, outbox } = harness();
    await svc.approveCycle('tA', checker, 'cyc1');
    expect(outbox.write.mock.calls.map((c: any[]) => c[1].eventType)).toEqual(['dairy.cycle_approved']);
  });

  it('REFUSES the previewer, before touching a single bill', async () => {
    const { svc, bills, cycles } = harness();
    await expect(svc.approveCycle('tA', { userId: 'desk1', canManage: true, canCloseSettlement: true }, 'cyc1'))
      .rejects.toBeInstanceOf(CycleApprovalRefusedError);
    expect(bills.approve).not.toHaveBeenCalled();
    expect(cycles.updateState).not.toHaveBeenCalled();
  });

  it('REFUSES without `settlement.close`, even with the dairy desk key', async () => {
    const { svc, cycles } = harness();
    await expect(svc.approveCycle('tA', { userId: 'admin1', canManage: true }, 'cyc1'))
      .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    await expect(svc.approveCycle('tA', { userId: 'admin1', canManage: false, canCloseSettlement: true }, 'cyc1'))
      .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    expect(cycles.getForUpdate).not.toHaveBeenCalled();
    // Absent means FALSE on that flag: a caller that never sets it cannot approve. Fail-closed is the only safe
    // default for a key that guards 312 families' milk money.
  });

  it('a RE-PRESS finishes a partial pass without a second signature', async () => {
    const signed = cycle({ status: 'approved', approvedAt: APPROVED_AT, approvedBy: 'admin1', billsApproved: 2 });
    const { svc, bills, outbox } = harness({ cycle: signed, pending: ['b3'] });
    const out = await svc.approveCycle('tA', checker, 'cyc1');
    expect(out.approved).toBe(1);
    expect(bills.approve).toHaveBeenCalledTimes(1);
    expect(outbox.write).not.toHaveBeenCalled();     // the decision was made once, by admin1
    // AND THE COUNT ACCUMULATES: two were signed before, one now, so the cycle says three. Replacing rather than
    // adding survived a mutation run and would have reported a resumed 312-bill pass as "1 approved" — an operator
    // reading that would press again, or worse, believe 311 members were missed.
    expect(signed.toProps().billsApproved).toBe(3);
  });

  it('one bill failing does not stop the rest', async () => {
    const approve = jest.fn(async (_t: string, _a: unknown, id: string) => { if (id === 'b2') throw new Error('boom'); return { id }; });
    const { svc } = harness({ pending: ['b1', 'b2', 'b3'], approve, counts: { approved: 2, previewed: 1 } });
    expect(await svc.approveCycle('tA', checker, 'cyc1')).toMatchObject({ approved: 2, failed: 1, remaining: 1 });
  });

  it('reports DISPUTED bills as held out, measured from the bills', async () => {
    // W169: "disputed pauses one bill, never the cycle". The number an operator needs is not "312 minus what worked" —
    // it is how many members are still waiting on an answer, and it comes from the bills rather than from this loop.
    const { svc } = harness({ pending: ['b1'], counts: { approved: 1, disputed: 2, previewed: 0 } });
    expect(await svc.approveCycle('tA', checker, 'cyc1')).toMatchObject({ approved: 1, remaining: 0, skippedDisputed: 2 });
  });

  it('`remaining` is MEASURED from the bills, so a BOUNDED pass tells the truth about what is left', async () => {
    // The pass is bounded (312 bills, `limit`) and resumable, so "what is left" cannot be `claimed - approved`: that
    // arithmetic is zero on every full pass and therefore looks right in every fixture where the bound was not hit.
    // A mutation survivor until this test existed. Here one bill was claimed and signed while three more still await
    // a signature, and only the count from the bills knows that.
    const { svc } = harness({ pending: ['b1'], counts: { approved: 1, previewed: 3 } });
    expect(await svc.approveCycle('tA', checker, 'cyc1', 1)).toMatchObject({ approved: 1, remaining: 3 });
  });

  it('is idempotency-wrapped at the route', async () => {
    const { svc, idem } = harness();
    await svc.approveCycleIdempotent('tA', checker, 'cyc1', 'idem-k');
    expect(idem.remember).toHaveBeenCalledWith('idem-k', 'admin1', 'dairy.cycle.approve', expect.any(Function));
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the ordering W169 actually describes', () => {
  function billHarness() {
    const b = MilkBill.generate({ id: 'b1', tenantId: 'tA', membershipId: 'mem1', cycleId: 'cyc1', periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 204_526n, grossMinor: 84_400n });
    b.pullEvents();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const bills = { getForUpdate: jest.fn(async () => b), update: jest.fn(), void: jest.fn() };
    const svc = new MilkBillService(uow as never, { write: jest.fn() } as never, { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as never,
      metrics as never, { post: jest.fn() } as never, { write: jest.fn() } as never, bills as never,
      { detachFromBill: jest.fn(), attachToBill: jest.fn() } as never,
      { getById: jest.fn(async () => ({ id: 'mem1', farmerUserId: 'farmer1' })) } as never,
      { disputeWindowHours: jest.fn(async () => 24) } as never,
      // [PC-56 TENANT-6c-4] the deduction's destination: lines, vocabulary, credits, consent, applier, flags.
      { linesForBill: jest.fn(async () => []), insert: jest.fn(), listForUpdate: jest.fn(async () => []), markApplied: jest.fn() } as never,
      { byCode: jest.fn(async () => null), byIds: jest.fn(async () => new Map()) } as never,
      { getForUpdate: jest.fn(async () => null) } as never,
      { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null), insert: jest.fn() } as never,
      { applyAll: jest.fn(async () => []) } as never,
      { isEnabled: jest.fn(async () => true) } as never,
      // [PC-56 TENANT-6c-5] the assembler: what the CYCLE deducts when nobody typed a line.
      { assemble: jest.fn(async () => ({ lines: [], totalMinor: 0n, capMinor: 0n, deferred: [] })) } as never);
    return { svc, b };
  }

  it('a bill is APPROVED while its member\'s window is still open — it is the PAYMENT that waits', async () => {
    const { svc, b } = billHarness();
    const previewAt = new Date('2026-07-16T04:00:00.000Z');
    await svc.preview('tA', { userId: 'desk1', canManage: true, canCloseSettlement: true }, 'b1', previewAt);
    // Thursday evening: the window runs to Friday morning, and W169 approves anyway. Approval is the cooperative
    // agreeing its own figures; the member's 24 hours protect the MONEY MOVING, which 6c-2 put on `markPaid`.
    await svc.approve('tA', { userId: 'admin1', canManage: true, canCloseSettlement: true }, 'b1');
    expect(b.status).toBe('approved');
    expect(b.isDisputeWindowOpen(new Date('2026-07-16T13:00:00.000Z'))).toBe(true);
  });

  it('and approving one bill needs the second key too', async () => {
    const { svc } = billHarness();
    await expect(svc.approve('tA', { userId: 'desk1', canManage: true }, 'b1')).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('what is deliberately NOT here', () => {
  it('the deduction was deliberately NOT here — TENANT-6c-4 built it', () => {
    // What this test said when 6c-3 shipped: *"a bill carrying a DEDUCTION still cannot be paid, so the >25% consent
    // rule has nothing to gate"*. That was true and it was the reason this wave stopped where it did — 0157 made
    // `pay()` refuse ANY deducted bill, so a consent gate would have been a gate in front of a wall.
    //
    // 0160 built the wall's other side: the vocabulary is a table, every line names the row it pays, the feed credit
    // and the loan both have destinations, and the member's fresh consent is a record. So the assertion moves to what
    // is still absent rather than being deleted — the same discipline the cycle-status test follows.
    const b = MilkBill.generate({
      id: 'b1', tenantId: 'tA', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      totalLitresMilli: 1n, grossMinor: 100_000n,
      deductions: [{ id: 'ded1', type: 'loan_emi', amountMinor: 30_000n, sourceType: 'loan', sourceId: 'loan1', status: 'pending' }],
    });
    expect(b.deductionsMinor).toBe(30_000n);
    // A line now points at a loan, which is what makes the 30% consent gate mean something.
    expect(b.deductionLines[0]).toMatchObject({ sourceType: 'loan', sourceId: 'loan1' });
  });

  it('there is still no payout BATCH behind "one bank trip"', () => {
    const b = MilkBill.generate({ id: 'b1', tenantId: 'tA', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 1n, grossMinor: 1n });
    expect(b.toJSON().payoutId).toBeNull();
  });
});
