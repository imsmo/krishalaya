// apps/web-admin/src/test/admin2c-review.spec.ts · PC-56 ADMIN-2c, console side.
//
// The coaching RULES live in admin-api and are not duplicated here (same split as ADMIN-2b's policy). What is asserted:
// that the forms turn a bag of strings into what the server accepts, and that the READING helpers refuse to overstate
// what the data supports — an average over nine ratings, a derived timestamp printed as a recorded one, a rating with no
// comment reported as "no feedback".
import {
  CSAT_VERDICTS, COACHING_KINDS, SETTLE_STATUSES, isEventKind, verdictSupportsCoaching,
  buildReview, buildCoaching, buildSettlement,
  csatSample, withVerbatim, estimatedCount, ratedAtLabel, isSettled, verdictShares,
  splitCoaching, overdueSettlement,
  CSAT_MIN_SAMPLE, MIN_RATIONALE, MAX_SCHEDULE_DAYS,
  type CsatRow, type CoachingRow,
} from '../features/support/review';
import {
  SUPPORT_REPORTS, carriesFreeText, acceptsScoreFilter, buildSupportExport,
  supportExportFileName, MAX_EXPORT_ROWS, DEFAULT_EXPORT_ROWS,
} from '../features/support/export';

const AGENT = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const RESPONSE = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-06T09:00:00.000Z');
const bag = (o: Record<string, string>) => (n: string) => o[n] ?? '';

describe('vocabularies mirror the server', () => {
  it('lists the same verdicts, kinds and settlements', () => {
    expect([...CSAT_VERDICTS]).toEqual([
      'agent_at_fault', 'process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken', 'needs_more_info']);
    expect([...COACHING_KINDS]).toEqual(['shadow_session', 'review_call', 'written_feedback', 'signal_dismissed']);
    expect([...SETTLE_STATUSES]).toEqual(['held', 'missed', 'cancelled']);
    expect(isEventKind('shadow_session')).toBe(true);
    expect(isEventKind('signal_dismissed')).toBe(false);
    // only one verdict makes coaching coherent — the console uses this to omit the form, not to disable a button
    expect(verdictSupportsCoaching('agent_at_fault')).toBe(true);
    expect(verdictSupportsCoaching('product_at_fault')).toBe(false);
    expect(verdictSupportsCoaching('needs_more_info')).toBe(false);
  });
});

describe('buildReview', () => {
  it('accepts a verdict with a trimmed finding', () => {
    const r = buildReview(bag({ verdict: 'agent_at_fault', finding: '  closed without answering the question  ' }));
    expect(r).toEqual({ ok: true, value: { verdict: 'agent_at_fault', finding: 'closed without answering the question' } });
  });

  it('refuses an unlisted verdict and an empty finding', () => {
    expect(buildReview(bag({ verdict: 'was_rude', finding: 'x'.repeat(20) }))).toEqual({ ok: false, error: 'verdict' });
    expect(buildReview(bag({ verdict: 'agent_at_fault', finding: 'slow' }))).toEqual({ ok: false, error: 'finding' });
    expect(buildReview(bag({ verdict: 'agent_at_fault', finding: '   ' }))).toEqual({ ok: false, error: 'finding' });
    expect(buildReview(bag({ verdict: 'agent_at_fault', finding: 'a'.repeat(4001) }))).toEqual({ ok: false, error: 'findingLong' });
  });
});

