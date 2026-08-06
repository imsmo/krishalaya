// apps/admin-api/src/modules/billing-ops/dto/billing-ops.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). Every consequential mutation carries a reason (audit/§4). MONEY is accepted ONLY
// as a string of digits (minor units) and parsed to bigint in the service — never a JS number/float (Law 2).
import { z } from 'zod';
import { INVOICE_STATUSES } from '../domain/invoice.state';
import { DUNNING_CHANNELS, DUNNING_OUTCOMES } from '../domain/dunning';
import { PAYMENT_METHODS } from '../domain/invoice-payment';

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

// ---------------------------------------------------------------------------
// PC-56 ADMIN-1b — payments (0092), adjustment maker-checker (0093), dunning policy (0094)
// ---------------------------------------------------------------------------
/** Recording money RECEIVED. The amount is a minor-unit STRING (Law 2). `idempotencyKey` is the caller's, so a
 *  double-submit or a retried request books the money once — for a payments endpoint that is not an optimisation,
 *  it is the difference between a tenant's invoice being settled and being settled twice. */
export const RecordPaymentSchema = z.object({
  amountMinor: MinorUnits,
  currency: Currency,
  method: z.enum(PAYMENT_METHODS),
  // what an auditor matches against the bank statement; mandatory (mirrors the 0092 CHECK)
  reference: z.string().min(3).max(120),
  // ISO timestamp of when the money actually arrived — not when this form was filled in
  receivedAt: z.string().datetime(),
  // present only when the money moved through the platform wallet; never invented to look like a ledger entry
  walletTxnId: z.string().uuid().optional(),
  note: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(120),
}).strict();
export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;

/** Reversing a payment (bounced cheque, banked against the wrong invoice). A reason is mandatory: this un-settles a
 *  tenant's invoice, and "why" is the first thing anyone will ask six months later. */
export const ReversePaymentSchema = z.object({ reason: Reason }).strict();
export type ReversePaymentDto = z.infer<typeof ReversePaymentSchema>;

/** REQUESTING an adjustment. Note what is NOT here any more: no `idempotencyKey`. The key is minted when the wallet
 *  is actually called (at apply time) — a key fixed at request time would be reused across an approve→reject→resubmit
 *  cycle and make the corrected adjustment a silent no-op at the wallet: paperwork says paid, money never moved. */
export const RequestAdjustmentSchema = z.object({
  tenantId: z.string().uuid(),
  direction: z.enum(['credit', 'debit']),
  amountMinor: MinorUnits,
  currency: Currency,
  reason: Reason,
  subscriptionId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
}).strict();
export type RequestAdjustmentDto = z.infer<typeof RequestAdjustmentSchema>;

/** A checker's decision. `approve` clears it to be applied; `return` sends it back to be corrected; `reject` is
 *  terminal. A refusal REQUIRES a note — "no" without a reason is not a review, and the 0093 CHECK agrees. */
export const DecideAdjustmentSchema = z.object({
  decision: z.enum(['approve', 'return', 'reject']),
  note: z.string().max(1000).optional(),
}).strict().refine((v) => v.decision === 'approve' || (v.note ?? '').trim().length >= 3, {
  message: 'a returned or rejected adjustment must carry a note explaining why',
  path: ['note'],
});
export type DecideAdjustmentDto = z.infer<typeof DecideAdjustmentSchema>;

/** Publishing a NEW dunning-policy version. Steps are replaced wholesale rather than patched: a ladder is read as a
 *  whole, and a partial edit history of one is impossible to reason about later. */
export const PublishDunningPolicySchema = z.object({
  name: z.string().min(3).max(120),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be YYYY-MM-DD'),
  // null/absent = never auto-suspend a tenant for non-payment. The safe default, deliberately.
  suspendAfterDays: z.coerce.number().int().min(1).max(365).optional(),
  notes: z.string().max(2000).optional(),
  steps: z.array(z.object({
    dayOffset: z.coerce.number().int().min(0).max(365),
    channel: z.enum(DUNNING_CHANNELS),
    templateCode: z.string().max(80).optional(),
    escalate: z.coerce.boolean().default(false),
  })).min(1).max(20),
}).strict();
export type PublishDunningPolicyDto = z.infer<typeof PublishDunningPolicySchema>;

export const QueryAdjustmentsSchema = z.object({
  status: z.enum(['awaiting_approval', 'approved', 'applied', 'returned', 'rejected']).optional(),
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
