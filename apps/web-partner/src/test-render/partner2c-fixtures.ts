// apps/web-partner/src/test-render/partner2c-fixtures.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF — the render tests' shared fixtures: the shelf as
// `GET /v1/partner/loan-products` answers it (the lender's own products; the type carries no author, applicant or partner field), one product
// with every field. Neutral names only; no institution, place or person anywhere. APR 725 bps so a float percentage would print "7.25%" (M4).
import type { PartnerLoanProduct } from '@krishalaya/sdk-js';

export const SHELF: PartnerLoanProduct[] = [
  { id: '0192d2c4-1111-7000-8000-000000000001', defaultName: 'Fixture seasonal credit', kind: { id: '0192d2c4-cccc-7000-8000-000000000001', code: 'crop' }, currencyCode: 'INR',
    minAmountMinor: '5000000', maxAmountMinor: '50000000', interestAprBps: 725, subventionBps: 300, netAprBps: 425, tenureMonthsMin: 6, tenureMonthsMax: 12, ltvBps: null,
    collateralKind: 'none', originationFeeMinor: '150000', originationFeeBps: 50, eligibilityRules: { min_land_acres: 1, crops: ['cotton'] },
    requiredDocuments: { count: 1, codes: ['land_record'] }, repaymentStyle: 'harvest_aligned', active: true, createdAt: '2026-07-12T05:00:00.000Z',
    updatedAt: '2026-08-01T05:00:00.000Z', applications30d: 3 },
  { id: '0192d2c4-2222-7000-8000-000000000002', defaultName: 'Fixture warehouse credit', kind: { id: '0192d2c4-dddd-7000-8000-000000000002', code: null }, currencyCode: 'INR',
    minAmountMinor: '10000000', maxAmountMinor: '90007199254740993', interestAprBps: 1100, subventionBps: 0, netAprBps: 1100, tenureMonthsMin: null, tenureMonthsMax: null,
    ltvBps: 7000, collateralKind: 'nwr', originationFeeMinor: '0', originationFeeBps: 0, eligibilityRules: {}, requiredDocuments: { count: 2, codes: [] },
    repaymentStyle: 'bullet', active: false, createdAt: '2026-07-01T05:00:00.000Z', updatedAt: null, applications30d: 0 },
];
export const COMPUTED_AT = '2026-10-18T06:30:00.000Z';
export const PRODUCT = { ...SHELF[0], computedAt: COMPUTED_AT, windowDays: 30 };

/** Words no 2c page may print outside the refusal list (the canon's lending-shelf claims). */
export const FALSE_2C = /13 kinds|compare (your|their|the) terms|\bopenly\b|same[- ]day|the same day|fair[- ]lending|\bceiling\b|auto[- ]?generated|qualify today|\b640\b|never the farmer|charged to your (bank|organisation)|snapshot law|Saurashtra|Gramin|\bAnand\b|\bAJ\b|Savita|Ramesh|Jayesh/i;
/** A percentage with a decimal, or any float next to "bps" / "%" (M4's wall). */
export const FLOAT_RATE = /\d+\.\d+\s*%|\d+\s*%|\d+\.\d+\s*bps/;
export const withoutRefusals = (html: string) => html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, '');
