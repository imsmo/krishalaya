// PC-56 ADMIN-4b · the scheme OVERSIGHT plane. Pure domain only — no DB.
// Every case is a claim about what the platform must refuse, must not disclose, or must not misreport.
import { maskPhone, maskName, maskApplicant, assertUnmaskReason, govtRefFor, MASK_UNAVAILABLE, UNMASK_REASON_MIN } from '../domain/pii-mask';
import { assertNoBankFields, BankFieldLeakError, FORBIDDEN_DBT_FIELDS, DBT_EXPORT_COLUMNS, DBT_BOUNCE_EXPORT_COLUMNS, CELEBRATION_NOTIFY_GAP, DBT_IS_OBSERVED_NOT_MOVED } from '../domain/dbt-safety';
import {
  APPLICATION_STATES, isApplicationState, statusClass, countsFrom, totalCount, eligibilityView, needsHumanLook,
  assertFilters, assistedShare,
} from '../domain/application-oversight';
import {
  rate, LOW_SAMPLE_BELOW, REJECTION_CODES, isFixable, rejectionBreakdown, fixableShare, medianDuration, benefitTotal,
} from '../domain/performance';
import { InvalidOversightQueryError } from '../domain/schemes-oversight.errors';
// ADMIN-5b lifted masking out of this module into core/pii/mask.ts, and the error class went with it. This spec kept
// importing from the old home and the suite has been RED since that wave — invisible because admin-api's tsconfig does
// not include specs, so tsc stayed green and only a full `jest` run (not the per-module run each wave does) shows it.
// The same enumeration blind spot already logged against apps/api, now demonstrated here. Waves run their own module's
// tests; nothing runs everything.
import { UnmaskReasonRequiredError } from '../../../core/pii/mask';
import { financialYearStart } from '../services/scheme-performance.service';

describe('ADMIN-4b · phone masking', () => {
  it('renders the canon shape, keeping the last three digits', () => {
    expect(maskPhone('+919812345210')).toBe('+91 98••• ••210');
    expect(maskPhone('9812345210')).toBe('98••• ••210');
  });
  it('strips non-digits before masking, so a formatted number does not shift the mask', () => {
    expect(maskPhone('+91 98123-45210')).toBe('+91 98••• ••210');
  });
  it('a number too short to mask is REFUSED, never returned raw', () => {
    // The one situation where a "return it as-is" fallback matters is exactly the situation where the data is
    // malformed and nobody is checking.
    expect(maskPhone('12345')).toBe(MASK_UNAVAILABLE);
    expect(maskPhone('1234567')).toBe(MASK_UNAVAILABLE);
  });
  it('never leaks the middle digits', () => {
    const masked = maskPhone('+919812345210') as string;
    expect(masked).not.toContain('1234');
    expect(masked).not.toContain('345');   // the middle run
  });
  it('empty is null, not a mask of nothing', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('')).toBeNull();
  });
});

