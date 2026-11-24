// modules/contract-farming/dto/create-contract-template.dto.ts · zod .strict() template create.
import { z } from 'zod';
export const CreateTemplateSchema = z.object({
  defaultName: z.string().min(1).max(200),
  categoryId: z.string().uuid().optional(),
  bodyTemplate: z.string().min(1).max(50000),
  clauses: z.array(z.record(z.string(), z.unknown())).max(200).prefault([]),
}).strict();
export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;
