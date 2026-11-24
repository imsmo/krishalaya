// modules/fintech/dto/query-loan-application.dto.ts · zod .strict() application list query (keyset).
import { z } from 'zod';
import { APP_STATUSES } from '../domain/loan-application.state';
export const QueryApplicationsSchema = z.object({
  box: z.enum(['mine', 'review', 'all']).prefault('mine'),   // mine=applicant's; review=lender queue; all=admin
  status: z.enum(APP_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryApplicationsDto = z.infer<typeof QueryApplicationsSchema>;
