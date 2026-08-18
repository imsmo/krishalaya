// PC-56 ADMIN-4 · the scheme-version console helpers. Pure, framework-free.
// Every case is a claim about what the SCREEN must not say — the server owns the rules, and these guard the labels.
import {
  versionKind, versionTone, showsSignature, coverageNote, projectionDiverged, openDraft, publishBlockedReason,
  feeText, feeChanged, orderedDiff, isAddition, portalState, portalTone, isPortalProvider, buildMapPortal,
  closeTone, closeKey, apps30dText, buildSchemeExport, isSchemeExportReport, buildSaveDraft,
  type VersionRow, type DiffEntry, type CloseState,
} from '../features/schemes-registry/version';

const v = (over: Partial<VersionRow> = {}): VersionRow => ({
  id: 'v-1', schemeId: 's-1', version: 6, status: 'published',
  benefitSummary: {}, eligibilityRules: {}, requiredDocTypeIds: [], applicationWindow: null,
  applicableRegionIds: [], processingFeeMinor: '0', changeReason: 'r',
  draftedBy: 'op-maker', draftedAt: null, publishedBy: 'op-checker', publishedAt: '2026-05-28T00:00:00.000Z',
  checkerNote: null, isBackfilled: false, isSigned: true, applicationCount: 4206,
  ...over,
});

describe('ADMIN-4 console · version badges', () => {
  it('a BACKFILLED row is labelled backfilled even though its status is published', () => {
    // Checked before status on purpose: a backfilled row IS 'published', and calling it "current" would claim a
    // human signed off on rules nobody signed.
    expect(versionKind(v({ isBackfilled: true }))).toBe('backfilled');
    expect(versionKind(v())).toBe('current');
    expect(versionKind(v({ status: 'draft', isBackfilled: false }))).toBe('draft');
    expect(versionKind(v({ status: 'superseded' }))).toBe('superseded');
  });
  it('an unrecognised status is NOT quietly treated as current', () => {
    expect(versionKind({ status: 'retired_somehow', isBackfilled: false })).toBe('unknown');
    expect(versionTone('unknown')).not.toBe('success');
  });
  it('backfilled is neutral, NOT a failure colour — it is honesty, not somebody mistake', () => {
    expect(versionTone('backfilled')).toBe('neutral');
    expect(versionTone('backfilled')).not.toBe('danger');
  });
  it('no signature line for a backfilled row, because there is no publisher to name', () => {
    expect(showsSignature(v({ isSigned: false }))).toBe(false);
    expect(showsSignature(v())).toBe(true);
  });
});

describe('ADMIN-4 console · coverage note', () => {
  it('a scheme whose earliest recorded version is v6 reports UNRECORDED, not "no earlier versions"', () => {
    expect(coverageNote({ earliestRecorded: 6, unrecordedBelow: 6 })).toBe('unrecorded');
  });
  it('recorded from v1 is complete', () => {
    expect(coverageNote({ earliestRecorded: 1, unrecordedBelow: null })).toBe('complete');
  });
  it('nothing recorded is its own note', () => {
    expect(coverageNote({ earliestRecorded: null, unrecordedBelow: null })).toBe('none');
  });
});

describe('ADMIN-4 console · the projection', () => {
  it('flags a live row that disagrees with the published version', () => {
    expect(projectionDiverged(7, [v({ version: 6, status: 'published' })])).toBe(true);
    expect(projectionDiverged(6, [v({ version: 6, status: 'published' })])).toBe(false);
  });
  it('no published version is NOT reported as a divergence — it is a separate state', () => {
    expect(projectionDiverged(6, [v({ version: 7, status: 'draft' })])).toBe(false);
  });
  it('finds the open draft and only the draft', () => {
    expect(openDraft([v(), v({ id: 'v-2', version: 7, status: 'draft' })])?.id).toBe('v-2');
    expect(openDraft([v()])).toBeNull();
  });
});

describe('ADMIN-4 console · maker-checker by absence', () => {
  const draft = v({ id: 'v-7', version: 7, status: 'draft', draftedBy: 'op-maker', publishedBy: null, isSigned: false });

  it('the viewer who drafted it is blocked with sameActor', () => {
    expect(publishBlockedReason(draft, 'op-maker')).toBe('sameActor');
  });
  it('a different operator is not blocked', () => {
    expect(publishBlockedReason(draft, 'op-checker')).toBeNull();
  });
  it('no draft at all is its own reason, not a permission problem', () => {
    expect(publishBlockedReason(null, 'op-checker')).toBe('noDraft');
  });
  it('an UNKNOWN viewer is NOT blocked — the safe direction is to show the control and let the server refuse', () => {
    // adminUserId() reads an unverified claim and can be null. Hiding the control on "cannot tell" would block
    // legitimate work; a redundant 409 is recoverable.
    expect(publishBlockedReason(draft, null)).toBeNull();
  });
  it('TWO unknowns must not compare equal — a draft with no recorded maker, viewed by an unreadable session', () => {
    // The case above cannot tell a null-guarded comparison from a bare `===`, because 'op-maker' !== null either way.
    // THIS one can: a bare `draft.draftedBy === viewerUserId` makes null === null true and hides the Publish control
    // from EVERYBODY, on a draft nobody is recorded as having made — a dead end with no explanation on screen.
    expect(publishBlockedReason({ ...draft, draftedBy: null }, null)).toBeNull();
    expect(publishBlockedReason({ ...draft, draftedBy: null }, 'op-checker')).toBeNull();
  });
});

