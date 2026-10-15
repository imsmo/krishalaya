// apps/web-storefront/src/test/bill-rows.spec.ts · PC-56 HOTFIX-4 · C3 (survey F-5, founder D4) — the rows a buyer reads are the API's,
// each charge its own row when > 0, and they SUM to the API's total (BigInt check). No row is invented, none zero-padded.
import { billRows, rowsSum } from '../features/checkout/bill-rows';
import { STORE2_HOTFIX4_REFUSALS, CONFIRM_REFUSAL_KEYS, store2RefusalKey } from '../features/store2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

// the live spec's zone-tenant order: 3 qtl × 6,150.00 + zone delivery 75.00 + 2.5% platform fee + 2% buyer commission (+GST)
const PREVIEW = { currencyCode: 'INR', subtotalMinor: '1845000', deliveryFeeMinor: '7500', discountMinor: '10000', platformFeeMinor: '46125',
  buyerCommissionMinor: '43542', grandTotalMinor: '1932167', deliveryNeedsAddress: false };

describe('HOTFIX-4 · bill rows', () => {
  it('every charge > 0 is its own row (platform fee AND buyer commission); the rows sum to the API grand total', () => {
    const b = billRows(PREVIEW);
    expect(b.rows.map((r) => r.key)).toEqual(['subtotal', 'delivery', 'discount', 'platformFee', 'buyerCommission']);
    expect(b.rows.find((r) => r.key === 'discount')!.sign).toBe(-1);
    expect(rowsSum(b.rows).toString()).toBe('1932167');
    expect([b.sums, b.totalMinor, b.currencyCode]).toEqual([true, '1932167', 'INR']);
  });
  it('the buyer-commission row is what makes it sum — without it the bill would be short (the survey F-5c defect)', () => {
    const b = billRows(PREVIEW);
    expect(rowsSum(b.rows.filter((r) => r.key !== 'buyerCommission')) === 1932167n).toBe(false);
  });
  it('zero charges are NOT rows (no "Platform fee 0", no "Tax 0"); tax only when the API recorded one', () => {
    const b = billRows({ ...PREVIEW, discountMinor: '0', platformFeeMinor: '0', buyerCommissionMinor: '0', taxMinor: '0', grandTotalMinor: '1852500' });
    expect(b.rows.map((r) => r.key)).toEqual(['subtotal', 'delivery']);
    expect(b.sums).toBe(true);
    expect(billRows({ ...PREVIEW, taxMinor: '900', grandTotalMinor: '1933067' }).rows.map((r) => r.key)).toContain('tax');
  });
  it('the ORDER detail (totalMinor, the two charges returned by HOTFIX-4 A2) sums the same way', () => {
    const order = { currencyCode: 'INR', subtotalMinor: '1845000', deliveryFeeMinor: '7500', discountMinor: '10000', taxMinor: '0',
      platformFeeMinor: '46125', buyerCommissionMinor: '43542', totalMinor: '1932167' };
    expect(billRows(order).sums).toBe(true);
  });
  it('a zone store without the address: delivery is "choose your address", never a 0 as if free; fields absent are never assumed', () => {
    const b = billRows({ currencyCode: 'INR', subtotalMinor: '1845000', deliveryFeeMinor: '0', discountMinor: '0', platformFeeMinor: '46125', grandTotalMinor: '1891125', deliveryNeedsAddress: true });
    const d = b.rows.find((r) => r.key === 'delivery')!;
    expect([d.pending, d.labelKey]).toEqual([true, 'bill.deliveryNeedsAddress']);
    expect(b.deliveryNeedsAddress).toBe(true);
    expect(b.rows.map((r) => r.key)).not.toContain('buyerCommission');
  });
  it('a mismatch is DETECTED (sums=false), never papered over', () => {
    expect(billRows({ ...PREVIEW, grandTotalMinor: '1' }).sums).toBe(false);
  });
  it('every row label and the total / note keys exist in en / hi / gu', () => {
    const keys = ['bill.subtotal', 'bill.delivery', 'bill.deliveryNeedsAddress', 'bill.deliveryPending', 'bill.discount', 'bill.tax', 'bill.platformFee',
      'bill.buyerCommission', 'bill.total', 'bill.taxIncluded', 'money.unavailable'];
    for (const cat of [en, hi, gu] as Record<string, string>[]) for (const k of keys) expect([k, typeof cat[k]]).toEqual([k, 'string']);
  });
});

describe('HOTFIX-4 · refusals by name (brief §E)', () => {
  // PC-56 STORE-2c (founder D3): `auto_refund` is no longer a refusal — the automatic refund to source is BUILT; its key is retired from every
  // catalogue and the true sentence (`store2c.refund.true`) is printed instead
  it('the three remaining §E claims are named; two are rendered on the confirmation page with catalogue keys; the auto-refund refusal is retired', () => {
    expect(STORE2_HOTFIX4_REFUSALS.map((r) => r.id)).toEqual(['cod_cap', 'one_payment_group', 'price_includes_fee']);
    expect(CONFIRM_REFUSAL_KEYS).toEqual(['store2.refusal.codCap', 'store2.refusal.onePayment']);
    for (const cat of [en, hi, gu] as Record<string, string>[]) expect(cat['store2.refusal.autoRefund']).toBeUndefined();
    for (const cat of [en, hi, gu] as Record<string, string>[]) for (const k of CONFIRM_REFUSAL_KEYS) expect([k, typeof cat[k]]).toEqual([k, 'string']);
    expect(store2RefusalKey('cod_cap')).toBe('store2.refusal.codCap');
    expect(() => store2RefusalKey('price_includes_fee')).toThrow();
  });
});
