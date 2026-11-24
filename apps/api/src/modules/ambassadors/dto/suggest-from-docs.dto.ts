// modules/ambassadors/dto/suggest-from-docs.dto.ts · ask the AI tier to SUGGEST listing fields from a farmer's
// document (P1-16-AI). `docText` is the OCR'd/typed text (transient — used for the inference, never persisted);
// `mediaIds` are the uploaded document assets (pointers for the audit trail). Consent + active-ambassador are
// re-checked server-side. The suggestion is advisory — the ambassador edits + confirms via the on-behalf create.
import { z } from 'zod';

export const SuggestFromDocsSchema = z.object({
  farmerUserId: z.string().uuid(),
  docText: z.string().min(1).max(4000),                          // transient; never stored
  locale: z.enum(['hi', 'en', 'gu']).prefault('hi'),
  mediaIds: z.array(z.string().uuid()).max(10).prefault([]),
}).strict();
export type SuggestFromDocsDto = z.infer<typeof SuggestFromDocsSchema>;
