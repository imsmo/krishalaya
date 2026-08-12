// modules/disputes/__tests__/dispute.service.spec.ts · pure-domain unit tests: the dispute_status state
// machine (Law 5) + the Dispute aggregate (raise/respond/withdraw/escalate/resolve guards) + the
// DisputeMessage value object. The service's eligibility gate / UoW / outbox are covered by integration.
import { canTransition, isActive, isTerminal, DISPUTE_STATUSES, DisputeStatus } from '../domain/dispute.state';
import { Dispute } from '../domain/dispute.entity';
import { DisputeMessage } from '../domain/dispute-message.entity';
import { DisputeEventType } from '../domain/disputes.events';
import { InvalidDisputeError, DisputeForbiddenError, DisputeNotActiveError } from '../domain/disputes.errors';

const RAISER = 'buyer1', AGAINST = 'seller1';
const mk = (over: any = {}) => Dispute.raise({ id: 'd1', tenantId: 't1', orderId: 'o1', raisedBy: RAISER, againstUser: AGAINST, reasonId: 'reason-uuid', ...over });

describe('dispute.state machine', () => {
  it('allows documented transitions, forbids illegal ones', () => {
    expect(canTransition('open', 'seller_responded')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('under_review', 'escalated')).toBe(true);
    expect(canTransition('resolved', 'open')).toBe(false);
    expect(canTransition('withdrawn', 'open')).toBe(false);
    expect(isActive('open')).toBe(true); expect(isActive('escalated')).toBe(true); expect(isActive('resolved')).toBe(false);
    expect(isTerminal('resolved')).toBe(true); expect(isTerminal('rejected')).toBe(true); expect(isTerminal('withdrawn')).toBe(true);
  });
  it('covers every status', () => { for (const s of DISPUTE_STATUSES) expect(() => canTransition(s, 'rejected' as DisputeStatus)).not.toThrow(); });
});

describe('Dispute.raise', () => {
  it('rejects self-dispute and an oversized description; starts open + emits opened', () => {
    expect(() => mk({ againstUser: RAISER })).toThrow(InvalidDisputeError);
    expect(() => mk({ description: 'x'.repeat(4001) })).toThrow(InvalidDisputeError);
    const d = mk();
    expect(d.status).toBe('open');
    const ev = d.pullEvents().find((e) => e.type === DisputeEventType.Opened)!;
    expect(ev.payload).toMatchObject({ orderId: 'o1', raisedBy: RAISER, againstUser: AGAINST });
  });
});

describe('Dispute lifecycle', () => {
  it('only the respondent may respond; only the raiser may withdraw', () => {
    const a = mk(); a.pullEvents();
    expect(() => a.sellerRespond(RAISER)).toThrow(DisputeForbiddenError);
    a.sellerRespond(AGAINST); expect(a.status).toBe('seller_responded');
    const b = mk();
    expect(() => b.withdraw(AGAINST)).toThrow(DisputeForbiddenError);
    b.withdraw(RAISER); expect(b.status).toBe('withdrawn');
    expect(() => b.withdraw(RAISER)).toThrow(DisputeNotActiveError);   // terminal
  });
  it('moderator review → escalate → resolve (refund_partial requires amount)', () => {
    const d = mk(); d.startReview(); d.escalate(); d.pullEvents();
    expect(() => d.resolve('mod1', 'refund_partial', null)).toThrow(InvalidDisputeError);
    d.resolve('mod1', 'refund_partial', 50000n);
    expect(d.status).toBe('resolved');
    expect(d.toProps().resolutionAmountMinor).toBe(50000n);
    const ev = d.pullEvents().find((e) => e.type === DisputeEventType.Resolved)!;
    expect(ev.payload).toMatchObject({ resolutionType: 'refund_partial', resolutionAmountMinor: '50000' });
  });
  it('a rejected resolution lands in status rejected (still announces dispute_resolved)', () => {
    const d = mk(); d.pullEvents();
    d.resolve('mod1', 'rejected', null);
    expect(d.status).toBe('rejected');
    expect(d.pullEvents().map((e) => e.type)).toContain(DisputeEventType.Resolved);
  });
  it('cannot resolve a terminal dispute', () => {
    const d = mk(); d.resolve('mod1', 'refund_full', null);
    expect(() => d.resolve('mod1', 'refund_full', null)).toThrow(DisputeNotActiveError);
  });
});

describe('DisputeMessage', () => {
  it('validates body presence + length', () => {
    expect(() => DisputeMessage.create({ id: 'm1', disputeId: 'd1', tenantId: 't1', authorUserId: 'u1', body: '  ' })).toThrow(InvalidDisputeError);
    expect(() => DisputeMessage.create({ id: 'm1', disputeId: 'd1', tenantId: 't1', authorUserId: 'u1', body: 'x'.repeat(4001) })).toThrow(InvalidDisputeError);
    const m = DisputeMessage.create({ id: 'm1', disputeId: 'd1', tenantId: 't1', authorUserId: 'u1', body: ' hello ' });
    expect(m.props.body).toBe('hello');
  });
});
