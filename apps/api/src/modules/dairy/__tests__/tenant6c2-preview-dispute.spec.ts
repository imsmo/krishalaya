// modules/dairy/__tests__/tenant6c2-preview-dispute.spec.ts · PC-56 TENANT-6c-2 · W169's promise to the member.
//
// *"Preview goes to every member in Gujarati BEFORE money moves — surprises are for birthdays, not milk money."*
// *"bills `previewed` Thu morning (member sees every pour + every deduction, 24h dispute window) → `approved` Thu
//  evening → `paid` Fri"*, *"disputed pauses one bill, never the cycle"*, *"Last cycle disputes 2 / 309"*.
//
// None of it existed: `dispute_window_ends` had a reader in apps/mobile and no writer anywhere, `MilkBill.dispute()`
// was called by no service and no route, no dairy bill event was in the notification map, and the only preview act was
// per-bill while the canon's is per-cycle. These tests pin the window being SET and ENFORCED, the objection being
// RECORDED and ANSWERED, and the void that makes an upheld objection actionable at all.
import { fakeNoticeVars } from '../../../../test/helpers/notice-vars';
import { MilkBill } from '../domain/milk-bill.entity';
import { MilkBillDispute, DisputeReasonTooShortError, DisputeAlreadyResolvedError, REASON_FLOOR } from '../domain/milk-bill-dispute.entity';
import { BILL_STATUSES, canTransition, isTerminal } from '../domain/milk-bill.state';
import { CYCLE_STATUSES } from '../domain/dairy-cycle';
import { DairyBillCycle } from '../domain/dairy-bill-cycle.entity';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDisputeService } from '../services/milk-bill-dispute.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import {
  BillNotFoundError, BillNotPayableError, BillVoidReasonRequiredError, CollectionStampLostError,
  DisputeAlreadyOpenError, DisputeNotFoundError, DisputeWindowClosedError, DisputeWindowOpenError,
} from '../domain/dairy.errors';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fakeReplica = () => {
  const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  return { provider: { forTenant: () => exec } as never, exec };
};
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

/** Thursday morning: the cycle shut on Wednesday night and the preview goes out. */
const PREVIEW_AT = new Date('2026-07-16T04:00:00.000Z');
/** Friday morning, 24 hours later — W169's window. */
const WINDOW_END = new Date('2026-07-17T04:00:00.000Z');
const INSIDE = new Date('2026-07-16T18:00:00.000Z');
const AT_THE_INSTANT = new Date('2026-07-17T04:00:00.000Z');
const AFTER = new Date('2026-07-17T04:00:00.001Z');

/** A fresh draft, with `BillGenerated` already drained so each test reads only the events IT caused. */
const bill = () => {
  const b = MilkBill.generate({
    id: 'b1', tenantId: 'tA', membershipId: 'mem1', cycleId: 'cyc1',
    periodStart: '2026-07-01', periodEnd: '2026-07-15',
    totalLitresMilli: 204_526n, grossMinor: 84_400n,
  });
  b.pullEvents();
  return b;
};
const previewedBill = () => { const b = bill(); b.preview(PREVIEW_AT, WINDOW_END, 'farmer1', { period: '01/07–15/07', litres: '204.526', net: 'INR 8,412.00', deductions: 'INR 0.00', window_ends: '16/07 09:00' }); b.pullEvents(); return b; };
const approvedBill = () => { const b = previewedBill(); b.approve(); b.pullEvents(); return b; };