describe('buildCoaching', () => {
  const base = () => ({
    kind: 'shadow_session', agentUserId: AGENT, tenantId: TENANT,
    rationale: 'Three consecutive P1 tickets closed with no first response logged.',
    scheduledFor: '2026-08-09T14:00',
  });

  it('normalises a datetime-local value to an instant', () => {
    // THE BUG THIS PREVENTS: a datetime-local input yields a LOCAL wall-clock string with no zone. Sent raw, the server
    // reads "14:00" as UTC and books the session five and a half hours from where the operator meant — which surfaces as
    // somebody not turning up.
    const r = buildCoaching(bag(base()), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scheduledFor).toBe(new Date('2026-08-09T14:00:00').toISOString());
    expect(r.value.scheduledFor).toMatch(/Z$/);
  });

  it('accepts a full ISO value unchanged in meaning', () => {
    const r = buildCoaching(bag({ ...base(), scheduledFor: '2026-08-09T14:00:00.000Z' }), NOW);
    expect(r.ok && r.value.scheduledFor).toBe('2026-08-09T14:00:00.000Z');
  });

  it('refuses a record with no reason', () => {
    expect(buildCoaching(bag({ ...base(), rationale: 'slow' }), NOW)).toEqual({ ok: false, error: 'rationale' });
    expect(buildCoaching(bag({ ...base(), rationale: 'a'.repeat(MIN_RATIONALE - 1) }), NOW)).toEqual({ ok: false, error: 'rationale' });
    expect(buildCoaching(bag({ ...base(), rationale: 'a'.repeat(MIN_RATIONALE) }), NOW).ok).toBe(true);
  });

  it('refuses a record about nobody', () => {
    expect(buildCoaching(bag({ ...base(), agentUserId: 'pooja' }), NOW)).toEqual({ ok: false, error: 'agent' });
    expect(buildCoaching(bag({ ...base(), tenantId: '' }), NOW)).toEqual({ ok: false, error: 'tenant' });
  });

  it('handles the schedule window: required, future, and within 60 days', () => {
    expect(buildCoaching(bag({ ...base(), scheduledFor: '' }), NOW)).toEqual({ ok: false, error: 'scheduleMissing' });
    expect(buildCoaching(bag({ ...base(), scheduledFor: 'soon' }), NOW)).toEqual({ ok: false, error: 'scheduleInvalid' });
    expect(buildCoaching(bag({ ...base(), scheduledFor: '2026-08-05T14:00:00.000Z' }), NOW)).toEqual({ ok: false, error: 'schedulePast' });
    const far = new Date(NOW.getTime() + (MAX_SCHEDULE_DAYS + 1) * 86_400_000).toISOString();
    expect(buildCoaching(bag({ ...base(), scheduledFor: far }), NOW)).toEqual({ ok: false, error: 'scheduleFar' });
  });

  it('refuses a date on a kind that is not an event, and omits it when absent', () => {
    expect(buildCoaching(bag({ ...base(), kind: 'written_feedback' }), NOW)).toEqual({ ok: false, error: 'scheduleNotEvent' });
    const note = buildCoaching(bag({ ...base(), kind: 'written_feedback', scheduledFor: '' }), NOW);
    expect(note.ok).toBe(true);
    if (note.ok) expect('scheduledFor' in note.value).toBe(false);
  });

  it('requires a dismissal to NAME what it dismisses', () => {
    const dismissal = {
      kind: 'signal_dismissed', agentUserId: AGENT, tenantId: TENANT, scheduledFor: '',
      rationale: 'The farmer rated the delivery, not the support conversation.',
    };
    expect(buildCoaching(bag(dismissal), NOW)).toEqual({ ok: false, error: 'dismissalSignal' });
    expect(buildCoaching(bag({ ...dismissal, csatResponseId: RESPONSE }), NOW).ok).toBe(true);
    expect(buildCoaching(bag({ ...dismissal, signalNote: 'p50 spike week of 2026-08-03' }), NOW).ok).toBe(true);
  });

  it('refuses a malformed signal reference rather than sending a dangling id', () => {
    expect(buildCoaching(bag({ ...base(), csatResponseId: 'the-bad-one' }), NOW)).toEqual({ ok: false, error: 'signalRef' });
    expect(buildCoaching(bag({ ...base(), csatReviewId: '123' }), NOW)).toEqual({ ok: false, error: 'signalRef' });
  });

  it('omits an empty signal note rather than sending an empty string', () => {
    const r = buildCoaching(bag({ ...base(), signalNote: '   ' }), NOW);
    expect(r.ok && 'signalNote' in r.value).toBe(false);
  });
});

describe('buildSettlement', () => {
  it('requires an outcome for held and refuses one otherwise', () => {
    expect(buildSettlement(bag({ status: 'held', outcome: 'reviewed six tickets together' })))
      .toEqual({ ok: true, value: { status: 'held', outcome: 'reviewed six tickets together' } });
    expect(buildSettlement(bag({ status: 'held', outcome: 'ok' }))).toEqual({ ok: false, error: 'outcome' });
    expect(buildSettlement(bag({ status: 'held' }))).toEqual({ ok: false, error: 'outcome' });
    // an outcome on a session that never happened describes an imaginary conversation
    expect(buildSettlement(bag({ status: 'missed', outcome: 'we covered SLAs' }))).toEqual({ ok: false, error: 'outcomeNotHeld' });
    expect(buildSettlement(bag({ status: 'cancelled' }))).toEqual({ ok: true, value: { status: 'cancelled' } });
  });

  it('refuses a status that is not an ending', () => {
    expect(buildSettlement(bag({ status: 'scheduled' }))).toEqual({ ok: false, error: 'status' });
  });
});

