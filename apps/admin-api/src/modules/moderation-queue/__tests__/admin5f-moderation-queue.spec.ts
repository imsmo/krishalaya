// PC-56 ADMIN-5f · the moderation queue. Pure domain only.
// The central claims: "hold fast, remove slow" is structural rather than advisory, and the value that gates the
// removal maker-checker is computed exactly and never understated.
import {
  HOLD_ACTIONS, HOLD_SOURCES, REMOVAL_CHECKER_THRESHOLD_MINOR, HOLD_SLA_HOURS, REASON_MIN,
  HOLDABLE_FROM, isHoldable, valueAtStakeMinor, removalNeedsChecker, holdSla, holdDeadline,
  assertReason, assertHoldable, assertReleasable, removeState, assertRemovable, noticesFor, assertLanguage,
  APPEAL_PATH, LISTING_STATE_SOURCE,
} from '../domain/listing-hold';
import {
  SUBJECT_TYPES, SAFETY_DESK_REASONS, REPORT_SLA_HOURS, PLATFORM_OUTCOMES, OUTCOME_MIN,
  isSafetyDeskReason, priorityOf, triageOrder, reportSla, buildDecision, assertDecidable, handlerOf,
  reportsOnSubject, type ReportRow,
} from '../domain/report-triage';
import { InvalidModerationOrderError, ModerationNotApprovableError, InvalidReportDecisionError } from '../domain/moderation-queue.errors';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';

const HOUR = 3_600_000;
const NOW = new Date('2026-08-07T14:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

const report = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 'r1', tenantId: 't1', subjectType: 'listing', subjectId: 's1', reasonCode: 'fake_review',
  status: 'open', actionTaken: null, handledBy: null, handledByAdminId: null, handledAt: null,
  createdAt: ago(1), reportsOnSubject: 1, ...over,
});

/* ================================================================================================ */
describe('ADMIN-5f · VALUE AT STAKE — the figure that gates the maker-checker', () => {
  it('computes price × quantity exactly, in minor units', () => {
    // W090's own row: cumin 18 qtl at ₹24,900/qtl = ₹4,48,200.
    expect(valueAtStakeMinor(2_490_000n, '18')).toBe(44_820_000n);
    expect(valueAtStakeMinor(2_490_000n, '18.000')).toBe(44_820_000n);
  });
  it('handles fractional quantities to three decimals', () => {
    expect(valueAtStakeMinor(1_000_00n, '1.5')).toBe(150_000n);
    expect(valueAtStakeMinor(100n, '0.001')).toBe(0n);       // ₹1.00 × 0.001 = 0.1 paisa → rounds to 0
    expect(valueAtStakeMinor(10_000n, '0.001')).toBe(10n);
  });
  it('ROUNDS HALF UP, so the value is never understated', () => {
    // The direction matters: this number decides whether a second signature is required, and rounding down would
    // make the cheaper path the accidental default at exactly the threshold.
    expect(valueAtStakeMinor(1n, '0.500')).toBe(1n);         // 0.5 → 1, not 0
    expect(valueAtStakeMinor(1n, '0.499')).toBe(0n);
    expect(valueAtStakeMinor(3n, '0.500')).toBe(2n);         // 1.5 → 2
  });
  it('is EXACT beyond float precision', () => {
    // A ₹90-crore-plus consignment must not lose its last paisa. Number() would.
        expect(valueAtStakeMinor(9_007_199_254_740_993n, '1')).toBe(9_007_199_254_740_993n);
    expect(valueAtStakeMinor(9_007_199_254_740_993n, '2')).toBe(18_014_398_509_481_986n);
  });
  it('REFUSES an unreadable quantity rather than guessing', () => {
    expect(() => valueAtStakeMinor(100n, 'lots')).toThrow(InvalidModerationOrderError);
    expect(() => valueAtStakeMinor(100n, '')).toThrow(InvalidModerationOrderError);
    expect(() => valueAtStakeMinor(100n, '1.2345')).toThrow(InvalidModerationOrderError);   // more than 3 decimals
    expect(() => valueAtStakeMinor(100n, '-1')).toThrow(InvalidModerationOrderError);
    expect(() => valueAtStakeMinor(-1n, '1')).toThrow(InvalidModerationOrderError);
  });
  it('the threshold is AT ₹1,00,000, not merely above it', () => {
    expect(REMOVAL_CHECKER_THRESHOLD_MINOR).toBe(10_000_000n);
    expect(removalNeedsChecker(9_999_999n)).toBe(false);
    expect(removalNeedsChecker(10_000_000n)).toBe(true);      // exactly ₹1,00,000 — the amount somebody would choose
    expect(removalNeedsChecker(44_820_000n)).toBe(true);
  });
});

