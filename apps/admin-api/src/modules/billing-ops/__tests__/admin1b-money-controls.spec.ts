// apps/admin-api/src/modules/billing-ops/__tests__/admin1b-money-controls.spec.ts · PC-56 ADMIN-1b.
// Three controls, one question behind every test: could an operator make the platform believe something about money
// that is not true? Payment arithmetic, the invoice reconciliation machine, and the collections ladder.
import {
  PAYMENT_METHODS, MAX_PAYMENT_MINOR, assertReceiptAmount, assertReference, assertSameCurrency, assertPayable,
  assertReceivedAt, statusAfterPayments, overpaidMinor, outstandingMinor, RECEIVED_AT_FUTURE_TOLERANCE_MS,
} from '../domain/invoice-payment';
import { canTransition, canReconcileTo, assertReconciliation, isTerminal } from '../domain/invoice.state';
import { SaasInvoice } from '../domain/invoice.entity';
import {
  assertLadder, stepForDaysLate, nextStepAfter, suspensionDue, diffLadders, MAX_LADDER_STEPS, type LadderStep,
} from '../domain/dunning-policy';
import { InvalidPaymentError, InvalidDunningPolicyError } from '../domain/billing-ops.errors';

// ---------------------------------------------------------------- payments (ADMIN-1-Q1)

describe('invoice payments — the received amount is arithmetic, never an assertion', () => {
  it('keeps the method vocabulary aligned with the 0092 CHECK', () => {
    expect([...PAYMENT_METHODS]).toEqual(['bank_transfer', 'upi', 'cheque', 'card', 'netbanking', 'wallet', 'cash', 'offset']);
  });

  it('refuses a zero, negative or absurd receipt', () => {
    expect(assertReceiptAmount(1n)).toBe(1n);
    expect(() => assertReceiptAmount(0n)).toThrow(InvalidPaymentError);
    // a negative "payment" is a reversal and has its own path — confusing them erases money
    expect(() => assertReceiptAmount(-100n)).toThrow(InvalidPaymentError);
    expect(assertReceiptAmount(MAX_PAYMENT_MINOR)).toBe(MAX_PAYMENT_MINOR);
    expect(() => assertReceiptAmount(MAX_PAYMENT_MINOR + 1n)).toThrow(InvalidPaymentError);
  });

  it('demands a traceable reference — a payment nobody can match is an assertion', () => {
    expect(assertReference('  UTR12345 ')).toBe('UTR12345');
    expect(() => assertReference('ab')).toThrow(InvalidPaymentError);
    expect(() => assertReference('   ')).toThrow(InvalidPaymentError);
    expect(() => assertReference('x'.repeat(121))).toThrow(InvalidPaymentError);
  });

  it('REFUSES a foreign-currency payment rather than inventing a rate', () => {
    expect(() => assertSameCurrency('INR', 'INR')).not.toThrow();
    expect(() => assertSameCurrency('INR', 'USD')).toThrow(InvalidPaymentError);
  });

  it('only accepts money against an invoice that is actually owed', () => {
    for (const s of ['issued', 'partially_paid', 'overdue'] as const) expect(() => assertPayable(s)).not.toThrow();
    // draft = never sent; void = written off (recording here would silently un-void a reasoned decision);
    // paid = settled (a second receipt is a refund conversation, not a payment row)
    for (const s of ['draft', 'void', 'paid'] as const) expect(() => assertPayable(s)).toThrow(InvalidPaymentError);
  });

  it('refuses a future received-at but tolerates clock skew', () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    expect(() => assertReceivedAt(new Date('2026-08-06T11:00:00.000Z'), now)).not.toThrow();
    expect(() => assertReceivedAt(new Date(now.getTime() + RECEIVED_AT_FUTURE_TOLERANCE_MS - 1000), now)).not.toThrow();
    expect(() => assertReceivedAt(new Date('2026-08-07T12:00:00.000Z'), now)).toThrow(InvalidPaymentError);
    expect(() => assertReceivedAt(new Date('nonsense'), now)).toThrow(InvalidPaymentError);
  });

  it('derives the status from the money, and returns null when nothing should move', () => {
    const total = 100_000n;
    expect(statusAfterPayments('issued', total, 40_000n, false)).toBe('partially_paid');
    expect(statusAfterPayments('partially_paid', total, 60_000n, false)).toBeNull();   // still partial, no write
    expect(statusAfterPayments('overdue', total, 40_000n, true)).toBe('partially_paid');
    expect(statusAfterPayments('issued', total, total, false)).toBe('paid');
    expect(statusAfterPayments('partially_paid', total, total + 1n, false)).toBe('paid');   // overpaid still settles
    expect(statusAfterPayments('paid', total, total, false)).toBeNull();
  });

  it('reopens an invoice when the last payment is REVERSED — overdue if past due, issued if not', () => {
    const total = 100_000n;
    expect(statusAfterPayments('partially_paid', total, 0n, false)).toBe('issued');
    expect(statusAfterPayments('partially_paid', total, 0n, true)).toBe('overdue');
    expect(statusAfterPayments('paid', total, 0n, true)).toBe('overdue');
    expect(statusAfterPayments('overdue', total, 0n, true)).toBeNull();   // already where it belongs
  });

  it('keeps an overpayment visible instead of clamping it away', () => {
    expect(overpaidMinor(100_000n, 120_000n)).toBe(20_000n);
    expect(overpaidMinor(100_000n, 100_000n)).toBe(0n);
    expect(overpaidMinor(100_000n, 40_000n)).toBe(0n);       // never negative
    expect(outstandingMinor(100_000n, 40_000n)).toBe(60_000n);
    expect(outstandingMinor(100_000n, 120_000n)).toBe(0n);   // floors, so a receivables total is never reduced
  });
});