describe('ADMIN-4b · name masking', () => {
  it('renders the canon shape', () => {
    expect(maskName('Ramesh Patel')).toBe('Ramesh P.');
    expect(maskName('Meera Ben Joshi')).toBe('Meera Ben J.');
  });
  it('a SINGLE-token name is returned WHOLE, not reduced to an initial', () => {
    // A great many people in India have one name. "R." is not a name, and a list of "R." "S." "M." is unusable —
    // while a three-token person keeps two words, which would make the reduction quietly unfair.
    expect(maskName('Ramesh')).toBe('Ramesh');
    expect(maskName('  Lakshmi  ')).toBe('Lakshmi');
  });
  it('collapses runs of whitespace rather than producing empty tokens', () => {
    expect(maskName('Ramesh    Patel')).toBe('Ramesh P.');
    expect(maskName('Ramesh\tPatel')).toBe('Ramesh P.');
  });
  it('handles Devanagari and Gujarati names', () => {
    // These are BMP characters, so they work with either indexing approach — kept because they are the real data.
    expect(maskName('रमेश पटेल')).toBe('रमेश प.');
    expect(maskName('મીરા જોશી')).toBe('મીરા જ.');
  });
  it('takes a CODE POINT as the initial, so an astral character is not split into a lone surrogate', () => {
    // The case that actually distinguishes `Array.from(last)[0]` from `last[0]`. A mutation test caught that the three
    // Indic cases above could NOT tell them apart — Devanagari is in the BMP. An emoji in a name field is real, and
    // `last[0]` returns half a surrogate pair, which renders as a replacement glyph.
    expect(maskName('Ramesh 🙏Patel')).toBe('Ramesh 🙏.');
    expect(maskName('Meera 𠮷野')).toBe('Meera 𠮷.');
  });
  it('does NOT claim to handle combining marks — the initial of a matra-bearing letter loses the matra', () => {
    // Documented, not hidden: "पाटील" initialises to "प." and not "पा.". Correct grapheme segmentation is a real
    // change with real behaviour to verify, and this test exists so a future fix has something to change.
    expect(maskName('रमेश पाटील')).toBe('रमेश प.');
  });
  it('empty is null', () => {
    expect(maskName(null)).toBeNull();
    expect(maskName('   ')).toBeNull();
  });
  it('the masked applicant carries no raw field at all', () => {
    const m = maskApplicant({ userId: 'u1', fullName: 'Ramesh Patel', phone: '+919812345210' });
    expect(JSON.stringify(m)).not.toContain('Patel');
    expect(JSON.stringify(m)).not.toContain('9812345');
    expect(m.masked).toBe(true);
  });
  it('a government application reference is NOT masked — it is what you quote to chase a filing', () => {
    expect(govtRefFor('GJ-PMFBY-26-084412')).toBe('GJ-PMFBY-26-084412');
    expect(govtRefFor('')).toBeNull();
  });
});

describe('ADMIN-4b · the unmask reason', () => {
  it('requires ten characters, not three', () => {
    expect(UNMASK_REASON_MIN).toBe(10);
    expect(() => assertUnmaskReason('wip')).toThrow(UnmaskReasonRequiredError);
    expect(() => assertUnmaskReason('checking')).toThrow(UnmaskReasonRequiredError);   // 8 chars
    expect(assertUnmaskReason('grievance GRV-4471 callback')).toBe('grievance GRV-4471 callback');
  });
  it('refuses a non-string and an over-long reason', () => {
    expect(() => assertUnmaskReason(undefined)).toThrow(UnmaskReasonRequiredError);
    expect(() => assertUnmaskReason(42)).toThrow(UnmaskReasonRequiredError);
    expect(() => assertUnmaskReason('x'.repeat(501))).toThrow(UnmaskReasonRequiredError);
  });
  it('trims before measuring, so padding with spaces does not clear the floor', () => {
    expect(() => assertUnmaskReason('   wip    ')).toThrow(UnmaskReasonRequiredError);
  });
});

describe('ADMIN-4b · the bank-field law (W076)', () => {
  it('throws on the field that actually exists', () => {
    expect(() => assertNoBankFields([{ scheme_code: 'pm_kisan', bank_ref: 'UTR123' }], 'test')).toThrow(BankFieldLeakError);
    expect(() => assertNoBankFields([{ bankRef: 'UTR123' }], 'test')).toThrow(BankFieldLeakError);
  });
  it('throws on a NESTED bank field — one level down is exactly as disclosed', () => {
    expect(() => assertNoBankFields({ items: [{ meta: { payload: { ifsc: 'SBIN0001' } } }] }, 'test')).toThrow(BankFieldLeakError);
  });
  it('is case-insensitive', () => {
    expect(() => assertNoBankFields([{ Bank_Ref: 'x' }], 'test')).toThrow(BankFieldLeakError);
    expect(() => assertNoBankFields([{ IFSC: 'x' }], 'test')).toThrow(BankFieldLeakError);
  });
  it('covers the fields somebody will add NEXT, not just the one we have had', () => {
    for (const f of ['account_number', 'accountNumber', 'iban', 'upi_id', 'vpa', 'aadhaar_number']) {
      expect(() => assertNoBankFields([{ [f]: 'x' }], 'test')).toThrow(BankFieldLeakError);
    }
    expect(FORBIDDEN_DBT_FIELDS.length).toBeGreaterThan(10);
  });
  it('PASSES pfms_ref — the government transaction handle is not an account identifier', () => {
    expect(() => assertNoBankFields([{ pfms_ref: 'PFMS-26-8841', pfmsRef: 'PFMS-26-8841' }], 'test')).not.toThrow();
  });
  it('survives a cyclic object instead of hanging the request', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() => assertNoBankFields(a, 'test')).not.toThrow();
  });
  it('neither DBT export column list contains a bank field', () => {
    for (const cols of [DBT_EXPORT_COLUMNS, DBT_BOUNCE_EXPORT_COLUMNS]) {
      const flat = cols.map(([h, k]) => `${h} ${k}`).join(' ').toLowerCase();
      for (const f of FORBIDDEN_DBT_FIELDS) expect(flat).not.toContain(f.toLowerCase());
    }
  });
  it('every DBT money column names its unit', () => {
    for (const cols of [DBT_EXPORT_COLUMNS, DBT_BOUNCE_EXPORT_COLUMNS]) {
      for (const [header, key] of cols) if (/amount/.test(key)) expect(header).toMatch(/minor_units/);
    }
  });
  it('the celebration tile declares itself unbuilt with its reasons — never an available:true or a 0', () => {
    expect(CELEBRATION_NOTIFY_GAP.available).toBe(false);
    expect(CELEBRATION_NOTIFY_GAP.missing).toContain('notify_on_credit_path');
    expect(CELEBRATION_NOTIFY_GAP.missing).toContain('dlt_registration');
  });
  it('the doctrine says the platform never moves this money', () => {
    expect(DBT_IS_OBSERVED_NOT_MOVED.writesLedger).toBe(false);
  });
});

