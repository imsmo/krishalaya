// apps/web-partner/src/test/lender-figures.spec.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF — the terms row model (features/partner2/figures.ts):
// rates are the lender's own stored INTEGER basis points printed as integers (never a percentage, never a float), the net is the server's integer
// difference, the amount range keeps the bigint minor-unit strings and the product's own currency, the tenure is a range / floor / ceiling / "not
// set", the kind is the registry code or "kind not registered", the documents are their codes only when every id resolves, the 30-day count is
// an integer, and the page state is OFF as OFF.
import { bpsInt, documentsText, lenderTermsRow, originationFee, shelfState, tenureText } from '../features/partner2/figures';

const P = {
  id: '0192d2c4-1111-7000-8000-000000000001', defaultName: 'Fixture seasonal credit', kind: { code: 'crop' }, currencyCode: 'INR', minAmountMinor: '5000000',
  maxAmountMinor: '9007199254740993', interestAprBps: 725, subventionBps: 300, netAprBps: 425, tenureMonthsMin: 6, tenureMonthsMax: 12, repaymentStyle: 'harvest_aligned',
  collateralKind: 'none', applications30d: 3, active: true,
};

describe('PC-56 PARTNER-2c · the lender\'s terms row model', () => {
  it('the APR, subvention and net are the stored integers as text — no percentage sign, no decimal point', () => {
    const r = lenderTermsRow(P);
    expect(r.apr).toEqual({ key: 'partner2.loanProducts.aprLine', vars: { apr: '725', subvention: '300', net: '425' } });
    for (const v of Object.values(r.apr.vars)) { expect(v).toMatch(/^-?\d+$/); expect(v).not.toMatch(/%|\./); }
    expect(lenderTermsRow({ ...P, interestAprBps: 200, subventionBps: 300, netAprBps: -100 }).apr.vars.net).toBe('-100');
    expect([bpsInt(1100), bpsInt(0), bpsInt(7.25), bpsInt(null), bpsInt(undefined)]).toEqual(['1100', '0', '0', '0', '0']);
  });
  it('the amount range keeps the bigint minor strings and the product\'s own currency; the link carries the id', () => {
    const r = lenderTermsRow({ ...P, currencyCode: 'USD' });
    expect(r.amount).toEqual({ min: '5000000', max: '9007199254740993', currency: 'USD' });
    expect(lenderTermsRow({ ...P, currencyCode: '' }).amount.currency).toBe('INR');
    expect(r.href).toBe(`/lender/products/${P.id}`);
    expect(r.name).toBe('Fixture seasonal credit');
  });
  it('the kind is the registry code, or "kind not registered"', () => {
    expect(lenderTermsRow(P).kind).toEqual({ code: 'crop' });
    expect(lenderTermsRow({ ...P, kind: { code: null } }).kind).toEqual({ key: 'partner2.loanProducts.kindNotRegistered' });
  });
  it('the tenure: a range, a floor, a ceiling or not set — whole months only', () => {
    expect(tenureText(6, 12)).toEqual({ key: 'partner2.loanProducts.tenureRange', vars: { min: '6', max: '12' } });
    expect(tenureText(6, null)).toEqual({ key: 'partner2.loanProducts.tenureFrom', vars: { min: '6' } });
    expect(tenureText(null, 12)).toEqual({ key: 'partner2.loanProducts.tenureUpTo', vars: { max: '12' } });
    expect(tenureText(null, null)).toEqual({ key: 'partner2.loanProducts.tenureNone', vars: {} });
    expect(tenureText(1.5, undefined)).toEqual({ key: 'partner2.loanProducts.tenureNone', vars: {} });
  });
  it('the documents: codes only when every stored id resolves, else the count; none → "none recorded"', () => {
    expect(documentsText({ count: 2, codes: ['aadhaar', 'land_record'] })).toEqual({ key: 'partner2.loanProducts.docsCodes', vars: { codes: 'aadhaar, land_record' } });
    expect(documentsText({ count: 2, codes: ['aadhaar'] })).toEqual({ key: 'partner2.loanProducts.docsCount', vars: { count: '2' } });
    expect(documentsText({ count: 0, codes: [] })).toEqual({ key: 'partner2.loanProducts.docsNone', vars: {} });
    expect(documentsText(null)).toEqual({ key: 'partner2.loanProducts.docsNone', vars: {} });
  });
  it('the origination fee is data: a minor string and integer bps in the product\'s currency (a malformed amount prints zero, never a float)', () => {
    expect(originationFee({ originationFeeMinor: '150000', originationFeeBps: 50, currencyCode: 'INR' })).toEqual({ minor: '150000', bps: '50', currency: 'INR' });
    expect(originationFee({ originationFeeMinor: '1.5', originationFeeBps: 0.5, currencyCode: '' })).toEqual({ minor: '0', bps: '0', currency: 'INR' });
  });
  it('the 30-day figure is an integer count; the page state is OFF as OFF, error, empty or ok', () => {
    expect(lenderTermsRow(P).applications30d).toBe(3);
    expect(lenderTermsRow({ ...P, applications30d: 2.5 }).applications30d).toBe(0);
    expect([shelfState([P], null), shelfState([], null), shelfState(null, null), shelfState([P], 'off'), shelfState([], 'error')]).toEqual(['ok', 'empty', 'error', 'off', 'error']);
  });
});
