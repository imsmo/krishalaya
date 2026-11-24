// modules/contract-farming/dto/query-contract-template.dto.ts · zod .strict() template browse.
import { z } from 'zod';
export const QueryTemplatesSchema = z.object({ activeOnly: z.coerce.boolean().prefault(true) }).strict();
export type QueryTemplatesDto = z.infer<typeof QueryTemplatesSchema>;
