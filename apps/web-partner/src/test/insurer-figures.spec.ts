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

// ── PC-56 PARTNER-2b · the issuance queue row model, the premiums counts (no money field), the parametric counts, the honest states ──
import { honestState, issuanceHref, issuanceQuery, parametricCounts, premiumsCounts, queueWindow, switchesState } from '../features/partner2/figures';

describe('PC-56 PARTNER-2b · the issuance queue (a read of proposals)', () => {
  it('the only link is the keyset page; the query takes a URL-safe cursor and NOTHING else (never a status)', () => {
    expect([issuanceHref(), issuanceHref('Y3Vyc29y')]).toEqual(['/insurer/issuance', '/insurer/issuance?cursor=Y3Vyc29y']);
    expect(issuanceQuery({ cursor: 'Y3Vyc29y', status: 'active' })).toEqual({ cursor: 'Y3Vyc29y' });
    expect(issuanceQuery({ cursor: 'bad cursor!' })).toEqual({ cursor: undefined });
    expect(issuanceQuery({ cursor: 'x'.repeat(201) })).toEqual({ cursor: undefined });
    expect(issuanceQuery(undefined)).toEqual({ cursor: undefined });
  });
  it('the cover-window hint: the window the proposal carries, or "no window given" — never an invented date', () => {
    expect(queueWindow({ validFrom: '2026-07-01', validUntil: '2026-11-30' })).toEqual({ key: 'partner2.issuance.window', from: '2026-07-01', until: '2026-11-30' });
    expect(queueWindow({ validFrom: null, validUntil: '2026-11-30' })).toEqual({ key: 'partner2.issuance.noWindow', from: null, until: null });
    expect(queueWindow({ validFrom: null, validUntil: null }).key).toBe('partner2.issuance.noWindow');
  });
});

describe('PC-56 PARTNER-2b · the premiums counts (founder Q1 — counts, never money)', () => {
  it('two integers and the as-of; the dashboard\'s Σ sum insured never reaches the shape', () => {
    const c = premiumsCounts({ computedAt: 't', policies: 3, inForce: { count: 1, sumInsuredMinor: '9007199254740993' }, proposed: 2, fpos: 2, products: 2 } as never);
    expect(c).toEqual({ active: 1, proposed: 2, computedAt: 't' });
    expect(Object.keys(c ?? {}).sort()).toEqual(['active', 'computedAt', 'proposed']);
    expect(JSON.stringify(c)).not.toMatch(/sumInsured|Minor|9007199254740993/);
    expect(premiumsCounts(null)).toBeNull();
    expect(premiumsCounts({ computedAt: 't', inForce: { count: -1 }, proposed: 1.5 })).toEqual({ active: 0, proposed: 0, computedAt: 't' });
  });
});

describe('PC-56 PARTNER-2b · the parametric counts (founder Q3 — counts, never money)', () => {
  it('own products marked parametric, and the policies in force on them only', () => {
    const items: { isParametric: boolean; policies: Record<string, number> }[] = [
      { isParametric: true, policies: { active: 2, proposed: 5, cancelled: 1 } },
      { isParametric: true, policies: {} },
      { isParametric: false, policies: { active: 9 } },
    ];
    expect(parametricCounts(items, 't')).toEqual({ products: 2, active: 2, computedAt: 't' });
    expect(parametricCounts([], null)).toEqual({ products: 0, active: 0, computedAt: null });
    expect(parametricCounts(null, 't')).toBeNull();
    expect(parametricCounts([{ isParametric: true, policies: { active: 1.5 as unknown as number } }], 't')).toEqual({ products: 1, active: 0, computedAt: 't' });
  });
});

describe('PC-56 PARTNER-2b · the honest pages\' states', () => {
  it('a read answered → ok; a failure is its failure; nothing → error', () => {
    expect([honestState({}, null), honestState(null, null), honestState({}, 'insurance_off'), honestState(null, 'off')]).toEqual(['ok', 'error', 'insurance_off', 'off']);
  });
  it('the reports page\'s state from the public flag map: console OFF → off; insurance OFF → insurance_off; both ON → ok; unreadable or partial → error', () => {
    expect(switchesState({ partner_console: true, insurance: true })).toBe('ok');
    expect(switchesState({ partner_console: false, insurance: true })).toBe('off');
    expect(switchesState({ partner_console: true, insurance: false })).toBe('insurance_off');
    expect(switchesState({ partner_console: false, insurance: false })).toBe('off');
    expect(switchesState({ partner_console: true })).toBe('error');
    expect(switchesState(null)).toBe('error');
  });
});
