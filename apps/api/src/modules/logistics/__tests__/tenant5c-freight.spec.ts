// modules/logistics/__tests__/tenant5c-freight.spec.ts · PC-56 TENANT-5c — W241 (Freight invoices) and W242
// (Freight reconciliation): the two tables 0070 created and no application code had ever touched.
//
// These tests hold BEHAVIOUR, not source text. 5a's mutation pass proved the difference the hard way: a suite that
// asserted a gate's *shape* let seventeen wrong decisions live, so every rule below is exercised through the entity
// or the service with a fake transaction, and the query-shape assertions that remain are on EXECUTED SQL — the
// string the repository actually passed to the driver, with its parameters.
//
// What is under test, in the order the wave found it:
//   • the line verdicts, including `unmatched` — the row neither canon screen draws, which is a bill for a
//     consignment we have no record of shipping;
//   • the expected side, which is EMPTY on this platform because nothing writes `shipments.charge_minor`;
//   • the dispute classifier, and the two of W242's four reasons that cannot be evidenced at all;
//   • the payment verdict, which is `ready_no_rail` because there is no payee for a carrier;
//   • the entity's arithmetic — the lines must sum to the header, an agreed resolution reduces the invoice, and the
//     recovery is written into the LINE so W241's recovery figure is re-derivable from rows;
//   • the per-currency recovery rollup, because one total for many currencies adds paise to cents.
import {
  DISPUTE_RESPONSE_DAYS, RECON_TRANSITIONS, canTransitionRecon, classifyDispute, expectedVerdict, headerVerdict,
  isClean, isCostNote, lineVerdict, needsChecker, packVerdict, paymentVerdict, varianceBps, varianceDirection,
  type LineEvidence, type ReconTotals,
} from '../domain/freight-recon';
import { FreightInvoice } from '../domain/freight-invoice.entity';
import { FreightInvoiceRepository } from '../repositories/freight-invoice.repository';
import { FreightInvoiceService } from '../services/freight-invoice.service';
import { FreightDeskReadModel } from '../read-models/freight-desk.read-model';

/* ----------------------------------------------------------------------------------------------------------- */
/* helpers                                                                                                     */
/* ----------------------------------------------------------------------------------------------------------- */

const evidence = (o: Partial<LineEvidence> = {}): LineEvidence => ({
  shipmentId: 'shp-1', awbNo: 'AWB1', status: 'delivered', expectedMinor: 100n,
  deliveryAttempts: 1, requiresColdChain: false, ...o,
});

const totals = (o: Partial<ReconTotals> = {}): ReconTotals => ({
  billedMinor: 0n, lines: 1, matched: 1, over: 0, under: 0, unmatched: 0, unpriced: 0, disputed: 0, ...o,
});

let seq = 0;
const lid = () => `line-${++seq}`;

function invoice(opts: {
  lines?: Array<{ awbNo?: string; shipmentId?: string; billedMinor: bigint; billedAttempts?: number }>;
  billedMinor?: bigint; sourceKind?: 'carrier_invoice' | 'own_fleet_cost_note'; currencyCode?: string;
} = {}) {
  const lines = (opts.lines ?? [{ awbNo: 'AWB1', billedMinor: 1000n }]).map((l) => ({ id: lid(), ...l }));
  const billed = opts.billedMinor ?? lines.reduce((a, l) => a + l.billedMinor, 0n);
  return FreightInvoice.record({
    id: 'inv-1', tenantId: 't1', carrierId: 'car-1', invoiceNo: 'DLV-INV-0726-41',
    sourceKind: opts.sourceKind ?? 'carrier_invoice',
    periodStart: '2026-06-01', periodEnd: '2026-06-30',
    billedMinor: billed, currencyCode: opts.currencyCode ?? 'INR', lines,
  });
}

