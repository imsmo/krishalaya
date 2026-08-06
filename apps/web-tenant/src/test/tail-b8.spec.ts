// apps/web-tenant/src/test/tail-b8.spec.ts · PC-55 B8. Returns/RMA, cooperative governance and COD reconciliation.
// Three surfaces, three places where a loose gate lets somebody take money that is not theirs: a refund before the
// goods came back, a ballot re-opened after the tally was seen, and cash reconciled by the one person who handled it.
import {
  RETURN_STATUSES, RETURN_BOXES, isReturnStatus, isReturnBox, isActive, isTerminal,
  sellerActions, awaitingBuyerShipment, refundBlockedByPermission, buildReturnRequest, canRequestReturn,
} from '../features/returns/rma';
import {
  RESOLUTION_TYPES, RESOLUTION_STATUSES, isResolutionType, offeredTransition, votingLive, voteBlockedReason,
  buildResolution, buildVote, totalVotes, shareBps, sortTally, hasPayoutConsequence,
} from '../features/governance/agm';
import {
  REMITTANCE_STATUSES, DEPOSIT_METHODS, isDepositMethod, sortOutstanding, daysHeld, isAgeing,
  totalOutstandingMinor, buildRemittance, buildDeposit, remittanceActions, reconcileBlockedReason, buildCancel,
} from '../features/cod/recon';

// ---------------------------------------------------------------- returns / RMA

