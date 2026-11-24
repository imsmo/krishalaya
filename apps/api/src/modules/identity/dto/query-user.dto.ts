import { z } from 'zod';
export const QueryUserSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
  q: z.string().max(120).optional(),
  status: z.enum(['active','pending_verification','suspended','restricted','soft_deleted']).optional(),
}).strict();
export type QueryUserDto = z.infer<typeof QueryUserSchema>;
