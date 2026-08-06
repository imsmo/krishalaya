// apps/admin-api/src/modules/billing-ops/__tests__/invoice-lines.spec.ts · PC-56 ADMIN-1.
// `line_items` is jsonb written by the billing cycle, so the shape is a CONVENTION, not a constraint — the parser is
// the only thing standing between a malformed row and a finance officer reading a fabricated invoice line.
import { parseLineItems } from '../domain/invoice.entity';

describe('parseLineItems — a line we cannot trust is dropped, never zeroed', () => {
  it('reads the documented 0002 shape (snake_case) including HSN and GST rate', () => {
    expect(parseLineItems([
      { desc: 'Growth plan · Jul 2026', qty: 1, unit_minor: '499000', total_minor: '499000', hsn: '998314', gst_rate: 18 },
    ])).toEqual([
      { desc: 'Growth plan · Jul 2026', qty: 1, unitMinor: '499000', totalMinor: '499000', hsn: '998314', gstRatePct: 18 },
    ]);
  });

  it('also accepts camelCase, because two producers of this jsonb must not mean two invoices', () => {
    const [line] = parseLineItems([{ desc: 'Addon', qty: 2, unitMinor: 1500, totalMinor: 3000, gstRate: 5 }]);
    expect(line).toEqual({ desc: 'Addon', qty: 2, unitMinor: '1500', totalMinor: '3000', hsn: null, gstRatePct: 5 });
  });

  it('DROPS a line with no description or unreadable money — a ₹0.00 line is worse than a missing one', () => {
    expect(parseLineItems([
      { qty: 1, unit_minor: '100', total_minor: '100' },                       // no description
      { desc: 'Mystery', qty: 1, unit_minor: '1.5', total_minor: '100' },      // money must be integer minor units
      { desc: 'Mystery', qty: 1, unit_minor: '100', total_minor: 'free' },
      { desc: 'Mystery', qty: 1 },                                            // no money at all
      'not an object', null, 42,
    ] as unknown[])).toEqual([]);
  });

  it('never invents a total when only the unit price is readable', () => {
    // (the invoice's own subtotal_minor column remains the source of truth for the document)
    expect(parseLineItems([{ desc: 'Half a line', qty: 3, unit_minor: '900' }])).toEqual([]);
  });

  it('defaults an unusable quantity to 1 but leaves HSN and GST NULL when absent', () => {
    // qty is a display multiplier and the money is authoritative, so 1 is safe; a GUESSED HSN or GST rate is a tax
    // statement about a real invoice, so absence must read as absence.
    const [line] = parseLineItems([{ desc: 'Service', qty: 0, unit_minor: '100', total_minor: '100' }]);
    expect(line.qty).toBe(1);
    expect(line.hsn).toBeNull();
    expect(line.gstRatePct).toBeNull();
    const [neg] = parseLineItems([{ desc: 'Service', qty: -4, unit_minor: '100', total_minor: '100' }]);
    expect(neg.qty).toBe(1);
    const [bad] = parseLineItems([{ desc: 'Service', qty: 'two', unit_minor: '100', total_minor: '100' }]);
    expect(bad.qty).toBe(1);
  });

  it('keeps a NEGATIVE total (a credit line is a real line on a real invoice)', () => {
    const [line] = parseLineItems([{ desc: 'Goodwill credit', qty: 1, unit_minor: '-50000', total_minor: '-50000' }]);
    expect(line.totalMinor).toBe('-50000');
  });

  it('treats a non-array (null, object, string) as no lines rather than throwing', () => {
    for (const raw of [null, undefined, {}, '', 'x', 7]) expect(parseLineItems(raw)).toEqual([]);
  });

  it('trims whitespace but does not accept a whitespace-only description', () => {
    expect(parseLineItems([{ desc: '  Plan  ', qty: 1, unit_minor: '1', total_minor: '1' }])[0].desc).toBe('Plan');
    expect(parseLineItems([{ desc: '   ', qty: 1, unit_minor: '1', total_minor: '1' }])).toEqual([]);
    expect(parseLineItems([{ desc: 'Plan', qty: 1, unit_minor: '1', total_minor: '1', hsn: '   ' }])[0].hsn).toBeNull();
  });
});
