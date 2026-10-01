// modules/audit/dto/audit.dto.ts · zod .strict() query for the read-only audit-trail browse.
// All filters optional; results are keyset-paginated (created_at DESC, id DESC). Free-text is NOT
// supported (the trail is structured) — filter by action / entity / actor / time window only.
//
// [PC-56 TENANT-9c · F-9] `from` / `to` are CIVIL DAYS (`YYYY-MM-DD`) in the cooperative's own zone, both inclusive — they
// were ISO instants the console built as UTC days. The window is BOUNDED (≤ 92 days, the canon's own bound) by the service;
// unset, it is the 92 days ending today (no earlier than the fiscal year's first day, when one is declared).
import { z } from 'zod';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day, YYYY-MM-DD');

export const QueryAuditSchema = z.object({
  action: z.string().min(1).max(120).optional(),       // exact action key, e.g. 'kyc.approved'
  entityType: z.string().min(1).max(60).optional(),    // e.g. 'order','milk_bill'
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  from: DAY.optional(),                                // first day, inclusive, the cooperative's zone
  to: DAY.optional(),                                  // last day, inclusive, the cooperative's zone
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryAuditDto = z.infer<typeof QueryAuditSchema>;

/** A recorded reveal of ONE entry's masked fields (`member.pii.reveal`, 1b's bound: a reason of at least 20 characters). */
export const MIN_REVEAL_REASON = 20;
export const MAX_REVEAL_REASON = 500;
export const RevealAuditSchema = z.object({ reason: z.string().trim().min(1).max(MAX_REVEAL_REASON) }).strict();
export type RevealAuditDto = z.infer<typeof RevealAuditSchema>;
