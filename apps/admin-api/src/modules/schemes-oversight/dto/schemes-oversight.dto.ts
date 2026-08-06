// apps/admin-api/src/modules/schemes-oversight/dto/schemes-oversight.dto.ts · zod .strict() request schemas.
//
// `status` is a plain bounded string here rather than a zod enum, so the DOMAIN's `assertFilters` produces the 422
// that names the nine valid states. A zod enum failure would say "invalid enum value" and leave an operator guessing
// which nine; the domain error lists them.
import { z } from 'zod';

const Uuid = z.string().uuid();
const Cursor = z.string().max(200).optional();

export const QueryApplicationsSchema = z.object({
  status: z.string().max(24).optional(),
  schemeId: Uuid.optional(),
  tenantId: Uuid.optional(),
  assistedOnly: z.string().max(5).optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryApplicationsDto = z.infer<typeof QueryApplicationsSchema>;

export const QueryCountsSchema = z.object({
  schemeId: Uuid.optional(),
  tenantId: Uuid.optional(),
  assistedOnly: z.string().max(5).optional(),
}).strict();
export type QueryCountsDto = z.infer<typeof QueryCountsSchema>;

/** The unmask request. `reason` is validated for LENGTH in the domain (10 char floor) rather than here, so the 422
 *  can explain that the reason IS the audit trail — a bare "String must contain at least 10 character(s)" teaches an
 *  operator to pad, not to explain. */
export const UnmaskApplicantSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export type UnmaskApplicantDto = z.infer<typeof UnmaskApplicantSchema>;

export const QueryDbtSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  schemeId: Uuid.optional(),
  cursor: Cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryDbtDto = z.infer<typeof QueryDbtSchema>;

export const QueryBouncesSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  resolution: z.enum(['open', 'recredited', 'abandoned']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type QueryBouncesDto = z.infer<typeof QueryBouncesSchema>;

export const OversightExportSchema = z.object({
  report: z.string().min(1).max(40),
  limit: z.coerce.number().int().min(1).max(20000).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  status: z.string().max(24).optional(),
  schemeId: Uuid.optional(),
  tenantId: Uuid.optional(),
  assistedOnly: z.string().max(5).optional(),
  resolution: z.enum(['open', 'recredited', 'abandoned']).optional(),
}).strict();
export type OversightExportDto = z.infer<typeof OversightExportSchema>;
