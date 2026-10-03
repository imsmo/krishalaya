// modules/tenant-api-keys/dto/api-key.dto.ts · zod .strict() DTOs — PC-56 TENANT-13c. The wire shape only; every rule a person can break
// (catalogue membership, rate range, expiry window, reason length) is judged by domain/api-key.rules.ts so the review page and the write
// refuse with the SAME codes. Anchored regexes; bounded lengths.
import { z } from 'zod';

const SCOPE = z.string().regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/).max(40);

export const KeyDraftSchema = z.object({
  name: z.string().max(200),
  scopes: z.array(SCOPE).max(40),
  ratePerHour: z.coerce.number().int().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().max(600).optional(),
}).strict();
export type KeyDraftDto = z.infer<typeof KeyDraftSchema>;

export const PreviewKeySchema = KeyDraftSchema.partial().strict();
export type PreviewKeyDto = z.infer<typeof PreviewKeySchema>;

export const ReasonRequiredSchema = z.object({ reason: z.string().max(600) }).strict();
export type ReasonRequiredDto = z.infer<typeof ReasonRequiredSchema>;

export const QueryKeysSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryKeysDto = z.infer<typeof QueryKeysSchema>;

export const QueryKeyProposalsSchema = z.object({
  status: z.enum(['proposed', 'confirmed', 'refused', 'expired']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryKeyProposalsDto = z.infer<typeof QueryKeyProposalsSchema>;
