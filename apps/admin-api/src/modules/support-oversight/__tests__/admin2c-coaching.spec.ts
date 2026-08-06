// apps/admin-api/src/modules/support-oversight/__tests__/admin2c-coaching.spec.ts · PC-56 ADMIN-2c.
//
// These rules govern the most sensitive records in the platform: written statements about a named person's performance,
// held in a system that person's employer can be shown. The tests are therefore about REFUSALS — what this system will
// not let somebody write about somebody else.
import {
  CSAT_VERDICTS, isCsatVerdict, verdictSupportsCoaching, verdictExoneratesAgent,
  COACHING_KINDS, COACHING_STATUSES, SETTLE_STATUSES, isEventKind, initialStatus,
  assertReview, assertCoaching, assertSettlement,
  splitByReviewed, verdictShares, signalIsSettled,
  MIN_FINDING, MIN_RATIONALE, MIN_OUTCOME, MAX_SCHEDULE_DAYS,
} from '../domain/coaching';
import { InvalidCoachingError } from '../domain/support-oversight.errors';

const AGENT = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const RESPONSE = '33333333-3333-4333-8333-333333333333';
const REVIEW = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-06T09:00:00.000Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe('the vocabularies mirror the migrations', () => {
  it('matches 0099 verdicts and 0100 enums exactly', () => {
    expect([...CSAT_VERDICTS]).toEqual([
      'agent_at_fault', 'process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken', 'needs_more_info']);
    expect([...COACHING_KINDS]).toEqual(['shadow_session', 'review_call', 'written_feedback', 'signal_dismissed']);
    expect([...COACHING_STATUSES]).toEqual(['scheduled', 'held', 'missed', 'cancelled', 'closed']);
    expect([...SETTLE_STATUSES]).toEqual(['held', 'missed', 'cancelled']);
    expect(isCsatVerdict('agent_at_fault')).toBe(true);
    expect(isCsatVerdict('agent_was_rude')).toBe(false);
  });

  it('knows which kinds are EVENTS, and what status each kind starts in', () => {
    expect(isEventKind('shadow_session')).toBe(true);
    expect(isEventKind('review_call')).toBe(true);
    expect(isEventKind('written_feedback')).toBe(false);
    expect(isEventKind('signal_dismissed')).toBe(false);
    // not the caller's choice: a session begins scheduled, a note and a dismissal have nothing to attend
    expect(initialStatus('shadow_session')).toBe('scheduled');
    expect(initialStatus('review_call')).toBe('scheduled');
    expect(initialStatus('written_feedback')).toBe('closed');
    expect(initialStatus('signal_dismissed')).toBe('closed');
  });

  it('separates "blames the agent" from "exonerates the agent" WITHOUT treating them as complements', () => {
    expect(verdictSupportsCoaching('agent_at_fault')).toBe(true);
    for (const v of ['process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken', 'needs_more_info'] as const) {
      expect(verdictSupportsCoaching(v)).toBe(false);
    }
    // needs_more_info neither blames nor exonerates — treating it as either would be a fabrication about somebody's work
    expect(verdictExoneratesAgent('needs_more_info')).toBe(false);
    expect(verdictSupportsCoaching('needs_more_info')).toBe(false);
    expect(verdictExoneratesAgent('product_at_fault')).toBe(true);
    expect(verdictExoneratesAgent('agent_at_fault')).toBe(false);
  });
});

describe('assertReview — a verdict with no reasoning is an opinion nobody can check', () => {
  it('accepts a real verdict with a finding, trimmed', () => {
    const r = assertReview({ responseId: RESPONSE, verdict: 'process_at_fault', finding: '  the refund SOP has no step for a failed UPI mandate  ' });
    expect(r).toEqual({ responseId: RESPONSE, verdict: 'process_at_fault', finding: 'the refund SOP has no step for a failed UPI mandate' });
  });

  it('refuses an invented verdict', () => {
    expect(() => assertReview({ responseId: RESPONSE, verdict: 'agent_was_rude', finding: 'x'.repeat(20) }))
      .toThrow(/verdict must be one of/);
  });

  it('refuses a finding that says nothing', () => {
    expect(() => assertReview({ responseId: RESPONSE, verdict: 'agent_at_fault', finding: 'bad' })).toThrow(InvalidCoachingError);
    expect(() => assertReview({ responseId: RESPONSE, verdict: 'agent_at_fault', finding: ' '.repeat(40) })).toThrow(/at least 10 characters/);
    // exactly at the floor is fine
    expect(assertReview({ responseId: RESPONSE, verdict: 'agent_at_fault', finding: 'a'.repeat(MIN_FINDING) }).finding).toHaveLength(MIN_FINDING);
  });

  it('refuses a finding nobody would read', () => {
    expect(() => assertReview({ responseId: RESPONSE, verdict: 'agent_at_fault', finding: 'a'.repeat(4001) })).toThrow(/too long/);
  });
});

