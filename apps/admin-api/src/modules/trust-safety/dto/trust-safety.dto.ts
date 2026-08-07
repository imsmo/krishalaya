// apps/admin-api/src/modules/trust-safety/dto/trust-safety.dto.ts · zod .strict() request schemas (PC-56 ADMIN-5d).
//
// Shape only. Every RULE — the reason floor, the expiry-or-review requirement, the hashed-identifier guard, the
// dry-run freshness window — lives in the domain, so the message an operator gets explains the rule rather than the
// schema. "String must contain at least 12 character(s)" teaches somebody to pad a reason to twelve characters; the
// domain's sentence tells them the identifier is hashed and this line is the only account of why anybody was shut out.
import { z } from 'zod';

const Cursor = z.string().max(200).optional();
const EventCode = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/);

/* ---------------- blocklists (W096) ---------------- */

export const QueryBlocksSchema = z.object({
  type: z.enum(['device', 'ip_range', 'phone_hash']).optional(),
  status: z.enum(['active', 'expired', 'lifted']).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryBlocksDto = z.infer<typeof QueryBlocksSchema>;

export const AddBlockSchema = z.object({
  identifierType: z.enum(['device', 'ip_range', 'phone_hash']),
  /** The RAW identifier. It is hashed in the service and never stored — see domain/blocklist.ts. Max is generous
   *  because an IPv6 CIDR is long; the domain narrows it per type. */
  identifier: z.string().min(1).max(200),
  originRef: z.string().max(60).nullish(),
  reason: z.string().min(1).max(300),
  /** ISO dates. At least one of the two is required — enforced in the domain with the sentence that explains why. */
  expiresAt: z.string().datetime().nullish(),
  reviewAt: z.string().datetime().nullish(),
  auditNote: z.string().min(1).max(1000),
}).strict();
export type AddBlockDto = z.infer<typeof AddBlockSchema>;

export const LiftBlockSchema = z.object({ reason: z.string().min(1).max(300) }).strict();
export type LiftBlockDto = z.infer<typeof LiftBlockSchema>;

export const CountersignBlockSchema = z.object({ note: z.string().min(1).max(1000) }).strict();
export type CountersignBlockDto = z.infer<typeof CountersignBlockSchema>;

/* ---------------- risk rules (W095) ---------------- */

export const ProposeWeightSchema = z.object({
  proposedWeight: z.number().int(),
  changeReason: z.string().min(10).max(1000),
  /** THE DRY RUN IS PART OF THE PROPOSAL, NOT A SEPARATE CALL THAT MIGHT NOT HAPPEN.
   *
   *  Making it a required field of the submission is the difference between "you should dry-run first" and "a
   *  proposal without a dry run cannot exist". The figures are stored with the proposal (0110) because the checker
   *  approves THESE numbers, and the population moves every day. */
  dryRun: z.object({
    bandDrops: z.number().int().min(0),
    newRestricted: z.number().int().min(0),
    population: z.number().int().min(0),
    computedAt: z.string().datetime(),
  }),
}).strict();
export type ProposeWeightDto = z.infer<typeof ProposeWeightSchema>;

export const ApproveWeightSchema = z.object({ note: z.string().min(1).max(1000) }).strict();
export type ApproveWeightDto = z.infer<typeof ApproveWeightSchema>;

export const WithdrawProposalSchema = z.object({ reason: z.string().min(1).max(1000) }).strict();
export type WithdrawProposalDto = z.infer<typeof WithdrawProposalSchema>;

export const RuleCodeParamSchema = EventCode;

/* ---------------- risk board + profile (W093 / W094) ---------------- */

export const QueryRiskBoardSchema = z.object({
  band: z.enum(['trusted', 'standard', 'caution', 'restricted', 'blocked']).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryRiskBoardDto = z.infer<typeof QueryRiskBoardSchema>;

export const ChangeBandSchema = z.object({
  band: z.enum(['trusted', 'standard', 'caution', 'restricted', 'blocked']),
  reason: z.string().min(1).max(1000),
}).strict();
export type ChangeBandDto = z.infer<typeof ChangeBandSchema>;

/* ---------------- insights (W098) ---------------- */

export const QueryInsightsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
}).strict();
export type QueryInsightsDto = z.infer<typeof QueryInsightsSchema>;