describe('ADMIN-4 console · money is never parsed', () => {
  it('renders the fee verbatim with the unit named', () => {
    expect(feeText('5000')).toBe('5000 minor units');
    expect(feeText('0')).toBe('0 minor units');
  });
  it('a 20-digit fee survives intact — no float, no rounding', () => {
    expect(feeText('99999999999999999999')).toBe('99999999999999999999 minor units');
  });
  it('anything non-numeric is a dash, never 0', () => {
    // A fee we cannot read must not render as free.
    expect(feeText(null)).toBe('—');
    expect(feeText('')).toBe('—');
    expect(feeText('50.00')).toBe('—');
    expect(feeText('abc')).toBe('—');
  });
});

describe('ADMIN-4 console · the review diff ordering', () => {
  const d = (field: string): DiffEntry => ({ field, from: '"a"', to: '"b"' });

  it('puts the FEE first and the region list last — a checker reads top-down', () => {
    const out = orderedDiff([d('applicableRegionIds'), d('requiredDocTypeIds'), d('processingFeeMinor'), d('eligibilityRules')]);
    expect(out.map((x) => x.field)).toEqual(['processingFeeMinor', 'eligibilityRules', 'requiredDocTypeIds', 'applicableRegionIds']);
  });
  it('does not mutate the input array', () => {
    const input = [d('applicableRegionIds'), d('processingFeeMinor')];
    orderedDiff(input);
    expect(input[0].field).toBe('applicableRegionIds');
  });
  it('an unknown field sorts last rather than to the top', () => {
    const out = orderedDiff([d('somethingNew'), d('processingFeeMinor')]);
    expect(out[0].field).toBe('processingFeeMinor');
  });
  it('flags a fee change so it cannot be skimmed past', () => {
    expect(feeChanged([d('eligibilityRules')])).toBe(false);
    expect(feeChanged([d('processingFeeMinor')])).toBe(true);
  });
  it('an addition is labelled, not shown as an empty cell', () => {
    expect(isAddition({ field: 'x', from: null, to: '"b"' })).toBe(true);
    expect(isAddition({ field: 'x', from: 'null', to: '"b"' })).toBe(true);
    expect(isAddition({ field: 'x', from: '"a"', to: '"b"' })).toBe(false);
  });
});

