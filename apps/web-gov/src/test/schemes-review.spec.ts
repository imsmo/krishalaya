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

describe('GW-2 DBT recording', () => {
  const { canRecordDbt, buildDbt } = require('../features/schemes/review');
  it('gate: approved|disbursed only', () => {
    expect(canRecordDbt('approved')).toBe(true); expect(canRecordDbt('disbursed')).toBe(true);
    expect(canRecordDbt('submitted')).toBe(false);
  });
  it('builder: float-free amount, date, instalment 1-60, pfmsRef <=120', () => {
    expect(buildDbt({ amountMajor: '2000', creditedOn: '2026-08-05', instalmentNo: '1', pfmsRef: 'PFMS-42' }))
      .toEqual({ ok: true, value: { amountMinor: '200000', creditedOn: '2026-08-05', instalmentNo: 1, pfmsRef: 'PFMS-42' } });
    expect(buildDbt({ amountMajor: '0', creditedOn: '2026-08-05', instalmentNo: '', pfmsRef: '' })).toEqual({ ok: false, error: 'amount' });
    expect(buildDbt({ amountMajor: '10', creditedOn: 'x', instalmentNo: '', pfmsRef: '' })).toEqual({ ok: false, error: 'date' });
    expect(buildDbt({ amountMajor: '10', creditedOn: '2026-08-05', instalmentNo: '61', pfmsRef: '' })).toEqual({ ok: false, error: 'instalment' });
  });
});
