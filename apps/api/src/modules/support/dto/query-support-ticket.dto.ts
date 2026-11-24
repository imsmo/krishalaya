// modules/support/dto/query-support-ticket.dto.ts · zod .strict() — list tickets (keyset).
import { z } from 'zod';
import { TICKET_STATUSES } from '../domain/support-ticket.state';
import { TICKET_SEVERITIES } from '../domain/support.events';
export const QueryTicketsSchema = z.object({
  box: z.enum(['mine', 'assigned', 'queue']).prefault('mine'),   // mine=requester; assigned=agent's; queue=all open (agent)
  status: z.enum(TICKET_STATUSES as unknown as [string, ...string[]]).optional(),
  severity: z.enum(TICKET_SEVERITIES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryTicketsDto = z.infer<typeof QueryTicketsSchema>;
