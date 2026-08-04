import { invoiceFileName } from '../features/orders/invoice';

describe('features/orders/invoice', () => {
  it('builds a safe filename from an invoice number', () => {
    expect(invoiceFileName('INV2026-000123')).toBe('invoice-INV2026-000123.pdf');
  });
  it('strips hostile characters (no path/header smuggling)', () => {
    expect(invoiceFileName('../etc/passwd\r\nX')).toBe('invoice-etcpasswdX.pdf');
  });
  it('falls back when empty/null and caps length', () => {
    expect(invoiceFileName(null)).toBe('invoice.pdf');
    expect(invoiceFileName('  ')).toBe('invoice.pdf');
    expect(invoiceFileName('A'.repeat(100))).toBe(`invoice-${'A'.repeat(60)}.pdf`);
  });
});
