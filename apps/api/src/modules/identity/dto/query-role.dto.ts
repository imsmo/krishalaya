import { z } from 'zod';
export const QueryRoleSchema = z.object({ scope: z.enum(['tenant','platform']).optional(), activeOnly: z.coerce.boolean().prefault(true) }).strict();
export type QueryRoleDto = z.infer<typeof QueryRoleSchema>;
