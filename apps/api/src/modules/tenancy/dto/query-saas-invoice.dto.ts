// modules/tenancy/dto/query-saas-invoice.dto.ts · list the calling tenant's SaaS invoices, keyset pagination.
import { z } from 'zod';
import { INVOICE_STATUSES } from '../domain/saas-invoice.state';
import { INVOICE_TABS } from '../domain/saas-invoice-balance';

export const QuerySaasInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  /** W120's tab. Kept separate from `status` because a tab is a GROUP of statuses (Issued covers
   *  partially_paid) and collapsing the two would make "Issued 1" and the Issued page disagree. */
  tab: z.enum(INVOICE_TABS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QuerySaasInvoiceDto = z.infer<typeof QuerySaasInvoiceSchema>;

/** Paying an open invoice (W2428). The AMOUNT IS NOT IN THIS SCHEMA — it is resolved server-side from
 *  total_minor − paid_minor, because a client that could name its own figure could open a gateway order for ₹1
 *  against a ₹7,954 invoice and leave it part-paid for ever. */
export const PaySaasInvoiceSchema = z.object({}).strict();