describe('ADMIN-4b · the pipeline (W074)', () => {
  it('mirrors the DB enum exactly — nine states', () => {
    expect(APPLICATION_STATES.length).toBe(9);
    for (const s of ['draft', 'submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed']) {
      expect(isApplicationState(s)).toBe(true);
    }
    expect(isApplicationState('cancelled')).toBe(false);
  });
  it('clarification_needed is a WARNING, not a failure — the application is alive', () => {
    expect(statusClass('clarification_needed')).toContain('warn');
    expect(statusClass('clarification_needed')).not.toContain('danger');
  });
  it('rejected is muted, not red — a wall of red on a history tab trains people to ignore red', () => {
    expect(statusClass('rejected')).toContain('muted');
    expect(statusClass('rejected')).not.toContain('danger');
  });

  it('an ABSENT count is unknown and a PRESENT 0 is zero — they must not collapse', () => {
    const c = countsFrom([{ status: 'submitted', n: 5 }, { status: 'approved', n: 0 }]);
    expect(c.submitted).toBe(5);
    expect(c.approved).toBe(0);            // the aggregate said zero
    expect('rejected' in c).toBe(false);   // the aggregate never mentioned it → unknown, NOT 0
  });
  it('drops an unknown status rather than admitting it to the counts object at all', () => {
    const c = countsFrom([{ status: 'submitted', n: 5 }, { status: 'nonsense', n: 99 }]);
    // Asserting through totalCount alone was NOT enough — it filters to the nine known states, so a mutant that
    // stored the unknown key still passed. The object itself must not gain the key: a console iterating the counts
    // would render a chip for a state that does not exist.
    expect(Object.keys(c)).toEqual(['submitted']);
    expect((c as Record<string, number>).nonsense).toBeUndefined();
    expect(totalCount(c)).toBe(5);
  });
  it('the total is NULL when nothing is known, so the All chip can be blank rather than 0', () => {
    expect(totalCount({})).toBeNull();
    expect(totalCount(countsFrom([{ status: 'draft', n: 0 }]))).toBe(0);
  });

  it('an application with NO eligibility check is never_checked — not ineligible, not 0.00', () => {
    expect(eligibilityView(null)).toEqual({ kind: 'never_checked' });
    expect(eligibilityView({})).toEqual({ kind: 'never_checked' });
    expect(eligibilityView([])).toEqual({ kind: 'never_checked' });
  });
  it('reads a score and rounds to two places', () => {
    expect(eligibilityView({ eligible: true, score: 0.9611 })).toEqual({ kind: 'scored', eligible: true, score: 0.96 });
    expect(eligibilityView({ eligible: false, confidence: 0.58 })).toEqual({ kind: 'scored', eligible: false, score: 0.58 });
  });
  it('an OUT-OF-RANGE score is treated as absent, never clamped to 1.00', () => {
    // Clamping 47 to 1.0 would render the most confident cell on the screen out of the most obviously broken value.
    expect(eligibilityView({ eligible: true, score: 47 })).toEqual({ kind: 'unscored', eligible: true });
    expect(eligibilityView({ eligible: true, score: -1 })).toEqual({ kind: 'unscored', eligible: true });
    expect(eligibilityView({ eligible: true, score: Number.NaN })).toEqual({ kind: 'unscored', eligible: true });
  });
  it('unscored and never-checked BOTH need a human look', () => {
    expect(needsHumanLook({ kind: 'never_checked' })).toBe(true);
    expect(needsHumanLook({ kind: 'unscored', eligible: true })).toBe(true);
    expect(needsHumanLook({ kind: 'scored', eligible: true, score: 0.58 })).toBe(true);
    expect(needsHumanLook({ kind: 'scored', eligible: true, score: 0.96 })).toBe(false);
  });

  it('THROWS on a bad status rather than ignoring the filter', () => {
    // An ignored filter shows an operator every application on the platform while the chip says one state.
    expect(() => assertFilters({ status: 'nonsense' })).toThrow(InvalidOversightQueryError);
    expect(assertFilters({ status: 'all' })).toEqual({});
    expect(assertFilters({ status: 'submitted' })).toEqual({ status: 'submitted' });
  });
  it('THROWS on a non-uuid scheme or tenant filter', () => {
    expect(() => assertFilters({ schemeId: 'abc' })).toThrow(InvalidOversightQueryError);
    expect(() => assertFilters({ tenantId: '1' })).toThrow(InvalidOversightQueryError);
  });
  it('THROWS on an assistedOnly that is neither true nor false', () => {
    expect(() => assertFilters({ assistedOnly: 'yes' })).toThrow(InvalidOversightQueryError);
    expect(assertFilters({ assistedOnly: 'true' })).toEqual({ assistedOnly: true });
    expect(assertFilters({ assistedOnly: 'false' })).toEqual({});
  });
  it('the assisted share is NULL on an empty window, never 0%', () => {
    expect(assistedShare(0, 0).pct).toBeNull();
    expect(assistedShare(61, 100).pct).toBe(61);
  });
});

