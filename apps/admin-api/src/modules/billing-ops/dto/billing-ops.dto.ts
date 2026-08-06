// apps/admin-api/src/modules/billing-ops/dto/billing-ops.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). Every consequential mutation carries a reason (audit/§4). MONEY is accepted ONLY
// as a string of digits (minor units) and parsed to bigint in the service — never a JS number/float (Law 2).
import { z } from 'zod';
import { INVOICE_STATUSES } from '../domain/invoice.state';
import { DUNNING_CHANNELS, DUNNING_OUTCOMES } from '../domain/dunning';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).default(50);
// up to 15 digits ≈ 9,999,999,999,999 minor units — comfortably within int64; parsed to bigint downstream.
const MinorUnits = z.string().regex(/^[0-9]{1,15}$/, 'amount must be a non-negative integer in minor units');
const Currency = z.string().regex(/^[A-Z]{3}$/).default('INR');

export const QueryInvoicesSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryInvoicesDto = z.infer<typeof QueryInvoicesSchema>;

export const UpdateInvoiceSchema = z.object({
  action: z.enum(['issue', 'mark_overdue', 'void']),
  reason: Reason,
}).strict();
export type UpdateInvoiceDto = z.infer<typeof UpdateInvoiceSchema>;

export const QueryDunningSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryDunningDto = z.infer<typeof QueryDunningSchema>;

/** The collection queue (PC-56 ADMIN-1). `minDaysLate` lets an officer work a ladder tier (0 = everything owed,
 *  including invoices not yet late — which is the "issued but unpaid" watchlist, deliberately reachable). Capped at
 *  a year: beyond that it is a write-off decision, not a collections one. */
export const QueryDunningQueueSchema = z.object({
  minDaysLate: z.coerce.number().int().min(0).max(365).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryDunningQueueDto = z.infer<typeof QueryDunningQueueSchema>;

export const RecordDunningSchema = z.object({
  channel: z.enum(DUNNING_CHANNELS),
  outcome: z.enum(DUNNING_OUTCOMES).default('sent'),
  note: z.string().max(1000).optional(),
}).strict();
export type RecordDunningDto = z.infer<typeof RecordDunningSchema>;

export const QueryAdjustmentsSchema = z.object({
  tenantId: z.string().uuid().optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryAdjustmentsDto = z.infer<typeof QueryAdjustmentsSchema>;

export const ApplyAdjustmentSchema = z.object({
  tenantId: z.string().uuid(),
  direction: z.enum(['credit', 'debit']),
  amountMinor: MinorUnits,
  currency: Currency,
  reason: Reason,
  idempotencyKey: z.string().min(8).max(120),       // client-supplied; scoped per (tenant, key) in the service
  subscriptionId: z.string().uuid().nullish(),
  invoiceId: z.string().uuid().nullish(),
}).strict();
export type ApplyAdjustmentDto = z.infer<typeof ApplyAdjustmentSchema>;

export const QueryRevenueSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).strict();
export type QueryRevenueDto = z.infer<typeof QueryRevenueSchema>;
