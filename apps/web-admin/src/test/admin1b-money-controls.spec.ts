// apps/web-admin/src/test/admin1b-money-controls.spec.ts · PC-56 ADMIN-1b console gates.
// The server refuses the wrong thing in every case here; these tests prove the CONSOLE never invites it — and that
// where a control is absent, there is a named reason the page can print.
import {
  PAYMENT_METHODS, isReversal, reversedIds, reverseBlockedReason, canReverse, payableBlockedReason,
  canRecordPayment, buildPayment, isOverpaid, isSettled,
  ADJUSTMENT_STATUSES, isAdjustmentStatus, adjustmentActions, adjustmentBlockedReason, buildDecision,
  moneyHasMoved, pendingForViewer,
  buildLadder, parseSuspendAfterDays, stepForDaysLate, nextStepAfter, behindPolicy, type LadderStep,
} from '../features/billing/money-controls';

const NOW = '2026-08-06T12:00:00.000Z';
/** ₹ major → paise, integer-only (the real converter lives in the page; this mirrors its contract). */
const toMinor = (major: string): string | undefined => {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(major.trim());
  if (!m) return undefined;
  return String(BigInt(m[1]) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0')));
};

// ---------------------------------------------------------------- payments

describe('payments — the console never invites a receipt the server will refuse', () => {
  it('offers the form only for an invoice that is actually owed, and names the reason otherwise', () => {
    for (const s of ['issued', 'partially_paid', 'overdue']) {
      expect(canRecordPayment(s)).toBe(true);
      expect(payableBlockedReason(s)).toBe('none');
    }
    expect(payableBlockedReason('draft')).toBe('draft_not_sent');
    expect(payableBlockedReason('paid')).toBe('already_paid');
    expect(payableBlockedReason('void')).toBe('void_written_off');
    expect(canRecordPayment('paid')).toBe(false);
    expect(canRecordPayment(null)).toBe(false);
  });

  it('takes the currency FROM THE INVOICE and never offers it as a field', () => {
    const ok = buildPayment({ amountMajor: '4990', method: 'bank_transfer', reference: 'UTR-1', receivedAt: '2026-08-05T10:00:00.000Z' }, 'INR', toMinor, NOW);
    expect(ok).toEqual({ ok: true, value: { amountMinor: '499000', currency: 'INR', method: 'bank_transfer', reference: 'UTR-1', receivedAt: '2026-08-05T10:00:00.000Z' } });
    // a malformed invoice currency is refused rather than defaulted to INR
    expect(buildPayment({ amountMajor: '10', method: 'upi', reference: 'ref', receivedAt: NOW }, '', toMinor, NOW)).toEqual({ ok: false, error: 'currency' });
  });

  it('keeps money integer and refuses zero or unparseable amounts', () => {
    expect(buildPayment({ amountMajor: '4990.50', method: 'upi', reference: 'ref', receivedAt: NOW }, 'INR', toMinor, NOW))
      .toEqual({ ok: true, value: { amountMinor: '499050', currency: 'INR', method: 'upi', reference: 'ref', receivedAt: NOW } });
    for (const bad of ['0', '0.00', '', 'lots', '-50', '1e3']) {
      expect(buildPayment({ amountMajor: bad, method: 'upi', reference: 'ref', receivedAt: NOW }, 'INR', toMinor, NOW).ok).toBe(false);
    }
  });

  it('demands a reference and a real, non-future received-at', () => {
    const base = { amountMajor: '100', method: 'cheque', reference: 'CHQ-9', receivedAt: NOW };
    expect(buildPayment({ ...base, reference: 'ab' }, 'INR', toMinor, NOW)).toEqual({ ok: false, error: 'reference' });
    expect(buildPayment({ ...base, receivedAt: 'yesterday' }, 'INR', toMinor, NOW)).toEqual({ ok: false, error: 'receivedAt' });
    expect(buildPayment({ ...base, receivedAt: '2026-08-07T12:00:00.000Z' }, 'INR', toMinor, NOW)).toEqual({ ok: false, error: 'future' });
    // clock skew inside the tolerance is accepted (mirrors the server's 5 minutes)
    expect(buildPayment({ ...base, receivedAt: '2026-08-06T12:04:00.000Z' }, 'INR', toMinor, NOW).ok).toBe(true);
    expect(buildPayment({ ...base, method: 'pigeon' }, 'INR', toMinor, NOW)).toEqual({ ok: false, error: 'method' });
    expect([...PAYMENT_METHODS]).toContain('offset');
  });

  it('offers REVERSE exactly once per payment, and never on a reversal', () => {
    const payments = [
      { id: 'p1', amountMinor: '100000' },
      { id: 'p2', amountMinor: '-100000', reversesPaymentId: 'p1' },
      { id: 'p3', amountMinor: '50000' },
    ];
    const reversed = reversedIds(payments);
    expect([...reversed]).toEqual(['p1']);
    expect(isReversal(payments[1])).toBe(true);
    expect(reverseBlockedReason(payments[0], reversed)).toBe('already_reversed');
    expect(reverseBlockedReason(payments[1], reversed)).toBe('is_reversal');
    expect(canReverse(payments[2], reversed)).toBe(true);
  });

  it('reads the money picture from the SERVER’s numbers, and never re-derives it', () => {
    expect(isSettled({ outstandingMinor: '0' })).toBe(true);
    expect(isSettled({ outstandingMinor: '1' })).toBe(false);
    expect(isSettled({ outstandingMinor: null })).toBe(false);       // unknown is not settled
    expect(isOverpaid({ overpaidMinor: '2500' })).toBe(true);
    expect(isOverpaid({ overpaidMinor: '0' })).toBe(false);
    expect(isOverpaid({})).toBe(false);
  });
});

// ---------------------------------------------------------------- adjustment maker-checker

describe('adjustments — the requester is offered nothing on their own request', () => {
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'a1', tenantId: 't1', direction: 'credit', amountMinor: '50000', currency: 'INR',
    reason: 'goodwill', status: 'awaiting_approval', requestedBy: 'maker', ...over,
  });

  it('mirrors the 0093 status vocabulary', () => {
    expect([...ADJUSTMENT_STATUSES]).toEqual(['awaiting_approval', 'approved', 'applied', 'returned', 'rejected']);
    expect(isAdjustmentStatus('applied')).toBe(true);
    expect(isAdjustmentStatus('pending')).toBe(false);
  });

  it('MAKER ≠ CHECKER by absence — no buttons at all for the requester', () => {
    expect(adjustmentActions(row(), 'maker')).toEqual([]);
    expect(adjustmentBlockedReason(row(), 'maker')).toBe('you_requested_it');
    expect(adjustmentActions(row(), 'checker')).toEqual(['approve', 'return', 'reject']);
    expect(adjustmentBlockedReason(row(), 'checker')).toBe('none');
  });

  it('keeps APPROVE and APPLY separate, and still bars the maker from applying', () => {
    expect(adjustmentActions(row({ status: 'approved' }), 'checker')).toEqual(['apply']);
    expect(adjustmentActions(row({ status: 'approved' }), 'maker')).toEqual([]);   // a two-click bypass otherwise
  });

  it('offers nothing once the request is closed or the money has moved', () => {
    for (const status of ['applied', 'returned', 'rejected']) {
      expect(adjustmentActions(row({ status }), 'checker')).toEqual([]);
    }
    expect(adjustmentBlockedReason(row({ status: 'applied' }), 'checker')).toBe('already_applied');
    expect(adjustmentBlockedReason(row({ status: 'rejected' }), 'checker')).toBe('closed');
    expect(adjustmentActions(row({ status: 'nonsense' }), 'checker')).toEqual([]);
  });

  it('requires a note to refuse, but not to agree', () => {
    expect(buildDecision({ decision: 'approve' })).toEqual({ ok: true, value: { decision: 'approve' } });
    expect(buildDecision({ decision: 'approve', note: ' looks right ' })).toEqual({ ok: true, value: { decision: 'approve', note: 'looks right' } });
    expect(buildDecision({ decision: 'return' })).toEqual({ ok: false, error: 'note' });
    expect(buildDecision({ decision: 'reject', note: 'no' })).toEqual({ ok: false, error: 'note' });
    expect(buildDecision({ decision: 'reject', note: 'duplicate of ADJ-11' })).toEqual({ ok: true, value: { decision: 'reject', note: 'duplicate of ADJ-11' } });
    expect(buildDecision({ decision: 'shrug' })).toEqual({ ok: false, error: 'decision' });
  });

  it('says money has moved ONLY when it has', () => {
    expect(moneyHasMoved(row({ status: 'applied', walletTxnId: 'w1' }))).toBe(true);
    expect(moneyHasMoved(row({ status: 'applied' }))).toBe(false);        // applied with no txn id is a broken row
    expect(moneyHasMoved(row({ status: 'approved', walletTxnId: 'w1' }))).toBe(false);
  });

  it('counts only the requests the viewer can actually act on', () => {
    const rows = [row(), row({ id: 'a2', requestedBy: 'checker' }), row({ id: 'a3', status: 'applied' })];
    expect(pendingForViewer(rows, 'checker')).toBe(1);   // a2 is the checker's own request
    expect(pendingForViewer(rows, 'maker')).toBe(1);
    expect(pendingForViewer(rows, null)).toBe(2);
  });
});

