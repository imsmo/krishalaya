// apps/admin-api/src/modules/ai-models-ops/dto/ai-models-ops.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Shared by the controller; parsed before any business logic runs.
import { z } from 'zod';
import { MODEL_STATUSES } from '../domain/ai-model.state';

export const RegisterModelSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]{2,80}$/),
  version: z.string().min(1).max(30),
  provider: z.string().max(60).nullish(),
  confidenceThreshold: z.number().min(0).max(1).nullish(),
}).strict();
export type RegisterModelDto = z.infer<typeof RegisterModelSchema>;

export const PromoteModelSchema = z.object({
  to: z.enum(MODEL_STATUSES),
  reason: z.string().min(1).max(500),
}).strict();
export type PromoteModelDto = z.infer<typeof PromoteModelSchema>;

export const TuneThresholdSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).nullable(),
  reason: z.string().min(1).max(500),
}).strict();
export type TuneThresholdDto = z.infer<typeof TuneThresholdSchema>;

export const QueryModelsSchema = z.object({
  code: z.string().max(80).optional(),
  status: z.enum(MODEL_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryModelsDto = z.infer<typeof QueryModelsSchema>;

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-7 · the governance plane                                                              */
/* ------------------------------------------------------------------------------------------------ */
//
// NO VERDICT, NO GAP AND NO SAMPLE SIZE IS ACCEPTED FROM A CLIENT anywhere below. The fairness verdict is derived from
// the measurements server-side, because a caller that could pass `verdict: 'pass'` could pass it over a 40pp gap — and
// that verdict is the only thing standing between a skewed model and production. Same rule as ADMIN-6b's preflight and
// ADMIN-5f's value-at-stake: whatever gates a control is computed, never supplied.

/** Running an audit takes NO BODY. The model is in the path, the window is the service's, the slices are what the data
 *  supports, and the verdict is computed. There is nothing for a client to say and a great deal it could usefully lie
 *  about. */
export const RunAuditSchema = z.object({}).strict();
export type RunAuditDto = z.infer<typeof RunAuditSchema>;

export const ProposeTransitionSchema = z.object({
  to: z.enum(['shadow', 'canary', 'production', 'retired']),
  // 20 characters, matching every other reason floor on this platform (0112's moderation reason, 0114's batch return).
  // The checker is the only reader and nothing else explains why this model should move.
  reason: z.string().trim().min(20).max(2_000),
  // Only meaningful for a canary, and `assertCanaryStep` refuses anything off the fixed ladder — an operator typing 37%
  // is making an unreviewable decision.
  canaryPercent: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
export type ProposeTransitionDto = z.infer<typeof ProposeTransitionSchema>;

/** Approving takes NO BODY either. The proposal is on the row, the approver is in the token, and the fairness gate is
 *  re-evaluated inside the transaction. */
export const ApproveTransitionSchema = z.object({}).strict();
export type ApproveTransitionDto = z.infer<typeof ApproveTransitionSchema>;

export const QueryCasesSchema = z.object({
  // Enum rather than free string, so a typo returns 400 rather than an empty list — a reviewer filtering for "pendng"
  // and seeing "no cases" would conclude the queue was clear.
  status: z.enum(['pending', 'in_review', 'accepted', 'rejected']).optional(),
  queueKind: z.enum(['fraud_flag', 'low_confidence_grade', 'price_anomaly', 'dispute_triage', 'drift']).optional(),
  tenantId: z.string().uuid().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryCasesDto = z.infer<typeof QueryCasesSchema>;

export const DecideCaseSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  // W083: the note "teaches the model", and W085's override analysis is built out of these sentences. A resolved case
  // with an empty note is a training signal thrown away.
  note: z.string().trim().min(20).max(4_000),
}).strict();
export type DecideCaseDto = z.infer<typeof DecideCaseSchema>;

export const QueryInferencesSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  modelId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  overriddenOnly: z.coerce.boolean().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type QueryInferencesDto = z.infer<typeof QueryInferencesSchema>;

export const ThresholdImpactSchema = z.object({
  proposed: z.coerce.number().min(0).max(1),
  // Supplied by the operator because no reviewer-capacity record exists on this platform (ADMIN-7-Q7). Absent, the
  // verdict is `unknown` — which the console renders as a caution and never as a clearance.
  headroomPerDay: z.coerce.number().int().min(0).optional(),
});
export type ThresholdImpactDto = z.infer<typeof ThresholdImpactSchema>;
