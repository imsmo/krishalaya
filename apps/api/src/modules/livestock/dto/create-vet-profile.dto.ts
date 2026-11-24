// modules/livestock/dto/create-vet-profile.dto.ts · zod .strict() vet self-registration + service-upsert.
import { z } from 'zod';
import { VET_SERVICE_PRICING_UNITS } from '../domain/livestock.events';
const minorStr = z.string().regex(/^\d{1,15}$/, 'must be a positive integer (minor units)');
export const RegisterVetSchema = z.object({
  registrationNo: z.string().min(2).max(60),
  isAiTechnician: z.boolean().optional(),
  serviceRadiusKm: z.number().int().min(1).max(500).optional(),
  baseRegionId: z.string().uuid().optional(),
}).strict();
export type RegisterVetDto = z.infer<typeof RegisterVetSchema>;

export const UpsertVetServiceSchema = z.object({
  serviceTypeCode: z.string().min(1).max(40),
  priceMinor: minorStr,
  pricingUnit: z.enum(VET_SERVICE_PRICING_UNITS as unknown as [string, ...string[]]).prefault('per_visit'),
  isEmergencyAvailable: z.boolean().prefault(false),
}).strict();
export type UpsertVetServiceDto = z.infer<typeof UpsertVetServiceSchema>;
