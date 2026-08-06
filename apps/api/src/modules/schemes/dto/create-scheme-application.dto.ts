// modules/schemes/dto/create-scheme-application.dto.ts · zod .strict() apply + lifecycle payloads.
import { z } from 'zod';
import { REJECTION_CODES } from '../domain/rejection-codes';
export const ApplySchemeSchema = z.object({
  schemeId: z.string().uuid(),
  formData: z.record(z.unknown()).default({}),
  assistedBy: z.string().uuid().optional(),
}).strict();
export type ApplySchemeDto = z.infer<typeof ApplySchemeSchema>;

export const ClarifySchema = z.object({ note: z.string().max(1000).optional() }).strict();
export type ClarifyDto = z.infer<typeof ClarifySchema>;
export const ApproveSchema = z.object({ govtAppRef: z.string().max(120).optional() }).strict();
export type ApproveDto = z.infer<typeof ApproveSchema>;
// ADMIN-4b: `reasonCode` alongside the prose (migration 0106). Optional — see domain/rejection-codes.ts for why a
// mandatory code would be worse than an optional one. The prose is untouched: the code is what a machine counts, and
// `reason` is still where the officer says what actually happened.
export const RejectSchema = z.object({
  reason: z.string().max(1000).optional(),
  reasonCode: z.enum(REJECTION_CODES).optional(),
}).strict();
export type RejectDto = z.infer<typeof RejectSchema>;
