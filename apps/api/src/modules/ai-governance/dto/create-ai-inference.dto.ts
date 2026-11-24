// modules/ai-governance/dto/create-ai-inference.dto.ts · zod .strict() — record one AI decision.
// The model is referenced by code (the recorder resolves the live/production version). input_ref carries
// POINTERS ONLY (ids/digests) — never raw PII (enforced again in the domain entity). confidence ∈ [0,1].
import { z } from 'zod';
export const CreateInferenceSchema = z.object({
  modelCode: z.string().min(1).max(80),
  subjectType: z.string().min(1).max(50),
  subjectId: z.string().uuid(),
  inputRef: z.record(z.string(), z.unknown()).prefault({}),
  output: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullish(),
  forceReview: z.boolean().prefault(false),                 // caller can force HITL regardless of threshold
}).strict();
export type CreateInferenceDto = z.infer<typeof CreateInferenceSchema>;