describe('ADMIN-4b · rates never lie about their denominator', () => {
  it('an empty denominator is NULL, not 0%', () => {
    expect(rate(0, 0).pct).toBeNull();
    expect(rate(5, 0).pct).toBeNull();
  });
  it('flags a low sample rather than quoting a percentage of nine', () => {
    const r = rate(7, 9);
    expect(r.pct).toBe(77.8);
    expect(r.lowSample).toBe(true);
    expect(rate(78, 100).lowSample).toBe(false);
    expect(rate(1, LOW_SAMPLE_BELOW).lowSample).toBe(false);
    expect(rate(1, LOW_SAMPLE_BELOW - 1).lowSample).toBe(true);
  });
});

describe('ADMIN-4b · the rejection breakdown', () => {
  it('counts percentages of CODED rows, not of all rejections', () => {
    const b = rejectionBreakdown([
      { code: 'aadhaar_seeding_mismatch', n: 42 },
      { code: 'land_record_name_variance', n: 28 },
      { code: null, n: 500 },
    ]);
    expect(b.coded).toBe(70);
    expect(b.uncoded).toBe(500);
    expect(b.totalRejections).toBe(570);
    expect(b.slices.find((s) => s.code === 'aadhaar_seeding_mismatch')?.pctOfCoded).toBe(60);
  });
  it('does NOT fold uncoded rows into "other"', () => {
    // `other` means an officer looked and none of the codes fitted — a real signal the list needs work. "We never
    // asked" is a different fact, and mixing them destroys the only signal that would prompt anybody to fix the list.
    const b = rejectionBreakdown([{ code: null, n: 100 }]);
    expect(b.slices.find((s) => s.code === 'other')).toBeUndefined();
    expect(b.uncoded).toBe(100);
    expect(b.coded).toBe(0);
  });
  it('an UNRECOGNISED code counts as uncoded, not as other', () => {
    // A code the build does not know means the CHECK constraint moved ahead of this list; bucketing it would hide that.
    const b = rejectionBreakdown([{ code: 'brand_new_code', n: 7 }]);
    expect(b.uncoded).toBe(7);
    expect(b.coded).toBe(0);
  });
  it('reports coverage so a confident chart over 12% of the data is visible as such', () => {
    const b = rejectionBreakdown([{ code: 'window_missed', n: 12 }, { code: null, n: 88 }]);
    expect(b.coverage.pct).toBe(12);
  });
  it('slices keep REMEDY order, not frequency order', () => {
    const b = rejectionBreakdown([{ code: 'other', n: 900 }, { code: 'aadhaar_seeding_mismatch', n: 1 }]);
    expect(b.slices[0].code).toBe('aadhaar_seeding_mismatch');
  });
  it('separates fixable from genuinely ineligible', () => {
    // Sending an ambassador to a farm whose landholding exceeds the cap wastes the visit AND tells the farmer their
    // refusal was a mistake, which it was not.
    expect(isFixable('aadhaar_seeding_mismatch')).toBe(true);
    expect(isFixable('documents_missing')).toBe(true);
    expect(isFixable('ineligible_landholding')).toBe(false);
    expect(isFixable('withdrawn_by_applicant')).toBe(false);
    expect(isFixable('portal_rejected')).toBe(false);
  });
  it('the fixable share is NULL when nothing is coded, never 0%', () => {
    // "0% fixable" would call off work that may be entirely fixable and simply unrecorded.
    expect(fixableShare(rejectionBreakdown([{ code: null, n: 40 }])).pct).toBeNull();
  });
  it('drops zero and negative counts rather than charting them', () => {
    const b = rejectionBreakdown([{ code: 'window_missed', n: 0 }, { code: 'other', n: -3 }]);
    expect(b.slices).toEqual([]);
    expect(b.totalRejections).toBe(0);
  });
  it('the code list matches migration 0106 exactly', () => {
    expect(REJECTION_CODES.length).toBe(11);
    expect(REJECTION_CODES).toContain('aadhaar_seeding_mismatch');
    expect(REJECTION_CODES).toContain('withdrawn_by_applicant');
  });
});

