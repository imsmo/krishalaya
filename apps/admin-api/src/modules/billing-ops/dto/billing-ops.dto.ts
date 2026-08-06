// apps/admin-api/src/modules/billing-ops/dto/billing-ops.dto.ts · zod .strict() request schemas (reject unknown
// keys → no mass-assignment). Every consequential mutation carries a reason (audit/§4). MONEY is accepted ONLY
// as a string of digits (minor units) and parsed to bigint in the service — never a JS number/float (Law 2).
import { z } from 'zod';
import { INVOICE_STATUSES } from '../domain/invoice.state';
import { DUNNING_CHANNELS, DUNNING_OUTCOMES } from '../domain/dunning';
import { PAYMENT_METHODS } from '../domain/invoice-payment';
import { EXPORT_REPORTS } from '../domain/billing-export';
import { BULK_ACTIONS, MAX_BULK_INVOICES } from '../domain/invoice-bulk';

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

/** An audit-stamped export (ADMIN-1-Q3). `limit` is capped in the service too — a DTO ceiling is a courtesy, the
 *  service's is the guarantee. */
export const QueryExportSchema = z.object({
  report: z.enum(EXPORT_REPORTS),
  tenantId: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: Currency.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
}).strict();
export type QueryExportDto = z.infer<typeof QueryExportSchema>;

/** A BULK transition (ADMIN-1-Q11). The reason is mandatory and is recorded against EVERY invoice in the batch —
 *  honest, because it is one decision applied to many. */
export const BulkInvoiceSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  invoiceIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_INVOICES),
  reason: Reason,
}).strict();
export type BulkInvoiceDto = z.infer<typeof BulkInvoiceSchema>;

/** Revenue series + cohorts (ADMIN-1-Q7). Bounded windows: an unbounded series is a full table scan on a chart. */
export const QuerySeriesSchema = z.object({
  currency: Currency,
  months: z.coerce.number().int().min(1).max(36).default(12),
  quarters: z.coerce.number().int().min(1).max(12).default(8),
}).strict();
export type QuerySeriesDto = z.infer<typeof QuerySeriesSchema>;

/** The renewal-run dry run (ADMIN-1-Q4, rescoped to visibility). */
export const QueryRenewalPreviewSchema = z.object({
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  days: z.coerce.number().int().min(1).max(90).default(14),
}).strict();
export type QueryRenewalPreviewDto = z.infer<typeof QueryRenewalPreviewSchema>;

/** Change plan. The PRICE IS REQUIRED — see domain/subscription-change.ts for why there is no "keep the current
 *  price" path. `immediate` is for corrections and does not pro-rate. */
export const ChangePlanSchema = z.object({
  planId: z.string().uuid(),
  priceMinor: MinorUnits,
  billingCycle: z.enum(['monthly', 'annual']),
  discountPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  currency: Currency.optional(),          // only to be REJECTED if it differs — never to convert
  immediate: z.coerce.boolean().default(false),
  reason: Reason,
}).strict();
export type ChangePlanDto = z.infer<typeof ChangePlanSchema>;

export const AddAddonSchema = z.object({
  addonCode: z.string().min(2).max(60),
  quantity: z.coerce.number().int().min(1).max(10000).default(1),
  priceMinor: MinorUnits,
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: Reason,
}).strict();
export type AddAddonDto = z.infer<typeof AddAddonSchema>;

/** `cancel: false` REVOKES a scheduled cancellation — a tenant who changes their mind must not need a new
 *  subscription. Defaults to true because that is the act the button performs. */
export const CancelSubscriptionSchema = z.object({
  cancel: z.coerce.boolean().default(true),
  reason: Reason,
}).strict();
export type CancelSubscriptionDto = z.infer<typeof CancelSubscriptionSchema>;

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
