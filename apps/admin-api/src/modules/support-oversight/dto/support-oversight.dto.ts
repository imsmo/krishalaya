// apps/admin-api/src/modules/support-oversight/dto/support-oversight.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Reads are filterable + keyset-bounded; the one mutation (escalate) carries a
// mandatory reason. Severity/status are closed enums; ids are uuids.
import { z } from 'zod';
import { TICKET_STATUSES } from '../domain/ticket.state';
import { SEVERITIES } from '../domain/sla';

const Reason = z.string().min(3).max(1000);
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).default(50);
const Bool = z.enum(['true', 'false']).optional();

export const QueryTicketsSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  slaBreached: Bool,
  assigned: Bool,
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryTicketsDto = z.infer<typeof QueryTicketsSchema>;

export const QueryBreachesSchema = z.object({
  tenantId: z.string().uuid().optional(),
  severity: z.enum(SEVERITIES).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryBreachesDto = z.infer<typeof QueryBreachesSchema>;

export const TenantHealthSchema = z.object({
  tenantId: z.string().uuid().optional(),   // present ⇒ single tenant; absent ⇒ top tenants by open SLA breaches
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type TenantHealthDto = z.infer<typeof TenantHealthSchema>;

export const EscalateTicketSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),       // raise only (validated in the domain); omit to escalate status/assignee only
  reassignToUserId: z.string().uuid().optional(),
  reason: Reason,
}).strict();
export type EscalateTicketDto = z.infer<typeof EscalateTicketSchema>;

// ---------------------------------------------------------------------------
// PC-56 ADMIN-2 · support-desk depth
// ---------------------------------------------------------------------------
/** A window for the insight reads. BOUNDED and required: an unbounded "all time" agent-performance query is a full
 *  scan of every ticket the platform has ever taken, and the number it returns answers no question anybody asked. */
const Window = {
  from: z.string().datetime(),
  to: z.string().datetime(),
};

export const QueryInsightsSchema = z.object({ ...Window, limit: Limit }).strict()
  .refine((v) => v.from < v.to, { message: 'from must be before to', path: ['from'] });
export type QueryInsightsDto = z.infer<typeof QueryInsightsSchema>;

/** CSAT, optionally filtered to LOW scores — which is the review queue the canon shows, and the only part of a CSAT
 *  dashboard anybody acts on. */
export const QueryCsatSchema = z.object({
  ...Window,
  maxScore: z.coerce.number().int().min(1).max(5).optional(),
  limit: Limit,
}).strict().refine((v) => v.from < v.to, { message: 'from must be before to', path: ['from'] });
export type QueryCsatDto = z.infer<typeof QueryCsatSchema>;

/** A macro. `bodies` is an ARRAY of per-language texts, not a jsonb blob, so a missing Hindi body is a queryable fact
 *  rather than an absent key nobody notices. The domain requires an English one. */
export const CreateMacroSchema = z.object({
  slug: z.string().min(3).max(61),                  // 61 allows a leading slash the domain strips
  title: z.string().min(3).max(150),
  categoryId: z.string().uuid().optional(),
  bodies: z.array(z.object({
    languageCode: z.string().min(2).max(8),
    body: z.string().min(1).max(4000),              // the real minimum is enforced in the domain, with the reason
  })).min(1).max(14),                               // the platform's language registry is 14 entries (DEV-21)
  notes: z.string().max(1000).optional(),
}).strict();
export type CreateMacroDto = z.infer<typeof CreateMacroSchema>;

export const ToggleMacroSchema = z.object({
  active: z.coerce.boolean().default(true),
  reason: Reason,
}).strict();
export type ToggleMacroDto = z.infer<typeof ToggleMacroSchema>;

// ---------------------------------------------------------------------------
// PC-56 ADMIN-2b · support policy + oversight resolve
// ---------------------------------------------------------------------------
/** RESOLVING from the oversight plane. The OUTCOME is mandatory and is the reason the endpoint exists: a ticket marked
 *  done with nothing saying what was done is unanswerable when the farmer comes back. */
export const ResolveTicketSchema = z.object({
  outcome: z.string().min(10).max(2000),
}).strict();
export type ResolveTicketDto = z.infer<typeof ResolveTicketSchema>;

/** A whole support POLICY version (0097). Sent as ONE object because it IS one promise — the domain refuses the
 *  combinations that would read fine and behave wrongly (an SLA with no chain, a chain that wakes somebody after hours,
 *  targets that tighten as severity falls, an AI allowed to auto-answer a P0). */
export const PublishSupportPolicySchema = z.object({
  name: z.string().min(3).max(120),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openHourIst: z.coerce.number().int().min(0).max(23),
  closeHourIst: z.coerce.number().int().min(1).max(24),
  afterHoursSeverities: z.array(z.string().min(2).max(2)).max(4),
  routingStrategy: z.enum(['round_robin', 'least_loaded', 'manual']),
  deskLanguages: z.array(z.string().min(2).max(8)).min(1).max(14),
  aiAssistMode: z.enum(['off', 'suggest', 'auto_reply']),
  aiExcludedSeverities: z.array(z.string().min(2).max(2)).max(4),
  slas: z.array(z.object({
    severity: z.string().min(2).max(2),
    firstResponseMinutes: z.coerce.number().int().min(1).max(43200),
    resolutionMinutes: z.coerce.number().int().min(1).max(43200),
  })).min(1).max(4),
  escalations: z.array(z.object({
    severity: z.string().min(2).max(2),
    afterMinutes: z.coerce.number().int().min(0).max(10080),
    channel: z.enum(['email', 'sms', 'whatsapp', 'call', 'in_app', 'pager']),
    targetRole: z.string().min(2).max(60),
    notes: z.string().max(500).optional(),
  })).min(1).max(40),
  notes: z.string().max(2000).optional(),
}).strict();
export type PublishSupportPolicyDto = z.infer<typeof PublishSupportPolicySchema>;
