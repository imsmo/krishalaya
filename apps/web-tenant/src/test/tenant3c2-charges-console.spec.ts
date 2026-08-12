// PC-56 TENANT-3c-2 · W150's charge table and tax table — the console rules, and the page's own promises pinned
// against its source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  OFFERED_CALC_METHODS, amountView, canApplyProposal, canSignProposal, commodityRatesRecorded,
  earliestEffectiveFrom, isAllowedEffectiveFrom, isOfferedCalcMethod, proposeBlockedBy, readerKey, rowState, surfaceKey,
} from '../features/charges/console';

const ROW = { isTenantOverride: true, inForce: true, effectiveFrom: '2026-06-01', effectiveTo: null as string | null, isActive: true };

describe('TENANT-3c-2 · the console offers only what the engine implements', () => {
  it('per_km is never offered — the column accepts it and the pricing engine throws on it', () => {
    expect(OFFERED_CALC_METHODS).toEqual(['flat', 'percent', 'slab', 'per_unit']);
    expect(isOfferedCalcMethod('per_km')).toBe(false);
    expect(isOfferedCalcMethod('slab')).toBe(true);
    expect(isOfferedCalcMethod(undefined)).toBe(false);
  });
});

describe('TENANT-3c-2 · a price change cannot take effect today', () => {
  const now = new Date('2026-08-12T18:00:00Z');
  it('the earliest date offered is TOMORROW', () => {
    expect(earliestEffectiveFrom(now)).toBe('2026-08-13');
    expect(isAllowedEffectiveFrom('2026-08-13', now)).toBe(true);
    expect(isAllowedEffectiveFrom('2026-08-12', now)).toBe(false);
    expect(isAllowedEffectiveFrom('2026-08-01', now)).toBe(false);
    expect(isAllowedEffectiveFrom('tomorrow', now)).toBe(false);
  });
  it('and it rolls the month correctly rather than producing a 32nd', () => {
    expect(earliestEffectiveFrom(new Date('2026-08-31T18:00:00Z'))).toBe('2026-09-01');
    expect(earliestEffectiveFrom(new Date('2026-02-28T18:00:00Z'))).toBe('2026-03-01');
  });
});

describe('TENANT-3c-2 · what a row IS, in one word', () => {
  const today = '2026-08-12';
  it('a platform default in force is NOT called inactive — it is the fee being charged', () => {
    expect(rowState({ ...ROW, isTenantOverride: false }, today)).toBe('platform_default');
    expect(rowState({ ...ROW, isTenantOverride: false, inForce: false }, today)).toBe('superseded');
  });
  it('a future row is scheduled, a past-dated one ended, and the current one in force', () => {
    expect(rowState({ ...ROW, effectiveFrom: '2026-09-01' }, today)).toBe('scheduled');
    expect(rowState({ ...ROW, effectiveTo: '2026-07-31' }, today)).toBe('ended');
    expect(rowState(ROW, today)).toBe('in_force');
    expect(rowState({ ...ROW, inForce: false }, today)).toBe('superseded');
  });
});

describe('TENANT-3c-2 · the amount is rendered from the config the engine reads', () => {
  it('each method renders from its own shape, so a row cannot display one price and charge another', () => {
    expect(amountView('flat', { fee_minor: 12000 })).toEqual({ kind: 'flat', feeMinor: '12000' });
    expect(amountView('per_unit', { fee_minor: 500 })).toEqual({ kind: 'per_unit', feeMinor: '500' });
    expect(amountView('percent', { bps: 250, min_minor: 1000 }))
      .toEqual({ kind: 'percent', bps: 250, minMinor: '1000', maxMinor: null });
    expect(amountView('slab', { slabs: [{ upto_minor: 39900, fee_minor: 3900 }, { upto_minor: null, fee_minor: 0 }] }))
      .toEqual({ kind: 'slab', bands: [{ uptoMinor: '39900', feeMinor: '3900' }, { uptoMinor: null, feeMinor: '0' }] });
  });
  it('AN UNIMPLEMENTED METHOD IS NOT RENDERED AS A PRICE', () => {
    expect(amountView('per_km', { per_km_minor: 900 })).toEqual({ kind: 'unknown' });
    expect(amountView('something_new', {})).toEqual({ kind: 'unknown' });
  });
});

