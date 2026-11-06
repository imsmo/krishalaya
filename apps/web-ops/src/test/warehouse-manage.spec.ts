import * as manage from '../features/warehouse/manage';
import { canConfirm, canStore, canRelease, canCancel, buildAssay, isBookingStatus } from '../features/warehouse/manage';
import { canRecordAssay } from '../features/ops2/receipts';

describe('features/warehouse/manage (OW-2)', () => {
  it('gates mirror the booking state machine', () => {
    expect(canConfirm('requested')).toBe(true); expect(canConfirm('confirmed')).toBe(false);
    expect(canStore('confirmed')).toBe(true); expect(canStore('requested')).toBe(false);
    expect(canRelease('stored')).toBe(true); expect(canRelease('released')).toBe(false);
    expect(canCancel('requested')).toBe(true); expect(canCancel('confirmed')).toBe(true); expect(canCancel('stored')).toBe(false);
    // PC-56 OPS-2b · NAMED UPDATE (founder Q3-A): `canIssueNwr('stored')` was true — the console offered eNWR issue. It is GONE (survey §7:
    // "canIssueNwr gone"); the assay gate is `stored` AND the named operator only (F-16, Q11-A).
    expect('canIssueNwr' in manage).toBe(false);
    expect([canRecordAssay('stored', true), canRecordAssay('confirmed', true), canRecordAssay('stored', false), canRecordAssay('requested', true)]).toEqual([true, false, false, false]);
    expect(isBookingStatus('stored')).toBe(true); expect(isBookingStatus('nope')).toBe(false);
  });

  // PC-56 OPS-2b · NAMED UPDATE (founder Q3-A): `buildNwr` (the issue form's builder, with a typed valuation) is REMOVED with the form; the
  // console builds no receipt and sends no valuation.
  it('buildNwr and NWR_REPOSITORIES are gone (no receipt is built on this console)', () => {
    expect(['buildNwr' in manage, 'NWR_REPOSITORIES' in manage]).toEqual([false, false]);
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