describe('reading helpers refuse to overstate the data', () => {
  const row = (over: Partial<CsatRow> = {}): CsatRow =>
    ({ ticketId: 't', score: 4, ratedAt: '2026-08-05T00:00:00.000Z', ...over });

  it('gives NO average below the sample floor — a number on a screen gets quoted, footnotes do not', () => {
    const thin = Array.from({ length: CSAT_MIN_SAMPLE - 1 }, () => row({ score: 1 }));
    const s = csatSample(thin);
    expect(s.n).toBe(CSAT_MIN_SAMPLE - 1);
    expect(s.tooFew).toBe(true);
    expect(s.avg).toBeNull();
    const enough = Array.from({ length: CSAT_MIN_SAMPLE }, (_, i) => row({ score: i < 5 ? 1 : 5 }));
    const s2 = csatSample(enough);
    expect(s2.tooFew).toBe(false);
    expect(s2.avg).toBe(3);
  });

  it('reports an empty window as unknown, not as zero', () => {
    // nobody rated is not "rated zero"
    expect(csatSample([])).toEqual({ n: 0, avg: null, tooFew: true, withComments: 0, verbatimShareBps: null });
  });

  it('counts only rows that actually carry words', () => {
    const rows = [row({ comment: 'पैसा नहीं आया' }), row({ comment: '   ' }), row({ comment: null }), row()];
    expect(withVerbatim(rows)).toHaveLength(1);
    expect(csatSample(rows).withComments).toBe(1);
    expect(csatSample(rows).verbatimShareBps).toBe(2500);
  });

  it('returns a DISCRIMINATED timestamp so an estimate cannot be printed as a fact', () => {
    expect(ratedAtLabel(row())).toEqual({ at: '2026-08-05T00:00:00.000Z', estimated: false });
    expect(ratedAtLabel(row({ ratedAtIsEstimated: true }))).toEqual({ at: '2026-08-05T00:00:00.000Z', estimated: true });
    expect(estimatedCount([row(), row({ ratedAtIsEstimated: true }), row({ ratedAtIsEstimated: true })])).toBe(2);
  });

  it('treats a rating as settled if judged OR deliberately dismissed', () => {
    expect(isSettled({ reviewCount: 1 })).toBe(true);
    expect(isSettled({ reviewCount: 0, latestVerdict: 'rating_mistaken' })).toBe(true);
    expect(isSettled({ reviewCount: 0, latestVerdict: null })).toBe(false);
  });

  it('gives null verdict shares when nothing was reviewed, and percentages when something was', () => {
    expect(verdictShares([])).toBeNull();
    expect(verdictShares([{ verdict: 'agent_at_fault', n: 0 }])).toBeNull();
    expect(verdictShares([{ verdict: 'agent_at_fault', n: 1 }, { verdict: 'product_at_fault', n: 3 }]))
      .toEqual([{ verdict: 'agent_at_fault', n: 1, pct: 25 }, { verdict: 'product_at_fault', n: 3, pct: 75 }]);
  });
});

describe('the coaching ledger', () => {
  const c = (over: Partial<CoachingRow> = {}): CoachingRow => ({
    id: 'c1', tenantId: TENANT, agentUserId: AGENT, authorAdminId: 'adm',
    kind: 'shadow_session', status: 'scheduled', rationale: 'x'.repeat(20),
    createdAt: '2026-08-01T00:00:00.000Z', ...over,
  });

  it('separates interventions from recorded decisions NOT to intervene', () => {
    // showing only the first misrepresents a lead as somebody who acts on everything
    const rows = [c(), c({ id: 'c2', kind: 'signal_dismissed', status: 'closed' }), c({ id: 'c3', kind: 'written_feedback', status: 'closed' })];
    const out = splitCoaching(rows);
    expect(out.actions.map((r) => r.id)).toEqual(['c1', 'c3']);
    expect(out.dismissals.map((r) => r.id)).toEqual(['c2']);
  });

  it('surfaces sessions past their time with no account of what happened, soonest first', () => {
    const rows = [
      c({ id: 'later', scheduledFor: '2026-08-05T10:00:00.000Z' }),
      c({ id: 'earlier', scheduledFor: '2026-08-02T10:00:00.000Z' }),
      c({ id: 'future', scheduledFor: '2026-08-20T10:00:00.000Z' }),
      c({ id: 'done', scheduledFor: '2026-08-01T10:00:00.000Z', status: 'held', outcome: 'y'.repeat(12) }),
      c({ id: 'note', kind: 'written_feedback', status: 'closed' }),
    ];
    const out = overdueSettlement(rows, NOW);
    // a session in the future is not overdue; a settled one is not outstanding; a note was never an event
    expect(out.map((r) => r.id)).toEqual(['earlier', 'later']);
  });
});

