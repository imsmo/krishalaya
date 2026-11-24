// PC-56 SEC-4 · zod 4 applies an inner `.default()` even inside `.optional()`. Two billing fields relied on v3's rule that
// an omitted optional field stays omitted; under zod 4 they would have become 'INR':
//   • ChangePlanSchema.currency — "only to be REJECTED if it differs — never to convert": an omitted currency turned into
//     'INR' would refuse every plan change for a non-INR tenant as a currency mismatch.
//   • QueryExportSchema.currency — an omitted currency means "every currency"; 'INR' would silently drop non-INR rows.
// The INR default still applies where the field is not optional (the invoice-facing schemas).
import { ChangePlanSchema, QueryExportSchema, ApplyAdjustmentSchema } from '../dto/billing-ops.dto';

const PLAN = '0190a8b2-0000-7000-8000-000000000301';
const TENANT = '0190a8b2-0000-7000-8000-000000000302';

describe('SEC-4 · an omitted optional currency stays omitted (zod 4)', () => {
  it('a plan change without a currency carries none — never INR', () => {
    const r = ChangePlanSchema.parse({ planId: PLAN, priceMinor: '99900', billingCycle: 'monthly', reason: 'customer asked for annual' });
    expect(r.currency).toBeUndefined();
    expect('currency' in r).toBe(false);
  });

  it('a plan change WITH a currency keeps it (it is still checked, not converted)', () => {
    const r = ChangePlanSchema.parse({ planId: PLAN, priceMinor: '99900', billingCycle: 'monthly', currency: 'BDT', reason: 'customer asked for annual' });
    expect(r.currency).toBe('BDT');
  });

  it('an export without a currency is not narrowed to INR', () => {
    const r = QueryExportSchema.parse({ report: 'invoices' });
    expect(r.currency).toBeUndefined();
    expect('currency' in r).toBe(false);
    expect(r.limit).toBe(1000);   // a non-optional default still applies
  });

  it('where currency is NOT optional, the INR default still applies', () => {
    const r = ApplyAdjustmentSchema.parse({ tenantId: TENANT, amountMinor: '100', direction: 'credit', reason: 'goodwill credit for an outage', idempotencyKey: 'adj-sec4-0001' });
    expect(r.currency).toBe('INR');
  });
});
