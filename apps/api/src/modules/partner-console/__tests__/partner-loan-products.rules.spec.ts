// modules/partner-console/__tests__/partner-loan-products.rules.spec.ts · PC-56 PARTNER-2c · founder Q7 — the shelf's projection STRIPS the
// person fields BY CONSTRUCTION (for ANY input row — even one a widened definer handed over, mutant M3), the net APR is an integer difference
// of the stored bps, money stays a bigint string, the kind falls back to null ("not registered"), the shards' counts add.
import { LOAN_PRODUCT_PERSON_FIELDS, mergeShelfCounts, netAprBps, projectLoanProduct, SHELF_WINDOW_DAYS } from '../domain/partner-loan-products.rules';

function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const FORBIDDEN = new Set<string>(LOAN_PRODUCT_PERSON_FIELDS);

/** A row carrying EVERY column of loan_products (0011) and then some — snake and camel, with the people who wrote it. */
const POISONED: Record<string, unknown> = {
  id: '0192d2c4-aaaa-7000-8000-000000000001', partner_id: 'ffffffff-0000-7000-8000-000000000009', partnerId: 'ffffffff-0000-7000-8000-000000000009',
  product_kind_id: 'cccccccc-0000-7000-8000-000000000003', kind_code: 'kcc', default_name: 'Fixture seasonal credit', currency_code: 'INR',
  min_amount_minor: '5000000', max_amount_minor: '50000000', interest_apr_bps: 725, subvention_bps: 300, tenure_months_min: 6, tenure_months_max: 12,
  ltv_bps: null, collateral_kind: 'none', origination_fee_minor: '150000', origination_fee_bps: 50, eligibility_rules: { min_land_acres: 1 },
  required_doc_type_ids: ['11111111-0000-7000-8000-000000000001', 'not-a-doc'], required_doc_codes: ['aadhaar'], repayment_style: 'harvest_aligned',
  is_active: true, created_at: '2026-07-12T05:00:00.000Z', updated_at: '2026-08-01T05:00:00.000Z',
  created_by: 'bbbbbbbb-0000-7000-8000-000000000002', createdBy: 'bbbbbbbb-0000-7000-8000-000000000002', updated_by: 'dddddddd-0000-7000-8000-000000000004',
  updatedBy: 'dddddddd-0000-7000-8000-000000000004', applicant_user_id: 'eeeeeeee-0000-7000-8000-000000000005', holder: { phone: '+910000000000' },
  name: 'A person', phone: '+910000000000',
};

describe('PC-56 PARTNER-2c · the lender\'s shelf — the projection strips the person fields for ANY input', () => {
  it('a product: only the terms; no createdBy / updatedBy / applicant / holder / name / phone / partner property — and none of their values', () => {
    const v = projectLoanProduct(POISONED, 3);
    expect(deepKeys(v).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    expect(Object.keys(v).sort()).toEqual(['active', 'applications30d', 'collateralKind', 'createdAt', 'currencyCode', 'defaultName', 'eligibilityRules', 'id', 'interestAprBps', 'kind',
      'ltvBps', 'maxAmountMinor', 'minAmountMinor', 'netAprBps', 'originationFeeBps', 'originationFeeMinor', 'repaymentStyle', 'requiredDocuments', 'subventionBps',
      'tenureMonthsMax', 'tenureMonthsMin', 'updatedAt']);
    const json = JSON.stringify(v);
    for (const leaked of ['bbbbbbbb', 'dddddddd', 'eeeeeeee', 'ffffffff', '+910000000000', 'A person']) expect([leaked, json.includes(leaked)]).toEqual([leaked, false]);
    expect(v).toMatchObject({ defaultName: 'Fixture seasonal credit', kind: { id: 'cccccccc-0000-7000-8000-000000000003', code: 'kcc' }, currencyCode: 'INR',
      minAmountMinor: '5000000', maxAmountMinor: '50000000', interestAprBps: 725, subventionBps: 300, netAprBps: 425, tenureMonthsMin: 6, tenureMonthsMax: 12, ltvBps: null,
      collateralKind: 'none', originationFeeMinor: '150000', originationFeeBps: 50, eligibilityRules: { min_land_acres: 1 }, requiredDocuments: { count: 2, codes: ['aadhaar'] },
      repaymentStyle: 'harvest_aligned', active: true, applications30d: 3, createdAt: '2026-07-12T05:00:00.000Z' });
  });
  it('for many generated rows, no person field ever survives', () => {
    for (let i = 0; i < 200; i++) {
      const row: Record<string, unknown> = { ...POISONED };
      for (const f of LOAN_PRODUCT_PERSON_FIELDS) row[f] = i % 2 ? `v-${i}` : { nested: { [f]: i } };
      expect(deepKeys(projectLoanProduct(row, i)).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    }
  });
  it('the net APR is the integer difference of the stored bps — never a float; rates stay integers', () => {
    expect(netAprBps(725, 300)).toBe(425);
    expect(netAprBps(1100, 0)).toBe(1100);
    expect(netAprBps(200, 300)).toBe(-100);   // printed raw, as the data says
    const v = projectLoanProduct({ ...POISONED, interest_apr_bps: '1150', subvention_bps: '0' }, 0);
    expect([v.interestAprBps, v.subventionBps, v.netAprBps].every(Number.isInteger)).toBe(true);
    expect(v.netAprBps).toBe(1150);
    expect(projectLoanProduct({ ...POISONED, interest_apr_bps: 7.25 }, 0).interestAprBps).toBe(0);   // a float never passes as a rate
  });
  it('money stays a bigint minor-unit string past 2^53; the currency is the product\'s own', () => {
    const v = projectLoanProduct({ ...POISONED, max_amount_minor: '9007199254740993', currency_code: 'USD' }, 0);
    expect(v.maxAmountMinor).toBe('9007199254740993');
    expect(v.currencyCode).toBe('USD');
    expect(projectLoanProduct({ ...POISONED, origination_fee_minor: '1.5' }, 0).originationFeeMinor).toBe('0');
  });
  it('the kind falls back to null when the id does not resolve ("kind not registered"); no ids → a zero count', () => {
    const v = projectLoanProduct({ ...POISONED, kind_code: null, required_doc_type_ids: [], required_doc_codes: [] }, 0);
    expect(v.kind).toEqual({ id: 'cccccccc-0000-7000-8000-000000000003', code: null });
    expect(v.requiredDocuments).toEqual({ count: 0, codes: [] });
    expect(projectLoanProduct({ ...POISONED, required_doc_type_ids: 'garbage', required_doc_codes: null }, 0).requiredDocuments).toEqual({ count: 0, codes: [] });
  });
  it('a negative or fractional count is never printed; the shards\' counts add', () => {
    expect(projectLoanProduct(POISONED, -1).applications30d).toBe(0);
    expect(projectLoanProduct(POISONED, 1.5).applications30d).toBe(0);
    expect(mergeShelfCounts([{ a: 2, b: 1 }, { a: 3 }, {}])).toEqual({ a: 5, b: 1 });
    expect(SHELF_WINDOW_DAYS).toBe(30);
  });
});
