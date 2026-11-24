// modules/equipment/dto/query-equipment-rate.dto.ts · zod .strict() rate list query (by asset).
import { z } from 'zod';
export const QueryRatesSchema = z.object({ assetId: z.string().uuid(), activeOnly: z.coerce.boolean().prefault(true) }).strict();
export type QueryRatesDto = z.infer<typeof QueryRatesSchema>;