describe('ADMIN-4b · median time to disbursal', () => {
  it('converts seconds to whole days', () => {
    expect(medianDuration(24 * 86400, 120)).toEqual({ kind: 'days', days: 24, sampleSize: 120 });
  });
  it('NOTHING DISBURSED is its own state, not 0 days', () => {
    // 0 days would render the fastest possible number for the slowest possible reality.
    expect(medianDuration(null, 0, 0)).toEqual({ kind: 'none_disbursed' });
  });
  it('disbursals that cannot be timed are untimeable, not 0 and not "none"', () => {
    expect(medianDuration(null, 0, 12)).toEqual({ kind: 'untimeable', disbursals: 12 });
    expect(medianDuration(null, 5, 5)).toEqual({ kind: 'untimeable', disbursals: 5 });
  });
});

describe('ADMIN-4b · the headline carries its attribution', () => {
  it('separates attributed from unattributed credits', () => {
    const b = benefitTotal({ amountMinor: '3820000000', transfers: 14204 }, { amountMinor: '500000', transfers: 3 });
    expect(b.amountMinor).toBe('3820000000');
    expect(b.unattributedTransfers).toBe(3);
    expect(b.attributionBasis).toBe('dbt_credits_observed_against_platform_applications');
  });
  it('keeps money as a STRING and refuses a non-digit total rather than coercing it', () => {
    const b = benefitTotal({ amountMinor: '38.2', transfers: 1 }, { amountMinor: '', transfers: 0 });
    expect(b.amountMinor).toBe('0');
    expect(typeof b.amountMinor).toBe('string');
  });
  it('a 20-digit total survives intact', () => {
    const b = benefitTotal({ amountMinor: '99999999999999999999', transfers: 1 }, { amountMinor: '0', transfers: 0 });
    expect(b.amountMinor).toBe('99999999999999999999');
  });
});

describe('ADMIN-4b · the financial year is Indian', () => {
  it('runs 1 April to 31 March, not the calendar year', () => {
    // A calendar YTD on a government-scheme screen would disagree with every number the government publishes.
    expect(financialYearStart(new Date('2026-08-07T00:00:00Z')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(financialYearStart(new Date('2026-03-31T00:00:00Z')).toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(financialYearStart(new Date('2026-04-01T00:00:00Z')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
