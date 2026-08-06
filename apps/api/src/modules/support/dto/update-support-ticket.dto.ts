// modules/support/dto/update-support-ticket.dto.ts · zod .strict() — agent actions (assign / transition / csat).
import { z } from 'zod';
import { TICKET_STATUSES } from '../domain/support-ticket.state';
export const AssignTicketSchema = z.object({ assigneeUserId: z.string().uuid() }).strict();
export type AssignTicketDto = z.infer<typeof AssignTicketSchema>;

// transitions an agent may drive directly (resolve/close/reopen/escalate/pending_* /open)
const AGENT_TRANSITIONS = ['open', 'pending_customer', 'pending_internal', 'escalated', 'resolved', 'closed', 'reopened'] as const;
export const TransitionTicketSchema = z.object({
  to: z.enum(AGENT_TRANSITIONS as unknown as [string, ...string[]]),
  note: z.string().max(2000).nullish(),
}).strict();
export type TransitionTicketDto = z.infer<typeof TransitionTicketSchema>;

// PC-56 ADMIN-2c: a rating may now carry the farmer's own words (migration 0099). Both fields are OPTIONAL — a score
// with no comment is the common case and must stay a one-tap action. The language is required WHEN a comment is given
// (the DB CHECKs the same pair): a verbatim without its language cannot be routed to somebody who can read it, and this
// platform's premise is that a farmer writes in their own language.
export const CsatSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(4000).nullish(),
  // BCP-47-ish: 'hi', 'gu', 'pa-in'. Not validated against the platform's live-language registry on purpose — a farmer
  // may write in a language the product has not been translated into, and refusing their words on that basis would be
  // the platform telling somebody their language does not count.
  commentLanguage: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z0-9]{2,6})?$/).nullish(),
}).strict().refine(
  (v) => !v.comment || !!v.commentLanguage,
  { message: 'commentLanguage is required when a comment is given', path: ['commentLanguage'] },
);
export type CsatDto = z.infer<typeof CsatSchema>;
export { TICKET_STATUSES };