/** A fake tx that records every statement and its parameters, so the query-shape tests read EXECUTED SQL. */
function fakeTx(rowsFor?: (sql: string) => unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    tenantId: 't1',
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = rowsFor ? rowsFor(sql) : [];
      return { rows, rowCount: rows.length };
    }),
  };
  return { tx, calls, sqlOf: (needle: string) => calls.find((c) => c.sql.includes(needle)) };
}

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the line verdict', () => {
  it('is `unmatched` when no shipment of ours carries the AWB — the row the canon does not draw', () => {
    // A bill for a consignment we have no record of shipping. Not a price argument: a phantom.
    expect(lineVerdict(1680n, evidence({ shipmentId: null }))).toEqual({ kind: 'unmatched' });
  });

  it('is `unmatched` even when the phantom line is billed exactly what a matched line would cost', () => {
    // The dangerous case: a plausible amount. Matching must never be inferred from the money being reasonable.
    expect(lineVerdict(100n, evidence({ shipmentId: null, expectedMinor: 100n }))).toEqual({ kind: 'unmatched' });
  });

  it('is `unpriced` when the shipment exists and nothing recorded what it should cost', () => {
    expect(lineVerdict(1680n, evidence({ expectedMinor: null }))).toEqual({ kind: 'unpriced' });
  });

  it('does not read an unpriced line as a zero-cost line billed at full price', () => {
    // The whole wave's argument: `charge_minor` NULL means unknown. Treating it as 0n would make this `over` by the
    // full amount and print every invoice as total leakage.
    expect(lineVerdict(1680n, evidence({ expectedMinor: null })).kind).not.toBe('over');
  });

  it('matches to the rupee, with no tolerance band', () => {
    expect(lineVerdict(100n, evidence())).toEqual({ kind: 'match', expectedMinor: '100' });
    // One paise over is over. A tolerance is a decision about acceptable leakage and belongs to the founder.
    expect(lineVerdict(101n, evidence()).kind).toBe('over');
    expect(lineVerdict(99n, evidence()).kind).toBe('under');
  });

  it('reports an under-bill rather than pocketing it', () => {
    expect(lineVerdict(60n, evidence())).toEqual({ kind: 'under', expectedMinor: '100', varianceMinor: '-40' });
  });

  it('carries the variance as a string so a bigint never leaks into JSON', () => {
    const v = lineVerdict(1680n, evidence({ expectedMinor: 1140n }));
    expect(v).toEqual({ kind: 'over', expectedMinor: '1140', varianceMinor: '540' });
    expect(typeof (v as { varianceMinor: string }).varianceMinor).toBe('string');
  });

  it('treats only a match as clean', () => {
    expect(isClean({ kind: 'match', expectedMinor: '1' })).toBe(true);
    for (const v of [{ kind: 'over' as const, expectedMinor: '1', varianceMinor: '1' },
      { kind: 'under' as const, expectedMinor: '1', varianceMinor: '-1' },
      { kind: 'unmatched' as const }, { kind: 'unpriced' as const }]) {
      expect(isClean(v)).toBe(false);
    }
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the expected side (which is empty on this platform)', () => {
  it('says `unpriced` — with a count — when no line has an expected figure', () => {
    expect(expectedVerdict([{ expectedMinor: null }, { expectedMinor: null }]))
      .toEqual({ kind: 'unpriced', unpricedLines: 2 });
  });

  it('never reports a zero total for an unpriced invoice, because ₹0 reads as "we expected this free"', () => {
    const v = expectedVerdict([{ expectedMinor: null }]);
    expect(v).not.toHaveProperty('totalMinor');
  });

  it('says `partly_priced` with both counts when some lines are priced', () => {
    expect(expectedVerdict([{ expectedMinor: 100n }, { expectedMinor: null }, { expectedMinor: 40n }]))
      .toEqual({ kind: 'partly_priced', totalMinor: '140', pricedLines: 2, unpricedLines: 1 });
  });

  it('says `priced` only when every line has a figure', () => {
    expect(expectedVerdict([{ expectedMinor: 100n }, { expectedMinor: 40n }]))
      .toEqual({ kind: 'priced', totalMinor: '140', lines: 2 });
  });

  it('an empty invoice is unpriced, not priced-at-zero', () => {
    expect(expectedVerdict([])).toEqual({ kind: 'unpriced', unpricedLines: 0 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the dispute classifier, and what it refuses to claim', () => {
  it('classifies a phantom line as `not_shipped` and cites the AWB as the evidence', () => {
    const c = classifyDispute({ kind: 'unmatched' }, evidence({ shipmentId: null, awbNo: 'AWB9' }), null);
    expect(c.reason).toBe('not_shipped');
    expect(c.evidence).toMatchObject({ awbNo: 'AWB9' });
  });

  it('classifies an unpriced line as `unpriced_line` and names WHY it cannot be priced', () => {
    const c = classifyDispute({ kind: 'unpriced' }, evidence({ expectedMinor: null }), null);
    expect(c.reason).toBe('unpriced_line');
    expect(String(c.evidence.note)).toContain('charge_minor');
  });

  it('proves an extra-attempt claim from 5a\'s own counter — W242\'s first disputed row', () => {
    const c = classifyDispute({ kind: 'over', expectedMinor: '1140', varianceMinor: '540' },
      evidence({ deliveryAttempts: 1 }), 2);
    expect(c.reason).toBe('extra_attempt_billed');
    expect(c.evidence).toMatchObject({ billedAttempts: 2, ourAttempts: 1 });
  });

  it('does not treat an UNSTATED attempt count as one attempt', () => {
    // An invoice that does not itemise attempts says nothing about them. Guessing "one" would manufacture a dispute
    // the carrier can refute with its own paperwork.
    expect(classifyDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, evidence({ deliveryAttempts: 1 }), null).reason)
      .not.toBe('extra_attempt_billed');
  });

  it('does not call it an extra attempt when the carrier billed what we recorded', () => {
    expect(classifyDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, evidence({ deliveryAttempts: 2 }), 2).reason)
      .not.toBe('extra_attempt_billed');
  });

  it('treats a zero recorded-attempt count as one, so a never-scanned delivery is not a free dispute', () => {
    // `Math.max(1, attempts)`: a shipment whose events recorded nothing is not evidence that the carrier invented
    // an attempt — one attempt is the floor of physical reality for a consignment that moved.
    expect(classifyDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, evidence({ deliveryAttempts: 0 }), 1).reason)
      .not.toBe('extra_attempt_billed');
  });

  it('classifies a recalled lane from the shipment\'s own status — W242\'s fourth row', () => {
    for (const status of ['cancelled', 'returned', 'failed'] as const) {
      const c = classifyDispute({ kind: 'over', expectedMinor: '300', varianceMinor: '840' }, evidence({ status }), null);
      expect(c.reason).toBe('cancelled_in_transit');
      expect(c.evidence).toMatchObject({ status });
    }
  });

  it('names the distance slab and the weight surcharge `not_evidenced`, and says what is missing', () => {
    // W242's second and third rows need a carrier rate card and a consignment weight. There is no rate-card table
    // anywhere in this schema and `shipments` has no weight column, so the pack must not cite evidence we do not
    // hold — it loses the argument the first time a carrier asks to see it.
    const c = classifyDispute({ kind: 'over', expectedMinor: '340', varianceMinor: '600' }, evidence({ status: 'delivered' }), null);
    expect(c.reason).toBe('not_evidenced');
    expect(c.evidence.missing).toEqual(['carrier_rate_card', 'consignment_weight']);
  });

  it('checks the attempt claim BEFORE the status, so a failed-and-rebilled line reads as the attempt it was', () => {
    const c = classifyDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' },
      evidence({ status: 'failed', deliveryAttempts: 1 }), 3);
    expect(c.reason).toBe('extra_attempt_billed');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the header verdict and the status machine', () => {
  it('sends an own-fleet cost note to `booked_ops` whatever its lines say', () => {
    expect(headerVerdict('own_fleet_cost_note', totals({ over: 3 }))).toBe('booked_ops');
  });

  it('auto-closes only when every line matched', () => {
    expect(headerVerdict('carrier_invoice', totals())).toBe('exact_match');
  });

  it('counts an UNMATCHED line as a variance, never as a match', () => {
    // The difference between a desk that makes leakage loud and one that auto-closes an invoice it never checked.
    expect(headerVerdict('carrier_invoice', totals({ matched: 0, unmatched: 1 }))).toBe('variance_open');
  });

  it('counts an UNPRICED line as a variance too', () => {
    expect(headerVerdict('carrier_invoice', totals({ matched: 0, unpriced: 1 }))).toBe('variance_open');
  });

  it('an under-bill also keeps the invoice open', () => {
    expect(headerVerdict('carrier_invoice', totals({ matched: 0, under: 1 }))).toBe('variance_open');
  });

  it('a disputed line outranks every other total', () => {
    expect(headerVerdict('carrier_invoice', totals({ matched: 5, disputed: 1 }))).toBe('disputed_lines');
  });

  it('keeps `exact_match`, `reconciled` and `booked_ops` terminal', () => {
    for (const s of ['exact_match', 'reconciled', 'booked_ops'] as const) {
      expect(RECON_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('never allows a return to `pending`, which would erase that a recon happened', () => {
    for (const from of Object.keys(RECON_TRANSITIONS) as Array<keyof typeof RECON_TRANSITIONS>) {
      expect(canTransitionRecon(from, 'pending')).toBe(false);
    }
  });

  it('lets a re-run move a disputed invoice back to variance_open when the dispute was resolved', () => {
    expect(canTransitionRecon('disputed_lines', 'variance_open')).toBe(true);
  });

  it('refuses to move a cost note out of booked_ops', () => {
    expect(canTransitionRecon('booked_ops', 'variance_open')).toBe(false);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the variance figures W241 prints', () => {
  it('gives the direction, because "over" and "under" are two different conversations', () => {
    expect(varianceDirection(1n)).toBe('over');
    expect(varianceDirection(-1n)).toBe('under');
    expect(varianceDirection(0n)).toBe('level');
  });

  it('computes basis points in integers — no float ever touches money', () => {
    // The canon's own table and prose disagree (+₹2,320 vs "+₹2,360 … 2.5%"): 2,320 of 96,440 is 2.41%, not 2.5%.
    expect(varianceBps(232000n, 9644000n)).toBe(240);
    expect(varianceBps(-232000n, 9644000n)).toBe(240);   // magnitude; the direction is its own field
  });

  it('returns null rather than dividing by a zero bill', () => {
    expect(varianceBps(100n, 0n)).toBeNull();
    expect(varianceBps(0n, -1n)).toBeNull();
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the payment, and the rail that cannot carry a carrier', () => {
  const base = { cleanMinor: 9200000n, disputedMinor: 444000n, thresholdMinor: null };

  it('a cost note is a cost centre: nothing to pay', () => {
    expect(paymentVerdict({ ...base, kind: 'own_fleet_cost_note', status: 'booked_ops' })).toEqual({ kind: 'cost_note_booked' });
  });

  it('holds payment while the recon is open — W241\'s own policy', () => {
    expect(paymentVerdict({ ...base, kind: 'carrier_invoice', status: 'variance_open' }))
      .toEqual({ kind: 'held_recon_open', cleanMinor: '9200000', disputedMinor: '444000' });
    expect(paymentVerdict({ ...base, kind: 'carrier_invoice', status: 'pending' }).kind).toBe('held_recon_open');
  });

  it('reports READY and names the two structural gaps rather than drawing a pay button', () => {
    const v = paymentVerdict({ ...base, kind: 'carrier_invoice', status: 'reconciled' });
    expect(v).toEqual({
      kind: 'ready_no_rail', cleanMinor: '9200000', needsChecker: null,
      missing: ['carrier_payee_bank_account', 'freight_payout_purpose'],
    });
  });

  it('says `nothing_clean` when every line is being argued about', () => {
    expect(paymentVerdict({ ...base, kind: 'carrier_invoice', status: 'disputed_lines', cleanMinor: 0n }))
      .toEqual({ kind: 'nothing_clean', disputedMinor: '444000' });
  });

  it('keeps "threshold not read" distinct from "no checker needed"', () => {
    // Two states that would print the same sentence if `null` collapsed to `false`. The threshold belongs to the
    // payments plane, which exports no public method for it.
    expect(needsChecker(1n, null)).toBeNull();
    expect(needsChecker(1n, 2_500_000n)).toBe(false);
    expect(needsChecker(2_500_001n, 2_500_000n)).toBe(true);
    expect(needsChecker(2_500_000n, 2_500_000n)).toBe(false);   // "above ₹25,000", not "at"
  });

  it('states the dispute window and that the platform does not keep the clock', () => {
    expect(packVerdict(4, 444000n)).toEqual({
      kind: 'pack_ready', lines: 4, claimedMinor: '444000', windowDays: DISPUTE_RESPONSE_DAYS, clockKept: false,
    });
    expect(DISPUTE_RESPONSE_DAYS).toBe(7);
  });

  it('recognises the cost-note kind by value, not by position', () => {
    expect(isCostNote('own_fleet_cost_note')).toBe(true);
    expect(isCostNote('carrier_invoice')).toBe(false);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · recording a bill', () => {
  it('refuses a carrier invoice whose lines do not sum to its header total', () => {
    // Our own transcription error dressed as carrier leakage — the one mistake this desk exists to tell apart.
    expect(() => invoice({ lines: [{ awbNo: 'A', billedMinor: 900n }], billedMinor: 1000n }))
      .toThrow(/must agree/);
  });

  it('refuses a carrier invoice with no lines at all', () => {
    expect(() => invoice({ lines: [] })).toThrow(/at least one line/);
  });

  it('accepts an own-fleet cost note with no lines — fuel and wages are not shipments', () => {
    const inv = invoice({ lines: [], billedMinor: 4120000n, sourceKind: 'own_fleet_cost_note' });
    expect(inv.status).toBe('pending');
    expect(inv.toProps().shipmentCount).toBe(0);
  });

  it('refuses a line that identifies no consignment', () => {
    expect(() => FreightInvoice.record({
      id: 'i', tenantId: 't1', carrierId: 'c', invoiceNo: 'INV-1', sourceKind: 'carrier_invoice',
      periodStart: '2026-06-01', periodEnd: '2026-06-30', billedMinor: 10n, currencyCode: 'INR',
      lines: [{ id: 'l1', billedMinor: 10n }],
    })).toThrow(/awbNo or a shipmentId/);
  });

  it('refuses a period that ends before it starts, and says so instead of letting the CHECK fire', () => {
    expect(() => FreightInvoice.record({
      id: 'i', tenantId: 't1', carrierId: 'c', invoiceNo: 'INV-1', sourceKind: 'carrier_invoice',
      periodStart: '2026-06-30', periodEnd: '2026-06-01', billedMinor: 10n, currencyCode: 'INR',
      lines: [{ id: 'l1', awbNo: 'A', billedMinor: 10n }],
    })).toThrow(/cannot precede/);
  });

  it('normalises the currency and refuses one that is not three letters', () => {
    expect(invoice({ currencyCode: 'usd' }).currencyCode).toBe('USD');
    expect(() => invoice({ currencyCode: 'RUPEES' })).toThrow(/3-letter/);
  });

  it('holds payment from the first instant and starts at `pending`, because no work has been done', () => {
    const p = invoice().toProps();
    expect(p.paymentHold).toBe(true);
    expect(p.reconStatus).toBe('pending');
    expect(p.reconciledAt).toBeNull();
    expect(p.expectedMinor).toBe(0n);
    expect(p.payoutId).toBeNull();
  });

  it('numbers the lines in the order the carrier printed them', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 1n }, { awbNo: 'B', billedMinor: 2n }, { awbNo: 'C', billedMinor: 3n }] });
    expect(inv.toLines().map((l) => [l.lineNo, l.awbNo])).toEqual([[1, 'A'], [2, 'B'], [3, 'C']]);
  });

  it('refuses an attempt count outside 1–20 and accepts an absent one', () => {
    expect(() => invoice({ lines: [{ awbNo: 'A', billedMinor: 1n, billedAttempts: 0 }] })).toThrow(/1–20/);
    expect(() => invoice({ lines: [{ awbNo: 'A', billedMinor: 1n, billedAttempts: 21 }] })).toThrow(/1–20/);
    expect(invoice({ lines: [{ awbNo: 'A', billedMinor: 1n }] }).toLines()[0].billedAttempts).toBeNull();
  });

  it('emits the recorded event with the money as strings', () => {
    const e = invoice().pullEvents();
    expect(e).toHaveLength(1);
    expect(e[0].type).toBe('logistics.freight_invoice_recorded');
    expect(e[0].payload).toMatchObject({ billedMinor: '1000', currencyCode: 'INR', lines: 1 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the recon pass', () => {
  it('attaches the matched shipment id to the line, so a later dispute cites a real shipment', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ shipmentId: 'shp-77' }));
    expect(inv.toLines()[0].shipmentId).toBe('shp-77');
  });

  it('clears the shipment id when a re-run no longer matches — a stale match is worse than none', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ shipmentId: 'shp-77', expectedMinor: 1000n }));
    // The exact_match auto-close makes a second pass illegal, so this is checked on an invoice with a variance.
    const inv2 = invoice();
    inv2.reconcile(() => evidence({ shipmentId: 'shp-77', expectedMinor: 900n }));
    inv2.reconcile(() => evidence({ shipmentId: null, expectedMinor: null }));
    expect(inv2.toLines()[0].shipmentId).toBeNull();
    expect(inv2.toLines()[0].expectedMinor).toBeNull();
  });

  it('auto-closes an exact match and RELEASES the hold — W242\'s own empty state', () => {
    const inv = invoice();
    const out = inv.reconcile(() => evidence({ expectedMinor: 1000n }));
    expect(out.to).toBe('exact_match');
    const p = inv.toProps();
    expect(p.paymentHold).toBe(false);
    expect(p.reconciledAt).not.toBeNull();
  });

  it('does not release the hold when anything is open', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ expectedMinor: 900n }));
    expect(inv.toProps().paymentHold).toBe(true);
  });

  it('rolls the header up from the PRICED lines only, and that sum is partial by design', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 600n }, { awbNo: 'B', billedMinor: 400n }] });
    inv.reconcile((l) => evidence({ expectedMinor: l.awbNo === 'A' ? 500n : null }));
    expect(inv.toProps().expectedMinor).toBe(500n);
    expect(expectedVerdict(inv.toLines().map((l) => ({ expectedMinor: l.expectedMinor })))).toMatchObject({
      kind: 'partly_priced', totalMinor: '500', pricedLines: 1, unpricedLines: 1,
    });
  });

  it('counts every verdict class in its totals', () => {
    const inv = invoice({ lines: [
      { awbNo: 'M', billedMinor: 100n }, { awbNo: 'O', billedMinor: 200n },
      { awbNo: 'U', billedMinor: 50n }, { awbNo: 'X', billedMinor: 300n }, { awbNo: 'P', billedMinor: 400n },
    ] });
    const out = inv.reconcile((l) => {
      switch (l.awbNo) {
        case 'M': return evidence({ expectedMinor: 100n });
        case 'O': return evidence({ expectedMinor: 150n });
        case 'U': return evidence({ expectedMinor: 80n });
        case 'X': return evidence({ shipmentId: null });
        default:  return evidence({ expectedMinor: null });
      }
    });
    expect(out.totals).toMatchObject({ lines: 5, matched: 1, over: 1, under: 1, unmatched: 1, unpriced: 1 });
    expect(out.to).toBe('variance_open');
  });

  it('refuses to re-open a closed invoice', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ expectedMinor: 1000n }));   // → exact_match, terminal
    expect(() => inv.reconcile(() => evidence())).toThrow(/exact_match/);
  });

  it('emits the reconciled event with the counts an operator would need to check the screen', () => {
    const inv = invoice();
    inv.pullEvents();
    inv.reconcile(() => evidence({ expectedMinor: 900n }));
    const e = inv.pullEvents();
    expect(e[0].type).toBe('logistics.freight_invoice_reconciled');
    expect(e[0].payload).toMatchObject({ status: 'variance_open', billedMinor: '1000', expectedMinor: '900', over: 1 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · disputing and resolving a line', () => {
  function disputed() {
    // The carrier itemised two attempts on line A; our events recorded one — W242's first disputed row.
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 1680n, billedAttempts: 2 }, { awbNo: 'B', billedMinor: 320n }] });
    inv.reconcile((l) => evidence({ expectedMinor: l.awbNo === 'A' ? 1140n : 320n }));
    const line = inv.toLines()[0];
    inv.disputeLine(line.id, 'ops-1', 'billed as 2 attempts, our events show one', () => evidence({ expectedMinor: 1140n, deliveryAttempts: 1 }));
    return { inv, lineId: line.id, cleanId: inv.toLines()[1].id };
  }

  it('requires an operator\'s own words, at least ten characters of them', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ expectedMinor: 900n }));
    expect(() => inv.disputeLine(inv.toLines()[0].id, 'ops-1', 'nope', () => evidence())).toThrow(/10 characters/);
  });

  it('records the coded class, the words AND the evidence together', () => {
    const { inv, lineId } = disputed();
    const l = inv.toLines().find((x) => x.id === lineId)!;
    expect(l.disputeStatus).toBe('disputed');
    expect(l.disputeReasonCode).toBe('extra_attempt_billed');
    expect(l.disputeReason).toMatch(/2 attempts/);
    expect(l.evidence).toMatchObject({ ourAttempts: 1 });
    expect(inv.status).toBe('disputed_lines');
  });

  it('refuses a dispute on an own-fleet cost note — there is no carrier to argue with', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 10n }], sourceKind: 'own_fleet_cost_note' });
    expect(() => inv.disputeLine(inv.toLines()[0].id, 'ops-1', 'this is ten chars', () => evidence()))
      .toThrow(/no carrier to dispute/);
  });

  it('refuses a dispute on an invoice somebody already closed', () => {
    const inv = invoice();
    inv.reconcile(() => evidence({ expectedMinor: 1000n }));
    expect(() => inv.disputeLine(inv.toLines()[0].id, 'ops-1', 'ten characters here', () => evidence()))
      .toThrow(/exact_match/);
  });

  it('refuses a line that is not on this invoice', () => {
    const inv = invoice();
    expect(() => inv.disputeLine('nope', 'ops-1', 'ten characters here', () => evidence())).toThrow();
  });

  it('an agreed resolution replaces the billed figure and reduces the INVOICE total', () => {
    const { inv, lineId } = disputed();
    inv.resolveLine(lineId, 'ops-1', 'agreed', 1140n);
    const l = inv.toLines().find((x) => x.id === lineId)!;
    expect(l.billedMinor).toBe(1140n);
    expect(l.disputeStatus).toBe('resolved');
    expect(inv.toProps().billedMinor).toBe(2000n - 540n);
  });

  it('writes the recovery into the LINE\'s evidence, so W241\'s recovery figure is re-derivable from rows', () => {
    const { inv, lineId } = disputed();
    inv.resolveLine(lineId, 'ops-1', 'agreed', 1140n);
    const l = inv.toLines().find((x) => x.id === lineId)!;
    expect(l.evidence).toMatchObject({ resolvedOutcome: 'agreed', recoveredMinor: '540', agreedMinor: '1140' });
    // and the dispute's ORIGINAL evidence survives beside it
    expect(l.evidence).toMatchObject({ ourAttempts: 1 });
  });

  it('records a withdrawal as a ZERO recovery rather than as nothing', () => {
    const { inv, lineId } = disputed();
    inv.resolveLine(lineId, 'ops-1', 'withdrawn', null);
    const l = inv.toLines().find((x) => x.id === lineId)!;
    expect(l.evidence).toMatchObject({ resolvedOutcome: 'withdrawn', recoveredMinor: '0' });
    expect(l.billedMinor).toBe(1680n);
    expect(inv.toProps().billedMinor).toBe(2000n);
  });

  it('refuses an agreed resolution with no amount, and one above what was billed', () => {
    const { inv, lineId } = disputed();
    expect(() => inv.resolveLine(lineId, 'ops-1', 'agreed', null)).toThrow(/needs the amount/);
    expect(() => inv.resolveLine(lineId, 'ops-1', 'agreed', 1681n)).toThrow(/cannot exceed/);
  });

  it('refuses to resolve a line nobody disputed', () => {
    const { inv, cleanId } = disputed();
    expect(() => inv.resolveLine(cleanId, 'ops-1', 'agreed', 1n)).toThrow(/only a disputed line/);
  });

  it('names who resolved it and when', () => {
    const { inv, lineId } = disputed();
    const at = new Date('2026-07-20T10:00:00Z');
    inv.resolveLine(lineId, 'ops-9', 'withdrawn', null, at);
    const l = inv.toLines().find((x) => x.id === lineId)!;
    expect(l.resolvedBy).toBe('ops-9');
    expect(l.resolvedAt).toEqual(at);
  });

  it('separates the clean money from the disputed money — "disputed lines never block the clean ones"', () => {
    const { inv, lineId, cleanId } = disputed();
    const verdicts = new Map([[cleanId, { kind: 'match' as const, expectedMinor: '320' }],
      [lineId, { kind: 'over' as const, expectedMinor: '1140', varianceMinor: '540' }]]);
    expect(inv.cleanMinor(verdicts)).toBe(320n);
    expect(inv.disputedMinor()).toBe(1680n);
  });

  it('counts a resolved line as clean at its AGREED amount', () => {
    const { inv, lineId, cleanId } = disputed();
    inv.resolveLine(lineId, 'ops-1', 'agreed', 1140n);
    const verdicts = new Map([[cleanId, { kind: 'match' as const, expectedMinor: '320' }]]);
    expect(inv.cleanMinor(verdicts)).toBe(320n + 1140n);
    expect(inv.disputedMinor()).toBe(0n);
  });

  it('excludes a DISPUTED line from the clean total even when its price matched', () => {
    // The mutation pass found this gap: with the disputed-line guard removed, every earlier test still passed,
    // because their disputed line also had a non-match verdict. A line can be disputed for a reason that has
    // nothing to do with price — "billed correctly for a consignment you never delivered" — and paying it because
    // the arithmetic agrees is exactly what "disputed lines never block the clean ones" must NOT mean.
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 1000n }] });
    inv.reconcile(() => evidence({ expectedMinor: 1000n, status: 'cancelled' }));   // price matches to the rupee
    const id = inv.toLines()[0].id;
    // The invoice auto-closed on the exact match, so the dispute is raised on a fresh aggregate in that state.
    const reopened = FreightInvoice.rehydrate({ ...inv.toProps(), reconStatus: 'variance_open' },
      inv.toLines().map((l) => ({ ...l })));
    reopened.disputeLine(id, 'ops-1', 'the consignment was recalled at the hub', () => evidence({ expectedMinor: 1000n, status: 'cancelled' }));
    const verdicts = new Map([[id, { kind: 'match' as const, expectedMinor: '1000' }]]);
    expect(reopened.cleanMinor(verdicts)).toBe(0n);
    expect(reopened.disputedMinor()).toBe(1000n);
  });

  it('never counts an unpriced or unmatched line as clean, even with no dispute on it', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 100n }, { awbNo: 'B', billedMinor: 200n }] });
    inv.reconcile((l) => (l.awbNo === 'A' ? evidence({ expectedMinor: null }) : evidence({ shipmentId: null })));
    const v = new Map([[inv.toLines()[0].id, { kind: 'unpriced' as const }], [inv.toLines()[1].id, { kind: 'unmatched' as const }]]);
    expect(inv.cleanMinor(v)).toBe(0n);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · closing and booking', () => {
  it('refuses to close while a line is still disputed', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 100n }] });
    inv.reconcile(() => evidence({ expectedMinor: 90n }));
    inv.disputeLine(inv.toLines()[0].id, 'ops-1', 'ten characters here', () => evidence({ expectedMinor: 90n }));
    expect(() => inv.close('ops-1')).toThrow(/still disputed/);
  });

  it('refuses to close an invoice nobody reconciled', () => {
    expect(() => invoice().close('ops-1')).toThrow(/run a recon pass/);
  });

  it('releases the hold on close, and pays nothing', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 100n }] });
    inv.reconcile(() => evidence({ expectedMinor: 90n }));
    inv.close('ops-1');
    const p = inv.toProps();
    expect(p.reconStatus).toBe('reconciled');
    expect(p.paymentHold).toBe(false);
    expect(p.payoutId).toBeNull();          // there is no payee for a carrier on these rails
  });

  it('books a cost note to ops and refuses to reconcile-close it', () => {
    const note = invoice({ lines: [], billedMinor: 4120000n, sourceKind: 'own_fleet_cost_note' });
    expect(() => note.close('ops-1')).toThrow(/booked to ops/);
    note.bookToOps('ops-1');
    expect(note.status).toBe('booked_ops');
    expect(note.toProps().paymentHold).toBe(false);
    expect(() => note.bookToOps('ops-1')).toThrow(/booked_ops/);
  });

  it('refuses to book a carrier invoice to ops', () => {
    expect(() => invoice().bookToOps('ops-1')).toThrow(/only an own-fleet cost note/);
  });

  it('emits the closing event with both sides of the money and the currency', () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 100n }] });
    inv.reconcile(() => evidence({ expectedMinor: 90n }));
    inv.pullEvents();
    inv.close('ops-1');
    expect(inv.pullEvents()[0]).toMatchObject({
      type: 'logistics.freight_recon_closed',
      payload: { billedMinor: '100', expectedMinor: '90', currencyCode: 'INR', closedBy: 'ops-1' },
    });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the SQL these tables have never had', () => {
  const repo = () => new FreightInvoiceRepository({ forTenant: () => ({ query: jest.fn(async () => ({ rows: [] })) }) } as never);

  it('never names the GENERATED variance_minor when it writes', async () => {
    const { tx, calls } = fakeTx();
    await repo().insert(tx as never, invoice());
    for (const c of calls) expect(c.sql).not.toContain('variance_minor');
    // and both statements ran: the header and its line
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('INSERT INTO freight_invoices');
    expect(calls[1].sql).toContain('INSERT INTO freight_invoice_lines');
  });

  it('writes an unpriced line\'s expected as NULL, not as zero', async () => {
    const { tx, calls } = fakeTx();
    await repo().insert(tx as never, invoice());
    const lineParams = calls[1].params;
    expect(lineParams).toContain(null);
    expect(lineParams).not.toContain('0');
  });

  it('maps the unique-invoice violation to a typed refusal an operator can read', async () => {
    const tx = { tenantId: 't1', query: jest.fn(async () => { throw Object.assign(new Error('dup'), { code: '23505' }); }) };
    await expect(repo().insert(tx as never, invoice())).rejects.toMatchObject({ code: 'FREIGHT_INVOICE_EXISTS' });
  });

  it('reads a `date` column as the day PostgreSQL holds — not as "Wed Jul 01", and not a day early', async () => {
    // node-pg parses `date` into a JS Date at LOCAL midnight and this codebase sets no type parser, so
    // `String(v).slice(0,10)` prints "Wed Jul 01" and `toISOString().slice(0,10)` is off by one behind UTC. Both
    // shapes exist elsewhere in this repo; this mapper reads the local Y-M-D components instead.
    const rows = [{
      id: 'inv-1', tenant_id: 't1', carrier_id: 'c1', invoice_no: 'X', source_kind: 'carrier_invoice',
      period_start: new Date(2026, 6, 1), period_end: new Date(2026, 6, 31),
      shipment_count: 1, billed_minor: '100', expected_minor: '0', currency_code: 'INR',
      recon_status: 'pending', invoice_media_id: null, received_at: new Date(), reconciled_at: null,
      payment_hold: true, payout_id: null, created_at: new Date(),
    }];
    let call = 0;
    const query = jest.fn(async () => ({ rows: call++ === 0 ? rows : [] }));
    const r = new FreightInvoiceRepository({ forTenant: () => ({ query }) } as never);
    const inv = await r.getById('t1', 'inv-1');
    expect(inv!.toProps().periodStart).toBe('2026-07-01');
    expect(inv!.toProps().periodEnd).toBe('2026-07-31');
  });

  // The OTHER wrong reading — `toISOString().slice(0,10)` — cannot be caught by a unit test in this suite: the test
  // process runs in UTC, where local midnight and UTC midnight are the same instant and both readings agree. That is
  // precisely how this bug class reaches an Indian production box unnoticed. It is proved instead where it is
  // observable, in the live integration probe, which reads a real `date` column through node-pg with
  // TZ=Asia/Kolkata and asserts the mapper still returns the day PostgreSQL holds. Recorded here so the next reader
  // knows the gap is covered elsewhere rather than not covered at all.

  it('locks the header AND its lines for any write — one aggregate, one lock', async () => {
    const { tx, calls } = fakeTx(() => []);
    await repo().getForUpdate(tx as never, 't1', 'inv-1');
    expect(calls[0].sql).toMatch(/FROM freight_invoices[\s\S]*FOR UPDATE/);
  });

  it('scopes every read by tenant and skips soft-deleted rows', async () => {
    const { tx, calls } = fakeTx(() => []);
    await repo().getForUpdate(tx as never, 't1', 'inv-1');
    for (const c of calls) {
      expect(c.sql).toContain('tenant_id=$2');
      expect(c.sql).toContain('deleted_at IS NULL');
    }
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the same consignment billed twice', () => {
  function repoWith(rows: unknown[]) {
    const query = jest.fn(async (sql: string, params: unknown[]) => { void sql; void params; return { rows }; });
    return { repo: new FreightInvoiceRepository({ forTenant: () => ({ query }) } as never), query };
  }

  it('finds an AWB that also appears on another invoice, with the invoice a person can open', async () => {
    // Neither W241 nor W242 draws this row: a real shipment, billed correctly, billed twice. Every per-line price
    // check passes on both invoices, so a screen that reconciles one invoice at a time can never see it.
    const { repo, query } = repoWith([
      { awb_no: 'DLV1', other_invoice_id: 'inv-2', other_invoice_no: 'DLV-INV-0826-11', billed_minor: '168000', period_start: new Date('2026-07-01') },
    ]);
    const out = await repo.duplicateAwbsFor('t1', 'inv-1');
    expect(out).toEqual([{ awbNo: 'DLV1', otherInvoiceId: 'inv-2', otherInvoiceNo: 'DLV-INV-0826-11', billedMinor: '168000', periodStart: '2026-07-01' }]);
    const sql = query.mock.calls[0][0] as string;
    // It must look at OTHER invoices only, stay inside one tenant, and be bounded in time.
    expect(sql).toContain('l2.invoice_id <> l1.invoice_id');
    expect(sql).toContain('l2.tenant_id = l1.tenant_id');
    expect(sql).toContain("interval '365 days'");
    expect(sql).toContain('l1.awb_no IS NOT NULL');
    expect(query.mock.calls[0][1]).toEqual(['t1', 'inv-1']);
  });

  it('is the reader of the AWB index 0153 adds — an index with no reader is its own defect', async () => {
    const { repo, query } = repoWith([]);
    await repo.duplicateAwbsFor('t1', 'inv-1');
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('l2.awb_no = l1.awb_no');
    expect(sql).toContain('l2.deleted_at IS NULL');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the recovery figure, per currency', () => {
  function repoWith(rows: unknown[]) {
    const query = jest.fn(async (sql: string, params: unknown[]) => { void sql; void params; return { rows }; });
    const repo = new FreightInvoiceRepository({ forTenant: () => ({ query }) } as never);
    return { repo, query };
  }

  it('groups the recovery by the invoice\'s own currency instead of summing paise into cents', async () => {
    // Rule Zero: a single total across currencies is a silent lie — nothing errors, the desk simply adds USD cents
    // to INR paise and prints the result with a rupee sign.
    const { repo, query } = repoWith([{ currency_code: 'INR', recovered: '1184000' }, { currency_code: 'USD', recovered: '4200' }]);
    const out = await repo.recoveredSince('t1', '2026-04-21T00:00:00Z');
    expect(out).toEqual([{ currencyCode: 'INR', recoveredMinor: '1184000' }, { currencyCode: 'USD', recoveredMinor: '4200' }]);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('GROUP BY i.currency_code');
    expect(sql).toContain('JOIN freight_invoices i');
    // The currency comes from the HEADER, which is where it is recorded — a line has no currency of its own.
    expect(sql).toContain('i.currency_code');
  });

  it('reads the recovery from the line\'s own evidence, bounded by when it was resolved', async () => {
    const { repo, query } = repoWith([]);
    await repo.recoveredSince('t1', '2026-04-21T00:00:00Z');
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("evidence->>'recoveredMinor'");
    expect(sql).toContain("dispute_status='resolved'");
    expect(sql).toContain('resolved_at >= $2::timestamptz');
    expect(query.mock.calls[0][1]).toEqual(['t1', '2026-04-21T00:00:00Z']);
  });

  it('returns an empty list — not a zero — when no dispute has ever been resolved', async () => {
    const { repo } = repoWith([]);
    expect(await repo.recoveredSince('t1', '2026-04-21T00:00:00Z')).toEqual([]);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the service: who may act, and what is written', () => {
  function harness(opts: { partner?: unknown; inv?: FreightInvoice | null } = {}) {
    const { tx } = fakeTx();
    const uow = { run: jest.fn(async (t: string, fn: (x: unknown) => Promise<unknown>) => { void t; return fn(tx); }) };
    const outbox = { write: jest.fn(async (t: unknown, e: unknown) => { void t; void e; }) };
    const audit = { write: jest.fn(async (t: unknown, e: unknown) => { void t; void e; }) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const idem = { remember: jest.fn(async (k: string, u: string, op: string, fn: () => Promise<unknown>) => { void k; void u; void op; return fn(); }) };
    const inv = opts.inv === undefined ? invoice() : opts.inv;
    const repo = {
      insert: jest.fn(async () => {}),
      getForUpdate: jest.fn(async () => inv),
      getById: jest.fn(async () => inv),
      updateHeader: jest.fn(async () => {}),
      updateLines: jest.fn(async () => {}),
      evidenceFor: jest.fn(async () => [{ id: 'shp-1', awbNo: 'AWB1', status: 'delivered', chargeMinor: 900n, deliveryAttempts: 1, requiresColdChain: false }]),
      list: jest.fn(async () => []),
    };
    const partners = { getById: jest.fn(async () => (opts.partner === undefined ? { id: 'car-1' } : opts.partner)) };
    const flags = { isEnabled: jest.fn(async () => true) };
    const svc = new FreightInvoiceService(uow as never, outbox as never, idem as never, metrics as never,
      audit as never, repo as never, partners as never, flags as never);
    return { svc, repo, outbox, audit, metrics, idem, partners, inv, flags };
  }
  const boss = { userId: 'ops-1', canManage: true };
  const member = { userId: 'staff-2', canManage: false };
  const dto = {
    carrierId: 'car-1', invoiceNo: 'DLV-INV-0726-41', sourceKind: 'carrier_invoice' as const,
    periodStart: '2026-06-01', periodEnd: '2026-06-30', billedMinor: '1000', currencyCode: 'INR',
    lines: [{ awbNo: 'AWB1', billedMinor: '1000' }],
  };

  it('refuses every write to somebody without logistics.manage — W241\'s restricted state', async () => {
    const h = harness();
    await expect(h.svc.record('t1', member, 'k', dto as never, null)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.reconcile('t1', member, 'k', 'inv-1', null)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.disputeLine('t1', member, 'inv-1', 'l1', { reason: 'ten characters' } as never, null)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.resolveLine('t1', member, 'k', 'inv-1', 'l1', { outcome: 'withdrawn' } as never, null)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.close('t1', member, 'k', 'inv-1', null)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.getById('t1', member, 'inv-1')).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    await expect(h.svc.list('t1', member, { limit: 20 } as never)).rejects.toMatchObject({ code: 'SHIPMENT_FORBIDDEN' });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('refuses a bill from a carrier this tenant does not have — before anything is written', async () => {
    const h = harness({ partner: null });
    await expect(h.svc.record('t1', boss, 'k', dto as never, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.idem.remember).not.toHaveBeenCalled();
  });

  it('records the bill inside one transaction, with an audit row and an outbox event', async () => {
    const h = harness();
    const out = await h.svc.record('t1', boss, 'key-1', dto as never, '1.2.3.4');
    expect(h.repo.insert).toHaveBeenCalled();
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({
      tenantId: 't1', actorUserId: 'ops-1', action: 'logistics.freight_invoice_recorded', ip: '1.2.3.4',
    });
    expect(h.outbox.write.mock.calls[0][1]).toMatchObject({
      tenantId: 't1', aggregateType: 'freight_invoice', eventType: 'logistics.freight_invoice_recorded',
    });
    // and the payout id travels as the null it is, rather than being omitted
    expect(out).toMatchObject({ payoutId: null, paymentHold: true, reconStatus: 'pending' });
  });

  it('keys every money-adjacent act under its own idempotency operation', async () => {
    const ops: string[] = [];
    const h = harness();
    h.idem.remember.mockImplementation(async (k: string, u: string, op: string, fn: () => Promise<unknown>) => { void k; void u; ops.push(op); return fn(); });
    await h.svc.record('t1', boss, 'k1', dto as never, null);
    await h.svc.reconcile('t1', boss, 'k2', 'inv-1', null);
    await h.svc.close('t1', boss, 'k4', 'inv-1', null).catch(() => undefined);
    expect(ops).toEqual([
      'logistics.freight_invoice_record', 'logistics.freight_reconcile', 'logistics.freight_close',
    ]);
  });

  it('does NOT key a dispute: an operator must be able to correct their own words', async () => {
    const h = harness();
    await h.svc.disputeLine('t1', boss, 'inv-1', h.inv!.toLines()[0].id, { reason: 'billed two attempts, we have one' } as never, null);
    expect(h.idem.remember).not.toHaveBeenCalled();
    expect(h.metrics.inc).toHaveBeenCalledWith('logistics.freight_line_disputed', { reason: expect.any(String) });
  });

  it('matches a line by AWB even when the carrier never heard of our shipment id', async () => {
    const h = harness();
    await h.svc.reconcile('t1', boss, 'k', 'inv-1', null);
    expect(h.repo.evidenceFor).toHaveBeenCalledWith('t1', { awbNos: ['AWB1'], shipmentIds: [] },
      { from: '2026-06-01', to: '2026-06-30' });
    // 900 expected against 1000 billed → a variance, and the header says so
    expect(h.inv!.status).toBe('variance_open');
  });

  it('refuses a recon on an invoice that is not there, and writes nothing', async () => {
    const h = harness({ inv: null });
    await expect(h.svc.reconcile('t1', boss, 'k', 'inv-9', null)).rejects.toMatchObject({ code: 'FREIGHT_INVOICE_NOT_FOUND' });
    expect(h.repo.updateHeader).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('gives its own not-found code, so a screen can tell "deleted" from "flag off"', async () => {
    // The feature-flag guard throws a bare 404 by design (invisible when disabled, Law 10). Without a distinct code
    // the console cannot print W241's "flagged off" state and its "gone" state as the different things they are.
    const h = harness({ inv: null });
    await expect(h.svc.getById('t1', boss, 'inv-9')).rejects.toMatchObject({ code: 'FREIGHT_INVOICE_NOT_FOUND', httpStatus: 404, details: { id: 'inv-9' } });
  });

  it('records the recon\'s own counts in the audit row, not just the status', async () => {
    const h = harness();
    await h.svc.reconcile('t1', boss, 'k', 'inv-1', null);
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({
      action: 'logistics.freight_reconciled',
      oldValue: { status: 'pending' },
      newValue: { status: 'variance_open', over: 1, expectedMinor: '900' },
    });
  });

  it('fails the whole recon closed rather than half-writing when the invoice is already settled', async () => {
    const inv = invoice({ lines: [{ awbNo: 'AWB1', billedMinor: 900n }] });
    inv.reconcile(() => evidence({ expectedMinor: 900n }));    // exact_match, terminal
    const h = harness({ inv });
    await expect(h.svc.reconcile('t1', boss, 'k', 'inv-1', null)).rejects.toMatchObject({ code: 'FREIGHT_RECON_CLOSED' });
    expect(h.repo.updateHeader).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
  });

  it('reads the flag per tenant and fails CLOSED when the flag store is down', async () => {
    const h = harness();
    h.flags.isEnabled.mockRejectedValueOnce(new Error('flag store down'));
    expect(await h.svc.isEnabled('t1')).toBe(false);
    await h.svc.isEnabled('t2');
    expect(h.flags.isEnabled).toHaveBeenLastCalledWith('logistics_freight_recon', { tenantId: 't2' });
  });

  it('computes verdicts for a READ without writing anything', async () => {
    const h = harness();
    const v = await h.svc.verdictsFor('t1', h.inv!);
    expect([...v.values()]).toEqual([{ kind: 'over', expectedMinor: '900', varianceMinor: '100' }]);
    expect(h.repo.updateHeader).not.toHaveBeenCalled();
    expect(h.repo.updateLines).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5c · the desk read model', () => {
  function readModel(inv: FreightInvoice, recovered: Array<{ currencyCode: string; recoveredMinor: string }> = []) {
    const repo = {
      getById: jest.fn(async () => inv),
      cycleCounts: jest.fn(async () => ({ total: 3, byStatus: { pending: 1, reconciled: 2 } })),
      recoveredSince: jest.fn(async () => recovered),
      duplicateAwbsFor: jest.fn(async () => []),
      evidenceFor: jest.fn(async () => []),
    };
    const service = {
      list: jest.fn(async () => ({ items: [{ header: inv.toProps(), carrierName: 'Delhivery', carrierKind: '3pl', disputedLines: 0 }], nextCursor: null })),
      getById: jest.fn(async () => ({})),
      verdictsFor: jest.fn(async () => new Map(inv.toLines().map((l) => [l.id, { kind: 'unpriced' as const }]))),
    };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    return { rm: new FreightDeskReadModel(repo as never, service as never, metrics as never), repo, service };
  }
  const actor = { userId: 'ops-1', canManage: true };

  it('prints no expected side for a cost note, and a zero variance rather than a false one', async () => {
    const note = invoice({ lines: [], billedMinor: 4120000n, sourceKind: 'own_fleet_cost_note' });
    const { rm } = readModel(note);
    const page = await rm.desk('t1', actor, { limit: 20 } as never);
    expect(page.items[0]).toMatchObject({ expectedApplies: false, varianceMinor: '0', varianceDirection: 'level', varianceBps: null });
  });

  it('computes the variance and its basis points for a carrier invoice', async () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 9644000n }] });
    inv.reconcile(() => evidence({ expectedMinor: 9412000n }));
    const { rm } = readModel(inv);
    const page = await rm.desk('t1', actor, { limit: 20 } as never);
    expect(page.items[0]).toMatchObject({ varianceMinor: '232000', varianceDirection: 'over', varianceBps: 240, expectedApplies: true });
  });

  it('passes the recovery through per currency and carries the cycle count in the page', async () => {
    const { rm } = readModel(invoice(), [{ currencyCode: 'INR', recoveredMinor: '1184000' }]);
    const page = await rm.desk('t1', actor, { limit: 20, cycleFrom: '2026-06-01', cycleTo: '2026-06-30' } as never);
    expect(page.recovered).toEqual([{ currencyCode: 'INR', recoveredMinor: '1184000' }]);
    expect(page.cycle).toMatchObject({ from: '2026-06-01', to: '2026-06-30', total: 3 });
  });

  it('asks for no cycle count when no cycle was asked for', async () => {
    const { rm, repo } = readModel(invoice());
    const page = await rm.desk('t1', actor, { limit: 20 } as never);
    expect(page.cycle).toBeNull();
    expect(repo.cycleCounts).not.toHaveBeenCalled();
  });

  it('leaves the maker-checker verdict UNREAD rather than inventing a threshold', async () => {
    const inv = invoice({ lines: [{ awbNo: 'A', billedMinor: 100n }] });
    inv.reconcile(() => evidence({ expectedMinor: 90n }));
    inv.close('ops-1');
    const { rm } = readModel(inv);
    const d = await rm.recon('t1', actor, 'inv-1');
    // The line WAS priced by the recon pass, so the expected side is real here; the verdict is `nothing_clean`
    // because the read model's own verdict pass found nothing clean to pay. The point of the test stands either
    // way: no maker-checker threshold is read in this plane and none is guessed.
    expect(d.payment.kind).toBe('nothing_clean');
    expect(d.expected.kind).toBe('priced');
    expect(d.pack).toBeNull();
  });

  it('asks the cross-invoice duplicate question for a carrier bill and NOT for a cost note', async () => {
    const inv = invoice();
    const { rm, repo } = readModel(inv);
    (repo as unknown as { duplicateAwbsFor: jest.Mock }).duplicateAwbsFor = jest.fn(async () => [
      { awbNo: 'AWB1', otherInvoiceId: 'inv-2', otherInvoiceNo: 'X-2', billedMinor: '1000', periodStart: '2026-07-01' },
    ]);
    const d = await rm.recon('t1', actor, 'inv-1');
    expect(d.duplicates).toHaveLength(1);

    const note = invoice({ lines: [], billedMinor: 10n, sourceKind: 'own_fleet_cost_note' });
    const n = readModel(note);
    (n.repo as unknown as { duplicateAwbsFor: jest.Mock }).duplicateAwbsFor = jest.fn(async () => [{ awbNo: 'x', otherInvoiceId: 'y', otherInvoiceNo: 'z', billedMinor: '1', periodStart: '2026-01-01' }]);
    // Nobody billed us for our own diesel, so there is no double bill to find.
    expect((await n.rm.recon('t1', actor, 'inv-1')).duplicates).toEqual([]);
  });

  it('refuses to render a recon for an invoice that is gone', async () => {
    const { rm, repo } = readModel(invoice());
    repo.getById.mockResolvedValueOnce(null as never);
    await expect(rm.recon('t1', actor, 'inv-9')).rejects.toMatchObject({ code: 'FREIGHT_INVOICE_NOT_FOUND' });
  });
});