// ---------------------------------------------------------------- the two transition tables

describe('invoice state — arithmetic may reopen a paid invoice; an operator may not', () => {
  it('leaves the OPERATOR table untouched: paid and void stay terminal', () => {
    expect(isTerminal('paid')).toBe(true);
    expect(isTerminal('void')).toBe(true);
    for (const to of ['issued', 'partially_paid', 'overdue', 'void'] as const) {
      expect(canTransition('paid', to)).toBe(false);
    }
  });

  it('lets a REVERSAL reopen a settled invoice (the bounced cheque)', () => {
    expect(canReconcileTo('paid', 'partially_paid')).toBe(true);
    expect(canReconcileTo('paid', 'issued')).toBe(true);
    expect(canReconcileTo('paid', 'overdue')).toBe(true);
    expect(canReconcileTo('partially_paid', 'issued')).toBe(true);   // impossible in the operator table
    expect(canTransition('partially_paid', 'issued')).toBe(false);
  });

  it('NEVER lets arithmetic void an invoice — a write-off is a decision with a reason', () => {
    for (const from of ['issued', 'partially_paid', 'overdue', 'paid'] as const) {
      expect(canReconcileTo(from, 'void')).toBe(false);
    }
    expect(canReconcileTo('void', 'issued')).toBe(false);   // written off stays written off
    expect(canReconcileTo('draft', 'paid')).toBe(false);     // never sent, so nothing can be received
    expect(() => assertReconciliation('draft', 'paid')).toThrow();
  });

  it('the aggregate applies a reconciliation and refuses an illegal one', () => {
    const inv = () => SaasInvoice.rehydrate({
      id: 'i1', tenantId: 't1', subscriptionId: null, invoiceNo: 'INV-1', status: 'paid', currencyCode: 'INR',
      subtotalMinor: 100_000n, taxMinor: 0n, totalMinor: 100_000n, dueDate: '2026-07-01', paidAt: null,
      dunningAttempts: 0, lastDunnedAt: null,
    });
    expect(inv().reconcileTo('overdue')).toEqual({ from: 'paid', to: 'overdue' });
    expect(() => inv().reconcileTo('void')).toThrow();
  });
});

// ---------------------------------------------------------------- dunning policy (ADMIN-1-Q6)

