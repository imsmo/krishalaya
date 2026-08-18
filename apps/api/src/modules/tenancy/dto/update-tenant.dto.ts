// modules/tenancy/dto/update-tenant.dto.ts · self-serve tenant PROFILE patch (zod .strict). Only profile fields
// are accepted — slug/tenant_type/country/status/risk_score are NOT in the schema, so .strict() rejects any
// attempt to set them (no mass-assignment / no lifecycle escalation, Law 11). All keys optional; at least one.
import { z } from 'zod';

export const UpdateTenantProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(250).optional(),
  displayName: z.string().trim().min(1).max(150).optional(),
  regionId: z.string().uuid().nullable().optional(),
  gstin: z.string().trim().min(1).max(20).nullable().optional(),
  pan: z.string().trim().min(1).max(15).nullable().optional(),
  cinOrRegNo: z.string().trim().min(1).max(40).nullable().optional(),
  fssaiLicense: z.string().trim().min(1).max(20).nullable().optional(),
  ownerName: z.string().trim().min(1).max(200).nullable().optional(),
  ownerPhone: z.string().trim().min(1).max(20).nullable().optional(),
  ownerEmail: z.string().trim().min(1).max(200).nullable().optional(),
  /**
   * PC-56 TENANT-4d-3 · W2426: "the audit trail has the entry (actor · time · REASON · before/after)".
   * `audit_log.reason` and `AuditEntry.reason` both existed; this action never passed one, so the fourth of the
   * four promised facts was a dead column. Required by the SERVICE (not here) exactly when a value is being
   * REPLACED or CLEARED rather than recorded for the first time — a rule about the diff, which a field schema
   * cannot see.
   */
  reason: z.string().trim().min(1).max(280).optional(),
}).strict().refine(
  // A reason on its own is not a profile change. Counting it as one would let a submit with nothing but a reason
  // reach the entity and fail there with "no profile changes supplied", which reads as a server fault.
  (d) => Object.keys(d).filter((k) => k !== 'reason').length > 0,
  { message: 'at least one profile field is required' },
);
export type UpdateTenantProfileDto = z.infer<typeof UpdateTenantProfileSchema>;