/* ----------------------------------------------------------------------------------------------------------- */
describe('the window: SET by the preview, and ENFORCED at the payment', () => {
  it('previewing writes the window and the instant it started, and says so to the MEMBER', () => {
    const b = bill();
    expect(b.disputeWindowEnds).toBeNull();
    expect(b.wasPreviewed).toBe(false);

    b.preview(PREVIEW_AT, WINDOW_END, 'farmer1', { period: '01/07–15/07', litres: '204.526', net: 'INR 8,412.00', deductions: 'INR 0.00', window_ends: '16/07 09:00' });

    expect(b.status).toBe('previewed');
    expect(b.disputeWindowEnds).toEqual(WINDOW_END);
    expect(b.wasPreviewed).toBe(true);
    const [e] = b.pullEvents();
    expect(e.type).toBe('dairy.bill_previewed');
    // The RECIPIENT is in the payload. ADMIN-6b's finding, four waves running: a notification-map row pointing at a
    // payload with no user id looks like a fix and sends nothing.
    expect(e.payload).toMatchObject({
      // [PC-56 TENANT-6d-7] `period` is the sentence a member reads (`01/07–15/07`); `periodRange` is the ISO pair a
      // consumer parses. Both, under names that cannot collide — the collision is what blanked four of this notice's
      // five variables for four waves.
      userId: 'farmer1', membershipId: 'mem1', period: '01/07–15/07', periodRange: '2026-07-01..2026-07-15',
      netMinor: '84400', deductionsMinor: '0', totalLitresMilli: '204526',
      windowEndsAt: WINDOW_END.toISOString(),
    });
  });

  it('a bill with NO window has not had one CLOSE — it never opened', () => {
    // The distinction matters: `pay` has its own separate refusal for a bill nobody has been shown, and treating a
    // missing window as an expired one would let an un-previewed bill be paid the moment it is approved.
    expect(bill().isDisputeWindowOpen(INSIDE)).toBe(false);
  });

  it('the window is open up to but NOT including its instant', () => {
    const b = previewedBill();
    expect(b.isDisputeWindowOpen(PREVIEW_AT)).toBe(true);
    expect(b.isDisputeWindowOpen(INSIDE)).toBe(true);
    expect(b.isDisputeWindowOpen(new Date(WINDOW_END.getTime() - 1))).toBe(true);
    expect(b.isDisputeWindowOpen(AT_THE_INSTANT)).toBe(false);
    expect(b.isDisputeWindowOpen(AFTER)).toBe(false);
  });

  it('REFUSES to pay while the member still has time — the promise, enforced', () => {
    const b = approvedBill();
    expect(() => b.markPaid(INSIDE)).toThrow(DisputeWindowOpenError);
    expect(b.status).toBe('approved');
    expect(b.pullEvents()).toHaveLength(0);          // and publishes no BillPaid
  });

  it('pays once the window has shut', () => {
    const b = approvedBill();
    b.markPaid(AT_THE_INSTANT);
    expect(b.status).toBe('paid');
    expect(b.pullEvents()[0].type).toBe('dairy.bill_paid');
  });

  it('still refuses a bill that was never approved, window or no window', () => {
    const b = previewedBill();
    expect(() => b.markPaid(AFTER)).toThrow(BillNotPayableError);
  });

  it('names the window in the refusal, so an operator knows WHEN it can be paid', () => {
    const b = approvedBill();
    expect(() => b.markPaid(INSIDE)).toThrow(expect.objectContaining({
      code: 'DISPUTE_WINDOW_OPEN', details: { billId: 'b1', windowEndsAt: WINDOW_END.toISOString() },
    }));
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the objection', () => {
  it('the member disputes INSIDE the window and the bill pauses', () => {
    const b = previewedBill();
    b.dispute(INSIDE, 'my litres are short by about four');
    expect(b.status).toBe('disputed');
    const [e] = b.pullEvents();
    expect(e.type).toBe('dairy.bill_disputed');
    expect(e.payload).toMatchObject({ reason: 'my litres are short by about four' });
  });

  it('REFUSES a dispute after the window and on a bill nobody was shown', () => {
    expect(() => previewedBill().dispute(AFTER, 'too late')).toThrow(DisputeWindowClosedError);
    expect(() => bill().dispute(INSIDE, 'never previewed')).toThrow(DisputeWindowClosedError);
    // The two refusals carry DIFFERENT messages, because "you are out of time" and "this bill has not been sent to you
    // yet" are different things to tell a farmer.
    try { bill().dispute(INSIDE, 'x'); } catch (e: any) { expect(e.details.windowEndsAt).toBeNull(); }
  });

  it('a rejected objection puts the bill back with a FRESH window', () => {
    const b = previewedBill();
    b.dispute(INSIDE, 'my litres are short by about four'); b.pullEvents();
    const second = new Date('2026-07-18T04:00:00.000Z');
    b.resolveToPreviewed(AFTER, second, 'farmer1', 'rejected',
      { period: '01/07–15/07', outcome: { en: 'your objection was not accepted', gu: 'તમારો વાંધો સ્વીકાર્યો નથી' }, note: 'n' });
    expect(b.status).toBe('previewed');
    expect(b.disputeWindowEnds).toEqual(second);
    // Not the old window: a resolution that answered the objection and simultaneously removed the member's ability to
    // object to the ANSWER would be a worse state than having no dispute path at all.
    expect(b.isDisputeWindowOpen(AFTER)).toBe(true);
    const [e] = b.pullEvents();
    expect(e.type).toBe('dairy.bill_dispute_resolved');
    expect(e.payload).toMatchObject({ userId: 'farmer1', outcomeCode: 'rejected', windowEndsAt: second.toISOString() });
    // [PC-56 TENANT-6d-7] The SECOND emitter of this event code carries the copy's variables too — two emitters of one
    // code is how a payload contract drifts while every test stays green.
    expect(e.payload.outcome).toMatchObject({ gu: 'તમારો વાંધો સ્વીકાર્યો નથી' });
    expect(e.payload.periodRange).toBe('2026-07-01..2026-07-15');
  });

  it('MilkBillDispute.open requires the member\'s own words at the programme\'s note floor', () => {
    const base = { id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', windowEndedAt: WINDOW_END, at: INSIDE };
    expect(() => MilkBillDispute.open({ ...base, reason: 'wrong' })).toThrow(DisputeReasonTooShortError);
    expect(() => MilkBillDispute.open({ ...base, reason: '   short   ' })).toThrow(DisputeReasonTooShortError);
    expect(REASON_FLOOR).toBe(10);
    const d = MilkBillDispute.open({ ...base, reason: '  my litres are short  ' });
    expect(d.toProps().reason).toBe('my litres are short');       // trimmed, and stored as testimony
    expect(d.status).toBe('open');
  });

  it('copies the window it was raised inside, rather than pointing at the bill\'s', () => {
    // A bill's window is rewritten every time it is re-previewed. "Was this raised in time?" must stay answerable after
    // that has happened three times.
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    expect(d.toProps().windowEndedAt).toEqual(WINDOW_END);
  });

  it('opening publishes the fact but does NOT notify the member who just acted', () => {
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    const [e] = d.pullEvents();
    expect(e.type).toBe('dairy.bill_disputed');
    expect(e.payload.userId).toBeUndefined();       // no recipient ⇒ the fanout handler finds nobody, by design
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the answer', () => {
  const open = () => MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });

  it('requires a note the member can read', () => {
    expect(() => open().resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'no', voidedBill: false, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } }))
      .toThrow(DisputeReasonTooShortError);
  });

  it('records the outcome, the decider and the note, and tells the RAISER', () => {
    const d = open();
    d.pullEvents();
    d.resolve({ outcome: 'upheld', byUserId: 'op1', at: AFTER, note: 'Weight re-keyed from the slip and the bill rebuilt.', voidedBill: true, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } });
    const p = d.toProps();
    expect(p).toMatchObject({ status: 'upheld', resolvedBy: 'op1', voidedBill: true });
    expect(p.resolvedAt).toEqual(AFTER);
    const [e] = d.pullEvents();
    expect(e.type).toBe('dairy.bill_dispute_resolved');
    expect(e.payload).toMatchObject({ userId: 'farmer1', outcomeCode: 'upheld', voidedBill: true });
    // [PC-56 TENANT-6d-7] `{{period}}` was never in this payload and `{{outcome}}` was the enum, so the member who
    // objected read "તમારા બિલ ()નો વાંધો ઉકેલાયો: upheld". The word is a LangMap now; the enum kept its own name.
    expect(e.payload.period).toBe('01/07–15/07');
    expect(e.payload.outcome).toMatchObject({ en: 'your objection was accepted' });
  });

  it('cannot be answered twice — two operators must not both believe their note was recorded', () => {
    const d = open();
    d.resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'Checked against the slips; the litres match.', voidedBill: false, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } });
    expect(() => d.resolve({ outcome: 'upheld', byUserId: 'op2', at: AFTER, note: 'Actually they were right after all.', voidedBill: true, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } }))
      .toThrow(DisputeAlreadyResolvedError);
  });

  it('refuses to void the bill on a REJECTED query — that is two decisions recorded as one', () => {
    expect(() => open().resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'The litres match the slips.', voidedBill: true, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } }))
      .toThrow(expect.objectContaining({ code: 'DISPUTE_VOID_REQUIRES_UPHELD' }));
  });

  it('assertNoOpen is what stops a second open query on one bill', () => {
    expect(() => MilkBillDispute.assertNoOpen(open(), 'b1')).toThrow(DisputeAlreadyOpenError);
    const resolved = open();
    resolved.resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'The litres match the slips.', voidedBill: false, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } });
    // A member who objects again after a rejection raises a NEW query, which the history keeps.
    expect(() => MilkBillDispute.assertNoOpen(resolved, 'b1')).not.toThrow();
    expect(() => MilkBillDispute.assertNoOpen(null, 'b1')).not.toThrow();
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the VOID — the only correction this platform can make to a bill', () => {
  it('is reachable from every state where no money has moved, and from nowhere once it has', () => {
    expect([...BILL_STATUSES]).toEqual(['draft', 'previewed', 'disputed', 'approved', 'paid', 'voided']);
    for (const from of ['draft', 'previewed', 'disputed', 'approved'] as const) {
      expect(canTransition(from, 'voided')).toBe(true);
    }
    expect(canTransition('paid', 'voided')).toBe(false);
    expect(canTransition('voided', 'draft')).toBe(false);
    expect(isTerminal('voided')).toBe(true);
  });

  it('records who, when and WHY — a voided bill is a member\'s fortnight leaving the record', () => {
    const b = previewedBill();
    b.void(AFTER, 'op1', 'Weight mis-keyed at the counter; rebuilding from the slips.');
    const p = b.toProps();
    expect(p.status).toBe('voided');
    expect(p.voidedBy).toBe('op1');
    expect(p.voidedAt).toEqual(AFTER);
    expect(p.voidReason).toBe('Weight mis-keyed at the counter; rebuilding from the slips.');
    expect(b.pullEvents()[0].type).toBe('dairy.bill_voided');
  });

  it('refuses a thin reason and refuses a PAID bill', () => {
    expect(() => previewedBill().void(AFTER, 'op1', 'wrong')).toThrow(BillVoidReasonRequiredError);
    const paid = approvedBill(); paid.markPaid(AFTER);
    expect(() => paid.void(AFTER, 'op1', 'the member says it was wrong')).toThrow(BillNotPayableError);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the SQL', () => {
  it('a dispute\'s testimony is never in an UPDATE — only the resolution is', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    d.resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'The litres match the slips.', voidedBill: false, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } });
    await new MilkBillDisputeRepository(fakeReplica().provider).resolve(tx as never, d);
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/SET status=\$3, resolved_at=\$4, resolved_by=\$5, resolution_note=\$6, voided_bill=\$7/);
    for (const forbidden of ['reason=', 'raised_by_user_id=', 'raised_at=', 'window_ended_at=', 'bill_id=']) {
      expect(sql).not.toContain(forbidden);
    }
    // CONDITIONAL on still being open: two operators deciding at once must not both succeed.
    expect(sql).toMatch(/AND status='open'/);
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/);
  });

  it('resolving fails closed when the row did not move', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    d.resolve({ outcome: 'rejected', byUserId: 'op1', at: AFTER, note: 'The litres match the slips.', voidedBill: false, notice: { period: '01/07–15/07', outcome: { en: 'your objection was accepted' }, note: 'n' } });
    await expect(new MilkBillDisputeRepository(fakeReplica().provider).resolve(tx as never, d)).rejects.toBeInstanceOf(DisputeNotFoundError);
  });

  it('openForBill locks, and is bound to the tenant and to `open`', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkBillDisputeRepository(fakeReplica().provider).openForBill(tx as never, 'tA', 'b1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND bill_id=\$2 AND status='open'/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['tA', 'b1']);
  });

  it('the "resolved before payday" count is measured in the COOPERATIVE\'s own day, not UTC', async () => {
    const { provider, exec } = fakeReplica();
    await new MilkBillDisputeRepository(provider).countsForCycle('tA', 'cyc1');
    const [sql] = exec.query.mock.calls[0];
    // W169's tile says "both resolved before payday". A payday is a DATE in the cooperative's calendar (0157), so the
    // comparison has to cross into that day's own end — in UTC it would call a Friday-evening resolution "late" in
    // Gujarat and "on time" in Nairobi.
    expect(sql).toMatch(/AT TIME ZONE co\.timezone/);
    expect(sql).toMatch(/JOIN countries co ON co\.code = t\.country_code/);
    expect(sql).toMatch(/d\.tenant_id=\$1/);
  });

  it('the bill UPDATE now carries the window, and fails closed', async () => {
    const okTx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new MilkBillRepository(fakeReplica().provider).update(okTx as never, previewedBill());
    const [sql, params] = okTx.query.mock.calls[0];
    // Before this wave the statement wrote `status` and `payout_id` only, which is why `dispute_window_ends` — a column
    // with a reader in apps/mobile since 0009 — could never have been set even if something had tried.
    expect(sql).toMatch(/dispute_window_ends=\$5, previewed_at=\$6/);
    expect(params[4]).toEqual(WINDOW_END);

    const lostTx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(new MilkBillRepository(fakeReplica().provider).update(lostTx as never, previewedBill()))
      .rejects.toBeInstanceOf(BillNotFoundError);
  });

  it('voiding soft-deletes with the SAME instant it stamps, in one statement', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const b = previewedBill();
    b.void(AFTER, 'op1', 'Weight mis-keyed at the counter.');
    await new MilkBillRepository(fakeReplica().provider).void(tx as never, b);
    const [sql, params] = tx.query.mock.calls[0];
    // deleted_at=$4 is the same parameter as voided_at: a voided row cannot exist without its reason, and a soft-delete
    // whose timestamp disagreed with its void stamp would be two accounts of one act.
    expect(sql).toMatch(/voided_at=\$4, voided_by=\$5, void_reason=\$6, deleted_at=\$4/);
    expect(params[3]).toEqual(AFTER);
  });

  it('the preview pass claims DRAFT bills only, bounded', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkBillRepository(fakeReplica().provider).draftsForCycle(tx as never, 'tA', 'cyc1', 500);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND cycle_id=\$2 AND status='draft'/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(params).toEqual(['tA', 'cyc1', 500]);
    // Re-callable BY CONSTRUCTION: a previewed bill is no longer `draft`, so a second pass finds fewer rather than
    // texting the same member twice.
  });

  it('releasing a voided bill\'s pours fails closed and carries no updated_at', async () => {
    const ok = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 3 }) };
    const n = await new MilkCollectionRepository(fakeReplica().provider).detachFromBill(ok as never, 'tA', 'b1');
    expect(n).toBe(3);
    const [sql] = ok.query.mock.calls[0];
    expect(sql).toMatch(/SET milk_bill_id = NULL/);
    expect(sql).toMatch(/tenant_id=\$1 AND milk_bill_id=\$2/);
    // DEV-49: milk_collections deliberately carries no updated_at; writing one throws 42703 at runtime.
    expect(sql).not.toMatch(/updated_at/);

    const lost = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(new MilkCollectionRepository(fakeReplica().provider).detachFromBill(lost as never, 'tA', 'b1'))
      .rejects.toBeInstanceOf(CollectionStampLostError);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('MilkBillService — the window comes from the DATABASE', () => {
  function harness(over: { bill?: MilkBill; hours?: number } = {}) {
    const b = over.bill ?? bill();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    const audit = { write: jest.fn() };
    const wallet = { post: jest.fn(async () => ({ txnId: 't' })) };
    const bills = { getForUpdate: jest.fn(async () => b), update: jest.fn(), void: jest.fn(), getById: jest.fn(async () => b) };
    const collections = { detachFromBill: jest.fn(async () => 4), attachToBill: jest.fn() };
    const memberships = { getById: jest.fn(async () => ({ id: 'mem1', farmerUserId: 'farmer1' })) };
    const cycles = { disputeWindowHours: jest.fn(async () => over.hours ?? 24) };
    const svc = new MilkBillService(uow as never, outbox as never, idem as never, metrics as never, wallet as never,
      audit as never, bills as never, collections as never, memberships as never, cycles as never,
      // [PC-56 TENANT-6c-4] the deduction's destination: lines, vocabulary, credits, consent, applier, flags.
      { linesForBill: jest.fn(async () => []), insert: jest.fn(), listForUpdate: jest.fn(async () => []), markApplied: jest.fn() } as never,
      { byCode: jest.fn(async () => null), byIds: jest.fn(async () => new Map()) } as never,
      { getForUpdate: jest.fn(async () => null) } as never,
      { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null), insert: jest.fn() } as never,
      { applyAll: jest.fn(async () => []) } as never,
      { isEnabled: jest.fn(async () => true) } as never,
      // [PC-56 TENANT-6c-5] the assembler: what the CYCLE deducts when nobody typed a line.
      { assemble: jest.fn(async () => ({ lines: [], totalMinor: 0n, capMinor: 0n, deferred: [] })) } as never, fakeNoticeVars());
    return { svc, bills, collections, cycles, outbox, audit, b };
  }

  it('reads the tenant\'s window LENGTH rather than a literal 24 (Law 6)', async () => {
    const { svc, cycles, b } = harness({ hours: 72 });
    await svc.preview('tA', { userId: 'op1', canManage: true }, 'b1', PREVIEW_AT);
    expect(cycles.disputeWindowHours).toHaveBeenCalledWith(expect.anything(), 'tA');
    // 72 hours, because this cooperative's members walk in once a week. A hardcoded 24 in the service would be exactly
    // the string Law 6 exists to stop.
    expect(b.disputeWindowEnds).toEqual(new Date(PREVIEW_AT.getTime() + 72 * 3_600_000));
  });

  it('puts the FARMER\'s user id on the event, read from the membership', async () => {
    const { svc, outbox } = harness();
    await svc.preview('tA', { userId: 'op1', canManage: true }, 'b1', PREVIEW_AT);
    expect(outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'dairy.bill_previewed',
      payload: expect.objectContaining({ userId: 'farmer1' }),
    }));
  });

  it('voiding releases the pours, records the count, and audits the act', async () => {
    const { svc, collections, bills, audit } = harness({ bill: previewedBill() });
    const out = await svc.voidBill('tA', { userId: 'op1', canManage: true }, 'b1', 'Weight mis-keyed at the counter.', null, AFTER);
    expect(collections.detachFromBill).toHaveBeenCalledWith(expect.anything(), 'tA', 'b1');
    expect(bills.void).toHaveBeenCalledTimes(1);
    expect((out as { poursReleased: number }).poursReleased).toBe(4);
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'dairy.bill.voided', newValue: expect.objectContaining({ poursReleased: 4 }),
    }));
  });

  it('refuses to pay inside the window, through the service, with no wallet call', async () => {
    const approved = approvedBill();
    // ONE harness, and that matters: this test used to build two and assert on the FIRST one's `bills.update` while
    // paying through the SECOND one's service — a mock that was never exercised cannot have been called, so the
    // assertion held no matter what `pay` did. Found by the lint pass that flagged the unused `svc`.
    const { svc, bills } = harness({ bill: approved });
    await expect(svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, INSIDE))
      .rejects.toBeInstanceOf(DisputeWindowOpenError);
    expect(bills.update).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('MilkBillDisputeService — who is allowed to object', () => {
  function harness(over: { bill?: MilkBill; existingOpen?: MilkBillDispute | null; farmerUserId?: string } = {}) {
    const b = over.bill ?? previewedBill();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    const audit = { write: jest.fn() };
    const disputes = { insert: jest.fn(), openForBill: jest.fn(async () => over.existingOpen ?? null), getForUpdate: jest.fn(), resolve: jest.fn(), listOpen: jest.fn(), listForBill: jest.fn() };
    const bills = { getForUpdate: jest.fn(async () => b), update: jest.fn(), getById: jest.fn(async () => b) };
    const memberships = { getById: jest.fn(async () => ({ id: 'mem1', farmerUserId: over.farmerUserId ?? 'farmer1' })) };
    const cycles = { disputeWindowHours: jest.fn(async () => 24) };
    // `voidLoaded`, not `voidBill`: the resolution already holds the bill under FOR UPDATE, so the void must run in
    // THAT transaction. Calling the self-opening form deadlocked on the row lock — found live.
    const billService = { voidLoaded: jest.fn(async () => ({ id: 'b1' })), voidBill: jest.fn(async () => ({ id: 'b1' })) };
    const svc = new MilkBillDisputeService(uow as never, outbox as never, idem as never, metrics as never, audit as never,
      disputes as never, bills as never, memberships as never, cycles as never, billService as never, fakeNoticeVars());
    return { svc, disputes, bills, billService, outbox, audit, b };
  }

  it('the MEMBER may object to their own bill', async () => {
    const { svc, disputes, b } = harness();
    const out = await svc.raise('tA', 'farmer1', 'b1', 'my litres are short by four', 'idem-1', null, INSIDE);
    expect(disputes.insert).toHaveBeenCalledTimes(1);
    expect(out.raisedByUserId).toBe('farmer1');
    expect(b.status).toBe('disputed');
  });

  it('ANYBODY ELSE gets a 404 — bill ids are not probeable', async () => {
    const { svc, disputes } = harness({ farmerUserId: 'someone-else' });
    await expect(svc.raise('tA', 'farmer1', 'b1', 'my litres are short by four', 'idem-1', null, INSIDE))
      .rejects.toBeInstanceOf(BillNotFoundError);
    expect(disputes.insert).not.toHaveBeenCalled();
    // 404 rather than 403 on purpose: the same no-IDOR ruling `getById` already makes for reads.
  });

  it('refuses a SECOND open query on one bill', async () => {
    const existing = MilkBillDispute.open({ id: 'd0', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    const { svc, disputes } = harness({ existingOpen: existing });
    await expect(svc.raise('tA', 'farmer1', 'b1', 'and the deduction is wrong too', 'idem-2', null, INSIDE))
      .rejects.toBeInstanceOf(DisputeAlreadyOpenError);
    expect(disputes.insert).not.toHaveBeenCalled();
  });

  it('a REJECTED answer re-previews the bill with a fresh window and notifies the member', async () => {
    const disputed = previewedBill();
    disputed.dispute(INSIDE, 'my litres are short by four'); disputed.pullEvents();
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    const h = harness({ bill: disputed });
    (h.disputes.getForUpdate as jest.Mock).mockResolvedValue(d);

    await h.svc.resolve('tA', { userId: 'op1', canManage: true }, 'd1',
      { outcome: 'rejected', note: 'Checked against the slips; the litres match.', voidBill: false }, null, AFTER);

    expect(disputed.status).toBe('previewed');
    expect(disputed.disputeWindowEnds).toEqual(new Date(AFTER.getTime() + 24 * 3_600_000));
    expect(h.billService.voidLoaded).not.toHaveBeenCalled();
    expect(h.outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'dairy.bill_dispute_resolved' }));
  });

  it('an UPHELD answer with a void rebuilds through the bill service', async () => {
    const disputed = previewedBill();
    disputed.dispute(INSIDE, 'my litres are short by four'); disputed.pullEvents();
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    const h = harness({ bill: disputed });
    (h.disputes.getForUpdate as jest.Mock).mockResolvedValue(d);

    await h.svc.resolve('tA', { userId: 'op1', canManage: true }, 'd1',
      { outcome: 'upheld', note: 'Weight re-keyed from the slip; rebuilding.', voidBill: true }, null, AFTER);

    expect(h.billService.voidLoaded).toHaveBeenCalledWith(expect.anything(), 'tA', expect.anything(), disputed, 'Weight re-keyed from the slip; rebuilding.', null, AFTER);
    // And NOT the self-opening form, which would ask a second connection for a lock this transaction already holds.
    expect(h.billService.voidBill).not.toHaveBeenCalled();
  });

  it('an UPHELD answer WITHOUT a void leaves the bill disputed — and therefore unpayable', async () => {
    // The member was right and the correction is not expressible on this bill. A bill that cannot be computed
    // correctly must not become payable, so it stays where an operator can see it.
    const disputed = previewedBill();
    disputed.dispute(INSIDE, 'my litres are short by four'); disputed.pullEvents();
    const d = MilkBillDispute.open({ id: 'd1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer1', reason: 'my litres are short', windowEndedAt: WINDOW_END, at: INSIDE });
    const h = harness({ bill: disputed });
    (h.disputes.getForUpdate as jest.Mock).mockResolvedValue(d);

    await h.svc.resolve('tA', { userId: 'op1', canManage: true }, 'd1',
      { outcome: 'upheld', note: 'You are right; the fix is on the loan side.', voidBill: false }, null, AFTER);

    expect(disputed.status).toBe('disputed');
    expect(h.billService.voidLoaded).not.toHaveBeenCalled();
    expect(() => disputed.markPaid(AFTER)).toThrow(BillNotPayableError);
  });

  it('resolving needs dairy.manage; raising needs none', async () => {
    const { svc } = harness();
    await expect(svc.resolve('tA', { userId: 'op1', canManage: false }, 'd1', { outcome: 'rejected', note: 'nope, all fine', voidBill: false }, null, AFTER))
      .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    // …while `raise` above succeeded for a caller with no permission at all, because requiring `dairy.manage` would
    // mean the only people who could object to a bill are the people who wrote it.
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('previewCycle — one act, 312 bills, resumable', () => {
  const closedCycle = () => DairyBillCycle.rehydrate({
    id: 'cyc1', tenantId: 'tA', paymentCycle: 'fortnightly', periodStart: '2026-07-01', periodEnd: '2026-07-15',
    closesAt: new Date('2026-07-15T18:30:00.000Z'), payday: '2026-07-17', status: 'closed',
    closedAt: new Date('2026-07-15T18:30:00.000Z'),
    billsGeneratedAt: new Date(), billsGenerated: 3, billsSkipped: 0, billsFailed: 0,
    previewedAt: null, previewedBy: null, billsPreviewed: null,
    approvedAt: null, approvedBy: null, billsApproved: null,
  });

  function harness(over: { cycle?: DairyBillCycle; drafts?: string[]; preview?: jest.Mock; counts?: Record<string, number> } = {}) {
    const c = over.cycle ?? closedCycle();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    const cycles = { getForUpdate: jest.fn(async () => c), updateState: jest.fn(), today: jest.fn(), activePaymentCycles: jest.fn(), ensure: jest.fn(), dueToClose: jest.fn(), needingBills: jest.fn(), listFor: jest.fn() };
    const collections = { membershipsToBillForCycle: jest.fn(async () => []) };
    const bills = { preview: over.preview ?? jest.fn(async () => ({ id: 'b' })), generate: jest.fn() };
    const billRepo = {
      draftsForCycle: jest.fn(async () => (over.drafts ?? ['b1', 'b2']).map((id) => ({ id }))),
      statusCountsForCycle: jest.fn(async () => over.counts ?? { previewed: 2 }),
      billAttemptsByMembership: jest.fn(async () => new Map()),
    };
    const memberships = { getById: jest.fn() };
    const svc = new DairyBillCycleService(uow as never, outbox as never, metrics as never, idem as never,
      cycles as never, collections as never, bills as never, billRepo as never, memberships as never,
      // [PC-56 TENANT-6c-5] W169's deduction tile, and the flag that gates assembly.
      { cycleTotals: jest.fn(async () => ({ totalMinor: 0n, byType: {} })) } as never,
      { isEnabled: jest.fn(async () => false) } as never);
    return { svc, cycles, bills, billRepo, outbox, idem, c };
  }

  it('moves the CYCLE first, then each bill in its own transaction', async () => {
    const { svc, cycles, bills, c } = harness();
    const out = await svc.previewCycle('tA', { userId: 'op1', canManage: true, canCloseSettlement: true }, 'cyc1');
    expect(c.status).toBe('previewed');
    expect(c.previewedBy).toBe('op1');
    expect(cycles.updateState).toHaveBeenCalled();
    expect(bills.preview).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ previewed: 2, failed: 0, remaining: 0 });
    // The cycle's status is the operator's answer to "did I press the button?" — a cycle left `closed` after 200 members
    // had already been texted would invite a second press.
  });

  it('publishes the cycle-level fact once, and leaves the member-facing events to the bills', async () => {
    const { svc, outbox } = harness();
    await svc.previewCycle('tA', { userId: 'op1', canManage: true, canCloseSettlement: true }, 'cyc1');
    const types = outbox.write.mock.calls.map((c: any[]) => c[1].eventType);
    expect(types).toEqual(['dairy.cycle_previewed']);
  });

  it('a RE-PRESS is not an error — it finishes a partial pass', async () => {
    const already = closedCycle();
    already.preview(PREVIEW_AT, 'op1'); already.pullEvents();
    const { svc, bills, outbox } = harness({ cycle: already, drafts: ['b3'] });
    const out = await svc.previewCycle('tA', { userId: 'op2', canManage: true, canCloseSettlement: true }, 'cyc1');
    expect(out.previewed).toBe(1);
    expect(bills.preview).toHaveBeenCalledTimes(1);
    // No second cycle-level event: the decision was made once, by op1.
    expect(outbox.write).not.toHaveBeenCalled();
  });

  it('one member failing does not stop the rest', async () => {
    const preview = jest.fn(async (_t: string, _a: unknown, id: string) => {
      if (id === 'b2') throw new Error('boom');
      return { id };
    });
    const { svc } = harness({ drafts: ['b1', 'b2', 'b3'], preview, counts: { draft: 1, previewed: 2 } });
    const out = await svc.previewCycle('tA', { userId: 'op1', canManage: true, canCloseSettlement: true }, 'cyc1');
    expect(out).toMatchObject({ previewed: 2, failed: 1 });
  });

  it('REMAINING is MEASURED from the bills, not inferred from the loop', async () => {
    // [MUTATION GAP] The first fixture happened to make `drafts.length - previewed` equal the measured count, so
    // guessing survived. The numbers are now deliberately incompatible: three drafts claimed, all three previewed, and
    // the database says one is still `draft` — which is what a bill generated between the claim and the count looks
    // like. The loop would answer 0 and send the operator away believing the cycle was done.
    const { svc } = harness({ drafts: ['b1', 'b2', 'b3'], counts: { draft: 1, previewed: 3 } });
    const out = await svc.previewCycle('tA', { userId: 'op1', canManage: true, canCloseSettlement: true }, 'cyc1');
    expect(out).toMatchObject({ previewed: 3, failed: 0, remaining: 1 });
  });

  it('refuses without EITHER key, and is idempotency-wrapped at the route', async () => {
    const { svc, idem } = harness();
    await expect(svc.previewCycle('tA', { userId: 'x', canManage: false, canCloseSettlement: true }, 'cyc1')).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    // [PC-56 TENANT-6c-3] W169 names `settlement.close` on PREVIEW as well as approve, and 6c-2 shipped this act behind
    // `dairy.manage` alone. An actor with no flag set is refused, because absent means false on a key that fixes the
    // figures 312 families are about to be paid.
    await expect(svc.previewCycle('tA', { userId: 'x', canManage: true }, 'cyc1')).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    await svc.previewCycleIdempotent('tA', { userId: 'op1', canManage: true, canCloseSettlement: true }, 'cyc1', 'idem-k');
    expect(idem.remember).toHaveBeenCalledWith('idem-k', 'op1', 'dairy.cycle.preview', expect.any(Function));
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the notification spine', () => {
  it('has a map row for both member-facing bill events, pointing at a userId', () => {
    for (const t of ['dairy.bill_previewed', 'dairy.bill_dispute_resolved']) {
      const row = NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === t);
      expect(row).toBeDefined();
      expect(row!.recipientKeys).toContain('userId');
      expect(row!.eventCode).toBe(t);
    }
  });

  it('SEEDS A SERVING VERSION FOR EVERY PLATFORM TEMPLATE — without which every row above sends nothing', () => {
    // 0122's send-time gate INNER JOINs `notification_template_versions` on `serving_version_id`. The base seed file
    // never fed it, so 42 of 123 platform templates resolved to NULL and every send was recorded as `no_template`,
    // silently — including all ten of TENANT-6b-1's dairy quality rows, in the wave that built the plumbing for W168's
    // "member notified in Gujarati". Asserted at the SOURCE because the alternative is discovering it in production for
    // the second time.
    const seed = fs.readFileSync(path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql'), 'utf8');
    // Anchored on the exact relation name: a first version of this assertion matched a SUBSTRING, so a mutant that
    // renamed the table to `notification_template_versions_REMOVED` survived — the guard passed while every send went
    // back to being silently dead.
    expect(seed).toMatch(/INSERT INTO notification_template_versions \(\n/);
    expect(seed).toMatch(/UPDATE notification_templates t\n   SET serving_version_id = v\.id/);
    // The lifecycle and second-person rules are 0122's, not re-invented: an inactive DLT placeholder must stay unserved,
    // and copy a farmer cannot mute takes two humans to reword.
    expect(seed).toMatch(/CASE WHEN t\.is_active THEN 'approved' ELSE 'draft' END/);
    expect(seed).toMatch(/\(e\.user_can_opt_out = false OR e\.priority = 'critical'\)/);
    // And 0101's ruling, applied to this programme's own dairy rows.
    expect(seed).toMatch(/UPDATE notification_templates SET is_active = false\n WHERE channel = 'sms'/);
    // Scoped to platform copy only: back-dating an approval onto a TENANT's own wording would forge a signature.
    expect(seed).toMatch(/t\.tenant_id IS NULL AND t\.serving_version_id IS NULL/);
    expect(seed).toMatch(/'dairy\.bill_previewed'/);
    // Three languages, because "in Gujarati" is the promise.
    for (const lang of ["'sms','gu'", "'sms','hi'", "'sms','en'"]) {
      expect(seed).toContain(`('dairy.bill_previewed',${lang}`);
    }
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('what is deliberately NOT here', () => {
  it('the cycle still cannot be PAID — that needs a payout batch nothing writes', () => {
    // 6c-2's version of this test said `approved` was absent; TENANT-6c-3 built it. What remains absent is `paid`:
    // `milk_bills.payout_id` has never been written, so W169's "one bank trip" has nothing behind it, and a bill
    // carrying a deduction cannot be paid at all (0157). A cycle-level `paid` would be a state nothing could reach.
    expect([...CYCLE_STATUSES]).not.toContain('paid');
  });

  it('a bill still has no way to be AMENDED — void and rebuild is the whole vocabulary', () => {
    const b = previewedBill();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(b))).not.toContain('adjust');
    expect(canTransition('disputed', 'voided')).toBe(true);
  });
});
