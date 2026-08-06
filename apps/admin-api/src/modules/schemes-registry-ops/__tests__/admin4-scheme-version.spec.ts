// PC-56 ADMIN-4 · the scheme VERSION plane (migration 0105) and the DELTA-018 portal mapping.
// Pure domain only — no DB. Every case here is a claim about what the platform must refuse or must not misreport.
import {
  stableJson, rulesEqual, applyRulesPatch, assertChangeReason, assertCheckerNote, assertRulesChanged,
  versionDiff, assertPublishable, assertDiscardable, versionCoverage, isSignedVersion,
  portalStateOf, assertEndpointLabel, isPortalProvider, VERSIONED_FIELDS, type VersionRules,
} from '../domain/scheme-version';
import { closeState, wrapsYear, existsInYear, parseMmDd, closingSoon, NUDGE_QUEUE_GAP } from '../domain/scheme-calendar';
import {
  SCHEME_EXPORT_REPORTS, assertSchemeExportReport, schemeExportColumns, schemeExportFileName, isTruncated, NOT_EXPORTABLE,
} from '../domain/scheme-export';
import { SelfPublishError, VersionNotDraftError, InvalidSchemeInputError } from '../domain/schemes-registry.errors';

const rules = (over: Partial<VersionRules> = {}): VersionRules => ({
  benefitSummary: { type: 'crop_insurance', premium_pct: 2 },
  eligibilityRules: { roles: ['farmer'] },
  requiredDocTypeIds: [],
  applicationWindow: { opens: '06-01', closes: '07-31', season: 'kharif' },
  applicableRegionIds: [],
  processingFeeMinor: '0',
  ...over,
});

describe('ADMIN-4 · stable comparison', () => {
  it('treats a key REORDER as no change (the jsonb round-trip bug)', () => {
    // Postgres jsonb does not preserve key order. A bare JSON.stringify comparison sees a change here, publishes a
    // version that changes no rule, and splits the applicant population across two byte-identical rule sets.
    const a = rules({ benefitSummary: { a: 1, b: 2 } });
    const b = rules({ benefitSummary: { b: 2, a: 1 } });
    expect(stableJson(a.benefitSummary)).toBe(stableJson(b.benefitSummary));
    expect(rulesEqual(a, b)).toBe(true);
    expect(versionDiff(a, b)).toEqual([]);
  });
  it('does NOT sort arrays — order is meaning in a document list', () => {
    expect(stableJson(['b', 'a'])).not.toBe(stableJson(['a', 'b']));
  });
  it('sorts keys at every depth, not just the top', () => {
    expect(stableJson({ x: { p: 1, q: 2 } })).toBe(stableJson({ x: { q: 2, p: 1 } }));
  });
  it('a real value change is still a change', () => {
    expect(rulesEqual(rules(), rules({ processingFeeMinor: '5000' }))).toBe(false);
  });
});

describe('ADMIN-4 · the draft patch', () => {
  it('returns a COMPLETE rule set, never a patch', () => {
    const next = applyRulesPatch(rules(), { processingFeeMinor: '5000' });
    for (const f of VERSIONED_FIELDS) expect(next[f]).toBeDefined();
    expect(next.eligibilityRules).toEqual({ roles: ['farmer'] });   // untouched field carried forward
    expect(next.processingFeeMinor).toBe('5000');
  });
  it('keeps the fee a STRING and never a number', () => {
    // Just under MAX_FEE_MINOR (10^12). Chosen because 12 digits already exceeds what a float would carry through a
    // round trip unharmed, which is the property under test.
    const next = applyRulesPatch(rules(), { processingFeeMinor: '999999999999' });
    expect(typeof next.processingFeeMinor).toBe('string');
    expect(next.processingFeeMinor).toBe('999999999999');
    // and the cap is still a cap
    expect(() => applyRulesPatch(rules(), { processingFeeMinor: '900000000000000' })).toThrow(InvalidSchemeInputError);
  });
  it('rejects a fee that is not a digit string', () => {
    expect(() => applyRulesPatch(rules(), { processingFeeMinor: '50.00' })).toThrow(InvalidSchemeInputError);
    expect(() => applyRulesPatch(rules(), { processingFeeMinor: 5000 as unknown as string })).toThrow(InvalidSchemeInputError);
  });
  it('null clears the window; undefined leaves it alone', () => {
    expect(applyRulesPatch(rules(), { applicationWindow: null }).applicationWindow).toBeNull();
    expect(applyRulesPatch(rules(), {}).applicationWindow).toEqual({ opens: '06-01', closes: '07-31', season: 'kharif' });
  });
  it('refuses a patch that changes nothing', () => {
    expect(() => assertRulesChanged(rules(), applyRulesPatch(rules(), {}))).toThrow(InvalidSchemeInputError);
  });
  it('requires a reason and rejects HTML in it', () => {
    expect(assertChangeReason(' govt circular 4/2026 ')).toBe('govt circular 4/2026');
    expect(() => assertChangeReason('')).toThrow(InvalidSchemeInputError);
    expect(() => assertChangeReason('<b>x</b>')).toThrow(InvalidSchemeInputError);
    expect(() => assertChangeReason(42)).toThrow(InvalidSchemeInputError);
  });
  it('the checker note is OPTIONAL — blank is null, not an error', () => {
    expect(assertCheckerNote(undefined)).toBeNull();
    expect(assertCheckerNote('')).toBeNull();
    expect(assertCheckerNote('agreed')).toBe('agreed');
  });
});