describe('ADMIN-5f · HOLD FAST — one operator, immediate', () => {
  it('only a published or paused listing can be held', () => {
    expect([...HOLDABLE_FROM]).toEqual(['published', 'paused']);
    expect(isHoldable('published')).toBe(true);
    expect(isHoldable('paused')).toBe(true);
    expect(isHoldable('archived')).toBe(false);
    expect(isHoldable('held')).toBe(false);
    expect(() => assertHoldable('published', null)).not.toThrow();
    expect(() => assertHoldable('archived', null)).toThrow(InvalidModerationOrderError);
    expect(() => assertHoldable('draft', null)).toThrow(InvalidModerationOrderError);
  });
  it('REFUSES to re-hold an already-held listing — the clock must not restart', () => {
    // An SLA that restarts every time somebody looks at a case is not a deadline.
    expect(() => assertHoldable('held', ago(2))).toThrow(InvalidModerationOrderError);
    expect(() => assertHoldable('published', ago(2))).toThrow(InvalidModerationOrderError);
  });
  it('names the source of truth for the transitions it mirrors', () => {
    expect(LISTING_STATE_SOURCE).toContain('listing.state.ts');
    expect([...HOLD_ACTIONS]).toEqual(['hold', 'release', 'remove']);
    expect([...HOLD_SOURCES]).toEqual(['fraud_flag', 'reported', 'regulated_category', 'spot_audit']);
  });
  it('release refuses a listing that is not held', () => {
    expect(() => assertReleasable(null)).toThrow(InvalidModerationOrderError);
    expect(() => assertReleasable(ago(1))).not.toThrow();
  });
  it('the reason floor holds — it is sent to the farmer about their own produce', () => {
    expect(REASON_MIN).toBe(20);
    expect(() => assertReason('spam')).toThrow(InvalidModerationOrderError);
    expect(() => assertReason('policy violation')).toThrow(InvalidModerationOrderError);
    expect(() => assertReason(null)).toThrow(InvalidModerationOrderError);
    expect(() => assertReason('x'.repeat(2001))).toThrow(InvalidModerationOrderError);
    expect(assertReason('  price 4.2x above the mandi band  ')).toBe('price 4.2x above the mandi band');
  });
});

describe('ADMIN-5f · REMOVE SLOW — and only from a hold', () => {
  it('REFUSES a removal straight from published', () => {
    // Structural "remove slow": to remove, an operator must first hold, which means the seller has been told and had
    // the chance to respond. A remove button on a live listing ends a sale with no interval at all.
    expect(removeState(null, 1_000n, null)).toEqual({ ok: false, reason: 'not_held' });
    expect(() => assertRemovable({ alreadyHeldAt: null, valueMinor: 1_000n, actor: 'op-b', heldBy: 'op-a', checker: null }))
      .toThrow(InvalidModerationOrderError);
  });
  it('a LOW-value removal is one operator', () => {
    expect(removeState(ago(1), 9_999_999n, null)).toEqual({ ok: true, needsChecker: false });
    expect(() => assertRemovable({ alreadyHeldAt: ago(1), valueMinor: 9_999_999n, actor: 'op-a', heldBy: 'op-a', checker: null }))
      .not.toThrow();
  });
  it('a HIGH-value removal needs a checker, and REFUSES the operator who held it', () => {
    // THE NINTH MAKER-CHECKER SITE.
    expect(removeState(ago(1), 44_820_000n, null)).toMatchObject({ ok: false, reason: 'needs_checker' });
    expect(() => assertRemovable({ alreadyHeldAt: ago(1), valueMinor: 44_820_000n, actor: 'op-a', heldBy: 'op-a', checker: 'op-a' }))
      .toThrow(SecondPersonRequiredError);
    expect(() => assertRemovable({ alreadyHeldAt: ago(1), valueMinor: 44_820_000n, actor: 'op-b', heldBy: 'op-a', checker: 'op-b' }))
      .not.toThrow();
  });
  it('a high-value removal with NO checker at all is refused as a state conflict', () => {
    expect(() => assertRemovable({ alreadyHeldAt: ago(1), valueMinor: 44_820_000n, actor: 'op-b', heldBy: 'op-a', checker: null }))
      .toThrow(ModerationNotApprovableError);
  });
  it('an UNKNOWN holder does not create a permanent dead end', () => {
    expect(() => assertRemovable({ alreadyHeldAt: ago(1), valueMinor: 44_820_000n, actor: 'op-b', heldBy: null, checker: 'op-b' }))
      .not.toThrow();
  });
});

