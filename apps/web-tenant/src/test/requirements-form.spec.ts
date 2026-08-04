import { buildRequirement, buildQuote } from '../features/requirements/form';

const base = { title: 'Need 5T wheat', quantity: '5000', unitCode: 'kg', budgetMinMajor: '', budgetMaxMajor: '', needBy: '', pincode: '', isUrgent: false };

describe('features/requirements/form (PC-28c)', () => {
  it('requirement: title/qty/unit rules; budgets ordered float-free; needBy date; 6-digit pincode', () => {
    const ok = buildRequirement({ ...base, budgetMinMajor: '20', budgetMaxMajor: '25.50', needBy: '2026-08-20', pincode: '388001', isUrgent: true });
    expect(ok).toEqual({ ok: true, value: { title: 'Need 5T wheat', quantity: '5000', unitCode: 'kg', budgetMinMinor: '2000', budgetMaxMinor: '2550', needBy: '2026-08-20', deliveryPincode: '388001', isUrgent: true } });
    expect(buildRequirement({ ...base, title: 'ab' })).toEqual({ ok: false, error: 'title' });
    expect(buildRequirement({ ...base, quantity: '0' })).toEqual({ ok: false, error: 'quantity' });
    expect(buildRequirement({ ...base, quantity: '5.1234' })).toEqual({ ok: false, error: 'quantity' });
    expect(buildRequirement({ ...base, budgetMinMajor: '30', budgetMaxMajor: '20' })).toEqual({ ok: false, error: 'budget' });
    expect(buildRequirement({ ...base, needBy: '20-08-2026' })).toEqual({ ok: false, error: 'needby' });
    expect(buildRequirement({ ...base, pincode: '38800' })).toEqual({ ok: false, error: 'pincode' });
  });

  it('quote: positive float-free price, valid qty, message ≤1000', () => {
    expect(buildQuote({ priceMajor: '22.50', quantity: '5000', message: ' Fresh stock ' }))
      .toEqual({ ok: true, value: { quotedPriceMinor: '2250', quantity: '5000', message: 'Fresh stock' } });
    expect(buildQuote({ priceMajor: '0', quantity: '5000', message: '' })).toEqual({ ok: false, error: 'price' });
    expect(buildQuote({ priceMajor: '22', quantity: '', message: '' })).toEqual({ ok: false, error: 'quantity' });
    expect(buildQuote({ priceMajor: '22', quantity: '5', message: 'x'.repeat(1001) })).toEqual({ ok: false, error: 'message' });
  });
});