describe('assertCoaching — the record refuses to be written badly', () => {
  const base = () => ({
    kind: 'shadow_session', agentUserId: AGENT, tenantId: TENANT,
    rationale: 'Three consecutive P1 tickets closed without a first response being logged.',
    scheduledFor: inDays(3),
  });

  it('accepts a scheduled session and normalises the time to ISO', () => {
    const c = assertCoaching(base(), NOW);
    expect(c.kind).toBe('shadow_session');
    expect(c.status).toBe('scheduled');
    expect(c.scheduledFor).toBe(inDays(3));
    expect(c.signalNote).toBeNull();
    expect(c.csatResponseId).toBeNull();
  });

  it('REFUSES A RECORD WITH NO REASON — the rule that protects the person it is about', () => {
    expect(() => assertCoaching({ ...base(), rationale: 'slow' }, NOW)).toThrow(InvalidCoachingError);
    expect(() => assertCoaching({ ...base(), rationale: 'a'.repeat(MIN_RATIONALE - 1) }, NOW))
      .toThrow(/at least 20 characters/);
    expect(assertCoaching({ ...base(), rationale: 'a'.repeat(MIN_RATIONALE) }, NOW).rationale).toHaveLength(MIN_RATIONALE);
  });

  it('checks the reason BEFORE anything about dates — the ordering is deliberate', () => {
    // both are wrong; the message must be about the missing reason, not the missing date
    expect(() => assertCoaching({ ...base(), rationale: 'x', scheduledFor: null }, NOW)).toThrow(/rationale/);
  });

  it('refuses a session with no time, and a note that carries one', () => {
    expect(() => assertCoaching({ ...base(), scheduledFor: null }, NOW)).toThrow(/needs a date and time/);
    expect(() => assertCoaching({ ...base(), scheduledFor: 'not-a-date' }, NOW)).toThrow(/valid date/);
    expect(() => assertCoaching({ ...base(), kind: 'written_feedback', scheduledFor: inDays(2) }, NOW))
      .toThrow(/is not an event and cannot be scheduled/);
  });

  it('refuses a session in the PAST, and says how to record one that already happened', () => {
    // conflating "book a session" with "log a session that happened" would let somebody record meetings that never did
    expect(() => assertCoaching({ ...base(), scheduledFor: inDays(-1) }, NOW)).toThrow(/must be in the future/);
    expect(() => assertCoaching({ ...base(), scheduledFor: NOW.toISOString() }, NOW)).toThrow(/schedule it and then settle it/);
  });

  it('refuses a session booked so far out that it closes a signal without acting on it', () => {
    expect(() => assertCoaching({ ...base(), scheduledFor: inDays(MAX_SCHEDULE_DAYS + 1) }, NOW))
      .toThrow(/within 60 days/);
    expect(assertCoaching({ ...base(), scheduledFor: inDays(MAX_SCHEDULE_DAYS - 1) }, NOW).status).toBe('scheduled');
  });

  it('refuses a record about nobody, or on nobody\'s desk', () => {
    expect(() => assertCoaching({ ...base(), agentUserId: 'agent-7' }, NOW)).toThrow(/agentUserId must be a uuid/);
    expect(() => assertCoaching({ ...base(), tenantId: '' }, NOW)).toThrow(/tenantId must be a uuid/);
  });

  it('DROPS a signal reference that is not an id rather than storing garbage a later join cannot resolve', () => {
    const c = assertCoaching({ ...base(), csatResponseId: 'the-bad-one', csatReviewId: undefined }, NOW);
    expect(c.csatResponseId).toBeNull();
    const ok = assertCoaching({ ...base(), csatResponseId: RESPONSE, csatReviewId: REVIEW }, NOW);
    expect(ok.csatResponseId).toBe(RESPONSE);
    expect(ok.csatReviewId).toBe(REVIEW);
  });

  it('closes a dismissal on arrival and requires it to NAME what it dismisses', () => {
    const dismissal = {
      kind: 'signal_dismissed', agentUserId: AGENT, tenantId: TENANT,
      rationale: 'The farmer rated the delivery, not the support conversation. No desk action needed.',
      csatResponseId: RESPONSE,
    };
    const c = assertCoaching(dismissal, NOW);
    expect(c.status).toBe('closed');
    expect(c.scheduledFor).toBeNull();
    // dismissing nothing in particular is not a decision, and 0100's unique index has nothing to key on
    expect(() => assertCoaching({ ...dismissal, csatResponseId: undefined }, NOW))
      .toThrow(/must name the signal it dismisses/);
    // a note describing the signal is enough — not every signal is a rating
    expect(assertCoaching({ ...dismissal, csatResponseId: undefined, signalNote: 'p50 spike, week of 2026-08-03' }, NOW).status).toBe('closed');
  });

  it('accepts written feedback with no date and no signal', () => {
    const c = assertCoaching({
      kind: 'written_feedback', agentUserId: AGENT, tenantId: TENANT,
      rationale: 'Noting excellent handling of the Kolhapur cluster escalation over the weekend.',
    }, NOW);
    expect(c.status).toBe('closed');
    expect(c.scheduledFor).toBeNull();
  });

  it('refuses an invented kind', () => {
    expect(() => assertCoaching({ ...base(), kind: 'performance_improvement_plan' }, NOW)).toThrow(/kind must be one of/);
  });
});

