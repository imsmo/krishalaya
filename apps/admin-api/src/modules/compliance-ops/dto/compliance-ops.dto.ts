// apps/admin-api/src/modules/compliance-ops/dto/compliance-ops.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Every mutation carries a reason/resolution (audit/§4). Free-text fields
// are bounded; the audit-explorer filters are charset/length-bounded (ReDoS-safe, parameterised downstream).
import { z } from 'zod';
import { DSR_STATUSES } from '../domain/dsr.state';
import { BREACH_STATUSES } from '../domain/breach.state';

const Text = z.string().min(3).max(2000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).default(50);

/* ---- data-subject requests (DPDP rights) ---- */
export const QueryDsrSchema = z.object({
  status: z.enum(DSR_STATUSES).optional(),
  requestType: z.enum(['access', 'erasure', 'correction', 'portability']).optional(),
  cursor: Cursor, limit: Limit,
}).strict();
export type QueryDsrDto = z.infer<typeof QueryDsrSchema>;

export const UpdateDsrSchema = z.object({
  action: z.enum(['start', 'complete', 'reject']),
  resolution: Text,
  exportMediaId: z.string().uuid().nullish(),     // for access/portability fulfilment
  /** ADMIN-5: one of the three lawful grounds (W042), REQUIRED on reject. Validated in the domain rather than as a zod
   *  enum so the 422 can explain that a rights request may only be refused on a lawful ground and that the principal
   *  receives it verbatim — "invalid enum value" teaches an operator to try the next option in the list. */
  rejectionGround: z.string().max(32).optional(),
}).strict();
export type UpdateDsrDto = z.infer<typeof UpdateDsrSchema>;

/* ---- export approvals ---- */
export const QueryExportsSchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  jobKind: z.string().max(30).optional(),
  cursor: Cursor, limit: Limit,
}).strict();
export type QueryExportsDto = z.infer<typeof QueryExportsSchema>;

export const DecideExportSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: Text,
}).strict();
export type DecideExportDto = z.infer<typeof DecideExportSchema>;

/* ---- audit-log explorer (read-only) ---- */
export const QueryAuditSchema = z.object({
  actorUserId: z.string().uuid().optional(),
  entityType: z.string().regex(/^[a-z0-9_]{1,60}$/).optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().regex(/^[a-z0-9_.]{1,120}$/).optional(),
  tenantId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),        // partition-prune lower bound
  to: z.string().datetime().optional(),
  cursor: Cursor, limit: Limit,
}).strict();
export type QueryAuditDto = z.infer<typeof QueryAuditSchema>;

/* ---- retention policies (config) ---- */
export const UpsertRetentionSchema = z.object({
  tableName: z.string().regex(/^[a-z0-9_]{2,100}$/),
  activeMonths: z.number().int().min(0).max(1200),
  archiveMonths: z.number().int().min(0).max(1200).nullable(),
  legalBasis: z.string().max(200).nullish(),
  action: z.enum(['archive', 'anonymise', 'delete', 'keep_forever']),
  isActive: z.boolean().default(true),
  reason: Text,
}).strict();
export type UpsertRetentionDto = z.infer<typeof UpsertRetentionSchema>;

/* ---- breach console ---- */
export const QueryBreachesSchema = z.object({
  status: z.enum(BREACH_STATUSES).optional(),
  cursor: Cursor, limit: Limit,
}).strict();
export type QueryBreachesDto = z.infer<typeof QueryBreachesSchema>;

export const OpenBreachSchema = z.object({
  affectedTenantId: z.string().uuid().nullish(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
  title: z.string().min(3).max(200),
  description: Text,
  affectedData: z.string().min(1).max(500),       // categories only (e.g. 'phone,email') — NO raw PII
  affectedCount: z.number().int().min(0).default(0),
  detectedAt: z.string().datetime(),
}).strict();
export type OpenBreachDto = z.infer<typeof OpenBreachSchema>;

export const UpdateBreachSchema = z.object({
  action: z.enum(['contain', 'notify', 'close']),
  note: Text,
  regulatorNotifiedAt: z.string().datetime().optional(),   // required for action='notify'
  principalsNotifiedAt: z.string().datetime().optional(),
}).strict();
export type UpdateBreachDto = z.infer<typeof UpdateBreachSchema>;

/* ---- ADMIN-5: acknowledge + the erasure evidence ledger ---- */

/** Acknowledging is a one-field action. The note is OPTIONAL because the acknowledgement itself is the fact being
 *  recorded and a mandatory note here would produce "done" — see the checker-note reasoning in the scheme-version DTO. */
export const AcknowledgeDsrSchema = z.object({ note: z.string().min(1).max(500).optional() }).strict();
export type AcknowledgeDsrDto = z.infer<typeof AcknowledgeDsrSchema>;

/** Recording what was ACTUALLY done to one data class. One class per call, deliberately: the value of the evidence
 *  ledger is that it cannot be satisfied by a single gesture, so there is no bulk variant of this. */
export const RecordErasureActionSchema = z.object({
  dataClass: z.string().regex(/^[a-z0-9_]{2,100}$/),
  action: z.enum(['deleted', 'anonymised', 'archived', 'blocked_by_law', 'retracted']),
  // Zero is legitimate — a class the farmer had no rows in was still checked, and that is worth recording.
  rowsAffected: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  note: z.string().min(1).max(1000).optional(),
}).strict();
export type RecordErasureActionDto = z.infer<typeof RecordErasureActionSchema>;

/* ---- ADMIN-5c: the breach notification checklist ---- */

/** One recorded act. Shape only here; the DOMAIN decides whether the evidence is sufficient, so the 422 can explain
 *  that a tick without a filing reference is what the two typed timestamps already were. */
export const RecordBreachStepSchema = z.object({
  step: z.enum(['board_filing', 'principals_notified', 'tenant_briefed']),
  outcome: z.enum(['done', 'not_applicable']),
  evidenceRef: z.string().max(200).optional(),
  reachedCount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  channel: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
}).strict();
export type RecordBreachStepDto = z.infer<typeof RecordBreachStepSchema>;

export const RetractBreachStepSchema = z.object({
  step: z.enum(['board_filing', 'principals_notified', 'tenant_briefed']),
  reason: z.string().min(3).max(1000),
}).strict();
export type RetractBreachStepDto = z.infer<typeof RetractBreachStepSchema>;

/** The DPO sign-off. The note is OPTIONAL — a DPO who agrees has nothing to add, and a mandatory field produces "ok",
 *  which is worse than blank because it looks like review. */
export const SignOffBreachSchema = z.object({ note: z.string().min(1).max(2000).optional() }).strict();
export type SignOffBreachDto = z.infer<typeof SignOffBreachSchema>;
