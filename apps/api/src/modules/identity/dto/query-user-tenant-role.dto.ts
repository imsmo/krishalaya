import { z } from 'zod';
export const QueryUserTenantRoleSchema = z.object({ userId: z.string().uuid().optional(), roleCode: z.string().max(50).optional(), pendingOnly: z.coerce.boolean().prefault(false) }).strict();
export type QueryUserTenantRoleDto = z.infer<typeof QueryUserTenantRoleSchema>;
