import { z } from 'zod';
export const QueryAddressSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).prefault(50) }).strict();
export type QueryAddressDto = z.infer<typeof QueryAddressSchema>;
