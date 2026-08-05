// PC-50 W10-4 · pure store-owner logic. Pins the calendar expiry maths (date compare, 30-day soon window)
// and the zod-mirror goods-inward builder (MRP rupees→minor string, expiry after mfg, strict omission).
import { expiryState, expiryTone, buildBatchDraft } from '../../features/store-owner/store';

describe('expiryState (calendar dates, not instants)', () => {
  it('expired < today; ≤30 days = expiring_soon; missing date = none', () => {
    expect(expiryState('2026-08-04', '2026-08-05')).toBe('expired');
    expect(expiryState('2026-08-20', '2026-08-05')).toBe('expiring_soon');
    expect(expiryState('2026-09-04', '2026-08-05')).toBe('expiring_soon'); // day 30
    expect(expiryState('2026-09-05', '2026-08-05')).toBe('ok');            // day 31
    expect(expiryState(null, '2026-08-05')).toBe('none');
    expect(expiryTone('expired')).toBe('danger');
  });
});

describe('buildBatchDraft (mirrors CreateBatchSchema.strict())', () => {
  it('requires product/batchNo/qty/unit; MRP converts float-free; expiry may not precede mfg', () => {
    expect(buildBatchDraft({ productId: '', batchNo: 'B1', qtyReceived: '10', unitCode: 'bag', mrpRupees: '', mfgDate: '', expiryDate: '' })).toEqual({ ok: false, error: 'product' });
    expect(buildBatchDraft({ productId: 'p1', batchNo: 'B1', qtyReceived: '0', unitCode: 'bag', mrpRupees: '', mfgDate: '', expiryDate: '' })).toEqual({ ok: false, error: 'qty' });
    expect(buildBatchDraft({ productId: 'p1', batchNo: 'B1', qtyReceived: '10', unitCode: 'bag', mrpRupees: '450.50', mfgDate: '2026-05-01', expiryDate: '2026-04-01' })).toEqual({ ok: false, error: 'order' });
    expect(buildBatchDraft({ productId: 'p1', batchNo: ' B-42 ', qtyReceived: '20', unitCode: 'bag', mrpRupees: '450', mfgDate: '', expiryDate: '2027-01-31' }))
      .toEqual({ ok: true, value: { productId: 'p1', batchNo: 'B-42', qtyReceived: 20, unitCode: 'bag', mrpMinor: '45000', expiryDate: '2027-01-31' } });
  });
});