describe('ADMIN-4 · the review diff', () => {
  it('reports only the fields that moved', () => {
    const d = versionDiff(rules(), rules({ processingFeeMinor: '5000' }));
    expect(d.map((x) => x.field)).toEqual(['processingFeeMinor']);
    expect(d[0].from).toBe('"0"');
    expect(d[0].to).toBe('"5000"');
  });
  it('a first version diffs against nothing, with from=null on every field', () => {
    const d = versionDiff(null, rules());
    expect(d.length).toBe(VERSIONED_FIELDS.length);
    expect(d.every((x) => x.from === null)).toBe(true);
  });
  it('renders values as strings, so no digit can be lost to a float', () => {
    const d = versionDiff(rules(), rules({ processingFeeMinor: '99999999999999' }));
    expect(d[0].to).toBe('"99999999999999"');
  });
});

describe('ADMIN-4 · maker-checker', () => {
  const draft = { id: 'v-1', status: 'draft' as const, draftedBy: 'op-maker', version: 7 };

  it('THROWS when the publisher is the drafter — never returns false', () => {
    expect(() => assertPublishable(draft, 'op-maker')).toThrow(SelfPublishError);
  });
  it('allows a different operator', () => {
    expect(() => assertPublishable(draft, 'op-checker')).not.toThrow();
  });
  it('refuses to publish anything that is not a draft', () => {
    expect(() => assertPublishable({ ...draft, status: 'published' }, 'op-checker')).toThrow(VersionNotDraftError);
    expect(() => assertPublishable({ ...draft, status: 'superseded' }, 'op-checker')).toThrow(VersionNotDraftError);
  });
  it('a backfilled version (drafted_by NULL) is not self-publishable-by-accident', () => {
    // draftedBy null must not compare equal to a null-ish actor and let the gate through as "same person".
    expect(() => assertPublishable({ ...draft, draftedBy: null }, 'op-checker')).not.toThrow();
  });
  it('discard is NOT the checker gate — the maker may discard their own draft', () => {
    expect(() => assertDiscardable(draft)).not.toThrow();
    expect(() => assertDiscardable({ id: 'v-1', status: 'published' })).toThrow(VersionNotDraftError);
  });
});

