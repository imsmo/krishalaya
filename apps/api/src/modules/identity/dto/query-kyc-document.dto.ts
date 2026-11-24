import { z } from 'zod';
export const QueryKycSchema = z.object({ userId: z.string().uuid().optional(), status: z.enum(['none','pending','verified','rejected','expired']).optional(), limit: z.coerce.number().int().min(1).max(100).prefault(50) }).strict();
export type QueryKycDto = z.infer<typeof QueryKycSchema>;
