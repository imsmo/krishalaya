// modules/logistics/dto/create-delivery-zone.dto.ts · PC-56 TENANT-SW-a · B2 — zones are CHANGED BY PROPOSAL (lead + checker): create,
// fee re-point, deactivate, re-activate. Name / pincodes / regions stay a direct, reasoned, audited edit (serviceability, not money).
// `chargeDefinitionId` is no longer accepted on the direct edit (F-9: a PATCH re-pointed the fee around W150's own checker) — .strict()
// refuses it by name.
import { z } from 'zod';

const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const Pincodes = z.array(Pincode).max(5000);
const RegionIds = z.array(z.string().uuid()).max(2000);
const Reason = z.string().trim().min(20).max(500);

export const ProposeZoneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), defaultName: z.string().trim().min(1).max(120), pincodes: Pincodes.default([]), regionIds: RegionIds.default([]),
    chargeDefinitionId: z.string().uuid().nullable().optional(), reason: Reason }).strict(),
  z.object({ kind: z.literal('repoint_fee'), zoneId: z.string().uuid(), chargeDefinitionId: z.string().uuid().nullable(), reason: Reason }).strict(),
  z.object({ kind: z.literal('deactivate'), zoneId: z.string().uuid(), reason: Reason }).strict(),
  z.object({ kind: z.literal('activate'), zoneId: z.string().uuid(), reason: Reason }).strict(),
]);
export type ProposeZoneDto = z.infer<typeof ProposeZoneSchema>;

/** Backwards name for the create shape (SDK / older callers). */
export const CreateDeliveryZoneSchema = z.object({
  defaultName: z.string().trim().min(1).max(120),
  pincodes: Pincodes.default([]),
  regionIds: RegionIds.default([]),
  chargeDefinitionId: z.string().uuid().nullable().optional(),
  reason: Reason,
}).strict();
export type CreateDeliveryZoneDto = z.infer<typeof CreateDeliveryZoneSchema>;

export const UpdateDeliveryZoneSchema = z.object({
  defaultName: z.string().trim().min(1).max(120).optional(),
  pincodes: Pincodes.optional(),
  regionIds: RegionIds.optional(),
  reason: z.string().trim().min(10).max(500),
}).strict().refine((d) => d.defaultName !== undefined || d.pincodes !== undefined || d.regionIds !== undefined, { message: 'at least one field is required' });
export type UpdateDeliveryZoneDto = z.infer<typeof UpdateDeliveryZoneSchema>;

export const RefuseZoneProposalSchema = z.object({ reason: Reason }).strict();
export type RefuseZoneProposalDto = z.infer<typeof RefuseZoneProposalSchema>;

export const ServiceabilityQuerySchema = z.object({ pincode: Pincode }).strict();
export type ServiceabilityQueryDto = z.infer<typeof ServiceabilityQuerySchema>;

export const QueryZoneProposalSchema = z.object({
  status: z.enum(['proposed', 'confirmed', 'refused', 'expired']).optional(),
  zoneId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryZoneProposalDto = z.infer<typeof QueryZoneProposalSchema>;

/** `{ isActive }` — still used by the delivery-ROUTES activate endpoint (routes.controller.ts). A ZONE's active state is no longer set
 *  directly; it moves only by a confirmed proposal (kind activate / deactivate). */
export const ZoneSetActiveSchema = z.object({ isActive: z.boolean() }).strict();
export type ZoneSetActiveDto = z.infer<typeof ZoneSetActiveSchema>;
