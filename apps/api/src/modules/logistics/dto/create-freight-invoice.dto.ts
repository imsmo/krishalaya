// modules/logistics/dto/create-freight-invoice.dto.ts · zod .strict() payloads for the freight desk
// (PC-56 TENANT-5c). Money arrives as a STRING of minor units (Law 2 — a JSON number is a double, and a double is
// not money), and every amount is non-negative.
import { z } from 'zod';

/** A positive-or-zero integer string of minor units. A carrier line CAN legitimately be zero (a waived charge on a
 *  cancelled lane), which is why this is not the strictly-positive shape the payout DTO uses. */
const minor = z.string().regex(/^\d{1,18}$/, 'amount must be an integer string of minor units');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

export const FreightLineInputSchema = z.object({
  /** The carrier's own reference — the number printed on THEIR paperwork. Preferred over shipmentId, because it is
   *  what an operator can actually read off the invoice. */
  awbNo: z.string().trim().min(1).max(60).optional(),
  shipmentId: z.string().uuid().optional(),
  billedMinor: minor,
  /** Some carriers itemise attempts; when they do, the recon can compare it with our own counter. Absent means the
   *  invoice did not say — never "one". */
  billedAttempts: z.coerce.number().int().min(1).max(20).optional(),
}).strict().refine((l) => !!l.awbNo || !!l.shipmentId, { message: 'each line needs an awbNo or a shipmentId' });

export const CreateFreightInvoiceSchema = z.object({
  carrierId: z.string().uuid(),
  invoiceNo: z.string().trim().min(3).max(60),
  /** W241's third row is an own-fleet cost note ("fuel + wages … cost centre, not billed"), which is freight spend
   *  with no counterparty. Defaults to a carrier invoice because that is what "Upload carrier invoice" means. */
  sourceKind: z.enum(['carrier_invoice', 'own_fleet_cost_note']).default('carrier_invoice'),
  periodStart: day,
  periodEnd: day,
  billedMinor: minor,
  currencyCode: z.string().length(3).default('INR'),
  /** The uploaded document, as a confirmed `media_assets` id. Optional: a tenant may key an invoice in from paper
   *  before the scan exists, and refusing the record would push the desk back into a spreadsheet. */
  invoiceMediaId: z.string().uuid().optional(),
  /** Up to 5,000 lines — 0070's own bound reasoning ("tens to low hundreds, per the canon's 86 shipments"), with
   *  room for a carrier that bills a quarter in one file. A cost note may carry none. */
  lines: z.array(FreightLineInputSchema).max(5000).default([]),
}).strict();
export type CreateFreightInvoiceDto = z.infer<typeof CreateFreightInvoiceSchema>;

/** A dispute needs WORDS. The coded reason is classified from evidence by the domain; the sentence is the operator's
 *  own, because it is what a carrier's ops desk actually reads. */
export const DisputeFreightLineSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
}).strict();
export type DisputeFreightLineDto = z.infer<typeof DisputeFreightLineSchema>;

/**
 * Resolving a dispute. `agreed` REQUIRES the amount that will be paid — an agreement with no number is not an
 * agreement — and `withdrawn` must not carry one, because withdrawing means accepting what was billed.
 */
export const ResolveFreightLineSchema = z.object({
  outcome: z.enum(['agreed', 'withdrawn']),
  agreedMinor: minor.optional(),
}).strict()
  .refine((v) => (v.outcome === 'agreed' ? v.agreedMinor !== undefined : v.agreedMinor === undefined),
    { message: 'agreed needs agreedMinor; withdrawn must not carry one' });
export type ResolveFreightLineDto = z.infer<typeof ResolveFreightLineSchema>;
