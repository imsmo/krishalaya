// modules/education/dto/query-enrollment.dto.ts · zod .strict() — list the caller's enrollments (keyset).
import { z } from 'zod';
export const QueryEnrollmentsSchema = z.object({
  completedOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryEnrollmentsDto = z.infer<typeof QueryEnrollmentsSchema>;