describe('assertSettlement — a tick nobody can describe is not a record', () => {
  it('requires an outcome to mark a session HELD, and stamps the time', () => {
    const s = assertSettlement({ status: 'held', outcome: '  Reviewed six tickets; agent now logs first response before triaging.  ' }, NOW);
    expect(s.status).toBe('held');
    expect(s.outcome).toBe('Reviewed six tickets; agent now logs first response before triaging.');
    expect(s.heldAt).toBe(NOW.toISOString());
  });

  it('refuses HELD with a thin outcome or none at all', () => {
    expect(() => assertSettlement({ status: 'held' }, NOW)).toThrow(/needs an outcome/);
    expect(() => assertSettlement({ status: 'held', outcome: 'went ok' }, NOW)).toThrow(InvalidCoachingError);
    expect(assertSettlement({ status: 'held', outcome: 'a'.repeat(MIN_OUTCOME) }, NOW).outcome).toHaveLength(MIN_OUTCOME);
  });

  it('REFUSES an outcome on a session that did not happen — that would describe an imaginary conversation', () => {
    expect(() => assertSettlement({ status: 'missed', outcome: 'we covered the SLA basics' }, NOW))
      .toThrow(/has no outcome — it did not happen/);
    expect(() => assertSettlement({ status: 'cancelled', outcome: 'agent agreed to improve' }, NOW)).toThrow(InvalidCoachingError);
  });

  it('records a missed or cancelled session as a fact, with no outcome and no held time', () => {
    // recorded rather than deleted: a session nobody attended is worth knowing about
    for (const status of ['missed', 'cancelled'] as const) {
      expect(assertSettlement({ status }, NOW)).toEqual({ status, outcome: null, heldAt: null });
    }
  });

  it('refuses a status that is not an ending', () => {
    expect(() => assertSettlement({ status: 'scheduled' }, NOW)).toThrow(/status must be one of/);
    expect(() => assertSettlement({ status: 'closed' }, NOW)).toThrow(/status must be one of/);
  });
});

describe('reading helpers', () => {
  it('splits ratings into judged and unjudged — the backlog, not the raw low-score count', () => {
    const rows = [{ reviewCount: 0 }, { reviewCount: 2 }, { reviewCount: 0 }];
    const out = splitByReviewed(rows);
    expect(out.awaiting).toHaveLength(2);
    expect(out.reviewed).toHaveLength(1);
  });

  it('returns NULL shares when nothing has been reviewed, never a row of zeroes', () => {
    // "no low score has been reviewed" and "every review concluded 0%" are different statements about a desk
    expect(verdictShares([])).toBeNull();
    expect(verdictShares([{ verdict: 'agent_at_fault', n: 0 }])).toBeNull();
    const shares = verdictShares([
      { verdict: 'agent_at_fault', n: 1 },
      { verdict: 'product_at_fault', n: 3 },
    ]);
    expect(shares).toEqual([
      { verdict: 'agent_at_fault', n: 1, shareBps: 2500 },
      { verdict: 'product_at_fault', n: 3, shareBps: 7500 },
    ]);
    // basis points sum to 10000 on a clean split
    expect(shares!.reduce((a, s) => a + s.shareBps, 0)).toBe(10_000);
  });

  it('treats a rating as settled if it was reviewed OR deliberately dismissed', () => {
    // a lead must not be shown a rating as "needs review" when a colleague acted on it ten minutes ago
    expect(signalIsSettled({ reviewCount: 1 })).toBe(true);
    expect(signalIsSettled({ reviewCount: 0, latestVerdict: 'rating_mistaken' })).toBe(true);
    expect(signalIsSettled({ reviewCount: 0, latestVerdict: null })).toBe(false);
    expect(signalIsSettled({ reviewCount: 0 })).toBe(false);
  });
});
