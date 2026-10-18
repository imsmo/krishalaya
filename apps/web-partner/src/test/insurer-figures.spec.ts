// apps/web-partner/src/test/insurer-figures.spec.ts · PC-56 PARTNER-2a — the insurer console's presentational maths and states (pure): the kind
// rule, the landing page, the failure reading, the states, the policy number sentence, the formula from INTEGER bps (no float), the list links.
import {
  bpsText, formulaText, homeFor, insurerDashboardState, insurerFailureOf, listState, partnerKindClass, policiesHref, policiesQuery, policiesTotal,
  policyNoText, policyRef, statusKey, statusTone, subjectKey, termsText, wrongConsole, fpoLabel,
} from '../features/partner2/figures';

describe('PC-56 PARTNER-2a · the kind decides the console', () => {
  it('insurer / lender (bank, nbfc, mfi, gold_loan) / other (amc) / unknown', () => {
    expect(['insurer', 'bank', 'nbfc', 'mfi', 'gold_loan', 'amc', null, undefined, ''].map((k) => partnerKindClass(k as string | null)))
      .toEqual(['insurer', 'lender', 'lender', 'lender', 'lender', 'other', 'unknown', 'unknown', 'unknown']);
  });
  it('an insurer lands on /insurer/dashboard; a lender opening an insurer page and an insurer opening /dashboard are sent home; unknown stays', () => {
    expect([homeFor('insurer'), homeFor('bank'), homeFor(null)]).toEqual(['/insurer/dashboard', '/dashboard', '/dashboard']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('amc', 'insurer'), wrongConsole('insurer', 'insurer'), wrongConsole(null, 'insurer')]).toEqual([true, true, false, false]);
    expect([wrongConsole('insurer', 'lender'), wrongConsole('bank', 'lender'), wrongConsole(null, 'lender')]).toEqual([true, false, false]);
  });
});

describe('PC-56 PARTNER-2a · states', () => {
  it('a failed read: the API\'s named 404 → insurance_off; a 404 with the console OFF → off; anything else → error', () => {
    expect(insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')).toBe('insurance_off');
    expect(insurerFailureOf(404, 'NOT_FOUND', 'off')).toBe('off');
    expect(insurerFailureOf(404, 'NOT_FOUND', 'on')).toBe('error');
    expect(insurerFailureOf(500, 'X', 'off')).toBe('error');
    expect(insurerFailureOf(undefined, undefined, 'unknown')).toBe('error');
  });
  it('dashboard and list states', () => {
    expect(insurerDashboardState({ policies: 0, products: 0 }, null)).toBe('empty');
    expect(insurerDashboardState({ policies: 0, products: 1 }, null)).toBe('ok');
    expect(insurerDashboardState(null, null)).toBe('error');
    expect(insurerDashboardState({ policies: 1, products: 1 }, 'insurance_off')).toBe('insurance_off');
    expect([listState([], null), listState([1], null), listState(null, null), listState([1], 'off')]).toEqual(['empty', 'ok', 'error', 'off']);
  });
});

describe('PC-56 PARTNER-2a · the words of a policy and a product', () => {
  it('a NULL policy number is the honest sentence, never an invented number', () => {
    expect(policyNoText(null, 'no policy number yet')).toBe('no policy number yet');
    expect(policyNoText('  ', 'none')).toBe('none');
    expect(policyNoText('INS-1', 'none')).toBe('INS-1');
    expect(policyRef('0192d2c4-1111-7000-8000-000000000001')).toBe('0192d2c4…');
  });
  it('the formula from INTEGER bps — "3.2" from 320, "40.0" from 4000 — never a float; a flat amount stays a minor string; unpriceable is said', () => {
    expect(formulaText({ kind: 'pct_of_sum_insured', bps: 320 })).toEqual({ key: 'partner2.formula.pct', vars: { rate: '3.2', bps: '320' } });
    expect(formulaText({ kind: 'flat_minor', amountMinor: '9007199254740993' })).toEqual({ key: 'partner2.formula.flat', vars: { amountMinor: '9007199254740993' } });
    expect(formulaText({ kind: 'not_priceable' }).key).toBe('partner2.formula.notPriceable');
    expect(formulaText(null).key).toBe('partner2.formula.notPriceable');
    expect([bpsText(4000), bpsText(250), bpsText(0), bpsText(10000)]).toEqual(['40.0', '2.5', '0.0', '100.0']);
    expect(() => bpsText(2.5)).toThrow();
  });
  it('status and subject keys from the machine\'s own lists; unknown values never invent a label', () => {
    expect([statusKey('active'), statusKey('lapsing')]).toEqual(['partner2.status.active', 'partner2.status.unknown']);
    expect([statusTone('active'), statusTone('proposed'), statusTone('cancelled')]).toEqual(['ok', 'info', 'muted']);
    expect([subjectKey('animal'), subjectKey('buffalo')]).toEqual(['partner2.subject.animal', 'partner2.subject.other']);
    expect(policiesTotal({ active: 1, proposed: 2, cancelled: 1 })).toBe(4); expect(policiesTotal(null)).toBe(0);
    expect(fpoLabel(null, 'an organisation')).toBe('an organisation');
    expect(termsText({ kind: 'flat_minor', amountMinor: '1' })).toContain('"amountMinor": "1"');
  });
});

describe('PC-56 PARTNER-2a · the list\'s links — only a status of the machine and an opaque cursor', () => {
  it('builds and reads them; drops anything else', () => {
    expect([policiesHref(), policiesHref('active'), policiesHref('active', 'abc_-1'), policiesHref('lapsing', 'c')])
      .toEqual(['/insurer/policies', '/insurer/policies?status=active', '/insurer/policies?status=active&cursor=abc_-1', '/insurer/policies?cursor=c']);
    expect(policiesQuery({ status: 'proposed', cursor: 'abc' })).toEqual({ status: 'proposed', cursor: 'abc' });
    expect(policiesQuery({ status: 'x', cursor: 'a b<script>' })).toEqual({ status: undefined, cursor: undefined });
    expect(policiesQuery({ status: ['claimed', 'x'], cursor: 'z'.repeat(201) })).toEqual({ status: 'claimed', cursor: undefined });
    expect(policiesQuery(undefined)).toEqual({ status: undefined, cursor: undefined });
  });
});
