// modules/dairy/__tests__/hotfix11-second-person.spec.ts · PC-56 HOTFIX-11 — A SECOND PERSON ON EVERY MILK BILL (unit).
//
// Founder H11-1 … H11-5 (2026-11-06): the approver ≠ the previewer and the payer ≠ the approver, on EVERY bill; two
// people suffice (A previews, B approves, A pays); a missing or 'system' signer is refused; no one-person exception; a
// disputed bill is not approvable; whoever rejects an objection becomes the previewer. The live proof (real Postgres,
// 0233's CHECKs, the cycle pass) is `src/__tests__/hotfix11-second-person.integration.spec.ts`.
import { fakeNoticeVars } from '../../../../test/helpers/notice-vars';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBill, isBillSigner } from '../domain/milk-bill.entity';
import { canTransition } from '../domain/milk-bill.state';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { BILL_SIGNATURE_SENTENCES, BillNotPayableError } from '../domain/dairy.errors';

const NOTICE = { period: '01/07–15/07', litres: '204.526', net: 'INR 8,412.00', deductions: 'INR 0.00', window_ends: '16/07 09:00' };
const NOW = new Date('2026-07-16T04:00:00.000Z');
const WINDOW = new Date('2026-07-17T04:00:00.000Z');
const AFTER = new Date('2026-07-17T04:00:01.000Z');
const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190a000-0000-7000-8000-00000000000b';
const C = '0190a000-0000-7000-8000-00000000000c';

const draft = () => {
  const b = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 70000n, grossMinor: 40000n });
  b.pullEvents(); return b;
};
const previewedBy = (who: string) => { const b = draft(); b.preview(NOW, WINDOW, 'farmer1', NOTICE, who); b.pullEvents(); return b; };
const approvedBy = (previewer: string, approver: string) => { const b = previewedBy(previewer); b.approve(NOW, approver); b.pullEvents(); return b; };
const code = (fn: () => void): string | undefined => { try { fn(); } catch (e) { return (e as { code?: string }).code; } return undefined; };

describe('HOTFIX-11 · the aggregate — approve', () => {
  it('refuses the previewer by name (409), stamps nothing, and keeps the bill previewed', () => {
    const b = previewedBy(A);
    let err: any;
    try { b.approve(NOW, A); } catch (e) { err = e; }
    expect([err?.code, err?.httpStatus, err?.message]).toEqual(['DAIRY_BILL_APPROVER_IS_PREVIEWER', 409, BILL_SIGNATURE_SENTENCES.DAIRY_BILL_APPROVER_IS_PREVIEWER]);
    expect(err.details).toMatchObject({ id: 'b1', previewedBy: A });
    expect(b.status).toBe('previewed');
    expect(b.toProps()).toMatchObject({ approvedAt: null, approvedBy: null });
    expect(b.pullEvents()).toEqual([]);
  });
  it('the founder\'s sentence, exactly', () => {
    expect(BILL_SIGNATURE_SENTENCES.DAIRY_BILL_APPROVER_IS_PREVIEWER).toBe('The person who showed this bill to the member cannot also approve it. A second person on your dairy desk approves it — your administrator can give a colleague the dairy key.');
    expect(BILL_SIGNATURE_SENTENCES.DAIRY_BILL_PAYER_IS_APPROVER).toBe('The person who approved this bill cannot also pay it. Another person on your dairy desk pays it.');
  });
  it('a second person approves and is stamped with the instant', () => {
    const b = previewedBy(A);
    b.approve(NOW, B);
    expect(b.status).toBe('approved');
    expect(b.toProps()).toMatchObject({ previewedBy: A, approvedBy: B, approvedAt: NOW });
  });
  it('refuses when the previewer is UNKNOWN (NULL) — an unknown signer is not a second person (E-2)', () => {
    const b = MilkBill.rehydrate({ ...draft().toProps(), status: 'previewed', previewedAt: NOW, disputeWindowEnds: WINDOW, previewedBy: null });
    expect(code(() => b.approve(NOW, B))).toBe('DAIRY_BILL_PREVIEWER_UNKNOWN');
    expect(b.status).toBe('previewed');
  });
  it('a \'system\' previewer is stored as NULL, so its bill cannot be approved', () => {
    const b = previewedBy('system');
    expect(b.previewedBy).toBeNull();
    expect(code(() => b.approve(NOW, B))).toBe('DAIRY_BILL_PREVIEWER_UNKNOWN');
  });
  it('refuses a \'system\', empty or missing approver', () => {
    for (const who of ['system', 'SYSTEM', '', '  ', undefined as unknown as string]) {
      expect(code(() => previewedBy(A).approve(NOW, who))).toBe('DAIRY_BILL_SIGNER_UNKNOWN');
    }
    expect([isBillSigner(A), isBillSigner('system'), isBillSigner(null), isBillSigner('')]).toEqual([true, false, false, false]);
  });
  it('Q4-A: a DISPUTED bill is refused by name, and the state machine no longer has disputed → approved', () => {
    const b = previewedBy(A);
    b.dispute(NOW, 'my litres are short by about four'); b.pullEvents();
    let err: any;
    try { b.approve(NOW, B); } catch (e) { err = e; }
    expect([err?.code, err?.httpStatus]).toEqual(['DAIRY_BILL_DISPUTE_UNANSWERED', 409]);
    expect(err.message).toBe('This bill has an open objection from the member. Answer it first — reject it and show her the bill again, or void and rebuild it.');
    expect(b.status).toBe('disputed');
    expect(canTransition('disputed', 'approved')).toBe(false);
    expect(canTransition('disputed', 'previewed')).toBe(true);
    expect(canTransition('disputed', 'voided')).toBe(true);
  });
  it('a draft still answers BILL_ILLEGAL_TRANSITION (the older refusal is not shadowed)', () => {
    expect(code(() => draft().approve(NOW, B))).toBe('BILL_ILLEGAL_TRANSITION');
  });
});