describe('ADMIN-4 · history coverage is honest about what is gone', () => {
  it('a scheme at v6 with only v6 recorded reports v6 as unrecordedBelow — NOT "no earlier versions"', () => {
    expect(versionCoverage([{ version: 6 }])).toEqual({ earliestRecorded: 6, unrecordedBelow: 6 });
  });
  it('a scheme recorded from v1 has nothing missing', () => {
    expect(versionCoverage([{ version: 3 }, { version: 2 }, { version: 1 }])).toEqual({ earliestRecorded: 1, unrecordedBelow: null });
  });
  it('no rows at all is "none recorded", not "complete"', () => {
    expect(versionCoverage([])).toEqual({ earliestRecorded: null, unrecordedBelow: null });
  });
  it('a backfilled row is NOT signed, even though it is published and has a published_at', () => {
    expect(isSignedVersion({ isBackfilled: true, publishedBy: null })).toBe(false);
    expect(isSignedVersion({ isBackfilled: false, publishedBy: 'op-checker' })).toBe(true);
    expect(isSignedVersion({ isBackfilled: false, publishedBy: null })).toBe(false);
  });
  it('a backfilled row NAMING a publisher is still not signed — the isBackfilled clause is not dead code', () => {
    // The three cases above are all satisfied by `publishedBy !== null` alone, because
    // ck_scheme_version_backfill guarantees a backfilled row carries no publisher — so they cannot tell whether the
    // function checks isBackfilled at all. THIS case is the combination the constraint currently forbids, and it has
    // to fail closed anyway: the same defence-in-depth reasoning as the translations plane's three copies of the
    // servable predicate. A row reaching this function from an export, a fixture, or a future migration that relaxed
    // the constraint must not be drawn with a signature line.
    expect(isSignedVersion({ isBackfilled: true, publishedBy: 'op-checker' })).toBe(false);
  });
});

describe('ADMIN-4 · calendar arithmetic', () => {
  const NOW = new Date('2026-07-13T00:00:00.000Z');

  it('counts the days to a close date', () => {
    expect(closeState({ opens: '06-01', closes: '07-31' }, NOW)).toEqual({ kind: 'closes_in', days: 18, onYear: 2026 });
  });
  it('closing today is its own state, not zero days', () => {
    expect(closeState({ opens: '06-01', closes: '07-13' }, NOW)).toEqual({ kind: 'closes_today', onYear: 2026 });
  });
  it('a passed date rolls to next year', () => {
    const s = closeState({ opens: '01-01', closes: '03-31' }, NOW);
    expect(s.kind === 'closes_in' && s.onYear).toBe(2027);
  });
  it('no window is "always open" and NOT a deadline', () => {
    expect(closeState(null, NOW)).toEqual({ kind: 'no_window' });
    expect(closeState({}, NOW)).toEqual({ kind: 'no_window' });
  });
  it('an unreadable window is reported, not defaulted to always-open', () => {
    expect(closeState({ opens: '06-01', closes: 'soon' }, NOW)).toEqual({ kind: 'unparseable' });
  });
  it('29 February in a non-leap year is IMPOSSIBLE, not silently 1 March', () => {
    // The tempting Date.UTC shortcut rolls forward and tells a farmer the door is open a day longer than it is.
    expect(existsInYear(2, 29, 2028)).toBe(true);
    expect(existsInYear(2, 29, 2027)).toBe(false);
    // Reports 2027 — the year the date is missing from — rather than rolling forward to 2028 and printing a
    // 361-day countdown. A window that only exists every fourth year is a typo, and the useful statement is that the
    // STORED date is unusable, not a cheerful deadline four years out.
    const s = closeState({ opens: '01-01', closes: '02-29' }, new Date('2027-03-05T00:00:00.000Z'));
    expect(s).toEqual({ kind: 'impossible_date', month: 2, day: 29, onYear: 2027 });
    // in a leap year the same window is a perfectly ordinary deadline
    const leap = closeState({ opens: '01-01', closes: '02-29' }, new Date('2028-02-01T00:00:00.000Z'));
    expect(leap).toEqual({ kind: 'closes_in', days: 28, onYear: 2028 });
  });
  it('parseMmDd rejects nonsense months and days', () => {
    expect(parseMmDd('13-01')).toBeNull();
    expect(parseMmDd('06-32')).toBeNull();
    expect(parseMmDd('06-01')).toEqual({ month: 6, day: 1 });
  });
  it('a rabi window wrapping the year end is not an error', () => {
    expect(wrapsYear({ opens: '10-01', closes: '03-31' })).toBe(true);
    expect(wrapsYear({ opens: '06-01', closes: '07-31' })).toBe(false);
  });
  it('closingSoon keeps only real deadlines inside the window, soonest first', () => {
    const rowsIn = [
      { applicationWindow: { opens: '06-01', closes: '07-31' } },   // 18 days — outside a 14-day ladder
      { applicationWindow: { opens: '06-01', closes: '07-20' } },   // 7 days
      { applicationWindow: null },                                   // always open — never "closing soon"
      { applicationWindow: { opens: '06-01', closes: '07-14' } },   // 1 day
    ];
    const out = closingSoon(rowsIn, NOW, 14);
    expect(out.length).toBe(2);
    expect(out[0].closeState.kind === 'closes_in' && out[0].closeState.days).toBe(1);
  });
  it('the nudge queue is NOT an empty list — it declares itself unavailable', () => {
    // An empty array renders as "no nudges scheduled", which would be a claim that a scheduler looked and found none.
    expect(NUDGE_QUEUE_GAP.available).toBe(false);
    expect(Array.isArray(NUDGE_QUEUE_GAP.missing)).toBe(true);
    expect(NUDGE_QUEUE_GAP.missing).toContain('scheduler');
  });
});

