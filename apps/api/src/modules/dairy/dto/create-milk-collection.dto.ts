// modules/dairy/dto/create-milk-collection.dto.ts · zod .strict() counter-entry payload.
// weight/fat/snf are DECIMAL STRINGS (parsed into scaled integers; no float). amount is server-computed.
import { z } from 'zod';
import { MILK_SHIFTS } from '../domain/dairy.events';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const RecordCollectionSchema = z.object({
  membershipId: z.string().uuid(),
  shift: z.enum(MILK_SHIFTS as unknown as [string, ...string[]]),
  collectedOn: dateStr,
  weightKg: z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'weight kg, up to 3 decimals'),
  fatPct: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'fat %, up to 2 decimals'),
  snfPct: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'snf %, up to 2 decimals'),
  /**
   * [PC-56 TENANT-6b-1] The analyzer's density reading — W168 shows it as the water flag's own evidence
   * ("density 1.024 (low)"). `milk_collections.density` existed from 0009 and this DTO did not accept it, so the number
   * the operator read off the Lactoscan had nowhere to go and the flag stood on nothing a committee could review.
   */
  density: z.string().regex(/^\d(\.\d{1,3})?$/, 'density, e.g. 1.026').optional(),
  waterFlag: z.boolean().default(false),
  adulterationFlags: z.array(z.string().max(40)).max(10).default([]),
}).strict();
export type RecordCollectionDto = z.infer<typeof RecordCollectionSchema>;
