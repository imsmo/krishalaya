// apps/admin-api/src/modules/recon-monitor/dto/recon-monitor.dto.ts · zod .strict() request schemas (reject
// unknown keys → no mass-assignment). Every consequential mutation carries a reason (audit/§4). No money fields
// are accepted here — recon-monitor never posts to the ledger.
import { z } from 'zod';
import { INVESTIGATION_STATUSES } from '../domain/investigation.state';

const Reason = z.string().min(3).max(1000);
const RUN_TYPES = ['hourly_internal', 'daily_gateway', 'zero_sum_check'] as const;

export const QueryRunsSchema = z.object({
  runType: z.enum(RUN_TYPES).optional(),
  status: z.string().max(20).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryRunsDto = z.infer<typeof QueryRunsSchema>;

export const QueryInvestigationsSchema = z.object({
  status: z.enum(INVESTIGATION_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryInvestigationsDto = z.infer<typeof QueryInvestigationsSchema>;

export const OpenInvestigationSchema = z.object({
  runId: z.string().uuid(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).prefault('high'),
  summary: Reason,
  assignedTo: z.string().uuid().nullish(),
}).strict();
export type OpenInvestigationDto = z.infer<typeof OpenInvestigationSchema>;

export const UpdateInvestigationSchema = z.object({
  action: z.enum(['start', 'resolve', 'false_positive']),
  note: Reason,
  assignedTo: z.string().uuid().nullish(),
}).strict();
export type UpdateInvestigationDto = z.infer<typeof UpdateInvestigationSchema>;

export const FreezeAccountSchema = z.object({
  action: z.enum(['freeze', 'unfreeze']),
  reason: Reason,
}).strict();
export type FreezeAccountDto = z.infer<typeof FreezeAccountSchema>;
