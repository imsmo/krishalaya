// modules/ambassadors/dto/create-target.dto.ts · zod .strict() set-target (admin) + leaderboard query.
import { z } from 'zod';
import { TARGET_METRICS } from '../domain/ambassador-target.entity';
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
export const SetTargetSchema = z.object({
  ambassadorId: z.string().uuid(),
  metric: z.enum(TARGET_METRICS as unknown as [string, ...string[]]),
  periodStart: ymd,
  periodEnd: ymd,
  // count metrics → integer count; 'earnings_minor' → bigint minor units string (Law 2). Validated as a
  // non-negative integer string either way; the service parses to bigint.
  targetValue: z.string().regex(/^\d{1,18}$/, 'must be a non-negative integer'),
}).strict();
export type SetTargetDto = z.infer<typeof SetTargetSchema>;

export const QueryLeaderboardSchema = z.object({
  periodStart: ymd.optional(),
  periodEnd: ymd.optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryLeaderboardDto = z.infer<typeof QueryLeaderboardSchema>;
