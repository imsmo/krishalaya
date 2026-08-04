// apps/web-tenant/src/test/disputes-manage.spec.ts · unit tests for dispute moderation gating + resolve-payload
// assembly. Gating mirrors the API state machine; resolve validation is the first gate before the authed action.
import { canReview, canEscalate, canResolve, buildResolve } from '../features/disputes/manage';

describe('action gating', () => {
  it('review/escalate/resolve legal while active, not when terminal', () => {
    for (const s of ['open', 'seller_responded']) {
      expect(canReview(s)).toBe(true); expect(canEscalate(s)).toBe(true); expect(canResolve(s)).toBe(true);
    }
    expect(canReview('under_review')).toBe(false);   // already under review
    expect(canEscalate('under_review')).toBe(true);
    expect(canResolve('escalated')).toBe(true);
    for (const s of ['resolved', 'rejected', 'withdrawn', '', undefined, null]) {
      expect(canReview(s as string)).toBe(false); expect(canResolve(s as string)).toBe(false);
    }
  });
});

describe('buildResolve', () => {
  it('requires a positive amount for a partial refund', () => {
    expect(buildResolve({ resolutionType: 'refund_partial', amountMajor: '250.50' })).toEqual({ ok: true, value: { resolutionType: 'refund_partial', resolutionAmountMinor: '25050', note: undefined } });
    expect(buildResolve({ resolutionType: 'refund_partial', amountMajor: '0' })).toEqual({ ok: false, error: 'amount' });
    expect(buildResolve({ resolutionType: 'refund_partial' })).toEqual({ ok: false, error: 'amount' });
  });
  it('allows other types with or without an optional amount', () => {
    expect(buildResolve({ resolutionType: 'refund_full' }).ok).toBe(true);
    expect(buildResolve({ resolutionType: 'rejected', note: 'no proof' })).toEqual({ ok: true, value: { resolutionType: 'rejected', note: 'no proof' } });
    expect(buildResolve({ resolutionType: 'replacement', amountMajor: 'x' })).toEqual({ ok: false, error: 'amount' });
  });
  it('rejects an unknown resolution type', () => {
    expect(buildResolve({ resolutionType: 'hack' })).toEqual({ ok: false, error: 'type' });
    expect(buildResolve({})).toEqual({ ok: false, error: 'type' });
  });
});

describe('PC-22 party respond + thread helpers', () => {
  const { canRespond, messageAuthorRole, buildDisputeMessage } = require('../features/disputes/manage');
  const d = { raisedBy: 'buyer1', againstUser: 'seller1' };

  it('canRespond only from open, only for the against-party', () => {
    expect(canRespond('open', 'seller1', 'seller1')).toBe(true);
    expect(canRespond('open', 'seller1', 'buyer1')).toBe(false);
    expect(canRespond('under_review', 'seller1', 'seller1')).toBe(false);
    expect(canRespond('open', null, 'seller1')).toBe(false);
    expect(canRespond('open', 'seller1', null)).toBe(false);
  });

  it('messageAuthorRole derives complainant/respondent/moderator', () => {
    expect(messageAuthorRole('buyer1', d)).toBe('complainant');
    expect(messageAuthorRole('seller1', d)).toBe('respondent');
    expect(messageAuthorRole('staff9', d)).toBe('moderator');
  });

  it('buildDisputeMessage trims, requires content, caps 4000', () => {
    expect(buildDisputeMessage('  evidence  ')).toEqual({ ok: true, value: 'evidence' });
    expect(buildDisputeMessage('   ')).toEqual({ ok: false, error: 'message' });
    expect(buildDisputeMessage('x'.repeat(4001))).toEqual({ ok: false, error: 'message' });
  });
});