describe('HOTFIX-11 · the aggregate — re-preview after a rejected objection (Q5-A)', () => {
  it('whoever answered becomes the previewer, so THEY cannot approve and the original previewer can', () => {
    const b = previewedBy(A);
    b.dispute(NOW, 'my litres are short by about four'); b.pullEvents();
    b.resolveToPreviewed(AFTER, new Date(AFTER.getTime() + 86_400_000), 'farmer1', 'rejected', { period: '01/07–15/07', outcome: { en: 'not accepted' }, note: 'n' }, C);
    expect(b.previewedBy).toBe(C);
    expect(code(() => b.approve(AFTER, C))).toBe('DAIRY_BILL_APPROVER_IS_PREVIEWER');
    b.approve(AFTER, A);
    expect(b.toProps()).toMatchObject({ previewedBy: C, approvedBy: A });
  });
});

describe('HOTFIX-11 · the aggregate — pay', () => {
  it('refuses the approver by name, before anything moves; the previewer may pay (two people suffice — Q2-A)', () => {
    const b = approvedBy(A, B);
    let err: any;
    try { b.assertPayer(B); } catch (e) { err = e; }
    expect([err?.code, err?.httpStatus, err?.details?.approvedBy]).toEqual(['DAIRY_BILL_PAYER_IS_APPROVER', 409, B]);
    expect(code(() => b.markPaid(AFTER, B))).toBe('DAIRY_BILL_PAYER_IS_APPROVER');
    expect(b.status).toBe('approved');
    b.markPaid(AFTER, A);
    expect(b.toProps()).toMatchObject({ status: 'paid', paidBy: A, paidAt: AFTER, approvedBy: B, previewedBy: A });
  });
  it('a third person may pay too', () => {
    const b = approvedBy(A, B); b.markPaid(AFTER, C); expect(b.paidBy).toBe(C);
  });
  it('refuses when the approver is UNKNOWN, and a \'system\' payer', () => {
    const legacy = MilkBill.rehydrate({ ...draft().toProps(), status: 'approved', previewedAt: NOW, disputeWindowEnds: WINDOW, previewedBy: A, approvedBy: null, approvedAt: null });
    expect(code(() => legacy.assertPayer(C))).toBe('DAIRY_BILL_APPROVER_UNKNOWN');
    expect(code(() => legacy.markPaid(AFTER, C))).toBe('DAIRY_BILL_APPROVER_UNKNOWN');
    expect(code(() => approvedBy(A, B).assertPayer('system'))).toBe('DAIRY_BILL_SIGNER_UNKNOWN');
  });
  it('a non-approved bill keeps BILL_NOT_PAYABLE', () => {
    expect(() => previewedBy(A).assertPayer(B)).toThrow(BillNotPayableError);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 't1', farmerUserId: 'farmer1', mccId: 'm1', memberCode: 'C1', paymentCycle: 'weekly', defaultAnimalType: 'cow', isActive: true });
function harness(bill: MilkBill, deductionLines: unknown[] = []) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const audit = { write: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 't', alreadyApplied: false })), balanceMinor: jest.fn() };
  const bills = { getForUpdate: jest.fn(async () => bill), update: jest.fn(), getById: jest.fn(), listFor: jest.fn(), insert: jest.fn() };
  const flags = { isEnabled: jest.fn(async () => true) };
  const consents = { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null), insert: jest.fn() };
  const deductions = { applyAll: jest.fn(async () => []) };
  const svc = new MilkBillService(uow as any, outbox as any, idem as any, { inc: jest.fn(), observe: jest.fn() } as any, wallet as any, audit as any, bills as any,
    { aggregateUnbilledForUpdate: jest.fn(), attachToBill: jest.fn() } as any, { getById: jest.fn(async () => membership), listFor: jest.fn() } as any,
    { disputeWindowHours: jest.fn(async () => 24) } as any,
    { linesForBill: jest.fn(async () => deductionLines), insert: jest.fn() } as never, { byCode: jest.fn() } as never, { getForUpdate: jest.fn() } as never,
    consents as never, deductions as never, flags as never, { assemble: jest.fn() } as never, fakeNoticeVars());
  return { svc, wallet, bills, outbox, audit, idem, flags, consents, deductions };
}
const desk = (userId: string) => ({ userId, canManage: true, canCloseSettlement: true });

