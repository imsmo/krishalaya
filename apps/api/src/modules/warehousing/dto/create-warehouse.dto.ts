// modules/warehousing/dto/create-warehouse.dto.ts · zod .strict() warehouse listing payload.
import { z } from 'zod';
import { STORAGE_KINDS } from '../domain/warehousing.events';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a non-negative integer (minor units)');
export const CreateWarehouseSchema = z.object({
  defaultName: z.string().min(1).max(200),
  operatorUserId: z.string().uuid().optional(),
  wdraRegNo: z.string().max(60).optional(),
  addressId: z.string().uuid().optional(),
  capacityMt: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  storageKinds: z.array(z.enum(STORAGE_KINDS as unknown as [string, ...string[]])).max(10).prefault([]),
  commoditiesAccepted: z.array(z.string().uuid()).max(100).prefault([]),
  ratePerQtlMonthMinor: minorStr.optional(),
  insurancePolicyRef: z.string().max(120).optional(),
}).strict();
export type CreateWarehouseDto = z.infer<typeof CreateWarehouseSchema>;