describe('TENANT-3c-2 · the maker may not be the checker, and the row says why a control is absent', () => {
  it('signing needs the permission, a pending proposal, and a different person', () => {
    expect(canSignProposal({ proposedBy: 'u-maker', status: 'pending' }, 'u-checker', true)).toBe(true);
    expect(canSignProposal({ proposedBy: 'u-maker', status: 'pending' }, 'u-maker', true)).toBe(false);
    expect(canSignProposal({ proposedBy: 'u-maker', status: 'pending' }, 'u-checker', false)).toBe(false);
    expect(canSignProposal({ proposedBy: 'u-maker', status: 'approved' }, 'u-checker', true)).toBe(false);
    expect(canSignProposal({ proposedBy: 'u-maker', status: 'pending' }, null, true)).toBe(false);
  });
  it('applying is offered only on an APPROVED proposal', () => {
    expect(canApplyProposal({ status: 'approved' }, true)).toBe(true);
    expect(canApplyProposal({ status: 'pending' }, true)).toBe(false);
    expect(canApplyProposal({ status: 'approved' }, false)).toBe(false);
  });
  it('a row waiting on a checker says so instead of offering a second proposal', () => {
    expect(proposeBlockedBy({ pendingProposalId: 'p1', isTenantOverride: true }, { canManage: true })).toBe('awaitingChecker');
    expect(proposeBlockedBy({ pendingProposalId: null, isTenantOverride: true }, { canManage: false })).toBe('noPermission');
    expect(proposeBlockedBy({ pendingProposalId: null, isTenantOverride: true }, { canManage: true })).toBeNull();
  });
});

describe('TENANT-3c-2 · the tax table says who applies each rule, and what is missing', () => {
  it('a recorded rule nothing reads is its own sentence', () => {
    expect(readerKey('invoice_goods_line')).toBe('invoiceGoods');
    expect(readerKey('invoice_fee_line')).toBe('invoiceFee');
    expect(readerKey('settlement')).toBe('settlement');
    expect(readerKey('not_read_by_any_code')).toBe('notRead');
    expect(readerKey('anything_else')).toBe('notRead');
  });
  it('an unknown charge surface is not labelled with a plausible one', () => {
    expect(surfaceKey('checkout')).toBe('checkout');
    expect(surfaceKey('not_read_by_any_code')).toBe('notRead');
    expect(surfaceKey('somewhere')).toBe('notRead');
  });
  it('THE LINK TO W151: zero commodity GST rates is why invoices say "rate not recorded"', () => {
    expect(commodityRatesRecorded([{ taxCode: 'gst', categoryScoped: false }, { taxCode: 'gst_service', categoryScoped: false }])).toBe(0);
    expect(commodityRatesRecorded([{ taxCode: 'gst', categoryScoped: true }, { taxCode: 'gst', categoryScoped: false }])).toBe(1);
  });
});

describe('TENANT-3c-2 · the page states its own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the tax table is presented as READ-ONLY and has no write control on the page', () => {
    const s = read('app', 'charges', 'page.tsx');
    expect(s).toContain('chg.taxReadOnly');
    expect(s).not.toMatch(/taxRuleAction|editTaxRule|proposeTaxRule/);
  });
  it('the page says which surface reads each charge, and flags a row the engine cannot compute', () => {
    const s = read('app', 'charges', 'page.tsx');
    expect(s).toContain('chg.surface.');
    expect(s).toContain('chg.notComputable');
    expect(s).toContain('chg.readBy.');
  });
  it('it says why no commodity rate is recorded, where somebody can act on it', () => {
    expect(read('app', 'charges', 'page.tsx')).toContain('chg.noCommodityRates');
  });
  it('the proposer is told they cannot also sign, rather than shown a button that fails', () => {
    expect(read('app', 'charges', 'page.tsx')).toContain('chg.youProposed');
  });
  it('every refusal is translated by NAME, and the note floor is checked before the round trip', () => {
    const s = read('app', 'charges', 'actions.ts');
    expect(s).toContain('CHARGE_EFFECTIVE_NOT_FUTURE');
    expect(s).toContain('CHARGE_CHECKER_IS_MAKER');
    expect(s).toContain('CHARGE_PROPOSAL_DUPLICATE');
    expect(s).toContain("code.startsWith('CHARGE_CONFIG_')");
    expect((s.match(/length < 20/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('chg.'));
    expect(mine.length).toBeGreaterThan(80);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
