// PC-56 ADMIN-4b · the oversight console helpers. Pure, framework-free.
// NOTHING here masks anything — the mask is server-side. These guard what the SCREEN is allowed to claim.
import {
  APPLICATION_STATES, isApplicationState, eligibilityLabel, eligibilityTone, chipCount, totalChip,
  rulesRecoverable, buildUnmask, UNMASK_REASON_MIN, minorText, notificationKnown, instalmentLabel,
  bounceTone, seedingText, rateView, durationKey, breakdownTrustworthy, COVERAGE_FLOOR_PCT, orderedSlices,
  sliceWidthPct, hasUnattributed, buildOversightExport, isOversightExportReport,
  type EligibilityView, type StateCounts, type Rate, type RejectionBreakdown,
} from '../features/schemes-registry/oversight';

const bd = (over: Partial<RejectionBreakdown> = {}): RejectionBreakdown => ({
  slices: [], coded: 0, uncoded: 0, totalRejections: 0,
  coverage: { pct: null, numerator: 0, denominator: 0, lowSample: true },
  ...over,
});

describe('ADMIN-4b console · the AI-check cell', () => {
  it('never_checked is MUTED, not red — nobody did anything wrong', () => {
    expect(eligibilityTone({ kind: 'never_checked' })).toBe('neutral');
    expect(eligibilityLabel({ kind: 'never_checked' })).toEqual({ key: 'neverChecked', score: null });
  });
  it('a LOW score is a warning — that is the row the canon routes to an ambassador', () => {
    expect(eligibilityTone({ kind: 'scored', eligible: true, score: 0.58 })).toBe('warning');
    expect(eligibilityTone({ kind: 'scored', eligible: true, score: 0.96 })).toBe('success');
  });
  it('renders a score to two places and no score when there is none', () => {
    expect(eligibilityLabel({ kind: 'scored', eligible: true, score: 0.9 })).toEqual({ key: 'eligible', score: '0.90' });
    expect(eligibilityLabel({ kind: 'unscored', eligible: true }).score).toBeNull();
  });
  it('an unrecognised view is not styled as a pass', () => {
    expect(eligibilityTone({ kind: 'weird' } as unknown as EligibilityView)).not.toBe('success');
  });
});

describe('ADMIN-4b console · tab chips', () => {
  const counts: StateCounts = { submitted: 2318, approved: 0 };

  it('an ABSENT count renders NO number, and a present 0 renders 0', () => {
    // A "0" beside a tab holding 1,842 applications makes an operator skip the tab.
    expect(chipCount(counts, 'submitted')).toBe(2318);
    expect(chipCount(counts, 'approved')).toBe(0);
    expect(chipCount(counts, 'rejected')).toBeNull();
  });
  it('a failed counts fetch renders no numbers at all rather than zeroes', () => {
    for (const s of APPLICATION_STATES) expect(chipCount(null, s)).toBeNull();
    expect(totalChip(null)).toBeNull();
    expect(totalChip({})).toBeNull();
  });
  it('the total sums only what is known', () => {
    expect(totalChip(counts)).toBe(2318);
  });
  it('recognises the nine states and nothing else', () => {
    expect(APPLICATION_STATES.length).toBe(9);
    expect(isApplicationState('under_verification')).toBe(true);
    expect(isApplicationState('cancelled')).toBe(false);
    expect(isApplicationState(undefined)).toBe(false);
  });
});

describe('ADMIN-4b console · the version pointer', () => {
  it('flags an application whose rules cannot be retrieved', () => {
    expect(rulesRecoverable({ schemeVersionResolvable: true })).toBe(true);
    expect(rulesRecoverable({ schemeVersionResolvable: false })).toBe(false);
    // Anything other than an explicit true is NOT treated as recoverable: silence here would read as "the rules are
    // fine" on a screen where a grievance officer is reading a refusal.
    expect(rulesRecoverable({ schemeVersionResolvable: undefined as unknown as boolean })).toBe(false);
  });
});

