// modules/tenancy/dto/create-saas-invoice.dto.ts · the canonical write-contract for raising a SaaS invoice. SaaS
// invoices are SYSTEM-generated (the renewal billing run / payment glue) — not a tenant-facing POST — so this is a
// validated internal contract, not a routed endpoint. Money is bigint minor units (strings on the wire). zod .strict().
import { z } from 'zod';

const Minor = z.union([z.bigint(), z.string().regex(/^\d+$/)]);   // non-negative minor units
export const SaasInvoiceLineSchema = z.object({
  desc: z.string().trim().min(1).max(300),
  qty: z.number().int().positive(),
  unitMinor: Minor,
  totalMinor: Minor,
}).strict();

export const CreateSaasInvoiceSchema = z.object({
  subscriptionId: z.string().uuid().nullable().optional(),
  currencyCode: z.string().trim().length(3),
  taxMinor: Minor.prefault('0'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineItems: z.array(SaasInvoiceLineSchema).min(1).max(200),
}).strict();
export type CreateSaasInvoiceDto = z.infer<typeof CreateSaasInvoiceSchema>;
