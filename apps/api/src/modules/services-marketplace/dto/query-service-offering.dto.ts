// modules/services-marketplace/dto/query-service-offering.dto.ts · zod .strict() offering list query (keyset).
import { z } from 'zod';
import { OFFERING_STATUSES } from '../domain/services-marketplace.events';
export const QueryOfferingsSchema = z.object({
  box: z.enum(['mine', 'browse', 'all']).prefault('browse'),   // mine=provider's; browse=published marketplace; all=admin
  categoryId: z.string().uuid().optional(),
  status: z.enum(OFFERING_STATUSES as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryOfferingsDto = z.infer<typeof QueryOfferingsSchema>;