describe('ADMIN-4b console · the unmask form', () => {
  it('holds the same ten-character floor as the server', () => {
    expect(UNMASK_REASON_MIN).toBe(10);
    expect(buildUnmask({ reason: 'checking' }).ok).toBe(false);
    expect(!buildUnmask({ reason: 'checking' }).ok && (buildUnmask({ reason: 'checking' }) as { error: string }).error).toBe('reasonTooShort');
  });
  it('trims before measuring', () => {
    expect(buildUnmask({ reason: '    wip    ' }).ok).toBe(false);
  });
  it('accepts a real reason and refuses an over-long one', () => {
    const r = buildUnmask({ reason: 'grievance GRV-4471 callback' });
    expect(r.ok && r.value.reason).toBe('grievance GRV-4471 callback');
    expect(buildUnmask({ reason: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('ADMIN-4b console · money is never parsed', () => {
  it('renders a minor-unit total verbatim with its unit', () => {
    expect(minorText('3820000000')).toBe('3820000000 minor units');
  });
  it('a 30-digit total survives intact', () => {
    expect(minorText('9'.repeat(30))).toBe(`${'9'.repeat(30)} minor units`);
  });
  it('anything non-numeric is a dash, never 0 — an amount we cannot read must not render as nothing owed', () => {
    expect(minorText('38.2')).toBe('—');
    expect(minorText(null)).toBe('—');
    expect(minorText('')).toBe('—');
  });
});

describe('ADMIN-4b console · DBT labels', () => {
  it('the notification state is UNKNOWN until something records it', () => {
    expect(notificationKnown(undefined)).toBe(false);
    expect(notificationKnown({ notificationStateAvailable: false })).toBe(false);
    expect(notificationKnown({ notificationStateAvailable: true })).toBe(true);
  });
  it('an unnumbered instalment is NULL, not a 1st', () => {
    expect(instalmentLabel(null)).toBeNull();
    expect(instalmentLabel(0)).toBeNull();
    expect(instalmentLabel(undefined)).toBeNull();
  });
  it('renders English ordinals, including the teens', () => {
    expect(instalmentLabel(1)).toBe('1st');
    expect(instalmentLabel(2)).toBe('2nd');
    expect(instalmentLabel(3)).toBe('3rd');
    expect(instalmentLabel(4)).toBe('4th');
    expect(instalmentLabel(11)).toBe('11th');
    expect(instalmentLabel(12)).toBe('12th');
    expect(instalmentLabel(13)).toBe('13th');
    expect(instalmentLabel(20)).toBe('20th');
    expect(instalmentLabel(21)).toBe('21st');
    expect(instalmentLabel(112)).toBe('112th');
  });
  it('a bounce reason with open cases is a failure; a fully resolved one is not', () => {
    expect(bounceTone(184, 200)).toBe('danger');
    expect(bounceTone(0, 200)).toBe('success');
    expect(bounceTone(0, 0)).toBe('neutral');
  });
  it('a missing seeding-failure slice is UNKNOWN, not zero failures', () => {
    expect(seedingText(null).known).toBe(false);
    expect(seedingText({ open: 184, total: 200 })).toEqual({ known: true, open: 184, total: 200 });
  });
});

describe('ADMIN-4b console · rate rendering', () => {
  it('no denominator renders as unknown, never 0%', () => {
    expect(rateView(null).kind).toBe('unknown');
    expect(rateView({ pct: null, numerator: 0, denominator: 0, lowSample: true }).kind).toBe('unknown');
  });
  it('a low sample renders the COUNTS instead of the percentage', () => {
    const v = rateView({ pct: 77.8, numerator: 7, denominator: 9, lowSample: true });
    expect(v.kind).toBe('lowSample');
    expect(v.kind === 'lowSample' && v.denominator).toBe(9);
  });
  it('a healthy sample renders the percentage with its denominator', () => {
    const v = rateView({ pct: 78, numerator: 78, denominator: 100, lowSample: false });
    expect(v.kind === 'pct' && v.pct).toBe(78);
  });
  it('nothing disbursed is its own key, not "days"', () => {
    expect(durationKey({ kind: 'none_disbursed' })).toBe('noneDisbursed');
    expect(durationKey({ kind: 'untimeable', disbursals: 3 })).toBe('untimeable');
    expect(durationKey({ kind: 'days', days: 24, sampleSize: 90 })).toBe('days');
    expect(durationKey(null)).toBe('unknown');
  });
});

describe('ADMIN-4b console · the rejection chart refuses to be drawn on noise', () => {
  it('a breakdown with nothing coded is NOT chartable', () => {
    expect(breakdownTrustworthy(bd({ uncoded: 500, totalRejections: 500 }))).toBe(false);
    expect(breakdownTrustworthy(null)).toBe(false);
  });
  it('coverage below the floor is not chartable even with thousands of rows', () => {
    // Ten thousand rejections of which 300 are coded still cannot say where to send ambassadors.
    const low = bd({ coded: 300, uncoded: 9700, totalRejections: 10000, coverage: { pct: 3, numerator: 300, denominator: 10000, lowSample: false } });
    expect(breakdownTrustworthy(low)).toBe(false);
  });
  it('coverage at or above the floor is chartable', () => {
    const ok = bd({ coded: 60, uncoded: 40, totalRejections: 100, coverage: { pct: COVERAGE_FLOOR_PCT, numerator: 50, denominator: 100, lowSample: false } });
    expect(breakdownTrustworthy(ok)).toBe(true);
  });
  it('fixable slices come first, each group keeping the server order', () => {
    const b = bd({
      coded: 100,
      slices: [
        { code: 'ineligible_landholding', n: 50, pctOfCoded: 50, fixable: false },
        { code: 'aadhaar_seeding_mismatch', n: 30, pctOfCoded: 30, fixable: true },
        { code: 'window_missed', n: 20, pctOfCoded: 20, fixable: true },
      ],
    });
    expect(orderedSlices(b).map((s) => s.code)).toEqual(['aadhaar_seeding_mismatch', 'window_missed', 'ineligible_landholding']);
  });
  it('the bar guards divide-by-zero', () => {
    // The ADMIN-3c lesson, on the same CSS class that had gone unstyled for three waves.
    expect(sliceWidthPct(5, 0)).toBe(0);
    expect(sliceWidthPct(5, 10)).toBe(50);
    expect(sliceWidthPct(20, 10)).toBe(100);
    expect(sliceWidthPct(Number.NaN, 10)).toBe(0);
  });
  it('unattributed credits are flagged only when there are some', () => {
    expect(hasUnattributed({ amountMinor: '1', transfers: 1, attributionBasis: 'x', unattributedTransfers: 0, unattributedAmountMinor: '0' })).toBe(false);
    expect(hasUnattributed({ amountMinor: '1', transfers: 1, attributionBasis: 'x', unattributedTransfers: 3, unattributedAmountMinor: '500' })).toBe(true);
    expect(hasUnattributed(null)).toBe(false);
  });
});

describe('ADMIN-4b console · the export form', () => {
  it('accepts the four oversight reports', () => {
    for (const r of ['applications', 'dbt_credits', 'dbt_bounces', 'rejections']) expect(isOversightExportReport(r)).toBe(true);
    expect(isOversightExportReport('schemes')).toBe(false);
  });
  it('REFUSES an unrecognised status rather than passing it through', () => {
    // Silently ignored by the server, it would produce a file of every application on the platform under a filename
    // claiming a filter.
    const r = buildOversightExport({ report: 'applications', status: 'nonsense' });
    expect(!r.ok && r.error).toBe('status');
  });
  it('treats "all" as no status filter', () => {
    const r = buildOversightExport({ report: 'applications', status: 'all' });
    expect(r.ok && 'status' in r.value).toBe(false);
  });
  it('bounds days and limit', () => {
    expect(buildOversightExport({ report: 'dbt_credits', days: '366' }).ok).toBe(false);
    expect(buildOversightExport({ report: 'dbt_credits', days: '0' }).ok).toBe(false);
    expect(buildOversightExport({ report: 'dbt_credits', days: '365' }).ok).toBe(true);
    expect(buildOversightExport({ report: 'applications', limit: '20001' }).ok).toBe(false);
    expect(buildOversightExport({ report: 'applications', limit: 'all' }).ok).toBe(false);
  });
  it('omits a blank limit rather than sending 0', () => {
    const r = buildOversightExport({ report: 'applications', limit: '' });
    expect(r.ok && 'limit' in r.value).toBe(false);
  });
});