// ---------------------------------------------------------------------------
// The export form
// ---------------------------------------------------------------------------
describe('the support export form', () => {
  const win = { from: '2026-07-01', to: '2026-08-01' };

  it('knows which reports carry free text and which accept a score filter', () => {
    expect([...SUPPORT_REPORTS]).toEqual(['tickets', 'sla_breaches', 'csat', 'csat_verbatims', 'csat_reviews']);
    expect(carriesFreeText('csat_verbatims')).toBe(true);
    expect(carriesFreeText('csat_reviews')).toBe(true);
    expect(carriesFreeText('tickets')).toBe(false);
    expect(acceptsScoreFilter('csat')).toBe(true);
    expect(acceptsScoreFilter('tickets')).toBe(false);
  });

  it('sends the window as INSTANTS, not bare dates', () => {
    // a bare date would be read as midnight UTC — five and a half hours off the day an Indian operator meant
    const r = buildSupportExport({ report: 'csat', ...win });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.from).toBe('2026-07-01T00:00:00.000Z');
    expect(r.value.to).toBe('2026-08-01T00:00:00.000Z');
    expect(r.value.limit).toBe(DEFAULT_EXPORT_ROWS);
  });

  it('requires a coherent window', () => {
    expect(buildSupportExport({ report: 'csat', from: '', to: '' })).toEqual({ ok: false, error: 'window' });
    expect(buildSupportExport({ report: 'csat', from: '01-07-2026', to: '2026-08-01' })).toEqual({ ok: false, error: 'window' });
    expect(buildSupportExport({ report: 'csat', from: '2026-08-01', to: '2026-07-01' })).toEqual({ ok: false, error: 'window' });
    expect(buildSupportExport({ report: 'csat', from: '2026-08-01', to: '2026-08-01' })).toEqual({ ok: false, error: 'window' });
  });

  it('refuses an unknown report', () => {
    expect(buildSupportExport({ report: 'coaching', ...win })).toEqual({ ok: false, error: 'report' });
    expect(buildSupportExport({ report: '', ...win })).toEqual({ ok: false, error: 'report' });
  });

  it('CLAMPS an over-large limit to the maximum, not to the default', () => {
    // ADMIN-1d shipped exactly this bug: a \\d{1,4} regex could not match "99999", so an over-max limit silently became
    // the DEFAULT (1000) rather than the maximum (5000) — a quietly smaller export that looks complete
    expect(buildSupportExport({ report: 'csat', ...win, limit: '99999' })).toMatchObject({ ok: true, value: { limit: MAX_EXPORT_ROWS } });
    expect(buildSupportExport({ report: 'csat', ...win, limit: '4999' })).toMatchObject({ ok: true, value: { limit: 4999 } });
    expect(buildSupportExport({ report: 'csat', ...win, limit: '0' })).toMatchObject({ ok: true, value: { limit: 1 } });
    // a page size is a request about the transfer, but a non-numeric one is a typo and is refused
    expect(buildSupportExport({ report: 'csat', ...win, limit: 'all' })).toEqual({ ok: false, error: 'limit' });
  });

  it('DROPS a score filter on a report that cannot use it rather than applying it silently', () => {
    const r = buildSupportExport({ report: 'tickets', ...win, maxScore: '2' });
    expect(r.ok && 'maxScore' in r.value).toBe(false);
    const scored = buildSupportExport({ report: 'csat', ...win, maxScore: '2' });
    expect(scored.ok && scored.value.maxScore).toBe(2);
    expect(buildSupportExport({ report: 'csat', ...win, maxScore: '9' })).toEqual({ ok: false, error: 'maxScore' });
  });

  it('refuses a tenant filter that is not an id', () => {
    expect(buildSupportExport({ report: 'csat', ...win, tenantId: 'kolhapur-fpo' })).toEqual({ ok: false, error: 'tenant' });
    expect(buildSupportExport({ report: 'csat', ...win, tenantId: TENANT })).toMatchObject({ ok: true, value: { tenantId: TENANT } });
  });

  it('builds the same filename the server builds', () => {
    // a file traced from the console and a file traced from the server must agree
    expect(supportExportFileName('csat_verbatims', '9f1c2b7a-1111-4222-8333-444455556666', '2026-08-06T11:22:33.000Z'))
      .toBe('krishalaya-support-csat_verbatims-2026-08-06-9f1c2b7a.csv');
  });
});