describe('dunning ladder — a promise about how we treat someone who owes us money', () => {
  const step = (dayOffset: number, channel: string, templateCode?: string, escalate = false) =>
    ({ dayOffset, channel, templateCode, escalate });

  it('accepts the seeded ladder and returns it sorted by day', () => {
    const out = assertLadder([
      step(14, 'whatsapp', 'r3'), step(0, 'email', 'due_today'), step(3, 'email', 'r1'),
      step(30, 'call', undefined, true), step(7, 'sms', 'r2'),
    ], null);
    expect(out.map((s) => s.dayOffset)).toEqual([0, 3, 7, 14, 30]);
    expect(out[4]).toEqual({ dayOffset: 30, channel: 'call', templateCode: null, escalate: true });
  });

  it('refuses contacting a tenant the same way twice on the same day', () => {
    expect(() => assertLadder([step(3, 'email', 'a'), step(3, 'email', 'b')], null)).toThrow(InvalidDunningPolicyError);
    // the same day by a DIFFERENT channel is legitimate (an email and an in-app nudge)
    expect(assertLadder([step(3, 'email', 'a'), step(3, 'in_app')], null)).toHaveLength(2);
  });

  it('refuses a messaging step with nothing to send, but allows a template-less CALL', () => {
    expect(() => assertLadder([step(3, 'email')], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(3, 'sms')], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(3, 'whatsapp', '   ')], null)).toThrow(InvalidDunningPolicyError);
    expect(assertLadder([step(3, 'call')], null)).toHaveLength(1);
    expect(assertLadder([step(3, 'in_app')], null)).toHaveLength(1);
  });

  it('refuses a nonsense day or channel, an empty ladder, and an over-long one', () => {
    expect(() => assertLadder([], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(-1, 'call')], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(366, 'call')], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(1.5, 'call')], null)).toThrow(InvalidDunningPolicyError);
    expect(() => assertLadder([step(3, 'pigeon')], null)).toThrow(InvalidDunningPolicyError);
    const many = Array.from({ length: MAX_LADDER_STEPS + 1 }, (_, i) => step(i, 'call'));
    expect(() => assertLadder(many, null)).toThrow(InvalidDunningPolicyError);
  });

  it('day 0 is legal — a reminder on the due date is the cheapest collection there is', () => {
    expect(assertLadder([step(0, 'email', 'due_today')], null)[0].dayOffset).toBe(0);
  });

  it('REFUSES a suspension that lands before the ladder has finished asking', () => {
    const ladder = [step(0, 'email', 'a'), step(30, 'call')];
    expect(() => assertLadder(ladder, 30)).toThrow(InvalidDunningPolicyError);   // same day as the last rung
    expect(() => assertLadder(ladder, 10)).toThrow(InvalidDunningPolicyError);
    expect(assertLadder(ladder, 45)).toHaveLength(2);
    expect(assertLadder(ladder, null)).toHaveLength(2);                          // null = never auto-suspend
  });

  const LADDER: LadderStep[] = [
    { dayOffset: 0, channel: 'email', templateCode: 'due', escalate: false },
    { dayOffset: 7, channel: 'sms', templateCode: 'r2', escalate: false },
    { dayOffset: 30, channel: 'call', templateCode: null, escalate: true },
  ];

  it('names the rung that applies now and the one that comes next', () => {
    expect(stepForDaysLate(LADDER, -2)).toBeNull();          // not due yet
    expect(stepForDaysLate(LADDER, 0)?.channel).toBe('email');
    expect(stepForDaysLate(LADDER, 6)?.channel).toBe('email');
    expect(stepForDaysLate(LADDER, 7)?.channel).toBe('sms');
    expect(stepForDaysLate(LADDER, 99)?.channel).toBe('call');
    expect(nextStepAfter(LADDER, 0)?.dayOffset).toBe(7);
    expect(nextStepAfter(LADDER, 30)).toBeNull();
  });

  it('flags the suspension threshold as a LABEL, never an action', () => {
    expect(suspensionDue(null, 400)).toBe(false);    // no policy = never automatic
    expect(suspensionDue(45, 44)).toBe(false);
    expect(suspensionDue(45, 45)).toBe(true);
  });

  it('diffs two versions by (day, channel), so a rung keeps its identity', () => {
    const after: LadderStep[] = [
      { dayOffset: 0, channel: 'email', templateCode: 'due_v2', escalate: false },   // changed template
      { dayOffset: 7, channel: 'sms', templateCode: 'r2', escalate: false },         // unchanged
      { dayOffset: 21, channel: 'whatsapp', templateCode: 'r3', escalate: false },   // added
    ];
    const d = diffLadders(LADDER, after);
    expect(d.added.map((s) => s.dayOffset)).toEqual([21]);
    expect(d.removed.map((s) => s.dayOffset)).toEqual([30]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].to.templateCode).toBe('due_v2');
  });
});