describe('ADMIN-4 console · DELTA-018, the word we will not print', () => {
  it('is mapped or manual, and never the canon "connected"', () => {
    expect(portalState({ portalState: 'mapped' })).toBe('mapped');
    expect(portalState({ portalState: 'manual' })).toBe('manual');
    expect(portalState({ portal: { providerCode: 'pfms' } })).toBe('mapped');
    expect(portalState({})).toBe('manual');
    // a server value this console does not know must not be trusted into 'mapped'
    expect(portalState({ portalState: 'connected' })).toBe('manual');
  });
  it('manual is NOT styled as a failure — a district office with no API is the normal case', () => {
    expect(portalTone('manual')).toBe('neutral');
    expect(portalTone('manual')).not.toBe('danger');
    expect(portalTone('mapped')).toBe('success');
  });
  it('accepts only registered government portals', () => {
    expect(isPortalProvider('pfms')).toBe(true);
    expect(isPortalProvider('razorpay')).toBe(false);
  });
  it('refuses a credential-shaped endpoint label with its OWN error key', () => {
    // Its own key, not 'endpointLabel': an operator told only "invalid" retypes the same token.
    const r = buildMapPortal({ providerCode: 'pfms', externalId: 'MOA-1', endpointLabel: 'api_key=abc', reason: 'setup' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('secretShaped');
  });
  it('accepts a plain label', () => {
    const r = buildMapPortal({ providerCode: 'ikhedut', externalId: 'GJ-AGRI-1', endpointLabel: 'ikhedut filing desk', reason: 'setup' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.endpointLabel).toBe('ikhedut filing desk');
  });
  it('a blank label is null, not an empty string', () => {
    const r = buildMapPortal({ providerCode: 'pfms', externalId: 'X-1', endpointLabel: '', reason: 'setup' });
    expect(r.ok && r.value.endpointLabel).toBeNull();
  });
});

describe('ADMIN-4 console · deadline styling', () => {
  const s = (x: CloseState) => closeTone(x);

  it('always-open gets NO urgency styling — it is not a deadline', () => {
    expect(s({ kind: 'no_window' })).toBe('neutral');
    expect(s({ kind: 'no_window' })).not.toBe('danger');
    expect(s({ kind: 'no_window' })).not.toBe('warning');
  });
  it('closing today or within two days is urgent', () => {
    expect(s({ kind: 'closes_today', onYear: 2026 })).toBe('danger');
    expect(s({ kind: 'closes_in', days: 2, onYear: 2026 })).toBe('danger');
  });
  it('inside the nudge ladder is a warning; beyond it is fine', () => {
    expect(s({ kind: 'closes_in', days: 14, onYear: 2026 })).toBe('warning');
    expect(s({ kind: 'closes_in', days: 15, onYear: 2026 })).toBe('success');
  });
  it('an unreadable or impossible window IS a failure — a stored date nobody can act on', () => {
    expect(s({ kind: 'unparseable' })).toBe('danger');
    expect(s({ kind: 'impossible_date', month: 2, day: 29, onYear: 2027 })).toBe('danger');
  });
  it('an unrecognised state resolves to unparseable, never to a reassuring default', () => {
    expect(closeKey({ kind: 'something_else' } as unknown as CloseState)).toBe('unparseable');
    expect(closeKey({ kind: 'no_window' })).toBe('noWindow');
    expect(closeKey({ kind: 'closes_today', onYear: 2026 })).toBe('closesToday');
  });
});

describe('ADMIN-4 console · apps 30d', () => {
  it('0 is a real answer for a scheme nobody applies to', () => {
    expect(apps30dText(0)).toBe('0');
    expect(apps30dText(1908)).toBe('1908');
  });
  it('missing is a dash, not 0', () => {
    expect(apps30dText(undefined)).toBe('—');
    expect(apps30dText(null)).toBe('—');
    expect(apps30dText(-1)).toBe('—');
  });
});

describe('ADMIN-4 console · export form', () => {
  it('accepts the four registry reports and refuses the oversight ones', () => {
    for (const r of ['schemes', 'authorities', 'versions', 'calendar']) expect(isSchemeExportReport(r)).toBe(true);
    expect(isSchemeExportReport('applications')).toBe(false);
    expect(isSchemeExportReport('dbt')).toBe(false);
  });
  it('a blank limit is omitted rather than sent as 0', () => {
    const r = buildSchemeExport({ report: 'schemes', limit: '' });
    expect(r.ok).toBe(true);
    expect(r.ok && 'limit' in r.value).toBe(false);
  });
  it('rejects a non-numeric or out-of-range limit', () => {
    expect(buildSchemeExport({ report: 'schemes', limit: 'all' }).ok).toBe(false);
    expect(buildSchemeExport({ report: 'schemes', limit: '0' }).ok).toBe(false);
    expect(buildSchemeExport({ report: 'schemes', limit: '20001' }).ok).toBe(false);
    expect(buildSchemeExport({ report: 'schemes', limit: '20000' }).ok).toBe(true);
  });
});

describe('ADMIN-4 console · the draft form', () => {
  const R = { reason: 'govt circular 4/2026' };

  it('a blank field means UNCHANGED and is omitted from the patch', () => {
    const r = buildSaveDraft({ ...R, processingFeeMinor: '5000' });
    expect(r.ok).toBe(true);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['processingFeeMinor', 'reason']);
  });
  it('refuses a submit that changes nothing', () => {
    const r = buildSaveDraft({ ...R });
    expect(!r.ok && r.error).toBe('empty');
  });
  it('CLEARING the window is a distinct request from leaving it alone', () => {
    // Two blank date boxes cannot express the difference, and guessing would silently unseason a seasonal scheme.
    const cleared = buildSaveDraft({ ...R, window_clear: 'true' });
    expect(cleared.ok && cleared.value.applicationWindow).toBeNull();
    const untouched = buildSaveDraft({ ...R, processingFeeMinor: '1' });
    expect(untouched.ok && 'applicationWindow' in untouched.value).toBe(false);
  });
  it('refuses a self-contradicting window (dates typed AND clear ticked)', () => {
    const r = buildSaveDraft({ ...R, window_clear: 'true', window_opens: '06-01', window_closes: '07-31' });
    expect(!r.ok && r.error).toBe('window');
  });
  it('refuses half a window', () => {
    expect(buildSaveDraft({ ...R, window_opens: '06-01' }).ok).toBe(false);
  });
  it('accepts a full window with a season', () => {
    const r = buildSaveDraft({ ...R, window_opens: '06-01', window_closes: '07-31', window_season: 'kharif' });
    expect(r.ok && r.value.applicationWindow).toEqual({ opens: '06-01', closes: '07-31', season: 'kharif' });
  });
  it('a fee must be whole minor units', () => {
    expect(buildSaveDraft({ ...R, processingFeeMinor: '50.00' }).ok).toBe(false);
    expect(buildSaveDraft({ ...R, processingFeeMinor: '-1' }).ok).toBe(false);
  });
  it('a malformed rules blob is reported BEFORE a missing reason', () => {
    // Reason is required but is not the interesting rule here; reporting it first would hide the real problem.
    const r = buildSaveDraft({ eligibilityRules: 'not json', reason: '' });
    expect(!r.ok && r.error).toBe('eligibilityRules');
  });
  it('a short reason is still refused when the patch is otherwise valid', () => {
    expect(buildSaveDraft({ processingFeeMinor: '1', reason: 'x' }).ok).toBe(false);
  });
});
