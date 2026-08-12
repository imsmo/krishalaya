// modules/disputes/__tests__/returns.spec.ts · pure-domain unit tests for the API-W3-09 returns/RMA
// state machine (Law 5) + the Return aggregate (request → approve/reject → ship → receive → refund).
// Service-level eligibility / party-authz / UoW / RLS are covered by returns.integration.spec.ts.
import { Return } from '../domain/return.entity';
import { canTransition, isActive, isTerminal, IllegalReturnTransitionError, RETURN_STATUSES, ReturnStatus } from '../domain/return.state';
import { ReturnEventType } from '../domain/disputes.events';

const mk = (over: any = {}) => Return.request({ id: 'r1', tenantId: 't1', orderId: 'o1', ...over });

describe('return.state machine', () => {
  it('allows the documented happy path and forbids skips/revival', () => {
    expect(canTransition('requested', 'approved')).toBe(true);
    expect(canTransition('approved', 'in_transit')).toBe(true);
    expect(canTransition('in_transit', 'received')).toBe(true);
    expect(canTransition('received', 'refunded')).toBe(true);
    expect(canTransition('requested', 'in_transit')).toBe(false);   // can't skip approval
    expect(canTransition('refunded', 'requested')).toBe(false);     // terminal
    expect(canTransition('rejected', 'approved')).toBe(false);
  });
  it('reject is reachable from requested + approved only', () => {
    expect(canTransition('requested', 'rejected')).toBe(true);
    expect(canTransition('approved', 'rejected')).toBe(true);
    expect(canTransition('in_transit', 'rejected')).toBe(false);
  });
  it('active/terminal helpers + covers every status', () => {
    expect(isActive('requested')).toBe(true); expect(isActive('in_transit')).toBe(true);
    expect(isTerminal('refunded')).toBe(true); expect(isTerminal('rejected')).toBe(true);
    expect(isActive('refunded')).toBe(false);
    for (const s of RETURN_STATUSES) expect(() => canTransition(s, 'rejected' as ReturnStatus)).not.toThrow();
  });
});

describe('Return aggregate', () => {
  it('requests open at requested + emits return_requested', () => {
    const r = mk();
    expect(r.status).toBe('requested');
    const ev = r.pullEvents().find((e) => e.type === ReturnEventType.Requested)!;
    expect(ev.payload).toMatchObject({ orderId: 'o1' });
  });
  // UPDATED BY PC-56 TENANT-3b: a refund now requires an INSPECTION and a RECORDED AMOUNT (0139). The old happy
  // path refunded a parcel nobody had opened, for a figure nobody had written down — and since
  // `disputes.return_refunded` had no subscriber, the status said refunded while no money moved at all.
  it('drives the full lifecycle to refunded + stamps the refund txn', () => {
    const r = mk({ refundAmountMinor: 418000n }); r.pullEvents();
    r.approve(); expect(r.status).toBe('approved');
    r.ship(); expect(r.status).toBe('in_transit');
    r.receive(); expect(r.status).toBe('received');
    r.inspect('u-staff', 'Opened the parcel: 3 of 12 seed packets torn, photographed.');
    r.refund('txn-1'); expect(r.status).toBe('refunded');
    expect(r.toProps().refundTxnId).toBe('txn-1');
    expect(r.pullEvents().map((e) => e.type)).toContain(ReturnEventType.Refunded);
  });
  it('rejects an illegal transition with a typed error', () => {
    const r = mk();
    expect(() => r.receive()).toThrow(IllegalReturnTransitionError);   // requested → received is illegal
    r.reject(); expect(r.status).toBe('rejected');
    expect(() => r.approve()).toThrow(IllegalReturnTransitionError);   // terminal
  });
});
