// modules/ambassadors/dto/create-visit.dto.ts · zod .strict() field-visit log + query.
import { z } from 'zod';
import { VISIT_PURPOSES } from '../domain/ambassador-visit.entity';
export const CreateVisitSchema = z.object({
  purpose: z.enum(VISIT_PURPOSES as unknown as [string, ...string[]]).prefault('other'),
  visitedUserId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
  regionId: z.string().uuid().optional(),
}).strict();
export type CreateVisitDto = z.infer<typeof CreateVisitSchema>;

export const QueryVisitsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryVisitsDto = z.infer<typeof QueryVisitsSchema>;
