// modules/ambassadors/dto/query-earning.dto.ts · zod .strict() — list an ambassador's earnings (keyset).
import { z } from 'zod';
export const QueryEarningsSchema = z.object({
  unpaidOnly: z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1').optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryEarningsDto = z.infer<typeof QueryEarningsSchema>;