describe('returns — a refund only after the goods are back', () => {
  it('mirrors the API status machine', () => {
    expect([...RETURN_STATUSES]).toEqual(['requested', 'approved', 'in_transit', 'received', 'refunded', 'rejected']);
    expect([...RETURN_BOXES]).toEqual(['mine', 'against', 'all']);
    expect(isReturnStatus('received')).toBe(true);
    expect(isReturnStatus('cancelled')).toBe(false);
    expect(isReturnBox('theirs')).toBe(false);
    expect(isActive('in_transit')).toBe(true);
    expect(isTerminal('refunded')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
  });

  it('offers REFUND only from received, and only to someone who may resolve', () => {
    expect(sellerActions('received', true)).toEqual(['refund']);
    expect(sellerActions('received', false)).toEqual([]);       // the button's absence IS the permission control
    expect(sellerActions('in_transit', true)).toEqual(['receive']);
    expect(sellerActions('requested', true)).toEqual(['approve', 'reject']);
    expect(sellerActions('approved', true)).toEqual(['reject']); // 'in_transit' is the BUYER's act, never the seller's
  });
  it('offers nothing on a terminal case, and nothing for an unknown status', () => {
    expect(sellerActions('refunded', true)).toEqual([]);
    expect(sellerActions('rejected', true)).toEqual([]);
    expect(sellerActions('nonsense', true)).toEqual([]);
  });
  it('names the two states that look stuck but are not', () => {
    expect(awaitingBuyerShipment('approved')).toBe(true);
    expect(awaitingBuyerShipment('received')).toBe(false);
    expect(refundBlockedByPermission('received', false)).toBe(true);
    expect(refundBlockedByPermission('received', true)).toBe(false);
    expect(refundBlockedByPermission('approved', false)).toBe(false);
  });

  const ORDER = '00000000-0000-7000-8000-0000000000o1'.replace('o1', 'a1');
  it('a buyer’s request needs a real order and a reason from the known taxonomy', () => {
    expect(buildReturnRequest({ orderId: ORDER, reasonCode: 'damaged' })).toEqual({ ok: true, value: { orderId: ORDER, reasonCode: 'damaged' } });
    expect(buildReturnRequest({ orderId: 'my order', reasonCode: 'damaged' })).toEqual({ ok: false, error: 'order' });
    expect(buildReturnRequest({ orderId: ORDER, reasonCode: '' })).toEqual({ ok: false, error: 'reason' });
    expect(buildReturnRequest({ orderId: ORDER, reasonCode: 'changed_my_mind' })).toEqual({ ok: false, error: 'reason' });
    // The reason vocabulary is the API's DISPUTE taxonomy verbatim — an invented code would 422 server-side.
    for (const code of ['not_delivered', 'poor_quality', 'qty_mismatch', 'late', 'wrong_item', 'damaged', 'payment']) {
      expect(buildReturnRequest({ orderId: ORDER, reasonCode: code }).ok).toBe(true);
    }
    expect(buildReturnRequest({ orderId: ORDER, reasonCode: 'not_as_described' })).toEqual({ ok: false, error: 'reason' });
  });
  it('only offers a return on an order the buyer actually received', () => {
    expect(canRequestReturn('delivered')).toBe(true);
    expect(canRequestReturn('completed')).toBe(true);
    expect(canRequestReturn('shipped')).toBe(false);
    expect(canRequestReturn('cancelled')).toBe(false);
    expect(canRequestReturn(null)).toBe(false);
  });
});

// ---------------------------------------------------------------- governance / AGM

describe('governance — a ballot cannot be re-opened, and "open" is not always "accepting votes"', () => {
  const NOW = '2026-08-06T10:00:00.000Z';

  it('mirrors the API vocabularies and the one-way lifecycle', () => {
    expect([...RESOLUTION_TYPES]).toEqual(['agm_vote', 'dividend', 'patronage_bonus', 'board_election']);
    expect([...RESOLUTION_STATUSES]).toEqual(['draft', 'open', 'closed']);
    expect(isResolutionType('agm_vote')).toBe(true);
    expect(isResolutionType('referendum')).toBe(false);
    expect(offeredTransition('draft')).toBe('open');
    expect(offeredTransition('open')).toBe('closed');
    expect(offeredTransition('closed')).toBeNull();   // re-opening after a tally is seen is never offered
  });

  it('separates OPEN from actually-accepting-votes (the case that looks live and is not)', () => {
    expect(votingLive({ status: 'open' }, NOW)).toBe(true);
    expect(votingLive({ status: 'open', votingOpens: '2026-08-07T00:00:00.000Z' }, NOW)).toBe(false);
    expect(votingLive({ status: 'open', votingCloses: '2026-08-05T00:00:00.000Z' }, NOW)).toBe(false);
    expect(votingLive({ status: 'draft' }, NOW)).toBe(false);
    expect(votingLive({ status: 'closed' }, NOW)).toBe(false);
  });
  it('says exactly why a member cannot vote', () => {
    expect(voteBlockedReason({ status: 'open' }, NOW, false)).toBe('none');
    expect(voteBlockedReason({ status: 'open' }, NOW, true)).toBe('already_voted');
    expect(voteBlockedReason({ status: 'draft' }, NOW, false)).toBe('not_open');
    expect(voteBlockedReason({ status: 'open', votingOpens: '2026-08-07T00:00:00.000Z' }, NOW, false)).toBe('not_started');
    expect(voteBlockedReason({ status: 'open', votingCloses: '2026-08-05T00:00:00.000Z' }, NOW, false)).toBe('window_closed');
    // already-voted outranks everything: the ballot box has their vote whatever the window says.
    expect(voteBlockedReason({ status: 'closed' }, NOW, true)).toBe('already_voted');
  });

  const base = { title: 'Adopt the audited accounts', resolutionType: 'agm_vote', body: '', votingOpens: '', votingCloses: '' };
  it('builds a resolution, with an optional window that must be the right way round', () => {
    expect(buildResolution(base)).toEqual({ ok: true, value: { title: 'Adopt the audited accounts', resolutionType: 'agm_vote' } });
    const win = buildResolution({ ...base, votingOpens: '2026-09-01T00:00:00.000Z', votingCloses: '2026-09-08T00:00:00.000Z' });
    expect(win.ok).toBe(true);
    expect(buildResolution({ ...base, votingOpens: '2026-09-08T00:00:00.000Z', votingCloses: '2026-09-01T00:00:00.000Z' }))
      .toEqual({ ok: false, error: 'windowOrder' });
    expect(buildResolution({ ...base, votingOpens: '2026-09-08T00:00:00.000Z', votingCloses: '2026-09-08T00:00:00.000Z' }))
      .toEqual({ ok: false, error: 'windowOrder' });   // equal is not "after"
  });
  it('refuses a thin title, an unknown type and a malformed date', () => {
    expect(buildResolution({ ...base, title: 'AG' })).toEqual({ ok: false, error: 'title' });
    expect(buildResolution({ ...base, resolutionType: 'poll' })).toEqual({ ok: false, error: 'type' });
    expect(buildResolution({ ...base, votingOpens: 'next week' })).toEqual({ ok: false, error: 'opens' });
  });
  it('accepts any short choice — a board election names candidates, and the cooperative owns that vocabulary', () => {
    expect(buildVote({ choice: 'for' })).toEqual({ ok: true, value: { choice: 'for' } });
    expect(buildVote({ choice: 'Kamlaben' })).toEqual({ ok: true, value: { choice: 'Kamlaben' } });
    expect(buildVote({ choice: '' })).toEqual({ ok: false, error: 'choice' });
    expect(buildVote({ choice: 'x'.repeat(21) })).toEqual({ ok: false, error: 'choice' });
  });

  it('tallies from the server’s count, and reports NO result rather than 0 % when nobody voted', () => {
    const tally = [{ choice: 'for', votes: 30 }, { choice: 'against', votes: 10 }];
    expect(totalVotes(tally)).toBe(40);
    expect(shareBps(30, 40)).toBe(7500);
    expect(shareBps(0, 0)).toBeNull();
    expect(shareBps(5, 0)).toBeNull();
    expect(totalVotes([])).toBe(0);
  });
  it('sorts the tally highest-first with a stable tie-break', () => {
    const tally = [{ choice: 'abstain', votes: 5 }, { choice: 'for', votes: 5 }, { choice: 'against', votes: 9 }];
    expect(sortTally(tally).map((t) => t.choice)).toEqual(['against', 'abstain', 'for']);
  });
  it('flags the vote types that have money behind them', () => {
    expect(hasPayoutConsequence('dividend')).toBe(true);
    expect(hasPayoutConsequence('patronage_bonus')).toBe(true);
    expect(hasPayoutConsequence('agm_vote')).toBe(false);
    expect(hasPayoutConsequence('board_election')).toBe(false);
  });
});

// ---------------------------------------------------------------- COD reconciliation

describe('COD recon — oldest cash first, and never reconciled by the person who banked it', () => {
  const NOW = Date.parse('2026-08-06T10:00:00.000Z');

  it('mirrors the API vocabularies', () => {
    expect([...REMITTANCE_STATUSES]).toEqual(['pending', 'deposited', 'reconciled', 'cancelled']);
    expect([...DEPOSIT_METHODS]).toEqual(['bank_branch', 'cash_office', 'upi', 'other']);
    expect(isDepositMethod('upi')).toBe(true);
    expect(isDepositMethod('cheque')).toBe(false);
  });

  it('puts the oldest cash first and undated rows LAST', () => {
    const rows = [
      { riderUserId: 'a', oldestDeliveredAt: '2026-08-04T00:00:00Z' },
      { riderUserId: 'b', oldestDeliveredAt: null },
      { riderUserId: 'c', oldestDeliveredAt: '2026-07-20T00:00:00Z' },
    ];
    expect(sortOutstanding(rows).map((r) => r.riderUserId)).toEqual(['c', 'a', 'b']);
  });
  it('measures how long cash has been held, and flags ageing', () => {
    expect(daysHeld('2026-08-03T10:00:00.000Z', NOW)).toBe(3);
    expect(daysHeld('2026-08-06T12:00:00.000Z', NOW)).toBe(0);   // never negative
    expect(daysHeld(null, NOW)).toBeNull();
    expect(isAgeing('2026-08-03T10:00:00.000Z', NOW)).toBe(true);
    expect(isAgeing('2026-08-05T10:00:00.000Z', NOW)).toBe(false);
    expect(isAgeing(null, NOW)).toBe(false);
  });
  it('totals outstanding cash as bigint minor units', () => {
    expect(totalOutstandingMinor([{ codMinor: '150000' }, { codMinor: '2500' }, { codMinor: null }, { codMinor: 'x' }])).toBe(152500n);
    expect(totalOutstandingMinor([])).toBe(0n);
  });

  const RIDER = '00000000-0000-7000-8000-0000000000r1'.replace('r1', 'c1');
  it('sends the figure the operator was READING as a stale-read guard, never as the amount', () => {
    const r = buildRemittance({ riderUserId: RIDER, expectedAmountMinor: '152500', depositRef: '', depositMethod: '' });
    expect(r).toEqual({ ok: true, value: { riderUserId: RIDER, expectedAmountMinor: '152500' } });
    expect(buildRemittance({ riderUserId: RIDER, expectedAmountMinor: '1525.00', depositRef: '', depositMethod: '' })).toEqual({ ok: false, error: 'expected' });
    expect(buildRemittance({ riderUserId: 'rider', expectedAmountMinor: '', depositRef: '', depositMethod: '' })).toEqual({ ok: false, error: 'rider' });
    expect(buildRemittance({ riderUserId: RIDER, expectedAmountMinor: '', depositRef: '', depositMethod: 'cheque' })).toEqual({ ok: false, error: 'depositMethod' });
  });
  it('a deposit MUST carry a reference and a method — "it went in somehow" is not a reconciliation', () => {
    expect(buildDeposit({ depositRef: 'SBI/2026/8811', depositMethod: 'bank_branch' }))
      .toEqual({ ok: true, value: { depositRef: 'SBI/2026/8811', depositMethod: 'bank_branch' } });
    expect(buildDeposit({ depositRef: 'ok', depositMethod: 'bank_branch' })).toEqual({ ok: false, error: 'depositRef' });
    expect(buildDeposit({ depositRef: 'SBI/1', depositMethod: '' })).toEqual({ ok: false, error: 'depositMethod' });
  });

  it('MAKER ≠ CHECKER: the person who recorded the deposit is never offered reconcile', () => {
    const dep = { status: 'deposited', depositedBy: 'officer-1' };
    expect(remittanceActions(dep, 'officer-2', true)).toEqual(['reconcile', 'cancel']);
    expect(remittanceActions(dep, 'officer-1', true)).toEqual(['cancel']);
    expect(remittanceActions(dep, 'officer-2', false)).toEqual(['cancel']);
    expect(remittanceActions({ status: 'pending' }, 'officer-1', true)).toEqual(['deposit', 'cancel']);
    expect(remittanceActions({ status: 'reconciled' }, 'officer-2', true)).toEqual([]);
    expect(remittanceActions({ status: 'cancelled' }, 'officer-2', true)).toEqual([]);
  });
  it('says why reconcile is unavailable', () => {
    expect(reconcileBlockedReason({ status: 'pending' }, 'o2', true)).toBe('not_deposited');
    expect(reconcileBlockedReason({ status: 'deposited', depositedBy: 'o1' }, 'o1', true)).toBe('you_recorded_it');
    expect(reconcileBlockedReason({ status: 'deposited', depositedBy: 'o1' }, 'o2', false)).toBe('no_permission');
    expect(reconcileBlockedReason({ status: 'deposited', depositedBy: 'o1' }, 'o2', true)).toBe('none');
  });
  it('a cancellation always carries a reason — it puts cash back into outstanding', () => {
    expect(buildCancel({ reason: 'rider reported a short bag' })).toEqual({ ok: true, value: { reason: 'rider reported a short bag' } });
    expect(buildCancel({ reason: ' ' })).toEqual({ ok: false, error: 'reason' });
  });
});
