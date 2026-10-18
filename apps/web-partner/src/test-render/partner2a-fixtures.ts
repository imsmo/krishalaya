// apps/web-partner/src/test-render/partner2a-fixtures.ts · PC-56 PARTNER-2a — the render tests' shared fixtures: the insurer reads as the API
// answers them (policy FACTS only — the types carry no holder, subject, payment or tenant field). Neutral names only; no person anywhere.
import type { PartnerInsuranceDashboard, PartnerInsurancePolicy, PartnerInsuranceProduct } from '@krishalaya/sdk-js';

export const DASH: PartnerInsuranceDashboard = {
  computedAt: '2026-10-18T06:30:00.000Z', policies: 3, inForce: { count: 1, sumInsuredMinor: '9007199254740993' }, proposed: 1, fpos: 2, products: 2,
};
export const DASH_EMPTY: PartnerInsuranceDashboard = { ...DASH, policies: 0, inForce: { count: 0, sumInsuredMinor: '0' }, proposed: 0, fpos: 0, products: 0 };

export const PRODUCTS: PartnerInsuranceProduct[] = [
  { id: '0192d2c4-aaaa-7000-8000-00000000000a', productName: 'Fixture cattle cover', kind: { id: '0192d2c4-ffff-7000-8000-00000000000f', code: null },
    formula: { kind: 'pct_of_sum_insured', bps: 320 }, storedTerms: { kind: 'pct_of_sum_insured', bps: 320 }, sumInsuredRules: {},
    govtSubsidyBps: 0, ourCommissionBps: 250, isParametric: false, active: true, createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-02T05:00:00.000Z',
    policies: { active: 1, proposed: 1 } },
  { id: '0192d2c4-bbbb-7000-8000-00000000000b', productName: 'Fixture rain-index cover', kind: { id: null, code: null },
    formula: { kind: 'not_priceable' }, storedTerms: { parametric: { index: 'rainfall', thresholds_pct: [55, 40, 25] } }, sumInsuredRules: { per: 'acre' },
    govtSubsidyBps: 4000, ourCommissionBps: 0, isParametric: true, active: false, createdAt: '2026-10-01T05:00:00.000Z', updatedAt: null,
    policies: { cancelled: 1 } },
];

export const POLICIES: PartnerInsurancePolicy[] = [
  { id: '0192d2c4-1111-7000-8000-000000000001', policyNo: null, productId: PRODUCTS[0].id, productName: 'Fixture cattle cover', fpoName: 'Fixture Growers Collective',
    subjectType: 'animal', status: 'active', sumInsuredMinor: '16000000', premiumMinor: '512000', validFrom: '2026-07-12', validUntil: '2027-07-12', createdAt: '2026-07-12T05:00:00.123456Z' },
  { id: '0192d2c4-2222-7000-8000-000000000002', policyNo: 'INS-FIXTURE-0002', productId: PRODUCTS[0].id, productName: 'Fixture cattle cover', fpoName: null,
    subjectType: 'crop_season', status: 'proposed', sumInsuredMinor: '8000000', premiumMinor: '256000', validFrom: '2026-07-01', validUntil: '2026-11-30', createdAt: '2026-07-01T05:00:00.000000Z' },
];
export const POLICY = { ...POLICIES[0], computedAt: '2026-10-18T06:30:00.000Z' };
/** Words no insurer page may print (the canon's identity, health and money claims). */
export const FALSE_2A = /Savita|Hetal|Meera|Jayesh|Ramesh|\+91|ear-tag|vaccinated|holder name|T\+1|settles|receivable|automatic|auto-pay|reserves|16:00|7 years|11 kinds|BKI-|1800|ombudsman|rural sector|lapse warning|pro-rata/i;
