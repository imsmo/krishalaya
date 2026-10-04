import { z } from 'zod';
export const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleCode: z.string().min(2).max(50),
  roleData: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type AssignRoleDto = z.infer<typeof AssignRoleSchema>;

/** PC-56 TENANT-SW-c (F-15): WHY is required on every override write (10–500 characters), and an override may carry an expiry. */
const reason = z.string().trim().min(10, 'a reason of at least 10 characters is required').max(500);
export const StaffOverrideSchema = z.object({
  userTenantRoleId: z.string().uuid(),
  permissionCode: z.string().min(2).max(80),
  isGranted: z.boolean(),
  reason,
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type StaffOverrideDto = z.infer<typeof StaffOverrideSchema>;

export const RevokeOverrideSchema = z.object({ userTenantRoleId: z.string().uuid(), permissionCode: z.string().min(2).max(80), reason }).strict();
export type RevokeOverrideDto = z.infer<typeof RevokeOverrideSchema>;

/** PC-56 TENANT-SW-c (F-15): DELETE /rbac/assignments/:id — "Remove from team" REQUIRES a reason; the controller no longer passes null. */
export const RevokeAssignmentSchema = z.object({ reason }).strict();
export type RevokeAssignmentDto = z.infer<typeof RevokeAssignmentSchema>;

export const ReasonOnlySchema = z.object({ reason }).strict();
export type ReasonOnlyDto = z.infer<typeof ReasonOnlySchema>;
