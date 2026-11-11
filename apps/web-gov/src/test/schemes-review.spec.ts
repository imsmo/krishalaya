import { canVerify, canClarify, canDecide, canClose, isAppStatus } from '../features/schemes/review';
describe('features/schemes/review (GW-1)', () => {
  it('gates mirror the application state machine', () => {
    expect(canVerify('submitted')).toBe(true); expect(canVerify('appealed')).toBe(true); expect(canVerify('approved')).toBe(false);
    expect(canClarify('under_verification')).toBe(true); expect(canClarify('submitted')).toBe(false);
    expect(canDecide('under_verification')).toBe(true); expect(canDecide('rejected')).toBe(false);
    expect(canClose('disbursed')).toBe(true); expect(canClose('rejected')).toBe(true); expect(canClose('closed')).toBe(false);
    expect(isAppStatus('appealed')).toBe(true); expect(isAppStatus('x')).toBe(false);
  });
});

// PC-56 GOV-3a (E3): the GW-2 DBT recording block is removed WITH the dead helpers it tested (`canRecordDbt`, `buildDbt`, features/money.ts);
// no page used them. gov3-sources.spec asserts they stay gone.