describe('HOTFIX-11 · MilkBillService', () => {
  it('pay: payer = approver → 409, and the wallet, the flag, the consent, the deductions, the update, the audit and the outbox are NEVER reached', async () => {
    const line = { id: 'd1', type: 'loan_emi', amountMinor: 8000n, sourceType: 'loan', sourceId: 'l1', status: 'pending' as const };
    const b = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 70000n, grossMinor: 40000n, deductions: [line] });
    b.preview(NOW, WINDOW, 'farmer1', NOTICE, A); b.approve(NOW, B); b.pullEvents();
    const h = harness(b, [line]);
    await expect(h.svc.pay('t1', desk(B), 'b1', 'idem-1', null, AFTER)).rejects.toMatchObject({ code: 'DAIRY_BILL_PAYER_IS_APPROVER', httpStatus: 409 });
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.flags.isEnabled).not.toHaveBeenCalled();
    expect(h.consents.latestForBill).not.toHaveBeenCalled();
    expect(h.deductions.applyAll).not.toHaveBeenCalled();
    expect(h.bills.update).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
    expect(h.idem.remember).toHaveBeenCalledWith('idem-1', B, 'dairy.bill.pay', expect.any(Function));   // the refusal is what the key records
  });
  it('pay: the previewer pays → one wallet post, the bill stamped with the payer', async () => {
    const h = harness(approvedBy(A, B));
    const out = await h.svc.pay('t1', desk(A), 'b1', 'idem-2', null, AFTER);
    expect(out.status).toBe('paid');
    expect(h.wallet.post).toHaveBeenCalledTimes(1);
    const persisted: MilkBill = (h.bills.update.mock.calls as any[])[0][1];
    expect(persisted.toProps()).toMatchObject({ paidBy: A, paidAt: AFTER, approvedBy: B });
  });
  it('approve: the previewer → 409 and NOTHING is written (no update, no audit, no outbox)', async () => {
    const h = harness(previewedBy(A));
    await expect(h.svc.approve('t1', desk(A), 'b1')).rejects.toMatchObject({ code: 'DAIRY_BILL_APPROVER_IS_PREVIEWER' });
    expect(h.bills.update).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
  });
  it('approve: a second person → the stamp, ONE `dairy.bill.approved` audit row with both names, and the event', async () => {
    const h = harness(previewedBy(A));
    const out = await h.svc.approve('t1', desk(B), 'b1', '10.0.0.9', NOW);
    expect(out.status).toBe('approved');
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect((h.audit.write.mock.calls as any[])[0][1]).toMatchObject({ action: 'dairy.bill.approved', actorUserId: B, entityId: 'b1', ip: '10.0.0.9',
      newValue: { status: 'approved', previewedBy: A, approvedBy: B } });
    expect((h.outbox.write.mock.calls as any[]).map((c) => c[1].eventType)).toEqual(['dairy.bill_approved']);
    expect(((h.bills.update.mock.calls as any[])[0][1] as MilkBill).toProps()).toMatchObject({ approvedBy: B, approvedAt: NOW });
  });
  it('approve still requires settlement.close and dairy.manage first', async () => {
    const h = harness(previewedBy(A));
    await expect(h.svc.approve('t1', { userId: B, canManage: true }, 'b1')).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    await expect(h.svc.approve('t1', { userId: B, canManage: false, canCloseSettlement: true }, 'b1')).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
  });
  it('preview: stamps the previewer and writes ONE `dairy.bill.previewed` audit row', async () => {
    const h = harness(draft());
    await h.svc.preview('t1', desk(A), 'b1', NOW, '10.0.0.8');
    const persisted: MilkBill = (h.bills.update.mock.calls as any[])[0][1];
    expect(persisted.previewedBy).toBe(A);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect((h.audit.write.mock.calls as any[])[0][1]).toMatchObject({ action: 'dairy.bill.previewed', actorUserId: A, entityType: 'milk_bill', entityId: 'b1', ip: '10.0.0.8',
      newValue: { status: 'previewed', previewedBy: A, windowEndsAt: WINDOW.toISOString() } });
  });
});

describe('HOTFIX-11 · the repository writes the five columns', () => {
  it('update() names previewed_by, approved_at, approved_by, paid_at, paid_by and binds them from the aggregate', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
    const repo = new MilkBillRepository({ forTenant: jest.fn() } as never);
    const b = approvedBy(A, B); b.markPaid(AFTER, C);
    await repo.update(tx as never, b);
    const [sql, params] = (tx.query.mock.calls as any[])[0];
    for (const col of ['previewed_by=$7', 'approved_at=$8', 'approved_by=$9', 'paid_at=$10', 'paid_by=$11']) expect(sql).toContain(col);
    expect(params.slice(6)).toEqual([A, NOW, B, AFTER, C]);
  });
});
