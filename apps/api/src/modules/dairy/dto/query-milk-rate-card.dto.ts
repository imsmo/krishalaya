// modules/dairy/dto/query-milk-rate-card.dto.ts · zod .strict() rate card list query.
import { z } from 'zod';
import { ANIMAL_TYPES } from '../domain/dairy.events';
import { queryBoolean } from '../../../core/http/query-boolean';
export const QueryRateCardsSchema = z.object({
  animalType: z.enum(ANIMAL_TYPES as unknown as [string, ...string[]]).optional(),
  // [PC-56 OPS-3c · lead decision 2026-11-09, survey-ops3 F-1] was `z.coerce.boolean()` — Boolean("false") is TRUE, so `?activeOnly=false`
  // returned the approved list and the organisation's console never saw a card awaiting a second person (HOTFIX-12's Approve could not
  // appear). The house strict query boolean: 'true'/'1' → true, 'false'/'0' → false, anything else refused (422). WHO may see more than
  // the approved list is decided in `MilkRateCardService.list` (only a `dairy.manage` holder).
  activeOnly: queryBoolean().default(true),
}).strict();
export type QueryRateCardsDto = z.infer<typeof QueryRateCardsSchema>;
