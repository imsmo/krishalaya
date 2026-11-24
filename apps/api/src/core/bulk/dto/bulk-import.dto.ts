// core/bulk/dto/bulk-import.dto.ts · zod .strict() request schemas (reject unknown keys → no mass-assignment).
import { z } from 'zod';
import { BULK_STATUSES } from '../domain/bulk-import.events';

export const CreateBulkImportSchema = z.object({
  importType: z.string().regex(/^[a-z_]{2,40}$/),        // validated against the registered appliers in the service
  storageKey: z.string().min(1).max(500),                // object-store key of the already-uploaded CSV
  originalFilename: z.string().max(255).nullish(),
  columnMapping: z.record(z.string(), z.string().max(80)).prefault({}),
}).strict();
export type CreateBulkImportDto = z.infer<typeof CreateBulkImportSchema>;

export const QueryBulkImportSchema = z.object({
  status: z.enum(BULK_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryBulkImportDto = z.infer<typeof QueryBulkImportSchema>;

export const QueryErrorsSchema = z.object({
  afterRow: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).prefault(100),
}).strict();
export type QueryErrorsDto = z.infer<typeof QueryErrorsSchema>;