// ---------------------------------------------------------------- collections ladder

describe('collections ladder — the console validates it the way the server does, and points at the row', () => {
  const step = (dayOffset: string, channel: string, templateCode?: string, escalate = false) =>
    ({ dayOffset, channel, templateCode, escalate });

  it('builds and sorts a ladder', () => {
    const r = buildLadder([step('7', 'sms', 'r2'), step('0', 'email', 'due')], null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.dayOffset)).toEqual([0, 7]);
  });

  it('ignores blank rows so an empty form row is not an error', () => {
    const r = buildLadder([step('0', 'email', 'due'), { dayOffset: '', channel: '' }], null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
    expect(buildLadder([{ dayOffset: '', channel: '' }], null)).toEqual({ ok: false, error: 'empty' });
  });

  it('names the failing ROW, not just the form', () => {
    expect(buildLadder([step('0', 'email', 'due'), step('x', 'sms', 'r2')], null)).toEqual({ ok: false, error: 'day', at: 1 });
    expect(buildLadder([step('0', 'email', 'due'), step('7', 'pigeon')], null)).toEqual({ ok: false, error: 'channel', at: 1 });
    expect(buildLadder([step('0', 'email', 'due'), step('0', 'email', 'other')], null)).toEqual({ ok: false, error: 'duplicate', at: 1 });
    expect(buildLadder([step('3', 'email')], null)).toEqual({ ok: false, error: 'template', at: 0 });
    expect(buildLadder([step('400', 'call')], null)).toEqual({ ok: false, error: 'day', at: 0 });
  });

  it('allows a template-less call and refuses a suspension before the last rung', () => {
    expect(buildLadder([step('30', 'call')], null).ok).toBe(true);
    expect(buildLadder([step('30', 'call')], 30)).toEqual({ ok: false, error: 'suspendTooEarly' });
    expect(buildLadder([step('30', 'call')], 45).ok).toBe(true);
  });

  it('treats a BLANK suspension field as "never", never as zero', () => {
    expect(parseSuspendAfterDays('')).toBeNull();
    expect(parseSuspendAfterDays(null)).toBeNull();
    expect(parseSuspendAfterDays('45')).toBe(45);
    expect(parseSuspendAfterDays('0')).toBe('bad');       // 0 would read as "suspend immediately"
    expect(parseSuspendAfterDays('400')).toBe('bad');
    expect(parseSuspendAfterDays('soon')).toBe('bad');
  });

  const LADDER: LadderStep[] = [
    { dayOffset: 0, channel: 'email', templateCode: 'due', escalate: false },
    { dayOffset: 7, channel: 'sms', templateCode: 'r2', escalate: false },
    { dayOffset: 30, channel: 'call', templateCode: null, escalate: true },
  ];

  it('says which rung applies now, which is next, and WHO HAS BEEN FORGOTTEN', () => {
    expect(stepForDaysLate(LADDER, 8)?.channel).toBe('sms');
    expect(nextStepAfter(LADDER, 8)?.dayOffset).toBe(30);
    // two rungs are due by day 8; only one touch was recorded → this debtor has been forgotten
    expect(behindPolicy(LADDER, 8, 1)).toBe(true);
    expect(behindPolicy(LADDER, 8, 2)).toBe(false);
    expect(behindPolicy(LADDER, 8, 5)).toBe(false);      // ahead of the ladder is fine, never flagged
    expect(behindPolicy(LADDER, -1, 0)).toBe(false);     // nothing due yet
  });
});
