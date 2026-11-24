// modules/support/dto/create-support-ticket.dto.ts · zod .strict() — open a support ticket.
import { z } from 'zod';
import { TICKET_CHANNELS, TICKET_SEVERITIES } from '../domain/support.events';
export const OpenTicketSchema = z.object({
  channel: z.enum(TICKET_CHANNELS as unknown as [string, ...string[]]).prefault('app'),
  categoryId: z.string().uuid().nullish(),
  severity: z.enum(TICKET_SEVERITIES as unknown as [string, ...string[]]).prefault('P2'),
  subject: z.string().min(1).max(250).nullish(),
}).strict();
export type OpenTicketDto = z.infer<typeof OpenTicketSchema>;
