import { canConfirm, canStore, canRelease, canCancel, canIssueNwr, buildNwr, buildAssay, isBookingStatus } from '../features/warehouse/manage';

describe('features/warehouse/manage (OW-2)', () => {
  it('gates mirror the booking state machine', () => {
    expect(canConfirm('requested')).toBe(true); expect(canConfirm('confirmed')).toBe(false);
    expect(canStore('confirmed')).toBe(true); expect(canStore('requested')).toBe(false);
    expect(canRelease('stored')).toBe(true); expect(canRelease('released')).toBe(false);
    expect(canCancel('requested')).toBe(true); expect(canCancel('confirmed')).toBe(true); expect(canCancel('stored')).toBe(false);
    expect(canIssueNwr('stored')).toBe(true); expect(canIssueNwr('confirmed')).toBe(false);
    expect(isBookingStatus('stored')).toBe(true); expect(isBookingStatus('nope')).toBe(false);
  });

  it('buildNwr: repo enum, enwrNo 3–60, positive float-free valuation, optional date', () => {
    expect(buildNwr({ storageBookingId: 'b1', repository: 'NERL', enwrNo: 'NERL-2026-0042', valuationMajor: '150000.50', expiresAt: '2027-03-31' }))
      .toEqual({ ok: true, value: { storageBookingId: 'b1', repository: 'NERL', enwrNo: 'NERL-2026-0042', valuationMinor: '15000050', expiresAt: '2027-03-31' } });
    expect(buildNwr({ storageBookingId: 'b1', repository: 'XXXX', enwrNo: 'abc', valuationMajor: '1', expiresAt: '' })).toEqual({ ok: false, error: 'repo' });
    expect(buildNwr({ storageBookingId: 'b1', repository: 'CCRL', enwrNo: 'ab', valuationMajor: '1', expiresAt: '' })).toEqual({ ok: false, error: 'enwrno' });
    expect(buildNwr({ storageBookingId: 'b1', repository: 'CCRL', enwrNo: 'abc', valuationMajor: '0', expiresAt: '' })).toEqual({ ok: false, error: 'valuation' });
    expect(buildNwr({ storageBookingId: 'b1', repository: 'CCRL', enwrNo: 'abc', valuationMajor: '10', expiresAt: '31-03-2027' })).toEqual({ ok: false, error: 'expires' });
  });

  it('buildAssay: name=value lines → typed parameters; number/boolean coercion; honest failures', () => {
    const r = buildAssay({ assayerName: ' Lab A ', paramsText: 'moisture = 11.5\norganic = true\ngrade = FAQ', validUntil: '2026-12-31' });
    expect(r).toEqual({ ok: true, value: { assayerName: 'Lab A', parameters: { moisture: 11.5, organic: true, grade: 'FAQ' }, validUntil: '2026-12-31' } });
    expect(buildAssay({ assayerName: '', paramsText: 'a = 1', validUntil: '' })).toEqual({ ok: false, error: 'assayer' });
    expect(buildAssay({ assayerName: 'Lab', paramsText: '', validUntil: '' })).toEqual({ ok: false, error: 'params' });
    expect(buildAssay({ assayerName: 'Lab', paramsText: 'no-equals-here', validUntil: '' })).toEqual({ ok: false, error: 'params' });
    expect(buildAssay({ assayerName: 'Lab', paramsText: 'a = 1', validUntil: 'soon' })).toEqual({ ok: false, error: 'validuntil' });
  });
});
