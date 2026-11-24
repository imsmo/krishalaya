// modules/schemes/dto/query-scheme-application.dto.ts · zod .strict() application list query (keyset).
import { z } from 'zod';
import { APPLICATION_STATUSES } from '../domain/scheme-application.state';
export const QueryApplicationsSchema = z.object({
  box: z.enum(['mine', 'queue', 'all']).prefault('mine'),   // mine=applicant's; queue=officer's verification queue; all=admin
  status: z.enum(APPLICATION_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryApplicationsDto = z.infer<typeof QueryApplicationsSchema>;