describe('ADMIN-5f · the 4-hour hold SLA', () => {
  it('states the window and computes the deadline', () => {
    expect(HOLD_SLA_HOURS).toBe(4);
    expect(holdDeadline(NOW).toISOString()).toBe(ahead(4));
  });
  it('pages the lead with an hour left, and breaches past the deadline', () => {
    expect(holdSla(ahead(3), NOW)).toEqual({ kind: 'ok', hoursLeft: 3 });
    expect(holdSla(ahead(1), NOW)).toEqual({ kind: 'page_lead', hoursLeft: 1 });
    expect(holdSla(ahead(0.5), NOW)).toEqual({ kind: 'page_lead', hoursLeft: 0.5 });
    expect(holdSla(ago(1), NOW)).toEqual({ kind: 'breached', hoursOver: 1 });
  });
  it('UNMEASURED is not ok — a hold with no clock cannot be shown to be inside its SLA', () => {
    expect(holdSla(null, NOW)).toEqual({ kind: 'unmeasured' });
    expect(holdSla('not-a-date', NOW)).toEqual({ kind: 'unmeasured' });
  });
});

describe('ADMIN-5f · who gets told, and in what language', () => {
  it('a HOLD tells the seller only — a hold is not an outcome yet', () => {
    expect(noticesFor('hold', true)).toEqual(['subject_owner']);
    expect(noticesFor('hold', false)).toEqual(['subject_owner']);
  });
  it('a RELEASE and a REMOVE tell the reporter too, when there is one', () => {
    // W092: "Reporters hear back on every report — even dismissals get a respectful explanation."
    expect(noticesFor('release', true)).toEqual(['subject_owner', 'reporter']);
    expect(noticesFor('remove', true)).toEqual(['subject_owner', 'reporter']);
    // A system-filed report has no reporter; there is nobody to tell.
    expect(noticesFor('remove', false)).toEqual(['subject_owner']);
  });
  it('a RELEASE still tells the seller — the platform that stopped the sale says it is over', () => {
    expect(noticesFor('release', false)).toEqual(['subject_owner']);
  });
  it('REFUSES a language the platform does not speak', () => {
    // A notice composed in one language and delivered under another template is a message the farmer cannot read
    // wearing a label saying they can.
    expect(() => assertLanguage('fr', ['en', 'hi', 'gu'])).toThrow(InvalidModerationOrderError);
    expect(() => assertLanguage('', ['en'])).toThrow(InvalidModerationOrderError);
    expect(() => assertLanguage(null, ['en'])).toThrow(InvalidModerationOrderError);
    expect(assertLanguage(' gu ', ['en', 'gu'])).toBe('gu');
  });
  it('the appeal path travels with every notice', () => {
    expect(APPEAL_PATH).toBe('/help/appeal');
  });
});

