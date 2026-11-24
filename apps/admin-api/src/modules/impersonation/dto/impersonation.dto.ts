// apps/admin-api/src/modules/impersonation/dto/impersonation.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Every consequential mutation carries a reason (audit/§4). Scope is fixed to
// 'read_only'; ttlSec is bounded (the hard cap is also enforced in the domain against config). Identifiers are
// uuids; the action recorder's path is length-bounded (no query string / PII).
import { z } from 'zod';
import { GRANT_STATUSES } from '../domain/grant.state';
import { IMPERSONATION_SCOPES } from '../domain/scope';

const Reason = z.string().min(8).max(1000);   // act-as demands a real justification — min length is deliberate
const Cursor = z.string().max(200).optional();
const Limit = z.coerce.number().int().min(1).max(100).prefault(50);

export const QueryGrantsSchema = z.object({
  adminUserId: z.string().uuid().optional(),
  targetTenantId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  status: z.enum(GRANT_STATUSES).optional(),
  cursor: Cursor,
  limit: Limit,
}).strict();
export type QueryGrantsDto = z.infer<typeof QueryGrantsSchema>;

export const QueryActionsSchema = z.object({ cursor: Cursor, limit: Limit }).strict();
export type QueryActionsDto = z.infer<typeof QueryActionsSchema>;

export const StartGrantSchema = z.object({
  targetTenantId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  reason: Reason,
  ttlSec: z.coerce.number().int().min(60).max(3600).prefault(900),   // 1–60 min requested; domain clamps to config cap
  scope: z.enum(IMPERSONATION_SCOPES).prefault('read_only'),
}).strict();
export type StartGrantDto = z.infer<typeof StartGrantSchema>;

export const EndGrantSchema = z.object({ reason: Reason }).strict();
export type EndGrantDto = z.infer<typeof EndGrantSchema>;

export const RecordActionSchema = z.object({
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1).max(300).regex(/^\/[A-Za-z0-9/_.:-]*$/, 'path must be a clean URL path (no query string)'),
  action: z.string().max(120).regex(/^[a-z0-9_.]+$/).optional(),
}).strict();
export type RecordActionDto = z.infer<typeof RecordActionSchema>;
