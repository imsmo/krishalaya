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

// ---------------------------------------------------------------------------
// PC-56 ADMIN-2c · CSAT review + coaching
// ---------------------------------------------------------------------------
/** A verdict on a rating. The FINDING is mandatory and the schema says so in its own right, not only in the domain: a
 *  request that cannot carry a reason should not be accepted far enough to reach the rules. */
export const ReviewCsatSchema = z.object({
  verdict: z.enum(['agent_at_fault', 'process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken', 'needs_more_info']),
  finding: z.string().min(10).max(4000),
}).strict();
export type ReviewCsatDto = z.infer<typeof ReviewCsatSchema>;

/** A coaching record. `rationale` is 20 characters minimum because this row is a written statement about a named
 *  person's work — the same floor the domain and migration 0100 both enforce. */
export const CreateCoachingSchema = z.object({
  kind: z.enum(['shadow_session', 'review_call', 'written_feedback', 'signal_dismissed']),
  agentUserId: z.string().uuid(),
  tenantId: z.string().uuid(),
  rationale: z.string().min(20).max(4000),
  // ISO datetime. Required for the event kinds; the domain refuses the wrong combination with a sentence.
  scheduledFor: z.string().datetime().nullish(),
  signalNote: z.string().max(2000).nullish(),
  csatResponseId: z.string().uuid().nullish(),
  csatReviewId: z.string().uuid().nullish(),
}).strict();
export type CreateCoachingDto = z.infer<typeof CreateCoachingSchema>;

/** Settling a session. An outcome is required for `held` and REFUSED for the other two — enforced in the domain, where
 *  the reason can be stated. */
export const SettleCoachingSchema = z.object({
  status: z.enum(['held', 'missed', 'cancelled']),
  outcome: z.string().max(4000).nullish(),
}).strict();
export type SettleCoachingDto = z.infer<typeof SettleCoachingSchema>;

/** The verdict-mix window. Reuses this module's own Window convention (a required ISO from/to, from before to) rather
 *  than inventing a second date shape for one endpoint — two date conventions in one controller is how a caller ends up
 *  sending the wrong one. */
export const QueryVerdictsSchema = z.object({ ...Window }).strict()
  .refine((v) => v.from < v.to, { message: 'from must be before to', path: ['from'] });
export type QueryVerdictsDto = z.infer<typeof QueryVerdictsSchema>;

/** The review queue's read params. */
export const ReviewQueueSchema = z.object({
  maxScore: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();
export type ReviewQueueDto = z.infer<typeof ReviewQueueSchema>;

/** A support export request. `from`/`to` are NOT optional in effect — the service refuses without them, with a sentence
 *  saying why an unbounded export of support data is not a report anybody asked a question with. They stay nullish here
 *  so that refusal (and its reason) reaches the operator instead of a bare zod error. */
export const SupportExportSchema = z.object({
  report: z.string().min(3).max(40),
  from: z.string().min(4).max(40).optional(),
  to: z.string().min(4).max(40).optional(),
  tenantId: z.string().uuid().optional(),
  maxScore: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
}).strict();
export type SupportExportDto = z.infer<typeof SupportExportSchema>;

/** Filters for the coaching list. Both optional: the unfiltered list is the platform-wide ledger, which is the view a
 *  head of support needs. UUIDs only — a free-text agent filter would invite searching by name, and this table holds no
 *  names on purpose. */
export const QueryCoachingSchema = z.object({
  agentUserId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
}).strict();
export type QueryCoachingDto = z.infer<typeof QueryCoachingSchema>;