/* ================================================================================================ */
describe('ADMIN-5f · W092 triage — safety before SLA', () => {
  it('routes harassment to the safety desk by CODE, not by keyword', () => {
    // A keyword match on a translated label stops working in the second language.
    expect(isSafetyDeskReason('harassment')).toBe(true);
    expect(isSafetyDeskReason('inappropriate')).toBe(true);
    expect(isSafetyDeskReason('fake_review')).toBe(false);
    expect(isSafetyDeskReason(null)).toBe(false);
    expect([...SAFETY_DESK_REASONS]).toEqual(['harassment', 'inappropriate']);
  });
  it('a FRESH safety report outranks a BREACHED ordinary one', () => {
    // A breached SLA on a fake-review report is a process failure; a fresh harassment report is a person being
    // harassed right now. Ordering the breach first would optimise the metric at the expense of the purpose.
    const rows = [report({ id: 'old', reasonCode: 'fake_review', createdAt: ago(9) }), report({ id: 'safety', reasonCode: 'harassment', createdAt: ago(0.1) })];
    expect(triageOrder(rows, NOW).map((r) => r.id)).toEqual(['safety', 'old']);
  });
  it('within a band, OLDEST first — the opposite of every other list here, because age is harm', () => {
    const rows = [report({ id: 'b', createdAt: ago(1) }), report({ id: 'a', createdAt: ago(3) })];
    expect(triageOrder(rows, NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('classifies priority', () => {
    expect(priorityOf(report({ reasonCode: 'harassment' }), NOW)).toBe('safety_desk');
    expect(priorityOf(report({ createdAt: ago(9) }), NOW)).toBe('sla_breached');
    expect(priorityOf(report({ createdAt: ago(1) }), NOW)).toBe('normal');
    // An unparseable timestamp is NOT treated as breached — it is unknown, and guessing would inflate the breach count.
    expect(priorityOf(report({ createdAt: 'nope' }), NOW)).toBe('normal');
  });
  it('the report SLA breaches past four hours and is unmeasured without a timestamp', () => {
    expect(REPORT_SLA_HOURS).toBe(4);
    expect(reportSla(ago(5), NOW)).toEqual({ kind: 'breached', overHours: 1 });
    expect(reportSla(ago(1), NOW)).toEqual({ kind: 'ok', ageHours: 1 });
    expect(reportSla(null, NOW)).toEqual({ kind: 'unmeasured' });
    expect(reportSla('nope', NOW)).toEqual({ kind: 'unmeasured' });
    // A report timestamped in the FUTURE is unmeasured rather than comfortably fresh.
    expect(reportSla(ahead(2), NOW)).toEqual({ kind: 'unmeasured' });
  });
  it('REPORTS ON SUBJECT is unknown when unreadable, never 1', () => {
    // "This is the only report" is the reading that makes an operator dismiss something eighteen people flagged.
    expect(reportsOnSubject(null)).toEqual({ known: false, count: 0 });
    expect(reportsOnSubject(Number.NaN)).toEqual({ known: false, count: 0 });
    expect(reportsOnSubject(-1)).toEqual({ known: false, count: 0 });
    expect(reportsOnSubject(0)).toEqual({ known: true, count: 0 });
    expect(reportsOnSubject(18)).toEqual({ known: true, count: 18 });
  });
});

describe('ADMIN-5f · the platform decision on a report', () => {
  it('an ACTIONED report must name what was done', () => {
    // Letting `actioned` carry `none` produces a report the queue calls handled with nothing recorded as done — the
    // very defect this wave exists to fix, reintroduced one level up.
    expect(() => buildDecision({ status: 'actioned', outcome: 'none', outcomeNote: 'x'.repeat(30) })).toThrow(InvalidReportDecisionError);
    expect(() => buildDecision({ status: 'actioned', outcomeNote: 'x'.repeat(30) })).toThrow(InvalidReportDecisionError);
    expect(buildDecision({ status: 'actioned', outcome: 'removed', outcomeNote: 'listing removed for fake photos' }))
      .toEqual({ status: 'actioned', outcome: 'removed', outcomeNote: 'listing removed for fake photos' });
  });
  it('a DISMISSAL still needs its explanation', () => {
    expect(OUTCOME_MIN).toBe(20);
    expect(() => buildDecision({ status: 'dismissed', outcomeNote: 'no action' })).toThrow(InvalidReportDecisionError);
    expect(buildDecision({ status: 'dismissed', outcomeNote: 'the photos match the graded sample' }))
      .toEqual({ status: 'dismissed', outcome: 'none', outcomeNote: 'the photos match the graded sample' });
  });
  it('refuses an unknown status or outcome', () => {
    expect(() => buildDecision({ status: 'escalated', outcomeNote: 'x'.repeat(30) })).toThrow(InvalidReportDecisionError);
    expect(() => buildDecision({ status: 'actioned', outcome: 'suspended', outcomeNote: 'x'.repeat(30) })).toThrow(InvalidReportDecisionError);
    // `suspended` is deliberately absent: suspending an account is a band change on the risk plane, with its own
    // permission and its own second-person rule. Offering it here would be a second door with weaker controls.
    expect([...PLATFORM_OUTCOMES]).toEqual(['hidden', 'removed', 'warned', 'none']);
    expect([...SUBJECT_TYPES]).toEqual(['listing', 'review', 'message', 'user']);
  });
  it('BOTH outcomes are terminal, and the refusal names who decided', () => {
    expect(() => assertDecidable(report({ status: 'actioned', handledByAdminId: 'op-a' }))).toThrow(/platform operator/);
    expect(() => assertDecidable(report({ status: 'dismissed', handledBy: 'u1' }))).toThrow(/tenant/);
    expect(() => assertDecidable(report())).not.toThrow();
  });
  it('reports WHICH realm handled it, and reports NEITHER honestly', () => {
    expect(handlerOf(report())).toBe('open');
    expect(handlerOf(report({ status: 'actioned', handledByAdminId: 'op-a' }))).toBe('platform');
    expect(handlerOf(report({ status: 'actioned', handledBy: 'u1' }))).toBe('tenant');
    // Reachable only on rows predating ck_modreport_one_handler. Showing it as platform-handled because this console
    // happens to be the platform would be inventing the fact.
    expect(handlerOf(report({ status: 'actioned' }))).toBe('neither');
  });
});