describe('ADMIN-4 · DELTA-018 portal mapping', () => {
  it('never reports "connected" — only mapped or manual', () => {
    expect(portalStateOf({ providerCode: 'pfms' })).toBe('mapped');
    expect(portalStateOf(null)).toBe('manual');
    expect(portalStateOf(undefined)).toBe('manual');
    expect(portalStateOf({ providerCode: '' })).toBe('manual');
  });
  it('only registered government providers are portals', () => {
    expect(isPortalProvider('pfms')).toBe(true);
    expect(isPortalProvider('ikhedut')).toBe(true);
    expect(isPortalProvider('razorpay')).toBe(false);
    expect(isPortalProvider('')).toBe(false);
  });
  it('refuses a credential-shaped endpoint label', () => {
    expect(assertEndpointLabel('ikhedut filing desk')).toBe('ikhedut filing desk');
    for (const bad of ['api_key=abc123', 'Bearer eyJhb', 'x-secret-9', '-----BEGIN PRIVATE KEY-----', 'password: hunter2', 'Authorization: x']) {
      expect(() => assertEndpointLabel(bad)).toThrow(InvalidSchemeInputError);
    }
  });
});

describe('ADMIN-4 · the export plane', () => {
  it('exports exactly the four registry reports', () => {
    expect([...SCHEME_EXPORT_REPORTS]).toEqual(['schemes', 'authorities', 'versions', 'calendar']);
    for (const r of SCHEME_EXPORT_REPORTS) expect(assertSchemeExportReport(r)).toBe(r);
    expect(() => assertSchemeExportReport('nonsense')).toThrow();
  });
  it('names applications and dbt as refused WITH a reason, rather than omitting them', () => {
    expect(Object.keys(NOT_EXPORTABLE).sort()).toEqual(['applications', 'dbt']);
    expect(NOT_EXPORTABLE.applications).toMatch(/PII|permission/i);
    expect(NOT_EXPORTABLE.dbt).toMatch(/bank/i);
  });
  it('NO report carries a person — not an applicant, not a maker, not a checker', () => {
    for (const r of SCHEME_EXPORT_REPORTS) {
      const keys = schemeExportColumns(r).map(([, k]) => k).join(' ');
      const headers = schemeExportColumns(r).map(([h]) => h).join(' ');
      expect(`${keys} ${headers}`).not.toMatch(/user_id|applicant|phone|drafted_by|published_by|reviewer|actor/i);
    }
  });
  it('the version report exposes WHETHER a version was signed, as booleans', () => {
    const keys = schemeExportColumns('versions').map(([, k]) => k);
    expect(keys).toContain('has_maker');
    expect(keys).toContain('has_checker');
    expect(keys).toContain('is_backfilled');
  });
  it('every money header names the unit, so nobody divides by 100 in their head', () => {
    for (const r of SCHEME_EXPORT_REPORTS) {
      for (const [header, key] of schemeExportColumns(r)) {
        if (/fee|amount|minor/.test(key)) expect(header).toMatch(/minor_units/);
      }
    }
  });
  it('the file name carries the receipt id so a file on a desktop is traceable', () => {
    const name = schemeExportFileName('versions', '9f1c2b7a-1111-4222-8333-444455556666', new Date('2026-08-06T10:00:00.000Z'));
    expect(name).toBe('krishalaya-schemes-versions-2026-08-06-9f1c2b7a.csv');
  });
  it('a file at the ceiling is flagged truncated', () => {
    expect(isTruncated(5000, 5000)).toBe(true);
    expect(isTruncated(4999, 5000)).toBe(false);
  });
});
