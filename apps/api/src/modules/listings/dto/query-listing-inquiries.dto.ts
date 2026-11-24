// modules/listings/dto/query-listing-inquiries.dto.ts · KV-BL-031 (screen 112 inquiries tab).
// Opaque base64 keyset cursor, `limit` 1..100 — same grammar as every other list endpoint (03_API_CONTRACT_DELTA.md
// pagination convention), forwarded as-is into communication's ConversationService cursor.
import { z } from 'zod';
export const QueryListingInquiriesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryListingInquiriesDto = z.infer<typeof QueryListingInquiriesSchema>;
