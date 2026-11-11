// apps/web-gov/src/test-render/gov2b-fixtures.ts · PC-56 GOV-2b — the authority's schemes AS GOV-2a's B3 read GIVES THEM (`gov.schemes.list /
// get / versions / diff`). Two SENTINELS ride in the objects the way a careless mapping could leak them: a money figure under the published
// fields (`amount_minor`) and a draft's content on the scheme (`draft`). The read never returns either; the pages must never print them. No
// canon person, place, body or figure: plainly test names and round test numbers.
import type { GovScheme, GovSchemeVersion, GovSchemeVersionDiff } from '@krishalaya/sdk-js';

export const SCHEME_A_ID = '0192d2c4-c000-7000-8000-00000000000a';
export const SCHEME_B_ID = '0192d2c4-c000-7000-8000-00000000000b';
export const MONEY_SENTINEL = 2400000;
export const DRAFT_SENTINEL = 'DRAFT-CONTENT-SENTINEL';

export const SCHEME_A: GovScheme = {
  id: SCHEME_A_ID, code: 'test_scheme_a', name: 'Test Scheme A', category: { code: 'test_cat', name: 'Test Category' }, isActive: true,
  version: 3, publishedAt: '2026-10-01T05:00:00.000Z', publishedBySecondPerson: true, isBackfilled: false, newerDraftExists: true, unrecordedBelow: null,
  published: {
    benefitType: 'cash_transfer', instalments: 2,
    rules: { roles: ['farmer', 'fpo_member'], landholding_max_acres: 2.5, gender: 'female', age_min: 18, age_max: 60 },
    applicationWindow: { opens: '2026-06-01', closes: '2026-08-31' },
    regions: [{ id: '0192d2c4-d000-7000-8000-000000000001', name: 'Test Region North' }],
    requiredDocuments: [{ id: '0192d2c4-e000-7000-8000-000000000001', code: 'test_doc', name: 'Test Document' }],
    formFields: [{ key: 'crop_planned', label: 'Crop planned', kind: 'text', personal: false }, { key: 'bank_account', label: 'Bank account', kind: 'text', personal: true }],
    // the sentinel: a money figure a careless mapping could print (the read never returns it)
    ...({ amount_minor: MONEY_SENTINEL } as object),
  },
  // the sentinel: a draft's content a careless mapping could print (the read never returns it)
  ...({ draft: { rules: { landholding_max_acres: 9 }, note: DRAFT_SENTINEL } } as object),
};
/** An INACTIVE scheme: one backfilled version (no recorded publisher), no rules, no form field, no instalment count. */
export const SCHEME_B: GovScheme = {
  id: SCHEME_B_ID, code: 'test_scheme_b', name: 'Test Scheme B', category: null, isActive: false,
  version: 4, publishedAt: null, publishedBySecondPerson: false, isBackfilled: true, newerDraftExists: false, unrecordedBelow: 4,
  published: { benefitType: 'in_kind', instalments: null, rules: {}, applicationWindow: null, regions: [], requiredDocuments: [], formFields: [] },
};
export const SCHEMES: GovScheme[] = [SCHEME_A, SCHEME_B];

export const VERSIONS_A: GovSchemeVersion[] = [
  { version: 3, status: 'published', publishedAt: '2026-10-01T05:00:00.000Z', publishedBySecondPerson: true, isBackfilled: false },
  { version: 2, status: 'superseded', publishedAt: '2026-07-01T05:00:00.000Z', publishedBySecondPerson: true, isBackfilled: false },
  { version: 1, status: 'superseded', publishedAt: null, publishedBySecondPerson: false, isBackfilled: true },
];
export const VERSIONS_B: GovSchemeVersion[] = [{ version: 4, status: 'published', publishedAt: null, publishedBySecondPerson: false, isBackfilled: true }];
export const DIFF_A3: GovSchemeVersionDiff = {
  version: 3, comparedWith: 2, changes: [
    { field: 'instalments', from: 1, to: 2 },
    { field: 'rules', from: { roles: ['farmer'], landholding_max_acres: 2 }, to: { roles: ['farmer', 'fpo_member'], landholding_max_acres: 2.5 } },
    { field: 'regions', from: [], to: [{ id: '0192d2c4-d000-7000-8000-000000000001', name: 'Test Region North' }] },
  ],
};
export const DIFF_B4: GovSchemeVersionDiff = { version: 4, comparedWith: null, changes: [{ field: 'benefitType', from: null, to: 'in_kind' }] };

/** W326–W329's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_2B = /₹|%|\bINR\b|rupee|\bAI\b|Joint Director|budget|sanction|district|taluka|\bIST\b|grace|\bRTI\b|court|co-pay|caste|SC\/ST|7\/12|land record|DigiLocker|penny|hectare|\bha\b|confidence|zero-sum|on-call|audit trail|maker-checker|Directorate|Gujarat|GMISS|Trivedi|Kapadia|\bDK\b/i;
