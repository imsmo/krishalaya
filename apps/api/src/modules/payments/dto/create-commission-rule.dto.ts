// modules/payments/dto/create-commission-rule.dto.ts · PC-56 TENANT-SW-a · A1 / A3 — a tenant_admin PROPOSES a commission rule for its
// own tenant (zod .strict). F-3: `platformShareBps` is NOT a field — the platform's share is the tenant's PLAN floor
// (kv_commission_platform_share_bps), written by the service from the plan and enforced by trg_commission_rules_gate; a body that
// carries it is REFUSED (400 unrecognized key) rather than ignored. F-4: `effectiveFrom` is REQUIRED and must be ≥ the next IST midnight
// + 7 days (service + trigger) — never back-dated. A second tenant_admin confirms (proposals). Money is bigint minor units (strings on
// the wire); rates are basis points of the goods value (0–10000).
import { z } from 'zod';

const Minor = z.union([z.bigint(), z.string().regex(/^\d{1,18}$/)]);
const Bps = z.number().int().min(0).max(10000);
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Reason = z.string().trim().min(20).max(500);

export const CreateCommissionRuleSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  source: z.enum(['direct', 'auction', 'requirement', 'subscription']).nullable().optional(),
  sellerRoleId: z.string().uuid().nullable().optional(),
  rateBps: Bps,
  fixedMinor: Minor.default('0'),
  capMinor: Minor.nullable().optional(),
  chargedTo: z.enum(['seller', 'buyer']).default('seller'),
  priority: z.number().int().min(0).max(1000).default(100),
  effectiveFrom: Ymd,
  effectiveTo: Ymd.nullable().optional(),
  reason: Reason,
}).strict();
export type CreateCommissionRuleDto = z.infer<typeof CreateCommissionRuleSchema>;

/** Deactivate one of the tenant's own rules from an IST midnight ≥ 7 days out (the rule is end-dated, never edited). */
export const DeactivateCommissionRuleSchema = z.object({ effectiveFrom: Ymd, reason: Reason }).strict();
export type DeactivateCommissionRuleDto = z.infer<typeof DeactivateCommissionRuleSchema>;

export const RefuseCommissionProposalSchema = z.object({ reason: Reason }).strict();
export type RefuseCommissionProposalDto = z.infer<typeof RefuseCommissionProposalSchema>;

/** W149 "Resolution example": which rule a given order would be charged under, today and on a date — read-only. */
export const CommissionResolutionQuerySchema = z.object({
  source: z.enum(['direct', 'auction', 'requirement', 'subscription']).optional(),
  categoryId: z.string().uuid().optional(),
  sellerRoleId: z.string().uuid().optional(),
  onDate: Ymd.optional(),
  proposalId: z.string().uuid().optional(),
}).strict();
export type CommissionResolutionQueryDto = z.infer<typeof CommissionResolutionQuerySchema>;
